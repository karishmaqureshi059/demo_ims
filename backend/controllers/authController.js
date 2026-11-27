
import { pool } from '../config/db.js';
import { hashPassword, comparePassword, generateToken, verifyToken } from '../utils/auth.js';
import { logActivity } from '../middleware/auth.js';
import { addNotification } from '../utils/notifications.js';
import { recordAttendanceLogin, recordAttendanceLogout } from '../services/attendanceService.js';

// Helper functions for user lookups
export async function findUserByLogin(identifier) {
  if (!identifier) return null;
  const clean = String(identifier).trim().toLowerCase();
  const alt = clean.endsWith('@demo.com')
    ? clean.replace(/@demo\.com$/, '@inventory.com')
    : (clean.endsWith('@inventory.com') ? clean.replace(/@inventory\.com$/, '@demo.com') : clean);

  const result = await pool.query(
    `SELECT * FROM users
     WHERE LOWER(email) = LOWER($1::text)
        OR LOWER(name) = LOWER($1::text)
        OR LOWER(email) = LOWER($2::text)
     ORDER BY
       CASE
         WHEN LOWER(email) = LOWER($1::text) AND status = 'active' THEN 1
         WHEN LOWER(email) = LOWER($1::text) THEN 2
         WHEN LOWER(name) = LOWER($1::text) AND status = 'active' THEN 3
         WHEN LOWER(name) = LOWER($1::text) THEN 4
         WHEN LOWER(email) = LOWER($2::text) AND status = 'active' THEN 5
         ELSE 6
       END ASC,
       created_at ASC
     LIMIT 1`,
    [clean, alt]
  );
  return result.rows[0] || null;
}

export async function findUserById(id) {
  if (!id) return null;
  const result = await pool.query(
    'SELECT * FROM users WHERE id::text = $1 LIMIT 1',
    [String(id)]
  );
  return result.rows[0] || null;
}

export async function findUserByEmail(email) {
  if (!email) return null;
  const clean = String(email).trim();
  const result = await pool.query(
    'SELECT * FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1',
    [clean]
  );
  return result.rows[0] || null;
}

// Login Controller
export async function login(req, res) {
  const { identifier, password, rememberMe } = req.body;

  if (!identifier || !password) {
    return res.status(400).json({ message: 'Email/username and password are required.' });
  }

  try {
    const user = await findUserByLogin(identifier);

    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials. Please check your email/username and password.' });
    }

    if (user.status === 'deactivated') {
      return res.status(403).json({ message: 'Account deactivated. Contact the Owner.' });
    }

    const isPasswordValid = await comparePassword(password, user.password);

    if (!isPasswordValid) {
      return res.status(401).json({ message: 'Invalid credentials. Please check your email/username and password.' });
    }

    const token = generateToken(user.id, user.role, user.session_version);
    const refreshToken = generateToken(user.id, user.role, user.session_version + 100);

    const ip = req.ip || req.socket?.remoteAddress || '127.0.0.1';
    const userAgent = typeof req.get === 'function' ? req.get('User-Agent') : (req.headers?.['user-agent'] || 'MockAgent');

    // Record attendance login
    await recordAttendanceLogin(pool, user.id, ip, userAgent);

    await pool.query(
      'UPDATE users SET last_login = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
      [user.id]
    );

    await logActivity(pool, user.id, 'User login', 'Authentication', {
      ip,
      userAgent,
      rememberMe,
    });

    return res.status(200).json({
      message: 'Login successful',
      token,
      refreshToken,
      user: {
        id: user.id,
        employeeId: user.employee_id,
        name: user.name,
        email: user.email,
        role: user.role,
        status: user.status,
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
}

export async function getMe(req, res) {
  if (!req.user) {
    return res.status(401).json({ message: 'Unauthorized. No user context.' });
  }

  const user = await findUserById(req.user.id);

  if (!user) {
    return res.status(404).json({ message: 'User not found.' });
  }

  if (user.status === 'deactivated') {
    return res.status(403).json({ message: 'Account deactivated.' });
  }

  return res.status(200).json({
    user: {
      id: user.id,
      employeeId: user.employee_id,
      name: user.name,
      email: user.email,
      role: user.role,
      status: user.status,
      phone: user.phone,
      avatar: user.avatar,
      photo: user.photo,
    },
  });
}

// Refresh Token Controller
export async function refreshTokenHandler(req, res) {
  const { token } = req.body;

  if (!token) {
    return res.status(400).json({ message: 'Refresh token is required.' });
  }

  try {
    const result = verifyToken(token);

    if (!result.valid) {
      return res.status(401).json({ message: 'Invalid or expired refresh token.' });
    }

    const decoded = result.decoded;

    const newToken = generateToken(
      decoded.sub,
      decoded.role,
      decoded.sessionVersion
    );

    return res.status(200).json({ token: newToken });
  } catch (error) {
    console.error('Refresh token error:', error);
    return res.status(403).json({ message: 'Invalid refresh token.' });
  }
}

// Logout Controller
export async function logout(req, res) {
  const userId = req.user?.id || req.body?.userId;
  if (userId) {
    // Record attendance logout and compute working hours
    await recordAttendanceLogout(pool, userId);

    await logActivity(pool, userId, 'User logout', 'Authentication', {
      ip: req.ip || req.socket?.remoteAddress || '127.0.0.1',
    });
  }

  return res.status(200).json({ message: 'Logged out successfully.' });
}

// Forgot Password Controller
export async function forgotPassword(req, res) {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ message: 'Email is required.' });
  }

  try {
    const user = await findUserByLogin(email);

    if (!user) {
      return res.status(200).json({
        message: 'If an account with that email exists, a password reset link has been sent.',
      });
    }

    if (user.status === 'deactivated') {
      return res.status(403).json({ message: 'Account deactivated. Contact the Owner.' });
    }

    const temporaryPassword = `Temp@${Math.floor(100000 + Math.random() * 900000)}`;
    const hashedPassword = await hashPassword(temporaryPassword);

    await pool.query(
      'UPDATE users SET password = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [hashedPassword, user.id]
    );

    await logActivity(pool, user.id, 'Password reset requested', 'Authentication', {
      triggeredBy: 'forgot_password',
    });

    return res.status(200).json({
      message: 'A temporary password has been generated and sent to your email.',
      temporaryPassword,
    });
  } catch (error) {
    console.error('Forgot password error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
}

// Get User By ID
export async function getUserById(req, res) {
  const { id } = req.params;

  if (!id) {
    return res.status(400).json({ message: 'User ID is required.' });
  }

  try {
    const user = await findUserById(id);

    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    return res.status(200).json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        status: user.status,
        phone: user.phone,
        avatar: user.avatar,
        photo: user.photo,
      },
    });
  } catch (error) {
    console.error('Get user by ID error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
}

// Get All Users
export async function getAllUsers(req, res) {
  if (req.user.role !== 'owner') {
    return res.status(403).json({ message: 'Forbidden. Only the Owner can view all users.' });
  }

  try {
    const result = await pool.query(
      `SELECT id, employee_id, name, email, role, status, phone, avatar, photo, last_login, created_at
       FROM users ORDER BY created_at DESC`
    );

    return res.status(200).json({
      users: result.rows.map((user) => ({
        id: user.id,
        employeeId: user.employee_id || 'N/A',
        name: user.name,
        email: user.email,
        role: user.role,
        status: user.status,
        phone: user.phone,
        avatar: user.avatar,
        photo: user.photo,
        lastLogin: user.last_login,
        createdAt: user.created_at,
      })),
    });
  } catch (error) {
    console.error('Get all users error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
}

// Create User
export async function createUser(req, res) {
  if (req.user.role !== 'owner') {
    return res.status(403).json({ message: 'Forbidden. Only the Owner can create users.' });
  }

  const { name, email, password, role, phone } = req.body;

  if (!name || !email || !password || !role) {
    return res.status(400).json({ message: 'Name, email, password, and role are required.' });
  }

  if (!['owner', 'product', 'sales', 'stock', 'purchase', 'orders'].includes(role)) {
    return res.status(400).json({ message: 'Invalid role specified.' });
  }

  try {
    const existingUser = await findUserByEmail(email);

    if (existingUser) {
      return res.status(409).json({ message: 'A user with that email already exists.' });
    }

    // Auto-generate employee_id if not provided
    let employeeId = req.body.employeeId ? String(req.body.employeeId).trim() : null;
    if (!employeeId) {
      const maxEmpRes = await pool.query(`SELECT employee_id FROM users WHERE employee_id LIKE 'EMP%'`);
      let maxNum = 6;
      for (const r of maxEmpRes.rows) {
        const num = parseInt(String(r.employee_id).replace(/\D/g, ''), 10);
        if (!isNaN(num) && num > maxNum) maxNum = num;
      }
      employeeId = `EMP${String(maxNum + 1).padStart(3, '0')}`;
    }

    const hashedPassword = await hashPassword(password);

    const result = await pool.query(
      `INSERT INTO users (id, employee_id, name, email, password, role, status, phone, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 'active', $6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       RETURNING id, employee_id, name, email, role, status, phone, created_at`,
      [employeeId, name, email, hashedPassword, role, phone || null]
    );

    await logActivity(pool, req.user.id, `Created user ${name} (${employeeId})`, 'User Management', {
      newUserId: result.rows[0].id,
      employeeId,
      newUserRole: role,
    });

    await addNotification({
      title: 'New User Account',
      message: `User "${name}" (${employeeId}) was created with role "${role}"`,
      type: 'system',
      relatedId: result.rows[0].id,
      relatedType: 'user',
    });

    return res.status(201).json({
      message: 'User created successfully',
      user: {
        id: result.rows[0].id,
        employeeId: result.rows[0].employee_id,
        name: result.rows[0].name,
        email: result.rows[0].email,
        role: result.rows[0].role,
        status: result.rows[0].status,
        phone: result.rows[0].phone,
        createdAt: result.rows[0].created_at,
      },
    });
  } catch (error) {
    console.error('Create user error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
}

// Update User
export async function updateUser(req, res) {
  if (req.user.role !== 'owner') {
    return res.status(403).json({ message: 'Forbidden. Only the Owner can edit users.' });
  }

  const { id } = req.params;
  const { name, email, phone, role, status, avatar, photo } = req.body;

  if (!id) {
    return res.status(400).json({ message: 'User ID is required.' });
  }

  try {
    const existingUser = await findUserById(id);

    if (!existingUser) {
      return res.status(404).json({ message: 'User not found.' });
    }

    if (email && email !== existingUser.email) {
      const emailExists = await findUserByEmail(email);

      if (emailExists) {
        return res.status(409).json({ message: 'A user with that email already exists.' });
      }
    }

    const result = await pool.query(
      `UPDATE users SET name = COALESCE($1, name), email = COALESCE($2, email),
       phone = COALESCE($3, phone), role = COALESCE($4, role),
       status = COALESCE($5, status), avatar = COALESCE($6, avatar),
       photo = COALESCE($7, photo), updated_at = CURRENT_TIMESTAMP
       WHERE id = $8
       RETURNING id, name, email, role, status, phone, avatar, photo, updated_at`,
      [name, email, phone, role, status, avatar, photo, id]
    );

    await logActivity(pool, req.user.id, `Updated user ${result.rows[0].name}`, 'User Management', {
      updatedUserId: id,
    });

    return res.status(200).json({
      message: 'User updated successfully',
      user: {
        id: result.rows[0].id,
        name: result.rows[0].name,
        email: result.rows[0].email,
        role: result.rows[0].role,
        status: result.rows[0].status,
      },
    });
  } catch (error) {
    console.error('Update user error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
}

// Change User Role
export async function changeUserRole(req, res) {
  if (req.user.role !== 'owner') {
    return res.status(403).json({ message: 'Forbidden. Only the Owner can change user roles.' });
  }

  const { id } = req.params;
  const { role } = req.body;

  if (!id) {
    return res.status(400).json({ message: 'User ID is required.' });
  }

  if (!role || !['owner', 'product', 'sales', 'stock', 'purchase', 'orders'].includes(role)) {
    return res.status(400).json({ message: 'Valid role is required.' });
  }

  try {
    if (id === req.user.id) {
      return res.status(403).json({ message: 'You cannot change your own role.' });
    }

    const existingUser = await findUserById(id);

    if (!existingUser) {
      return res.status(404).json({ message: 'User not found.' });
    }

    const result = await pool.query(
      `UPDATE users SET role = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 RETURNING id, name, email, role, status, updated_at`,
      [role, id]
    );

    await logActivity(
      pool,
      req.user.id,
      `Changed role of ${result.rows[0].name} from ${existingUser.role} to ${role}`,
      'User Management',
      {
        changedUserId: id,
        previousRole: existingUser.role,
        newRole: role,
      }
    );

    await addNotification({
      title: 'Employee Role Changed',
      message: `${result.rows[0].name} moved from ${existingUser.role} to ${role}`,
      type: 'system',
      relatedId: id,
      relatedType: 'user',
    });

    return res.status(200).json({
      message: 'User role changed successfully',
      user: {
        id: result.rows[0].id,
        name: result.rows[0].name,
        role: result.rows[0].role,
      },
    });
  } catch (error) {
    console.error('Change user role error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
}

// Reset User Password
export async function resetUserPasswordHandler(req, res) {
  if (req.user.role !== 'owner') {
    return res.status(403).json({ message: 'Forbidden. Only the Owner can reset passwords.' });
  }

  const { id } = req.params;

  if (!id) {
    return res.status(400).json({ message: 'User ID is required.' });
  }

  try {
    const existingUser = await findUserById(id);

    if (!existingUser) {
      return res.status(404).json({ message: 'User not found.' });
    }

    const temporaryPassword = `Temp@${Math.floor(100000 + Math.random() * 900000)}`;
    const hashedPassword = await hashPassword(temporaryPassword);

    const result = await pool.query(
      `UPDATE users SET password = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 RETURNING id, name, email, role, status, updated_at`,
      [hashedPassword, id]
    );

    await logActivity(pool, req.user.id, `Reset password for ${result.rows[0].name}`, 'User Management', {
      resetUserId: id,
    });

    return res.status(200).json({
      message: 'Password reset successfully',
      temporaryPassword,
    });
  } catch (error) {
    console.error('Reset password error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
}

// Update User Status
export async function updateUserStatusHandler(req, res) {
  if (req.user.role !== 'owner') {
    return res.status(403).json({ message: 'Forbidden. Only the Owner can change user status.' });
  }

  const { id } = req.params;
  const { status } = req.body;

  if (!id) {
    return res.status(400).json({ message: 'User ID is required.' });
  }

  if (id === req.user.id) {
    return res.status(403).json({ message: 'You cannot deactivate your own account.' });
  }

  if (!['active', 'deactivated'].includes(status)) {
    return res.status(400).json({ message: 'Choose a valid account status.' });
  }

  try {
    const existingUser = await findUserById(id);

    if (!existingUser) {
      return res.status(404).json({ message: 'User not found.' });
    }

    const result = await pool.query(
      `UPDATE users SET status = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 RETURNING id, name, email, role, status, phone, updated_at`,
      [status, id]
    );

    await logActivity(
      pool,
      req.user.id,
      `${status === 'active' ? 'Activated' : 'Deactivated'} user ${result.rows[0].name}`,
      'User Management',
      {
        userId: id,
        newStatus: status,
      }
    );

    await addNotification({
      title: 'User Account Status Changed',
      message: `${result.rows[0].name} account was ${status}`,
      type: 'system',
      relatedId: id,
      relatedType: 'user',
    });

    return res.status(200).json({
      message: `User ${status === 'active' ? 'activated' : 'deactivated'} successfully`,
      user: result.rows[0],
    });
  } catch (error) {
    console.error('Update user status error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
}
