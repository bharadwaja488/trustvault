/**
 * Administrator Routes
 *
 * All routes require authenticateToken + requireRole('admin').
 *
 * CRITICAL SEPARATION OF DUTIES:
 *   The platform admin can view system-wide audit logs, monitor access denials,
 *   verify hash chain integrity, and manage user accounts.
 *   HOWEVER, the admin does NOT have a backdoor to download confidential documents
 *   unless the document owner has explicitly granted them access.
 */
const express = require('express');
const router = express.Router();
const { db } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { requireRole } = require('../middleware/authorize');
const { getAuditLogs, verifyChain, logAction } = require('../services/auditService');

// All routes here strictly require admin role
router.use(authenticateToken);
router.use(requireRole('admin'));

/**
 * GET /api/admin/audit-logs
 * Paginated and filterable audit logs
 */
router.get('/audit-logs', (req, res) => {
  const { action, actorId, resourceId, dateFrom, dateTo, status, page = 1, limit = 50 } = req.query;

  const result = getAuditLogs({
    action,
    actorId,
    resourceId,
    dateFrom,
    dateTo,
    status,
    page,
    limit
  });

  res.json(result);
});

/**
 * GET /api/admin/audit-verify
 * Cryptographically verifies the entire SHA-256 hash chain
 */
router.get('/audit-verify', (req, res) => {
  const verification = verifyChain();
  res.json(verification);
});

/**
 * GET /api/admin/stats
 * Platform overview telemetry
 */
router.get('/stats', (req, res) => {
  const totalUsers = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
  const totalDocuments = db.prepare('SELECT COUNT(*) as c FROM documents WHERE is_deleted = 0').get().c;
  const totalDownloads = db.prepare("SELECT COUNT(*) as c FROM audit_logs WHERE action = 'DOCUMENT_DOWNLOAD' AND status = 'SUCCESS'").get().c;

  // Access denials in last 24 hours
  const denials24h = db.prepare(`
    SELECT COUNT(*) as c 
    FROM audit_logs 
    WHERE status = 'DENIED' 
      AND timestamp >= datetime('now', '-1 day')
  `).get().c;

  // Recent 10 activity records
  const recentActivity = db.prepare(`
    SELECT id, timestamp, actor_email, action, resource_type, status, details
    FROM audit_logs
    ORDER BY rowid DESC
    LIMIT 10
  `).all();

  // Audit chain health check
  const chainStatus = verifyChain();

  res.json({
    totalUsers,
    totalDocuments,
    totalDownloads,
    denials24h,
    chainValid: chainStatus.valid,
    totalAuditRecords: chainStatus.totalRecords,
    recentActivity
  });
});

/**
 * GET /api/admin/users
 * List all users with account status and document count
 */
router.get('/users', (req, res) => {
  const users = db.prepare(`
    SELECT 
      u.id, u.email, u.full_name, u.role, u.is_active, u.created_at,
      (SELECT COUNT(*) FROM documents d WHERE d.owner_id = u.id AND d.is_deleted = 0) as documents_owned,
      (SELECT COUNT(*) FROM document_grants dg WHERE dg.user_id = u.id AND dg.revoked_at IS NULL) as active_grants
    FROM users u
    ORDER BY u.created_at DESC
  `).all();

  res.json({ users });
});

/**
 * PUT /api/admin/users/:id
 * Activate/deactivate user or change role
 */
router.put('/users/:id', (req, res) => {
  const targetUserId = req.params.id;
  const { is_active, role } = req.body;
  const clientIp = req.ip || req.connection.remoteAddress;

  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(targetUserId);
  if (!target) {
    return res.status(404).json({ error: 'User not found.' });
  }

  // Prevent admin from deactivating themselves
  if (targetUserId === req.user.id && is_active === 0) {
    return res.status(400).json({ error: 'Cannot deactivate your own administrator account.' });
  }

  const newActive = is_active !== undefined ? (is_active ? 1 : 0) : target.is_active;
  const newRole = role !== undefined ? role : target.role;

  if (role !== undefined && !['admin', 'user'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role.' });
  }

  const now = new Date().toISOString();
  db.prepare(`
    UPDATE users 
    SET is_active = ?, role = ?, updated_at = ?
    WHERE id = ?
  `).run(newActive, newRole, now, targetUserId);

  logAction({
    actorId: req.user.id,
    actorEmail: req.user.email,
    actorIp: clientIp,
    action: 'USER_UPDATED',
    resourceType: 'user',
    resourceId: targetUserId,
    status: 'SUCCESS',
    details: {
      userEmail: target.email,
      changes: {
        is_active: { old: target.is_active, new: newActive },
        role: { old: target.role, new: newRole }
      }
    }
  });

  res.json({
    message: 'User updated successfully',
    user: {
      id: targetUserId,
      email: target.email,
      full_name: target.full_name,
      role: newRole,
      is_active: newActive
    }
  });
});

module.exports = router;
