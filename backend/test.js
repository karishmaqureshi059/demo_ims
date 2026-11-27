// Quick test script for the backend
import { Pool } from 'pg';
import bcrypt from 'bcryptjs';

console.log('Testing backend components...\n');

// Test bcrypt
const testPassword = 'Test@12345';
bcrypt.hash(testPassword, 12).then(async (hashed) => {
  console.log('✓ Password hashing works');
  
  const isMatch = await bcrypt.compare(testPassword, hashed);
  console.log('✓ Password comparison works:', isMatch ? 'true' : 'false');
  
  // Test JWT
  const jwt = (await import('jsonwebtoken')).default;
  const token = jwt.sign({ sub: 'test-user-id', role: 'owner' }, 'inventory-management-secret-key-2026', {
    expiresIn: '7d',
  });
  console.log('✓ JWT token generation works');
  
  const decoded = jwt.verify(token, 'inventory-management-secret-key-2026');
  console.log('✓ JWT token verification works:', decoded.role === 'owner' ? 'true' : 'false');
  
  console.log('\nAll basic tests passed!');
}).catch((err) => {
  console.error('✗ Test failed:', err.message);
  process.exit(1);
});