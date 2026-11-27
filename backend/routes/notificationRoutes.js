import express from 'express';
import { pool } from '../config/db.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();
router.use(authenticateToken);

// Get notifications
router.get('/', async (req, res) => {
  try {
    const userId = req.user?.id;
    const result = await pool.query(
      `SELECT * FROM notifications 
       WHERE user_id = $1 OR user_id IS NULL 
       ORDER BY created_at DESC LIMIT 50`,
      [userId]
    );

    return res.status(200).json({
      notifications: result.rows.map((n) => ({
        id: n.id,
        userId: n.user_id,
        title: n.title,
        message: n.message,
        type: n.type,
        read: n.read,
        createdAt: n.created_at,
      })),
    });
  } catch (error) {
    console.error('Get notifications error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

// Mark single notification as read
router.put('/:id/read', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `UPDATE notifications SET read = true WHERE id = $1 RETURNING *`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Notification not found.' });
    }

    const n = result.rows[0];
    return res.status(200).json({
      message: 'Notification marked as read',
      notification: {
        id: n.id,
        userId: n.user_id,
        title: n.title,
        message: n.message,
        type: n.type,
        read: n.read,
        createdAt: n.created_at,
      },
    });
  } catch (error) {
    console.error('Mark notification read error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

// Mark all notifications as read
router.put('/read-all', async (req, res) => {
  try {
    const userId = req.user?.id;
    await pool.query(
      `UPDATE notifications SET read = true WHERE user_id = $1 OR user_id IS NULL`,
      [userId]
    );

    return res.status(200).json({
      message: 'All notifications marked as read',
      success: true,
    });
  } catch (error) {
    console.error('Mark all notifications read error:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

export default router;
