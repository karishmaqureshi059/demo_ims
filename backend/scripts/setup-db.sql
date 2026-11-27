-- Inventory Management System Database Schema
-- ============================================
-- PostgreSQL 15+ compatible
-- ============================================

-- Create ENUM types
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
    CREATE TYPE user_role AS ENUM ('owner', 'product', 'sales', 'stock', 'purchase', 'orders');
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'transaction_type') THEN
    CREATE TYPE transaction_type AS ENUM ('in', 'out', 'adjustment');
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'order_status') THEN
    CREATE TYPE order_status AS ENUM ('new', 'processing', 'completed', 'cancelled');
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'purchase_order_status') THEN
    CREATE TYPE purchase_order_status AS ENUM ('Pending', 'Partially Received', 'Received');
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notification_type') THEN
    CREATE TYPE notification_type AS ENUM ('low_stock', 'expiry', 'order');
  END IF;
END
$$;

-- ============================================
-- Table: roles
-- ============================================
CREATE TABLE IF NOT EXISTS roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name user_role NOT NULL UNIQUE,
  label VARCHAR(50) NOT NULL,
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- Table: permissions
-- ============================================
CREATE TABLE IF NOT EXISTS permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(50) NOT NULL UNIQUE,
  description TEXT,
  module VARCHAR(50) NOT NULL,
  action VARCHAR(20) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- Table: role_permissions
-- ============================================
CREATE TABLE IF NOT EXISTS role_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id UUID REFERENCES roles(id) ON DELETE CASCADE,
  permission_id UUID REFERENCES permissions(id) ON DELETE CASCADE,
  granted BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(role_id, permission_id)
);

-- ============================================
-- Table: users
-- ============================================
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id VARCHAR(50) UNIQUE,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(100) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  role user_role DEFAULT 'stock',
  status VARCHAR(20) DEFAULT 'active',
  phone VARCHAR(20),
  avatar TEXT,
  photo TEXT,
  last_login TIMESTAMP WITH TIME ZONE,
  last_ip INET,
  session_version INTEGER DEFAULT 1,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for users table
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);

-- ============================================
-- Table: categories
-- ============================================
CREATE TABLE IF NOT EXISTS categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL UNIQUE,
  description TEXT,
  parent_id UUID REFERENCES categories(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index for categories
CREATE INDEX IF NOT EXISTS idx_categories_parent ON categories(parent_id);

-- ============================================
-- Table: products
-- ============================================
CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  sku VARCHAR(50) UNIQUE NOT NULL,
  category_id UUID REFERENCES categories(id),
  price DECIMAL(12, 2) NOT NULL DEFAULT 0,
  quantity INTEGER NOT NULL DEFAULT 0,
  min_level INTEGER NOT NULL DEFAULT 5,
  status VARCHAR(20) GENERATED ALWAYS AS (
    CASE 
      WHEN quantity <= 0 THEN 'Out of Stock'
      WHEN quantity <= min_level THEN 'Low Stock'
      ELSE 'In Stock'
    END
  ) STORED,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for products
CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_quantity ON products(quantity);
CREATE INDEX IF NOT EXISTS idx_products_status ON products(status);

-- ============================================
-- Table: suppliers
-- ============================================
CREATE TABLE IF NOT EXISTS suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  contact_person VARCHAR(100),
  email VARCHAR(100),
  phone VARCHAR(20),
  address TEXT,
  status VARCHAR(20) DEFAULT 'active',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index for suppliers
CREATE INDEX IF NOT EXISTS idx_suppliers_status ON suppliers(status);

-- ============================================
-- Table: purchase_orders
-- ============================================
CREATE TABLE IF NOT EXISTS purchase_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id UUID REFERENCES suppliers(id),
  total DECIMAL(12, 2) NOT NULL DEFAULT 0,
  qty_ordered INTEGER NOT NULL DEFAULT 0,
  qty_received INTEGER NOT NULL DEFAULT 0,
  status purchase_order_status DEFAULT 'Pending',
  date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  received_at TIMESTAMP WITH TIME ZONE,
  created_by UUID REFERENCES users(id),
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index for purchase_orders
CREATE INDEX IF NOT EXISTS idx_purchase_orders_status ON purchase_orders(status);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_supplier ON purchase_orders(supplier_id);

-- ============================================
-- Table: purchase_order_items
-- ============================================
CREATE TABLE IF NOT EXISTS purchase_order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id UUID REFERENCES purchase_orders(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id),
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price DECIMAL(12, 2) NOT NULL DEFAULT 0,
  total DECIMAL(12, 2) NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index for purchase_order_items
CREATE INDEX IF NOT EXISTS idx_purchase_order_items_po ON purchase_order_items(purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_purchase_order_items_product ON purchase_order_items(product_id);

-- ============================================
-- Table: sales
-- ============================================
CREATE TABLE IF NOT EXISTS sales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  total DECIMAL(12, 2) NOT NULL DEFAULT 0,
  items_count INTEGER NOT NULL DEFAULT 0,
  status VARCHAR(20) DEFAULT 'completed',
  date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index for sales
CREATE INDEX IF NOT EXISTS idx_sales_user ON sales(user_id);
CREATE INDEX IF NOT EXISTS idx_sales_date ON sales(date);
CREATE INDEX IF NOT EXISTS idx_sales_status ON sales(status);

-- ============================================
-- Table: sale_items
-- ============================================
CREATE TABLE IF NOT EXISTS sale_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id UUID REFERENCES sales(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id),
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price DECIMAL(12, 2) NOT NULL DEFAULT 0,
  total DECIMAL(12, 2) NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index for sale_items
CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_product ON sale_items(product_id);

-- ============================================
-- Table: orders
-- ============================================
CREATE TABLE IF NOT EXISTS orders (
  id VARCHAR(100) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  customer VARCHAR(100) NOT NULL,
  total DECIMAL(12, 2) NOT NULL DEFAULT 0,
  status order_status DEFAULT 'new',
  date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  created_by UUID REFERENCES users(id),
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index for orders
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_date ON orders(date);
CREATE INDEX IF NOT EXISTS idx_orders_created_by ON orders(created_by);

-- ============================================
-- Table: order_items
-- ============================================
CREATE TABLE IF NOT EXISTS order_items (
  id VARCHAR(100) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  order_id VARCHAR(100) REFERENCES orders(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id),
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price DECIMAL(12, 2) NOT NULL DEFAULT 0,
  total DECIMAL(12, 2) NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index for order_items
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product ON order_items(product_id);

-- ============================================
-- Table: stock_transactions
-- ============================================
CREATE TABLE IF NOT EXISTS stock_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID REFERENCES products(id),
  type transaction_type NOT NULL,
  quantity INTEGER NOT NULL,
  previous_quantity INTEGER NOT NULL,
  new_quantity INTEGER NOT NULL,
  reason TEXT,
  user_id UUID REFERENCES users(id),
  date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for stock_transactions
CREATE INDEX IF NOT EXISTS idx_stock_transactions_product ON stock_transactions(product_id);
CREATE INDEX IF NOT EXISTS idx_stock_transactions_type ON stock_transactions(type);
CREATE INDEX IF NOT EXISTS idx_stock_transactions_date ON stock_transactions(date);

-- ============================================
-- Table: notifications
-- ============================================
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  title VARCHAR(200) NOT NULL,
  message TEXT NOT NULL,
  type notification_type NOT NULL,
  related_id UUID,
  related_type VARCHAR(50),
  read BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for notifications
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(type);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(read);

-- ============================================
-- Table: user_activity
-- ============================================
CREATE TABLE IF NOT EXISTS user_activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  action VARCHAR(100) NOT NULL,
  module VARCHAR(50) NOT NULL,
  details JSONB DEFAULT '{}',
  ip INET,
  user_agent TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for user_activity
CREATE INDEX IF NOT EXISTS idx_user_activity_user ON user_activity(user_id);
CREATE INDEX IF NOT EXISTS idx_user_activity_module ON user_activity(module);
CREATE INDEX IF NOT EXISTS idx_user_activity_created ON user_activity(created_at);

-- ============================================
-- Table: attendance
-- ============================================
CREATE TABLE IF NOT EXISTS attendance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  login_time TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  logout_time TIMESTAMP WITH TIME ZONE,
  working_hours NUMERIC(6, 2),
  working_hours_formatted VARCHAR(50),
  status VARCHAR(30) NOT NULL DEFAULT 'Active',
  ip_address VARCHAR(50),
  user_agent TEXT,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for attendance
CREATE INDEX IF NOT EXISTS idx_attendance_user ON attendance(user_id);
CREATE INDEX IF NOT EXISTS idx_attendance_login ON attendance(login_time);
CREATE INDEX IF NOT EXISTS idx_attendance_status ON attendance(status);

-- ============================================
-- Table: settings
-- ============================================
CREATE TABLE IF NOT EXISTS settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key VARCHAR(50) NOT NULL UNIQUE,
  value TEXT,
  description TEXT,
  category VARCHAR(50) DEFAULT 'general',
  updated_by UUID REFERENCES users(id),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index for settings
CREATE INDEX IF NOT EXISTS idx_settings_key ON settings(key);

-- ============================================
-- Default Data Insertions
-- ============================================

-- Insert default roles
INSERT INTO roles (id, name, label, description) VALUES
  (gen_random_uuid(), 'owner', 'Owner', 'Full system access, can manage all users and modules'),
  (gen_random_uuid(), 'product', 'Product Manager', 'Can manage products, categories, and view stock/sales'),
  (gen_random_uuid(), 'sales', 'Sales Manager', 'Can create sales, view orders and products'),
  (gen_random_uuid(), 'stock', 'Stock Manager', 'Can manage stock-in, stock-out, and stock adjustments'),
  (gen_random_uuid(), 'purchase', 'Purchase Manager', 'Can manage suppliers, purchase orders, and receiving'),
  (gen_random_uuid(), 'orders', 'Order Manager', 'Can create and manage orders, update order status')
ON CONFLICT (name) DO NOTHING;

-- Insert default permissions
INSERT INTO permissions (id, name, description, module, action) VALUES
  -- Users permissions
  (gen_random_uuid(), 'users.view', 'View user list', 'users', 'view'),
  (gen_random_uuid(), 'users.create', 'Create new users', 'users', 'create'),
  (gen_random_uuid(), 'users.update', 'Edit user details', 'users', 'update'),
  (gen_random_uuid(), 'users.role', 'Change user roles', 'users', 'role'),
  (gen_random_uuid(), 'users.status', 'Activate/deactivate accounts', 'users', 'status'),
  (gen_random_uuid(), 'users.reset', 'Reset user passwords', 'users', 'reset'),

  -- Products permissions
  (gen_random_uuid(), 'products.view', 'View product list', 'products', 'view'),
  (gen_random_uuid(), 'products.create', 'Create new products', 'products', 'create'),
  (gen_random_uuid(), 'products.update', 'Edit product details', 'products', 'update'),
  (gen_random_uuid(), 'products.delete', 'Delete products', 'products', 'delete'),

  -- Categories permissions
  (gen_random_uuid(), 'categories.view', 'View categories', 'categories', 'view'),
  (gen_random_uuid(), 'categories.create', 'Create new categories', 'categories', 'create'),
  (gen_random_uuid(), 'categories.update', 'Edit categories', 'categories', 'update'),

  -- Stock permissions
  (gen_random_uuid(), 'stock.view', 'View stock and transactions', 'stock', 'view'),
  (gen_random_uuid(), 'stock.create', 'Record stock transactions', 'stock', 'create'),
  (gen_random_uuid(), 'stock.update', 'Update stock transactions', 'stock', 'update'),
  (gen_random_uuid(), 'stock.adjust', 'Adjust stock levels', 'stock', 'adjust'),

  -- Suppliers and purchases permissions
  (gen_random_uuid(), 'purchases.view', 'View purchase orders', 'purchases', 'view'),
  (gen_random_uuid(), 'purchases.create', 'Create purchase orders', 'purchases', 'create'),
  (gen_random_uuid(), 'purchases.update', 'Edit purchase orders', 'purchases', 'update'),
  (gen_random_uuid(), 'purchases.receive', 'Receive goods into stock', 'purchases', 'receive'),

  -- Sales permissions
  (gen_random_uuid(), 'sales.view', 'View sales records', 'sales', 'view'),
  (gen_random_uuid(), 'sales.create', 'Create sales records', 'sales', 'create'),
  (gen_random_uuid(), 'sales.update', 'Update sales records', 'sales', 'update'),

  -- Orders permissions
  (gen_random_uuid(), 'orders.view', 'View orders', 'orders', 'view'),
  (gen_random_uuid(), 'orders.create', 'Create new orders', 'orders', 'create'),
  (gen_random_uuid(), 'orders.update', 'Edit order details', 'orders', 'update'),
  (gen_random_uuid(), 'orders.status', 'Update order status', 'orders', 'status'),

  -- Analytics and reports permissions
  (gen_random_uuid(), 'analytics.view', 'View analytics and reports', 'analytics', 'view'),
  (gen_random_uuid(), 'reports.generate', 'Generate reports', 'reports', 'generate'),

  -- Profile and settings permissions
  (gen_random_uuid(), 'profile.update', 'Update user profile', 'profile', 'update'),
  (gen_random_uuid(), 'settings.manage', 'Manage system settings', 'settings', 'manage'),

  -- Activity and notifications permissions
  (gen_random_uuid(), 'activity.view', 'View activity history', 'activity', 'view'),
  (gen_random_uuid(), 'activity.view.all', 'View all activity records', 'activity', 'view_all'),
  (gen_random_uuid(), 'notifications.view', 'View notifications', 'notifications', 'view'),
  (gen_random_uuid(), 'notifications.mark_read', 'Mark notifications as read', 'notifications', 'mark_read'),

  -- Additional module-level permissions
  (gen_random_uuid(), 'products.update.owner', 'Owner can update products from read-only view', 'products', 'update_owner'),
  (gen_random_uuid(), 'notifications.view', 'View notifications', 'notifications', 'view')
ON CONFLICT (name) DO NOTHING;

-- Assign permissions to roles
-- Owner: All permissions
INSERT INTO role_permissions (role_id, permission_id, granted)
SELECT r.id, p.id, true
FROM roles r, permissions p
WHERE r.name = 'owner'
ON CONFLICT (role_id, permission_id) DO UPDATE SET granted = true;

-- Product Manager permissions
INSERT INTO role_permissions (role_id, permission_id, granted)
SELECT r.id, p.id, true
FROM roles r, permissions p
WHERE r.name = 'product'
  AND p.name IN ('products.view', 'products.create', 'products.update',
    'categories.view', 'categories.create', 'categories.update',
    'analytics.view', 'reports.generate', 'notifications.view', 'profile.update', 'settings.manage')
ON CONFLICT (role_id, permission_id) DO UPDATE SET granted = true;

-- Sales Manager permissions
INSERT INTO role_permissions (role_id, permission_id, granted)
SELECT r.id, p.id, true
FROM roles r, permissions p
WHERE r.name = 'sales'
  AND p.name IN ('sales.view', 'sales.create', 'sales.update',
    'analytics.view', 'reports.generate', 'notifications.view', 'profile.update', 'settings.manage')
ON CONFLICT (role_id, permission_id) DO UPDATE SET granted = true;

-- Stock Manager permissions
INSERT INTO role_permissions (role_id, permission_id, granted)
SELECT r.id, p.id, true
FROM roles r, permissions p
WHERE r.name = 'stock'
  AND p.name IN ('stock.view', 'stock.create', 'stock.update', 'stock.adjust',
    'analytics.view', 'reports.generate', 'notifications.view', 'profile.update', 'settings.manage')
ON CONFLICT (role_id, permission_id) DO UPDATE SET granted = true;

-- Purchase Manager permissions
INSERT INTO role_permissions (role_id, permission_id, granted)
SELECT r.id, p.id, true
FROM roles r, permissions p
WHERE r.name = 'purchase'
  AND p.name IN ('purchases.view', 'purchases.create', 'purchases.update', 'purchases.receive',
    'analytics.view', 'reports.generate', 'notifications.view', 'profile.update', 'settings.manage')
ON CONFLICT (role_id, permission_id) DO UPDATE SET granted = true;

-- Order Manager permissions
INSERT INTO role_permissions (role_id, permission_id, granted)
SELECT r.id, p.id, true
FROM roles r, permissions p
WHERE r.name = 'orders'
  AND p.name IN ('orders.view', 'orders.create', 'orders.update', 'orders.status',
    'analytics.view', 'reports.generate', 'notifications.view', 'profile.update', 'settings.manage')
ON CONFLICT (role_id, permission_id) DO UPDATE SET granted = true;

-- Create an admin user (owner)
DO $$
DECLARE
  admin_role_id UUID;
  admin_user_id UUID;
BEGIN
  -- Get owner role ID
  SELECT id INTO admin_role_id FROM roles WHERE name = 'owner' LIMIT 1;

  -- Check if owner user already exists
  IF NOT EXISTS (SELECT 1 FROM users WHERE email = 'owner@inventory.com') THEN
    INSERT INTO users (id, name, email, password, role, status, phone, created_at, updated_at)
    VALUES (gen_random_uuid(), 'System Owner', 'owner@inventory.com', '$2a$12$T37ufvMdduHfGOMY1Gcq8eYZQpc43XV.RT3p/N3Tv5jqOsNTUKCOG', 'owner', 'active', '+91 99999 99999', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

    SELECT id INTO admin_user_id FROM users WHERE email = 'owner@inventory.com' LIMIT 1;
    RAISE NOTICE 'Admin user created: owner@inventory.com';
  ELSE
    admin_user_id := (SELECT id FROM users WHERE email = 'owner@inventory.com' LIMIT 1);
    RAISE NOTICE 'Admin user already exists: owner@inventory.com';
  END IF;
END
$$;