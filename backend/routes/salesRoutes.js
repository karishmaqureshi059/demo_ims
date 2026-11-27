
import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import {
  getSales,
  getSale,
  createSale,
  updateSale,
  deleteSale,
} from '../controllers/salesController.js';

const router = express.Router();

const authenticateSaleRequests = (req, res, next) => {
  const authHeader = req.headers['authorization'];

  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authenticateToken(req, res, next);
  }

  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
    return authenticateToken(req, res, next);
  }

  next();
};

const authorizeSalesMutation = (req, res, next) => {
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
    if (!['owner', 'sales'].includes(req.user?.role)) {
      return res.status(403).json({ message: 'Forbidden. Only Sales Managers and Owners can manage sales.' });
    }
  }
  next();
};

router.use(authenticateSaleRequests);
router.use(authorizeSalesMutation);

router.get('/', getSales);
router.get('/:id', getSale);
router.post('/', createSale);
router.put('/:id', updateSale);
router.delete('/:id', deleteSale);

export default router;
