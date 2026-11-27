import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

const { pool } = await import('../config/db.js');

async function inspectAndBackup() {
  const backupDir = path.join(__dirname, '../backups');
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFile = path.join(backupDir, `backup_${timestamp}.json`);

  try {
    console.log('--- 1. INSPECTING FOREIGN KEYS ---');
    const fkQuery = `
      SELECT
        tc.table_name,
        kcu.column_name,
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name,
        rc.delete_rule
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      JOIN information_schema.referential_constraints AS rc
        ON tc.constraint_name = rc.constraint_name
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
      WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
      ORDER BY tc.table_name;
    `;
    const fks = await pool.query(fkQuery);
    console.table(fks.rows);

    console.log('\n--- 2. CREATING DATABASE BACKUP ---');
    const allTables = [
      'roles',
      'permissions',
      'role_permissions',
      'users',
      'settings',
      'categories',
      'products',
      'suppliers',
      'purchase_orders',
      'purchase_order_items',
      'sales',
      'sale_items',
      'orders',
      'order_items',
      'stock_transactions',
      'notifications',
      'user_activity',
    ];

    const backupData = {
      timestamp: new Date().toISOString(),
      tables: {},
      counts: {},
    };

    for (const table of allTables) {
      const res = await pool.query(`SELECT * FROM "${table}"`);
      backupData.tables[table] = res.rows;
      backupData.counts[table] = res.rows.length;
      console.log(`Backed up ${table}: ${res.rows.length} rows`);
    }

    fs.writeFileSync(backupFile, JSON.stringify(backupData, null, 2), 'utf-8');
    console.log(`\n✅ Backup successfully saved to: ${backupFile}`);
    console.log(`File size: ${(fs.statSync(backupFile).size / 1024).toFixed(2)} KB`);

    console.log('\n--- 3. SEQUENCES TO RESET ---');
    const seqRes = await pool.query(`
      SELECT sequence_name FROM information_schema.sequences WHERE sequence_schema = 'public'
    `);
    console.log('Public sequences:', seqRes.rows.map(s => s.sequence_name));

    await pool.end();
  } catch (err) {
    console.error('Inspection/Backup failed:', err);
    process.exit(1);
  }
}

inspectAndBackup();
