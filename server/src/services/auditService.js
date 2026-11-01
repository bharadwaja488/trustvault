/**
 * Audit Service — Append-only, SHA-256 hash-chained audit trail
 *
 * Every security-relevant action in TrustVault is recorded here.  Records
 * form a linked list: each entry's `record_hash` is computed over its own
 * fields PLUS the previous entry's hash.  This means silently tampering with
 * or deleting any single record breaks every hash that follows, and
 * `verifyChain()` will detect it.
 *
 * WHY hash chaining?
 *   Even if an attacker gains DB access, they cannot rewrite history without
 *   also recomputing every subsequent hash — something the DB triggers on
 *   audit_logs already prevent (UPDATE/DELETE are blocked).
 */
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { db } = require('../config/database');

/**
 * Compute the SHA-256 hash for a single audit entry.
 *
 * The pipe-delimited string ensures field ordering is deterministic.
 * `previousHash` is the hash of the record that was inserted immediately
 * before this one.  For the very first record the sentinel 'GENESIS' is used.
 */
function computeHash(entry, previousHash) {
  const data = `${entry.id}|${entry.timestamp}|${entry.actor_id}|${entry.action}|${entry.resource_type}|${entry.resource_id}|${entry.status}|${previousHash || 'GENESIS'}`;
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Insert an audit record into the append-only log.
 *
 * @param {Object} params
 * @param {string}  params.actorId      - User performing the action (nullable for system events)
 * @param {string}  params.actorEmail   - Email of the actor
 * @param {string}  params.actorIp      - IP address of the request
 * @param {string}  params.action       - Machine-readable action name (e.g. LOGIN, DOCUMENT_UPLOAD)
 * @param {string}  params.resourceType - Type of resource affected (e.g. 'document', 'user')
 * @param {string}  params.resourceId   - ID of the affected resource
 * @param {string}  params.status       - 'SUCCESS' or 'DENIED'
 * @param {string}  [params.details]    - Free-form JSON or text with extra context
 */
function logAction({ actorId, actorEmail, actorIp, action, resourceType, resourceId, status, details }) {
  const id = uuidv4();
  const timestamp = new Date().toISOString();

  // Get the most recent record's hash so we can extend the chain
  const lastRow = db.prepare(
    'SELECT record_hash FROM audit_logs ORDER BY rowid DESC LIMIT 1'
  ).get();
  const previousHash = lastRow ? lastRow.record_hash : null;

  const entry = { id, timestamp, actor_id: actorId, action, resource_type: resourceType, resource_id: resourceId, status };
  const recordHash = computeHash(entry, previousHash);

  db.prepare(`
    INSERT INTO audit_logs
      (id, timestamp, actor_id, actor_email, actor_ip, action,
       resource_type, resource_id, status, details, previous_hash, record_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, timestamp, actorId || null, actorEmail || null, actorIp || null,
    action, resourceType || null, resourceId || null, status,
    details ? (typeof details === 'string' ? details : JSON.stringify(details)) : null,
    previousHash || 'GENESIS', recordHash
  );

  return { id, timestamp, recordHash };
}

/**
 * Verify the integrity of the entire audit chain.
 *
 * Reads every record in insertion order and recomputes each hash.
 * If any hash doesn't match, the chain is broken at that index.
 *
 * @returns {{ valid: boolean, totalRecords: number, brokenAt: number|null }}
 */
function verifyChain() {
  const rows = db.prepare(
    'SELECT id, timestamp, actor_id, action, resource_type, resource_id, status, previous_hash, record_hash FROM audit_logs ORDER BY rowid ASC'
  ).all();

  let previousHash = null;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const expected = computeHash(row, previousHash);

    if (expected !== row.record_hash) {
      return { valid: false, totalRecords: rows.length, brokenAt: i };
    }

    // Also verify the stored previous_hash pointer is consistent
    const expectedPrev = previousHash || 'GENESIS';
    if (row.previous_hash !== expectedPrev) {
      return { valid: false, totalRecords: rows.length, brokenAt: i };
    }

    previousHash = row.record_hash;
  }

  return { valid: true, totalRecords: rows.length, brokenAt: null };
}

/**
 * Query audit logs with optional filters and pagination.
 *
 * @param {Object} filters
 * @param {string} [filters.action]
 * @param {string} [filters.actorId]
 * @param {string} [filters.resourceId]
 * @param {string} [filters.dateFrom]   - ISO date string lower bound (inclusive)
 * @param {string} [filters.dateTo]     - ISO date string upper bound (inclusive)
 * @param {string} [filters.status]     - 'SUCCESS' or 'DENIED'
 * @param {number} [filters.page=1]
 * @param {number} [filters.limit=50]
 * @returns {{ logs: Object[], total: number, page: number, limit: number }}
 */
function getAuditLogs(filters = {}) {
  const conditions = [];
  const params = [];

  if (filters.action) {
    conditions.push('action = ?');
    params.push(filters.action);
  }
  if (filters.actorId) {
    conditions.push('actor_id = ?');
    params.push(filters.actorId);
  }
  if (filters.resourceId) {
    conditions.push('resource_id = ?');
    params.push(filters.resourceId);
  }
  if (filters.dateFrom) {
    conditions.push('timestamp >= ?');
    params.push(filters.dateFrom);
  }
  if (filters.dateTo) {
    conditions.push('timestamp <= ?');
    params.push(filters.dateTo);
  }
  if (filters.status) {
    conditions.push('status = ?');
    params.push(filters.status);
  }

  const whereClause = conditions.length > 0
    ? `WHERE ${conditions.join(' AND ')}`
    : '';

  const page = Math.max(1, parseInt(filters.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(filters.limit, 10) || 50));
  const offset = (page - 1) * limit;

  const total = db.prepare(
    `SELECT COUNT(*) as count FROM audit_logs ${whereClause}`
  ).get(...params).count;

  const logs = db.prepare(
    `SELECT * FROM audit_logs ${whereClause} ORDER BY rowid DESC LIMIT ? OFFSET ?`
  ).all(...params, limit, offset);

  return { logs, total, page, limit };
}

module.exports = { logAction, verifyChain, getAuditLogs, computeHash };
