import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../.env') });
dotenv.config();

import { Pool } from 'pg';
import pgConn from 'pg-connection-string';
import bcrypt from 'bcryptjs';
import fs from 'fs';

// Supabase and cloud-hosted Postgres require SSL
const connectionString = (process.env.DATABASE_URL || '').trim();
const isSslRequired = Boolean(
  connectionString.includes('supabase.co') ||
  connectionString.includes('pooler.supabase.com') ||
  connectionString.includes('sslmode=require') ||
  process.env.DB_SSL === 'true' ||
  process.env.NODE_ENV === 'production'
);

let poolConfig = {
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
};

if (connectionString) {
  try {
    const parsed = pgConn.parse(connectionString);
    if (parsed.password) {
      try {
        parsed.password = decodeURIComponent(parsed.password);
      } catch {}
    }
    poolConfig = {
      ...poolConfig,
      ...parsed,
      ssl: isSslRequired ? { rejectUnauthorized: false } : false,
    };
  } catch {
    poolConfig = {
      ...poolConfig,
      connectionString,
      ssl: isSslRequired ? { rejectUnauthorized: false } : false,
    };
  }
}

export const pool = new Pool(poolConfig);

pool.on('error', (err) => {
  console.error('Unexpected idle client error on PostgreSQL pool:', err.message);
});

export const REQUIRED_TABLES = [
  'roles',
  'permissions',
  'role_permissions',
  'users',
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
  'attendance',
  'user_activity',
  'settings',
];

export async function ensureDemoAccounts(clientPool) {
  const accounts = [
    { id: '42c5a62e-93d7-4c55-b816-b9e8bb518050', employeeId: 'EMP001', name: 'System Owner', email: 'owner@inventory.com', pass: 'Owner@123', role: 'owner', phone: '+91 98765 43210' },
    { id: '22222222-2222-4222-8222-222222222222', employeeId: 'EMP002', name: 'Product Manager', email: 'product@inventory.com', pass: 'Product@123', role: 'product', phone: '+91 98765 43211' },
    { id: '33333333-3333-4333-8333-333333333333', employeeId: 'EMP003', name: 'Sales Manager', email: 'sales@inventory.com', pass: 'Sales@123', role: 'sales', phone: '+91 98765 43212' },
    { id: '44444444-4444-4444-8444-444444444444', employeeId: 'EMP004', name: 'Stock Manager', email: 'stock@inventory.com', pass: 'Stock@123', role: 'stock', phone: '+91 98765 43213' },
    { id: '55555555-5555-4555-8555-555555555555', employeeId: 'EMP005', name: 'Purchase Manager', email: 'purchase@inventory.com', pass: 'Purchase@123', role: 'purchase', phone: '+91 98765 43214' },
    { id: '66666666-6666-4666-8666-666666666666', employeeId: 'EMP006', name: 'Order Manager', email: 'orders@inventory.com', pass: 'Orders@123', role: 'orders', phone: '+91 98765 43215' },
  ];

  try {
    for (const acc of accounts) {
      const existing = await clientPool.query('SELECT id, password, employee_id FROM users WHERE LOWER(email) = LOWER($1)', [acc.email]);
      if (existing.rows.length === 0) {
        const hash = await bcrypt.hash(acc.pass, 12);
        await clientPool.query(
          `INSERT INTO users (id, employee_id, name, email, password, role, status, phone, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, 'active', $7, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
           ON CONFLICT (email) DO NOTHING`,
          [acc.id, acc.employeeId, acc.name, acc.email, hash, acc.role, acc.phone]
        );
        console.log(`Created missing demo account: ${acc.email} (${acc.role})`);
      } else {
        if (!existing.rows[0].employee_id) {
          await clientPool.query('UPDATE users SET employee_id = $1 WHERE id = $2', [acc.employeeId, existing.rows[0].id]);
        }
        const isMatch = await bcrypt.compare(acc.pass, existing.rows[0].password || '');
        if (!isMatch) {
          const hash = await bcrypt.hash(acc.pass, 12);
          await clientPool.query(
            'UPDATE users SET password = $1, status = \'active\', updated_at = CURRENT_TIMESTAMP WHERE id = $2',
            [hash, existing.rows[0].id]
          );
          console.log(`Synchronized demo password for: ${acc.email} (${acc.role})`);
        }
      }
    }
  } catch (err) {
    console.error('Error ensuring demo accounts:', err.message);
  }
}

export async function checkAndInitDatabase(clientPool = pool) {
  try {
    const tableRes = await clientPool.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`
    );
    const existingTables = new Set(tableRes.rows.map((r) => r.table_name.toLowerCase()));
    const missingTables = REQUIRED_TABLES.filter((t) => !existingTables.has(t));

    if (missingTables.length > 0) {
      console.log(`Missing required database tables detected: ${missingTables.join(', ')}`);
      console.log('Applying database schema from scripts/setup-db.sql...');

      const sqlPath = path.join(__dirname, '../scripts/setup-db.sql');
      const schemaSql = fs.readFileSync(sqlPath, 'utf8');

      await clientPool.query(schemaSql);
      console.log('✅ Database tables and initial roles/permissions created successfully.');
    } else {
      console.log(`✅ All required database tables are present (${REQUIRED_TABLES.length} tables verified).`);
    }

    await ensureDemoAccounts(clientPool);
    return { success: true, missing: missingTables };
  } catch (err) {
    console.error('Error during database table verification/creation:', err.message);
    throw err;
  }
}

const connectDB = async () => {
  const dbUrl = (process.env.DATABASE_URL || '').trim();

  if (!dbUrl) {
    console.error('\n❌ DATABASE_URL is not set in backend/.env');
    console.error('Please configure DATABASE_URL in backend/.env to connect to your Supabase database.\n');
    process.exit(1);
  }

  // Check for unfilled placeholder credentials
  if (dbUrl.includes('[YOUR-PASSWORD]') || dbUrl.includes('[YOUR-PROJECT-REF]') || dbUrl.includes('[PASSWORD]')) {
    console.error('\n⚠️ Unfilled placeholder detected in DATABASE_URL:');
    console.error('Please replace [YOUR-PASSWORD] and [YOUR-PROJECT-REF] with your actual Supabase credentials in backend/.env.\n');
    process.exit(1);
  }

  try {
    const res = await pool.query('SELECT NOW() as current_time, current_database() as db_name');
    const isSupabase = dbUrl.includes('supabase.co') || dbUrl.includes('pooler.supabase.com');
    console.log(`✅ PostgreSQL connected successfully to database "${res.rows[0].db_name}" (${isSupabase ? 'Supabase' : 'Local/Remote'})`);

    // Verify and auto-create missing tables and demo accounts
    await checkAndInitDatabase(pool);
  } catch (error) {
    console.error('\n❌ PostgreSQL connection failed:');
    if (error.code === '28P01' || error.message?.includes('password authentication failed')) {
      console.error('👉 Error: Password authentication failed.');
      console.error('   Please check and update your database password in backend/.env.');
    } else if (error.code === 'ENOTFOUND' || error.code === 'EAI_AGAIN') {
      console.error('👉 Error: Database host could not be resolved.');
      console.error('   Please verify your Supabase project reference URL in backend/.env.');
    } else if (error.code === 'ETIMEDOUT' || error.code === 'ECONNREFUSED') {
      console.error('👉 Error: Connection timed out or was refused.');
      console.error('   Verify that your Supabase project is active (not paused).');
      console.error('   If using an IPv4 network, you may need Supabase Connection Pooler on port 6543.');
    } else if (error.message?.includes('SSL')) {
      console.error('👉 Error: SSL negotiation error.');
      console.error('   Supabase requires SSL. Ensure your connection string includes SSL support.');
    } else {
      console.error(`👉 Error details: ${error.message} (Code: ${error.code || 'UNKNOWN'})`);
    }
    console.error('');
    process.exit(1);
  }
};

export default connectDB;
