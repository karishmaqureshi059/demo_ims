import { pool } from '../config/db.js';
import { logActivity } from '../middleware/auth.js';
import { addNotification } from '../utils/notifications.js';

// Purchase Controller
export async function getSuppliers(req, res) {
  try {
    const result = await pool.query('SELECT * FROM suppliers ORDER BY name');

    return res.status(200).json({
      suppliers: result.rows.map((s) => ({
        id: s.id,
        name: s.name,
        contact: s.contact_person || '',
        contactPerson: s.contact_person || '',
        email: s.email || '',
        phone: s.phone || '',
        address: s.address || '',
        status: s.status,
      })),
    });
  } catch (error) {
    console.error('Get suppliers error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
}

export async function getSupplier(req, res) {
  const { id } = req.params;

  if (!id) {
    return res.status(400).json({ message: 'Supplier ID is required.' });
  }

  try {
    const result = await pool.query('SELECT * FROM suppliers WHERE id = $1', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Supplier not found.' });
    }

    const s = result.rows[0];
    return res.status(200).json({
      supplier: {
        id: s.id,
        name: s.name,
        contact: s.contact_person || '',
        contactPerson: s.contact_person || '',
        email: s.email || '',
        phone: s.phone || '',
        address: s.address || '',
        status: s.status,
      },
    });
  } catch (error) {
    console.error('Get supplier error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
}

export async function createSupplier(req, res) {
  try {
    const { name, contactPerson, contact, email, phone, address } = req.body;

    if (!name) {
      return res.status(400).json({ message: 'Supplier name is required.' });
    }

    const result = await pool.query(
      `INSERT INTO suppliers (id, name, contact_person, email, phone, address, status, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       RETURNING *`,
      [name, contactPerson || contact || '', email || '', phone || '', address || '']
    );

    const created = result.rows[0];

    // Log activity
    await logActivity(pool, req.user?.id, `Created supplier ${name}`, 'Purchase', {
      supplierId: created.id,
    });

    return res.status(201).json({
      message: 'Supplier created successfully',
      supplier: {
        id: created.id,
        name: created.name,
        contact: created.contact_person,
        contactPerson: created.contact_person,
        email: created.email,
        phone: created.phone,
        address: created.address,
        status: created.status,
      },
    });
  } catch (error) {
    console.error('Create supplier error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
}

export async function updateSupplier(req, res) {
  const { id } = req.params;

  if (!id) {
    return res.status(400).json({ message: 'Supplier ID is required.' });
  }

  try {
    const existingSupplier = await pool.query('SELECT * FROM suppliers WHERE id = $1', [id]);

    if (existingSupplier.rows.length === 0) {
      return res.status(404).json({ message: 'Supplier not found.' });
    }

    const { name, contactPerson, contact, email, phone, address } = req.body;

    const result = await pool.query(
      `UPDATE suppliers SET name = COALESCE($1, name), contact_person = COALESCE($2, contact_person),
       email = COALESCE($3, email), phone = COALESCE($4, phone), address = COALESCE($5, address),
       updated_at = CURRENT_TIMESTAMP WHERE id = $6 RETURNING *`,
      [name, contactPerson || contact, email, phone, address, id]
    );

    const updated = result.rows[0];

    await logActivity(pool, req.user?.id, `Updated supplier ${updated.name}`, 'Purchase', {
      updatedSupplierId: id,
    });

    return res.status(200).json({
      message: 'Supplier updated successfully',
      supplier: {
        id: updated.id,
        name: updated.name,
        contact: updated.contact_person,
        contactPerson: updated.contact_person,
        email: updated.email,
        phone: updated.phone,
        address: updated.address,
        status: updated.status,
      },
    });
  } catch (error) {
    console.error('Update supplier error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
}

export async function getPurchaseOrders(req, res) {
  try {
    let query = `SELECT po.*, s.name as supplier_name 
                 FROM purchase_orders po 
                 LEFT JOIN suppliers s ON po.supplier_id = s.id`;
    const params = [];
    let paramCount = 1;

    if (req.query.status) {
      query += ` WHERE po.status = $${paramCount}`;
      params.push(req.query.status);
      paramCount++;
    }

    if (req.query.supplierId) {
      if (query.includes('WHERE')) query += ` AND `;
      else query += ` WHERE `;
      query += `po.supplier_id = $${paramCount}`;
      params.push(req.query.supplierId);
      paramCount++;
    }

    query += ` ORDER BY po.date DESC`;

    const result = await pool.query(query, params);

    return res.status(200).json({
      purchaseOrders: result.rows.map((po) => ({
        id: po.id,
        supplierId: po.supplier_id,
        supplier: po.supplier_name || 'Unknown',
        date: po.date,
        total: Number(po.total) || 0,
        qtyOrdered: Number(po.qty_ordered) || 0,
        qtyReceived: Number(po.qty_received) || 0,
        status: po.status,
        notes: po.notes || '',
        createdAt: po.created_at,
      })),
    });
  } catch (error) {
    console.error('Get purchase orders error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
}

export async function getPurchaseOrder(req, res) {
  const { id } = req.params;

  if (!id) {
    return res.status(400).json({ message: 'Purchase order ID is required.' });
  }

  try {
    const order = await pool.query(
      `SELECT po.*, s.name as supplier_name 
       FROM purchase_orders po LEFT JOIN suppliers s ON po.supplier_id = s.id 
       WHERE po.id = $1`,
      [id]
    );

    if (order.rows.length === 0) {
      return res.status(404).json({ message: 'Purchase order not found.' });
    }

    const itemsResult = await pool.query(
      `SELECT poi.*, p.name as product_name, p.sku 
       FROM purchase_order_items poi 
       LEFT JOIN products p ON poi.product_id = p.id 
       WHERE poi.purchase_order_id = $1`,
      [id]
    );

    const po = order.rows[0];
    return res.status(200).json({
      purchaseOrder: {
        id: po.id,
        supplierId: po.supplier_id,
        supplier: po.supplier_name,
        date: po.date,
        total: Number(po.total),
        qtyOrdered: Number(po.qty_ordered),
        qtyReceived: Number(po.qty_received),
        status: po.status,
        notes: po.notes,
        createdAt: po.created_at,
        items: itemsResult.rows.map((item) => ({
          id: item.id,
          productId: item.product_id,
          productName: item.product_name,
          sku: item.sku,
          quantity: Number(item.quantity),
          unitPrice: Number(item.unit_price),
          total: Number(item.total),
        })),
      },
    });
  } catch (error) {
    console.error('Get purchase order error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
}

export async function createPurchaseOrder(req, res) {
  try {
    const { supplierId, total, qtyOrdered, date, notes } = req.body;

    if (!supplierId || total === undefined || qtyOrdered === undefined) {
      return res.status(400).json({ message: 'Supplier ID, total, and order quantity are required.' });
    }

    // Verify supplier exists
    const supplier = await pool.query('SELECT * FROM suppliers WHERE id = $1', [supplierId]);
    if (supplier.rows.length === 0) {
      return res.status(404).json({ message: 'Supplier not found.' });
    }

    const orderDate = date ? new Date(date).toISOString() : new Date().toISOString();
    const result = await pool.query(
      `INSERT INTO purchase_orders (id, supplier_id, total, qty_ordered, qty_received, status, date, created_by, notes, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, 0, 'Pending', $4, $5, $6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       RETURNING *`,
      [supplierId, Number(total), Number(qtyOrdered), orderDate, req.user?.id || null, notes || '']
    );

    const po = result.rows[0];

    // Log activity
    await logActivity(pool, req.user?.id, `Created purchase order for ${supplier.rows[0].name}`, 'Purchase', {
      purchaseOrderId: po.id,
      supplierId,
    });

    await addNotification({
      title: 'New Purchase Order Created',
      message: `Purchase order created for ${supplier.rows[0].name} (₹${Number(total).toLocaleString()})`,
      type: 'order',
      relatedId: po.id,
      relatedType: 'purchase',
    });

    return res.status(201).json({
      message: 'Purchase order created successfully',
      purchaseOrder: {
        id: po.id,
        supplierId: po.supplier_id,
        supplier: supplier.rows[0].name,
        date: po.date,
        total: Number(po.total),
        qtyOrdered: Number(po.qty_ordered),
        qtyReceived: 0,
        status: po.status,
        notes: po.notes,
      },
    });
  } catch (error) {
    console.error('Create purchase order error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
}

export async function updatePurchaseOrder(req, res) {
  const { id } = req.params;

  if (!id) {
    return res.status(400).json({ message: 'Purchase order ID is required.' });
  }

  try {
    const existingOrder = await pool.query(
      `SELECT po.*, s.name as supplier_name FROM purchase_orders po
       LEFT JOIN suppliers s ON po.supplier_id = s.id WHERE po.id = $1`,
      [id]
    );

    if (existingOrder.rows.length === 0) {
      return res.status(404).json({ message: 'Purchase order not found.' });
    }

    const { total, qtyOrdered, status, supplierId, date, notes } = req.body;
    const old = existingOrder.rows[0];

    if (qtyOrdered !== undefined && Number(old.qty_received) > Number(qtyOrdered)) {
      return res.status(400).json({ message: 'Order quantity cannot be lower than the quantity already received.' });
    }

    const result = await pool.query(
      `UPDATE purchase_orders 
       SET supplier_id = COALESCE($1, supplier_id), 
           total = COALESCE($2, total),
           qty_ordered = COALESCE($3, qty_ordered), 
           status = COALESCE($4, status), 
           notes = COALESCE($5, notes),
           date = COALESCE($6, date),
           updated_at = CURRENT_TIMESTAMP 
       WHERE id = $7 RETURNING *`,
      [supplierId, total !== undefined ? Number(total) : null, qtyOrdered !== undefined ? Number(qtyOrdered) : null, status, notes, date ? new Date(date).toISOString() : null, id]
    );

    const updated = result.rows[0];

    await logActivity(pool, req.user?.id, `Updated purchase order ${id}`, 'Purchase', {
      updatedPurchaseOrderId: id,
    });

    return res.status(200).json({
      message: 'Purchase order updated successfully',
      purchaseOrder: {
        id: updated.id,
        supplierId: updated.supplier_id,
        supplier: old.supplier_name,
        date: updated.date,
        total: Number(updated.total),
        qtyOrdered: Number(updated.qty_ordered),
        qtyReceived: Number(updated.qty_received),
        status: updated.status,
        notes: updated.notes,
      },
    });
  } catch (error) {
    console.error('Update purchase order error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
}

export async function receivePurchaseOrder(req, res) {
  const { id } = req.params;
  const quantity = req.body?.quantity !== undefined ? req.body.quantity : req.params.quantity;

  if (!id) {
    return res.status(400).json({ message: 'Purchase order ID is required.' });
  }

  if (!quantity || Number(quantity) <= 0) {
    return res.status(400).json({ message: 'Received quantity is required and must be greater than 0.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const orderRes = await client.query('SELECT * FROM purchase_orders WHERE id = $1 FOR UPDATE', [id]);

    if (orderRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Purchase order not found.' });
    }

    const order = orderRes.rows[0];
    if (order.status === 'Received') {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'This purchase order has already been fully received.' });
    }

    const receivedQty = Number(quantity);
    const orderedQty = Number(order.qty_ordered);
    const previouslyReceived = Number(order.qty_received);

    if (receivedQty > orderedQty - previouslyReceived) {
      await client.query('ROLLBACK');
      return res.status(400).json({ 
        message: `Received quantity exceeds the ${orderedQty - previouslyReceived} units still due.` 
      });
    }

    const newReceivedQty = previouslyReceived + receivedQty;
    const newStatus = newReceivedQty >= orderedQty ? 'Received' : (newReceivedQty > 0 ? 'Partially Received' : 'Pending');

    // Update purchase order
    await client.query(
      `UPDATE purchase_orders SET qty_received = $1, status = $2, received_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = $3`,
      [newReceivedQty, newStatus, id]
    );

    // Update stock for each item in the purchase order if items exist
    const items = await client.query(
      `SELECT product_id, quantity as ordered_qty FROM purchase_order_items WHERE purchase_order_id = $1`,
      [id]
    );

    for (const item of items.rows) {
      const product = await client.query('SELECT quantity, name FROM products WHERE id = $1 FOR UPDATE', [item.product_id]);

      if (product.rows.length > 0) {
        const currentProductQty = Number(product.rows[0].quantity);
        const newProductQty = currentProductQty + receivedQty;
        await client.query(
          `UPDATE products SET quantity = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
          [newProductQty, item.product_id]
        );

        // Record stock transaction with gen_random_uuid()
        await client.query(
          `INSERT INTO stock_transactions (id, product_id, type, quantity, previous_quantity, new_quantity, reason, user_id, date, created_at)
           VALUES (gen_random_uuid(), $1, 'in', $2, $3, $4, $5, $6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          [item.product_id, receivedQty, currentProductQty, newProductQty, `Received from PO ${id}`, req.user?.id || null]
        );
      }
    }

    await client.query('COMMIT');

    // Log activity
    await logActivity(pool, req.user?.id, `Received ${receivedQty} units on purchase order ${id}`, 'Purchase', {
      purchaseOrderId: id,
      receivedQuantity: receivedQty,
    });

    await addNotification({
      title: 'Purchase Order Received',
      message: `Purchase order ${id} received ${receivedQty} units (Status: ${newStatus})`,
      type: 'order',
      relatedId: id,
      relatedType: 'purchase',
    });

    return res.status(200).json({
      message: 'Purchase order received successfully',
      purchaseOrder: {
        id: order.id,
        status: newStatus,
        qtyReceived: newReceivedQty,
        qtyOrdered: orderedQty,
      },
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Receive purchase order error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  } finally {
    client.release();
  }
}
