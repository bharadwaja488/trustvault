/**
 * Permission Service — The central authorization engine for TrustVault
 *
 * THIS IS THE MOST SECURITY-CRITICAL FILE IN THE ENTIRE APPLICATION.
 *
 * Design principles:
 *   1. REAL-TIME checks — every call hits the database.  We NEVER cache
 *      permissions because a revoked grant must take effect *immediately*.
 *   2. Deny by default — if we can't prove access is allowed, it's denied.
 *   3. Return opaque reasons — callers get 'NOT_FOUND' for both missing and
 *      unauthorized documents so the HTTP layer can return 404 (not 403),
 *      preventing document-ID enumeration attacks.
 *   4. Owner is king — the document uploader always has full access.
 *   5. Admin is NOT automatically privileged — platform admins manage users
 *      and audit logs but CANNOT read document content unless the owner
 *      explicitly grants them access.  This prevents insider threats.
 */
const { db } = require('../config/database');
const { v4: uuidv4 } = require('uuid');

/**
 * Check whether a user can perform an action on a document.
 *
 * Called on EVERY document access endpoint.  No caching.  No shortcuts.
 *
 * @param {string} userId              - The requesting user's ID
 * @param {string} documentId          - The target document's ID
 * @param {string} requiredPermission  - 'read' or 'edit'
 * @returns {{ allowed: boolean, reason: string, document?: Object }}
 */
function canAccess(userId, documentId, requiredPermission) {
  // Step 1 — Does the document exist and is it not soft-deleted?
  const document = db.prepare(
    'SELECT * FROM documents WHERE id = ? AND is_deleted = 0'
  ).get(documentId);

  if (!document) {
    // Intentionally vague — could be non-existent or deleted.
    return { allowed: false, reason: 'NOT_FOUND' };
  }

  // Step 2 — Is the user the document owner?
  // Owners have full access to their own documents unconditionally.
  if (document.owner_id === userId) {
    return { allowed: true, reason: 'OWNER', document };
  }

  // Step 3 — Check for an active (non-revoked) grant.
  // 'edit' permission implicitly includes 'read' access, so when the
  // required permission is 'read' we accept either 'read' or 'edit' grants.
  let grant;
  if (requiredPermission === 'read') {
    grant = db.prepare(`
      SELECT * FROM document_grants
      WHERE document_id = ?
        AND user_id = ?
        AND permission IN ('read', 'edit')
        AND revoked_at IS NULL
      LIMIT 1
    `).get(documentId, userId);
  } else {
    // For 'edit' we require an explicit 'edit' grant — 'read' alone is
    // insufficient.
    grant = db.prepare(`
      SELECT * FROM document_grants
      WHERE document_id = ?
        AND user_id = ?
        AND permission = 'edit'
        AND revoked_at IS NULL
      LIMIT 1
    `).get(documentId, userId);
  }

  if (grant) {
    return { allowed: true, reason: 'GRANTED', document };
  }

  // Step 4 — Default deny.
  // We return 'NOT_FOUND' (not 'DENIED') so the HTTP layer always sends 404,
  // making it impossible for an attacker to distinguish "document exists but
  // I have no access" from "document doesn't exist".
  return { allowed: false, reason: 'NOT_FOUND' };
}

/**
 * Grant a permission on a document to another user.
 *
 * Only the document owner or a platform admin may call this.
 *
 * @param {string} documentId  - The document to share
 * @param {string} userId      - The user receiving access
 * @param {string} permission  - 'read' or 'edit'
 * @param {string} grantedBy   - ID of the user creating the grant
 * @returns {{ grant?: Object, error?: string }}
 */
function grantPermission(documentId, userId, permission, grantedBy) {
  // Validate the document exists
  const document = db.prepare(
    'SELECT * FROM documents WHERE id = ? AND is_deleted = 0'
  ).get(documentId);

  if (!document) {
    return { error: 'Document not found' };
  }

  // Only the owner or a platform admin can grant permissions
  const granter = db.prepare('SELECT * FROM users WHERE id = ?').get(grantedBy);
  if (document.owner_id !== grantedBy && granter.role !== 'admin') {
    return { error: 'Only the document owner can grant permissions' };
  }

  // Validate the target user exists
  const targetUser = db.prepare('SELECT id FROM users WHERE id = ? AND is_active = 1').get(userId);
  if (!targetUser) {
    return { error: 'Target user not found' };
  }

  // Prevent self-grants (the owner already has full access)
  if (userId === document.owner_id) {
    return { error: 'Cannot grant permissions to the document owner' };
  }

  // Check for an existing active grant of the same type
  const existing = db.prepare(`
    SELECT * FROM document_grants
    WHERE document_id = ? AND user_id = ? AND permission = ? AND revoked_at IS NULL
  `).get(documentId, userId, permission);

  if (existing) {
    return { error: 'Permission already granted' };
  }

  const id = uuidv4();
  const createdAt = new Date().toISOString();

  db.prepare(`
    INSERT INTO document_grants (id, document_id, user_id, permission, granted_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, documentId, userId, permission, grantedBy, createdAt);

  const grant = { id, document_id: documentId, user_id: userId, permission, granted_by: grantedBy, created_at: createdAt };
  return { grant };
}

/**
 * Revoke a specific permission grant.
 *
 * We NEVER delete the grant row — we set `revoked_at` to preserve the audit
 * trail of who had access and when it was removed.
 *
 * @param {string} grantId   - The grant to revoke
 * @param {string} revokedBy - ID of the user performing the revocation
 * @returns {{ success: boolean, error?: string }}
 */
function revokePermission(grantId, revokedBy) {
  const grant = db.prepare(
    'SELECT * FROM document_grants WHERE id = ? AND revoked_at IS NULL'
  ).get(grantId);

  if (!grant) {
    return { success: false, error: 'Grant not found or already revoked' };
  }

  // Only the document owner or admin can revoke
  const document = db.prepare('SELECT owner_id FROM documents WHERE id = ?').get(grant.document_id);
  const revoker = db.prepare('SELECT role FROM users WHERE id = ?').get(revokedBy);

  if (document.owner_id !== revokedBy && revoker.role !== 'admin') {
    return { success: false, error: 'Only the document owner can revoke permissions' };
  }

  const revokedAt = new Date().toISOString();
  db.prepare('UPDATE document_grants SET revoked_at = ? WHERE id = ?').run(revokedAt, grantId);

  return { success: true };
}

/**
 * Revoke ALL active grants for a document (used when deleting a document).
 *
 * @param {string} documentId - The document whose grants to revoke
 * @param {string} revokedBy  - ID of the user triggering the mass revocation
 * @returns {number} Number of grants revoked
 */
function revokeAllPermissions(documentId, revokedBy) {
  const revokedAt = new Date().toISOString();
  const result = db.prepare(
    'UPDATE document_grants SET revoked_at = ? WHERE document_id = ? AND revoked_at IS NULL'
  ).run(revokedAt, documentId);

  return result.changes;
}

/**
 * List all active grants for a document, enriched with user info.
 *
 * @param {string} documentId
 * @returns {Object[]}
 */
function getDocumentPermissions(documentId) {
  return db.prepare(`
    SELECT dg.id, dg.document_id, dg.user_id, dg.permission, dg.granted_by, dg.created_at,
           u.email AS user_email, u.full_name AS user_name
    FROM document_grants dg
    JOIN users u ON u.id = dg.user_id
    WHERE dg.document_id = ? AND dg.revoked_at IS NULL
  `).all(documentId);
}

/**
 * Get every document a user can access (owned + actively granted).
 *
 * @param {string} userId
 * @returns {string[]} Array of document IDs
 */
function getUserAccessibleDocuments(userId) {
  // Documents the user owns
  const owned = db.prepare(
    'SELECT id FROM documents WHERE owner_id = ? AND is_deleted = 0'
  ).all(userId).map(r => r.id);

  // Documents the user has an active grant for
  const granted = db.prepare(`
    SELECT DISTINCT dg.document_id
    FROM document_grants dg
    JOIN documents d ON d.id = dg.document_id
    WHERE dg.user_id = ? AND dg.revoked_at IS NULL AND d.is_deleted = 0
  `).all(userId).map(r => r.document_id);

  // Merge and deduplicate
  return [...new Set([...owned, ...granted])];
}

module.exports = {
  canAccess,
  grantPermission,
  revokePermission,
  revokeAllPermissions,
  getDocumentPermissions,
  getUserAccessibleDocuments,
};
