import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import {
  getSuppliers,
  getSupplier,
  createSupplier,
  updateSupplier,
  getPurchaseOrders,
  getPurchaseOrder,
  createPurchaseOrder,
  updatePurchaseOrder,
  receivePurchaseOrder,
} from '../controllers/purchaseController.js';

const router = express.Router();

const authenticatePurchaseRequests = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authenticateToken(req, res, next);
  }
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
    return authenticateToken(req, res, next);
  }
  next();
};

const authorizePurchaseMutation = (req, res, next) => {
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
    if (!['owner', 'purchase'].includes(req.user?.role)) {
      return res.status(403).json({ message: 'Forbidden. Only Purchase Managers and Owners can manage purchase orders.' });
    }
  }
  next();
};

router.use(authenticatePurchaseRequests);
router.use(authorizePurchaseMutation);

router.get('/suppliers', getSuppliers);
router.get('/suppliers/:id', getSupplier);
router.post('/suppliers', createSupplier);
router.put('/suppliers/:id', updateSupplier);

router.get('/', getPurchaseOrders);
router.get('/:id', getPurchaseOrder);
router.post('/', createPurchaseOrder);
router.put('/:id', updatePurchaseOrder);
router.post('/:id/receive', receivePurchaseOrder);

export default router;