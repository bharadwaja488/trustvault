/**
 * Database Configuration — SQLite via better-sqlite3
 *
 * WHY SQLite?
 *   Zero-setup, single-file, works on every OS. WAL mode gives us concurrent
 *   readers without blocking the single writer, which is plenty for a
 *   document-vault workload.
 *
 * Security notes:
 *   - The DB file lives under server/data/ which is NOT publicly served.
 *   - A trigger on audit_logs prevents UPDATE and DELETE so the append-only
 *     hash-chain can never be silently tampered with.
 */
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

// Resolve the database path relative to the project root (server/)
const DB_DIR = path.join(__dirname, '..', '..', 'data');
const DB_PATH = path.join(DB_DIR, 'trustvault.db');

// Ensure the data directory exists
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

// Open (or create) the database using Node.js built-in DatabaseSync
const db = new DatabaseSync(DB_PATH);

/**
 * Initialise the schema and apply performance / security pragmas.
 * Safe to call more than once — every CREATE uses IF NOT EXISTS.
 */
function initializeDatabase() {
  // --- Performance & Integrity pragmas ----------------------------------------
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');

  // --- Users -----------------------------------------------------------------
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id          TEXT PRIMARY KEY,
      email       TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      full_name   TEXT NOT NULL,
      role        TEXT NOT NULL DEFAULT 'user'
                    CHECK(role IN ('admin', 'user')),
      is_active   INTEGER NOT NULL DEFAULT 1,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // --- Documents -------------------------------------------------------------
  db.exec(`
    CREATE TABLE IF NOT EXISTS documents (
      id                TEXT PRIMARY KEY,
      title             TEXT NOT NULL,
      description       TEXT,
      original_filename TEXT NOT NULL,
      storage_key       TEXT NOT NULL,
      mime_type         TEXT NOT NULL,
      file_size         INTEGER NOT NULL,
      category          TEXT,
      owner_id          TEXT NOT NULL REFERENCES users(id),
      is_deleted        INTEGER NOT NULL DEFAULT 0,
      created_at        TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // --- Document Grants (per-document access control) -------------------------
  // The UNIQUE partial index guarantees a user can hold at most one *active*
  // grant of each permission type per document.  Revoked grants are kept for
  // the audit trail but excluded from the constraint.
  db.exec(`
    CREATE TABLE IF NOT EXISTS document_grants (
      id          TEXT PRIMARY KEY,
      document_id TEXT NOT NULL REFERENCES documents(id),
      user_id     TEXT NOT NULL REFERENCES users(id),
      permission  TEXT NOT NULL CHECK(permission IN ('read', 'edit')),
      granted_by  TEXT NOT NULL REFERENCES users(id),
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      revoked_at  TEXT
    );
  `);

  // Partial unique index — only one active grant per (doc, user, perm)
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_active_grants
      ON document_grants(document_id, user_id, permission)
      WHERE revoked_at IS NULL;
  `);

  // --- Audit Logs (append-only, hash-chained) --------------------------------
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id            TEXT PRIMARY KEY,
      timestamp     TEXT NOT NULL DEFAULT (datetime('now')),
      actor_id      TEXT,
      actor_email   TEXT,
      actor_ip      TEXT,
      action        TEXT NOT NULL,
      resource_type TEXT,
      resource_id   TEXT,
      status        TEXT NOT NULL CHECK(status IN ('SUCCESS', 'DENIED')),
      details       TEXT,
      previous_hash TEXT,
      record_hash   TEXT NOT NULL
    );
  `);

  // --------------------------------------------------------------------------
  // SECURITY: Prevent UPDATE and DELETE on audit_logs.
  //
  // The hash chain is only trustworthy if records are truly append-only.
  // These triggers make any attempt to modify or remove rows raise an error,
  // even for someone with direct DB access.
  // --------------------------------------------------------------------------
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS prevent_audit_update
      BEFORE UPDATE ON audit_logs
    BEGIN
      SELECT RAISE(ABORT, 'Audit log records are immutable — updates are forbidden');
    END;
  `);

  db.exec(`
    CREATE TRIGGER IF NOT EXISTS prevent_audit_delete
      BEFORE DELETE ON audit_logs
    BEGIN
      SELECT RAISE(ABORT, 'Audit log records are immutable — deletes are forbidden');
    END;
  `);

  // Helpful indexes
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_documents_owner    ON documents(owner_id);
    CREATE INDEX IF NOT EXISTS idx_grants_document    ON document_grants(document_id);
    CREATE INDEX IF NOT EXISTS idx_grants_user        ON document_grants(user_id);
    CREATE INDEX IF NOT EXISTS idx_audit_timestamp    ON audit_logs(timestamp);
    CREATE INDEX IF NOT EXISTS idx_audit_actor        ON audit_logs(actor_id);
    CREATE INDEX IF NOT EXISTS idx_audit_action       ON audit_logs(action);
  `);
}

module.exports = { db, initializeDatabase };
