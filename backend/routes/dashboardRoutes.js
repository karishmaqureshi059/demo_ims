import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { getDashboard, getAnalytics } from '../services/dashboardService.js';

const router = express.Router();

const optionalAuth = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authenticateToken(req, res, next);
  }
  next();
};

router.use(optionalAuth);

// Analytics endpoints
router.get('/analytics/:roleKey', (req, res) => {
  const roleKey = req.params.roleKey || req.user?.role || 'owner';
  const days = Number(req.query.days) || 30;
  getAnalytics(roleKey, days)
    .then((data) => res.json(data))
    .catch((err) => res.status(500).json({ message: err.message }));
});

router.get('/analytics', (req, res) => {
  const roleKey = req.query.role || req.user?.role || 'owner';
  const days = Number(req.query.days) || 30;
  getAnalytics(roleKey, days)
    .then((data) => res.json(data))
    .catch((err) => res.status(500).json({ message: err.message }));
});

// Dashboard endpoints
router.get('/dashboard/:roleKey', (req, res) => {
  const roleKey = req.params.roleKey || req.user?.role || 'owner';
  getDashboard(roleKey)
    .then((data) => res.json(data))
    .catch((err) => res.status(500).json({ message: err.message }));
});

router.get('/', (req, res) => {
  const roleKey = req.query.role || req.user?.role || 'owner';
  getDashboard(roleKey)
    .then((data) => res.json(data))
    .catch((err) => res.status(500).json({ message: err.message }));
});

router.get('/:roleKey', (req, res) => {
  const roleKey = req.params.roleKey || req.user?.role || 'owner';
  getDashboard(roleKey)
    .then((data) => res.json(data))
    .catch((err) => res.status(500).json({ message: err.message }));
});

export default router;
