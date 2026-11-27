import 'dotenv/config';
import { pool } from '../config/db.js';
import bcrypt from 'bcryptjs';
import { fileURLToPath } from 'url';

export async function seedDatabase() {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Clear existing data in correct FK dependency order
    await client.query('DELETE FROM user_activity');
    await client.query('DELETE FROM notifications');
    await client.query('DELETE FROM stock_transactions');
    await client.query('DELETE FROM purchase_order_items');
    await client.query('DELETE FROM purchase_orders');
    await client.query('DELETE FROM sale_items');
    await client.query('DELETE FROM sales');
    await client.query('DELETE FROM order_items');
    await client.query('DELETE FROM orders');
    await client.query('DELETE FROM products');
    await client.query('DELETE FROM categories');
    await client.query('DELETE FROM suppliers');
    await client.query('DELETE FROM role_permissions');
    await client.query('DELETE FROM users');
    await client.query('DELETE FROM permissions');
    await client.query('DELETE FROM roles');

    // 1. Roles
    const rolesData = [
      { name: 'owner', label: 'Owner', description: 'Full system access' },
      { name: 'product', label: 'Product Manager', description: 'Can manage products' },
      { name: 'sales', label: 'Sales Manager', description: 'Can create sales' },
      { name: 'stock', label: 'Stock Manager', description: 'Can manage stock' },
      { name: 'purchase', label: 'Purchase Manager', description: 'Can manage purchases' },
      { name: 'orders', label: 'Order Manager', description: 'Can manage orders' },
    ];

    const roleMap = {};
    for (const r of rolesData) {
      const res = await client.query(
        `INSERT INTO roles (id, name, label, description)
         VALUES (gen_random_uuid(), $1, $2, $3)
         RETURNING id, name`,
        [r.name, r.label, r.description]
      );
      roleMap[res.rows[0].name] = res.rows[0].id;
    }

    // 2. Permissions
    const permNames = [
      'users.view', 'users.create', 'users.update', 'users.role', 'users.status', 'users.reset',
      'products.view', 'products.create', 'products.update', 'products.delete',
      'categories.view', 'categories.create', 'categories.update',
      'stock.view', 'stock.create', 'stock.update', 'stock.adjust',
      'purchases.view', 'purchases.create', 'purchases.update', 'purchases.receive',
      'sales.view', 'sales.create', 'sales.update',
      'orders.view', 'orders.create', 'orders.update', 'orders.status',
      'analytics.view', 'reports.generate',
      'profile.update', 'settings.manage',
      'activity.view', 'activity.view.all', 'notifications.view', 'notifications.mark_read',
      'products.update.owner'
    ];

    const permMap = {};
    for (const name of permNames) {
      const parts = name.split('.');
      const res = await client.query(
        `INSERT INTO permissions (id, name, description, module, action)
         VALUES (gen_random_uuid(), $1, $2, $3, $4)
         RETURNING id, name`,
        [name, `Permission for ${name}`, parts[0], parts[1] || 'manage']
      );
      permMap[res.rows[0].name] = res.rows[0].id;
    }

    // Assign permissions to roles
    // Owner: all permissions
    for (const pName of permNames) {
      if (permMap[pName]) {
        await client.query(
          `INSERT INTO role_permissions (role_id, permission_id, granted) VALUES ($1, $2, true)`,
          [roleMap['owner'], permMap[pName]]
        );
      }
    }

    // Product Manager
    const productPerms = [
      'products.view', 'products.create', 'products.update',
      'categories.view', 'categories.create', 'categories.update',
      'analytics.view', 'reports.generate', 'notifications.view', 'profile.update', 'settings.manage'
    ];
    for (const p of productPerms) {
      if (permMap[p]) {
        await client.query(
          `INSERT INTO role_permissions (role_id, permission_id, granted) VALUES ($1, $2, true)`,
          [roleMap['product'], permMap[p]]
        );
      }
    }

    // Sales Manager
    const salesPerms = [
      'sales.view', 'sales.create', 'sales.update',
      'analytics.view', 'reports.generate', 'notifications.view', 'profile.update', 'settings.manage'
    ];
    for (const p of salesPerms) {
      if (permMap[p]) {
        await client.query(
          `INSERT INTO role_permissions (role_id, permission_id, granted) VALUES ($1, $2, true)`,
          [roleMap['sales'], permMap[p]]
        );
      }
    }

    // Stock Manager
    const stockPerms = [
      'stock.view', 'stock.create', 'stock.update', 'stock.adjust',
      'analytics.view', 'reports.generate', 'notifications.view', 'profile.update', 'settings.manage'
    ];
    for (const p of stockPerms) {
      if (permMap[p]) {
        await client.query(
          `INSERT INTO role_permissions (role_id, permission_id, granted) VALUES ($1, $2, true)`,
          [roleMap['stock'], permMap[p]]
        );
      }
    }

    // Purchase Manager
    const purchasePerms = [
      'purchases.view', 'purchases.create', 'purchases.update', 'purchases.receive',
      'analytics.view', 'reports.generate', 'notifications.view', 'profile.update', 'settings.manage'
    ];
    for (const p of purchasePerms) {
      if (permMap[p]) {
        await client.query(
          `INSERT INTO role_permissions (role_id, permission_id, granted) VALUES ($1, $2, true)`,
          [roleMap['purchase'], permMap[p]]
        );
      }
    }

    // Order Manager
    const orderPerms = [
      'orders.view', 'orders.create', 'orders.update', 'orders.status',
      'analytics.view', 'reports.generate', 'notifications.view', 'profile.update', 'settings.manage'
    ];
    for (const p of orderPerms) {
      if (permMap[p]) {
        await client.query(
          `INSERT INTO role_permissions (role_id, permission_id, granted) VALUES ($1, $2, true)`,
          [roleMap['orders'], permMap[p]]
        );
      }
    }

    // 3. Users with valid deterministic UUIDs
    const USER_IDS = {
      owner: '11111111-1111-4111-8111-111111111111',
      product: '22222222-2222-4222-8222-222222222222',
      sales: '33333333-3333-4333-8333-333333333333',
      stock: '44444444-4444-4444-8444-444444444444',
      purchase: '55555555-5555-4555-8555-555555555555',
      orders: '66666666-6666-4666-8666-666666666666',
    };

    const usersData = [
      { id: USER_IDS.owner, name: 'System Owner', email: 'owner@inventory.com', pass: 'Owner@123', role: 'owner', phone: '+91 98765 43210' },
      { id: USER_IDS.product, name: 'Product Manager', email: 'product@inventory.com', pass: 'Product@123', role: 'product', phone: '+91 98765 43211' },
      { id: USER_IDS.sales, name: 'Sales Manager', email: 'sales@inventory.com', pass: 'Sales@123', role: 'sales', phone: '+91 98765 43212' },
      { id: USER_IDS.stock, name: 'Stock Manager', email: 'stock@inventory.com', pass: 'Stock@123', role: 'stock', phone: '+91 98765 43213' },
      { id: USER_IDS.purchase, name: 'Purchase Manager', email: 'purchase@inventory.com', pass: 'Purchase@123', role: 'purchase', phone: '+91 98765 43214' },
      { id: USER_IDS.orders, name: 'Order Manager', email: 'orders@inventory.com', pass: 'Orders@123', role: 'orders', phone: '+91 98765 43215' },
    ];

    for (const u of usersData) {
      const hash = await bcrypt.hash(u.pass, 12);
      await client.query(
        `INSERT INTO users (id, name, email, password, role, status, phone, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'active', $6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [u.id, u.name, u.email, hash, u.role, u.phone]
      );
    }

    // 4. Categories
    const categoriesData = [
      { name: 'Electronics', description: 'Electronic devices and accessories' },
      { name: 'Accessories', description: 'Computer and phone accessories' },
      { name: 'Furniture', description: 'Office and home furniture' },
      { name: 'Office', description: 'Office supplies and equipment' },
      { name: 'Storage', description: 'Storage and organization solutions' },
    ];

    const catMap = {};
    for (const c of categoriesData) {
      const res = await client.query(
        `INSERT INTO categories (id, name, description, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         RETURNING id, name`,
        [c.name, c.description]
      );
      catMap[res.rows[0].name] = res.rows[0].id;
    }

    // 5. Products
    const productsData = [
      { name: 'Aurora Desk Lamp', sku: 'ELEC-1001', category: 'Electronics', price: 68, quantity: 42, minLevel: 10 },
      { name: 'Vertex Wireless Mouse', sku: 'ACC-2001', category: 'Accessories', price: 29.5, quantity: 8, minLevel: 10 },
      { name: 'Nimbus Mechanical Keyboard', sku: 'ACC-2002', category: 'Accessories', price: 89, quantity: 0, minLevel: 8 },
      { name: 'Solstice 27" Monitor', sku: 'ELEC-1002', category: 'Electronics', price: 319, quantity: 23, minLevel: 6 },
      { name: 'Orbit USB-C Hub', sku: 'ACC-2003', category: 'Accessories', price: 54, quantity: 15, minLevel: 12 },
      { name: 'Timber Standing Desk', sku: 'FURN-3001', category: 'Furniture', price: 549, quantity: 7, minLevel: 5 },
      { name: 'Halo Ergonomic Chair', sku: 'FURN-3002', category: 'Furniture', price: 279, quantity: 12, minLevel: 8 },
      { name: 'Vault Filing Cabinet', sku: 'STOR-4001', category: 'Storage', price: 199, quantity: 4, minLevel: 6 },
      { name: 'Pinnacle Notebook Set', sku: 'OFF-5001', category: 'Office', price: 18.5, quantity: 120, minLevel: 30 },
      { name: 'Flux Gel Pens (12)', sku: 'OFF-5002', category: 'Office', price: 9.75, quantity: 210, minLevel: 40 },
    ];

    const prodMap = {};
    for (const prod of productsData) {
      const res = await client.query(
        `INSERT INTO products (id, name, sku, category_id, price, quantity, min_level, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         RETURNING id, name`,
        [prod.name, prod.sku, catMap[prod.category], prod.price, prod.quantity, prod.minLevel]
      );
      prodMap[res.rows[0].name] = res.rows[0].id;
    }

    // 6. Suppliers
    const suppliersData = [
      { name: 'TechSupply Co.', contact: 'John Smith', email: 'contact@techsupply.com', phone: '+91 98765 43220', address: '123 Tech Park, Bangalore' },
      { name: 'OfficeMart India', contact: 'Priya Patel', email: 'sales@officemart.com', phone: '+91 98765 43221', address: '456 Office Ave, Mumbai' },
      { name: 'FurnitureWorld', contact: 'Rajesh Kumar', email: 'info@furnitureworld.com', phone: '+91 98765 43222', address: '789 Furniture Street, Delhi' },
    ];

    const supList = [];
    for (const sup of suppliersData) {
      const res = await client.query(
        `INSERT INTO suppliers (id, name, contact_person, email, phone, address, status, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         RETURNING id, name`,
        [sup.name, sup.contact, sup.email, sup.phone, sup.address]
      );
      supList.push(res.rows[0].id);
    }

    // 7. Purchase Orders & Items
    const po1 = await client.query(
      `INSERT INTO purchase_orders (id, supplier_id, total, qty_ordered, qty_received, status, date, created_by, notes, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, 3582, 8, 0, 'Pending', CURRENT_TIMESTAMP, $2, 'Office furniture restock', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       RETURNING id`,
      [supList[2] || supList[0], USER_IDS.purchase]
    );
    if (prodMap['Timber Standing Desk']) {
      await client.query(
        `INSERT INTO purchase_order_items (id, purchase_order_id, product_id, quantity, unit_price, total)
         VALUES (gen_random_uuid(), $1, $2, 5, 549, 2745)`,
        [po1.rows[0].id, prodMap['Timber Standing Desk']]
      );
    }
    if (prodMap['Halo Ergonomic Chair']) {
      await client.query(
        `INSERT INTO purchase_order_items (id, purchase_order_id, product_id, quantity, unit_price, total)
         VALUES (gen_random_uuid(), $1, $2, 3, 279, 837)`,
        [po1.rows[0].id, prodMap['Halo Ergonomic Chair']]
      );
    }

    const po2 = await client.query(
      `INSERT INTO purchase_orders (id, supplier_id, total, qty_ordered, qty_received, status, date, created_by, notes, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, 1700, 25, 12, 'Partially Received', CURRENT_TIMESTAMP, $2, 'Lamps delivery', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       RETURNING id`,
      [supList[0], USER_IDS.purchase]
    );
    if (prodMap['Aurora Desk Lamp']) {
      await client.query(
        `INSERT INTO purchase_order_items (id, purchase_order_id, product_id, quantity, unit_price, total)
         VALUES (gen_random_uuid(), $1, $2, 25, 68, 1700)`,
        [po2.rows[0].id, prodMap['Aurora Desk Lamp']]
      );
    }

    // 8. Sales & Items
    const sale1 = await client.query(
      `INSERT INTO sales (id, user_id, total, items_count, status, date, created_at)
       VALUES (gen_random_uuid(), $1, 97.5, 2, 'completed', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       RETURNING id`,
      [USER_IDS.sales]
    );
    if (prodMap['Aurora Desk Lamp']) {
      await client.query(
        `INSERT INTO sale_items (id, sale_id, product_id, quantity, unit_price, total)
         VALUES (gen_random_uuid(), $1, $2, 1, 68, 68)`,
        [sale1.rows[0].id, prodMap['Aurora Desk Lamp']]
      );
    }
    if (prodMap['Vertex Wireless Mouse']) {
      await client.query(
        `INSERT INTO sale_items (id, sale_id, product_id, quantity, unit_price, total)
         VALUES (gen_random_uuid(), $1, $2, 1, 29.5, 29.5)`,
        [sale1.rows[0].id, prodMap['Vertex Wireless Mouse']]
      );
    }

    // 9. Orders & Items
    const order1 = await client.query(
      `INSERT INTO orders (id, customer, total, status, date, created_by, notes, created_at, updated_at)
       VALUES (gen_random_uuid(), 'Acme Corp', 165.5, 'new', CURRENT_TIMESTAMP, $1, 'Express delivery', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       RETURNING id`,
      [USER_IDS.orders]
    );
    if (prodMap['Aurora Desk Lamp']) {
      await client.query(
        `INSERT INTO order_items (id, order_id, product_id, quantity, unit_price, total)
         VALUES (gen_random_uuid(), $1, $2, 2, 68, 136)`,
        [order1.rows[0].id, prodMap['Aurora Desk Lamp']]
      );
    }
    if (prodMap['Vertex Wireless Mouse']) {
      await client.query(
        `INSERT INTO order_items (id, order_id, product_id, quantity, unit_price, total)
         VALUES (gen_random_uuid(), $1, $2, 1, 29.5, 29.5)`,
        [order1.rows[0].id, prodMap['Vertex Wireless Mouse']]
      );
    }

    // 10. Stock Transactions
    if (prodMap['Aurora Desk Lamp']) {
      await client.query(
        `INSERT INTO stock_transactions (id, product_id, type, quantity, previous_quantity, new_quantity, reason, user_id, date, created_at)
         VALUES (gen_random_uuid(), $1, 'in', 50, 0, 50, 'Initial opening stock', $2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [prodMap['Aurora Desk Lamp'], USER_IDS.stock]
      );
      await client.query(
        `INSERT INTO stock_transactions (id, product_id, type, quantity, previous_quantity, new_quantity, reason, user_id, date, created_at)
         VALUES (gen_random_uuid(), $1, 'out', 8, 50, 42, 'Customer orders dispatched', $2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [prodMap['Aurora Desk Lamp'], USER_IDS.stock]
      );
    }

    // 11. Notifications
    await client.query(
      `INSERT INTO notifications (id, user_id, title, message, type, related_id, related_type, read, created_at)
       VALUES (gen_random_uuid(), $1, 'Low Stock Alert', 'Nimbus Mechanical Keyboard is out of stock', 'low_stock', NULL, 'product', false, CURRENT_TIMESTAMP)`,
      [USER_IDS.stock]
    );
    await client.query(
      `INSERT INTO notifications (id, user_id, title, message, type, related_id, related_type, read, created_at)
       VALUES (gen_random_uuid(), $1, 'New Purchase Order', 'Purchase order for desk lamps created', 'order', NULL, 'purchase_order', false, CURRENT_TIMESTAMP)`,
      [USER_IDS.purchase]
    );

    // 12. User Activity
    const activities = [
      { userId: USER_IDS.owner, action: 'Initialized system roles and permissions', module: 'System' },
      { userId: USER_IDS.product, action: 'Added product Aurora Desk Lamp', module: 'Products' },
      { userId: USER_IDS.sales, action: 'Recorded sale #SALE-001', module: 'Sales' },
      { userId: USER_IDS.stock, action: 'Stock-in: 50 units Aurora Desk Lamp', module: 'Stock' },
      { userId: USER_IDS.purchase, action: 'Created purchase order for office furniture', module: 'Purchase' },
      { userId: USER_IDS.orders, action: 'Received new order from Acme Corp', module: 'Orders' },
    ];

    for (const act of activities) {
      await client.query(
        `INSERT INTO user_activity (id, user_id, action, module, details, ip, user_agent, created_at)
         VALUES (gen_random_uuid(), $1, $2, $3, '{}', '127.0.0.1', 'System/1.0', CURRENT_TIMESTAMP)`,
        [act.userId, act.action, act.module]
      );
    }

    await client.query('COMMIT');

    console.log('✅ Database seeded successfully!');
    console.log('👥 Demo accounts ready:');
    console.log('   - Owner:    owner@inventory.com    / Owner@123');
    console.log('   - Product:  product@inventory.com  / Product@123');
    console.log('   - Sales:    sales@inventory.com    / Sales@123');
    console.log('   - Stock:    stock@inventory.com    / Stock@123');
    console.log('   - Purchase: purchase@inventory.com / Purchase@123');
    console.log('   - Orders:   orders@inventory.com   / Orders@123');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Error seeding database:', error);
    throw error;
  } finally {
    client.release();
  }
}

// Run seed if executed directly
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  seedDatabase()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
