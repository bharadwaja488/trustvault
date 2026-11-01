/**
 * Permission Management Routes
 *
 * Implements sharing and revoking access per document.
 *
 * CRITICAL DEFENSE:
 *   - Only document owners (and system admins) can grant or revoke permissions.
 *   - Revocation sets revoked_at = NOW() in the database.
 *   - Because permissions are evaluated synchronously on every request,
 *     revocation takes effect IMMEDIATELY without waiting for token expiry.
 */
const express = require('express');
const router = express.Router({ mergeParams: true });
const { db } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { grantPermission, revokePermission, getDocumentPermissions } = require('../services/permissionService');
const { logAction } = require('../services/auditService');

/**
 * GET /api/documents/:id/permissions
 * List all active permissions for a document
 */
router.get('/', authenticateToken, (req, res) => {
  const documentId = req.params.id;
  const userId = req.user.id;
  const isAdmin = req.user.role === 'admin';

  const doc = db.prepare('SELECT owner_id, title FROM documents WHERE id = ? AND is_deleted = 0').get(documentId);

  if (!doc) {
    return res.status(404).json({ error: 'Document not found' });
  }

  // Only the document owner and admin can view permissions list
  if (doc.owner_id !== userId && !isAdmin) {
    return res.status(404).json({ error: 'Document not found' });
  }

  const permissions = getDocumentPermissions(documentId);
  res.json({ permissions });
});

/**
 * POST /api/documents/:id/permissions
 * Grant read or edit permission to a user
 */
router.post('/', authenticateToken, (req, res) => {
  const documentId = req.params.id;
  const { userId: targetUserId, permission } = req.body;
  const clientIp = req.ip || req.connection.remoteAddress;

  if (!targetUserId || !permission) {
    return res.status(400).json({ error: 'Target userId and permission level (read/edit) are required.' });
  }

  if (!['read', 'edit'].includes(permission)) {
    return res.status(400).json({ error: "Permission must be either 'read' or 'edit'." });
  }

  const doc = db.prepare('SELECT owner_id, title FROM documents WHERE id = ? AND is_deleted = 0').get(documentId);
  if (!doc) {
    return res.status(404).json({ error: 'Document not found' });
  }

  // Authorize: Only the owner (or admin) can grant permissions
  if (doc.owner_id !== req.user.id && req.user.role !== 'admin') {
    logAction({
      actorId: req.user.id,
      actorEmail: req.user.email,
      actorIp: clientIp,
      action: 'PERMISSION_GRANT_DENIED',
      resourceType: 'document',
      resourceId: documentId,
      status: 'DENIED',
      details: { reason: 'NON_OWNER_ATTEMPTED_GRANT', targetUserId, permission }
    });
    return res.status(404).json({ error: 'Document not found' });
  }

  const result = grantPermission(documentId, targetUserId, permission, req.user.id);

  if (result.error) {
    return res.status(400).json({ error: result.error });
  }

  const targetUser = db.prepare('SELECT email, full_name FROM users WHERE id = ?').get(targetUserId);

  // AUDIT PERMISSION GRANT
  logAction({
    actorId: req.user.id,
    actorEmail: req.user.email,
    actorIp: clientIp,
    action: 'PERMISSION_GRANTED',
    resourceType: 'document',
    resourceId: documentId,
    status: 'SUCCESS',
    details: {
      grantId: result.grant.id,
      targetUserId,
      targetUserEmail: targetUser ? targetUser.email : null,
      permission,
      documentTitle: doc.title
    }
  });

  res.status(201).json({
    message: 'Permission granted successfully',
    grant: {
      ...result.grant,
      user_email: targetUser ? targetUser.email : null,
      user_name: targetUser ? targetUser.full_name : null
    }
  });
});

/**
 * DELETE /api/documents/:id/permissions/:grantId
 * Revoke a specific permission grant IMMEDIATELY
 */
router.delete('/:grantId', authenticateToken, (req, res) => {
  const { id: documentId, grantId } = req.params;
  const clientIp = req.ip || req.connection.remoteAddress;

  const grant = db.prepare(`
    SELECT dg.*, u.email as target_email 
    FROM document_grants dg 
    JOIN users u ON u.id = dg.user_id
    WHERE dg.id = ? AND dg.document_id = ? AND dg.revoked_at IS NULL
  `).get(grantId, documentId);

  if (!grant) {
    return res.status(404).json({ error: 'Active permission grant not found.' });
  }

  const doc = db.prepare('SELECT owner_id, title FROM documents WHERE id = ?').get(documentId);
  if (!doc) {
    return res.status(404).json({ error: 'Document not found.' });
  }

  // Authorize: Only owner or admin can revoke
  if (doc.owner_id !== req.user.id && req.user.role !== 'admin') {
    logAction({
      actorId: req.user.id,
      actorEmail: req.user.email,
      actorIp: clientIp,
      action: 'PERMISSION_REVOKE_DENIED',
      resourceType: 'document',
      resourceId: documentId,
      status: 'DENIED',
      details: { reason: 'NON_OWNER_ATTEMPTED_REVOKE', grantId }
    });
    return res.status(404).json({ error: 'Document not found' });
  }

  const result = revokePermission(grantId, req.user.id);

  if (!result.success) {
    return res.status(400).json({ error: result.error || 'Failed to revoke permission.' });
  }

  // AUDIT PERMISSION REVOCATION
  logAction({
    actorId: req.user.id,
    actorEmail: req.user.email,
    actorIp: clientIp,
    action: 'PERMISSION_REVOKED',
    resourceType: 'document',
    resourceId: documentId,
    status: 'SUCCESS',
    details: {
      grantId,
      revokedFromUserId: grant.user_id,
      revokedFromEmail: grant.target_email,
      permission: grant.permission,
      documentTitle: doc.title
    }
  });

  res.json({ message: 'Access revoked successfully. Takes effect immediately.' });
});

module.exports = router;
