import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

const { pool } = await import('../config/db.js');

async function checkRBAC() {
  try {
    const roles = await pool.query('SELECT count(*) FROM roles');
    const perms = await pool.query('SELECT count(*) FROM permissions');
    const rolePerms = await pool.query('SELECT count(*) FROM role_permissions');
    console.log({
      roles: roles.rows[0].count,
      permissions: perms.rows[0].count,
      rolePermissions: rolePerms.rows[0].count,
    });
    await pool.end();
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}
checkRBAC();
