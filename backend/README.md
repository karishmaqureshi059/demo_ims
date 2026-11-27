# Inventory Management System - Backend

## Overview
Complete backend for the Inventory Management System built with Node.js, Express.js, and PostgreSQL. Implements RBAC with six user roles, JWT authentication, and full CRUD operations for all management modules.

## Technology Stack
- **Node.js** with **Express.js** framework
- **PostgreSQL** database
- **JWT** for authentication
- **bcryptjs** for password hashing
- **Zod** for request validation
- **Helmet** for HTTP header security
- **express-rate-limit** for API rate limiting

## Folder Structure
```
backend/
├── config/           # Configuration files (db.js, .env)
├── controllers/      # Request handlers organized by module
├── middleware/       # Express middleware (auth, authorization)
├── models/          # Database query functions
├── routes/          # Express routes organized by feature
├── services/        # Business logic services
├── utils/           # Utility functions (auth, formatting)
├── scripts/         # Database setup and seed scripts
├── .env             # Environment variables
├── server.js        # Main application entry point
└── package.json     # Dependencies and scripts
```

## Prerequisites
- Node.js >= 18.x
- PostgreSQL >= 15.x
- npm or yarn

## Installation

### 1. Clone and Setup
```bash
# Clone the backend repository
git clone <repository-url>
cd backend-ims

# Install dependencies
npm install
```

### 2. Environment Configuration
Create a `.env` file in the root directory:
```env
# Server
PORT=5000
NODE_ENV=development

# Database
DATABASE_URL=postgres://postgres:password@localhost:5432/inventory_management

# Security
JWT_SECRET=inventory-management-secret-key-2026
BCRYPT_SALT_ROUNDS=12

# CORS
FRONTEND_URL=http://localhost:5173

# JWT Options
JWT_EXPIRES_IN=7d
JWT_REFRESH_EXPIRES_IN=30d
```

### 3. Database Setup
Run the setup script to create the database schema:
```bash
npm run seed
# Or manually:
psql -U postgres -d inventory_management -f scripts/setup-db.sql
```

### 4. Seed Sample Data
Populate the database with sample users and test data:
```bash
npm run seed
# Or:
node scripts/seed-db.js
```

### 5. Start the Server
```bash
# Development mode with auto-reload
npm run dev

# Production mode
npm start
```

The server will start on `http://localhost:5000` by default.

## API Authentication

### Login
```http
POST /api/auth/login
Content-Type: application/json

{
  "identifier": "owner@inventory.com",
  "password": "Owner@123"
}
```

### Response
```json
{
  "message": "Login successful",
  "token": "jwt-token-u-001-1234567890",
  "refreshToken": "jwt-refresh-u-001-1234567890",
  "user": {
    "id": "u-owner-001",
    "name": "Owner User",
    "email": "owner@inventory.com",
    "role": "owner",
    "status": "active"
  }
}
```

### Get Current User
```http
GET /api/auth/me
Authorization: Bearer <jwt-token>
```

### Refresh Token
```http
POST /api/auth/refresh-token
Content-Type: application/json

{
  "token": "<refresh-token>"
}
```

## Six User Roles & RBAC

The system implements Role-Based Access Control with six roles:

| Role Key | Label | Module Access |
|----------|-------|---------------|
| `owner` | Owner | All modules - full administrative access |
| `product` | Product Manager | Products, categories, analytics, reports |
| `sales` | Sales Manager | Sales, orders, analytics, reports |
| `stock` | Stock Manager | Stock transactions, products, analytics, reports |
| `purchase` | Purchase Manager | Suppliers, purchase orders, receiving, analytics, reports |
| `orders` | Order Manager | Orders, order status, analytics, reports |

### Permission System
Each role has specific permissions granted from the `permissions` table. Permissions are checked on every protected API endpoint using the `authorizePermission` middleware.

Example permission keys:
- `products.view` - View product list
- `products.create` - Create new products
- `products.update` - Edit product details
- `stock.create` - Record stock transactions
- `stock.adjust` - Adjust stock levels
- `purchases.receive` - Receive goods into stock
- `orders.status` - Update order status
- `analytics.view` - View analytics and reports
- `reports.generate` - Generate reports

## API Endpoints

### Authentication
- `POST /api/auth/login` - User login
- `GET /api/auth/me` - Get current user details
- `POST /api/auth/refresh-token` - Refresh access token
- `POST /api/auth/logout` - User logout
- `POST /api/auth/forgot-password` - Forgot password workflow

### User Management (Owner)
- `GET /api/users` - View all users
- `GET /api/users/:id` - Get user by ID
- `POST /api/users` - Create new user
- `PUT /api/users/:id` - Edit user details
- `PUT /api/users/:id/role` - Change user role
- `PUT /api/users/:id/status` - Activate/deactivate account
- `POST /api/users/:id/reset-password` - Reset user password

### Product Management
- `GET /api/products` - View product list with filters
- `GET /api/products/:id` - Get product by ID
- `POST /api/products` - Create new product
- `PUT /api/products/:id` - Update product
- `DELETE /api/products/:id` - Delete product
- `GET /api/products/category/:categoryId` - Products by category

### Stock Management
- `GET /api/stock/transactions` - View stock transactions
- `POST /api/stock/transactions` - Record stock transaction (in/out/adjustment)
- `PUT /api/stock/transactions/:id` - Update stock transaction
- `GET /api/stock/low-stock` - Get low-stock products
- `GET /api/stock/summary` - Stock summary KPIs

### Purchase Management
- `GET /api/purchases/suppliers` - View suppliers
- `GET /api/purchases/orders` - View purchase orders
- `POST /api/purchases/orders` - Create purchase order
- `PUT /api/purchases/orders/:id` - Update purchase order
- `POST /api/purchases/orders/:id/receive` - Receive goods

### Sales Management
- `GET /api/sales` - View sales records
- `POST /api/sales` - Create sale record

### Order Management
- `GET /api/orders` - View orders
- `GET /api/orders/:id` - Get order by ID
- `POST /api/orders` - Create new order
- `PUT /api/orders/:id` - Update order
- `PUT /api/orders/:id/status` - Update order status

### Dashboard & Analytics
- `GET /api/dashboard/:roleKey` - Get dashboard data for role
- `GET /api/analytics/:roleKey` - Get analytics data
- `GET /api/reports` - List available reports
- `GET /api/reports/:reportId` - Generate report

### Health Check
- `GET /api/health` - API health status

## Security Features

### JWT Authentication
- Access tokens expire in 7 days
- Refresh tokens expire in 30 days
- Tokens include user role and session version
- Session invalidation on role change

### Password Security
- bcrypt hashing with configurable salt rounds (default: 12)
- Passwords never stored in plaintext
- Password validation (minimum 8 characters)

### Role-Based Access Control
- Every protected API enforces role permissions
- RBAC enforced via database `role_permissions` table
- Session versioning to invalidate old tokens on role change
- Deactivated users cannot log in

### Input Validation
- Zod-based validation on all API requests
- Required field validation
- Email format validation
- Indian phone number validation
- Whole number and non-negative number validation

### Data Protection
- Helmet.js for HTTP header security
- CORS configuration for frontend origin
- Rate limiting (100 requests per 15 minutes)
- Error handling with proper status codes

## Database Schema

The system creates the following PostgreSQL tables:

### Core Tables
- `users` - User accounts with roles and status
- `roles` - Role definitions
- `permissions` - Action-level permissions
- `role_permissions` - Many-to-many role-permission mapping

### Module Tables
- `categories` - Product categories (hierarchical)
- `products` - Product inventory with SKU, price, quantity, min_level
- `suppliers` - Supplier information
- `purchase_orders` - Purchase orders with items
- `purchase_order_items` - Individual items in purchase orders
- `sales` - Sales records
- `sale_items` - Individual items in sales
- `orders` - Customer orders
- `order_items` - Individual items in orders

### Transaction Tables
- `stock_transactions` - Stock in/out/adjustment history
- `notifications` - System notifications with role-based filtering
- `user_activity` - Audit trail of important actions

### Configuration Tables
- `settings` - System settings key-value store

### Relationships
- Users belong to one role (foreign key to roles table)
- Products belong to a category (foreign key to categories table)
- Purchase orders reference suppliers and have items referencing products
- Sales reference users and have items referencing products
- Orders reference users and have items referencing products
- Stock transactions reference products and users
- Notifications reference users
- Settings are independent key-value pairs

### Constraints and Indexes
- Primary keys on all tables
- Foreign key constraints with CASCADE where appropriate
- Unique constraints on email, SKU, role name, permission name
- Indexes on frequently queried columns (email, role, status, product SKU, etc.)
- Generated columns for product status (Out of Stock/Low Stock/In Stock)

## Role-Based Access Control Details

### Owner
- Full access to all modules and permissions
- Can manage users, roles, and permissions
- Can activate/deactivate any user account
- Can reset any user's password
- Cannot change their own role

### Product Manager
- Create, view, edit, and delete products
- Manage product categories
- View stock and sales analytics
- Generate reports
- Cannot view or modify user accounts

### Sales Manager
- Create and view sales records
- View orders and products
- Generate reports
- Cannot manage stock or purchase orders

### Stock Manager
- Record stock-in, stock-out, and stock adjustments
- Track stock transactions
- View low-stock and out-of-stock alerts
- Cannot manage purchases or sales

### Purchase Manager
- Manage suppliers
- Create and manage purchase orders
- Record received quantities
- Update stock after receiving goods
- Cannot manage sales or orders

### Order Manager
- Create and manage orders
- Update order status (new → processing → completed/cancelled)
- Track order details
- Cannot manage products, stock, or purchases

## Frontend Integration

The backend integrates with the existing React frontend in the `ims-4` directory. The `public/js/api.js` file has been updated to fetch from the backend API instead of using mock data.

### Running Frontend & Backend Together

1. **Start the backend**:
   ```bash
   cd backend-ims
   npm run dev
   ```

2. **Start the frontend**:
   ```bash
   cd ims-4
   npm run dev
   # or: npm start
   ```

The frontend will automatically connect to the backend API at `http://localhost:5000`.

### API Base URL
Configure the frontend API base URL via `REACT_APP_API_URL` environment variable or modify `public/js/api.js`:
```javascript
const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';
```

## Sample Credentials

### Admin Account (created during setup)
- **Email**: owner@inventory.com
- **Password**: Owner@123
- **Role**: owner

### Test User Accounts (created during seed)
| Email | Password | Role |
|-------|----------|------|
| product@inventory.com | Product@123 | product |
| sales@inventory.com | Sales@123 | sales |
| stock@inventory.com | Stock@123 | stock |
| purchase@inventory.com | Purchase@123 | purchase |
| orders@inventory.com | Orders@123 | orders |

### Demo Indian Phone Format
`+91 98765 43210` (country code +91 followed by 10-digit mobile number starting with 6-9)

## Testing

### Run Tests
```bash
npm test
```

### Manual Testing Recommendations
1. Login as each of the six roles and verify correct dashboard data
2. Test permission enforcement - try accessing endpoints outside role scope
3. Test role changes - change a user's role and verify dashboard updates
4. Test stock transactions - verify stock levels don't go negative
5. Test purchase order receiving - verify stock updates correctly
6. Test sales creation - verify stock decreases and sales recorded
7. Test forgot password workflow
8. Test user deactivation/activation

## Project Status

✅ Complete backend implementation with Express.js and PostgreSQL
✅ All six role-based dashboards with KPIs and charts
✅ JWT authentication with refresh tokens
✅ bcrypt password hashing
✅ RBAC with permission enforcement on all APIs
✅ Full CRUD operations for all modules
✅ Stock transaction management with negative stock prevention
✅ Purchase order receiving with stock updates
✅ Sales creation with stock deduction
✅ Activity history and notification system
✅ Dashboard KPIs and chart data for all six roles
✅ Database schema with proper relationships and constraints
✅ Frontend integration updated
✅ Sample data for testing all six roles
✅ API documentation and setup instructions

## Future Enhancements

- Image upload for product photos and user avatars
- PDF report generation
- Advanced filtering and search
- Email notifications system
- Two-factor authentication
- Mobile API endpoints
- Audit log export functionality
- Dashboard widget customization