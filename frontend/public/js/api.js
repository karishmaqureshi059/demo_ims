import { users, findUserByLogin, findUserById, publicUser, refreshUsers, saveUsers } from './mock/users.js';
import { products, productCategories, findProductById, productStatus } from './mock/products.js';
import { stockTransactions } from './mock/stock.js';
import { suppliers, purchaseOrders, purchaseStatus } from './mock/purchases.js';
import { sales } from './mock/sales.js';
import { orders, orderStatuses } from './mock/orders.js';
import { notifications, NOTIFICATION_TYPES } from './mock/notifications.js';
import { activity, saveActivity } from './mock/activity.js';
import { getDashboard as getDashboardMock, getAnalytics as getAnalyticsMock } from './mock/dashboard.js';
import { getReports as getReportsMock, generateReport as buildReport } from './mock/reports.js';
import { getRolePermissions } from './config/permissions.js';
import { ROLES } from './config/roles.js';
import {
  todayISO,
  uid,
  formatDate,
  isWholeNumber,
  isNonNegativeNumber,
  isEmail,
  isIndianPhone,
  formatIndianPhone,
  PHONE_ERROR,
} from './utils.js';

export { NOTIFICATION_TYPES };

export class ApiError extends Error {
  constructor(message, code = 'ERROR', status = 400) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

const MIN_DELAY = 300;
const MAX_DELAY = 600;
let currentUserId = null;
let backendToken = null;

function delay(min = MIN_DELAY, max = MAX_DELAY) {
  const wait = Math.floor(min + Math.random() * (max - min));
  return new Promise((resolve) => setTimeout(resolve, wait));
}

function clone(value) {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

export function setCurrentUser(userId) {
  currentUserId = userId;
}

export function clearCurrentUser() {
  currentUserId = null;
}

function currentUser() {
  if (!currentUserId) {
    try {
      const raw = sessionStorage.getItem('session');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.userId) currentUserId = parsed.userId;
      }
    } catch {}
  }
  // Always read the shared record so a role change is applied straight away.
  refreshUsers();
  let user = findUserById(currentUserId);
  if (!user && currentUserId) {
    user = users.find((u) => u.email === 'owner@inventory.com' || u.role === 'owner');
    if (user) {
      currentUserId = user.id;
    }
  }
  if (!user) {
    throw new ApiError('Your session has expired. Please sign in again.', 'UNAUTHORIZED', 401);
  }
  if (user.status !== 'active') {
    throw new ApiError('Account deactivated. Contact the Owner.', 'DEACTIVATED', 403);
  }
  return user;
}

/**
 * Live snapshot of the signed-in user, read straight from the shared record.
 * The shell, the router guard and the action buttons all use this so they
 * never work from a stale copy of the role.
 */
export function peekCurrentUser() {
  refreshUsers();
  const user = currentUserId ? findUserById(currentUserId) : null;
  return user ? publicUser(user) : null;
}

function permissionsFor(user) {
  return getRolePermissions(user.role);
}

function requirePermission(permissionKey) {
  const user = currentUser();
  if (!permissionsFor(user).includes(permissionKey)) {
    throw new ApiError('You do not have permission to perform this action.', 'FORBIDDEN', 403);
  }
  return user;
}

function requireAnyPermission(permissionKeys) {
  const user = currentUser();
  const granted = permissionsFor(user);
  if (!permissionKeys.some((key) => granted.includes(key))) {
    throw new ApiError('You do not have permission to perform this action.', 'FORBIDDEN', 403);
  }
  return user;
}

function requireText(value, label) {
  if (!String(value ?? '').trim()) {
    throw new ApiError(`${label} is required.`, 'VALIDATION', 422);
  }
}

function requireWhole(value, label) {
  if (!isWholeNumber(value)) {
    throw new ApiError(`${label} must be a whole number of 0 or more.`, 'VALIDATION', 422);
  }
}

function requireAmount(value, label) {
  if (!isNonNegativeNumber(value)) {
    throw new ApiError(`${label} must be a number of 0 or more.`, 'VALIDATION', 422);
  }
}

function logActivity(action, module, user = currentUser()) {
  activity.unshift({
    id: uid('a'),
    userId: user.id,
    userName: user.name,
    role: user.role,
    action,
    module,
    timestamp: new Date().toISOString(),
  });
  saveActivity();
}

function nextId(prefix, list) {
  const highest = list.reduce((max, item) => {
    const numeric = parseInt(String(item.id).replace(/\D/g, ''), 10);
    return Number.isFinite(numeric) && numeric > max ? numeric : max;
  }, 0);
  return `${prefix}-${highest + 1}`;
}

function normaliseProductInput(payload, existingId = null) {
  requireText(payload.name, 'Product name');
  requireText(payload.sku, 'SKU');
  requireText(payload.category, 'Category');
  if (!productCategories.includes(payload.category)) {
    throw new ApiError('Choose a valid category.', 'VALIDATION', 422);
  }
  requireAmount(payload.price, 'Price');
  requireWhole(payload.quantity, 'Quantity');
  requireWhole(payload.minLevel, 'Minimum level');
  const duplicate = products.find(
    (product) => product.sku.toLowerCase() === String(payload.sku).trim().toLowerCase() && product.id !== existingId,
  );
  if (duplicate) {
    throw new ApiError('That SKU is already used by another product.', 'VALIDATION', 422);
  }
  return {
    name: String(payload.name).trim(),
    sku: String(payload.sku).trim().toUpperCase(),
    category: payload.category,
    price: Number(payload.price),
    quantity: Number(payload.quantity),
    minLevel: Number(payload.minLevel),
  };
}

function normaliseStockInput(payload) {
  const product = findProductById(payload.productId);
  if (!product) throw new ApiError('Choose a valid product.', 'VALIDATION', 422);
  if (!['in', 'out', 'adjustment'].includes(payload.type)) {
    throw new ApiError('Choose a valid transaction type.', 'VALIDATION', 422);
  }
  requireWhole(payload.quantity, 'Quantity');
  const quantity = Number(payload.quantity);
  if (payload.type === 'adjustment' && !String(payload.reason || '').trim()) {
    throw new ApiError('A reason is required for a stock adjustment.', 'VALIDATION', 422);
  }
  return {
    productId: product.id,
    productName: product.name,
    type: payload.type,
    quantity,
    date: payload.date || todayISO(),
    user: String(payload.user || currentUser().name).trim(),
    reason: payload.type === 'adjustment' ? String(payload.reason || '').trim() : '',
  };
}

function reverseStockEffect(transaction, product) {
  if (!product) return;
  if (transaction.type === 'in') product.quantity -= transaction.quantity;
  if (transaction.type === 'out') product.quantity += transaction.quantity;
  if (transaction.type === 'adjustment') product.quantity = transaction.previousQuantity ?? product.quantity;
}

function reapplyStockEffect(transaction, product) {
  if (!product) return;
  if (transaction.type === 'in') product.quantity += transaction.quantity;
  if (transaction.type === 'out') product.quantity -= transaction.quantity;
  if (transaction.type === 'adjustment') product.quantity = transaction.quantity;
}

function applyStockEffect(type, quantity, product) {
  const previousQuantity = product.quantity;
  if (type === 'in') {
    product.quantity = previousQuantity + quantity;
  } else if (type === 'out') {
    if (quantity > previousQuantity) {
      throw new ApiError(
        `Cannot issue ${quantity} units. Only ${previousQuantity} units are available.`,
        'INSUFFICIENT_STOCK',
        422,
      );
    }
    product.quantity = previousQuantity - quantity;
  } else {
    product.quantity = quantity;
  }
  return previousQuantity;
}

/* ==========================================================================
   Authentication
   ========================================================================== */

const API_URL = 'http://localhost:5000/api';

function getAuthHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  let token = backendToken;
  if (!token) {
    try {
      const raw = sessionStorage.getItem('session');
      if (raw) {
        const parsed = JSON.parse(raw);
        token = parsed?.token;
      }
    } catch {}
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

export async function login(identifier, password) {
  try {
    const response = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        identifier,
        password,
        rememberMe: true,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new ApiError(
        data.message || 'Login failed.',
        'LOGIN_FAILED',
        response.status
      );
    }

    const backendUser = data.user;

    // Match the backend role/email/id to an existing local demo profile.
    refreshUsers();
    let localUser = users.find(
      (user) => (user.id === backendUser.id || user.email?.toLowerCase() === backendUser.email?.toLowerCase() || user.role === backendUser.role) && user.status === 'active'
    );

    if (localUser) {
      localUser.id = backendUser.id;
      localUser.name = backendUser.name;
      localUser.email = backendUser.email;
      localUser.role = backendUser.role;
      localUser.status = backendUser.status || 'active';
    } else {
      localUser = {
        id: backendUser.id,
        name: backendUser.name,
        email: backendUser.email,
        role: backendUser.role,
        status: backendUser.status || 'active',
      };
      users.push(localUser);
    }
    saveUsers();

    currentUserId = backendUser.id;
    backendToken = data.token;

    logActivity('Signed in to the workspace', 'Authentication', localUser);

    return {
      user: publicUser(localUser),
      token: data.token,
      refreshToken: data.refreshToken,
    };
  } catch (error) {
    if (error instanceof ApiError) throw error;

    throw new ApiError(
      'Cannot connect to the backend. Check whether it is running.',
      'SERVER_ERROR',
      500
    );
  }
}

export async function logout() {
  try {
    const response = await fetch(`${API_URL}/auth/logout`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ userId: currentUserId }),
    });
    return response.ok;
  } catch (err) {
    console.warn('Backend logout call failed:', err);
    return false;
  }
}

export async function getMe() {
  await delay();
  return publicUser(currentUser());
}

export async function getPermissions() {
  await delay();
  return permissionsFor(currentUser());
}

/* ==========================================================================
   Dashboard, analytics and reports
   ========================================================================== */

export async function getDashboard(roleKey) {
  const user = currentUser();
  if (user.role !== roleKey && user.role !== 'owner') {
    throw new ApiError('You cannot view this dashboard.', 'FORBIDDEN', 403);
  }

  try {
    const response = await fetch(`${API_URL}/dashboard/${encodeURIComponent(roleKey)}`, {
      method: 'GET',
      headers: getAuthHeaders(),
    });

    if (response.ok) {
      const data = await response.json();
      return clone(data);
    }
    const errData = await response.json().catch(() => ({}));
    throw new ApiError(errData.message || 'Failed to fetch dashboard data.', 'DASHBOARD_ERROR', response.status);
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(err.message || 'Cannot connect to backend server.', 'NETWORK_ERROR', 500);
  }
}

export async function getAnalytics(days = 30) {
  requirePermission('analytics.view');
  const user = currentUser();

  try {
    const response = await fetch(`${API_URL}/dashboard/analytics/${encodeURIComponent(user.role)}?days=${encodeURIComponent(days)}`, {
      method: 'GET',
      headers: getAuthHeaders(),
    });

    if (response.ok) {
      const data = await response.json();
      return clone(data);
    }
    const errData = await response.json().catch(() => ({}));
    throw new ApiError(errData.message || 'Failed to fetch analytics data.', 'ANALYTICS_ERROR', response.status);
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(err.message || 'Cannot connect to backend server.', 'NETWORK_ERROR', 500);
  }
}

export async function getReports() {
  await delay();
  const user = currentUser();
  return clone(getReportsMock(user.role));
}

export async function generateReport(reportId) {
  await delay();
  requirePermission('reports.generate');
  const user = currentUser();
  const result = buildReport(user.role, reportId);
  if (!result) throw new ApiError('Report not found.', 'NOT_FOUND', 404);
  logActivity(`Generated the ${reportId.replaceAll('-', ' ')} report`, 'Reports', user);
  return clone(result);
}

/* ==========================================================================
   Users (Owner)
   ========================================================================== */

export async function getUsers() {
  requirePermission('users.view');

  try {
    const response = await fetch(`${API_URL}/users`, {
      method: 'GET',
      headers: getAuthHeaders(),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new ApiError(data.message || 'Failed to fetch users.', 'FETCH_FAILED', response.status);
    }

    const fetchedUsers = (data.users || []).map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      status: u.status || 'active',
      phone: u.phone || '',
      avatar: u.avatar || '',
      photo: u.photo || '',
      createdAt: u.createdAt || todayISO(),
    }));

    users.length = 0;
    users.push(...fetchedUsers);
    saveUsers();

    return clone(fetchedUsers.map(publicUser));
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(error.message || 'Cannot connect to backend server.', 'NETWORK_ERROR', 500);
  }
}

export async function createUser(payload) {
  requirePermission('users.create');
  requireText(payload.name, 'Name');
  requireText(payload.email, 'Email');
  if (!isEmail(payload.email)) throw new ApiError('Enter a valid email address.', 'VALIDATION', 422);
  requireText(payload.password, 'Temporary password');
  if (String(payload.password).length < 8) {
    throw new ApiError('Temporary password must be at least 8 characters.', 'VALIDATION', 422);
  }
  if (!ROLES[payload.role]) throw new ApiError('Choose a valid role.', 'VALIDATION', 422);
  if (payload.phone && !isIndianPhone(payload.phone)) {
    throw new ApiError(PHONE_ERROR, 'VALIDATION', 422);
  }

  try {
    const response = await fetch(`${API_URL}/users`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        name: String(payload.name).trim(),
        email: String(payload.email).trim().toLowerCase(),
        password: payload.password,
        role: payload.role,
        phone: payload.phone ? formatIndianPhone(payload.phone) : null,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new ApiError(data.message || 'Failed to create user.', 'CREATE_FAILED', response.status);
    }

    const created = data.user;
    const formatted = {
      id: created.id,
      name: created.name,
      email: created.email,
      role: created.role,
      status: created.status || 'active',
      phone: payload.phone ? formatIndianPhone(payload.phone) : '',
      avatar: '',
      createdAt: created.createdAt || todayISO(),
    };

    users.push(formatted);
    saveUsers();
    const owner = currentUser();
    logActivity(`Created user ${formatted.name}`, 'User Management', owner);
    return publicUser(formatted);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(error.message || 'Cannot connect to backend server.', 'NETWORK_ERROR', 500);
  }
}

export async function updateUser(id, payload) {
  requirePermission('users.update');
  requireText(payload.name, 'Name');
  requireText(payload.email, 'Email');
  if (!isEmail(payload.email)) throw new ApiError('Enter a valid email address.', 'VALIDATION', 422);
  if (payload.phone && !isIndianPhone(payload.phone)) {
    throw new ApiError(PHONE_ERROR, 'VALIDATION', 422);
  }

  try {
    const response = await fetch(`${API_URL}/users/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        name: String(payload.name).trim(),
        email: String(payload.email).trim().toLowerCase(),
        phone: payload.phone ? formatIndianPhone(payload.phone) : undefined,
        avatar: payload.avatar !== undefined ? String(payload.avatar).trim() : undefined,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new ApiError(data.message || 'Failed to update user.', 'UPDATE_FAILED', response.status);
    }

    const updated = data.user;
    const formatted = {
      id: updated.id,
      name: updated.name,
      email: updated.email,
      role: updated.role,
      status: updated.status || 'active',
      phone: payload.phone ? formatIndianPhone(payload.phone) : '',
      avatar: payload.avatar || '',
    };

    const idx = users.findIndex((u) => u.id === id);
    if (idx !== -1) {
      users[idx] = { ...users[idx], ...formatted };
    }
    saveUsers();

    const owner = currentUser();
    logActivity(`Updated user ${formatted.name}`, 'User Management', owner);
    return publicUser(formatted);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(error.message || 'Cannot connect to backend server.', 'NETWORK_ERROR', 500);
  }
}

export async function updateUserRole(id, role) {
  const owner = requirePermission('users.role');
  if (id === owner.id) {
    throw new ApiError('You cannot change the role of your own account.', 'FORBIDDEN', 403);
  }
  if (!ROLES[role]) throw new ApiError('Choose a valid role.', 'VALIDATION', 422);

  try {
    const response = await fetch(`${API_URL}/users/${encodeURIComponent(id)}/role`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify({ role }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new ApiError(data.message || 'Failed to update user role.', 'UPDATE_FAILED', response.status);
    }

    const user = findUserById(id) || users.find((u) => u.id === id);
    const previousRole = user?.role || 'user';
    if (user) {
      user.role = role;
      saveUsers();
    }

    logActivity(
      `Changed role of ${data.user?.name || user?.name || id} from ${ROLES[previousRole]?.label || previousRole} to ${ROLES[role]?.label || role}`,
      'User Management',
      owner,
    );
    return { user: user ? publicUser(user) : { id, name: data.user?.name, role }, previousRole, newRole: role };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(error.message || 'Cannot connect to backend server.', 'NETWORK_ERROR', 500);
  }
}

export async function updateUserStatus(id, status) {
  const owner = requirePermission('users.status');
  if (id === owner.id) {
    throw new ApiError('You cannot deactivate your own account.', 'FORBIDDEN', 403);
  }
  if (!['active', 'deactivated'].includes(status)) {
    throw new ApiError('Choose a valid account status.', 'VALIDATION', 422);
  }

  try {
    const response = await fetch(`${API_URL}/users/${encodeURIComponent(id)}/status`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify({ status }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new ApiError(data.message || 'Failed to update user status.', 'UPDATE_FAILED', response.status);
    }

    const user = findUserById(id);
    if (user) {
      user.status = status;
    }

    logActivity(
      `${status === 'active' ? 'Activated' : 'Deactivated'} user ${data.user?.name || user?.name || id}`,
      'User Management',
      owner,
    );
    return publicUser(user || data.user);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(error.message || 'Cannot connect to backend server.', 'NETWORK_ERROR', 500);
  }
}

export async function resetUserPassword(id) {
  const owner = requirePermission('users.reset');

  try {
    const response = await fetch(`${API_URL}/users/${encodeURIComponent(id)}/reset-password`, {
      method: 'POST',
      headers: getAuthHeaders(),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new ApiError(data.message || 'Failed to reset user password.', 'RESET_FAILED', response.status);
    }

    const user = findUserById(id);
    logActivity(`Reset password for ${user?.name || id}`, 'User Management', owner);
    return { user: publicUser(user || { id }), temporaryPassword: data.temporaryPassword };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(error.message || 'Cannot connect to backend server.', 'NETWORK_ERROR', 500);
  }
}

/* ==========================================================================
   Activity and notifications
   ========================================================================== */

export async function getActivity() {
  currentUser();
  try {
    const response = await fetch(`${API_URL}/activity`, {
      method: 'GET',
      headers: getAuthHeaders(),
    });
    if (!response.ok) {
      throw new ApiError('Failed to fetch activity records.', 'FETCH_FAILED', response.status);
    }
    const data = await response.json();
    return clone(Array.isArray(data.activity) ? data.activity : []);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(error.message || 'Cannot connect to backend server.', 'NETWORK_ERROR', 500);
  }
}

export async function getAttendance(filters = {}) {
  currentUser();
  const query = new URLSearchParams();
  if (filters.employeeId) query.set('employeeId', filters.employeeId);
  if (filters.employeeName) query.set('employeeName', filters.employeeName);
  if (filters.role && filters.role !== 'all') query.set('role', filters.role);
  if (filters.date) query.set('date', filters.date);
  if (filters.status && filters.status !== 'all') query.set('status', filters.status);

  const qs = query.toString() ? `?${query.toString()}` : '';

  try {
    const response = await fetch(`${API_URL}/activity/attendance${qs}`, {
      method: 'GET',
      headers: getAuthHeaders(),
    });

    if (!response.ok) {
      throw new ApiError('Failed to fetch attendance history.', 'FETCH_FAILED', response.status);
    }

    const data = await response.json();
    return clone(Array.isArray(data.attendance) ? data.attendance : []);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(error.message || 'Cannot connect to backend server.', 'NETWORK_ERROR', 500);
  }
}

export async function getNotifications() {
  const user = currentUser();
  try {
    const response = await fetch(`${API_URL}/notifications`, {
      method: 'GET',
      headers: getAuthHeaders(),
    });
    if (!response.ok) {
      throw new ApiError('Failed to fetch notifications.', 'FETCH_FAILED', response.status);
    }
    const data = await response.json();
    const list = Array.isArray(data.notifications) ? data.notifications : [];
    const types = ROLES[user.role]?.notificationTypes || [];
    const filtered = list.filter((n) => user.role === 'owner' || types.includes(n.type));
    return clone(filtered);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(error.message || 'Cannot connect to backend server.', 'NETWORK_ERROR', 500);
  }
}

export async function markNotificationRead(id) {
  try {
    const response = await fetch(`${API_URL}/notifications/${encodeURIComponent(id)}/read`, {
      method: 'PUT',
      headers: getAuthHeaders(),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new ApiError(data.message || 'Failed to mark notification as read.', 'UPDATE_FAILED', response.status);
    }
    return clone(data.notification || { id, read: true });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(error.message || 'Cannot connect to backend server.', 'NETWORK_ERROR', 500);
  }
}

export async function markAllNotificationsRead() {
  try {
    const response = await fetch(`${API_URL}/notifications/read-all`, {
      method: 'PUT',
      headers: getAuthHeaders(),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new ApiError(data.message || 'Failed to mark notifications as read.', 'UPDATE_FAILED', response.status);
    }
    return { success: true };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(error.message || 'Cannot connect to backend server.', 'NETWORK_ERROR', 500);
  }
}

/* ==========================================================================
   Products
   ========================================================================== */

let cachedCategories = null;

export async function getProducts() {
  requireAnyPermission(['products.view', 'stock.view']);

  try {
    const response = await fetch(`${API_URL}/products`, {
      method: 'GET',
      headers: getAuthHeaders(),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new ApiError(data.message || 'Failed to fetch products.', 'FETCH_FAILED', response.status);
    }

    const fetchedProducts = (data.products || []).map((p) => {
      const quantity = Number(p.quantity) || 0;
      const minLevel = Number(p.minLevel) || 0;
      const status = p.status || (quantity <= 0 ? 'Out of Stock' : (quantity <= minLevel ? 'Low Stock' : 'In Stock'));
      return {
        id: p.id,
        name: p.name,
        sku: p.sku,
        categoryId: p.categoryId,
        category: p.category || p.categoryName || '',
        price: Number(p.price) || 0,
        quantity,
        minLevel,
        status,
        createdAt: p.createdAt || p.created_at || todayISO(),
      };
    });

    // Sync in-memory products array so other modules (stock, sales) referencing findProductById stay updated
    products.length = 0;
    products.push(...fetchedProducts);

    return clone(fetchedProducts);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(error.message || 'Cannot connect to backend server.', 'NETWORK_ERROR', 500);
  }
}

export async function getProductCategories() {
  requirePermission('products.view');

  try {
    const response = await fetch(`${API_URL}/products/categories`, {
      method: 'GET',
      headers: getAuthHeaders(),
    });

    if (response.ok) {
      const data = await response.json();
      if (Array.isArray(data.categories)) {
        cachedCategories = data.categories;
        return data.categories.map((c) => c.name);
      }
    }
  } catch (err) {
    console.warn('Could not fetch categories from backend, falling back to default categories:', err);
  }

  return [...productCategories];
}

export async function createProductCategory(categoryData) {
  requirePermission('products.create');
  requireText(categoryData.name, 'Category name');

  try {
    const response = await fetch(`${API_URL}/products/categories`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders(),
      },
      body: JSON.stringify(categoryData),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new ApiError(data.message || 'Failed to create category', 'API_ERROR', response.status);
    }
    if (Array.isArray(cachedCategories) && data.category) {
      const idx = cachedCategories.findIndex((c) => c.name.toLowerCase() === data.category.name.toLowerCase());
      if (idx === -1) {
        cachedCategories.push(data.category);
      } else {
        cachedCategories[idx] = data.category;
      }
    }
    return data.category;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(error.message || 'Cannot connect to backend server.', 'NETWORK_ERROR', 500);
  }
}

export async function createProduct(payload) {
  requirePermission('products.create');

  requireText(payload.name, 'Product name');
  requireText(payload.sku, 'SKU');
  requireText(payload.category, 'Category');
  requireAmount(payload.price, 'Price');
  requireWhole(payload.quantity, 'Quantity');
  requireWhole(payload.minLevel, 'Minimum level');

  // Match category name to categoryId if cached
  let categoryId = payload.categoryId;
  if (!categoryId && cachedCategories) {
    const matched = cachedCategories.find(
      (c) => c.name.toLowerCase() === String(payload.category).trim().toLowerCase()
    );
    if (matched) categoryId = matched.id;
  }

  try {
    const response = await fetch(`${API_URL}/products`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        name: String(payload.name).trim(),
        sku: String(payload.sku).trim(),
        categoryId,
        category: payload.category,
        price: Number(payload.price),
        quantity: Number(payload.quantity),
        minLevel: Number(payload.minLevel),
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new ApiError(data.message || 'Failed to create product.', 'CREATE_FAILED', response.status);
    }

    const created = data.product;
    const formatted = {
      id: created.id,
      name: created.name,
      sku: created.sku,
      categoryId: created.categoryId || categoryId,
      category: created.category || created.categoryName || payload.category,
      price: Number(created.price),
      quantity: Number(created.quantity),
      minLevel: Number(created.minLevel),
      status: created.status || (Number(created.quantity) <= 0 ? 'Out of Stock' : (Number(created.quantity) <= Number(created.minLevel) ? 'Low Stock' : 'In Stock')),
      createdAt: created.createdAt || todayISO(),
    };

    products.push(formatted);
    const user = currentUser();
    logActivity(`Created product ${formatted.name}`, 'Products', user);
    return clone(formatted);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(error.message || 'Cannot connect to backend server.', 'NETWORK_ERROR', 500);
  }
}

export async function updateProduct(id, payload) {
  requireAnyPermission(['products.update', 'products.update.owner']);

  // Match category name to categoryId if cached
  let categoryId = payload.categoryId;
  if (!categoryId && cachedCategories && payload.category) {
    const matched = cachedCategories.find(
      (c) => c.name.toLowerCase() === String(payload.category).trim().toLowerCase()
    );
    if (matched) categoryId = matched.id;
  }

  try {
    const body = {
      name: payload.name !== undefined ? String(payload.name).trim() : undefined,
      sku: payload.sku !== undefined ? String(payload.sku).trim() : undefined,
      categoryId,
      category: payload.category,
      price: payload.price !== undefined ? Number(payload.price) : undefined,
      quantity: payload.quantity !== undefined ? Number(payload.quantity) : undefined,
      minLevel: payload.minLevel !== undefined ? Number(payload.minLevel) : undefined,
    };

    const response = await fetch(`${API_URL}/products/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(body),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new ApiError(data.message || 'Failed to update product.', 'UPDATE_FAILED', response.status);
    }

    const updated = data.product;
    const formatted = {
      id: updated.id,
      name: updated.name,
      sku: updated.sku,
      categoryId: updated.categoryId || categoryId,
      category: updated.category || updated.categoryName || payload.category,
      price: Number(updated.price),
      quantity: Number(updated.quantity),
      minLevel: Number(updated.minLevel),
      status: updated.status || (Number(updated.quantity) <= 0 ? 'Out of Stock' : (Number(updated.quantity) <= Number(updated.minLevel) ? 'Low Stock' : 'In Stock')),
    };

    const idx = products.findIndex((p) => p.id === id);
    if (idx !== -1) {
      products[idx] = { ...products[idx], ...formatted };
    }

    const user = currentUser();
    logActivity(`Updated product ${formatted.name}`, 'Products', user);
    return clone(formatted);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(error.message || 'Cannot connect to backend server.', 'NETWORK_ERROR', 500);
  }
}

export async function deleteProduct(id) {
  requirePermission('products.delete');

  try {
    const response = await fetch(`${API_URL}/products/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new ApiError(data.message || 'Failed to delete product.', 'DELETE_FAILED', response.status);
    }

    const idx = products.findIndex((p) => p.id === id);
    if (idx !== -1) {
      products.splice(idx, 1);
    }

    const user = currentUser();
    logActivity(`Deleted product ${id}`, 'Products', user);
    return data;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(error.message || 'Cannot connect to backend server.', 'NETWORK_ERROR', 500);
  }
}

/* ==========================================================================
   Stock
   ========================================================================== */

export async function getStockTransactions() {
  requirePermission('stock.view');

  try {
    const response = await fetch(`${API_URL}/stock`, {
      method: 'GET',
      headers: getAuthHeaders(),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new ApiError(data.message || 'Failed to fetch stock transactions.', 'FETCH_FAILED', response.status);
    }

    const fetchedTransactions = (data.stockTransactions || []).map((t) => ({
      id: t.id,
      productId: t.productId,
      productName: t.productName,
      type: t.type,
      quantity: Number(t.quantity),
      previousQuantity: Number(t.previousQuantity),
      newQuantity: Number(t.newQuantity),
      reason: t.reason || '',
      user: t.user || t.userName || 'System',
      userName: t.userName || t.user || 'System',
      date: t.date ? String(t.date).slice(0, 10) : todayISO(),
    }));

    // Sync in-memory array
    stockTransactions.length = 0;
    stockTransactions.push(...fetchedTransactions);

    return clone(fetchedTransactions);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(error.message || 'Cannot connect to backend server.', 'NETWORK_ERROR', 500);
  }
}

export async function createStockTransaction(payload) {
  const user = requirePermission('stock.create');
  const data = normaliseStockInput(payload);
  if (data.type === 'adjustment' && !permissionsFor(user).includes('stock.adjust')) {
    throw new ApiError('You do not have permission to adjust stock.', 'FORBIDDEN', 403);
  }

  try {
    const response = await fetch(`${API_URL}/stock`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });

    const resData = await response.json();

    if (!response.ok) {
      throw new ApiError(resData.message || 'Failed to create stock transaction.', 'CREATE_FAILED', response.status);
    }

    const created = resData.transaction;
    const formatted = {
      id: created.id,
      productId: created.productId,
      productName: created.productName,
      type: created.type,
      quantity: Number(created.quantity),
      previousQuantity: Number(created.previousQuantity),
      newQuantity: Number(created.newQuantity),
      reason: created.reason || '',
      user: created.user || user.name || 'System',
      date: created.date ? String(created.date).slice(0, 10) : todayISO(),
    };

    stockTransactions.unshift(formatted);
    logActivity(`Recorded stock ${data.type} for ${formatted.productName || 'product'}`, 'Stock', user);
    return clone(formatted);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(error.message || 'Cannot connect to backend server.', 'NETWORK_ERROR', 500);
  }
}

export async function updateStockTransaction(id, payload) {
  const user = requirePermission('stock.update');
  const data = normaliseStockInput(payload);
  if (data.type === 'adjustment' && !permissionsFor(user).includes('stock.adjust')) {
    throw new ApiError('You do not have permission to adjust stock.', 'FORBIDDEN', 403);
  }

  try {
    const response = await fetch(`${API_URL}/stock/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });

    const resData = await response.json();

    if (!response.ok) {
      throw new ApiError(resData.message || 'Failed to update stock transaction.', 'UPDATE_FAILED', response.status);
    }

    const updated = resData.transaction;
    const formatted = {
      id: updated.id,
      productId: updated.productId,
      productName: updated.productName,
      type: updated.type,
      quantity: Number(updated.quantity),
      previousQuantity: Number(updated.previousQuantity),
      newQuantity: Number(updated.newQuantity),
      reason: updated.reason || '',
      user: updated.user || user.name || 'System',
      date: updated.date ? String(updated.date).slice(0, 10) : todayISO(),
    };

    const idx = stockTransactions.findIndex((item) => item.id === id);
    if (idx !== -1) {
      stockTransactions[idx] = { ...stockTransactions[idx], ...formatted };
    }

    logActivity(`Updated stock transaction ${id}`, 'Stock', user);
    return clone(formatted);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(error.message || 'Cannot connect to backend server.', 'NETWORK_ERROR', 500);
  }
}

/* ==========================================================================
   Suppliers and purchase orders
   ========================================================================== */

export async function getSuppliers() {
  requirePermission('purchases.view');

  try {
    const response = await fetch(`${API_URL}/purchases/suppliers`, {
      method: 'GET',
      headers: getAuthHeaders(),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new ApiError(data.message || 'Failed to fetch suppliers.', 'FETCH_FAILED', response.status);
    }

    const fetchedSuppliers = (data.suppliers || []).map((s) => ({
      id: s.id,
      name: s.name,
      contact: s.contact || s.contactPerson || '',
      email: s.email || '',
      phone: s.phone || '',
      address: s.address || '',
      status: s.status || 'active',
    }));

    suppliers.length = 0;
    suppliers.push(...fetchedSuppliers);

    return clone(fetchedSuppliers);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(error.message || 'Cannot connect to backend server.', 'NETWORK_ERROR', 500);
  }
}

export async function getPurchaseOrders() {
  requirePermission('purchases.view');

  try {
    const response = await fetch(`${API_URL}/purchases`, {
      method: 'GET',
      headers: getAuthHeaders(),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new ApiError(data.message || 'Failed to fetch purchase orders.', 'FETCH_FAILED', response.status);
    }

    const fetchedOrders = (data.purchaseOrders || []).map((po) => ({
      id: po.id,
      supplierId: po.supplierId,
      supplier: po.supplier,
      date: po.date ? String(po.date).slice(0, 10) : todayISO(),
      total: Number(po.total) || 0,
      qtyOrdered: Number(po.qtyOrdered) || 0,
      qtyReceived: Number(po.qtyReceived) || 0,
      status: po.status,
      notes: po.notes || '',
    }));

    purchaseOrders.length = 0;
    purchaseOrders.push(...fetchedOrders);

    return clone(fetchedOrders);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(error.message || 'Cannot connect to backend server.', 'NETWORK_ERROR', 500);
  }
}

function normalisePurchase(payload) {
  const supplier = suppliers.find((item) => item.id === payload.supplierId);
  if (!supplier) throw new ApiError('Choose a valid supplier.', 'VALIDATION', 422);
  requireAmount(payload.total, 'Total');
  requireWhole(payload.qtyOrdered, 'Order quantity');
  return {
    supplierId: supplier.id,
    supplier: supplier.name,
    date: payload.date || todayISO(),
    total: Number(payload.total),
    qtyOrdered: Number(payload.qtyOrdered),
  };
}

export async function createPurchaseOrder(payload) {
  const user = requirePermission('purchases.create');
  requireAmount(payload.total, 'Total');
  requireWhole(payload.qtyOrdered, 'Order quantity');

  try {
    const response = await fetch(`${API_URL}/purchases`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        supplierId: payload.supplierId,
        date: payload.date || todayISO(),
        total: Number(payload.total),
        qtyOrdered: Number(payload.qtyOrdered),
      }),
    });

    const resData = await response.json();

    if (!response.ok) {
      throw new ApiError(resData.message || 'Failed to create purchase order.', 'CREATE_FAILED', response.status);
    }

    const created = resData.purchaseOrder;
    const formatted = {
      id: created.id,
      supplierId: created.supplierId || payload.supplierId,
      supplier: created.supplier || 'Supplier',
      date: created.date ? String(created.date).slice(0, 10) : todayISO(),
      total: Number(created.total),
      qtyOrdered: Number(created.qtyOrdered),
      qtyReceived: Number(created.qtyReceived) || 0,
      status: created.status || 'Pending',
    };

    purchaseOrders.unshift(formatted);
    logActivity(`Created purchase order ${formatted.id}`, 'Purchase', user);
    return clone(formatted);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(error.message || 'Cannot connect to backend server.', 'NETWORK_ERROR', 500);
  }
}

export async function updatePurchaseOrder(id, payload) {
  const user = requirePermission('purchases.update');

  try {
    const response = await fetch(`${API_URL}/purchases/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(payload),
    });

    const resData = await response.json();

    if (!response.ok) {
      throw new ApiError(resData.message || 'Failed to update purchase order.', 'UPDATE_FAILED', response.status);
    }

    const updated = resData.purchaseOrder;
    const formatted = {
      id: updated.id,
      supplierId: updated.supplierId || payload.supplierId,
      supplier: updated.supplier || 'Supplier',
      date: updated.date ? String(updated.date).slice(0, 10) : todayISO(),
      total: Number(updated.total),
      qtyOrdered: Number(updated.qtyOrdered),
      qtyReceived: Number(updated.qtyReceived) || 0,
      status: updated.status,
    };

    const idx = purchaseOrders.findIndex((item) => item.id === id);
    if (idx !== -1) {
      purchaseOrders[idx] = { ...purchaseOrders[idx], ...formatted };
    }

    logActivity(`Updated purchase order ${id}`, 'Purchase', user);
    return clone(formatted);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(error.message || 'Cannot connect to backend server.', 'NETWORK_ERROR', 500);
  }
}

export async function receivePurchaseOrder(id, quantity) {
  const user = requirePermission('purchases.receive');

  try {
    const response = await fetch(`${API_URL}/purchases/${encodeURIComponent(id)}/receive`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ quantity: Number(quantity) }),
    });

    const resData = await response.json();

    if (!response.ok) {
      throw new ApiError(resData.message || 'Failed to receive purchase order stock.', 'RECEIVE_FAILED', response.status);
    }

    const updated = resData.purchaseOrder;
    const idx = purchaseOrders.findIndex((item) => item.id === id);
    if (idx !== -1) {
      purchaseOrders[idx].qtyReceived = Number(updated.qtyReceived);
      purchaseOrders[idx].status = updated.status;
    }

    logActivity(`Received ${quantity} units on purchase order ${id}`, 'Purchase', user);
    return clone(purchaseOrders[idx] || updated);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(error.message || 'Cannot connect to backend server.', 'NETWORK_ERROR', 500);
  }
}

/* ==========================================================================
   Sales
   ========================================================================== */

export async function getSales() {
  requirePermission('sales.view');

  try {
    const response = await fetch(`${API_URL}/sales`, {
      method: 'GET',
      headers: getAuthHeaders(),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new ApiError(data.message || 'Failed to fetch sales records.', 'FETCH_FAILED', response.status);
    }

    const fetchedSales = (data.sales || []).map((s) => ({
      id: s.id,
      date: s.date,
      user: s.salespersonName || s.user || 'Unknown',
      userId: s.userId,
      items: Number(s.itemsCount ?? s.items ?? 0),
      itemsCount: Number(s.itemsCount ?? s.items ?? 0),
      total: Number(s.total) || 0,
      status: s.status || 'completed',
    }));

    // Sync in-memory sales array
    sales.length = 0;
    sales.push(...fetchedSales);

    return clone(fetchedSales);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(error.message || 'Cannot connect to backend server.', 'NETWORK_ERROR', 500);
  }
}

export async function getSale(id) {
  requirePermission('sales.view');

  try {
    const response = await fetch(`${API_URL}/sales/${encodeURIComponent(id)}`, {
      method: 'GET',
      headers: getAuthHeaders(),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new ApiError(data.message || 'Sale not found.', 'NOT_FOUND', response.status);
    }

    const s = data.sale;
    const itemsList = Array.isArray(s.itemList) ? s.itemList : (Array.isArray(s.items) ? s.items : []);
    return clone({
      id: s.id,
      date: s.date,
      user: s.salespersonName || s.user || 'Unknown',
      userId: s.userId,
      items: Number(s.itemsCount ?? (itemsList.length || 0)),
      itemsCount: Number(s.itemsCount ?? (itemsList.length || 0)),
      total: Number(s.total) || 0,
      status: s.status || 'completed',
      itemList: itemsList,
    });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(error.message || 'Cannot connect to backend server.', 'NETWORK_ERROR', 500);
  }
}

export async function createSale(payload) {
  requirePermission('sales.create');

  try {
    const response = await fetch(`${API_URL}/sales`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new ApiError(data.message || 'Failed to create sale.', 'CREATE_FAILED', response.status);
    }

    const created = data.sale;
    const formatted = {
      id: created.id,
      date: created.date || todayISO(),
      user: created.salespersonName || created.user || payload.user || 'Unknown',
      userId: created.userId,
      items: Number(created.itemsCount ?? created.items ?? (payload.items?.length || 0)),
      total: Number(created.total),
      status: created.status || 'completed',
    };

    sales.unshift(formatted);
    const user = currentUser();
    logActivity(`Created sale ${formatted.id}`, 'Sales', user);
    return clone(formatted);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(error.message || 'Cannot connect to backend server.', 'NETWORK_ERROR', 500);
  }
}

export async function updateSale(id, payload) {
  requireAnyPermission(['sales.update', 'sales.edit']);

  try {
    const response = await fetch(`${API_URL}/sales/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new ApiError(data.message || 'Failed to update sale.', 'UPDATE_FAILED', response.status);
    }

    const updated = data.sale;
    const formatted = {
      id: updated.id,
      date: updated.date,
      user: updated.salespersonName || updated.user,
      items: Number(updated.itemsCount ?? updated.items ?? 0),
      total: Number(updated.total),
      status: updated.status,
    };

    const idx = sales.findIndex((s) => s.id === id);
    if (idx !== -1) {
      sales[idx] = { ...sales[idx], ...formatted };
    }

    const user = currentUser();
    logActivity(`Updated sale ${formatted.id}`, 'Sales', user);
    return clone(formatted);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(error.message || 'Cannot connect to backend server.', 'NETWORK_ERROR', 500);
  }
}

export async function deleteSale(id) {
  requirePermission('sales.delete');

  try {
    const response = await fetch(`${API_URL}/sales/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new ApiError(data.message || 'Failed to delete sale.', 'DELETE_FAILED', response.status);
    }

    const idx = sales.findIndex((s) => s.id === id);
    if (idx !== -1) {
      sales.splice(idx, 1);
    }

    const user = currentUser();
    logActivity(`Deleted sale ${id}`, 'Sales', user);
    return data;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(error.message || 'Cannot connect to backend server.', 'NETWORK_ERROR', 500);
  }
}

/* ==========================================================================
   Orders
   ========================================================================== */

export async function getOrders() {
  requirePermission('orders.view');

  try {
    const response = await fetch(`${API_URL}/orders`, {
      method: 'GET',
      headers: getAuthHeaders(),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new ApiError(data.message || 'Failed to fetch orders.', 'FETCH_FAILED', response.status);
    }

    const fetchedOrders = (data.orders || []).map((o) => ({
      id: o.id,
      customer: o.customer,
      date: o.date ? String(o.date).slice(0, 10) : todayISO(),
      status: o.status || 'New',
      total: Number(o.total) || 0,
      createdByName: o.createdByName,
      notes: o.notes,
    }));

    // Sync in-memory orders array
    orders.length = 0;
    orders.push(...fetchedOrders);

    return clone(fetchedOrders);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(error.message || 'Cannot connect to backend server.', 'NETWORK_ERROR', 500);
  }
}

export async function getOrder(id) {
  requirePermission('orders.view');

  try {
    const response = await fetch(`${API_URL}/orders/${encodeURIComponent(id)}`, {
      method: 'GET',
      headers: getAuthHeaders(),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new ApiError(data.message || 'Order not found.', 'NOT_FOUND', response.status);
    }

    const o = data.order;
    return clone({
      id: o.id,
      customer: o.customer,
      date: o.date ? String(o.date).slice(0, 10) : todayISO(),
      status: o.status || 'New',
      total: Number(o.total) || 0,
      createdByName: o.createdByName,
      notes: o.notes,
      items: o.items || [],
    });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(error.message || 'Cannot connect to backend server.', 'NETWORK_ERROR', 500);
  }
}

function normaliseOrder(payload) {
  requireText(payload.customer, 'Customer');
  requireAmount(payload.total, 'Total');
  if (!orderStatuses.includes(payload.status)) {
    throw new ApiError('Choose a valid order status.', 'VALIDATION', 422);
  }
  return {
    customer: String(payload.customer).trim(),
    date: payload.date || todayISO(),
    status: payload.status,
    total: Number(payload.total),
  };
}

export async function createOrder(payload) {
  requirePermission('orders.create');
  const data = normaliseOrder(payload);

  try {
    const response = await fetch(`${API_URL}/orders`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });

    const resData = await response.json();

    if (!response.ok) {
      throw new ApiError(resData.message || 'Failed to create order.', 'CREATE_FAILED', response.status);
    }

    const created = resData.order;
    const formatted = {
      id: created.id,
      customer: created.customer,
      date: created.date ? String(created.date).slice(0, 10) : (data.date || todayISO()),
      status: created.status || data.status || 'New',
      total: Number(created.total !== undefined ? created.total : data.total),
    };

    orders.unshift(formatted);
    const user = currentUser();
    logActivity(`Created order ${formatted.id}`, 'Orders', user);
    return clone(formatted);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(error.message || 'Cannot connect to backend server.', 'NETWORK_ERROR', 500);
  }
}

export async function updateOrder(id, payload) {
  requirePermission('orders.update');

  try {
    const response = await fetch(`${API_URL}/orders/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(payload),
    });

    const resData = await response.json();

    if (!response.ok) {
      throw new ApiError(resData.message || 'Failed to update order.', 'UPDATE_FAILED', response.status);
    }

    const updated = resData.order || { id, ...payload };
    const orderIndex = orders.findIndex((item) => item.id === id);
    if (orderIndex !== -1) {
      orders[orderIndex] = { ...orders[orderIndex], ...updated };
    }

    const user = currentUser();
    logActivity(`Updated order ${id}`, 'Orders', user);
    return clone(orders[orderIndex] || updated);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(error.message || 'Cannot connect to backend server.', 'NETWORK_ERROR', 500);
  }
}

export async function updateOrderStatus(id, status) {
  requirePermission('orders.status');

  try {
    const response = await fetch(`${API_URL}/orders/${encodeURIComponent(id)}/status`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify({ status }),
    });

    const resData = await response.json();

    if (!response.ok) {
      throw new ApiError(resData.message || 'Failed to update order status.', 'UPDATE_FAILED', response.status);
    }

    const orderIndex = orders.findIndex((item) => item.id === id);
    if (orderIndex !== -1) {
      orders[orderIndex].status = status;
    }

    const user = currentUser();
    logActivity(`Changed order ${id} status to ${status}`, 'Orders', user);
    return clone(orders[orderIndex] || { id, status });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(error.message || 'Cannot connect to backend server.', 'NETWORK_ERROR', 500);
  }
}

/* ==========================================================================
   Profile, settings and support
   ========================================================================== */

export async function getProfile() {
  await delay();
  return publicUser(currentUser());
}

export async function updateProfile(payload) {
  await delay();
  const user = requirePermission('profile.update');
  requireText(payload.name, 'Name');
  if (!isIndianPhone(payload.phone)) {
    throw new ApiError(PHONE_ERROR, 'VALIDATION', 422);
  }
  user.name = String(payload.name).trim();
  user.phone = formatIndianPhone(payload.phone);
  if (Object.prototype.hasOwnProperty.call(payload, 'avatar')) {
    user.avatar = String(payload.avatar || '').trim();
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'photo')) {
    const photo = String(payload.photo || '');
    if (photo && !/^data:image\/(jpeg|png|webp);base64,/.test(photo)) {
      throw new ApiError('Choose a valid profile photo.', 'VALIDATION', 422);
    }
    user.photo = photo;
  }
  saveUsers();
  logActivity('Updated profile details', 'Profile', user);
  return publicUser(user);
}

export async function changePassword(currentPassword, newPassword) {
  await delay();
  const user = currentUser();
  if (user.password !== currentPassword) {
    throw new ApiError('Your current password is incorrect.', 'VALIDATION', 422);
  }
  if (String(newPassword).length < 8) {
    throw new ApiError('New password must be at least 8 characters.', 'VALIDATION', 422);
  }
  if (newPassword === currentPassword) {
    throw new ApiError('Choose a password that is different from your current one.', 'VALIDATION', 422);
  }
  user.password = newPassword;
  saveUsers();
  logActivity('Changed account password', 'Settings', user);
  return { success: true };
}

export async function submitContact(payload) {
  await delay();
  currentUser();
  requireText(payload.name, 'Name');
  requireText(payload.email, 'Email');
  if (!isEmail(payload.email)) throw new ApiError('Enter a valid email address.', 'VALIDATION', 422);
  requireText(payload.subject, 'Subject');
  requireText(payload.message, 'Message');
  const ticketId = `SUP-${Math.floor(100000 + Math.random() * 900000)}`;
  return { ticketId, receivedAt: new Date().toISOString() };
}

export function formatActivityTimestamp(value) {
  return formatDate(value);
}

/* ==========================================================================
   AI Inventory Forecasting & Smart Alerts API
   ========================================================================== */

export async function getAiInsights() {
  try {
    const response = await fetch(`${API_URL}/ai/insights`, {
      method: 'GET',
      headers: getAuthHeaders(),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new ApiError(err.message || 'Failed to fetch AI insights.', 'AI_ERROR', response.status);
    }
    return await response.json();
  } catch (err) {
    console.error('getAiInsights error:', err);
    throw err;
  }
}

export async function getAiForecasts() {
  try {
    const response = await fetch(`${API_URL}/ai/forecasts`, {
      method: 'GET',
      headers: getAuthHeaders(),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new ApiError(err.message || 'Failed to fetch product forecasts.', 'AI_ERROR', response.status);
    }
    return await response.json();
  } catch (err) {
    console.error('getAiForecasts error:', err);
    throw err;
  }
}

export async function getAiProductForecast(productId) {
  try {
    const response = await fetch(`${API_URL}/ai/forecasts/${encodeURIComponent(productId)}`, {
      method: 'GET',
      headers: getAuthHeaders(),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new ApiError(err.message || 'Failed to fetch product forecast details.', 'AI_ERROR', response.status);
    }
    return await response.json();
  } catch (err) {
    console.error('getAiProductForecast error:', err);
    throw err;
  }
}

export async function triggerAiAlerts(productIds = null) {
  try {
    const response = await fetch(`${API_URL}/ai/trigger-alerts`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ productIds }),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new ApiError(err.message || 'Failed to trigger AI alerts.', 'AI_ERROR', response.status);
    }
    return await response.json();
  } catch (err) {
    console.error('triggerAiAlerts error:', err);
    throw err;
  }
}
