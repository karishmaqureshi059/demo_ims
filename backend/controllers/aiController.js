import { AiForecastService } from '../services/aiForecastService.js';

/**
 * Controller for AI Inventory Forecasting and Insights
 */

// GET /api/ai/forecasts
export async function getForecasts(req, res) {
  try {
    const role = req.user?.role || 'owner';
    const forecasts = await AiForecastService.getAllForecasts(role);

    return res.status(200).json({
      success: true,
      role,
      count: forecasts.length,
      forecasts,
    });
  } catch (error) {
    console.error('Error in getForecasts:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to compute inventory forecasts.',
      error: error.message,
    });
  }
}

// GET /api/ai/forecasts/:productId
export async function getProductForecast(req, res) {
  try {
    const { productId } = req.params;
    if (!productId) {
      return res.status(400).json({ success: false, message: 'Product ID is required.' });
    }

    const details = await AiForecastService.getProductForecastDetails(productId);
    if (!details) {
      return res.status(404).json({ success: false, message: 'Product not found.' });
    }

    return res.status(200).json({
      success: true,
      productId,
      ...details,
    });
  } catch (error) {
    console.error('Error in getProductForecast:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve product forecast details.',
      error: error.message,
    });
  }
}

// GET /api/ai/insights
export async function getInsights(req, res) {
  try {
    const role = req.user?.role || 'owner';
    const insights = await AiForecastService.getInsights(role);

    // Apply role-specific highlights or tailoring
    const roleContext = {
      isOwner: role === 'owner',
      isProductManager: role === 'product',
      isStockManager: role === 'stock',
      isPurchaseManager: role === 'purchase',
      isSalesManager: role === 'sales',
      isOrderManager: role === 'orders',
      roleTitle: getRoleTitle(role),
    };

    return res.status(200).json({
      success: true,
      role,
      roleContext,
      ...insights,
    });
  } catch (error) {
    console.error('Error in getInsights:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve AI inventory insights.',
      error: error.message,
    });
  }
}

// POST /api/ai/trigger-alerts
export async function triggerAlerts(req, res) {
  try {
    const { productIds } = req.body || {};
    const generatedAlerts = await AiForecastService.evaluateAndGenerateAlerts(productIds);

    return res.status(200).json({
      success: true,
      message: `AI analysis complete. ${generatedAlerts.length} new notification(s) generated.`,
      alertsCount: generatedAlerts.length,
      alerts: generatedAlerts,
    });
  } catch (error) {
    console.error('Error in triggerAlerts:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to evaluate stock alerts.',
      error: error.message,
    });
  }
}

function getRoleTitle(role) {
  const map = {
    owner: 'Business Owner',
    product: 'Product Manager',
    stock: 'Stock Manager',
    purchase: 'Purchase Manager',
    sales: 'Sales Manager',
    orders: 'Order Manager',
  };
  return map[role] || 'Inventory Specialist';
}
