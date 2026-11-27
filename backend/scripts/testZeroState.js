import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

const { getDashboard, getAnalytics } = await import('../services/dashboardService.js');

// We can test empty state by creating a mock pool or calling getDashboard with an empty dataset
// Let's create an in-memory stub that simulates empty business tables
const origPool = (await import('../config/db.js')).pool;

// Create simulated empty pool queries
const emptyPool = {
  async query(text) {
    if (text.includes('FROM users')) {
      return { rows: [{ id: '1', role: 'owner', status: 'active' }, { id: '2', role: 'product', status: 'active' }] };
    }
    if (text.includes('FROM categories')) {
      return { rows: [{ id: 'cat-1', name: 'Electronics' }] };
    }
    // All business data: products, sales, sale_items, stock, po, orders, suppliers, activity, notif are EMPTY!
    return { rows: [] };
  }
};

async function testZeroState() {
  console.log('=== Testing Zero / Cleared State for All 6 Dashboards ===');
  
  // Temporarily swap query function
  const realQuery = origPool.query;
  origPool.query = emptyPool.query;

  const roles = ['owner', 'product', 'sales', 'stock', 'purchase', 'orders'];

  try {
    for (const role of roles) {
      console.log(`\nChecking empty state for: ${role.toUpperCase()}`);
      const dash = await getDashboard(role);
      
      console.log('KPIs in empty state:');
      for (const [k, v] of Object.entries(dash.kpis)) {
        console.log(`  ${k}: ${v.value}`);
      }

      // Assertions
      if (role === 'owner') {
        if (dash.kpis.totalProducts.value !== 0) throw new Error('totalProducts should be 0');
        if (dash.kpis.lowStockItems.value !== 0) throw new Error('lowStockItems should be 0');
        if (!dash.charts.trend.series[0].data.every(val => val === 0)) throw new Error('Revenue trend should be all zeroes');
      } else if (role === 'product') {
        if (dash.kpis.totalProducts.value !== 0) throw new Error('totalProducts should be 0');
        if (dash.kpis.outOfStock.value !== 0) throw new Error('outOfStock should be 0');
        if (dash.kpis.lowStock.value !== 0) throw new Error('lowStock should be 0');
      } else if (role === 'sales') {
        if (dash.kpis.todaySales.value !== 0) throw new Error('todaySales should be 0');
        if (dash.kpis.monthlySales.value !== 0) throw new Error('monthlySales should be 0');
        if (dash.kpis.completedSales.value !== 0) throw new Error('completedSales should be 0');
        if (dash.kpis.topProducts.value !== '—') throw new Error('topProducts should be —');
      } else if (role === 'stock') {
        if (dash.kpis.stockIn.value !== 0) throw new Error('stockIn should be 0');
        if (dash.kpis.stockOut.value !== 0) throw new Error('stockOut should be 0');
        if (dash.kpis.adjustments.value !== 0) throw new Error('adjustments should be 0');
        if (dash.kpis.stockAlerts.value !== 0) throw new Error('stockAlerts should be 0');
      } else if (role === 'purchase') {
        if (dash.kpis.openOrders.value !== 0) throw new Error('openOrders should be 0');
        if (dash.kpis.pendingReceipts.value !== 0) throw new Error('pendingReceipts should be 0');
        if (dash.kpis.suppliers.value !== 0) throw new Error('suppliers should be 0');
        if (dash.kpis.monthlyValue.value !== 0) throw new Error('monthlyValue should be 0');
      } else if (role === 'orders') {
        if (dash.kpis.newOrders.value !== 0) throw new Error('newOrders should be 0');
        if (dash.kpis.processing.value !== 0) throw new Error('processing should be 0');
        if (dash.kpis.completed.value !== 0) throw new Error('completed should be 0');
        if (dash.kpis.cancelled.value !== 0) throw new Error('cancelled should be 0');
      }

      console.log(`✓ ${role.toUpperCase()} passed empty state check.`);
    }

    console.log('\n=== All 6 dashboards successfully verified in empty/zero state! ===');
  } finally {
    origPool.query = realQuery;
    await origPool.end();
  }
}

testZeroState().catch((err) => {
  console.error('Zero state test failed:', err);
  process.exit(1);
});
