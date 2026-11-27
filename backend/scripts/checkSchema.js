import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

const { pool } = await import('../config/db.js');

async function checkSchema() {
  try {
    const res = await pool.query(`
      SELECT table_name, column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
      ORDER BY table_name, ordinal_position;
    `);

    const tables = {};
    for (const row of res.rows) {
      if (!tables[row.table_name]) tables[row.table_name] = [];
      tables[row.table_name].push(`${row.column_name} (${row.data_type})`);
    }

    for (const [table, cols] of Object.entries(tables)) {
      console.log(`\nTable: ${table}`);
      console.log('  ' + cols.join(', '));
    }

    const counts = await pool.query(`
      SELECT 'users' as tbl, count(*) as count FROM users
      UNION ALL SELECT 'products', count(*) FROM products
      UNION ALL SELECT 'categories', count(*) FROM categories
      UNION ALL SELECT 'sales', count(*) FROM sales
      UNION ALL SELECT 'sale_items', count(*) FROM sale_items
      UNION ALL SELECT 'stock_transactions', count(*) FROM stock_transactions
      UNION ALL SELECT 'suppliers', count(*) FROM suppliers
      UNION ALL SELECT 'purchase_orders', count(*) FROM purchase_orders
      UNION ALL SELECT 'purchase_order_items', count(*) FROM purchase_order_items
      UNION ALL SELECT 'orders', count(*) FROM orders
      UNION ALL SELECT 'order_items', count(*) FROM order_items
      UNION ALL SELECT 'user_activity', count(*) FROM user_activity
      UNION ALL SELECT 'notifications', count(*) FROM notifications;
    `);
    console.log('\nRow Counts:');
    console.table(counts.rows);

    await pool.end();
  } catch (err) {
    console.error('Error checking schema:', err);
    process.exit(1);
  }
}

checkSchema();
