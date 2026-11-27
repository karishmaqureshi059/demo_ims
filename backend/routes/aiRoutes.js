import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import {
  getForecasts,
  getProductForecast,
  getInsights,
  triggerAlerts,
} from '../controllers/aiController.js';

const router = express.Router();

// All AI forecasting endpoints require authentication
router.use(authenticateToken);

// 1. Get high-level AI insights & dashboard metrics
router.get('/insights', getInsights);

// 2. Get list of all product forecasts with 7/30/90 day predictions and restock recommendations
router.get('/forecasts', getForecasts);

// 3. Get detailed forecast timeline and historical curve for a specific product
router.get('/forecasts/:productId', getProductForecast);

// 4. Trigger evaluation and notification generation for low stock, stockout, and demand surges
router.post('/trigger-alerts', triggerAlerts);

export default router;
