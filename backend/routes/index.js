import express from 'express';
import authRoutes from './routes/authRoutes.js';
import productRoutes from './routes/productRoutes.js';
import salesRoutes from './routes/salesRoutes.js';
import stockRoutes from './routes/stockRoutes.js';
import purchaseRoutes from './routes/purchaseRoutes.js';
import orderRoutes from './routes/orderRoutes.js';
import dashboardRoutes from './routes/dashboardRoutes.js';

const router = express.Router();

// Base API route
router.use('/api', authRoutes);
router.use('/api', productRoutes);
router.use('/api', salesRoutes);
router.use('/api', stockRoutes);
router.use('/api', purchaseRoutes);
router.use('/api', orderRoutes);
router.use('/api', dashboardRoutes);

// Health check
router.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

export default router;