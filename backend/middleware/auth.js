import { pool } from '../config/db.js';
import { verifyToken } from '../utils/auth.js';

// Authenticate JWT token from Authorization header
export async function authenticateToken(req, res, next) {
  try {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'Access denied. No token provided.' });
    }

    const token = authHeader.split(' ')[1]; // Remove "Bearer " prefix

    // Verify token using jsonwebtoken's verifyToken function
    const result = verifyToken(token);

    if (!result.valid) {
      // Check for expired token
      if (result.error && result.error.includes('expired')) {
        return res.status(401).json({ message: 'Token expired. Please sign in again.' });
      }
      return res.status(403).json({ message: 'Invalid token.' });
    }

    // Attach user info to request
    req.user = {
      id: result.decoded.sub,
      role: result.decoded.role,
      sessionVersion: result.decoded.sessionVersion,
    };

    next();
  } catch (error) {
    return res.status(403).json({ message: 'Invalid token.' });
  }
}

// Role-based access control middleware
export function authorizeRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: 'Unauthorized. No user context.' });
    }

    if (!allowedRoles.includes(req.user.role) && req.user.role !== 'owner') {
      return res.status(403).json({ message: 'Forbidden. Insufficient role permissions.' });
    }

    next();
  };
}

// Permission-based access control middleware
export function authorizePermission(permissionKey) {
  return async (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: 'Unauthorized. No user context.' });
    }

    if (req.user.role === 'owner') {
      return next(); // Owner has full access to all permissions
    }

    try {
      // Query the database to check if the user has this permission
      const result = await pool.query(
        `SELECT rp.granted 
         FROM role_permissions rp 
         JOIN roles r ON rp.role_id = r.id 
         WHERE r.name = $1 AND rp.permission_id = (SELECT id FROM permissions WHERE name = $2)`,
        [req.user.role, permissionKey]
      );

      if (result.rows.length === 0 || !result.rows[0].granted) {
        return res.status(403).json({ message: `Forbidden. Missing permission: ${permissionKey}` });
      }

      next();
    } catch (error) {
      console.error('Permission check error:', error);
      return res.status(500).json({ message: 'Internal server error during permission check.' });
    }
  };
}

// Check if user is the owner of their own account
export async function isOwnAccount(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ message: 'Unauthorized.' });
  }

  // Allow access if the user is trying to access their own profile
  // (e.g., /profile, /settings)
  if (req.path.includes('/profile') || req.path.includes('/settings')) {
    return next();
  }

  // For other routes, check if the user ID in params matches the authenticated user
  if (req.params && req.params.userId && req.params.userId !== req.user.id) {
    return res.status(403).json({ message: 'Forbidden. You can only access your own resources.' });
  }

  next();
}

// Validate that deactivated users cannot perform actions
export async function preventDeactivatedUser(req, res, next) {
  if (!req.user) {
    return next();
  }

  try {
    const result = await pool.query(
      'SELECT status FROM users WHERE id = $1',
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ message: 'User not found. Session expired.' });
    }

    if (result.rows[0].status === 'deactivated') {
      return res.status(403).json({ message: 'Account deactivated. Contact the Owner.' });
    }

    next();
  } catch (error) {
    console.error('Deactivated user check error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
}

// Log user activity
export async function logActivity(pool, userId, action, module, details = {}) {
  try {
    await pool.query(
      `INSERT INTO user_activity (user_id, action, module, details, created_at) 
       VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)`,
      [userId, action, module, JSON.stringify(details)]
    );
  } catch (error) {
    console.error('Activity logging error:', error);
  }
}