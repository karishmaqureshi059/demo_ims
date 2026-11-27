import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

const { pool } = await import('../config/db.js');

async function seedMissing() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Get existing user IDs
    const usersRes = await client.query('SELECT id, role, email FROM users');
    const userMap = {};
    for (const u of usersRes.rows) {
      userMap[u.role] = u.id;
    }
    console.log('Found users:', userMap);

    // 2. Categories
    const categoriesData = [
      { name: 'Electronics', description: 'Electronic devices and accessories' },
      { name: 'Accessories', description: 'Computer and phone accessories' },
      { name: 'Furniture', description: 'Office and home furniture' },
      { name: 'Office', description: 'Office supplies and equipment' },
      { name: 'Storage', description: 'Storage and organization solutions' },
    ];

    const catMap = {};
    for (const c of categoriesData) {
      let res = await client.query('SELECT id, name FROM categories WHERE name = $1', [c.name]);
      if (res.rows.length === 0) {
        res = await client.query(
          `INSERT INTO categories (id, name, description, created_at, updated_at)
           VALUES (gen_random_uuid(), $1, $2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
           RETURNING id, name`,
          [c.name, c.description]
        );
      }
      catMap[res.rows[0].name] = res.rows[0].id;
    }
    console.log('Categories ready:', Object.keys(catMap).length);

    // 3. Products
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
      { name: 'Nexus Laptop Sleeve', sku: 'ACC-2004', category: 'Accessories', price: 39, quantity: 26, minLevel: 10 },
      { name: 'Prism HD Webcam', sku: 'ELEC-1003', category: 'Electronics', price: 74, quantity: 18, minLevel: 8 },
      { name: 'Echo Conference Speaker', sku: 'ELEC-1004', category: 'Electronics', price: 129, quantity: 0, minLevel: 5 },
      { name: 'Atlas Storage Bin', sku: 'STOR-4002', category: 'Storage', price: 24, quantity: 64, minLevel: 20 },
      { name: 'Summit Whiteboard', sku: 'OFF-5003', category: 'Office', price: 145, quantity: 9, minLevel: 4 },
      { name: 'Drift Ergonomic Footrest', sku: 'FURN-3003', category: 'Furniture', price: 59, quantity: 3, minLevel: 6 },
      { name: 'Photon Power Bank', sku: 'ELEC-1005', category: 'Electronics', price: 42, quantity: 55, minLevel: 15 },
      { name: 'Anchor Cable Organizer', sku: 'ACC-2005', category: 'Accessories', price: 14, quantity: 31, minLevel: 12 },
      { name: 'Cedar Desk Organizer', sku: 'OFF-5004', category: 'Office', price: 32, quantity: 6, minLevel: 8 },
      { name: 'Meridian Monitor Arm', sku: 'FURN-3004', category: 'Furniture', price: 115, quantity: 14, minLevel: 6 },
      { name: 'Bunker Archive Box', sku: 'STOR-4003', category: 'Storage', price: 11, quantity: 88, minLevel: 25 },
      { name: 'Lumina LED Strip', sku: 'ELEC-1006', category: 'Electronics', price: 27, quantity: 19, minLevel: 10 },
    ];

    const prodMap = {};
    for (const prod of productsData) {
      let res = await client.query('SELECT id, name FROM products WHERE sku = $1', [prod.sku]);
      if (res.rows.length === 0) {
        res = await client.query(
          `INSERT INTO products (id, name, sku, category_id, price, quantity, min_level, created_at, updated_at)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
           RETURNING id, name`,
          [prod.name, prod.sku, catMap[prod.category], prod.price, prod.quantity, prod.minLevel]
        );
      }
      prodMap[res.rows[0].name] = res.rows[0].id;
    }
    console.log('Products ready:', Object.keys(prodMap).length);

    // 4. Suppliers
    const suppliersData = [
      { name: 'Northwind Supply Co.', contact: 'Laura Simmons', email: 'laura@northwindsupply.com', phone: '+91 98765 43225', address: '12 Northwind Way, Bangalore' },
      { name: 'Meridian Wholesale', contact: 'Victor Hale', email: 'victor@meridianwholesale.com', phone: '+91 98765 43226', address: '45 Meridian Blvd, Mumbai' },
      { name: 'Harbor Goods', contact: 'Nina Park', email: 'nina@harborgoods.com', phone: '+91 98765 43227', address: '78 Harbor Lane, Chennai' },
      { name: 'Brightline Imports', contact: 'Omar Haddad', email: 'omar@brightlineimports.com', phone: '+91 98765 43228', address: '90 Brightline Rd, Delhi' },
      { name: 'Summit Distribution', contact: 'Ruth Alvarez', email: 'ruth@summitdistribution.com', phone: '+91 98765 43229', address: '101 Summit Park, Pune' },
      { name: 'Cedar & Co.', contact: 'Peter Lindqvist', email: 'peter@cedarandco.com', phone: '+91 98765 43230', address: '22 Cedar Avenue, Hyderabad' },
      { name: 'Atlas Trade Partners', contact: 'Amara Okafor', email: 'amara@atlastrade.com', phone: '+91 98765 43231', address: '33 Atlas Street, Kolkata' },
      { name: 'Vertex Sourcing', contact: 'Kenji Mori', email: 'kenji@vertexsourcing.com', phone: '+91 98765 43232', address: '55 Vertex Plaza, Ahmedabad' },
    ];

    const supMap = {};
    for (const sup of suppliersData) {
      let res = await client.query('SELECT id, name FROM suppliers WHERE name = $1', [sup.name]);
      if (res.rows.length === 0) {
        res = await client.query(
          `INSERT INTO suppliers (id, name, contact_person, email, phone, address, status, created_at, updated_at)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
           RETURNING id, name`,
          [sup.name, sup.contact, sup.email, sup.phone, sup.address]
        );
      }
      supMap[res.rows[0].name] = res.rows[0].id;
    }
    console.log('Suppliers ready:', Object.keys(supMap).length);

    // 5. Purchase Orders
    const existingPOs = await client.query('SELECT count(*) FROM purchase_orders');
    if (Number(existingPOs.rows[0].count) === 0) {
      const supNames = Object.keys(supMap);
      const purchaseUser = userMap['purchase'] || userMap['owner'];
      const poData = [
        { supplier: supNames[0], total: 2450, qtyOrdered: 40, qtyReceived: 40, status: 'Received' },
        { supplier: supNames[1], total: 1890, qtyOrdered: 30, qtyReceived: 12, status: 'Partially Received' },
        { supplier: supNames[2], total: 980, qtyOrdered: 20, qtyReceived: 0, status: 'Pending' },
        { supplier: supNames[3], total: 1315.5, qtyOrdered: 15, qtyReceived: 15, status: 'Received' },
        { supplier: supNames[4], total: 1675, qtyOrdered: 25, qtyReceived: 10, status: 'Partially Received' },
        { supplier: supNames[5], total: 2840, qtyOrdered: 50, qtyReceived: 0, status: 'Pending' },
        { supplier: supNames[6], total: 748.25, qtyOrdered: 12, qtyReceived: 12, status: 'Received' },
        { supplier: supNames[7], total: 1125, qtyOrdered: 18, qtyReceived: 0, status: 'Pending' },
      ];

      for (const po of poData) {
        const poRes = await client.query(
          `INSERT INTO purchase_orders (id, supplier_id, total, qty_ordered, qty_received, status, date, created_by, notes, created_at, updated_at)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, CURRENT_TIMESTAMP, $6, 'Stock replenishment', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
           RETURNING id`,
          [supMap[po.supplier], po.total, po.qtyOrdered, po.qtyReceived, po.status, purchaseUser]
        );

        if (prodMap['Aurora Desk Lamp']) {
          await client.query(
            `INSERT INTO purchase_order_items (id, purchase_order_id, product_id, quantity, unit_price, total)
             VALUES (gen_random_uuid(), $1, $2, $3, $4, $5)`,
            [poRes.rows[0].id, prodMap['Aurora Desk Lamp'], po.qtyOrdered, Math.round(po.total / po.qtyOrdered), po.total]
          );
        }
      }
      console.log('Purchase orders seeded:', poData.length);
    }

    // 6. Sales
    const existingSales = await client.query('SELECT count(*) FROM sales');
    if (Number(existingSales.rows[0].count) === 0) {
      const salesUser = userMap['sales'] || userMap['owner'];
      const salesData = [
        { total: 486.5, itemsCount: 4, status: 'completed' },
        { total: 138.0, itemsCount: 2, status: 'completed' },
        { total: 274.25, itemsCount: 3, status: 'completed' },
        { total: 319.0, itemsCount: 1, status: 'completed' },
        { total: 542.75, itemsCount: 6, status: 'completed' },
        { total: 107.5, itemsCount: 2, status: 'completed' },
        { total: 617.0, itemsCount: 5, status: 'completed' },
        { total: 196.25, itemsCount: 3, status: 'completed' },
        { total: 358.0, itemsCount: 4, status: 'completed' },
        { total: 249.5, itemsCount: 2, status: 'completed' },
      ];

      for (const s of salesData) {
        const saleRes = await client.query(
          `INSERT INTO sales (id, user_id, total, items_count, status, date, created_at)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
           RETURNING id`,
          [salesUser, s.total, s.itemsCount, s.status]
        );

        if (prodMap['Aurora Desk Lamp']) {
          await client.query(
            `INSERT INTO sale_items (id, sale_id, product_id, quantity, unit_price, total)
             VALUES (gen_random_uuid(), $1, $2, 1, 68, 68)`,
            [saleRes.rows[0].id, prodMap['Aurora Desk Lamp']]
          );
        }
      }
      console.log('Sales seeded:', salesData.length);
    }

    // 7. Stock Transactions
    const existingStock = await client.query('SELECT count(*) FROM stock_transactions');
    if (Number(existingStock.rows[0].count) === 0) {
      const stockUser = userMap['stock'] || userMap['owner'];
      const stockData = [
        { prod: 'Aurora Desk Lamp', type: 'in', qty: 24, prev: 18, next: 42, reason: 'Shipment received' },
        { prod: 'Nimbus Mechanical Keyboard', type: 'out', qty: 6, prev: 6, next: 0, reason: 'Dispatched to customer' },
        { prod: 'Pinnacle Notebook Set', type: 'out', qty: 18, prev: 138, next: 120, reason: 'Bulk office order' },
        { prod: 'Vertex Wireless Mouse', type: 'out', qty: 12, prev: 20, next: 8, reason: 'Sold in retail order' },
        { prod: 'Solstice 27" Monitor', type: 'in', qty: 10, prev: 13, next: 23, reason: 'Vendor shipment' },
        { prod: 'Vault Filing Cabinet', type: 'adjustment', qty: 3, prev: 7, next: 4, reason: 'Cycle count physical adjustment' },
        { prod: 'Flux Gel Pens (12)', type: 'in', qty: 60, prev: 150, next: 210, reason: 'Restock batch' },
      ];

      for (const st of stockData) {
        if (prodMap[st.prod]) {
          await client.query(
            `INSERT INTO stock_transactions (id, product_id, type, quantity, previous_quantity, new_quantity, reason, user_id, date, created_at)
             VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
            [prodMap[st.prod], st.type, st.qty, st.prev, st.next, st.reason, stockUser]
          );
        }
      }
      console.log('Stock transactions seeded:', stockData.length);
    }

    // 8. Notifications
    const existingNotifs = await client.query('SELECT count(*) FROM notifications');
    if (Number(existingNotifs.rows[0].count) === 0) {
      const stockUser = userMap['stock'] || userMap['owner'];
      const purchaseUser = userMap['purchase'] || userMap['owner'];
      const notifs = [
        { userId: stockUser, title: 'Low Stock Alert', message: 'Nimbus Mechanical Keyboard is out of stock (0 units remaining)', type: 'low_stock' },
        { userId: stockUser, title: 'Low Stock Alert', message: 'Timber Standing Desk is below minimum level (7 units remaining)', type: 'low_stock' },
        { userId: purchaseUser, title: 'Pending Order', message: 'Purchase order for Northwind Supply Co. has been pending for 3 days', type: 'order' },
      ];

      for (const n of notifs) {
        await client.query(
          `INSERT INTO notifications (id, user_id, title, message, type, related_type, read, created_at)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, 'product', false, CURRENT_TIMESTAMP)`,
          [n.userId, n.title, n.message, n.type]
        );
      }
      console.log('Notifications seeded:', notifs.length);
    }

    await client.query('COMMIT');
    console.log('All missing module data seeded successfully!');
    await pool.end();
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Seeding failed:', err);
    process.exit(1);
  } finally {
    client.release();
  }
}

seedMissing();
