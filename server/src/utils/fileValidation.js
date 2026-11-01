/**
 * File Validation Utilities
 *
 * Two layers of defense:
 *   1. Magic-byte verification — we read the first bytes of the uploaded
 *      buffer and compare them against known file-type signatures.  This
 *      catches the common attack where someone renames a `.exe` to `.pdf`.
 *   2. Filename sanitisation — strip path separators, null bytes, and control
 *      characters so a malicious filename can never escape the uploads dir.
 *
 * WHY magic bytes instead of trusting Content-Type?
 *   The Content-Type header is set by the client and trivially spoofable.
 *   Magic bytes are embedded in the file content itself and are much harder
 *   to forge while keeping the file functional.
 */

// --------------------------------------------------------------------------
// Allowed MIME types — anything not on this list is rejected outright.
// --------------------------------------------------------------------------
const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/gif',
  'application/zip',
  // Office Open XML formats (all ZIP-based)
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',   // .docx
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',         // .xlsx
  'application/vnd.openxmlformats-officedocument.presentationml.presentation', // .pptx
  'text/plain',
];

// Maximum upload size — 10 MB
const MAX_FILE_SIZE = 10 * 1024 * 1024;

// --------------------------------------------------------------------------
// Magic-byte signatures for each supported binary format.
// --------------------------------------------------------------------------
const MAGIC_BYTES = {
  'application/pdf':  { bytes: [0x25, 0x50, 0x44, 0x46], label: 'PDF (%PDF)' },
  'image/png':        { bytes: [0x89, 0x50, 0x4E, 0x47], label: 'PNG' },
  'image/jpeg':       { bytes: [0xFF, 0xD8, 0xFF],       label: 'JPEG' },
  'image/gif':        { bytes: [0x47, 0x49, 0x46],       label: 'GIF' },
  // ZIP magic covers .zip, .docx, .xlsx, .pptx
  'application/zip':  { bytes: [0x50, 0x4B, 0x03, 0x04], label: 'ZIP/Office' },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document':   { bytes: [0x50, 0x4B, 0x03, 0x04], label: 'DOCX (ZIP)' },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':         { bytes: [0x50, 0x4B, 0x03, 0x04], label: 'XLSX (ZIP)' },
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': { bytes: [0x50, 0x4B, 0x03, 0x04], label: 'PPTX (ZIP)' },
};

/**
 * Detect the actual file type from the buffer's leading bytes.
 *
 * @param {Buffer} buffer
 * @returns {string|null} The detected MIME type, or null for text/unknown.
 */
function detectTypeFromBuffer(buffer) {
  for (const [mime, { bytes }] of Object.entries(MAGIC_BYTES)) {
    if (buffer.length >= bytes.length) {
      const match = bytes.every((b, i) => buffer[i] === b);
      if (match) return mime;
    }
  }
  return null; // No known binary signature — could be text/plain
}

/**
 * Check whether a byte is a non-text binary byte.
 * Bytes 0–8, 14–31 (excluding \t, \n, \r) are considered binary.
 */
function hasBinaryContent(buffer) {
  const sampleSize = Math.min(buffer.length, 8192);
  for (let i = 0; i < sampleSize; i++) {
    const b = buffer[i];
    if (b === 0) return true; // null byte is always binary
    if (b < 0x09) return true;
    if (b > 0x0D && b < 0x20) return true;
  }
  return false;
}

/**
 * Validate an uploaded file by inspecting its actual content.
 *
 * @param {Buffer} buffer          - The raw file buffer
 * @param {string} declaredMimeType - The MIME type claimed by the client
 * @returns {{ valid: boolean, detectedType: string, reason: string }}
 */
function validateFileType(buffer, declaredMimeType) {
  // Check if the declared MIME type is on our allow-list
  if (!ALLOWED_MIME_TYPES.includes(declaredMimeType)) {
    return { valid: false, detectedType: 'unknown', reason: `MIME type '${declaredMimeType}' is not allowed` };
  }

  // For text/plain: allow if no binary content is detected
  if (declaredMimeType === 'text/plain') {
    if (hasBinaryContent(buffer)) {
      return { valid: false, detectedType: 'binary', reason: 'File contains binary content but was declared as text/plain' };
    }
    return { valid: true, detectedType: 'text/plain', reason: 'Validated as text' };
  }

  // For binary types: compare magic bytes against declared type
  const detected = detectTypeFromBuffer(buffer);

  if (!detected) {
    return { valid: false, detectedType: 'unknown', reason: 'File content does not match any allowed binary format' };
  }

  // The declared MIME and the detected MIME must be compatible.
  // Office XML formats all share the ZIP magic, so we group them.
  const zipFamily = [
    'application/zip',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ];

  const declaredIsZip = zipFamily.includes(declaredMimeType);
  const detectedIsZip = zipFamily.includes(detected);

  if (declaredIsZip && detectedIsZip) {
    // Both are in the ZIP family — that's fine
    return { valid: true, detectedType: detected, reason: 'Magic bytes match (ZIP family)' };
  }

  if (detected !== declaredMimeType) {
    return {
      valid: false,
      detectedType: detected,
      reason: `Content mismatch: declared '${declaredMimeType}' but magic bytes indicate '${detected}'`,
    };
  }

  return { valid: true, detectedType: detected, reason: 'Magic bytes match declared type' };
}

/**
 * Sanitise a user-supplied filename to prevent path-traversal attacks.
 *
 * Strips:
 *   - Directory components (everything before the last / or \)
 *   - Parent-directory sequences (..)
 *   - Null bytes and control characters (0x00–0x1F)
 *   - Leading/trailing whitespace and dots (prevents hidden files on Unix)
 *
 * @param {string} filename - The raw filename from the client
 * @returns {string} A safe basename
 */
function sanitizeFilename(filename) {
  if (!filename || typeof filename !== 'string') {
    return 'unnamed_file';
  }

  let safe = filename;

  // Remove null bytes and control characters
  safe = safe.replace(/[\x00-\x1F]/g, '');

  // Extract basename — take only the part after the last / or \
  safe = safe.replace(/^.*[/\\]/, '');

  // Remove parent-directory traversals
  safe = safe.replace(/\.\./g, '');

  // Remove any remaining path separator characters
  safe = safe.replace(/[/\\]/g, '');

  // Strip leading dots and spaces (prevents .htaccess-style hidden files)
  safe = safe.replace(/^[.\s]+/, '');

  // Strip trailing dots and spaces (Windows compatibility)
  safe = safe.replace(/[.\s]+$/, '');

  // If nothing is left, use a safe default
  if (!safe || safe.length === 0) {
    return 'unnamed_file';
  }

  // Truncate excessively long names (filesystem safety)
  if (safe.length > 255) {
    safe = safe.substring(0, 255);
  }

  return safe;
}

module.exports = {
  ALLOWED_MIME_TYPES,
  MAX_FILE_SIZE,
  validateFileType,
  sanitizeFilename,
};
