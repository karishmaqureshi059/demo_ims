import express from 'express';
import { pool } from '../config/db.js';
import { authenticateToken } from '../middleware/auth.js';
import { getAttendanceList } from '../services/attendanceService.js';

const router = express.Router();
router.use(authenticateToken);

// Get employee attendance and working hours tracking
router.get('/attendance', async (req, res) => {
  try {
    const filters = {
      employeeId: req.query.employeeId,
      employeeName: req.query.employeeName || req.query.name,
      role: req.query.role,
      date: req.query.date,
      status: req.query.status,
    };

    const records = await getAttendanceList(pool, {
      user: req.user,
      filters,
    });

    return res.status(200).json({
      attendance: records,
    });
  } catch (error) {
    console.error('Get attendance error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

// Get activity records
router.get('/', async (req, res) => {
  try {
    const isOwner = req.user?.role === 'owner';
    let query = `
      SELECT a.*, u.name as user_name, u.email as user_email
      FROM user_activity a
      LEFT JOIN users u ON a.user_id = u.id
    `;
    const params = [];

    if (!isOwner) {
      query += ` WHERE a.user_id = $1`;
      params.push(req.user.id);
    }

    query += ` ORDER BY a.created_at DESC LIMIT 100`;

    const result = await pool.query(query, params);

    return res.status(200).json({
      activity: result.rows.map((row) => ({
        id: row.id,
        userId: row.user_id,
        user: row.user_name || 'System',
        userName: row.user_name || 'System',
        action: row.action,
        module: row.module,
        details: row.details,
        ip: row.ip,
        timestamp: row.created_at,
        time: row.created_at,
      })),
    });
  } catch (error) {
    console.error('Get activity error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

export default router;
