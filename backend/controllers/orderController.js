import { pool } from '../config/db.js';
import { logActivity } from '../middleware/auth.js';
import { addNotification } from '../utils/notifications.js';

// Helper: capitalize status for frontend ('new' -> 'New')
function formatOrderStatus(status) {
  if (!status) return 'New';
  const s = String(status).trim().toLowerCase();
  if (s === 'processing') return 'Processing';
  if (s === 'completed') return 'Completed';
  if (s === 'cancelled') return 'Cancelled';
  return 'New';
}

// Helper: normalize status for database ('New' -> 'new')
function toDbOrderStatus(status) {
  if (!status) return 'new';
  const s = String(status).trim().toLowerCase();
  if (['new', 'processing', 'completed', 'cancelled'].includes(s)) {
    return s;
  }
  return 'new';
}

// Order Controller: List all orders
export async function getOrders(req, res) {
  try {
    let query = `SELECT o.*, u.name as created_by_name 
                 FROM orders o 
                 LEFT JOIN users u ON o.created_by = u.id`;
    const params = [];
    let paramCount = 1;

    if (req.query.status) {
      query += ` WHERE o.status = $${paramCount}`;
      params.push(toDbOrderStatus(req.query.status));
      paramCount++;
    }

    query += ` ORDER BY o.date DESC`;

    const result = await pool.query(query, params);

    return res.status(200).json({
      orders: result.rows.map((order) => ({
        id: order.id,
        customer: order.customer,
        total: Number(order.total) || 0,
        status: formatOrderStatus(order.status),
        date: order.date,
        createdByName: order.created_by_name,
        notes: order.notes,
      })),
    });
  } catch (error) {
    console.error('Get orders error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
}

// Order Controller: Get single order with optional items
export async function getOrder(req, res) {
  const { id } = req.params;

  if (!id) {
    return res.status(400).json({ message: 'Order ID is required.' });
  }

  try {
    const order = await pool.query(
      `SELECT o.*, u.name as created_by_name 
       FROM orders o LEFT JOIN users u ON o.created_by = u.id 
       WHERE o.id::text = $1`,
      [String(id)]
    );

    if (order.rows.length === 0) {
      return res.status(404).json({ message: 'Order not found.' });
    }

    const orderRow = order.rows[0];

    // Get order items if any
    const itemsResult = await pool.query(
      `SELECT oi.*, p.name as product_name, p.sku 
       FROM order_items oi 
       LEFT JOIN products p ON oi.product_id = p.id 
       WHERE oi.order_id::text = $1`,
      [String(id)]
    );

    return res.status(200).json({
      order: {
        id: orderRow.id,
        customer: orderRow.customer,
        total: Number(orderRow.total) || 0,
        status: formatOrderStatus(orderRow.status),
        date: orderRow.date,
        createdByName: orderRow.created_by_name,
        notes: orderRow.notes,
        items: itemsResult.rows.map((item) => ({
          id: item.id,
          productId: item.product_id,
          productName: item.product_name,
          sku: item.sku,
          quantity: Number(item.quantity) || 1,
          unitPrice: Number(item.unit_price) || 0,
          total: Number(item.total) || 0,
        })),
      },
    });
  } catch (error) {
    console.error('Get order error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
}

// Order Controller: Create new order
export async function createOrder(req, res) {
  try {
    const { id, customer, items, total, status, date, notes } = req.body;

    if (!customer || String(customer).trim() === '') {
      return res.status(400).json({ message: 'Customer name is required.' });
    }

    if (total === undefined || isNaN(Number(total)) || Number(total) < 0) {
      return res.status(400).json({ message: 'Valid total amount is required.' });
    }

    // Determine orderId: use provided id, or auto-generate next ORD-xxxx
    let orderId = id ? String(id).trim() : null;
    if (!orderId) {
      const maxRes = await pool.query(`SELECT id FROM orders WHERE id LIKE 'ORD-%'`);
      let maxNum = 5000;
      for (const row of maxRes.rows) {
        const num = parseInt(String(row.id).replace(/\D/g, ''), 10);
        if (!isNaN(num) && num > maxNum) maxNum = num;
      }
      orderId = `ORD-${maxNum + 1}`;
    }

    const dbStatus = toDbOrderStatus(status);
    const orderDate = date ? new Date(date) : new Date();
    const userId = req.user?.id || null;

    // Insert order into PostgreSQL
    const result = await pool.query(
      `INSERT INTO orders (id, customer, total, status, date, created_by, notes, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       RETURNING *`,
      [orderId, String(customer).trim(), Number(total), dbStatus, orderDate, userId, notes || '']
    );

    // If order items were passed, handle them
    if (Array.isArray(items) && items.length > 0) {
      for (const item of items) {
        if (item.productId) {
          const qty = Number(item.quantity) || 1;
          const unitPrice = Number(item.unitPrice) || 0;
          await pool.query(
            `INSERT INTO order_items (id, order_id, product_id, quantity, unit_price, total, created_at)
             VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, CURRENT_TIMESTAMP)`,
            [orderId, item.productId, qty, unitPrice, qty * unitPrice]
          );

          // Update product stock if product exists
          await pool.query(
            `UPDATE products SET quantity = GREATEST(0, quantity - $1), updated_at = CURRENT_TIMESTAMP WHERE id::text = $2`,
            [qty, String(item.productId)]
          );
        }
      }
    }

    // Log activity
    if (userId) {
      await logActivity(pool, userId, `Created order ${orderId}`, 'Orders', {
        orderId,
        customer: String(customer).trim(),
        total: Number(total),
      });
    }

    await addNotification({
      title: 'New Customer Order',
      message: `Order ${orderId} received from ${String(customer).trim()} for ₹${Number(total).toLocaleString()}`,
      type: 'order',
      relatedType: 'order',
    });

    const created = result.rows[0];
    return res.status(201).json({
      message: 'Order created successfully',
      order: {
        id: created.id,
        customer: created.customer,
        total: Number(created.total),
        status: formatOrderStatus(created.status),
        date: created.date,
        notes: created.notes,
      },
    });
  } catch (error) {
    console.error('Create order error:', error);
    return res.status(500).json({ message: error.message || 'Internal server error.' });
  }
}

// Order Controller: Update existing order
export async function updateOrder(req, res) {
  const { id } = req.params;

  if (!id) {
    return res.status(400).json({ message: 'Order ID is required.' });
  }

  try {
    const existingOrder = await pool.query('SELECT * FROM orders WHERE id::text = $1', [String(id)]);

    if (existingOrder.rows.length === 0) {
      return res.status(404).json({ message: 'Order not found.' });
    }

    const { customer, total, status, date, notes } = req.body;

    const current = existingOrder.rows[0];
    const newCustomer = customer !== undefined ? String(customer).trim() : current.customer;
    const newTotal = total !== undefined && !isNaN(Number(total)) ? Number(total) : Number(current.total);
    const newStatus = status !== undefined ? toDbOrderStatus(status) : current.status;
    const newDate = date ? new Date(date) : current.date;
    const newNotes = notes !== undefined ? notes : current.notes;

    const result = await pool.query(
      `UPDATE orders 
       SET customer = $1, total = $2, status = $3, date = $4, notes = $5, updated_at = CURRENT_TIMESTAMP 
       WHERE id::text = $6 
       RETURNING *`,
      [newCustomer, newTotal, newStatus, newDate, newNotes, String(id)]
    );

    if (req.user?.id) {
      await logActivity(pool, req.user.id, `Updated order ${id}`, 'Orders', {
        updatedOrderId: id,
      });
    }

    const updated = result.rows[0];
    return res.status(200).json({
      message: 'Order updated successfully',
      order: {
        id: updated.id,
        customer: updated.customer,
        total: Number(updated.total),
        status: formatOrderStatus(updated.status),
        date: updated.date,
        notes: updated.notes,
      },
    });
  } catch (error) {
    console.error('Update order error:', error);
    return res.status(500).json({ message: error.message || 'Internal server error.' });
  }
}

// Order Controller: Update status
export async function updateOrderStatus(req, res) {
  const { id } = req.params;
  const { status } = req.body;

  if (!id) {
    return res.status(400).json({ message: 'Order ID is required.' });
  }

  if (!status) {
    return res.status(400).json({ message: 'Status is required.' });
  }

  const dbStatus = toDbOrderStatus(status);

  try {
    const existingOrder = await pool.query('SELECT * FROM orders WHERE id::text = $1', [String(id)]);

    if (existingOrder.rows.length === 0) {
      return res.status(404).json({ message: 'Order not found.' });
    }

    const result = await pool.query(
      `UPDATE orders SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id::text = $2 RETURNING *`,
      [dbStatus, String(id)]
    );

    if (req.user?.id) {
      await logActivity(pool, req.user.id, `Changed order ${id} status to ${status}`, 'Orders', {
        updatedOrderId: id,
        newStatus: status,
      });
    }

    await addNotification({
      title: 'Order Status Changed',
      message: `Order ${id} status changed to ${status}`,
      type: 'order',
      relatedType: 'order',
    });

    const updated = result.rows[0];
    return res.status(200).json({
      message: 'Order status updated successfully',
      order: {
        id: updated.id,
        status: formatOrderStatus(updated.status),
      },
    });
  } catch (error) {
    console.error('Update order status error:', error);
    return res.status(500).json({ message: error.message || 'Internal server error.' });
  }
}
