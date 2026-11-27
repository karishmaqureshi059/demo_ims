/**
 * Employee Attendance and Working Hours Service
 */

export function formatWorkingHours(durationSecs) {
  if (durationSecs == null || durationSecs < 0) return '—';
  const hrs = Math.floor(durationSecs / 3600);
  const mins = Math.floor((durationSecs % 3600) / 60);
  const secs = durationSecs % 60;
  if (hrs > 0) {
    return `${hrs}h ${mins}m`;
  } else if (mins > 0) {
    return `${mins}m ${secs}s`;
  } else {
    return `${secs}s`;
  }
}

/**
 * Record user login for attendance tracking.
 * If there was a previous session still left open, marks it 'Incomplete' without assuming logout time.
 */
export async function recordAttendanceLogin(pool, userId, ip = null, userAgent = null) {
  try {
    // 1. Mark any existing un-closed session as Incomplete (browser closed without logout)
    await pool.query(
      `UPDATE attendance
       SET status = 'Incomplete',
           notes = 'Session ended without explicit logout',
           updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $1 AND logout_time IS NULL AND status = 'Active'`,
      [userId]
    );

    // 2. Insert new Active session
    const result = await pool.query(
      `INSERT INTO attendance (user_id, login_time, status, ip_address, user_agent, created_at, updated_at)
       VALUES ($1, CURRENT_TIMESTAMP, 'Active', $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       RETURNING *`,
      [userId, ip, userAgent]
    );

    return result.rows[0];
  } catch (err) {
    console.error('Failed to record attendance login:', err.message);
    return null;
  }
}

/**
 * Record user logout and compute total working hours.
 */
export async function recordAttendanceLogout(pool, userId) {
  try {
    const activeRes = await pool.query(
      `SELECT * FROM attendance 
       WHERE user_id = $1 AND logout_time IS NULL AND status = 'Active'
       ORDER BY login_time DESC LIMIT 1`,
      [userId]
    );

    if (activeRes.rows.length === 0) {
      return null;
    }

    const session = activeRes.rows[0];
    const loginTime = new Date(session.login_time);
    const logoutTime = new Date();
    const durationMs = Math.max(0, logoutTime.getTime() - loginTime.getTime());
    const durationSecs = Math.floor(durationMs / 1000);
    const hours = Number((durationSecs / 3600).toFixed(2));
    const formatted = formatWorkingHours(durationSecs);

    const updateRes = await pool.query(
      `UPDATE attendance 
       SET logout_time = CURRENT_TIMESTAMP,
           working_hours = $1,
           working_hours_formatted = $2,
           status = 'Completed',
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $3
       RETURNING *`,
      [hours, formatted, session.id]
    );

    return updateRes.rows[0];
  } catch (err) {
    console.error('Failed to record attendance logout:', err.message);
    return null;
  }
}

/**
 * Fetch attendance records with role-based filtering and custom filters.
 */
export async function getAttendanceList(pool, { user, filters = {} }) {
  const isOwner = user.role === 'owner';
  let query = `
    SELECT 
      a.id,
      a.user_id,
      u.employee_id,
      u.name as employee_name,
      u.role,
      a.login_time,
      a.logout_time,
      a.working_hours,
      a.working_hours_formatted,
      a.status,
      a.ip_address,
      a.notes,
      a.created_at
    FROM attendance a
    JOIN users u ON a.user_id = u.id
    WHERE 1=1
  `;
  const params = [];

  // Visibility: Owner sees all employees, each manager only sees their own
  if (!isOwner) {
    params.push(user.id);
    query += ` AND a.user_id = $${params.length}`;
  }

  // Filters
  if (filters.employeeId) {
    params.push(`%${filters.employeeId.trim()}%`);
    query += ` AND u.employee_id ILIKE $${params.length}`;
  }

  if (filters.employeeName) {
    params.push(`%${filters.employeeName.trim()}%`);
    query += ` AND u.name ILIKE $${params.length}`;
  }

  if (filters.role && filters.role !== 'all') {
    params.push(filters.role.trim().toLowerCase());
    query += ` AND LOWER(u.role::text) = $${params.length}`;
  }

  if (filters.date) {
    params.push(filters.date.trim());
    query += ` AND DATE(a.login_time) = $${params.length}::date`;
  }

  if (filters.status && filters.status !== 'all') {
    params.push(filters.status.trim().toLowerCase());
    query += ` AND LOWER(a.status) = $${params.length}`;
  }

  query += ` ORDER BY a.login_time DESC LIMIT 250`;

  const result = await pool.query(query, params);

  return result.rows.map((row) => {
    const loginDateObj = new Date(row.login_time);
    const loginDate = loginDateObj.toISOString().split('T')[0];
    const loginTime = loginDateObj.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    });

    let logoutTime = '—';
    let totalWorkingHours = row.working_hours_formatted || '—';

    if (row.logout_time) {
      const logoutDateObj = new Date(row.logout_time);
      logoutTime = logoutDateObj.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
      });
    } else if (row.status === 'Active') {
      const elapsedSecs = Math.max(0, Math.floor((Date.now() - loginDateObj.getTime()) / 1000));
      totalWorkingHours = `${formatWorkingHours(elapsedSecs)} (Active)`;
      logoutTime = 'Active Session';
    } else if (row.status === 'Incomplete') {
      logoutTime = 'No Logout (Incomplete)';
      totalWorkingHours = 'Incomplete Session';
    }

    return {
      id: row.id,
      userId: row.user_id,
      employeeId: row.employee_id || 'N/A',
      employeeName: row.employee_name,
      role: row.role,
      loginDate,
      loginTime,
      logoutTime,
      totalWorkingHours,
      workingHours: row.working_hours ? Number(row.working_hours) : null,
      attendanceStatus: row.status,
      notes: row.notes,
      rawLoginTime: row.login_time,
      rawLogoutTime: row.logout_time,
    };
  });
}
