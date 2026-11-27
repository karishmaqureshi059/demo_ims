/**
 * Action-level permissions.
 * Edit this file to grant or revoke actions per role. The UI reads these
 * lists through api.getPermissions() and hides actions that are not present.
 */
export const ROLE_PERMISSIONS = {
  owner: [
    // Users
    'users.view',
    'users.create',
    'users.update',
    'users.role',
    'users.status',
    'users.reset',
    // Products & Categories
    'products.view',
    'products.create',
    'products.update',
    'products.delete',
    'products.update.owner',
    'categories.view',
    'categories.create',
    'categories.update',
    // Sales
    'sales.view',
    'sales.create',
    'sales.update',
    'sales.edit',
    'sales.delete',
    // Stock
    'stock.view',
    'stock.create',
    'stock.update',
    'stock.adjust',
    // Purchases & Suppliers
    'purchases.view',
    'purchases.create',
    'purchases.update',
    'purchases.receive',
    'suppliers.view',
    'suppliers.create',
    'suppliers.update',
    // Orders
    'orders.view',
    'orders.create',
    'orders.update',
    'orders.status',
    // Analytics & Reports
    'analytics.view',
    'reports.generate',
    // Notifications & Activity
    'notifications.view',
    'notifications.mark_read',
    'activity.view',
    'activity.view.all',
    // Profile & Settings
    'profile.update',
    'settings.manage',
  ],
  product: [
    'products.view',
    'products.create',
    'products.update',
    'products.delete',
    'categories.view',
    'categories.create',
    'categories.update',
    'stock.view',
    'analytics.view',
    'reports.generate',
    'notifications.view',
    'notifications.mark_read',
    'activity.view',
    'profile.update',
    'settings.manage',
  ],
  sales: [
    'sales.view',
    'sales.create',
    'sales.update',
    'sales.edit',
    'sales.delete',
    'products.view',
    'analytics.view',
    'reports.generate',
    'notifications.view',
    'notifications.mark_read',
    'activity.view',
    'profile.update',
    'settings.manage',
  ],
  stock: [
    'stock.view',
    'stock.create',
    'stock.update',
    'stock.adjust',
    'products.view',
    'analytics.view',
    'reports.generate',
    'notifications.view',
    'notifications.mark_read',
    'activity.view',
    'profile.update',
    'settings.manage',
  ],
  purchase: [
    'purchases.view',
    'purchases.create',
    'purchases.update',
    'purchases.receive',
    'suppliers.view',
    'suppliers.create',
    'suppliers.update',
    'products.view',
    'stock.view',
    'analytics.view',
    'reports.generate',
    'notifications.view',
    'notifications.mark_read',
    'activity.view',
    'profile.update',
    'settings.manage',
  ],
  orders: [
    'orders.view',
    'orders.create',
    'orders.update',
    'orders.status',
    'products.view',
    'analytics.view',
    'reports.generate',
    'notifications.view',
    'notifications.mark_read',
    'activity.view',
    'profile.update',
    'settings.manage',
  ],
};

export function getRolePermissions(roleKey) {
  return [...(ROLE_PERMISSIONS[roleKey] || [])];
}

export function hasPermission(permissionList, permissionKey) {
  if (!Array.isArray(permissionList)) return false;
  return permissionList.includes(permissionKey);
}
