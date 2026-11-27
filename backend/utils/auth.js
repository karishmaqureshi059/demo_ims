import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

// Hash a password using bcrypt
export async function hashPassword(password) {
  const saltRounds = Number(process.env.BCRYPT_SALT_ROUNDS) || 12;
  const hashed = await bcrypt.hash(password, saltRounds);
  return hashed;
}

// Compare a password with a hashed password
export async function comparePassword(password, hashedPassword) {
  const isMatch = await bcrypt.compare(password, hashedPassword);
  return isMatch;
}

// Generate a JWT token
export function generateToken(userId, role, sessionVersion) {
  const payload = {
    sub: userId,
    role: role,
    sessionVersion: sessionVersion || 1,
  };
  
  const token = jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });
  
  return token;
}

// Verify JWT token
export function verifyToken(token) {
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    return { valid: true, decoded };
  } catch (error) {
    return { valid: false, error: error.message };
  }
}

// Refresh JWT token
export function refreshToken(token) {
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || '');
    return { valid: true, decoded };
  } catch (error) {
    return { valid: false, error: error.message };
  }
}