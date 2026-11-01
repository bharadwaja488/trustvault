/**
 * Authentication Routes
 */
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { db } = require('../config/database');
const { authenticateToken, JWT_SECRET } = require('../middleware/auth');
const { requireRole } = require('../middleware/authorize');
const { logAction } = require('../services/auditService');

/**
 * POST /api/auth/login
 * User login with email and password
 */
router.post('/login', (req, res) => {
  const { email, password } = req.body;
  const clientIp = req.ip || req.connection.remoteAddress;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const user = db.prepare('SELECT * FROM users WHERE LOWER(email) = ?').get(normalizedEmail);

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    // Audit failed login attempt
    logAction({
      actorId: user ? user.id : null,
      actorEmail: normalizedEmail,
      actorIp: clientIp,
      action: 'LOGIN_FAILED',
      resourceType: 'auth',
      resourceId: null,
      status: 'DENIED',
      details: { reason: 'INVALID_CREDENTIALS', userAgent: req.headers['user-agent'] }
    });

    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  if (!user.is_active) {
    logAction({
      actorId: user.id,
      actorEmail: user.email,
      actorIp: clientIp,
      action: 'LOGIN_FAILED',
      resourceType: 'auth',
      resourceId: null,
      status: 'DENIED',
      details: { reason: 'ACCOUNT_DEACTIVATED' }
    });

    return res.status(403).json({ error: 'Your account has been deactivated. Contact an administrator.' });
  }

  // Token contains ONLY identity, never document permission sets
  const token = jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role
    },
    JWT_SECRET,
    { expiresIn: '24h' }
  );

  // Audit successful login
  logAction({
    actorId: user.id,
    actorEmail: user.email,
    actorIp: clientIp,
    action: 'LOGIN',
    resourceType: 'auth',
    resourceId: user.id,
    status: 'SUCCESS',
    details: { userAgent: req.headers['user-agent'] }
  });

  return res.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      full_name: user.full_name,
      role: user.role
    }
  });
});

/**
 * GET /api/auth/me
 * Get currently authenticated user details
 */
router.get('/me', authenticateToken, (req, res) => {
  res.json({ user: req.user });
});

/**
 * GET /api/auth/users
 * Search or list users (for granting document permissions)
 */
router.get('/users', authenticateToken, (req, res) => {
  const users = db.prepare(`
    SELECT id, email, full_name, role 
    FROM users 
    WHERE is_active = 1 
    ORDER BY full_name ASC
  `).all();

  res.json({ users });
});

/**
 * POST /api/auth/register
 * Admin-only user creation
 */
router.post('/register', authenticateToken, requireRole('admin'), (req, res) => {
  const { email, password, full_name, role = 'user' } = req.body;
  const clientIp = req.ip || req.connection.remoteAddress;

  if (!email || !password || !full_name) {
    return res.status(400).json({ error: 'Email, password, and full name are required.' });
  }

  if (!['admin', 'user'].includes(role)) {
    return res.status(400).json({ error: 'Role must be admin or user.' });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const existing = db.prepare('SELECT id FROM users WHERE LOWER(email) = ?').get(normalizedEmail);
  if (existing) {
    return res.status(409).json({ error: 'A user with this email address already exists.' });
  }

  const id = uuidv4();
  const passwordHash = bcrypt.hashSync(password, 12);
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO users (id, email, password_hash, full_name, role, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?)
  `).run(id, normalizedEmail, passwordHash, full_name.trim(), role, now, now);

  logAction({
    actorId: req.user.id,
    actorEmail: req.user.email,
    actorIp: clientIp,
    action: 'USER_CREATED',
    resourceType: 'user',
    resourceId: id,
    status: 'SUCCESS',
    details: { createdUserEmail: normalizedEmail, assignedRole: role }
  });

  res.status(201).json({
    user: {
      id,
      email: normalizedEmail,
      full_name: full_name.trim(),
      role
    }
  });
});

module.exports = router;
