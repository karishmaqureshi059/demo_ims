import { getActivity, getAttendance } from '../api.js';
import { createDataTable } from '../components/table.js';
import { icon } from '../components/icons.js';
import { showToast } from '../components/toast.js';
import { statusBadge } from '../components/cards.js';
import { ROLES } from '../config/roles.js';
import { escapeHtml, formatShortDate, parseDate } from '../utils.js';

export function mount(container, ctx) {
  let cancelled = false;
  let activeTab = 'attendance'; // 'attendance' | 'actions'
  let currentTable = null;

  const isOwner = ctx.user.role === 'owner';

  const host = document.createElement('div');
  host.className = 'stack-md';
  host.style.gap = '20px';

  host.innerHTML = `
    <div class="page-head">
      <div>
        <h1>Activity & Attendance History</h1>
        <p>${isOwner ? 'Employee attendance, working hours tracking, and system audit logs across all workspace accounts.' : 'Your login sessions, working hours tracking, and workspace activity history.'}</p>
      </div>
    </div>
    <div class="card" style="padding:6px 12px; margin-bottom:4px;">
      <div class="filter-tabs" id="activity-tabs" role="group" aria-label="Activity views">
        <button type="button" class="filter-tab active" data-tab="attendance" aria-pressed="true">
          ${icon('clock', 15)} Attendance & Working Hours
        </button>
        <button type="button" class="filter-tab" data-tab="actions" aria-pressed="false">
          ${icon('activity', 15)} System Activity Log
        </button>
      </div>
    </div>
    <div id="activity-table-host"></div>
  `;

  container.appendChild(host);

  const tableHost = host.querySelector('#activity-table-host');

  function bindTabs() {
    host.querySelectorAll('#activity-tabs .filter-tab').forEach((tabBtn) => {
      tabBtn.addEventListener('click', () => {
        const targetTab = tabBtn.dataset.tab;
        if (targetTab === activeTab) return;
        activeTab = targetTab;

        host.querySelectorAll('#activity-tabs .filter-tab').forEach((b) => {
          const isCurrent = b.dataset.tab === activeTab;
          b.classList.toggle('active', isCurrent);
          b.setAttribute('aria-pressed', String(isCurrent));
        });

        load();
      });
    });
  }

  function renderSkeleton() {
    tableHost.innerHTML = `
      <div class="card" style="padding:24px;">
        <div class="skeleton" style="height:16px; width:28%; margin-bottom:16px;"></div>
        ${Array.from({ length: 6 }, () => '<div class="skeleton" style="height:44px; margin-bottom:10px;"></div>').join('')}
      </div>
    `;
  }

  async function load() {
    if (cancelled) return;
    renderSkeleton();

    if (activeTab === 'attendance') {
      try {
        const records = await getAttendance();
        if (cancelled) return;
        tableHost.innerHTML = '';

        // Extract unique roles and employee names for filters
        const uniqueRoles = Array.from(new Set(records.map((r) => r.role))).filter(Boolean);
        const uniqueEmployees = Array.from(new Set(records.map((r) => r.employeeName))).filter(Boolean);

        currentTable = createDataTable(tableHost, {
          columns: [
            {
              key: 'employeeId',
              label: 'Employee ID',
              className: 'nowrap',
              render: (row) => `<span class="badge badge-accent mono font-bold" style="font-size:12px;">${escapeHtml(row.employeeId || 'N/A')}</span>`,
              sortValue: (row) => row.employeeId || '',
              exportValue: (row) => row.employeeId || '',
            },
            {
              key: 'employeeName',
              label: 'Employee Name',
              className: 'nowrap',
              render: (row) => `<span class="cell-strong">${escapeHtml(row.employeeName)}</span>`,
              sortValue: (row) => row.employeeName?.toLowerCase() || '',
              exportValue: (row) => row.employeeName || '',
            },
            {
              key: 'role',
              label: 'Role',
              className: 'nowrap',
              render: (row) => `<span class="badge badge-neutral">${escapeHtml(ROLES[row.role]?.label || row.role)}</span>`,
              sortValue: (row) => row.role || '',
              exportValue: (row) => ROLES[row.role]?.label || row.role,
            },
            {
              key: 'loginDate',
              label: 'Login Date',
              className: 'nowrap',
              render: (row) => `<span class="cell-sub mono">${escapeHtml(row.loginDate)}</span>`,
              sortValue: (row) => row.loginDate || '',
              exportValue: (row) => row.loginDate || '',
            },
            {
              key: 'loginTime',
              label: 'Login Time',
              className: 'nowrap',
              render: (row) => `<span class="cell-sub mono">${escapeHtml(row.loginTime)}</span>`,
              sortValue: (row) => row.rawLoginTime ? new Date(row.rawLoginTime).getTime() : 0,
              exportValue: (row) => row.loginTime || '',
            },
            {
              key: 'logoutTime',
              label: 'Logout Time',
              className: 'nowrap',
              render: (row) => {
                if (row.attendanceStatus === 'Active') {
                  return `<span class="badge badge-success badge-dot">Active session</span>`;
                }
                if (row.attendanceStatus === 'Incomplete') {
                  return `<span class="cell-sub" style="color:var(--text-muted); font-style:italic;">Not recorded (Incomplete)</span>`;
                }
                return `<span class="cell-sub mono">${escapeHtml(row.logoutTime)}</span>`;
              },
              sortValue: (row) => row.rawLogoutTime ? new Date(row.rawLogoutTime).getTime() : 0,
              exportValue: (row) => row.logoutTime || '',
            },
            {
              key: 'totalWorkingHours',
              label: 'Total Working Hours',
              className: 'nowrap',
              render: (row) => {
                if (row.attendanceStatus === 'Incomplete') {
                  return `<span class="cell-sub" style="color:var(--text-muted); font-style:italic;">N/A (Incomplete)</span>`;
                }
                return `<span class="badge badge-info mono font-bold" style="font-size:11.5px;">${escapeHtml(row.totalWorkingHours)}</span>`;
              },
              sortValue: (row) => row.workingHours || 0,
              exportValue: (row) => row.totalWorkingHours || '',
            },
            {
              key: 'attendanceStatus',
              label: 'Attendance Status',
              className: 'nowrap',
              render: (row) => {
                if (row.attendanceStatus === 'Active') return statusBadge('success', 'Active Session');
                if (row.attendanceStatus === 'Completed') return statusBadge('info', 'Completed');
                return statusBadge('warning', 'Incomplete Session');
              },
              sortValue: (row) => row.attendanceStatus || '',
              exportValue: (row) => row.attendanceStatus || '',
            },
          ],
          initialRows: records,
          searchKeys: ['employeeId', 'employeeName', 'role', 'loginDate', 'attendanceStatus', 'totalWorkingHours'],
          filters: [
            ...(isOwner && uniqueEmployees.length > 1 ? [{
              key: 'employeeName',
              label: 'Employee',
              options: uniqueEmployees.sort().map((name) => ({ value: name, label: name })),
            }] : []),
            ...(uniqueRoles.length > 1 ? [{
              key: 'role',
              label: 'Role',
              options: uniqueRoles.map((role) => ({ value: role, label: ROLES[role]?.label || role })),
            }] : []),
            {
              key: 'attendanceStatus',
              label: 'Status',
              options: [
                { value: 'Active', label: 'Active Session' },
                { value: 'Completed', label: 'Completed' },
                { value: 'Incomplete', label: 'Incomplete Session' },
              ],
            },
          ],
          dateKey: 'loginDate',
          pageSize: 12,
          initialSort: { key: 'loginDate', dir: 'desc' },
          exportFilename: `${ctx.user.name.replace(/\s+/g, '-').toLowerCase()}-attendance-history`,
          toolbar: [
            {
              id: 'generate-attendance-report',
              label: 'Generate Report',
              icon: 'download',
              variant: 'secondary',
              onClick: () => {
                const count = currentTable?.exportCSV('attendance-report');
                if (count) showToast(`Attendance report exported — ${count} records.`, 'success');
              },
            },
            {
              id: 'refresh-attendance',
              label: 'Refresh',
              icon: 'refresh',
              variant: 'secondary',
              onClick: () => load(),
            },
          ],
          emptyState: {
            icon: 'clock',
            title: 'No attendance records found',
            message: 'Employee logins, logouts, and working hours will appear here.',
          },
        });
      } catch (error) {
        if (cancelled) return;
        tableHost.innerHTML = `
          <div class="card">
            <div class="state-box error">
              <div class="state-icon">${icon('alertCircle', 22)}</div>
              <h3>Unable to load attendance</h3>
              <p>${escapeHtml(error.message || 'Please check your connection and try again.')}</p>
              <button type="button" class="btn btn-secondary" id="attendance-retry">${icon('refresh', 15)} Retry</button>
            </div>
          </div>`;
        tableHost.querySelector('#attendance-retry')?.addEventListener('click', load);
      }
    } else {
      // System Action Audit Log Tab
      try {
        const entries = await getActivity();
        if (cancelled) return;
        tableHost.innerHTML = '';

        currentTable = createDataTable(tableHost, {
          columns: [
            {
              key: 'timestamp',
              label: 'When',
              className: 'nowrap',
              render: (row) => `<span class="cell-sub mono" style="font-size:11.5px;">${escapeHtml(formatShortDate(row.timestamp))}</span>`,
              sortValue: (row) => parseDate(row.timestamp)?.getTime?.() || 0,
              exportValue: (row) => formatShortDate(row.timestamp),
            },
            ...(isOwner ? [{
              key: 'userName',
              label: 'User',
              className: 'nowrap',
              render: (row) => `<span class="cell-strong">${escapeHtml(row.userName || row.user)}</span>`,
              sortValue: (row) => (row.userName || row.user || '').toLowerCase(),
              exportValue: (row) => row.userName || row.user,
            }] : []),
            {
              key: 'module',
              label: 'Module',
              className: 'nowrap',
              render: (row) => `<span class="badge badge-accent">${escapeHtml(row.module)}</span>`,
              sortValue: (row) => row.module,
              exportValue: (row) => row.module,
            },
            {
              key: 'action',
              label: 'Action',
              render: (row) => `<span>${escapeHtml(row.action)}</span>`,
              sortValue: (row) => row.action.toLowerCase(),
              exportValue: (row) => row.action,
            },
          ],
          initialRows: entries,
          searchKeys: ['action', 'userName', 'user', 'module'],
          filters: [
            {
              key: 'module',
              label: 'Module',
              options: Array.from(new Set(entries.map((row) => row.module))).sort().map((module) => ({ value: module, label: module })),
            },
          ],
          pageSize: 12,
          initialSort: { key: 'timestamp', dir: 'desc' },
          exportFilename: `${ctx.user.name.replace(/\s+/g, '-').toLowerCase()}-activity-history`,
          dateKey: 'timestamp',
          toolbar: [
            {
              id: 'generate-activity-report',
              label: 'Generate Report',
              icon: 'download',
              variant: 'secondary',
              onClick: () => {
                const count = currentTable?.exportCSV('activity-history');
                if (count) showToast(`Report generated — ${count} entries exported.`, 'success');
              },
            },
            {
              id: 'refresh-activity',
              label: 'Refresh',
              icon: 'refresh',
              variant: 'secondary',
              onClick: () => load(),
            },
          ],
          emptyState: {
            icon: 'clock',
            title: 'No activity yet',
            message: 'Your actions will appear here as you work.',
          },
        });
      } catch (error) {
        if (cancelled) return;
        tableHost.innerHTML = `
          <div class="card">
            <div class="state-box error">
              <div class="state-icon">${icon('alertCircle', 22)}</div>
              <h3>Unable to load activity</h3>
              <p>${escapeHtml(error.message || 'Please try again.')}</p>
              <button type="button" class="btn btn-secondary" id="activity-retry">${icon('refresh', 15)} Retry</button>
            </div>
          </div>`;
        tableHost.querySelector('#activity-retry')?.addEventListener('click', load);
      }
    }
  }

  bindTabs();
  load();

  return () => {
    cancelled = true;
    currentTable?.destroy?.();
  };
}
