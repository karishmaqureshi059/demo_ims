import express from 'express';
import { authenticateToken, authorizeRole } from '../middleware/auth.js';
import {
  getAllUsers,
  getUserById,
  createUser,
  updateUser,
  changeUserRole,
  updateUserStatusHandler,
  resetUserPasswordHandler,
} from '../controllers/authController.js';

const router = express.Router();

// Enforce authentication on all user routes
router.use(authenticateToken);

// Restrict all user management routes to Owner
router.use(authorizeRole('owner'));

// Get all users (Owner only)
router.get('/', getAllUsers);

// Get user by ID
router.get('/:id', getUserById);

// Create user (Owner only)
router.post('/', createUser);

// Update user (Owner only)
router.put('/:id', updateUser);

// Change user role (Owner only)
router.put('/:id/role', changeUserRole);

// Change user status (Owner only)
router.put('/:id/status', updateUserStatusHandler);

// Reset user password (Owner only)
router.post('/:id/reset-password', resetUserPasswordHandler);

export default router;