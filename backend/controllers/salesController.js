import { pool } from '../config/db.js';
import { logActivity } from '../middleware/auth.js';
import { addNotification } from '../utils/notifications.js';
import { AiForecastService } from '../services/aiForecastService.js';

// Sales Controller: List all sales
export async function getSales(req, res) {
  try {
    const result = await pool.query(
      `SELECT s.*, u.name as salesperson_name, u.email as salesperson_email 
       FROM sales s 
       LEFT JOIN users u ON s.user_id = u.id 
       ORDER BY s.date DESC`
    );

    return res.status(200).json({
      sales: result.rows.map((sale) => ({
        id: sale.id,
        userId: sale.user_id,
        salespersonName: sale.salesperson_name || 'System',
        user: sale.salesperson_name || 'System',
        total: Number(sale.total) || 0,
        itemsCount: Number(sale.items_count) || 0,
        items: Number(sale.items_count) || 0,
        status: sale.status || 'completed',
        date: sale.date,
      })),
    });
  } catch (error) {
    console.error('Get sales error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
}

// Sales Controller: Get single sale with its items
export async function getSale(req, res) {
  const { id } = req.params;

  if (!id) {
    return res.status(400).json({ message: 'Sale ID is required.' });
  }

  try {
    const saleResult = await pool.query(
      `SELECT s.*, u.name as salesperson_name, u.email as salesperson_email 
       FROM sales s 
       LEFT JOIN users u ON s.user_id = u.id 
       WHERE s.id::text = $1`,
      [id]
    );

    if (saleResult.rows.length === 0) {
      return res.status(404).json({ message: 'Sale not found.' });
    }

    const saleRow = saleResult.rows[0];

    // Get sale items
    const itemsResult = await pool.query(
      `SELECT si.*, p.name as product_name, p.sku 
       FROM sale_items si 
       LEFT JOIN products p ON si.product_id = p.id 
       WHERE si.sale_id::text = $1
       ORDER BY si.created_at ASC`,
      [id]
    );

    const itemsFormatted = itemsResult.rows.map((item) => ({
      id: item.id,
      productId: item.product_id,
      productName: item.product_name,
      sku: item.sku,
      quantity: Number(item.quantity) || 0,
      unitPrice: Number(item.unit_price) || 0,
      total: Number(item.total) || 0,
    }));

    return res.status(200).json({
      sale: {
        id: saleRow.id,
        userId: saleRow.user_id,
        salespersonName: saleRow.salesperson_name || 'System',
        user: saleRow.salesperson_name || 'System',
        total: Number(saleRow.total) || 0,
        itemsCount: Number(saleRow.items_count) || 0,
        status: saleRow.status || 'completed',
        date: saleRow.date,
        items: itemsFormatted,
        itemList: itemsFormatted,
      },
    });
  } catch (error) {
    console.error('Get sale error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
}

// Sales Controller: Create new sale with transactional stock reduction
export async function createSale(req, res) {
  // 1. Identify salesperson
  let salespersonId = req.user?.id || req.body.userId;

  if (!salespersonId && req.body.user) {
    const userRes = await pool.query(
      `SELECT id, name FROM users 
       WHERE id::text = $1 OR LOWER(name) = LOWER($1) OR LOWER(email) = LOWER($1) 
       LIMIT 1`,
      [String(req.body.user).trim()]
    );
    if (userRes.rows.length > 0) {
      salespersonId = userRes.rows[0].id;
    }
  }

  // If still not identified, pick the first active owner/sales user as fallback
  if (!salespersonId) {
    const fallbackUser = await pool.query(
      `SELECT id, name FROM users WHERE status = 'active' ORDER BY created_at ASC LIMIT 1`
    );
    if (fallbackUser.rows.length > 0) {
      salespersonId = fallbackUser.rows[0].id;
    }
  }

  if (!salespersonId) {
    return res.status(400).json({ message: 'Salesperson user could not be identified.' });
  }

  const userCheck = await pool.query('SELECT id, name FROM users WHERE id::text = $1', [salespersonId]);
  if (userCheck.rows.length === 0) {
    return res.status(400).json({ message: 'Invalid salesperson. User does not exist.' });
  }

  // 2. Normalize and validate items
  const { items, productId, quantity, unitPrice, price, total } = req.body;
  let saleItems = Array.isArray(items) ? items : null;

  if (!saleItems && productId) {
    saleItems = [
      {
        productId,
        quantity,
        unitPrice: unitPrice !== undefined ? unitPrice : price,
      },
    ];
  }

  if (!saleItems || saleItems.length === 0) {
    return res.status(400).json({ message: 'At least one product item is required to complete a sale.' });
  }

  // 3. Connect a single PostgreSQL client for an atomic transaction
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    let computedTotal = 0;
    let totalItemsCount = 0;
    const processedItems = [];

    // Lock and validate each product
    for (const item of saleItems) {
      if (!item.productId) {
        throw new Error('Product ID is required for each item.');
      }

      const qty = Number(item.quantity);
      if (!Number.isInteger(qty) || qty <= 0) {
        throw new Error(`Quantity for product must be a whole number greater than 0.`);
      }

      // Lock product row to prevent race conditions during concurrent sales
      const productRes = await client.query(
        'SELECT id, name, sku, price, quantity FROM products WHERE id::text = $1 FOR UPDATE',
        [String(item.productId)]
      );

      if (productRes.rows.length === 0) {
        throw new Error(`Product not found: ${item.productId}`);
      }

      const product = productRes.rows[0];
      const currentQty = Number(product.quantity);

      // Check sufficient stock
      if (currentQty < qty) {
        const err = new Error(`Insufficient stock for "${product.name}". Available: ${currentQty}, Requested: ${qty}`);
        err.statusCode = 422;
        throw err;
      }

      // Determine unit price
      const priceVal =
        item.unitPrice !== undefined && item.unitPrice !== null && !isNaN(Number(item.unitPrice))
          ? Number(item.unitPrice)
          : Number(product.price);

      const itemTotal = Number((qty * priceVal).toFixed(2));
      computedTotal += itemTotal;
      totalItemsCount += qty;

      processedItems.push({
        productId: product.id,
        productName: product.name,
        sku: product.sku,
        quantity: qty,
        unitPrice: priceVal,
        itemTotal,
        currentQty,
        newQty: currentQty - qty,
      });
    }

    computedTotal = Number(computedTotal.toFixed(2));
    const finalTotal = total !== undefined && !isNaN(Number(total)) && Number(total) > 0 ? Number(total) : computedTotal;

    // Insert into sales table (omitting id and letting PostgreSQL generate UUID via DEFAULT)
    const saleInsert = await client.query(
      `INSERT INTO sales (user_id, total, items_count, status, date, created_at)
       VALUES ($1, $2, $3, 'completed', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       RETURNING id, user_id, total, items_count, status, date, created_at`,
      [salespersonId, finalTotal, totalItemsCount]
    );

    const createdSale = saleInsert.rows[0];

    // Insert sale_items, deduct product stock, and insert stock_transactions
    for (const item of processedItems) {
      // 1. Insert into sale_items
      await client.query(
        `INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, total, created_at)
         VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)`,
        [createdSale.id, item.productId, item.quantity, item.unitPrice, item.itemTotal]
      );

      // 2. Reduce product stock
      await client.query(
        `UPDATE products 
         SET quantity = quantity - $1, updated_at = CURRENT_TIMESTAMP 
         WHERE id = $2`,
        [item.quantity, item.productId]
      );

      // 3. Record stock-out transaction
      await client.query(
        `INSERT INTO stock_transactions (product_id, type, quantity, previous_quantity, new_quantity, reason, user_id, date, created_at)
         VALUES ($1, 'out', $2, $3, $4, $5, $6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [
          item.productId,
          item.quantity,
          item.currentQty,
          item.newQty,
          `Sale ${createdSale.id}`,
          salespersonId,
        ]
      );
    }

    await client.query('COMMIT');

    // Log activity
    await logActivity(pool, salespersonId, `Created sale ${createdSale.id}`, 'Sales', {
      saleId: createdSale.id,
      salespersonId,
      itemsCount: totalItemsCount,
      total: finalTotal,
    });

    // Notify new sale
    await addNotification({
      title: 'New Sale Completed',
      message: `Sale completed for ₹${finalTotal.toLocaleString()} (${totalItemsCount} item(s))`,
      type: 'order',
      relatedId: createdSale.id,
      relatedType: 'sale',
    });

    // Notify low stock / zero stock for sold items
    for (const item of processedItems) {
      if (item.newQty <= 0) {
        await addNotification({
          title: 'Out of Stock Alert',
          message: `Product "${item.productName}" is now out of stock (0 units remaining).`,
          type: 'low_stock',
          relatedId: item.productId,
          relatedType: 'product',
        });
      } else if (item.newQty <= 10) {
        await addNotification({
          title: 'Low Stock Alert',
          message: `Product "${item.productName}" is running low (${item.newQty} units remaining).`,
          type: 'low_stock',
          relatedId: item.productId,
          relatedType: 'product',
        });
      }
    }

    // Automatically trigger AI inventory forecasting and smart alerts for the updated products
    AiForecastService.evaluateAndGenerateAlerts(processedItems.map((i) => i.productId)).catch((err) => {
      console.error('Background AI forecast evaluation error after sale:', err.message);
    });

    return res.status(201).json({
      message: 'Sale created successfully',
      sale: {
        id: createdSale.id,
        userId: createdSale.user_id,
        salespersonName: userCheck.rows[0].name,
        user: userCheck.rows[0].name,
        total: Number(createdSale.total),
        itemsCount: Number(createdSale.items_count),
        items: totalItemsCount,
        status: createdSale.status,
        date: createdSale.date,
      },
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Create sale error:', error.message);
    const statusCode = error.statusCode || 400;
    return res.status(statusCode).json({ message: error.message || 'Internal server error.' });
  } finally {
    client.release();
  }
}

// Sales Controller: Update existing sale
export async function updateSale(req, res) {
  const { id } = req.params;

  if (!id) {
    return res.status(400).json({ message: 'Sale ID is required.' });
  }

  try {
    const saleCheck = await pool.query('SELECT * FROM sales WHERE id::text = $1', [id]);
    if (saleCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Sale not found.' });
    }

    const { total, status } = req.body;

    const result = await pool.query(
      `UPDATE sales 
       SET total = COALESCE($1, total), 
           status = COALESCE($2, status) 
       WHERE id::text = $3 
       RETURNING *`,
      [total !== undefined ? Number(total) : null, status ? String(status).trim() : null, id]
    );

    const updatedSale = result.rows[0];

    const userId = req.user?.id || updatedSale.user_id || null;
    await logActivity(pool, userId, `Updated sale ${id}`, 'Sales', {
      updatedSaleId: id,
    });

    return res.status(200).json({
      message: 'Sale updated successfully',
      sale: {
        id: updatedSale.id,
        userId: updatedSale.user_id,
        total: Number(updatedSale.total),
        itemsCount: Number(updatedSale.items_count),
        status: updatedSale.status,
        date: updatedSale.date,
      },
    });
  } catch (error) {
    console.error('Update sale error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
}

// Sales Controller: Delete sale and revert stock
export async function deleteSale(req, res) {
  const { id } = req.params;

  if (!id) {
    return res.status(400).json({ message: 'Sale ID is required.' });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const saleCheck = await client.query('SELECT * FROM sales WHERE id::text = $1', [id]);
    if (saleCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Sale not found.' });
    }

    const sale = saleCheck.rows[0];

    // Fetch sale items to restore inventory
    const itemsRes = await client.query('SELECT * FROM sale_items WHERE sale_id::text = $1', [id]);

    for (const item of itemsRes.rows) {
      // Restore product quantity
      const prodRes = await client.query(
        'SELECT quantity FROM products WHERE id = $1 FOR UPDATE',
        [item.product_id]
      );

      if (prodRes.rows.length > 0) {
        const currentQty = Number(prodRes.rows[0].quantity);
        const newQty = currentQty + Number(item.quantity);

        await client.query(
          'UPDATE products SET quantity = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
          [newQty, item.product_id]
        );

        // Record stock-in transaction
        await client.query(
          `INSERT INTO stock_transactions (product_id, type, quantity, previous_quantity, new_quantity, reason, user_id, date, created_at)
           VALUES ($1, 'in', $2, $3, $4, $5, $6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          [
            item.product_id,
            Number(item.quantity),
            currentQty,
            newQty,
            `Sale ${id} deleted / reverted`,
            req.user?.id || sale.user_id,
          ]
        );
      }
    }

    // Delete sale items and sale record (cascade handles sale_items, but explicit is safe)
    await client.query('DELETE FROM sale_items WHERE sale_id::text = $1', [id]);
    await client.query('DELETE FROM sales WHERE id::text = $1', [id]);

    await client.query('COMMIT');

    const actorId = req.user?.id || sale.user_id || null;
    await logActivity(pool, actorId, `Deleted sale ${id}`, 'Sales', {
      deletedSaleId: id,
    });

    return res.status(200).json({
      message: 'Sale deleted successfully',
      id,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Delete sale error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  } finally {
    client.release();
  }
}
