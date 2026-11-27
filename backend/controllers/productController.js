import { pool } from '../config/db.js';
import { logActivity } from '../middleware/auth.js';

// Helper: Get product by ID (including category name and computed status)
export async function getProductById(id) {
  if (!id) return null;
  const result = await pool.query(
    `SELECT p.*, c.name as category_name,
            CASE WHEN p.quantity <= 0 THEN 'Out of Stock'
                 WHEN p.quantity <= p.min_level THEN 'Low Stock'
                 ELSE 'In Stock' END as status
     FROM products p 
     LEFT JOIN categories c ON p.category_id = c.id
     WHERE p.id::text = $1 LIMIT 1`,
    [String(id)]
  );
  return result.rows[0] || null;
}

// Product Controller: List all products
export async function getProducts(req, res) {
  try {
    const result = await pool.query(
      `SELECT p.*, c.name as category_name,
              CASE WHEN p.quantity <= 0 THEN 'Out of Stock'
                   WHEN p.quantity <= p.min_level THEN 'Low Stock'
                   ELSE 'In Stock' END as status
       FROM products p 
       LEFT JOIN categories c ON p.category_id = c.id
       ORDER BY p.name ASC`
    );

    return res.status(200).json({
      products: result.rows.map((product) => ({
        id: product.id,
        name: product.name,
        sku: product.sku,
        categoryId: product.category_id,
        categoryName: product.category_name,
        category: product.category_name,
        price: Number(product.price) || 0,
        quantity: Number(product.quantity) || 0,
        minLevel: Number(product.min_level) || 0,
        status: product.status,
        createdAt: product.created_at,
      })),
    });
  } catch (error) {
    console.error('Get products error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
}

// Product Controller: Get single product
export async function getProduct(req, res) {
  const { id } = req.params;

  if (!id) {
    return res.status(400).json({ message: 'Product ID is required.' });
  }

  try {
    const product = await getProductById(id);

    if (!product) {
      return res.status(404).json({ message: 'Product not found.' });
    }

    return res.status(200).json({
      product: {
        id: product.id,
        name: product.name,
        sku: product.sku,
        categoryId: product.category_id,
        categoryName: product.category_name,
        category: product.category_name,
        price: Number(product.price) || 0,
        quantity: Number(product.quantity) || 0,
        minLevel: Number(product.min_level) || 0,
        status: product.status,
        createdAt: product.created_at,
      },
    });
  } catch (error) {
    console.error('Get product error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
}

// Product Controller: Get all product categories
export async function getCategories(req, res) {
  try {
    const result = await pool.query('SELECT id, name, description FROM categories ORDER BY name ASC');
    return res.status(200).json({
      categories: result.rows.map((c) => ({
        id: c.id,
        name: c.name,
        description: c.description,
      })),
    });
  } catch (error) {
    console.error('Get categories error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
}

// Product Controller: Create new category
export async function createCategory(req, res) {
  try {
    const { name, description } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ message: 'Category name is required.' });
    }

    const trimmedName = name.trim();
    // Check if category already exists (case-insensitive)
    const existing = await pool.query(
      'SELECT id, name, description FROM categories WHERE LOWER(name) = LOWER($1) LIMIT 1',
      [trimmedName]
    );

    if (existing.rows.length > 0) {
      return res.status(200).json({
        message: 'Category already exists',
        category: {
          id: existing.rows[0].id,
          name: existing.rows[0].name,
          description: existing.rows[0].description,
        },
      });
    }

    const result = await pool.query(
      `INSERT INTO categories (name, description, created_at, updated_at)
       VALUES ($1, $2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       RETURNING id, name, description, created_at`,
      [trimmedName, (description || '').trim()]
    );

    const newCat = result.rows[0];

    const userId = req.user?.id || null;
    await logActivity(pool, userId, `Created category ${trimmedName}`, 'Products', {
      categoryId: newCat.id,
    });

    return res.status(201).json({
      message: 'Category created successfully',
      category: {
        id: newCat.id,
        name: newCat.name,
        description: newCat.description,
      },
    });
  } catch (error) {
    console.error('Create category error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
}

// Product Controller: Create new product
export async function createProduct(req, res) {
  try {
    const { name, sku, categoryId, category, price, quantity, minLevel } = req.body;

    const categoryInput = categoryId || category;

    if (!name || !sku || !categoryInput || price === undefined || quantity === undefined || minLevel === undefined) {
      return res.status(400).json({ message: 'All product fields are required.' });
    }

    // Check if SKU already exists
    const existingProduct = await pool.query('SELECT id FROM products WHERE LOWER(sku) = LOWER($1)', [sku.trim()]);
    if (existingProduct.rows.length > 0) {
      return res.status(409).json({ message: 'A product with that SKU already exists.' });
    }

    // Resolve category by ID or name
    const categoryResult = await pool.query(
      'SELECT id, name FROM categories WHERE id::text = $1 OR LOWER(name) = LOWER($1) LIMIT 1',
      [String(categoryInput).trim()]
    );

    if (categoryResult.rows.length === 0) {
      return res.status(400).json({ message: 'Invalid category. Choose a valid category.' });
    }

    const resolvedCategoryId = categoryResult.rows[0].id;
    const resolvedCategoryName = categoryResult.rows[0].name;

    const result = await pool.query(
      `INSERT INTO products (name, sku, category_id, price, quantity, min_level, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       RETURNING *`,
      [name.trim(), sku.trim().toUpperCase(), resolvedCategoryId, Number(price), Number(quantity), Number(minLevel)]
    );

    const newProd = result.rows[0];

    // Log activity
    const userId = req.user?.id || null;
    await logActivity(pool, userId, `Created product ${name}`, 'Products', {
      productId: newProd.id,
      sku: newProd.sku,
    });

    const qty = Number(newProd.quantity);
    const min = Number(newProd.min_level);
    const status = qty <= 0 ? 'Out of Stock' : (qty <= min ? 'Low Stock' : 'In Stock');

    return res.status(201).json({
      message: 'Product created successfully',
      product: {
        id: newProd.id,
        name: newProd.name,
        sku: newProd.sku,
        categoryId: resolvedCategoryId,
        categoryName: resolvedCategoryName,
        category: resolvedCategoryName,
        price: Number(newProd.price),
        quantity: qty,
        minLevel: min,
        status,
        createdAt: newProd.created_at,
      },
    });
  } catch (error) {
    console.error('Create product error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
}

// Product Controller: Update product
export async function updateProduct(req, res) {
  const { id } = req.params;

  if (!id) {
    return res.status(400).json({ message: 'Product ID is required.' });
  }

  try {
    // Check if product exists
    const existingProduct = await getProductById(id);
    if (!existingProduct) {
      return res.status(404).json({ message: 'Product not found.' });
    }

    const { name, sku, categoryId, category, price, quantity, minLevel } = req.body;

    // Check if new SKU already exists (and is not the same product)
    if (sku && sku.trim().toLowerCase() !== existingProduct.sku.toLowerCase()) {
      const skuExists = await pool.query('SELECT id FROM products WHERE LOWER(sku) = LOWER($1) AND id::text != $2', [
        sku.trim(),
        id,
      ]);
      if (skuExists.rows.length > 0) {
        return res.status(409).json({ message: 'Another product with that SKU already exists.' });
      }
    }

    // Resolve category if provided
    let resolvedCategoryId = existingProduct.category_id;
    const categoryInput = categoryId || category;
    if (categoryInput) {
      const categoryResult = await pool.query(
        'SELECT id, name FROM categories WHERE id::text = $1 OR LOWER(name) = LOWER($1) LIMIT 1',
        [String(categoryInput).trim()]
      );
      if (categoryResult.rows.length === 0) {
        return res.status(400).json({ message: 'Invalid category. Choose a valid category.' });
      }
      resolvedCategoryId = categoryResult.rows[0].id;
    }

    await pool.query(
      `UPDATE products 
       SET name = COALESCE($1, name), 
           sku = COALESCE($2, sku), 
           category_id = COALESCE($3, category_id),
           price = COALESCE($4, price), 
           quantity = COALESCE($5, quantity), 
           min_level = COALESCE($6, min_level), 
           updated_at = CURRENT_TIMESTAMP
       WHERE id::text = $7`,
      [
        name ? name.trim() : null,
        sku ? sku.trim().toUpperCase() : null,
        resolvedCategoryId,
        price !== undefined ? Number(price) : null,
        quantity !== undefined ? Number(quantity) : null,
        minLevel !== undefined ? Number(minLevel) : null,
        id,
      ]
    );

    const updatedProd = await getProductById(id);

    // Log activity
    const userId = req.user?.id || null;
    await logActivity(pool, userId, `Updated product ${updatedProd.name}`, 'Products', {
      updatedProductId: id,
    });

    return res.status(200).json({
      message: 'Product updated successfully',
      product: {
        id: updatedProd.id,
        name: updatedProd.name,
        sku: updatedProd.sku,
        categoryId: updatedProd.category_id,
        categoryName: updatedProd.category_name,
        category: updatedProd.category_name,
        price: Number(updatedProd.price),
        quantity: Number(updatedProd.quantity),
        minLevel: Number(updatedProd.min_level),
        status: updatedProd.status,
      },
    });
  } catch (error) {
    console.error('Update product error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
}

// Product Controller: Delete product
export async function deleteProduct(req, res) {
  const { id } = req.params;

  if (!id) {
    return res.status(400).json({ message: 'Product ID is required.' });
  }

  try {
    // Check if product exists
    const existingProduct = await getProductById(id);
    if (!existingProduct) {
      return res.status(404).json({ message: 'Product not found.' });
    }

    // Check if product is referenced in sales or stock transactions
    const [salesRef, stockRef] = await Promise.all([
      pool.query('SELECT COUNT(*) as count FROM sale_items WHERE product_id::text = $1', [id]),
      pool.query('SELECT COUNT(*) as count FROM stock_transactions WHERE product_id::text = $1', [id]),
    ]);

    if (Number(salesRef.rows[0].count) > 0 || Number(stockRef.rows[0].count) > 0) {
      return res.status(400).json({
        message: 'Cannot delete product. It is referenced in sales records or stock transactions.',
      });
    }

    await pool.query('DELETE FROM products WHERE id::text = $1', [id]);

    // Log activity
    const userId = req.user?.id || null;
    await logActivity(pool, userId, `Deleted product ${existingProduct.name}`, 'Products', {
      deletedProductId: id,
    });

    return res.status(200).json({
      message: 'Product deleted successfully',
    });
  } catch (error) {
    console.error('Delete product error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
}

// Product Controller: Get products by category ID
export async function getProductsByCategory(req, res) {
  const { categoryId } = req.params;

  if (!categoryId) {
    return res.status(400).json({ message: 'Category ID is required.' });
  }

  try {
    // Check if category exists
    const category = await pool.query(
      'SELECT * FROM categories WHERE id::text = $1 OR LOWER(name) = LOWER($1)',
      [categoryId]
    );
    if (category.rows.length === 0) {
      return res.status(404).json({ message: 'Category not found.' });
    }

    const resolvedCatId = category.rows[0].id;
    const result = await pool.query(
      `SELECT p.*, c.name as category_name,
              CASE WHEN p.quantity <= 0 THEN 'Out of Stock'
                   WHEN p.quantity <= p.min_level THEN 'Low Stock'
                   ELSE 'In Stock' END as status
       FROM products p 
       LEFT JOIN categories c ON p.category_id = c.id
       WHERE p.category_id = $1 
       ORDER BY p.name ASC`,
      [resolvedCatId]
    );

    return res.status(200).json({
      categoryId: resolvedCatId,
      categoryName: category.rows[0].name,
      products: result.rows.map((product) => ({
        id: product.id,
        name: product.name,
        sku: product.sku,
        categoryId: product.category_id,
        categoryName: product.category_name,
        category: product.category_name,
        price: Number(product.price),
        quantity: Number(product.quantity),
        minLevel: Number(product.min_level),
        status: product.status,
      })),
    });
  } catch (error) {
    console.error('Get products by category error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
}
