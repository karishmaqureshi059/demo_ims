
import express from 'express';
import { authenticateToken } from '../middleware/auth.js';

import {
  login,
  getMe,
  refreshTokenHandler,
  logout,
  forgotPassword,
  getAllUsers,
  createUser,
  updateUser,
  changeUserRole,
  resetUserPasswordHandler,
  getUserById
} from '../controllers/authController.js';

const router = express.Router();

const optionalAuth = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authenticateToken(req, res, next);
  }
  next();
};

// Authentication routes
router.post('/login', login);
router.get('/me', authenticateToken, getMe);
router.post('/refresh-token', refreshTokenHandler);
router.post('/logout', optionalAuth, logout);
router.post('/forgot-password', forgotPassword);

// User management routes
router.get('/', getAllUsers);

router.get('/:id', getUserById);
router.post('/', createUser);
router.put('/:id', updateUser);
router.put('/:id/role', changeUserRole);
router.post('/:id/reset-password', resetUserPasswordHandler);

export default router;
