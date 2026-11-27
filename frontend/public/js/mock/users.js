/**
 * Demo users.
 *
 * The records live in localStorage so a role change is shared by every open
 * tab and survives a page refresh. Permissions are never stored here — they
 * are always derived from the role on the record.
 */
const USERS_STORAGE_KEY = 'inventory-demo-users';

const seedUsers = [
  {
    id: '42c5a62e-93d7-4c55-b816-b9e8bb518050',
    employeeId: 'EMP001',
    name: 'System Owner',
    email: 'owner@inventory.com',
    password: 'Owner@123',
    role: 'owner',
    status: 'active',
    phone: '+91 98765 43210',
    avatar: '',
    createdAt: '2024-01-08',
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    employeeId: 'EMP002',
    name: 'Product Manager',
    email: 'product@inventory.com',
    password: 'Product@123',
    role: 'product',
    status: 'active',
    phone: '+91 98765 43211',
    avatar: '',
    createdAt: '2024-02-14',
  },
  {
    id: '33333333-3333-4333-8333-333333333333',
    employeeId: 'EMP003',
    name: 'Sales Manager',
    email: 'sales@inventory.com',
    password: 'Sales@123',
    role: 'sales',
    status: 'active',
    phone: '+91 98765 43212',
    avatar: '',
    createdAt: '2024-03-03',
  },
  {
    id: '44444444-4444-4444-8444-444444444444',
    employeeId: 'EMP004',
    name: 'Stock Manager',
    email: 'stock@inventory.com',
    password: 'Stock@123',
    role: 'stock',
    status: 'active',
    phone: '+91 98765 43213',
    avatar: '',
    createdAt: '2024-03-21',
  },
  {
    id: '55555555-5555-4555-8555-555555555555',
    employeeId: 'EMP005',
    name: 'Purchase Manager',
    email: 'purchase@inventory.com',
    password: 'Purchase@123',
    role: 'purchase',
    status: 'active',
    phone: '+91 98765 43214',
    avatar: '',
    createdAt: '2024-04-09',
  },
  {
    id: '66666666-6666-4666-8666-666666666666',
    employeeId: 'EMP006',
    name: 'Order Manager',
    email: 'orders@inventory.com',
    password: 'Orders@123',
    role: 'orders',
    status: 'active',
    phone: '+91 98765 43215',
    avatar: '',
    createdAt: '2024-05-18',
  },
  {
    id: 'u-007',
    name: 'Oliver Grant',
    email: 'old@demo.com',
    password: 'Old@12345',
    role: 'sales',
    status: 'deactivated',
    phone: '+91 98765 43216',
    avatar: '',
    createdAt: '2023-11-02',
  },
  {
    id: 'u-008',
    name: 'Jonah Reed',
    email: 'jonah.reed@demo.com',
    password: 'Welcome@123',
    role: 'sales',
    status: 'active',
    phone: '+91 98765 43217',
    avatar: '',
    createdAt: '2024-08-12',
  },
  {
    id: 'u-009',
    name: 'Priya Nair',
    email: 'priya.nair@demo.com',
    password: 'Welcome@123',
    role: 'orders',
    status: 'active',
    phone: '+91 98765 43218',
    avatar: '',
    createdAt: '2024-09-01',
  },
  {
    id: 'u-010',
    name: 'Lucas Silva',
    email: 'lucas.silva@demo.com',
    password: 'Welcome@123',
    role: 'stock',
    status: 'active',
    phone: '+91 98765 43219',
    avatar: '',
    createdAt: '2025-01-20',
  },
  {
    id: 'u-011',
    name: 'Grace Chen',
    email: 'grace.chen@demo.com',
    password: 'Welcome@123',
    role: 'product',
    status: 'active',
    phone: '+91 98765 43220',
    avatar: '',
    createdAt: '2025-03-11',
  },
  {
    id: 'u-012',
    name: 'Daniel Mensah',
    email: 'daniel.mensah@demo.com',
    password: 'Welcome@123',
    role: 'purchase',
    status: 'active',
    phone: '+91 98765 43221',
    avatar: '',
    createdAt: '2025-06-06',
  },
  {
    id: 'u-013',
    name: 'Isabella Rossi',
    email: 'isabella.rossi@demo.com',
    password: 'Welcome@123',
    role: 'sales',
    status: 'active',
    phone: '+91 98765 43222',
    avatar: '',
    createdAt: '2025-08-19',
  },
  {
    id: 'u-014',
    name: 'Marcus Webb',
    email: 'marcus.webb@demo.com',
    password: 'Welcome@123',
    role: 'orders',
    status: 'active',
    phone: '+91 98765 43223',
    avatar: '',
    createdAt: '2026-01-13',
  },
  {
    id: 'u-015',
    name: 'Hana Sato',
    email: 'hana.sato@demo.com',
    password: 'Welcome@123',
    role: 'product',
    status: 'deactivated',
    phone: '+91 98765 43224',
    avatar: '',
    createdAt: '2025-11-27',
  },
];

function storage() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

/** Copy a record and make sure the fields the app relies on are present. */
function normaliseUser(user) {
  const version = Number(user?.sessionVersion);
  return {
    ...user,
    // photo holds an uploaded, resized JPEG data URL; avatar holds the URL field.
    photo: typeof user?.photo === 'string' ? user.photo : '',
    sessionVersion: Number.isFinite(version) && version > 0 ? version : 1,
  };
}

function readStoredUsers() {
  try {
    const raw = storage()?.getItem(USERS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.length) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** The single shared user list every module reads from. */
export const users = (readStoredUsers() || seedUsers).map(normaliseUser);
let lastStored = JSON.stringify(users);

/** Persist the demo users so a role change survives a page refresh. */
export function saveUsers() {
  const payload = JSON.stringify(users);
  lastStored = payload;
  try {
    storage()?.setItem(USERS_STORAGE_KEY, payload);
  } catch {
    /* storage unavailable — the demo data simply stays in memory */
  }
}

/** Re-read the shared users so a role changed in another tab is picked up. */
export function refreshUsers() {
  let raw = null;
  try {
    raw = storage()?.getItem(USERS_STORAGE_KEY) || null;
  } catch {
    return users;
  }
  if (!raw || raw === lastStored) return users;
  const parsed = readStoredUsers();
  if (!parsed) return users;
  lastStored = raw;
  users.length = 0;
  users.push(...parsed.map(normaliseUser));
  return users;
}

export function findUserById(id) {
  if (!id) return null;
  const needle = String(id).trim().toLowerCase();
  const found = users.find((user) => String(user.id).trim().toLowerCase() === needle);
  if (found) return found;
  if (needle === '11111111-1111-4111-8111-111111111111') {
    return users.find((user) => user.email === 'owner@inventory.com' || user.role === 'owner') || null;
  }
  return null;
}

export function findUserByLogin(identifier, password) {
  const needle = String(identifier || '').trim().toLowerCase();
  return (
    users.find(
      (user) =>
        (user.email.toLowerCase() === needle || user.name.toLowerCase() === needle) &&
        user.password === password,
    ) || null
  );
}

export function publicUser(user) {
  if (!user) return null;
  const { password, ...safe } = user;
  return { ...safe };
}
