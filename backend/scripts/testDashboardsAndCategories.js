import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

const { pool } = await import('../config/db.js');
const { getDashboard } = await import('../services/dashboardService.js');
const { createCategory, getCategories } = await import('../controllers/productController.js');

async function runTests() {
  console.log('=== 1. Testing Category API in PostgreSQL ===');
  
  // Test category creation controller with Electronics
  let testCatRes = {
    statusCode: null,
    data: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.data = payload; return this; }
  };

  await createCategory(
    { body: { name: 'Electronics', description: 'Electronic devices and gadgets' }, user: { id: null } },
    testCatRes
  );
  console.log('Create "Electronics" response status:', testCatRes.statusCode);
  console.log('Electronics category:', testCatRes.data);

  // Test creating a unique test category
  const uniqueName = `Smart Home ${Date.now()}`;
  let uniqueCatRes = {
    statusCode: null,
    data: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.data = payload; return this; }
  };
  await createCategory(
    { body: { name: uniqueName, description: 'Smart devices' }, user: { id: null } },
    uniqueCatRes
  );
  console.log(`Create "${uniqueName}" status:`, uniqueCatRes.statusCode);
  console.log('Created category:', uniqueCatRes.data);

  // Test getCategories
  let getCatRes = {
    statusCode: null,
    data: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.data = payload; return this; }
  };
  await getCategories({}, getCatRes);
  const catNames = getCatRes.data.categories.map(c => c.name);
  console.log('Total categories in DB:', catNames.length);
  console.log('Includes Electronics?', catNames.includes('Electronics'));
  console.log(`Includes ${uniqueName}?`, catNames.includes(uniqueName));

  if (!catNames.includes('Electronics') || !catNames.includes(uniqueName)) {
    throw new Error('Category persistence test failed');
  }

  // Clean up unique test category
  if (uniqueCatRes.data?.category?.id) {
    await pool.query('DELETE FROM categories WHERE id = $1', [uniqueCatRes.data.category.id]);
    console.log(`Cleaned up temporary category ${uniqueName}`);
  }

  console.log('\n=== 2. Testing All Six Role Dashboards with Live Supabase Data ===');
  const roles = ['owner', 'product', 'sales', 'stock', 'purchase', 'orders'];

  for (const role of roles) {
    console.log(`\n--- Dashboard: ${role.toUpperCase()} ---`);
    const dash = await getDashboard(role);
    console.log('KPIs:', Object.keys(dash.kpis).map(k => `${k}: ${dash.kpis[k].value}`).join(' | '));
    const trendLen = dash.charts.trend.series ? dash.charts.trend.series[0]?.data?.length : dash.charts.trend.data?.length;
    console.log('Trend chart:', dash.charts.trend.title, '| points:', trendLen);
    console.log('Breakdown chart:', dash.charts.breakdown.title, '| data:', dash.charts.breakdown.data);
    console.log('Alerts count:', dash.alerts.length);
    console.log('Recent activity count:', dash.recentActivity.length);
  }

  console.log('\n=== All tests passed successfully! ===');
  await pool.end();
  process.exit(0);
}

runTests().catch(async (err) => {
  console.error('Test error:', err);
  await pool.end();
  process.exit(1);
});
