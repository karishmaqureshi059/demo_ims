import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { Pool } from 'pg';
import pgConn from 'pg-connection-string';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../.env') });

const connectionString = (process.env.DATABASE_URL || '').trim();
console.log('Testing connection to host:', connectionString.split('@')[1]?.split('/')[0] || 'unknown');

const parsed = pgConn.parse(connectionString);
if (parsed.password) {
  try {
    parsed.password = decodeURIComponent(parsed.password);
  } catch {}
}

const pool = new Pool({
  ...parsed,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 20000,
});

const start = Date.now();
try {
  const client = await pool.connect();
  console.log(`Connected successfully in ${Date.now() - start}ms!`);
  const res = await client.query('SELECT NOW() as now, current_database() as db');
  console.log('Query result:', res.rows[0]);
  client.release();
  await pool.end();
  process.exit(0);
} catch (err) {
  console.error(`Connection failed after ${Date.now() - start}ms:`, err.message, err.code);
  await pool.end().catch(() => {});
  process.exit(1);
}
