import { pool } from '../config/db.js';

// User models
export async function findUserByEmail(email) {
  if (!email) return null;
  const result = await pool.query('SELECT * FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1', [String(email).trim()]);
  return result.rows[0] || null;
}

export async function findUserById(id) {
  if (!id) return null;
  const result = await pool.query('SELECT * FROM users WHERE id::text = $1 LIMIT 1', [String(id)]);
  return result.rows[0] || null;
}

export async function createUser(userData) {
  const result = await pool.query(
    `INSERT INTO users (id, name, email, password, role, status, phone, avatar, photo, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     RETURNING id, name, email, role, status, phone, avatar, photo, created_at`,
    [
      userData.id,
      userData.name,
      userData.email,
      userData.password,
      userData.role,
      userData.status || 'active',
      userData.phone,
      userData.avatar,
      userData.photo,
    ]
  );
  return result.rows[0];
}

export async function updateUser(id, userData) {
  const result = await pool.query(
    `UPDATE users 
     SET name = $1, email = $2, phone = $3, avatar = $4, photo = $5, role = $6, status = $7, updated_at = CURRENT_TIMESTAMP
     WHERE id = $8
     RETURNING id, name, email, role, status, phone, avatar, photo, updated_at`,
    [
      userData.name,
      userData.email,
      userData.phone,
      userData.avatar,
      userData.photo,
      userData.role,
      userData.status,
      id,
    ]
  );
  return result.rows[0];
}

export async function updateUserRole(id, role) {
  const result = await pool.query(
    `UPDATE users SET role = $1, session_version = COALESCE(session_version, 1) + 1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING id, name, email, role, status, session_version, updated_at`,
    [role, id]
  );
  return result.rows[0];
}

export async function updateUserStatus(id, status) {
  const result = await pool.query(
    `UPDATE users SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING id, name, email, role, status, updated_at`,
    [status, id]
  );
  return result.rows[0];
}

export async function resetUserPassword(id, newPassword) {
  const hashedPassword = await hashPassword(newPassword);
  const result = await pool.query(
    `UPDATE users SET password = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING id, name, email, role, status, updated_at`,
    [hashedPassword, id]
  );
  return result.rows[0];
}

export async function findUserByLogin(identifier) {
  if (!identifier) return null;
  const result = await pool.query(
    `SELECT * FROM users 
     WHERE LOWER(email) = LOWER($1) 
        OR LOWER(name) = LOWER($1) 
     LIMIT 1`,
    [String(identifier).trim()]
  );
  return result.rows[0] || null;
}

// Category models
export async function getAllCategories() {
  const result = await pool.query('SELECT * FROM categories ORDER BY name');
  return result.rows;
}

export async function getCategoryById(id) {
  const result = await pool.query('SELECT * FROM categories WHERE id = $1', [id]);
  return result.rows[0];
}

export async function createCategory(categoryData) {
  const result = await pool.query(
    `INSERT INTO categories (id, name, description, parent_id, created_at, updated_at)
     VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     RETURNING *`,
    [
      categoryData.id,
      categoryData.name,
      categoryData.description,
      categoryData.parentId,
    ]
  );
  return result.rows[0];
}

export async function updateCategory(id, categoryData) {
  const result = await pool.query(
    `UPDATE categories SET name = $1, description = $2, parent_id = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $4 RETURNING *`,
    [categoryData.name, categoryData.description, categoryData.parentId, id]
  );
  return result.rows[0];
}

export async function deleteCategory(id) {
  const result = await pool.query('DELETE FROM categories WHERE id = $1 RETURNING *', [id]);
  return result.rows[0];
}

// Product models
export async function getAllProducts(filters = {}) {
  let query = `SELECT p.*, c.name as category_name, 
                   CASE WHEN p.quantity <= 0 THEN 'Out of Stock'
                        WHEN p.quantity <= p.min_level THEN 'Low Stock'
                        ELSE 'In Stock' END as status
            FROM products p
            LEFT JOIN categories c ON p.category_id = c.id`;
  const params = [];
  let paramCount = 1;

  if (filters.category) {
    query += ` WHERE p.category_id = $${paramCount}`;
    paramCount++;
  }

  if (filters.status) {
    if (filters.category) query += ` AND `;
    else query += ` WHERE `;
    query += `CASE WHEN p.quantity <= 0 THEN 'Out of Stock'
                     WHEN p.quantity <= p.min_level THEN 'Low Stock'
                     ELSE 'In Stock' END = $${paramCount}`;
    paramCount++;
  }

  if (filters.search) {
    if (query.includes('WHERE')) query += ` AND `;
    else query += ` WHERE `;
    query += `(p.name ILIKE $${paramCount} OR p.sku ILIKE $${paramCount})`;
    paramCount++;
  }

  query += ` ORDER BY p.name`;

  const result = await pool.query(query, params);
  return result.rows;
}

export async function getProductById(id) {
  if (!id) return null;
  const result = await pool.query(
    `SELECT p.*, c.name as category_name 
     FROM products p LEFT JOIN categories c ON p.category_id = c.id 
     WHERE p.id::text = $1`,
    [String(id)]
  );
  return result.rows[0] || null;
}

export async function createProduct(productData) {
  const result = await pool.query(
    `INSERT INTO products (id, name, sku, category_id, price, quantity, min_level, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     RETURNING *`,
    [
      productData.id,
      productData.name,
      productData.sku,
      productData.categoryId,
      productData.price,
      productData.quantity,
      productData.minLevel,
    ]
  );
  return result.rows[0];
}

export async function updateProduct(id, productData) {
  const result = await pool.query(
    `UPDATE products SET name = $1, sku = $2, category_id = $3, price = $4, quantity = $5, min_level = $6, updated_at = CURRENT_TIMESTAMP WHERE id = $7 RETURNING *`,
    [productData.name, productData.sku, productData.categoryId, productData.price, productData.quantity, productData.minLevel, id]
  );
  return result.rows[0];
}

export async function deleteProduct(id) {
  const result = await pool.query('DELETE FROM products WHERE id = $1 RETURNING *', [id]);
  return result.rows[0];
}

export async function getProductsByCategory(categoryId) {
  const result = await pool.query('SELECT * FROM products WHERE category_id = $1 ORDER BY name', [categoryId]);
  return result.rows;
}

// Supplier models
export async function getAllSuppliers() {
  const result = await pool.query('SELECT * FROM suppliers ORDER BY name');
  return result.rows;
}

export async function getSupplierById(id) {
  const result = await pool.query('SELECT * FROM suppliers WHERE id = $1', [id]);
  return result.rows[0];
}

export async function createSupplier(supplierData) {
  const result = await pool.query(
    `INSERT INTO suppliers (id, name, contact_person, email, phone, address, status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     RETURNING *`,
    [
      supplierData.id,
      supplierData.name,
      supplierData.contactPerson,
      supplierData.email,
      supplierData.phone,
      supplierData.address,
      supplierData.status || 'active',
    ]
  );
  return result.rows[0];
}

export async function updateSupplier(id, supplierData) {
  const result = await pool.query(
    `UPDATE suppliers SET name = $1, contact_person = $2, email = $3, phone = $4, address = $5, status = $6, updated_at = CURRENT_TIMESTAMP WHERE id = $7 RETURNING *`,
    [supplierData.name, supplierData.contactPerson, supplierData.email, supplierData.phone, supplierData.address, supplierData.status, id]
  );
  return result.rows[0];
}

// Purchase Order models
export async function getAllPurchaseOrders(filters = {}) {
  let query = `SELECT po.*, s.name as supplier_name 
               FROM purchase_orders po
               LEFT JOIN suppliers s ON po.supplier_id = s.id`;
  const params = [];
  let paramCount = 1;

  if (filters.status) {
    query += ` WHERE po.status = $${paramCount}`;
    paramCount++;
  }

  if (filters.supplierId) {
    if (query.includes('WHERE')) query += ` AND `;
    else query += ` WHERE `;
    query += `po.supplier_id = $${paramCount}`;
    paramCount++;
  }

  query += ` ORDER BY po.date DESC`;

  const result = await pool.query(query, params);
  return result.rows;
}

export async function getPurchaseOrderById(id) {
  const result = await pool.query(
    `SELECT po.*, s.name as supplier_name 
     FROM purchase_orders po LEFT JOIN suppliers s ON po.supplier_id = s.id 
     WHERE po.id = $1`,
    [id]
  );
  return result.rows[0];
}

export async function createPurchaseOrder(orderData) {
  const result = await pool.query(
    `INSERT INTO purchase_orders (id, supplier_id, total, qty_ordered, qty_received, status, date, created_by, notes, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     RETURNING *`,
    [
      orderData.id,
      orderData.supplierId,
      orderData.total,
      orderData.qtyOrdered,
      orderData.qtyReceived,
      orderData.status,
      orderData.createdBy,
      orderData.notes,
    ]
  );
  return result.rows[0];
}

export async function updatePurchaseOrder(id, orderData) {
  const result = await pool.query(
    `UPDATE purchase_orders SET supplier_id = $1, total = $2, qty_ordered = $3, qty_received = $4, status = $5, date = $6, notes = $7, updated_at = CURRENT_TIMESTAMP WHERE id = $8 RETURNING *`,
    [orderData.supplierId, orderData.total, orderData.qtyOrdered, orderData.qtyReceived, orderData.status, orderData.date, orderData.notes, id]
  );
  return result.rows[0];
}

// Sale models
export async function getAllSales(filters = {}) {
  let query = `SELECT s.*, u.name as salesperson_name 
               FROM sales s
               LEFT JOIN users u ON s.user_id = u.id`;
  const params = [];
  let paramCount = 1;

  if (filters.userId) {
    query += ` WHERE s.user_id = $${paramCount}`;
    paramCount++;
  }

  if (filters.status) {
    if (query.includes('WHERE')) query += ` AND `;
    else query += ` WHERE `;
    query += `s.status = $${paramCount}`;
    paramCount++;
  }

  query += ` ORDER BY s.date DESC`;

  const result = await pool.query(query, params);
  return result.rows;
}

export async function getSaleById(id) {
  const result = await pool.query(
    `SELECT s.*, u.name as salesperson_name 
     FROM sales s LEFT JOIN users u ON s.user_id = u.id 
     WHERE s.id = $1`,
    [id]
  );
  return result.rows[0];
}

export async function createSale(saleData) {
  const result = await pool.query(
    `INSERT INTO sales (id, user_id, total, items_count, status, date, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     RETURNING *`,
    [
      saleData.id,
      saleData.userId,
      saleData.total,
      saleData.itemsCount,
      saleData.status,
    ]
  );
  return result.rows[0];
}

// Order models
export async function getAllOrders(filters = {}) {
  let query = `SELECT o.*, u.name as created_by_name 
               FROM orders o
               LEFT JOIN users u ON o.created_by = u.id`;
  const params = [];
  let paramCount = 1;

  if (filters.status) {
    query += ` WHERE o.status = $${paramCount}`;
    paramCount++;
  }

  query += ` ORDER BY o.date DESC`;

  const result = await pool.query(query, params);
  return result.rows;
}

export async function getOrderById(id) {
  const result = await pool.query(
    `SELECT o.*, u.name as created_by_name 
     FROM orders o LEFT JOIN users u ON o.created_by = u.id 
     WHERE o.id = $1`,
    [id]
  );
  return result.rows[0];
}

export async function createOrder(orderData) {
  const result = await pool.query(
    `INSERT INTO orders (id, customer, total, status, date, created_by, notes, created_at, updated_at)
     VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, $5, $6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     RETURNING *`,
    [
      orderData.id,
      orderData.customer,
      orderData.total,
      orderData.status,
      orderData.createdBy,
      orderData.notes,
    ]
  );
  return result.rows[0];
}

// Stock Transaction models
export async function getStockTransactions(filters = {}) {
  let query = `SELECT st.*, u.name as user_name, p.name as product_name 
               FROM stock_transactions st
               LEFT JOIN users u ON st.user_id = u.id
               LEFT JOIN products p ON st.product_id = p.id`;
  const params = [];
  let paramCount = 1;

  if (filters.productId) {
    query += ` WHERE st.product_id = $${paramCount}`;
    paramCount++;
  }

  if (filters.type) {
    if (query.includes('WHERE')) query += ` AND `;
    else query += ` WHERE `;
    query += `st.type = $${paramCount}`;
    paramCount++;
  }

  if (filters.startDate && filters.endDate) {
    if (query.includes('WHERE')) query += ` AND `;
    else query += ` WHERE `;
    query += `st.date BETWEEN $${paramCount} AND $${paramCount + 1}`;
    paramCount += 2;
  }

  query += ` ORDER BY st.date DESC`;

  const result = await pool.query(query, params);
  return result.rows;
}

export async function createStockTransaction(transactionData) {
  const result = await pool.query(
    `INSERT INTO stock_transactions (id, product_id, type, quantity, previous_quantity, new_quantity, reason, user_id, date, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP)
     RETURNING *`,
    [
      transactionData.id,
      transactionData.productId,
      transactionData.type,
      transactionData.quantity,
      transactionData.previousQuantity,
      transactionData.newQuantity,
      transactionData.reason,
      transactionData.userId,
      transactionData.date,
    ]
  );
  return result.rows[0];
}

// Notification models
export async function getNotifications(userId, unreadOnly = false) {
  let query = `SELECT n.*, u.name as user_name FROM notifications n LEFT JOIN users u ON n.user_id = u.id`;
  const params = [];
  let paramCount = 1;

  if (unreadOnly) {
    query += ` WHERE n.read = false`;
  } else if (userId) {
    query += ` WHERE n.user_id = $${paramCount}`;
    paramCount++;
  }

  query += ` ORDER BY n.created_at DESC`;

  const result = await pool.query(query, params);
  return result.rows;
}

export async function createNotification(notificationData) {
  const result = await pool.query(
    `INSERT INTO notifications (id, user_id, title, message, type, related_id, related_type, read, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
     RETURNING *`,
    [
      notificationData.id,
      notificationData.userId,
      notificationData.title,
      notificationData.message,
      notificationData.type,
      notificationData.relatedId,
      notificationData.relatedType,
      notificationData.read,
    ]
  );
  return result.rows[0];
}

export async function markNotificationRead(notificationId) {
  const result = await pool.query(
    `UPDATE notifications SET read = true, read_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *`,
    [notificationId]
  );
  return result.rows[0];
}

// Setting models
export async function getSetting(key) {
  const result = await pool.query('SELECT * FROM settings WHERE key = $1', [key]);
  return result.rows[0];
}

export async function setSetting(key, value, updatedBy) {
  // Check if setting exists
  const existing = await getSetting(key);
  
  if (existing) {
    const result = await pool.query(
      `UPDATE settings SET value = $1, updated_by = $2, updated_at = CURRENT_TIMESTAMP WHERE key = $3 RETURNING *`,
      [value, updatedBy, key]
    );
    return result.rows[0];
  } else {
    const result = await pool.query(
      `INSERT INTO settings (id, key, value, updated_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       RETURNING *`,
      [uuidv4(), key, value, updatedBy]
    );
    return result.rows[0];
  }
}

// Helper function for UUID generation
function uuidv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}