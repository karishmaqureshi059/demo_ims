import { pool } from '../config/db.js';

async function checkAllUsers() {
  const res = await pool.query('SELECT id, name, email, role, status, employee_id FROM users ORDER BY employee_id, role');
  console.log('Users in database:');
  console.log(res.rows);
  await pool.end();
}

checkAllUsers().catch(console.error);
