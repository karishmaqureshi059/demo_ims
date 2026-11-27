import { pool } from '../config/db.js';
import { logActivity } from '../middleware/auth.js';
import { addNotification } from '../utils/notifications.js';

// Stock Controller
export async function getStockTransactions(req, res) {
  try {
    let query = `SELECT st.*, u.name as user_name, p.name as product_name 
                 FROM stock_transactions st 
                 LEFT JOIN users u ON st.user_id = u.id 
                 LEFT JOIN products p ON st.product_id = p.id`;
    const params = [];
    let paramCount = 1;

    if (req.query.productId) {
      query += ` WHERE st.product_id = $${paramCount}`;
      params.push(req.query.productId);
      paramCount++;
    }

    if (req.query.type) {
      if (query.includes('WHERE')) query += ` AND `;
      else query += ` WHERE `;
      query += `st.type = $${paramCount}`;
      params.push(req.query.type);
      paramCount++;
    }

    if (req.query.startDate && req.query.endDate) {
      if (query.includes('WHERE')) query += ` AND `;
      else query += ` WHERE `;
      query += `st.date BETWEEN $${paramCount} AND $${paramCount + 1}`;
      params.push(req.query.startDate, req.query.endDate);
      paramCount += 2;
    }

    query += ` ORDER BY st.date DESC`;

    const result = await pool.query(query, params);

    return res.status(200).json({
      stockTransactions: result.rows.map((transaction) => ({
        id: transaction.id,
        productId: transaction.product_id,
        productName: transaction.product_name,
        type: transaction.type,
        quantity: Number(transaction.quantity),
        previousQuantity: Number(transaction.previous_quantity),
        newQuantity: Number(transaction.new_quantity),
        reason: transaction.reason || '',
        userId: transaction.user_id,
        user: transaction.user_name || 'System',
        userName: transaction.user_name || 'System',
        date: transaction.date,
      })),
    });
  } catch (error) {
    console.error('Get stock transactions error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
}

// Unified Stock Transaction Creation
export async function createStockTransaction(req, res) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { productId, type, quantity, reason, date } = req.body;
    const userId = req.user?.id;

    if (!productId || quantity === undefined) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Product ID and quantity are required.' });
    }

    const numQty = Number(quantity);
    if (isNaN(numQty) || numQty < 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Quantity must be a non-negative number.' });
    }

    if (!['in', 'out', 'adjustment'].includes(type)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Invalid transaction type. Must be in, out, or adjustment.' });
    }

    // Lock product row for update
    const productResult = await client.query('SELECT * FROM products WHERE id = $1 FOR UPDATE', [productId]);
    if (productResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Product not found.' });
    }

    const product = productResult.rows[0];
    const currentQty = Number(product.quantity);
    let newQty = currentQty;

    if (type === 'in') {
      newQty = currentQty + numQty;
    } else if (type === 'out') {
      if (currentQty < numQty) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          message: `Insufficient stock. Available: ${currentQty}, Requested: ${numQty}`,
        });
      }
      newQty = currentQty - numQty;
    } else if (type === 'adjustment') {
      newQty = numQty;
    }

    // Update product quantity
    await client.query(
      `UPDATE products SET quantity = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
      [newQty, productId]
    );

    // Record stock transaction
    const txDate = date ? new Date(date).toISOString() : new Date().toISOString();
    const insertRes = await client.query(
      `INSERT INTO stock_transactions (id, product_id, type, quantity, previous_quantity, new_quantity, reason, user_id, date, created_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
       RETURNING *`,
      [productId, type, type === 'adjustment' ? Math.abs(newQty - currentQty) : numQty, currentQty, newQty, reason || (type === 'adjustment' ? 'Stock adjustment' : (type === 'in' ? 'Stock-in' : 'Stock-out')), userId, txDate]
    );

    await client.query('COMMIT');

    const createdTx = insertRes.rows[0];

    // Activity log
    await logActivity(pool, userId, `Recorded stock ${type} (${numQty} units) for ${product.name}`, 'Stock', {
      transactionId: createdTx.id,
      productId,
      type,
      quantity: numQty,
    });

    // Check low stock and out of stock conditions
    const minLevel = Number(product.min_stock_level || product.min_level || 10);
    if (newQty <= 0) {
      await addNotification({
        title: 'Out of Stock Alert',
        message: `Product "${product.name}" has reached 0 stock units.`,
        type: 'low_stock',
        relatedId: product.id,
        relatedType: 'product',
      });
    } else if (newQty <= minLevel) {
      await addNotification({
        title: 'Low Stock Alert',
        message: `Product "${product.name}" is running low (${newQty} units remaining, threshold: ${minLevel}).`,
        type: 'low_stock',
        relatedId: product.id,
        relatedType: 'product',
      });
    }

    return res.status(201).json({
      message: 'Stock transaction created successfully',
      transaction: {
        id: createdTx.id,
        productId,
        productName: product.name,
        type,
        quantity: numQty,
        previousQuantity: currentQty,
        newQuantity: newQty,
        reason: createdTx.reason,
        date: createdTx.date,
        user: req.user?.name || 'System',
      },
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Create stock transaction error:', error);
    return res.status(500).json({ message: error.message || 'Internal server error.' });
  } finally {
    client.release();
  }
}

// Update Stock Transaction
export async function updateStockTransaction(req, res) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { id } = req.params;
    const { productId, type, quantity, reason, date } = req.body;
    const userId = req.user?.id;

    const txRes = await client.query('SELECT * FROM stock_transactions WHERE id = $1 FOR UPDATE', [id]);
    if (txRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Stock transaction not found.' });
    }

    const oldTx = txRes.rows[0];
    const targetProductId = productId || oldTx.product_id;
    const targetType = type || oldTx.type;
    const newQty = quantity !== undefined ? Number(quantity) : Number(oldTx.quantity);

    // Fetch product
    const productRes = await client.query('SELECT * FROM products WHERE id = $1 FOR UPDATE', [targetProductId]);
    if (productRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Product not found.' });
    }

    const product = productRes.rows[0];

    // Revert old transaction effect if same product
    let adjustedQty = Number(product.quantity);
    if (oldTx.product_id === targetProductId) {
      if (oldTx.type === 'in') adjustedQty -= Number(oldTx.quantity);
      else if (oldTx.type === 'out') adjustedQty += Number(oldTx.quantity);
      else if (oldTx.type === 'adjustment') adjustedQty = Number(oldTx.previous_quantity);
    }

    // Apply new effect
    let finalQty = adjustedQty;
    if (targetType === 'in') finalQty = adjustedQty + newQty;
    else if (targetType === 'out') {
      if (adjustedQty < newQty) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: `Insufficient stock to apply updated transaction.` });
      }
      finalQty = adjustedQty - newQty;
    } else if (targetType === 'adjustment') finalQty = newQty;

    await client.query('UPDATE products SET quantity = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [finalQty, targetProductId]);

    const txDate = date ? new Date(date).toISOString() : oldTx.date;
    const updateRes = await client.query(
      `UPDATE stock_transactions 
       SET product_id = $1, type = $2, quantity = $3, previous_quantity = $4, new_quantity = $5, reason = $6, date = $7
       WHERE id = $8
       RETURNING *`,
      [targetProductId, targetType, targetType === 'adjustment' ? Math.abs(finalQty - adjustedQty) : newQty, adjustedQty, finalQty, reason !== undefined ? reason : oldTx.reason, txDate, id]
    );

    await client.query('COMMIT');

    const updated = updateRes.rows[0];
    return res.status(200).json({
      message: 'Stock transaction updated successfully',
      transaction: {
        id: updated.id,
        productId: updated.product_id,
        productName: product.name,
        type: updated.type,
        quantity: Number(updated.quantity),
        previousQuantity: Number(updated.previous_quantity),
        newQuantity: Number(updated.new_quantity),
        reason: updated.reason,
        date: updated.date,
      },
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Update stock transaction error:', error);
    return res.status(500).json({ message: error.message || 'Internal server error.' });
  } finally {
    client.release();
  }
}

export async function recordStockIn(req, res) {
  req.body.type = 'in';
  return createStockTransaction(req, res);
}

export async function recordStockOut(req, res) {
  req.body.type = 'out';
  return createStockTransaction(req, res);
}

export async function adjustStock(req, res) {
  req.body.type = 'adjustment';
  return createStockTransaction(req, res);
}

export async function getLowStockProducts(req, res) {
  try {
    const result = await pool.query(
      `SELECT id, name, sku, quantity, min_level, 
              CASE WHEN quantity <= 0 THEN 'Out of Stock'
                   WHEN quantity <= min_level THEN 'Low Stock'
                   ELSE 'In Stock' END as status
       FROM products 
       WHERE quantity > 0 AND quantity <= min_level 
       ORDER BY quantity ASC`
    );

    return res.status(200).json({
      lowStockProducts: result.rows,
    });
  } catch (error) {
    console.error('Get low stock products error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
}

export async function getStockSummary(req, res) {
  try {
    const [productsResult, totalResult, lowStockResult, outOfStockResult] = await Promise.all([
      pool.query('SELECT COUNT(*) as count FROM products'),
      pool.query('SELECT COALESCE(SUM(quantity), 0) as total_quantity FROM products'),
      pool.query(`SELECT COUNT(*) as count FROM products WHERE quantity > 0 AND quantity <= min_level`),
      pool.query(`SELECT COUNT(*) as count FROM products WHERE quantity <= 0`),
    ]);

    return res.status(200).json({
      totalProducts: Number(productsResult.rows[0].count) || 0,
      totalQuantity: Number(totalResult.rows[0].total_quantity) || 0,
      lowStockItems: Number(lowStockResult.rows[0].count) || 0,
      outOfStockItems: Number(outOfStockResult.rows[0].count) || 0,
    });
  } catch (error) {
    console.error('Get stock summary error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
}
