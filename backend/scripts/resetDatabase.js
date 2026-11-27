import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

const { pool } = await import('../config/db.js');

export async function executeReset() {
  const client = await pool.connect();
  try {
    console.log('🔄 Executing safe database reset in transaction...');
    await client.query('BEGIN');

    // Delete business records in strict foreign-key order
    const deletedCounts = {};

    const resOrderItems = await client.query('DELETE FROM order_items RETURNING id');
    deletedCounts.order_items = resOrderItems.rows.length;

    const resOrders = await client.query('DELETE FROM orders RETURNING id');
    deletedCounts.orders = resOrders.rows.length;

    const resSaleItems = await client.query('DELETE FROM sale_items RETURNING id');
    deletedCounts.sale_items = resSaleItems.rows.length;

    const resSales = await client.query('DELETE FROM sales RETURNING id');
    deletedCounts.sales = resSales.rows.length;

    const resPoItems = await client.query('DELETE FROM purchase_order_items RETURNING id');
    deletedCounts.purchase_order_items = resPoItems.rows.length;

    const resPo = await client.query('DELETE FROM purchase_orders RETURNING id');
    deletedCounts.purchase_orders = resPo.rows.length;

    const resSuppliers = await client.query('DELETE FROM suppliers RETURNING id');
    deletedCounts.suppliers = resSuppliers.rows.length;

    const resStock = await client.query('DELETE FROM stock_transactions RETURNING id');
    deletedCounts.stock_transactions = resStock.rows.length;

    const resProducts = await client.query('DELETE FROM products RETURNING id');
    deletedCounts.products = resProducts.rows.length;

    await client.query('UPDATE categories SET parent_id = NULL');
    const resCategories = await client.query('DELETE FROM categories RETURNING id');
    deletedCounts.categories = resCategories.rows.length;

    const resNotifs = await client.query('DELETE FROM notifications RETURNING id');
    deletedCounts.notifications = resNotifs.rows.length;

    const resActivity = await client.query('DELETE FROM user_activity RETURNING id');
    deletedCounts.user_activity = resActivity.rows.length;

    // Reset sequences if any exist in public schema
    const seqs = await client.query(`SELECT sequence_name FROM information_schema.sequences WHERE sequence_schema = 'public'`);
    for (const seq of seqs.rows) {
      await client.query(`ALTER SEQUENCE "${seq.sequence_name}" RESTART WITH 1`);
      console.log(`Reset sequence: ${seq.sequence_name}`);
    }

    // Verify preserved accounts and roles
    const usersCount = await client.query('SELECT count(*) FROM users');
    const rolesCount = await client.query('SELECT count(*) FROM roles');
    const permsCount = await client.query('SELECT count(*) FROM permissions');
    const rolePermsCount = await client.query('SELECT count(*) FROM role_permissions');

    // Record single clean initial log for owner
    const ownerRes = await client.query("SELECT id FROM users WHERE role = 'owner' LIMIT 1");
    if (ownerRes.rows.length > 0) {
      await client.query(
        `INSERT INTO user_activity (id, user_id, action, module, details, ip, user_agent, created_at)
         VALUES (gen_random_uuid(), $1, 'System database reset executed', 'System', '{"clean_state": true}', '127.0.0.1', 'System/Reset', CURRENT_TIMESTAMP)`,
        [ownerRes.rows[0].id]
      );
    }

    await client.query('COMMIT');

    console.log('\n✅ DATABASE RESET EXECUTED SUCCESSFULLY!\n');
    console.log('--- DELETED BUSINESS RECORDS ---');
    console.table(deletedCounts);

    console.log('--- PRESERVED SYSTEM RECORDS ---');
    console.table({
      users: Number(usersCount.rows[0].count),
      roles: Number(rolesCount.rows[0].count),
      permissions: Number(permsCount.rows[0].count),
      role_permissions: Number(rolePermsCount.rows[0].count),
    });

    return {
      success: true,
      deletedCounts,
      preserved: {
        users: Number(usersCount.rows[0].count),
        roles: Number(rolesCount.rows[0].count),
        permissions: Number(permsCount.rows[0].count),
        role_permissions: Number(rolePermsCount.rows[0].count),
      },
    };
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Reset failed, rolled back changes:', err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  executeReset()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
