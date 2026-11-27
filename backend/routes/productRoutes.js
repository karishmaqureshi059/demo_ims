import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import {
  getProducts,
  getProduct,
  createProduct,
  updateProduct,
  deleteProduct,
  getProductsByCategory,
  getCategories,
  createCategory,
} from '../controllers/productController.js';

const router = express.Router();

// Middleware: Authenticate when token is provided, and enforce on mutations
const authenticateProductRequests = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authenticateToken(req, res, next);
  }
  // Enforce authentication on create, update, delete
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
    return authenticateToken(req, res, next);
  }
  next();
};

const authorizeProductMutation = (req, res, next) => {
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
    if (!['owner', 'product'].includes(req.user?.role)) {
      return res.status(403).json({ message: 'Forbidden. Only Product Managers and Owners can manage products.' });
    }
  }
  next();
};

router.use(authenticateProductRequests);
router.use(authorizeProductMutation);

// Category routes (must be defined before /:id)
router.get('/categories', getCategories);
router.post('/categories', createCategory);
router.get('/category/:categoryId', getProductsByCategory);

// Product CRUD routes
router.get('/', getProducts);
router.get('/:id', getProduct);
router.post('/', createProduct);
router.put('/:id', updateProduct);
router.delete('/:id', deleteProduct);

export default router;
