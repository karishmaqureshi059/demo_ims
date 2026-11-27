import { pool } from '../config/db.js';
import { addNotification } from '../utils/notifications.js';

/**
 * AI-Based Inventory Forecasting & Smart Stock Alerts Service
 * Analyzes actual historical sales from PostgreSQL / Supabase,
 * computes statistical trends, seasonality, demand forecasts (7/30/90 days),
 * stockout risk, and automated restocking recommendations.
 */

// Helper: Calculate linear regression slope (y = mx + b)
function calculateLinearRegression(points) {
  const n = points.length;
  if (n < 2) return { slope: 0, intercept: points[0]?.y || 0 };

  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;

  for (let i = 0; i < n; i++) {
    const x = points[i].x;
    const y = points[i].y;
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumXX += x * x;
  }

  const denominator = n * sumXX - sumX * sumX;
  if (denominator === 0) return { slope: 0, intercept: sumY / n };

  const slope = (n * sumXY - sumX * sumY) / denominator;
  const intercept = (sumY - slope * sumX) / n;

  return { slope, intercept };
}

// Helper: Format date to YYYY-MM-DD
function formatDate(d) {
  const date = new Date(d);
  return date.toISOString().split('T')[0];
}

// Helper: Add days to date
function addDays(d, days) {
  const result = new Date(d);
  result.setDate(result.getDate() + days);
  return result;
}

export class AiForecastService {
  /**
   * Retrieves all product sales history and computes forecasts for all products.
   * @param {Object} [options]
   * @param {string} [options.role='owner']
   * @returns {Promise<Object>}
   */
  static async getAllForecasts(role = 'owner') {
    // 1. Fetch all products with category info
    const productsRes = await pool.query(`
      SELECT p.id, p.name, p.sku, p.price, p.quantity, p.min_level, p.status,
             c.name as category_name
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      ORDER BY p.name ASC
    `);

    // 2. Fetch all sales history
    const salesRes = await pool.query(`
      SELECT si.product_id, si.quantity, si.unit_price, s.date
      FROM sale_items si
      JOIN sales s ON si.sale_id = s.id
      WHERE s.status = 'completed'
      ORDER BY s.date ASC
    `);

    // 3. Fetch supplier lead times from purchase orders
    const leadTimesRes = await pool.query(`
      SELECT poi.product_id, po.supplier_id,
             EXTRACT(EPOCH FROM (po.received_at - po.date))/86400 as lead_days
      FROM purchase_order_items poi
      JOIN purchase_orders po ON poi.purchase_order_id = po.id
      WHERE LOWER(po.status::text) = 'received' AND po.received_at IS NOT NULL
    `);

    // Group sales by product
    const salesByProduct = {};
    salesRes.rows.forEach((row) => {
      if (!salesByProduct[row.product_id]) salesByProduct[row.product_id] = [];
      salesByProduct[row.product_id].push({
        quantity: Number(row.quantity) || 0,
        unitPrice: Number(row.unit_price) || 0,
        date: new Date(row.date),
      });
    });

    // Group lead times by product
    const leadTimesByProduct = {};
    leadTimesRes.rows.forEach((row) => {
      const days = Math.round(Number(row.lead_days));
      if (days > 0) {
        if (!leadTimesByProduct[row.product_id]) leadTimesByProduct[row.product_id] = [];
        leadTimesByProduct[row.product_id].push(days);
      }
    });

    const forecasts = [];

    for (const prod of productsRes.rows) {
      const productSales = salesByProduct[prod.id] || [];
      const productLeadTimes = leadTimesByProduct[prod.id] || [];
      const avgLeadTime = productLeadTimes.length > 0
        ? Math.round(productLeadTimes.reduce((a, b) => a + b, 0) / productLeadTimes.length)
        : 5; // Default lead time: 5 business days

      const analysis = this.computeProductForecast(prod, productSales, avgLeadTime);
      forecasts.push(analysis);
    }

    return forecasts;
  }

  /**
   * Computes mathematical forecast for a single product.
   */
  static computeProductForecast(product, sales, leadTimeDays = 5) {
    const currentStock = Number(product.quantity) || 0;
    const minLevel = Number(product.min_level) || 10;
    const price = Number(product.price) || 0;

    const totalSold = sales.reduce((sum, s) => sum + s.quantity, 0);
    const transactionCount = sales.length;

    // RULE: If sales transactions < 2 or total units sold < 2, insufficient data
    if (transactionCount < 2 || totalSold < 2) {
      let stockStatus = 'NORMAL';
      if (currentStock === 0) stockStatus = 'CRITICAL';
      else if (currentStock <= minLevel) stockStatus = 'WARNING';

      const needsRestock = stockStatus === 'CRITICAL' || stockStatus === 'WARNING';
      const reorderQty = needsRestock ? Math.max(minLevel * 2 - currentStock, minLevel) : 0;

      return {
        productId: product.id,
        productName: product.name,
        sku: product.sku,
        category: product.category_name || 'Uncategorized',
        price,
        currentStock,
        minLevel,
        leadTimeDays,
        hasSufficientData: false,
        statusMessage: 'Insufficient data for accurate forecasting.',
        totalSold,
        transactionCount,
        averageDailySales: 0,
        trend: 'insufficient_data',
        trendLabel: 'Insufficient Data',
        trendPercentage: 0,
        demandCategory: currentStock === 0 ? 'critical_stockout' : 'insufficient_data',
        forecast7d: null,
        forecast30d: null,
        forecast90d: null,
        expectedStockRequired30d: null,
        projectedShortfall30d: null,
        daysRemaining: currentStock === 0 ? 0 : 999,
        estimatedStockoutDate: currentStock === 0 ? 'Out of Stock' : 'Unknown (No sales velocity)',
        stockStatus,
        immediateRestockNeeded: needsRestock,
        recommendedReorderQty: reorderQty,
        suggestedReorderDate: needsRestock ? 'Immediate' : 'Not required',
      };
    }

    // --- Sufficient Data Analysis ---
    const now = new Date();
    const sortedSales = [...sales].sort((a, b) => a.date.getTime() - b.date.getTime());
    const firstSaleDate = sortedSales[0].date;
    const daysSinceFirstSale = Math.max(1, Math.round((now.getTime() - firstSaleDate.getTime()) / (1000 * 60 * 60 * 24)));

    // Group sales into daily buckets
    const dailyMap = {};
    for (const s of sortedSales) {
      const dayKey = formatDate(s.date);
      dailyMap[dayKey] = (dailyMap[dayKey] || 0) + s.quantity;
    }

    const dailyValues = Object.values(dailyMap);
    const overallDailyAverage = totalSold / daysSinceFirstSale;

    // Recent 7-day and 30-day velocity
    const sevenDaysAgo = addDays(now, -7);
    const thirtyDaysAgo = addDays(now, -30);

    const soldLast7d = sortedSales
      .filter((s) => s.date >= sevenDaysAgo)
      .reduce((sum, s) => sum + s.quantity, 0);
    const soldLast30d = sortedSales
      .filter((s) => s.date >= thirtyDaysAgo)
      .reduce((sum, s) => sum + s.quantity, 0);

    const velocity7d = soldLast7d / 7;
    const velocity30d = soldLast30d / Math.min(30, daysSinceFirstSale);

    // Standard Deviation of daily sales for safety stock calculation
    const variance = dailyValues.reduce((sum, v) => sum + Math.pow(v - overallDailyAverage, 2), 0) / Math.max(1, dailyValues.length);
    const stdDev = Math.sqrt(variance);

    // Day of week seasonality factors
    const dayOfWeekTotals = [0, 0, 0, 0, 0, 0, 0];
    const dayOfWeekCounts = [0, 0, 0, 0, 0, 0, 0];

    sortedSales.forEach((s) => {
      const day = s.date.getDay();
      dayOfWeekTotals[day] += s.quantity;
      dayOfWeekCounts[day]++;
    });

    const daySeasonality = dayOfWeekTotals.map((tot, idx) => {
      if (dayOfWeekCounts[idx] === 0 || overallDailyAverage === 0) return 1.0;
      const dayAvg = tot / dayOfWeekCounts[idx];
      const factor = dayAvg / overallDailyAverage;
      // Clamp factor to realistic bounds [0.6, 1.6]
      return Math.max(0.6, Math.min(1.6, factor));
    });

    // Linear regression on day-by-day sales points
    const regressionPoints = Object.entries(dailyMap).map(([dayKey, qty], index) => ({
      x: index,
      y: qty,
    }));
    const { slope } = calculateLinearRegression(regressionPoints);

    // Trend classification
    let trend = 'steady';
    let trendLabel = 'Steady Demand';
    let trendPercentage = 0;

    if (velocity30d > 0) {
      trendPercentage = Math.round(((velocity7d - velocity30d) / velocity30d) * 100);
    }

    if (trendPercentage >= 15 || slope > 0.05) {
      trend = 'increasing';
      trendLabel = 'Increasing Demand';
    } else if (trendPercentage <= -15 || slope < -0.05) {
      trend = 'decreasing';
      trendLabel = 'Decreasing Demand';
    }

    // Effective daily sales velocity for forecasting (weighted 60% recent 30d, 40% overall)
    const effectiveDailySales = Math.max(0.05, velocity30d * 0.6 + overallDailyAverage * 0.4);

    // Forecast projection for next 90 days day-by-day
    const dailyForecasts = [];
    for (let i = 1; i <= 90; i++) {
      const targetDate = addDays(now, i);
      const dayOfWeek = targetDate.getDay();
      const seasonalFactor = daySeasonality[dayOfWeek] || 1.0;
      // Trend dampening so slope doesn't diverge
      const trendEffect = slope * i * Math.pow(0.96, i);
      const predictedDaily = Math.max(0, (effectiveDailySales + trendEffect) * seasonalFactor);
      dailyForecasts.push(predictedDaily);
    }

    const forecast7d = Math.round(dailyForecasts.slice(0, 7).reduce((a, b) => a + b, 0));
    const forecast30d = Math.round(dailyForecasts.slice(0, 30).reduce((a, b) => a + b, 0));
    const forecast90d = Math.round(dailyForecasts.slice(0, 90).reduce((a, b) => a + b, 0));

    // Expected Stock Requirements
    const expectedStockRequired30d = forecast30d;
    const projectedShortfall30d = Math.max(0, forecast30d - currentStock);

    // Days remaining before stock-out
    let daysRemaining = 999;
    let estimatedStockoutDate = 'No stockout projected';

    if (currentStock === 0) {
      daysRemaining = 0;
      estimatedStockoutDate = 'Out of Stock';
    } else if (effectiveDailySales > 0) {
      daysRemaining = Math.max(0, Math.floor(currentStock / effectiveDailySales));
      const stockoutD = addDays(now, daysRemaining);
      estimatedStockoutDate = formatDate(stockoutD);
    }

    // Stock status categorization
    let stockStatus = 'NORMAL';
    if (currentStock === 0 || daysRemaining <= 3 || currentStock <= Math.ceil(minLevel * 0.5)) {
      stockStatus = 'CRITICAL';
    } else if (daysRemaining <= 7 || currentStock <= minLevel) {
      stockStatus = 'WARNING';
    }

    // Immediate restocking needed if CRITICAL or WARNING
    const immediateRestockNeeded = stockStatus === 'CRITICAL' || stockStatus === 'WARNING';

    // Safety Stock and Reorder Point (ROP)
    // Safety Stock = 1.65 * stdDev * sqrt(LeadTime)
    const safetyStock = Math.max(minLevel, Math.ceil(1.65 * (stdDev || 1) * Math.sqrt(leadTimeDays)));
    const reorderPoint = Math.ceil(effectiveDailySales * leadTimeDays + safetyStock);

    // Recommended Reorder Quantity (ROQ)
    let recommendedReorderQty = 0;
    let suggestedReorderDate = 'Not required soon';

    if (currentStock <= reorderPoint || immediateRestockNeeded) {
      recommendedReorderQty = Math.max(
        Math.ceil(reorderPoint + forecast30d - currentStock),
        minLevel * 2
      );
      suggestedReorderDate = 'Immediate';
    } else if (daysRemaining < 90) {
      const reorderDayOffset = Math.max(0, daysRemaining - leadTimeDays);
      suggestedReorderDate = formatDate(addDays(now, reorderDayOffset));
    }

    // Demand categorization
    let demandCategory = 'normal';
    if (effectiveDailySales >= 1.2 && (trend === 'increasing' || totalSold >= 8)) {
      demandCategory = 'high_demand';
    } else if (trend === 'decreasing') {
      demandCategory = 'decreasing_demand';
    } else if (currentStock > minLevel * 2 && effectiveDailySales < 0.15) {
      demandCategory = 'slow_moving';
    }

    return {
      productId: product.id,
      productName: product.name,
      sku: product.sku,
      category: product.category_name || 'Uncategorized',
      price,
      currentStock,
      minLevel,
      leadTimeDays,
      hasSufficientData: true,
      statusMessage: 'Forecast active based on actual sales history.',
      totalSold,
      transactionCount,
      averageDailySales: Number(effectiveDailySales.toFixed(2)),
      trend,
      trendLabel,
      trendPercentage,
      demandCategory,
      forecast7d,
      forecast30d,
      forecast90d,
      expectedStockRequired30d,
      projectedShortfall30d,
      daysRemaining,
      estimatedStockoutDate,
      stockStatus,
      immediateRestockNeeded,
      safetyStock,
      reorderPoint,
      recommendedReorderQty,
      suggestedReorderDate,
    };
  }

  /**
   * Retrieves high-level AI Dashboard Insights.
   */
  static async getInsights(role = 'owner') {
    const allForecasts = await this.getAllForecasts(role);

    const sufficientForecasts = allForecasts.filter((f) => f.hasSufficientData);
    const insufficientCount = allForecasts.length - sufficientForecasts.length;

    // Top 5 High-Demand Products (sorted by daily sales velocity and 30d forecast)
    const topHighDemand = [...sufficientForecasts]
      .sort((a, b) => b.averageDailySales - a.averageDailySales || b.forecast30d - a.forecast30d)
      .slice(0, 5)
      .map((p) => ({
        id: p.productId,
        name: p.productName,
        sku: p.sku,
        category: p.category,
        dailySales: p.averageDailySales,
        forecast30d: p.forecast30d,
        forecast90d: p.forecast90d,
        currentStock: p.currentStock,
        trend: p.trend,
        trendPercentage: p.trendPercentage,
      }));

    // Products at Risk of Stockout (CRITICAL or WARNING, sorted by days remaining ascending)
    const atRiskOfStockout = [...allForecasts]
      .filter((p) => p.stockStatus === 'CRITICAL' || p.stockStatus === 'WARNING')
      .sort((a, b) => a.daysRemaining - b.daysRemaining || a.currentStock - b.currentStock)
      .map((p) => ({
        id: p.productId,
        name: p.productName,
        sku: p.sku,
        category: p.category,
        currentStock: p.currentStock,
        minLevel: p.minLevel,
        dailySales: p.averageDailySales,
        daysRemaining: p.daysRemaining,
        estimatedStockoutDate: p.estimatedStockoutDate,
        stockStatus: p.stockStatus,
        recommendedReorderQty: p.recommendedReorderQty,
        suggestedReorderDate: p.suggestedReorderDate,
        hasSufficientData: p.hasSufficientData,
      }));

    // Restocking Recommendations (products where reorder quantity > 0)
    const restockingRecommendations = [...allForecasts]
      .filter((p) => p.recommendedReorderQty > 0)
      .sort((a, b) => {
        if (a.stockStatus === 'CRITICAL' && b.stockStatus !== 'CRITICAL') return -1;
        if (b.stockStatus === 'CRITICAL' && a.stockStatus !== 'CRITICAL') return 1;
        return a.daysRemaining - b.daysRemaining;
      })
      .map((p) => ({
        id: p.productId,
        name: p.productName,
        sku: p.sku,
        category: p.category,
        price: p.price,
        currentStock: p.currentStock,
        dailySales: p.averageDailySales,
        daysRemaining: p.daysRemaining,
        stockStatus: p.stockStatus,
        recommendedReorderQty: p.recommendedReorderQty,
        suggestedReorderDate: p.suggestedReorderDate,
        estimatedCost: Math.round(p.recommendedReorderQty * p.price),
        leadTimeDays: p.leadTimeDays,
        hasSufficientData: p.hasSufficientData,
      }));

    // Slow-Moving Products (high stock, very low velocity)
    const slowMoving = [...allForecasts]
      .filter((p) => p.demandCategory === 'slow_moving' || (p.currentStock > p.minLevel && p.averageDailySales <= 0.1))
      .slice(0, 5)
      .map((p) => ({
        id: p.productId,
        name: p.productName,
        sku: p.sku,
        category: p.category,
        currentStock: p.currentStock,
        dailySales: p.averageDailySales,
        hasSufficientData: p.hasSufficientData,
      }));

    // Monthly Demand Predictions (aggregated by category)
    const categoryMonthly = {};
    sufficientForecasts.forEach((p) => {
      if (!categoryMonthly[p.category]) {
        categoryMonthly[p.category] = { category: p.category, forecast30d: 0, forecast90d: 0, currentStock: 0, productsCount: 0 };
      }
      categoryMonthly[p.category].forecast30d += p.forecast30d;
      categoryMonthly[p.category].forecast90d += p.forecast90d;
      categoryMonthly[p.category].currentStock += p.currentStock;
      categoryMonthly[p.category].productsCount++;
    });

    // KPI Metrics
    const total30dUnits = sufficientForecasts.reduce((sum, p) => sum + (p.forecast30d || 0), 0);
    const total30dValue = sufficientForecasts.reduce((sum, p) => sum + (p.forecast30d || 0) * p.price, 0);
    const criticalStockoutsCount = atRiskOfStockout.filter((p) => p.stockStatus === 'CRITICAL').length;
    const warningStockCount = atRiskOfStockout.filter((p) => p.stockStatus === 'WARNING').length;

    return {
      kpis: {
        totalProductsMonitored: allForecasts.length,
        sufficientDataCount: sufficientForecasts.length,
        insufficientDataCount: insufficientCount,
        criticalStockoutsCount,
        warningStockCount,
        total30dProjectedDemandUnits: total30dUnits,
        total30dProjectedDemandValue: Math.round(total30dValue),
        restockRecommendationsCount: restockingRecommendations.length,
      },
      topHighDemand,
      atRiskOfStockout,
      restockingRecommendations,
      slowMoving,
      monthlyDemandPredictions: Object.values(categoryMonthly),
      allForecasts,
    };
  }

  /**
   * Detailed product forecast for interactive charts (historical curve vs future projections).
   */
  static async getProductForecastDetails(productId) {
    const productRes = await pool.query(`
      SELECT p.id, p.name, p.sku, p.price, p.quantity, p.min_level, p.status,
             c.name as category_name
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE p.id::text = $1
    `, [productId]);

    if (productRes.rows.length === 0) {
      return null;
    }

    const product = productRes.rows[0];

    const salesRes = await pool.query(`
      SELECT si.quantity, si.unit_price, s.date
      FROM sale_items si
      JOIN sales s ON si.sale_id = s.id
      WHERE si.product_id::text = $1 AND s.status = 'completed'
      ORDER BY s.date ASC
    `, [productId]);

    const sales = salesRes.rows.map((r) => ({
      quantity: Number(r.quantity) || 0,
      unitPrice: Number(r.unit_price) || 0,
      date: new Date(r.date),
    }));

    const summary = this.computeProductForecast(product, sales);

    // If insufficient data, return summary with empty timeline
    if (!summary.hasSufficientData) {
      return {
        summary,
        chartData: {
          hasSufficientData: false,
          historical: [],
          forecast7d: [],
          forecast30d: [],
          forecast90d: [],
        },
      };
    }

    // Build daily historical series (past 30 days)
    const now = new Date();
    const historicalDays = [];
    const historicalMap = {};

    sales.forEach((s) => {
      const dKey = formatDate(s.date);
      historicalMap[dKey] = (historicalMap[dKey] || 0) + s.quantity;
    });

    for (let i = 29; i >= 0; i--) {
      const d = addDays(now, -i);
      const dKey = formatDate(d);
      historicalDays.push({
        date: dKey,
        quantity: historicalMap[dKey] || 0,
      });
    }

    // Build forecast daily timeline (next 90 days)
    const forecastTimeline = [];
    const avgDaily = summary.averageDailySales;

    for (let i = 1; i <= 90; i++) {
      const targetDate = addDays(now, i);
      const dKey = formatDate(targetDate);
      const dayOfWeek = targetDate.getDay();
      const weekendFactor = dayOfWeek === 0 || dayOfWeek === 6 ? 0.8 : 1.1;
      const trendEffect = summary.trend === 'increasing' ? 1 + (i * 0.003) : summary.trend === 'decreasing' ? Math.max(0.6, 1 - (i * 0.004)) : 1.0;
      const predictedVal = Number((avgDaily * weekendFactor * trendEffect).toFixed(1));
      const margin = Number((predictedVal * 0.25).toFixed(1));

      forecastTimeline.push({
        date: dKey,
        predicted: predictedVal,
        lowerBound: Math.max(0, Number((predictedVal - margin).toFixed(1))),
        upperBound: Number((predictedVal + margin).toFixed(1)),
      });
    }

    return {
      summary,
      chartData: {
        hasSufficientData: true,
        historical: historicalDays,
        forecast7d: forecastTimeline.slice(0, 7),
        forecast30d: forecastTimeline.slice(0, 30),
        forecast90d: forecastTimeline.slice(0, 90),
      },
    };
  }

  /**
   * Evaluates inventory and automatically generates notifications in PostgreSQL notifications table.
   * Deduplicates alerts generated in the past 24 hours.
   */
  static async evaluateAndGenerateAlerts(filterProductIds = null) {
    try {
      const forecasts = await this.getAllForecasts('owner');
      const filtered = filterProductIds && filterProductIds.length > 0
        ? forecasts.filter((f) => filterProductIds.includes(f.productId))
        : forecasts;

      const generatedAlerts = [];

      for (const item of filtered) {
        // 1. Critical Stock Alert (0 stock or <= 3 days left)
        if (item.stockStatus === 'CRITICAL') {
          const title = item.currentStock === 0
            ? `Critical: "${item.productName}" is OUT OF STOCK`
            : `Critical Stockout Alert: "${item.productName}"`;
          
          const message = item.currentStock === 0
            ? `Zero units remaining for "${item.productName}". Restock ${item.recommendedReorderQty} units immediately to resume orders.`
            : `Only ${item.currentStock} units remaining (min: ${item.minLevel}). Estimated stockout in ${item.daysRemaining} days. Immediate reorder recommended: ${item.recommendedReorderQty} units.`;

          const alert = await this.addUniqueNotification({
            title,
            message,
            type: 'low_stock',
            relatedId: item.productId,
            relatedType: 'product',
          });
          if (alert) generatedAlerts.push(alert);
        }
        // 2. Warning Stock Alert (stock <= min_level or <= 7 days left)
        else if (item.stockStatus === 'WARNING') {
          const title = `Low Stock Warning: "${item.productName}"`;
          const message = `Stock level at ${item.currentStock} units (min: ${item.minLevel}). Estimated stockout date: ${item.estimatedStockoutDate}. Recommended reorder: ${item.recommendedReorderQty} units.`;

          const alert = await this.addUniqueNotification({
            title,
            message,
            type: 'low_stock',
            relatedId: item.productId,
            relatedType: 'product',
          });
          if (alert) generatedAlerts.push(alert);
        }

        // 3. High Demand Alert (trending up significantly)
        if (item.hasSufficientData && item.demandCategory === 'high_demand' && item.trend === 'increasing') {
          const title = `AI High-Demand Alert: "${item.productName}"`;
          const message = `Demand for "${item.productName}" is surging (+${item.trendPercentage}%). Projected 30-day demand is ${item.forecast30d} units. Verify adequate stock.`;

          const alert = await this.addUniqueNotification({
            title,
            message,
            type: 'system',
            relatedId: item.productId,
            relatedType: 'product',
          });
          if (alert) generatedAlerts.push(alert);
        }
      }

      return generatedAlerts;
    } catch (err) {
      console.error('Error evaluating AI inventory alerts:', err);
      return [];
    }
  }

  /**
   * Adds notification only if no identical notification was created for this product in the last 24h.
   */
  static async addUniqueNotification({ title, message, type, relatedId, relatedType }) {
    const existing = await pool.query(`
      SELECT id FROM notifications
      WHERE related_id::text = $1 AND title = $2 AND created_at > (CURRENT_TIMESTAMP - INTERVAL '24 hours')
      LIMIT 1
    `, [relatedId, title]);

    if (existing.rows.length > 0) {
      return null; // Already notified recently
    }

    return await addNotification({
      title,
      message,
      type,
      relatedId,
      relatedType,
    });
  }
}
