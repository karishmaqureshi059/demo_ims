import { pool } from '../config/db.js';

/**
 * Creates a notification in PostgreSQL.
 * @param {Object} options
 * @param {string|null} options.userId - User UUID, or null for broadcast to role/all
 * @param {string} options.title - Short title of notification
 * @param {string} options.message - Notification description
 * @param {'low_stock'|'expiry'|'order'|'system'} [options.type='system'] - Type of notification
 * @param {string|null} [options.relatedId=null] - UUID of related entity
 * @param {string|null} [options.relatedType=null] - Entity name (e.g. 'product', 'sale', 'order', 'purchase')
 */
export async function addNotification({
  userId = null,
  title,
  message,
  type = 'system',
  relatedId = null,
  relatedType = null,
}) {
  try {
    const validTypes = ['low_stock', 'expiry', 'order', 'system'];
    const notifType = validTypes.includes(type) ? type : 'system';
    const result = await pool.query(
      `INSERT INTO notifications (user_id, title, message, type, related_id, related_type, read, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, false, CURRENT_TIMESTAMP)
       RETURNING *`,
      [userId, title, message, notifType, relatedId, relatedType]
    );
    return result.rows[0];
  } catch (err) {
    console.error('Failed to create notification:', err.message);
    return null;
  }
}
