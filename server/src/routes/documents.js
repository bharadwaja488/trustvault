/**
 * Documents Routes
 *
 * Implements document upload, listing, searching, metadata viewing,
 * content streaming (download), editing, and deletion.
 *
 * CRITICAL DEFENSE:
 *   - Upload: File validation checks magic bytes against buffer, rejecting spoofed extensions.
 *   - Storage: Files stored using opaque UUID names in server/uploads/. Never served statically.
 *   - Download: Access check runs synchronously in DB before ANY byte is read from disk.
 *   - Revocation: Access checks are dynamic. Revoking a grant immediately stops downloads.
 */
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { db } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { checkDocumentAccess } = require('../middleware/authorize');
const { logAction } = require('../services/auditService');
const { canAccess, revokeAllPermissions } = require('../services/permissionService');
const { validateFileType, sanitizeFilename, ALLOWED_MIME_TYPES, MAX_FILE_SIZE } = require('../utils/fileValidation');

// Directory for physical storage (opaque UUID filenames)
const UPLOADS_DIR = path.join(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Multer memory storage — keeps buffer in RAM for magic-byte verification before saving
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 1
  },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      return cb(new Error(`File type '${file.mimetype}' is not permitted.`));
    }
    cb(null, true);
  }
});

/**
 * GET /api/documents
 * List documents accessible by current user (with search & filters)
 */
router.get('/', authenticateToken, (req, res) => {
  const { search, category, owner, dateFrom, dateTo, page = 1, limit = 20, all } = req.query;
  const userId = req.user.id;
  const isAdmin = req.user.role === 'admin';

  let queryConditions = ['d.is_deleted = 0'];
  let queryParams = [];

  // Platform admin can view metadata for all documents if explicitly requesting it
  if (isAdmin && all === 'true') {
    // Admin mode: see all document metadata (not content)
  } else {
    // Regular access: Documents owned by user OR with active grant
    queryConditions.push(`(
      d.owner_id = ? 
      OR EXISTS (
        SELECT 1 FROM document_grants dg 
        WHERE dg.document_id = d.id 
          AND dg.user_id = ? 
          AND dg.revoked_at IS NULL
      )
    )`);
    queryParams.push(userId, userId);
  }

  // Filter: search by title, description or filename
  if (search && search.trim()) {
    queryConditions.push('(d.title LIKE ? OR d.description LIKE ? OR d.original_filename LIKE ?)');
    const searchTerm = `%${search.trim()}%`;
    queryParams.push(searchTerm, searchTerm, searchTerm);
  }

  // Filter: category
  if (category && category.trim()) {
    queryConditions.push('d.category = ?');
    queryParams.push(category.trim());
  }

  // Filter: owner
  if (owner && owner.trim()) {
    queryConditions.push('(u.email LIKE ? OR u.full_name LIKE ?)');
    const ownerTerm = `%${owner.trim()}%`;
    queryParams.push(ownerTerm, ownerTerm);
  }

  // Filter: date range
  if (dateFrom) {
    queryConditions.push('d.created_at >= ?');
    queryParams.push(dateFrom);
  }
  if (dateTo) {
    queryConditions.push('d.created_at <= ?');
    queryParams.push(dateTo);
  }

  const whereClause = queryConditions.length > 0 ? `WHERE ${queryConditions.join(' AND ')}` : '';

  const parsedPage = Math.max(1, parseInt(page, 10) || 1);
  const parsedLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const offset = (parsedPage - 1) * parsedLimit;

  const countRow = db.prepare(`
    SELECT COUNT(*) as count 
    FROM documents d
    JOIN users u ON u.id = d.owner_id
    ${whereClause}
  `).get(...queryParams);

  const total = countRow ? countRow.count : 0;

  const documents = db.prepare(`
    SELECT 
      d.id, d.title, d.description, d.original_filename, 
      d.mime_type, d.file_size, d.category, d.owner_id, 
      d.created_at, d.updated_at,
      u.full_name as owner_name, u.email as owner_email,
      CASE 
        WHEN d.owner_id = ? THEN 'owner'
        ELSE (
          SELECT dg.permission 
          FROM document_grants dg 
          WHERE dg.document_id = d.id AND dg.user_id = ? AND dg.revoked_at IS NULL 
          LIMIT 1
        )
      END as user_permission
    FROM documents d
    JOIN users u ON u.id = d.owner_id
    ${whereClause}
    ORDER BY d.created_at DESC
    LIMIT ? OFFSET ?
  `).all(userId, userId, ...queryParams, parsedLimit, offset);

  res.json({
    documents,
    total,
    page: parsedPage,
    totalPages: Math.ceil(total / parsedLimit)
  });
});

/**
 * POST /api/documents
 * Upload a new confidential document
 */
router.post('/', authenticateToken, upload.single('file'), (req, res) => {
  const clientIp = req.ip || req.connection.remoteAddress;

  if (!req.file) {
    return res.status(400).json({ error: 'No file was uploaded.' });
  }

  const { title, description, category = 'General' } = req.body;

  if (!title || !title.trim()) {
    return res.status(400).json({ error: 'Document title is required.' });
  }

  // LAYER 1: Validate file content against magic bytes (prevent file spoofing)
  const validation = validateFileType(req.file.buffer, req.file.mimetype);
  if (!validation.valid) {
    logAction({
      actorId: req.user.id,
      actorEmail: req.user.email,
      actorIp: clientIp,
      action: 'FILE_VALIDATION_FAILED',
      resourceType: 'document',
      resourceId: null,
      status: 'DENIED',
      details: {
        declaredType: req.file.mimetype,
        reason: validation.reason,
        filename: req.file.originalname
      }
    });

    return res.status(400).json({ error: `File security validation failed: ${validation.reason}` });
  }

  // LAYER 2: Sanitize original filename (prevent path traversal)
  const safeFilename = sanitizeFilename(req.file.originalname);

  // Generate storage key (opaque UUID on disk, never user-controlled filename)
  const documentId = uuidv4();
  const storageKey = `${documentId}.enc`;
  const storagePath = path.join(UPLOADS_DIR, storageKey);

  try {
    // Write buffer to storage
    fs.writeFileSync(storagePath, req.file.buffer);

    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO documents 
        (id, title, description, original_filename, storage_key, mime_type, file_size, category, owner_id, is_deleted, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
    `).run(
      documentId,
      title.trim(),
      description ? description.trim() : '',
      safeFilename,
      storageKey,
      req.file.mimetype,
      req.file.size,
      category.trim(),
      req.user.id,
      now,
      now
    );

    // Audit the upload in the hash chain
    logAction({
      actorId: req.user.id,
      actorEmail: req.user.email,
      actorIp: clientIp,
      action: 'DOCUMENT_UPLOAD',
      resourceType: 'document',
      resourceId: documentId,
      status: 'SUCCESS',
      details: {
        title: title.trim(),
        filename: safeFilename,
        size: req.file.size,
        mimeType: req.file.mimetype,
        category: category.trim()
      }
    });

    res.status(201).json({
      message: 'Document uploaded successfully',
      document: {
        id: documentId,
        title: title.trim(),
        description: description ? description.trim() : '',
        original_filename: safeFilename,
        mime_type: req.file.mimetype,
        file_size: req.file.size,
        category: category.trim(),
        owner_id: req.user.id,
        created_at: now
      }
    });
  } catch (err) {
    console.error('File write failed:', err);
    // Cleanup if storage write failed halfway
    if (fs.existsSync(storagePath)) {
      fs.unlinkSync(storagePath);
    }
    return res.status(500).json({ error: 'Failed to securely store document.' });
  }
});

/**
 * GET /api/documents/:id
 * Retrieve document metadata (Content not included)
 */
router.get('/:id', authenticateToken, checkDocumentAccess('read'), (req, res) => {
  const doc = req.document;
  const owner = db.prepare('SELECT id, full_name, email FROM users WHERE id = ?').get(doc.owner_id);

  // Audit view metadata event
  logAction({
    actorId: req.user.id,
    actorEmail: req.user.email,
    actorIp: req.ip || req.connection.remoteAddress,
    action: 'DOCUMENT_VIEW',
    resourceType: 'document',
    resourceId: doc.id,
    status: 'SUCCESS',
    details: { accessReason: req.accessReason }
  });

  res.json({
    document: {
      id: doc.id,
      title: doc.title,
      description: doc.description,
      original_filename: doc.original_filename,
      mime_type: doc.mime_type,
      file_size: doc.file_size,
      category: doc.category,
      owner_id: doc.owner_id,
      owner_name: owner ? owner.full_name : 'Unknown',
      owner_email: owner ? owner.email : 'Unknown',
      created_at: doc.created_at,
      updated_at: doc.updated_at,
      user_permission: req.accessReason === 'OWNER' ? 'owner' : 'granted'
    }
  });
});

/**
 * GET /api/documents/:id/download
 * Secure document byte streaming
 *
 * CRITICAL DEFENSE:
 *   - checkDocumentAccess('read') executes real-time DB check before streaming.
 *   - Downloads are strictly audited with timestamp, actor, and IP.
 *   - Security headers prevent browser code execution.
 */
router.get('/:id/download', authenticateToken, checkDocumentAccess('read'), (req, res) => {
  const doc = req.document;
  const clientIp = req.ip || req.connection.remoteAddress;
  const filePath = path.join(UPLOADS_DIR, doc.storage_key);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Stored document blob is missing on server.' });
  }

  // AUDIT EVERY DOWNLOAD — Non-negotiable requirement #2
  logAction({
    actorId: req.user.id,
    actorEmail: req.user.email,
    actorIp: clientIp,
    action: 'DOCUMENT_DOWNLOAD',
    resourceType: 'document',
    resourceId: doc.id,
    status: 'SUCCESS',
    details: {
      filename: doc.original_filename,
      size: doc.file_size,
      accessReason: req.accessReason,
      userAgent: req.headers['user-agent']
    }
  });

  // Strict headers preventing browser sniffing or direct script execution
  res.setHeader('Content-Type', doc.mime_type || 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(doc.original_filename)}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');

  const fileStream = fs.createReadStream(filePath);
  fileStream.pipe(res);
});

/**
 * PUT /api/documents/:id
 * Edit document metadata (Requires 'edit' permission or owner)
 */
router.put('/:id', authenticateToken, checkDocumentAccess('edit'), (req, res) => {
  const doc = req.document;
  const { title, description, category } = req.body;
  const clientIp = req.ip || req.connection.remoteAddress;

  const newTitle = title !== undefined ? title.trim() : doc.title;
  const newDesc = description !== undefined ? description.trim() : doc.description;
  const newCategory = category !== undefined ? category.trim() : doc.category;
  const now = new Date().toISOString();

  db.prepare(`
    UPDATE documents 
    SET title = ?, description = ?, category = ?, updated_at = ?
    WHERE id = ?
  `).run(newTitle, newDesc, newCategory, now, doc.id);

  logAction({
    actorId: req.user.id,
    actorEmail: req.user.email,
    actorIp: clientIp,
    action: 'DOCUMENT_UPDATE',
    resourceType: 'document',
    resourceId: doc.id,
    status: 'SUCCESS',
    details: {
      old: { title: doc.title, category: doc.category },
      updated: { title: newTitle, category: newCategory }
    }
  });

  res.json({
    message: 'Document updated successfully',
    document: {
      ...doc,
      title: newTitle,
      description: newDesc,
      category: newCategory,
      updated_at: now
    }
  });
});

/**
 * DELETE /api/documents/:id
 * Delete document — ONLY the owner can delete, NOT a viewer or editor
 */
router.delete('/:id', authenticateToken, (req, res) => {
  const documentId = req.params.id;
  const userId = req.user.id;
  const clientIp = req.ip || req.connection.remoteAddress;

  const doc = db.prepare('SELECT * FROM documents WHERE id = ? AND is_deleted = 0').get(documentId);

  if (!doc) {
    return res.status(404).json({ error: 'Document not found' });
  }

  // Only the document owner can delete it
  if (doc.owner_id !== userId) {
    logAction({
      actorId: userId,
      actorEmail: req.user.email,
      actorIp: clientIp,
      action: 'DOCUMENT_DELETE_DENIED',
      resourceType: 'document',
      resourceId: documentId,
      status: 'DENIED',
      details: { reason: 'NON_OWNER_DELETE_ATTEMPT' }
    });
    return res.status(404).json({ error: 'Document not found' });
  }

  const now = new Date().toISOString();

  // Soft delete document
  db.prepare('UPDATE documents SET is_deleted = 1, updated_at = ? WHERE id = ?').run(now, documentId);

  // Revoke all existing access grants immediately
  revokeAllPermissions(documentId, userId);

  // Remove actual physical file from storage
  const filePath = path.join(UPLOADS_DIR, doc.storage_key);
  if (fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
    } catch (e) {
      console.warn('Physical file deletion warning:', e.message);
    }
  }

  logAction({
    actorId: userId,
    actorEmail: req.user.email,
    actorIp: clientIp,
    action: 'DOCUMENT_DELETE',
    resourceType: 'document',
    resourceId: documentId,
    status: 'SUCCESS',
    details: { title: doc.title, filename: doc.original_filename }
  });

  res.json({ message: 'Document deleted successfully' });
});

/**
 * GET /api/documents/:id/activity
 * Get audit trail specifically for this document (Owner or Admin only)
 */
router.get('/:id/activity', authenticateToken, (req, res) => {
  const documentId = req.params.id;
  const userId = req.user.id;
  const isAdmin = req.user.role === 'admin';

  const doc = db.prepare('SELECT owner_id FROM documents WHERE id = ?').get(documentId);
  if (!doc) {
    return res.status(404).json({ error: 'Document not found' });
  }

  // Must be owner or admin
  if (doc.owner_id !== userId && !isAdmin) {
    return res.status(404).json({ error: 'Document not found' });
  }

  const logs = db.prepare(`
    SELECT id, timestamp, actor_id, actor_email, actor_ip, action, status, details 
    FROM audit_logs 
    WHERE resource_id = ? 
    ORDER BY timestamp DESC 
    LIMIT 50
  `).all(documentId);

  res.json({ logs });
});

module.exports = router;
