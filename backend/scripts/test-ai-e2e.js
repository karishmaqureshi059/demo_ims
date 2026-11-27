import app from '../server.js';
import { pool } from '../config/db.js';

const DEMO_ACCOUNTS = [
  { role: 'owner', email: 'owner@inventory.com', password: 'Owner@123' },
  { role: 'product', email: 'product@inventory.com', password: 'Product@123' },
  { role: 'sales', email: 'sales@inventory.com', password: 'Sales@123' },
  { role: 'stock', email: 'stock@inventory.com', password: 'Stock@123' },
  { role: 'purchase', email: 'purchase@inventory.com', password: 'Purchase@123' },
  { role: 'orders', email: 'orders@inventory.com', password: 'Orders@123' },
];

const PORT = 5005;
const BASE_URL = `http://localhost:${PORT}/api`;

async function runE2ETests() {
  console.log('====================================================');
  console.log('AI INVENTORY FORECASTING & SMART ALERTS — E2E AUDIT');
  console.log('====================================================\n');

  // Start server on test port
  const server = app.listen(PORT);
  await new Promise((resolve) => setTimeout(resolve, 500));

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  ✅ PASS: ${message}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${message}`);
      failed++;
    }
  }

  try {
    const tokens = {};

    // 1. Authenticate all 6 roles
    console.log('1. Authenticating all 6 role accounts...');
    for (const acc of DEMO_ACCOUNTS) {
      const res = await fetch(`${BASE_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: acc.email, password: acc.password }),
      });
      const data = await res.json();
      assert(res.status === 200 && data.token, `Login as ${acc.role} (${acc.email})`);
      tokens[acc.role] = data.token;
    }

    // 2. Test GET /api/ai/insights for all 6 roles
    console.log('\n2. Testing GET /api/ai/insights across all 6 roles...');
    for (const acc of DEMO_ACCOUNTS) {
      const token = tokens[acc.role];
      const res = await fetch(`${BASE_URL}/ai/insights`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();

      assert(res.status === 200, `${acc.role} accessed /api/ai/insights (HTTP 200)`);
      assert(data.success === true, `${acc.role} received success: true`);
      assert(data.role === acc.role, `${acc.role} role context correctly identified`);
      assert(data.kpis && typeof data.kpis.totalProductsMonitored === 'number', `${acc.role} received valid KPIs (${data.kpis.totalProductsMonitored} products monitored)`);
      assert(Array.isArray(data.topHighDemand), `${acc.role} received Top High Demand array`);
      assert(Array.isArray(data.atRiskOfStockout), `${acc.role} received Stockout Risks array`);
      assert(Array.isArray(data.restockingRecommendations), `${acc.role} received Restocking Recommendations array`);
      assert(Array.isArray(data.monthlyDemandPredictions), `${acc.role} received Monthly Category Demand array`);
    }

    // 3. Test GET /api/ai/forecasts
    console.log('\n3. Testing GET /api/ai/forecasts data validity...');
    const ownerToken = tokens['owner'];
    const forecastsRes = await fetch(`${BASE_URL}/ai/forecasts`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    const forecastsData = await forecastsRes.json();

    assert(forecastsRes.status === 200, 'GET /api/ai/forecasts returned 200');
    const forecasts = forecastsData.forecasts;
    assert(forecasts.length >= 24, `Returned ${forecasts.length} product forecasts`);

    // Check insufficient data handling
    const insufficientItems = forecasts.filter(f => !f.hasSufficientData);
    assert(insufficientItems.length > 0, `Identified ${insufficientItems.length} products with insufficient data`);
    const firstInsufficient = insufficientItems[0];
    assert(
      firstInsufficient.statusMessage === 'Insufficient data for accurate forecasting.',
      `Insufficient product clearly labeled: "${firstInsufficient.statusMessage}"`
    );
    assert(firstInsufficient.forecast7d === null && firstInsufficient.forecast30d === null, 'No fake predictions generated for insufficient items');

    // Check sufficient data calculations
    const sufficientItems = forecasts.filter(f => f.hasSufficientData);
    assert(sufficientItems.length > 0, `Identified ${sufficientItems.length} products with sufficient sales data`);
    const firstSufficient = sufficientItems[0];
    assert(firstSufficient.averageDailySales > 0, `Average daily sales calculated: ${firstSufficient.averageDailySales} units/day`);
    assert(typeof firstSufficient.forecast7d === 'number', `7-day demand forecast: ${firstSufficient.forecast7d} units`);
    assert(typeof firstSufficient.forecast30d === 'number', `30-day demand forecast: ${firstSufficient.forecast30d} units`);
    assert(typeof firstSufficient.forecast90d === 'number', `90-day demand forecast: ${firstSufficient.forecast90d} units`);
    assert(['increasing', 'decreasing', 'steady'].includes(firstSufficient.trend), `Trend classification: ${firstSufficient.trend}`);
    assert(['CRITICAL', 'WARNING', 'NORMAL'].includes(firstSufficient.stockStatus), `Stock status classification: ${firstSufficient.stockStatus}`);

    // 4. Test GET /api/ai/forecasts/:productId detail endpoint
    console.log('\n4. Testing GET /api/ai/forecasts/:productId for chart rendering...');
    const detailSufficientRes = await fetch(`${BASE_URL}/ai/forecasts/${firstSufficient.productId}`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    const detailSufficient = await detailSufficientRes.json();

    assert(detailSufficientRes.status === 200, `Fetched details for ${firstSufficient.productName}`);
    assert(detailSufficient.chartData.hasSufficientData === true, 'chartData.hasSufficientData is true');
    assert(detailSufficient.chartData.historical.length === 30, 'Historical series has 30 daily buckets');
    assert(detailSufficient.chartData.forecast7d.length === 7, '7-day forecast series has 7 daily projections');
    assert(detailSufficient.chartData.forecast30d.length === 30, '30-day forecast series has 30 daily projections');
    assert(detailSufficient.chartData.forecast90d.length === 90, '90-day forecast series has 90 daily projections');

    const detailInsufficientRes = await fetch(`${BASE_URL}/ai/forecasts/${firstInsufficient.productId}`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    const detailInsufficient = await detailInsufficientRes.json();

    assert(detailInsufficientRes.status === 200, `Fetched details for insufficient product ${firstInsufficient.productName}`);
    assert(detailInsufficient.chartData.hasSufficientData === false, 'chartData.hasSufficientData is false for insufficient item');

    // 5. Test POST /api/ai/trigger-alerts
    console.log('\n5. Testing POST /api/ai/trigger-alerts and PostgreSQL notifications integration...');
    const alertsRes = await fetch(`${BASE_URL}/ai/trigger-alerts`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ownerToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });
    const alertsData = await alertsRes.json();

    assert(alertsRes.status === 200, 'POST /api/ai/trigger-alerts returned 200');
    assert(typeof alertsData.alertsCount === 'number', `Alerts evaluation completed: ${alertsData.alertsCount} notifications evaluated`);

    // Verify notifications saved in PostgreSQL
    const notifsRes = await fetch(`${BASE_URL}/notifications`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    const notifsData = await notifsRes.json();

    assert(notifsRes.status === 200, 'GET /api/notifications returned 200');
    const notifs = notifsData.notifications;
    assert(notifs.length > 0, `Notifications table populated (${notifs.length} notifications present)`);

    const hasLowStock = notifs.some(n => n.type === 'low_stock');
    assert(hasLowStock, 'Found low_stock notification generated by AI engine');

    console.log('\n====================================================');
    console.log(`AUDIT COMPLETE: ${passed} PASSED, ${failed} FAILED`);
    console.log('====================================================');
  } finally {
    server.close();
    await pool.end();
    process.exit(failed > 0 ? 1 : 0);
  }
}

runE2ETests().catch(err => {
  console.error('E2E Audit crashed:', err);
  process.exit(1);
});
