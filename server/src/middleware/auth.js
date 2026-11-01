/**
 * Authentication Middleware
 *
 * CRITICAL SECURITY ARCHITECTURE:
 *   1. The JWT token stores ONLY identity claims: { id, email, role }.
 *      It NEVER stores document access rights or permission lists.
 *   2. On EVERY authenticated request, we query the database to verify
 *      that the user exists and is active (`is_active = 1`).
 *   3. If an account is disabled or deactivated, access is cut off IMMEDIATELY,
 *      even if their JWT token is cryptographically valid and unexpired.
 */
const jwt = require('jsonwebtoken');
const { db } = require('../config/database');

const JWT_SECRET = process.env.JWT_SECRET || 'trustvault-super-secure-secret-key-change-in-production';

/**
 * Middleware: Verify JWT and load current user from database
 */
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer <token>

  if (!token) {
    return res.status(401).json({ error: 'Authentication required. No token provided.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    // REAL-TIME check against database: is the user still active?
    const user = db.prepare('SELECT id, email, full_name, role, is_active FROM users WHERE id = ?').get(decoded.id);

    if (!user) {
      return res.status(401).json({ error: 'User account no longer exists.' });
    }

    if (!user.is_active) {
      return res.status(401).json({ error: 'Account has been deactivated.' });
    }

    // Attach fresh user object (from DB, not solely trust token payload)
    req.user = {
      id: user.id,
      email: user.email,
      full_name: user.full_name,
      role: user.role
    };

    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Session expired. Please log in again.' });
    }
    return res.status(401).json({ error: 'Invalid authentication token.' });
  }
}

/**
 * Optional authentication middleware:
 * Populates req.user if a valid token is present, but does not block if absent.
 */
function optionalAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    req.user = null;
    return next();
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = db.prepare('SELECT id, email, full_name, role, is_active FROM users WHERE id = ?').get(decoded.id);
    if (user && user.is_active) {
      req.user = {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        role: user.role
      };
    } else {
      req.user = null;
    }
  } catch (err) {
    req.user = null;
  }

  next();
}

module.exports = {
  authenticateToken,
  optionalAuth,
  JWT_SECRET
};
