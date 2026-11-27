import { pool } from '../config/db.js';
import bcrypt from 'bcryptjs';

async function checkPasswords() {
  const res = await pool.query('SELECT id, name, email, role, password FROM users ORDER BY employee_id');
  const candidates = [
    'Owner@123', 'owner123', 'admin', 'admin123', 'Password@123',
    'Product@123', 'Sales@123', 'Stock@123', 'Purchase@123', 'Orders@123'
  ];

  for (const user of res.rows) {
    console.log(`\nChecking user ${user.role} (${user.email}):`);
    let found = false;
    for (const cand of candidates) {
      const match = await bcrypt.compare(cand, user.password);
      if (match) {
        console.log(`  MATCH: "${cand}"`);
        found = true;
        break;
      }
    }
    if (!found) {
      console.log(`  NO MATCH among candidates. Hash begins with: ${user.password.slice(0, 15)}...`);
    }
  }

  await pool.end();
}

checkPasswords().catch(console.error);
