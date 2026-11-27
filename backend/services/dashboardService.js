import { pool } from '../config/db.js';

// Get dashboard data for a specific role
export async function getDashboard(roleKey) {
  try {
    // 1. Fetch live data from PostgreSQL
    const [usersRes, productsRes, categoriesRes, salesRes, saleItemsRes, stockRes, poRes, ordersRes, suppliersRes, activityRes, notifRes] = await Promise.all([
      pool.query('SELECT * FROM users'),
      pool.query('SELECT * FROM products ORDER BY name ASC'),
      pool.query('SELECT * FROM categories ORDER BY name ASC'),
      pool.query('SELECT * FROM sales ORDER BY date DESC'),
      pool.query('SELECT * FROM sale_items'),
      pool.query('SELECT * FROM stock_transactions ORDER BY date DESC'),
      pool.query('SELECT * FROM purchase_orders ORDER BY date DESC'),
      pool.query('SELECT * FROM orders ORDER BY date DESC'),
      pool.query('SELECT * FROM suppliers ORDER BY name ASC'),
      pool.query(`SELECT a.*, u.name as user_name FROM user_activity a LEFT JOIN users u ON a.user_id = u.id ORDER BY a.created_at DESC LIMIT 10`),
      pool.query('SELECT * FROM notifications ORDER BY created_at DESC LIMIT 10'),
    ]);

    const users = usersRes.rows;
    const products = productsRes.rows;
    const categories = categoriesRes.rows;
    const sales = salesRes.rows;
    const saleItems = saleItemsRes.rows;
    const stockTransactions = stockRes.rows;
    const purchaseOrders = poRes.rows;
    const orders = ordersRes.rows;
    const suppliers = suppliersRes.rows;
    const activities = activityRes.rows;
    const notifications = notifRes.rows;

    // Helper statistics
    const outOfStockProducts = products.filter((p) => Number(p.quantity) <= 0);
    const lowStockProducts = products.filter((p) => {
      const q = Number(p.quantity);
      const m = Number(p.min_level);
      return q > 0 && q <= m;
    });

    const now = new Date();
    const todayStr = now.toDateString();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    // Sales metrics
    const todaySalesTotal = sales
      .filter((s) => new Date(s.date).toDateString() === todayStr)
      .reduce((sum, s) => sum + Number(s.total || 0), 0);

    const monthlySalesTotal = sales
      .filter((s) => {
        const d = new Date(s.date);
        return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
      })
      .reduce((sum, s) => sum + Number(s.total || 0), 0);

    // Stock metrics (current month)
    const currentMonthStock = stockTransactions.filter((t) => {
      const d = new Date(t.date);
      return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
    });
    const stockInTotal = currentMonthStock.filter((t) => t.type === 'in').reduce((sum, t) => sum + Number(t.quantity || 0), 0);
    const stockOutTotal = currentMonthStock.filter((t) => t.type === 'out').reduce((sum, t) => sum + Number(t.quantity || 0), 0);
    const adjustmentsCount = currentMonthStock.filter((t) => t.type === 'adjustment').length;

    // Purchase metrics
    const openPOs = purchaseOrders.filter((po) => po.status !== 'Received' && po.status !== 'Cancelled');
    const pendingReceiptsTotal = openPOs.reduce((sum, po) => sum + Math.max(0, Number(po.qty_ordered || 0) - Number(po.qty_received || 0)), 0);
    const monthlyPurchaseValue = purchaseOrders
      .filter((po) => {
        const d = new Date(po.date);
        return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
      })
      .reduce((sum, po) => sum + Number(po.total || 0), 0);

    // Order metrics
    const newOrdersCount = orders.filter((o) => (o.status || '').toLowerCase() === 'new').length;
    const processingOrdersCount = orders.filter((o) => (o.status || '').toLowerCase() === 'processing').length;
    const completedOrdersCount = orders.filter((o) => (o.status || '').toLowerCase() === 'completed').length;
    const cancelledOrdersCount = orders.filter((o) => (o.status || '').toLowerCase() === 'cancelled').length;

    // Helper: Days of week for last 7 days
    const last7Days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      last7Days.push(d.toLocaleDateString('en-US', { weekday: 'short' }));
    }

    // Helper: Months for last 6 months
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const past6Months = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      past6Months.push(months[d.getMonth()]);
    }

    // Recent activity builder
    function timeAgo(date) {
      const seconds = Math.floor((new Date() - new Date(date)) / 1000);
      if (seconds < 60) return 'Just now';
      const minutes = Math.floor(seconds / 60);
      if (minutes < 60) return `${minutes}m ago`;
      const hours = Math.floor(minutes / 60);
      if (hours < 24) return `${hours}h ago`;
      const days = Math.floor(hours / 24);
      return `${days}d ago`;
    }

    const recentActivity = activities.slice(0, 5).map((a) => {
      let iconName = 'activity';
      let tone = 'accent';
      if (a.module === 'Products') { iconName = 'box'; tone = 'accent'; }
      else if (a.module === 'Sales') { iconName = 'sales'; tone = 'success'; }
      else if (a.module === 'Stock') { iconName = 'stock'; tone = 'warning'; }
      else if (a.module === 'Purchase') { iconName = 'purchase'; tone = 'info'; }
      else if (a.module === 'Orders') { iconName = 'orders'; tone = 'accent'; }
      else if (a.module === 'User Management') { iconName = 'users'; tone = 'info'; }

      return {
        id: a.id,
        title: a.action,
        module: a.module,
        time: timeAgo(a.created_at),
        icon: iconName,
        tone,
      };
    });

    // Default alerts from low stock or notifications
    const defaultAlerts = [
      ...lowStockProducts.slice(0, 3).map((p) => ({
        id: p.id,
        title: `Low stock: ${p.name}`,
        message: `${p.quantity} units left · min level ${p.min_level}`,
        tone: 'warning',
        icon: 'alertTriangle',
      })),
      ...outOfStockProducts.slice(0, 2).map((p) => ({
        id: p.id,
        title: `Out of stock: ${p.name}`,
        message: 'No units remaining in warehouse',
        tone: 'danger',
        icon: 'xCircle',
      })),
    ];

    let kpis = {};
    let charts = {};
    let alerts = defaultAlerts;

    if (roleKey === 'owner') {
      kpis = {
        totalUsers: { value: users.length, format: 'number' },
        activeUsers: { value: users.filter((u) => u.status === 'active').length, format: 'number' },
        totalProducts: { value: products.length, format: 'number' },
        lowStockItems: { value: lowStockProducts.length + outOfStockProducts.length, format: 'number' },
      };

      // 6-month revenue trend
      const past6Data = [];
      for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const mTotal = sales
          .filter((s) => {
            const sd = new Date(s.date);
            return sd.getMonth() === d.getMonth() && sd.getFullYear() === d.getFullYear();
          })
          .reduce((sum, s) => sum + Number(s.total || 0), 0);
        past6Data.push(mTotal);
      }

      charts = {
        trend: {
          title: 'Revenue trend',
          subtitle: 'Total sales value over the last six months',
          type: 'line',
          format: 'currency',
          labels: past6Months,
          series: [{ label: 'Revenue', data: past6Data, tone: 'accent', fill: true }],
        },
        breakdown: {
          title: 'Stock by category',
          subtitle: 'Units currently on hand',
          type: 'bar',
          format: 'number',
          labels: categories.length > 0 ? categories.map((c) => c.name) : ['No categories'],
          data: categories.length > 0 ? categories.map((c) =>
            products
              .filter((p) => p.category_id === c.id)
              .reduce((sum, p) => sum + Number(p.quantity || 0), 0)
          ) : [0],
          tones: ['accent', 'info', 'success', 'warning', 'danger'],
        },
      };
    } else if (roleKey === 'product') {
      kpis = {
        totalProducts: { value: products.length, format: 'number' },
        categories: { value: categories.length, format: 'number' },
        outOfStock: { value: outOfStockProducts.length, format: 'number' },
        lowStock: { value: lowStockProducts.length, format: 'number' },
      };

      // Cumulative product growth over past 6 months
      const past6ProductGrowth = [];
      for (let i = 5; i >= 0; i--) {
        const endOfMonth = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59);
        const count = products.filter((p) => new Date(p.created_at) <= endOfMonth).length;
        past6ProductGrowth.push(count);
      }

      charts = {
        trend: {
          title: 'Catalogue growth',
          subtitle: 'Cumulative products over the last six months',
          type: 'bar',
          format: 'number',
          labels: past6Months,
          series: [{ label: 'Products', data: past6ProductGrowth, tone: 'accent' }],
        },
        breakdown: {
          title: 'Products by category',
          subtitle: 'Distribution across the catalogue',
          type: 'doughnut',
          format: 'number',
          labels: categories.length > 0 ? categories.map((c) => c.name) : ['No categories'],
          data: categories.length > 0 ? categories.map((c) => products.filter((p) => p.category_id === c.id).length) : [0],
          tones: ['accent', 'info', 'success', 'warning', 'danger'],
        },
      };
    } else if (roleKey === 'sales') {
      // Determine top product from sale_items
      let topSellingProductName = '—';
      let topSellingProductNote = 'No sales recorded';
      const productQtyMap = {};
      for (const item of saleItems) {
        const pid = String(item.product_id);
        productQtyMap[pid] = (productQtyMap[pid] || 0) + Number(item.quantity || 0);
      }
      let bestProdId = null;
      let maxSoldQty = 0;
      for (const [pid, qty] of Object.entries(productQtyMap)) {
        if (qty > maxSoldQty) {
          maxSoldQty = qty;
          bestProdId = pid;
        }
      }
      if (bestProdId) {
        const matched = products.find((p) => String(p.id) === bestProdId);
        if (matched) {
          topSellingProductName = matched.name;
          topSellingProductNote = `${maxSoldQty} units sold`;
        }
      }

      kpis = {
        todaySales: { value: todaySalesTotal, format: 'currency' },
        monthlySales: { value: monthlySalesTotal, format: 'currency' },
        completedSales: { value: sales.length, format: 'number' },
        topProducts: { value: topSellingProductName, format: 'text', note: topSellingProductNote },
      };

      const last7Sales = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
        const dayTotal = sales
          .filter((s) => new Date(s.date).toDateString() === d.toDateString())
          .reduce((sum, s) => sum + Number(s.total || 0), 0);
        last7Sales.push(dayTotal);
      }

      // Top products moved breakdown
      const sortedSold = Object.entries(productQtyMap)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4);

      const topLabels = sortedSold.length > 0
        ? sortedSold.map(([pid]) => products.find((p) => String(p.id) === pid)?.name || 'Unknown')
        : ['No sales recorded'];
      const topData = sortedSold.length > 0
        ? sortedSold.map(([, qty]) => qty)
        : [0];

      charts = {
        trend: {
          title: 'Revenue',
          subtitle: 'Daily sales value over the last seven days',
          type: 'line',
          format: 'currency',
          labels: last7Days,
          series: [{ label: 'Revenue', data: last7Sales, tone: 'accent', fill: true }],
        },
        breakdown: {
          title: 'Top products',
          subtitle: 'Units moved all time',
          type: 'bar',
          horizontal: true,
          format: 'number',
          labels: topLabels,
          data: topData,
          tones: ['accent'],
        },
      };
    } else if (roleKey === 'stock') {
      kpis = {
        stockIn: { value: stockInTotal, format: 'number' },
        stockOut: { value: stockOutTotal, format: 'number' },
        adjustments: { value: adjustmentsCount, format: 'number' },
        stockAlerts: {
          value: lowStockProducts.length + outOfStockProducts.length,
          format: 'number',
          note: (lowStockProducts.length + outOfStockProducts.length) > 0
            ? `${lowStockProducts.length} low stock · ${outOfStockProducts.length} out of stock`
            : 'All stock levels healthy',
        },
      };

      const inCount = stockTransactions.filter((t) => t.type === 'in').length;
      const outCount = stockTransactions.filter((t) => t.type === 'out').length;
      const adjCount = stockTransactions.filter((t) => t.type === 'adjustment').length;

      // Real 7-day movement
      const last7StockIn = [];
      const last7StockOut = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
        const inQty = stockTransactions
          .filter((t) => t.type === 'in' && new Date(t.date).toDateString() === d.toDateString())
          .reduce((sum, t) => sum + Number(t.quantity || 0), 0);
        const outQty = stockTransactions
          .filter((t) => t.type === 'out' && new Date(t.date).toDateString() === d.toDateString())
          .reduce((sum, t) => sum + Number(t.quantity || 0), 0);
        last7StockIn.push(inQty);
        last7StockOut.push(outQty);
      }

      charts = {
        trend: {
          title: 'Warehouse movement',
          subtitle: 'Units received and issued over the last seven days',
          type: 'line',
          format: 'number',
          labels: last7Days,
          series: [
            { label: 'Stock in', data: last7StockIn, tone: 'success', fill: true },
            { label: 'Stock out', data: last7StockOut, tone: 'warning', fill: true },
          ],
        },
        breakdown: {
          title: 'Movement types',
          subtitle: 'All recorded stock transactions',
          type: 'doughnut',
          format: 'number',
          labels: ['Stock in', 'Stock out', 'Adjustments'],
          data: [inCount, outCount, adjCount],
          tones: ['success', 'warning', 'info'],
        },
      };
    } else if (roleKey === 'purchase') {
      kpis = {
        openOrders: { value: openPOs.length, format: 'number' },
        pendingReceipts: { value: pendingReceiptsTotal, format: 'number', note: 'Units still due' },
        suppliers: { value: suppliers.length, format: 'number' },
        monthlyValue: { value: monthlyPurchaseValue, format: 'currency' },
      };

      const pendingCount = purchaseOrders.filter((po) => po.status === 'Pending').length;
      const partialCount = purchaseOrders.filter((po) => po.status === 'Partially Received').length;
      const receivedCount = purchaseOrders.filter((po) => po.status === 'Received').length;

      const supplierSpend = suppliers.slice(0, 5).map((s) => ({
        name: s.name,
        spend: purchaseOrders
          .filter((po) => po.supplier_id === s.id)
          .reduce((sum, po) => sum + Number(po.total || 0), 0),
      }));

      charts = {
        trend: {
          title: 'Purchase value',
          subtitle: 'Spend by supplier',
          type: 'bar',
          format: 'currency',
          labels: supplierSpend.length > 0 ? supplierSpend.map((s) => s.name) : ['No suppliers'],
          data: supplierSpend.length > 0 ? supplierSpend.map((s) => s.spend) : [0],
          tones: ['accent'],
        },
        breakdown: {
          title: 'Order status',
          subtitle: 'Where purchase orders currently stand',
          type: 'doughnut',
          format: 'number',
          labels: ['Pending', 'Partially Received', 'Received'],
          data: [pendingCount, partialCount, receivedCount],
          tones: ['warning', 'info', 'success'],
        },
      };
    } else {
      // Orders
      kpis = {
        newOrders: { value: newOrdersCount, format: 'number' },
        processing: { value: processingOrdersCount, format: 'number' },
        completed: { value: completedOrdersCount, format: 'number' },
        cancelled: { value: cancelledOrdersCount, format: 'number' },
      };

      // Real 7-day order counts
      const last7Orders = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
        const dayCount = orders.filter((o) => {
          const od = new Date(o.date || o.created_at);
          return od.toDateString() === d.toDateString();
        }).length;
        last7Orders.push(dayCount);
      }

      charts = {
        trend: {
          title: 'Order volume',
          subtitle: 'Recent order pipeline status over the last seven days',
          type: 'line',
          format: 'number',
          labels: last7Days,
          series: [{ label: 'Orders', data: last7Orders, tone: 'accent', fill: true }],
        },
        breakdown: {
          title: 'Order status',
          subtitle: 'Current pipeline distribution',
          type: 'doughnut',
          format: 'number',
          labels: ['New', 'Processing', 'Completed', 'Cancelled'],
          data: [newOrdersCount, processingOrdersCount, completedOrdersCount, cancelledOrdersCount],
          tones: ['accent', 'info', 'success', 'danger'],
        },
      };
    }

    return {
      kpis,
      charts,
      recentActivity,
      alerts,
    };
  } catch (error) {
    console.error('Get dashboard error:', error);
    throw error;
  }
}

// Get analytics data for a specific role
export async function getAnalytics(roleKey, days = 30) {
  try {
    const buckets = [];
    const now = new Date();

    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(now.getDate() - i);
      date.setHours(0, 0, 0, 0);
      buckets.push(date);
    }

    const labels = buckets.map((b) => b.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));

    // Fetch live data
    const [usersRes, productsRes, categoriesRes, salesRes, saleItemsRes, stockRes, poRes, ordersRes, suppliersRes] = await Promise.all([
      pool.query('SELECT * FROM users'),
      pool.query('SELECT * FROM products ORDER BY name ASC'),
      pool.query('SELECT * FROM categories ORDER BY name ASC'),
      pool.query('SELECT * FROM sales ORDER BY date DESC'),
      pool.query('SELECT * FROM sale_items'),
      pool.query('SELECT * FROM stock_transactions ORDER BY date DESC'),
      pool.query('SELECT * FROM purchase_orders ORDER BY date DESC'),
      pool.query('SELECT * FROM orders ORDER BY date DESC'),
      pool.query('SELECT * FROM suppliers ORDER BY name ASC'),
    ]);

    const users = usersRes.rows;
    const products = productsRes.rows;
    const categories = categoriesRes.rows;
    const sales = salesRes.rows;
    const saleItems = saleItemsRes.rows;
    const stockTransactions = stockRes.rows;
    const purchaseOrders = poRes.rows;
    const orders = ordersRes.rows;
    const suppliers = suppliersRes.rows;

    const lowStockCount = products.filter((p) => {
      const q = Number(p.quantity);
      const m = Number(p.min_level);
      return q <= m;
    }).length;

    let summary = [];
    let trend = {};
    let breakdown = {};

    const totalRevenue = sales.reduce((sum, s) => sum + Number(s.total || 0), 0);

    if (roleKey === 'owner') {
      summary = [
        { label: 'Revenue', value: totalRevenue, format: 'currency', icon: 'creditCard' },
        { label: 'Orders', value: orders.length, format: 'number', icon: 'orders' },
        { label: 'Stock alerts', value: lowStockCount, format: 'number', icon: 'alertTriangle' },
      ];

      const revenueByBucket = buckets.map((b) => {
        return sales
          .filter((s) => new Date(s.date).toDateString() === b.toDateString())
          .reduce((sum, s) => sum + Number(s.total || 0), 0);
      });

      trend = {
        title: 'Revenue trend',
        format: 'currency',
        series: [{ label: 'Revenue', data: revenueByBucket, tone: 'accent', fill: true }],
      };

      breakdown = {
        title: 'Users by role',
        type: 'doughnut',
        format: 'number',
        labels: ['Owner', 'Product', 'Sales', 'Stock', 'Purchase', 'Orders'],
        data: ['owner', 'product', 'sales', 'stock', 'purchase', 'orders'].map((r) =>
          users.filter((u) => u.role === r).length
        ),
        tones: ['accent', 'warning', 'success', 'info', 'danger', 'neutral'],
      };
    } else if (roleKey === 'product') {
      summary = [
        { label: 'Products', value: products.length, format: 'number', icon: 'box' },
        { label: 'Categories', value: categories.length, format: 'number', icon: 'layers' },
        { label: 'Stock alerts', value: lowStockCount, format: 'number', icon: 'alertTriangle' },
      ];

      const productGrowthByBucket = buckets.map((b) => {
        const endOfBucket = new Date(b.getTime() + 86400000 - 1);
        return products.filter((p) => new Date(p.created_at) <= endOfBucket).length;
      });

      trend = {
        title: 'Catalogue growth',
        format: 'number',
        series: [{ label: 'Products', data: productGrowthByBucket, tone: 'accent' }],
      };

      breakdown = {
        title: 'Products by category',
        type: 'doughnut',
        format: 'number',
        labels: categories.length > 0 ? categories.map((c) => c.name) : ['No categories'],
        data: categories.length > 0 ? categories.map((c) => products.filter((p) => p.category_id === c.id).length) : [0],
        tones: ['accent', 'info', 'success', 'warning', 'danger'],
      };
    } else if (roleKey === 'sales') {
      summary = [
        { label: 'Revenue', value: totalRevenue, format: 'currency', icon: 'creditCard' },
        { label: 'Sales', value: sales.length, format: 'number', icon: 'sales' },
        { label: 'Average sale', value: sales.length ? Math.round(totalRevenue / sales.length) : 0, format: 'currency', icon: 'trendingUp' },
      ];

      const salesByBucket = buckets.map((b) => {
        return sales
          .filter((s) => new Date(s.date).toDateString() === b.toDateString())
          .reduce((sum, s) => sum + Number(s.total || 0), 0);
      });

      trend = {
        title: 'Revenue trend',
        format: 'currency',
        series: [{ label: 'Revenue', data: salesByBucket, tone: 'accent', fill: true }],
      };

      // Top products by units sold
      const productSalesMap = {};
      for (const item of saleItems) {
        const pid = String(item.product_id);
        productSalesMap[pid] = (productSalesMap[pid] || 0) + Number(item.quantity || 0);
      }
      const sortedByQty = Object.entries(productSalesMap)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);

      const topLabels = sortedByQty.length > 0
        ? sortedByQty.map(([pid]) => products.find((p) => String(p.id) === pid)?.name || 'Unknown')
        : (products.length > 0 ? products.slice(0, 5).map((p) => p.name) : ['No products']);
      const topData = sortedByQty.length > 0
        ? sortedByQty.map(([, qty]) => qty)
        : (products.length > 0 ? products.slice(0, 5).map(() => 0) : [0]);

      breakdown = {
        title: 'Top products',
        type: 'bar',
        horizontal: true,
        format: 'number',
        labels: topLabels,
        data: topData,
        tones: ['accent'],
      };
    } else if (roleKey === 'stock') {
      const inQty = stockTransactions.filter((t) => t.type === 'in').reduce((sum, t) => sum + Number(t.quantity || 0), 0);
      const outQty = stockTransactions.filter((t) => t.type === 'out').reduce((sum, t) => sum + Number(t.quantity || 0), 0);

      summary = [
        { label: 'Units received', value: inQty, format: 'number', icon: 'arrowDownCircle' },
        { label: 'Units issued', value: outQty, format: 'number', icon: 'arrowUpCircle' },
        { label: 'Transactions', value: stockTransactions.length, format: 'number', icon: 'stock' },
      ];

      const stockInByBucket = buckets.map((b) => {
        return stockTransactions
          .filter((t) => t.type === 'in' && new Date(t.date).toDateString() === b.toDateString())
          .reduce((sum, t) => sum + Number(t.quantity || 0), 0);
      });

      const stockOutByBucket = buckets.map((b) => {
        return stockTransactions
          .filter((t) => t.type === 'out' && new Date(t.date).toDateString() === b.toDateString())
          .reduce((sum, t) => sum + Number(t.quantity || 0), 0);
      });

      trend = {
        title: 'Stock movement',
        format: 'number',
        series: [
          { label: 'Stock in', data: stockInByBucket, tone: 'success', fill: true },
          { label: 'Stock out', data: stockOutByBucket, tone: 'warning', fill: true },
        ],
      };

      breakdown = {
        title: 'Movement types',
        type: 'doughnut',
        format: 'number',
        labels: ['Stock in', 'Stock out', 'Adjustments'],
        data: [
          stockTransactions.filter((t) => t.type === 'in').length,
          stockTransactions.filter((t) => t.type === 'out').length,
          stockTransactions.filter((t) => t.type === 'adjustment').length,
        ],
        tones: ['success', 'warning', 'info'],
      };
    } else if (roleKey === 'purchase') {
      const totalPoSpend = purchaseOrders.reduce((sum, po) => sum + Number(po.total || 0), 0);

      summary = [
        { label: 'Purchase value', value: totalPoSpend, format: 'currency', icon: 'creditCard' },
        { label: 'Purchase orders', value: purchaseOrders.length, format: 'number', icon: 'purchase' },
        { label: 'Suppliers', value: suppliers.length, format: 'number', icon: 'briefcase' },
      ];

      const purchaseByBucket = buckets.map((b) => {
        return purchaseOrders
          .filter((po) => new Date(po.date).toDateString() === b.toDateString())
          .reduce((sum, po) => sum + Number(po.total || 0), 0);
      });

      trend = {
        title: 'Purchase value',
        format: 'currency',
        series: [{ label: 'Purchase value', data: purchaseByBucket, tone: 'accent' }],
      };

      breakdown = {
        title: 'Purchase status',
        type: 'doughnut',
        format: 'number',
        labels: ['Pending', 'Partially Received', 'Received'],
        data: [
          purchaseOrders.filter((po) => po.status === 'Pending').length,
          purchaseOrders.filter((po) => po.status === 'Partially Received').length,
          purchaseOrders.filter((po) => po.status === 'Received').length,
        ],
        tones: ['warning', 'info', 'success'],
      };
    } else {
      // Orders
      summary = [
        { label: 'Orders', value: orders.length, format: 'number', icon: 'orders' },
        {
          label: 'Completed rate',
          value: orders.length ? Math.round((orders.filter((o) => (o.status || '').toLowerCase() === 'completed').length / orders.length) * 100) : 0,
          format: 'percent',
          icon: 'checkCircle',
        },
        { label: 'Order value', value: orders.reduce((sum, o) => sum + Number(o.total || 0), 0), format: 'currency', icon: 'creditCard' },
      ];

      const ordersByBucket = buckets.map((b) => {
        return orders.filter((o) => {
          const od = new Date(o.date || o.created_at);
          return od.toDateString() === b.toDateString();
        }).length;
      });

      trend = {
        title: 'Order volume',
        format: 'number',
        series: [{ label: 'Orders', data: ordersByBucket, tone: 'accent', fill: true }],
      };

      breakdown = {
        title: 'Order status',
        type: 'doughnut',
        format: 'number',
        labels: ['New', 'Processing', 'Completed', 'Cancelled'],
        data: [
          orders.filter((o) => (o.status || '').toLowerCase() === 'new').length,
          orders.filter((o) => (o.status || '').toLowerCase() === 'processing').length,
          orders.filter((o) => (o.status || '').toLowerCase() === 'completed').length,
          orders.filter((o) => (o.status || '').toLowerCase() === 'cancelled').length,
        ],
        tones: ['accent', 'info', 'success', 'danger'],
      };
    }

    trend.type = 'line';
    trend.labels = labels;

    return { summary, trend, breakdown };
  } catch (error) {
    console.error('Get analytics error:', error);
    throw error;
  }
}
