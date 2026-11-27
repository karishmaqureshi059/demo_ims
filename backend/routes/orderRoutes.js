import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import {
  getOrders,
  getOrder,
  createOrder,
  updateOrder,
  updateOrderStatus,
} from '../controllers/orderController.js';

const router = express.Router();

const authenticateOrderRequests = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authenticateToken(req, res, next);
  }
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
    return authenticateToken(req, res, next);
  }
  next();
};

const authorizeOrderMutation = (req, res, next) => {
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
    if (!['owner', 'orders'].includes(req.user?.role)) {
      return res.status(403).json({ message: 'Forbidden. Only Order Managers and Owners can manage orders.' });
    }
  }
  next();
};

router.use(authenticateOrderRequests);
router.use(authorizeOrderMutation);

router.get('/', getOrders);
router.get('/:id', getOrder);
router.post('/', createOrder);
router.put('/:id', updateOrder);
router.put('/:id/status', updateOrderStatus);

export default router;