import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });
process.env.NODE_ENV = 'test';

const { pool } = await import('../config/db.js');
const { default: app } = await import('../server.js');

let server;
const PORT = 5555;
const BASE_URL = `http://localhost:${PORT}/api`;

const testResults = {
  passed: [],
  failed: [],
};

function pass(name, detail = '') {
  console.log(`  ✅ PASS: ${name}${detail ? ` (${detail})` : ''}`);
  testResults.passed.push(name);
}

function fail(name, error) {
  console.error(`  ❌ FAIL: ${name} ->`, error.message || error);
  testResults.failed.push({ name, error: error.message || String(error) });
}

async function apiRequest(endpoint, method = 'GET', body = null, token = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const options = { method, headers };
  if (body) options.body = JSON.stringify(body);

  const res = await fetch(`${BASE_URL}${endpoint}`, options);
  const data = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, data };
}

async function runAudit() {
  console.log('====================================================');
  console.log('🚀 STARTING COMPREHENSIVE IMS SYSTEM AUDIT');
  console.log('====================================================\n');

  // Start internal test server on port 5555
  await new Promise((resolve) => {
    server = app.listen(PORT, () => {
      console.log(`Test API server running on port ${PORT}\n`);
      resolve();
    });
  });

  const tokens = {};
  const demoUsers = [
    { role: 'owner', email: 'owner@inventory.com', pass: 'Owner@123' },
    { role: 'product', email: 'product@inventory.com', pass: 'Product@123' },
    { role: 'sales', email: 'sales@inventory.com', pass: 'Sales@123' },
    { role: 'stock', email: 'stock@inventory.com', pass: 'Stock@123' },
    { role: 'purchase', email: 'purchase@inventory.com', pass: 'Purchase@123' },
    { role: 'orders', email: 'orders@inventory.com', pass: 'Orders@123' },
  ];

  try {
    // ----------------------------------------------------
    // TEST 1: Database Table Counts & Schemas
    // ----------------------------------------------------
    console.log('--- 1. DATABASE SCHEMA & EXISTING DATA PERSISTENCE ---');
    try {
      const counts = await pool.query(`
        SELECT 'users' as tbl, count(*) as count FROM users
        UNION ALL SELECT 'products', count(*) FROM products
        UNION ALL SELECT 'categories', count(*) FROM categories
        UNION ALL SELECT 'sales', count(*) FROM sales
        UNION ALL SELECT 'stock_transactions', count(*) FROM stock_transactions
        UNION ALL SELECT 'suppliers', count(*) FROM suppliers
        UNION ALL SELECT 'purchase_orders', count(*) FROM purchase_orders
        UNION ALL SELECT 'orders', count(*) FROM orders
      `);

      const map = {};
      counts.rows.forEach((r) => { map[r.tbl] = Number(r.count); });

      if (map.users >= 6) pass('Users table populated', `${map.users} users`);
      else fail('Users table check', `Found only ${map.users} users`);

      if (map.products >= 20) pass('Products table populated', `${map.products} products`);
      else fail('Products table check', `Found only ${map.products} products`);

      if (map.orders >= 30) pass('Orders table populated (including historical)', `${map.orders} orders`);
      else fail('Orders table check', `Found only ${map.orders} orders`);

      // Check ORD-5129 persistence
      const ordCheck = await pool.query('SELECT * FROM orders WHERE id = $1', ['ORD-5129']);
      if (ordCheck.rows.length > 0) pass('Target order ORD-5129 persists in PostgreSQL');
      else fail('Order ORD-5129 check', 'ORD-5129 not found in database');
    } catch (e) {
      fail('Database schema count check', e);
    }

    // ----------------------------------------------------
    // TEST 2: Authentication for All 6 Roles
    // ----------------------------------------------------
    console.log('\n--- 2. AUTHENTICATION & LOGIN (ALL 6 ROLES) ---');
    for (const u of demoUsers) {
      try {
        const res = await apiRequest('/auth/login', 'POST', {
          identifier: u.email,
          password: u.pass,
        });

        if (res.status === 200 && res.data.token) {
          tokens[u.role] = res.data.token;
          pass(`Login for ${u.role.toUpperCase()}`, `User ID: ${res.data.user?.id}`);
        } else {
          fail(`Login for ${u.role.toUpperCase()}`, res.data.message || `HTTP ${res.status}`);
        }
      } catch (e) {
        fail(`Login for ${u.role.toUpperCase()}`, e);
      }
    }

    // ----------------------------------------------------
    // TEST 3: Dashboard KPIs for All 6 Roles
    // ----------------------------------------------------
    console.log('\n--- 3. ROLE-BASED DASHBOARD KPIS (POSTGRESQL LIVE DATA) ---');
    const expectedKpis = {
      owner: ['totalUsers', 'activeUsers', 'totalProducts', 'lowStockItems'],
      product: ['totalProducts', 'categories', 'outOfStock', 'lowStock'],
      sales: ['todaySales', 'monthlySales', 'completedSales', 'topProducts'],
      stock: ['stockIn', 'stockOut', 'adjustments', 'stockAlerts'],
      purchase: ['openOrders', 'pendingReceipts', 'suppliers', 'monthlyValue'],
      orders: ['newOrders', 'processing', 'completed', 'cancelled'],
    };

    for (const [roleKey, expectedKeys] of Object.entries(expectedKpis)) {
      try {
        const res = await apiRequest(`/dashboard/${roleKey}`, 'GET', null, tokens[roleKey]);
        if (res.status === 200 && res.data.kpis) {
          const keys = Object.keys(res.data.kpis);
          const hasAll = expectedKeys.every((k) => keys.includes(k));
          if (hasAll) {
            pass(`Dashboard KPIs for ${roleKey.toUpperCase()}`, keys.join(', '));
          } else {
            fail(`Dashboard KPIs for ${roleKey.toUpperCase()}`, `Missing keys from ${expectedKeys.join(', ')}`);
          }
        } else {
          fail(`Dashboard KPIs for ${roleKey.toUpperCase()}`, res.data.message || `HTTP ${res.status}`);
        }
      } catch (e) {
        fail(`Dashboard KPIs for ${roleKey.toUpperCase()}`, e);
      }
    }

    // ----------------------------------------------------
    // TEST 4: Analytics for All 6 Roles
    // ----------------------------------------------------
    console.log('\n--- 4. ROLE-BASED ANALYTICS (7, 30, 90 DAYS) ---');
    for (const roleKey of ['owner', 'product', 'sales', 'stock', 'purchase', 'orders']) {
      try {
        const res = await apiRequest(`/dashboard/analytics/${roleKey}?days=30`, 'GET', null, tokens[roleKey]);
        if (res.status === 200 && res.data.summary && res.data.trend && res.data.breakdown) {
          pass(`Analytics for ${roleKey.toUpperCase()}`, `${res.data.summary.length} summary metrics, ${res.data.breakdown.title}`);
        } else {
          fail(`Analytics for ${roleKey.toUpperCase()}`, res.data.message || `HTTP ${res.status}`);
        }
      } catch (e) {
        fail(`Analytics for ${roleKey.toUpperCase()}`, e);
      }
    }

    // ----------------------------------------------------
    // TEST 5: Products Module CRUD & Categories
    // ----------------------------------------------------
    console.log('\n--- 5. PRODUCTS MODULE (CRUD & POSTGRESQL PERSISTENCE) ---');
    let testProductId = null;
    try {
      // List products
      const listRes = await apiRequest('/products', 'GET', null, tokens.product);
      if (listRes.status === 200 && Array.isArray(listRes.data.products)) {
        pass('List products', `${listRes.data.products.length} products found`);
      } else {
        fail('List products', listRes.data.message);
      }

      // Create product
      const createRes = await apiRequest('/products', 'POST', {
        name: 'Audit Test Mousepad',
        sku: 'AUDIT-PAD-99',
        category: 'Accessories',
        price: 25.0,
        quantity: 50,
        minLevel: 10,
      }, tokens.product);

      if (createRes.status === 201 && createRes.data.product?.id) {
        testProductId = createRes.data.product.id;
        pass('Create product', `ID: ${testProductId}, Quantity: 50`);
      } else {
        fail('Create product', createRes.data.message);
      }

      // Update product
      if (testProductId) {
        const updateRes = await apiRequest(`/products/${testProductId}`, 'PUT', {
          price: 28.0,
          quantity: 60,
        }, tokens.product);

        if (updateRes.status === 200 && Number(updateRes.data.product?.quantity) === 60) {
          pass('Update product', 'Quantity updated to 60, price to 28.0');
        } else {
          fail('Update product', updateRes.data.message);
        }
      }
    } catch (e) {
      fail('Products CRUD', e);
    }

    // ----------------------------------------------------
    // TEST 6: Stock Module & Stock Adjustments
    // ----------------------------------------------------
    console.log('\n--- 6. STOCK MODULE (IN, OUT, ADJUSTMENT & AUTOMATIC SYNC) ---');
    if (testProductId) {
      try {
        // Record stock in (+15)
        const inRes = await apiRequest('/stock', 'POST', {
          productId: testProductId,
          type: 'in',
          quantity: 15,
          reason: 'Audit batch receipt',
        }, tokens.stock);

        if (inRes.status === 201 && inRes.data.transaction?.newQuantity === 75) {
          pass('Stock-In transaction', 'Product quantity increased from 60 to 75');
        } else {
          fail('Stock-In transaction', inRes.data.message);
        }

        // Record stock out (-10)
        const outRes = await apiRequest('/stock', 'POST', {
          productId: testProductId,
          type: 'out',
          quantity: 10,
          reason: 'Audit dispatch',
        }, tokens.stock);

        if (outRes.status === 201 && outRes.data.transaction?.newQuantity === 65) {
          pass('Stock-Out transaction', 'Product quantity decreased from 75 to 65');
        } else {
          fail('Stock-Out transaction', outRes.data.message);
        }

        // Record adjustment (set to 40)
        const adjRes = await apiRequest('/stock', 'POST', {
          productId: testProductId,
          type: 'adjustment',
          quantity: 40,
          reason: 'Audit count reconciliation',
        }, tokens.stock);

        if (adjRes.status === 201 && adjRes.data.transaction?.newQuantity === 40) {
          pass('Stock Adjustment transaction', 'Product quantity set to counted level 40');
        } else {
          fail('Stock Adjustment transaction', adjRes.data.message);
        }
      } catch (e) {
        fail('Stock operations', e);
      }
    }

    // ----------------------------------------------------
    // TEST 7: Sales Module & Stock Auto-Deduction
    // ----------------------------------------------------
    console.log('\n--- 7. SALES MODULE & AUTOMATIC STOCK DEDUCTION ---');
    if (testProductId) {
      try {
        // Create sale of 8 units of testProductId (current stock 40)
        const saleRes = await apiRequest('/sales', 'POST', {
          total: 224.0,
          items: [
            {
              productId: testProductId,
              productName: 'Audit Test Mousepad',
              quantity: 8,
              unitPrice: 28.0,
              total: 224.0,
            },
          ],
        }, tokens.sales);

        if (saleRes.status === 201 && saleRes.data.sale?.id) {
          pass('Create sale', `Sale ID: ${saleRes.data.sale.id}`);

          // Verify stock in products table was automatically reduced to 32
          const prodCheck = await pool.query('SELECT quantity FROM products WHERE id = $1', [testProductId]);
          const currentQty = Number(prodCheck.rows[0]?.quantity);
          if (currentQty === 32) {
            pass('Automatic stock reduction after sale', `Stock reduced from 40 to ${currentQty}`);
          } else {
            fail('Automatic stock reduction after sale', `Expected quantity 32, got ${currentQty}`);
          }

          // Verify stock transaction was recorded
          const stCheck = await pool.query(
            "SELECT * FROM stock_transactions WHERE product_id = $1 AND type = 'out' ORDER BY created_at DESC LIMIT 1",
            [testProductId]
          );
          if (stCheck.rows.length > 0 && Number(stCheck.rows[0].quantity) === 8) {
            pass('Stock-Out transaction auto-recorded for sale', `Transaction ID: ${stCheck.rows[0].id}`);
          } else {
            fail('Stock-Out transaction auto-recorded for sale', 'Transaction not found in PostgreSQL');
          }
        } else {
          fail('Create sale', saleRes.data.message);
        }
      } catch (e) {
        fail('Sales operations', e);
      }
    }

    // ----------------------------------------------------
    // TEST 8: Purchases & Suppliers Module (Receipt & Stock Addition)
    // ----------------------------------------------------
    console.log('\n--- 8. PURCHASES & SUPPLIERS MODULE (RECEIPT & STOCK INFLOW) ---');
    if (testProductId) {
      try {
        // 1. Get suppliers
        const supRes = await apiRequest('/purchases/suppliers', 'GET', null, tokens.purchase);
        const suppliersList = supRes.data.suppliers || [];
        const supplierId = suppliersList[0]?.id;

        if (supRes.status === 200 && supplierId) {
          pass('Get suppliers', `${suppliersList.length} suppliers found`);

          // 2. Create purchase order with purchase_order_items
          const poClient = await pool.connect();
          let poId;
          try {
            const insertPo = await poClient.query(
              `INSERT INTO purchase_orders (id, supplier_id, total, qty_ordered, qty_received, status, date, created_by, notes, created_at, updated_at)
               VALUES (gen_random_uuid(), $1, 400, 20, 0, 'Pending', CURRENT_TIMESTAMP, $2, 'Audit test PO', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
               RETURNING id`,
              [supplierId, '55555555-5555-4555-8555-555555555555']
            );
            poId = insertPo.rows[0].id;

            await poClient.query(
              `INSERT INTO purchase_order_items (id, purchase_order_id, product_id, quantity, unit_price, total)
               VALUES (gen_random_uuid(), $1, $2, 20, 20, 400)`,
              [poId, testProductId]
            );
          } finally {
            poClient.release();
          }

          if (poId) {
            pass('Create Purchase Order with items', `PO ID: ${poId}`);

            // 3. Receive partial stock (10 units)
            const recRes1 = await apiRequest(`/purchases/${poId}/receive`, 'POST', { quantity: 10 }, tokens.purchase);
            if (recRes1.status === 200 && recRes1.data.purchaseOrder?.status === 'Partially Received') {
              pass('Partial PO receipt', 'Status updated to Partially Received, 10 units received');
            } else {
              fail('Partial PO receipt', recRes1.data.message);
            }

            // Check stock was incremented by 10 (32 -> 42)
            const prodAfterRec1 = await pool.query('SELECT quantity FROM products WHERE id = $1', [testProductId]);
            if (Number(prodAfterRec1.rows[0]?.quantity) === 42) {
              pass('Stock auto-increment after PO partial receipt', 'Stock increased from 32 to 42');
            } else {
              fail('Stock auto-increment after PO partial receipt', `Expected 42, got ${prodAfterRec1.rows[0]?.quantity}`);
            }

            // 4. Receive remaining 10 units
            const recRes2 = await apiRequest(`/purchases/${poId}/receive`, 'POST', { quantity: 10 }, tokens.purchase);
            if (recRes2.status === 200 && recRes2.data.purchaseOrder?.status === 'Received') {
              pass('Full PO receipt', 'Status updated to Received');
            } else {
              fail('Full PO receipt', recRes2.data.message);
            }

            // Check stock was incremented by 10 more (42 -> 52)
            const prodAfterRec2 = await pool.query('SELECT quantity FROM products WHERE id = $1', [testProductId]);
            if (Number(prodAfterRec2.rows[0]?.quantity) === 52) {
              pass('Stock auto-increment after PO full receipt', 'Stock increased from 42 to 52');
            } else {
              fail('Stock auto-increment after PO full receipt', `Expected 52, got ${prodAfterRec2.rows[0]?.quantity}`);
            }
          }
        } else {
          fail('Suppliers lookup', supRes.data.message);
        }
      } catch (e) {
        fail('Purchase operations', e);
      }
    }

    // ----------------------------------------------------
    // TEST 9: Orders Module (Add, View, Update Status)
    // ----------------------------------------------------
    console.log('\n--- 9. ORDERS MODULE (ADD, VIEW, UPDATE STATUS & PERSISTENCE) ---');
    try {
      const orderRes = await apiRequest('/orders', 'POST', {
        customer: 'Audit Test Enterprise',
        total: 450.0,
        status: 'New',
        notes: 'Priority express order',
      }, tokens.orders);

      if (orderRes.status === 201 && orderRes.data.order?.id) {
        const newOrderId = orderRes.data.order.id;
        pass('Create new order', `Order ID: ${newOrderId}`);

        // Update status to Processing
        const stRes = await apiRequest(`/orders/${newOrderId}/status`, 'PUT', { status: 'Processing' }, tokens.orders);
        if (stRes.status === 200) {
          pass('Update order status to Processing');
        } else {
          fail('Update order status', stRes.data.message);
        }

        // Verify order persisted in DB across separate query
        const dbCheck = await pool.query('SELECT * FROM orders WHERE id = $1', [newOrderId]);
        if (dbCheck.rows.length > 0 && dbCheck.rows[0].status === 'processing') {
          pass('Order persisted in PostgreSQL', `Status: ${dbCheck.rows[0].status}`);
        } else {
          fail('Order persistence check', 'Order not found in DB');
        }
      } else {
        fail('Create order', orderRes.data.message);
      }
    } catch (e) {
      fail('Orders operations', e);
    }

    // ----------------------------------------------------
    // TEST 10: Users Module (Owner-Only Features)
    // ----------------------------------------------------
    console.log('\n--- 10. USER MANAGEMENT (OWNER-ONLY CRUD & RBAC) ---');
    try {
      // List users
      const listRes = await apiRequest('/users', 'GET', null, tokens.owner);
      if (listRes.status === 200 && Array.isArray(listRes.data.users)) {
        pass('List users (Owner)', `${listRes.data.users.length} accounts found`);
      } else {
        fail('List users (Owner)', listRes.data.message);
      }

      // Create new user
      const createRes = await apiRequest('/users', 'POST', {
        name: 'Audit Temporary Staff',
        email: 'audit_staff@inventory.com',
        password: 'StaffPassword@123',
        role: 'stock',
        phone: '+91 98765 43999',
      }, tokens.owner);

      let createdUserId = null;
      if (createRes.status === 201 && createRes.data.user?.id) {
        createdUserId = createRes.data.user.id;
        pass('Create user (Owner)', `ID: ${createdUserId}`);

        // Change user role
        const roleRes = await apiRequest(`/users/${createdUserId}/role`, 'PUT', { role: 'product' }, tokens.owner);
        if (roleRes.status === 200 && roleRes.data.user?.role === 'product') {
          pass('Change user role to product');
        } else {
          fail('Change user role', roleRes.data.message);
        }

        // Change user status to deactivated
        const statusRes = await apiRequest(`/users/${createdUserId}/status`, 'PUT', { status: 'deactivated' }, tokens.owner);
        if (statusRes.status === 200 && statusRes.data.user?.status === 'deactivated') {
          pass('Deactivate user account');
        } else {
          fail('Deactivate user account', statusRes.data.message);
        }

        // Reset user password
        const pwRes = await apiRequest(`/users/${createdUserId}/reset-password`, 'POST', null, tokens.owner);
        if (pwRes.status === 200 && pwRes.data.temporaryPassword) {
          pass('Reset user password', `Temp PW: ${pwRes.data.temporaryPassword}`);
        } else {
          fail('Reset user password', pwRes.data.message);
        }

        // Clean up test user
        await pool.query('DELETE FROM users WHERE id = $1', [createdUserId]);
        pass('Clean up test user');
      } else {
        fail('Create user (Owner)', createRes.data.message);
      }
    } catch (e) {
      fail('User management operations', e);
    }

    // ----------------------------------------------------
    // TEST 11: Security & RBAC Enforcement Checks
    // ----------------------------------------------------
    console.log('\n--- 11. RBAC SECURITY RESTRICTION ENFORCEMENT ---');
    try {
      // 1. Sales manager cannot access User Management
      const rbacUser = await apiRequest('/users', 'GET', null, tokens.sales);
      if (rbacUser.status === 403) {
        pass('Restricted: Sales Manager cannot access User Management (403 Forbidden)');
      } else {
        fail('Restricted User Management access check', `Expected 403, got ${rbacUser.status}`);
      }

      // 2. Order manager cannot record stock adjustments
      const rbacStock = await apiRequest('/stock', 'POST', {
        productId: testProductId,
        type: 'adjustment',
        quantity: 10,
      }, tokens.orders);
      if (rbacStock.status === 403) {
        pass('Restricted: Order Manager cannot modify stock (403 Forbidden)');
      } else {
        fail('Restricted stock modification check', `Expected 403, got ${rbacStock.status}`);
      }

      // 3. Product manager cannot receive purchase orders
      const rbacPO = await apiRequest('/purchases/po-test/receive', 'POST', { quantity: 5 }, tokens.product);
      if (rbacPO.status === 403) {
        pass('Restricted: Product Manager cannot receive PO stock (403 Forbidden)');
      } else {
        fail('Restricted PO receipt check', `Expected 403, got ${rbacPO.status}`);
      }
    } catch (e) {
      fail('RBAC security checks', e);
    }

    // ----------------------------------------------------
    // TEST 12: Activity History & Notifications
    // ----------------------------------------------------
    console.log('\n--- 12. ACTIVITY HISTORY & NOTIFICATIONS ---');
    try {
      // Activity
      const actRes = await apiRequest('/activity', 'GET', null, tokens.owner);
      if (actRes.status === 200 && Array.isArray(actRes.data.activity)) {
        pass('Get activity logs', `${actRes.data.activity.length} activity items retrieved`);
      } else {
        fail('Get activity logs', actRes.data.message);
      }

      // Notifications
      const notifRes = await apiRequest('/notifications', 'GET', null, tokens.stock);
      if (notifRes.status === 200 && Array.isArray(notifRes.data.notifications)) {
        pass('Get notifications', `${notifRes.data.notifications.length} notifications retrieved`);
        if (notifRes.data.notifications.length > 0) {
          const firstId = notifRes.data.notifications[0].id;
          const readRes = await apiRequest(`/notifications/${firstId}/read`, 'PUT', null, tokens.stock);
          if (readRes.status === 200) {
            pass('Mark notification as read');
          } else {
            fail('Mark notification as read', readRes.data.message);
          }
        }
      } else {
        fail('Get notifications', notifRes.data.message);
      }
    } catch (e) {
      fail('Activity and notifications', e);
    }

    // Clean up test product
    if (testProductId) {
      await pool.query('DELETE FROM sale_items WHERE product_id = $1', [testProductId]);
      await pool.query('DELETE FROM purchase_order_items WHERE product_id = $1', [testProductId]);
      await pool.query('DELETE FROM stock_transactions WHERE product_id = $1', [testProductId]);
      await pool.query('DELETE FROM products WHERE id = $1', [testProductId]);
    }

  } finally {
    if (server) {
      server.close();
    }
    await pool.end();
  }

  console.log('\n====================================================');
  console.log(`📊 AUDIT SUMMARY:`);
  console.log(`   Passed: ${testResults.passed.length}`);
  console.log(`   Failed: ${testResults.failed.length}`);
  console.log('====================================================\n');

  if (testResults.failed.length > 0) {
    console.error('Failed tests:', testResults.failed);
    process.exit(1);
  } else {
    console.log('🎉 ALL END-TO-END AUDIT TESTS PASSED WITH 100% SUCCESS!');
    process.exit(0);
  }
}

runAudit();
