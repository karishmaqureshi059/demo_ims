import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import {
  getStockTransactions,
  createStockTransaction,
  updateStockTransaction,
  recordStockIn,
  recordStockOut,
  adjustStock,
  getLowStockProducts,
  getStockSummary,
} from '../controllers/stockController.js';

const router = express.Router();

const authenticateStockRequests = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authenticateToken(req, res, next);
  }
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
    return authenticateToken(req, res, next);
  }
  next();
};

const authorizeStockMutation = (req, res, next) => {
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
    if (!['owner', 'stock'].includes(req.user?.role)) {
      return res.status(403).json({ message: 'Forbidden. Only Stock Managers and Owners can record stock movements.' });
    }
  }
  next();
};

router.use(authenticateStockRequests);
router.use(authorizeStockMutation);

router.get('/', getStockTransactions);
router.post('/', createStockTransaction);
router.put('/:id', updateStockTransaction);
router.post('/in', recordStockIn);
router.post('/out', recordStockOut);
router.post('/adjust', adjustStock);
router.get('/low-stock', getLowStockProducts);
router.get('/summary', getStockSummary);

export default router;
