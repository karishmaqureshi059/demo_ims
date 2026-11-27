import 'dotenv/config';
import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool, checkAndInitDatabase } from '../config/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function initDB() {
  const dbUrl = (process.env.DATABASE_URL || '').trim();

  if (!dbUrl) {
    console.error('❌ Error: DATABASE_URL is not set in backend/.env');
    process.exit(1);
  }

  if (dbUrl.includes('[YOUR-PASSWORD]') || dbUrl.includes('[YOUR-PROJECT-REF]')) {
    console.error('\n⚠️ Unfilled placeholder detected in DATABASE_URL.');
    console.error('Please update backend/.env with your Supabase credentials before running db:init.\n');
    process.exit(1);
  }

  const isSupabase = dbUrl.includes('supabase.co') || dbUrl.includes('pooler.supabase.com');

  if (!isSupabase) {
    // For local PostgreSQL, optionally ensure target database exists
    try {
      const url = new URL(dbUrl);
      const targetDbName = url.pathname.replace(/^\//, '') || 'inventory_management';

      if (targetDbName !== 'postgres') {
        const adminUrl = new URL(dbUrl);
        adminUrl.pathname = '/postgres';
        const adminPool = new Pool({ connectionString: adminUrl.toString() });

        try {
          const checkRes = await adminPool.query(
            'SELECT 1 FROM pg_database WHERE datname = $1',
            [targetDbName]
          );

          if (checkRes.rowCount === 0) {
            console.log(`⚡ Local database "${targetDbName}" not found. Creating it...`);
            await adminPool.query(`CREATE DATABASE "${targetDbName}"`);
            console.log(`✅ Local database "${targetDbName}" created successfully!`);
          }
        } finally {
          await adminPool.end();
        }
      }
    } catch (err) {
      console.warn('⚠️ Note on database creation check:', err.message);
    }
  }

  console.log('🔄 Checking database tables and applying schema...');
  try {
    await checkAndInitDatabase(pool);
    console.log('🎉 Database initialization complete!');
  } finally {
    await pool.end();
  }
}

initDB()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('❌ Setup failed:', err.message);
    process.exit(1);
  });
