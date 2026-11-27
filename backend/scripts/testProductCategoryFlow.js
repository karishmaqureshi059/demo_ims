import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

const { pool } = await import('../config/db.js');
const { createCategory, getCategories, createProduct, deleteProduct } = await import('../controllers/productController.js');
const { getDashboard } = await import('../services/dashboardService.js');

async function testFullFlow() {
  console.log('=== Testing Category & Product Creation Flow ===');

  // 1. Ensure Electronics category exists
  let catRes = {
    statusCode: null,
    data: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.data = payload; return this; }
  };
  await createCategory(
    { body: { name: 'Electronics', description: 'Electronic items' }, user: { id: null } },
    catRes
  );
  console.log('Category create response:', catRes.statusCode, catRes.data?.category?.name);

  // 2. Fetch categories
  let getCatRes = {
    statusCode: null,
    data: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.data = payload; return this; }
  };
  await getCategories({}, getCatRes);
  const electronicsCategory = getCatRes.data.categories.find(c => c.name.toLowerCase() === 'electronics');
  console.log('Found Electronics in categories list:', !!electronicsCategory, electronicsCategory);

  if (!electronicsCategory) throw new Error('Electronics category not found in categories list');

  // 3. Create product in Electronics category
  const testSku = `ELEC-TST-${Date.now().toString().slice(-4)}`;
  let prodRes = {
    statusCode: null,
    data: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.data = payload; return this; }
  };

  await createProduct(
    {
      body: {
        name: 'Wireless Ergonomic Mouse',
        sku: testSku,
        category: 'Electronics',
        price: 49.99,
        quantity: 35,
        minLevel: 5
      },
      user: { id: null, role: 'owner' }
    },
    prodRes
  );

  console.log('Product created status:', prodRes.statusCode);
  console.log('Product created:', prodRes.data?.product?.name, prodRes.data?.product?.sku, prodRes.data?.product?.categoryName);

  if (prodRes.statusCode !== 201) throw new Error('Product creation failed: ' + JSON.stringify(prodRes.data));

  const createdId = prodRes.data.product.id;

  // 4. Verify dashboard updates dynamically
  const productDashboard = await getDashboard('product');
  console.log('Product Dashboard totalProducts:', productDashboard.kpis.totalProducts.value);

  // 5. Clean up created test product
  let delRes = {
    statusCode: null,
    data: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.data = payload; return this; }
  };
  await deleteProduct({ params: { id: createdId }, user: { id: null, role: 'owner' } }, delRes);
  console.log('Cleaned up test product status:', delRes.statusCode);

  console.log('\n=== Category & Product Creation Flow Passed! ===');
  await pool.end();
}

testFullFlow().catch(async (e) => {
  console.error('Test failed:', e);
  await pool.end();
  process.exit(1);
});
