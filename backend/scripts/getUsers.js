import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

const { pool } = await import('../config/db.js');

async function getUsers() {
  try {
    const res = await pool.query('SELECT id, name, email, role FROM users');
    console.table(res.rows);
    await pool.end();
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}
getUsers();
