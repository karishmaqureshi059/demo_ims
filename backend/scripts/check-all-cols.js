import { pool } from '../config/db.js';

async function selectAllCols() {
  const res = await pool.query('SELECT id, name, email, role, status, employee_id, created_at, updated_at FROM users');
  console.log(res.rows);
  await pool.end();
}

selectAllCols().catch(console.error);
