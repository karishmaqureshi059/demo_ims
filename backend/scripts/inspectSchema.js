import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

const { pool } = await import('../config/db.js');

async function inspectSchema() {
  const enumVals = await pool.query("SELECT t.typname, e.enumlabel FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid");
  console.log('Enums in DB:', enumVals.rows);

  const notifs = await pool.query('SELECT * FROM notifications ORDER BY created_at DESC');
  console.log('Existing notifications:', notifs.rows);

  await pool.end();
}

inspectSchema().catch(console.error);
