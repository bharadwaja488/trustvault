/**
 * Authorization Middleware
 *
 * CRITICAL DEFENSE MECHANISMS:
 *   1. checkDocumentAccess:
 *      - Invokes permissionService.canAccess() on EVERY access attempt.
 *      - If access is denied, it logs an ACCESS_DENIED event to the tamper-evident
 *        audit trail immediately with IP and actor details.
 *      - It returns 404 (NOT 403) to prevent IDOR document ID enumeration.
 *   2. requireRole:
 *      - Restricts administrative routes to users with specific roles (e.g., 'admin').
 */
const { canAccess } = require('../services/permissionService');
const { logAction } = require('../services/auditService');

/**
 * Middleware: Verify the user has platform role(s)
 * @param {...string} roles Allowed roles (e.g. 'admin')
 */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required.' });
    }

    if (!roles.includes(req.user.role)) {
      // Log unauthorized role escalation attempt
      logAction({
        actorId: req.user.id,
        actorEmail: req.user.email,
        actorIp: req.ip || req.connection.remoteAddress,
        action: 'ROLE_UNAUTHORIZED_ATTEMPT',
        resourceType: 'system',
        resourceId: req.originalUrl,
        status: 'DENIED',
        details: { requiredRoles: roles, userRole: req.user.role }
      });

      return res.status(403).json({ error: 'Access forbidden: Insufficient administrative privileges.' });
    }

    next();
  };
}

/**
 * Middleware: Verify user has specific document permission ('read' or 'edit')
 *
 * WHY RETURN 404 INSTEAD OF 403?
 *   Returning 403 confirms to an attacker that document UUID 'X' exists.
 *   Returning 404 for both non-existent AND unauthorized documents completely
 *   eliminates the enumeration vector.
 *
 * @param {'read'|'edit'} requiredPermission
 */
function checkDocumentAccess(requiredPermission = 'read') {
  return (req, res, next) => {
    const documentId = req.params.id;

    if (!documentId) {
      return res.status(400).json({ error: 'Document ID is required.' });
    }

    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required.' });
    }

    const result = canAccess(req.user.id, documentId, requiredPermission);

    if (!result.allowed) {
      // LOG REFUSED ATTEMPT TO AUDIT TRAIL — Non-negotiable requirement #2
      logAction({
        actorId: req.user.id,
        actorEmail: req.user.email,
        actorIp: req.ip || req.connection.remoteAddress,
        action: 'ACCESS_DENIED',
        resourceType: 'document',
        resourceId: documentId,
        status: 'DENIED',
        details: {
          requiredPermission,
          reason: result.reason,
          endpoint: req.originalUrl,
          method: req.method,
          userAgent: req.headers['user-agent']
        }
      });

      // Return 404 to avoid leaking document existence
      return res.status(404).json({ error: 'Document not found' });
    }

    // Attach document to request object for downstream handlers
    req.document = result.document;
    req.accessReason = result.reason; // 'OWNER' or 'GRANT'
    next();
  };
}

module.exports = {
  requireRole,
  checkDocumentAccess
};
