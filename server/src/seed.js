/**
 * Seed Script for TrustVault
 *
 * Populates database with standard personas and sample documents.
 * All accounts use password: Password123!
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
const fs = require('fs');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { db, initializeDatabase } = require('./config/database');
const { logAction } = require('./services/auditService');

const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

function runSeed() {
  console.log('[Seed] Initializing database...');
  initializeDatabase();

  // Clear existing data safely
  db.exec('DELETE FROM document_grants');
  db.exec('DELETE FROM documents');
  db.exec('DELETE FROM users');
  // Note: audit_logs cannot be deleted due to immutable triggers if already created,
  // but if needed in seed we drop and recreate
  try {
    db.exec('DROP TRIGGER IF EXISTS prevent_audit_delete');
    db.exec('DROP TRIGGER IF EXISTS prevent_audit_update');
    db.exec('DELETE FROM audit_logs');
  } catch (e) {
    console.log('[Seed] Re-enabling audit log triggers...');
  }
  initializeDatabase();

  const passwordHash = bcrypt.hashSync('Password123!', 10);
  const now = new Date().toISOString();

  console.log('[Seed] Creating demo users...');
  const users = [
    {
      id: uuidv4(),
      email: 'admin@trustvault.com',
      full_name: 'David Auditor (Admin)',
      role: 'admin'
    },
    {
      id: uuidv4(),
      email: 'alice@trustvault.com',
      full_name: 'Alice Johnson (Executive Owner)',
      role: 'user'
    },
    {
      id: uuidv4(),
      email: 'bob@trustvault.com',
      full_name: 'Bob Smith (Authorized Viewer)',
      role: 'user'
    },
    {
      id: uuidv4(),
      email: 'charlie@trustvault.com',
      full_name: 'Charlie Brown (Intruder/Pen-Tester)',
      role: 'user'
    }
  ];

  for (const u of users) {
    db.prepare(`
      INSERT INTO users (id, email, password_hash, full_name, role, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, ?, ?)
    `).run(u.id, u.email, passwordHash, u.full_name, u.role, now, now);

    logAction({
      actorId: 'SYSTEM',
      actorEmail: 'system@trustvault.local',
      actorIp: '127.0.0.1',
      action: 'USER_CREATED',
      resourceType: 'user',
      resourceId: u.id,
      status: 'SUCCESS',
      details: { email: u.email, role: u.role }
    });
  }

  const [admin, alice, bob, charlie] = users;

  console.log('[Seed] Creating sample confidential documents...');

  // Helper to create a dummy valid PDF buffer
  function createPdfBuffer(title) {
    const header = Buffer.from('%PDF-1.5\n');
    const body = Buffer.from(`1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n` +
      `2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n` +
      `3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >> endobj\n` +
      `4 0 obj << /Length 55 >> stream\nBT /F1 24 Tf 100 700 Td (${title}) Tj ET\nendstream endobj\nxref\n0 5\n0000000000 65535 f \n` +
      `trailer << /Root 1 0 R >>\nstartxref\n350\n%%EOF\n`);
    return Buffer.concat([header, body]);
  }

  // Helper to create a dummy text buffer
  function createTextBuffer(content) {
    return Buffer.from(content, 'utf-8');
  }

  const sampleDocs = [
    {
      id: uuidv4(),
      title: 'Q4 2026 Executive Salary & Compensation Report',
      description: 'Confidential executive payroll breakdown and performance bonuses.',
      original_filename: 'Q4-2026-Executive-Salary-Report.pdf',
      mime_type: 'application/pdf',
      category: 'HR',
      owner_id: alice.id,
      buffer: createPdfBuffer('Confidential Executive Salary Report')
    },
    {
      id: uuidv4(),
      title: 'Merger & Acquisition Term Sheet - Project Titan',
      description: 'Strictly confidential M&A acquisition agreement terms with Acme Corp.',
      original_filename: 'Project-Titan-Acquisition-Termsheet.pdf',
      mime_type: 'application/pdf',
      category: 'Legal',
      owner_id: alice.id,
      buffer: createPdfBuffer('Strictly Confidential MA Termsheet')
    },
    {
      id: uuidv4(),
      title: 'Production Database Infrastructure & Security Keys',
      description: 'Disaster recovery runbook and KMS key rotation procedures.',
      original_filename: 'Infrastructure-Security-Runbook.txt',
      mime_type: 'text/plain',
      category: 'Engineering',
      owner_id: alice.id,
      buffer: createTextBuffer('TRUSTVAULT SECURE RUNBOOK\n========================\n1. Rotate master encryption keys every 90 days.\n2. Audit chain must be verified daily.')
    },
    {
      id: uuidv4(),
      title: '2026 Marketing Strategy & Brand Expansion Budget',
      description: 'Departmental budget allocations and paid media channel expenditure.',
      original_filename: '2026-Marketing-Strategy.txt',
      mime_type: 'text/plain',
      category: 'Marketing',
      owner_id: bob.id,
      buffer: createTextBuffer('Marketing Budget 2026: Approved spend $1.2M across digital search and enterprise security summits.')
    }
  ];

  for (const doc of sampleDocs) {
    const storageKey = `${doc.id}.enc`;
    fs.writeFileSync(path.join(UPLOADS_DIR, storageKey), doc.buffer);

    db.prepare(`
      INSERT INTO documents 
        (id, title, description, original_filename, storage_key, mime_type, file_size, category, owner_id, is_deleted, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
    `).run(
      doc.id,
      doc.title,
      doc.description,
      doc.original_filename,
      storageKey,
      doc.mime_type,
      doc.buffer.length,
      doc.category,
      doc.owner_id,
      now,
      now
    );

    logAction({
      actorId: doc.owner_id,
      actorEmail: doc.owner_id === alice.id ? alice.email : bob.email,
      actorIp: '127.0.0.1',
      action: 'DOCUMENT_UPLOAD',
      resourceType: 'document',
      resourceId: doc.id,
      status: 'SUCCESS',
      details: { title: doc.title, filename: doc.original_filename, category: doc.category }
    });
  }

  const [salaryDoc, maDoc, infraDoc, mktgDoc] = sampleDocs;

  console.log('[Seed] Setting up permission grants...');
  // Grant 1: Alice shares Salary Report with Bob (read permission)
  const grant1Id = uuidv4();
  db.prepare(`
    INSERT INTO document_grants (id, document_id, user_id, permission, granted_by, created_at)
    VALUES (?, ?, ?, 'read', ?, ?)
  `).run(grant1Id, salaryDoc.id, bob.id, alice.id, now);

  logAction({
    actorId: alice.id,
    actorEmail: alice.email,
    actorIp: '127.0.0.1',
    action: 'PERMISSION_GRANTED',
    resourceType: 'document',
    resourceId: salaryDoc.id,
    status: 'SUCCESS',
    details: { targetUserId: bob.id, targetEmail: bob.email, permission: 'read' }
  });

  // Grant 2: Alice shares Infrastructure Keys with Bob (edit permission)
  const grant2Id = uuidv4();
  db.prepare(`
    INSERT INTO document_grants (id, document_id, user_id, permission, granted_by, created_at)
    VALUES (?, ?, ?, 'edit', ?, ?)
  `).run(grant2Id, infraDoc.id, bob.id, alice.id, now);

  logAction({
    actorId: alice.id,
    actorEmail: alice.email,
    actorIp: '127.0.0.1',
    action: 'PERMISSION_GRANTED',
    resourceType: 'document',
    resourceId: infraDoc.id,
    status: 'SUCCESS',
    details: { targetUserId: bob.id, targetEmail: bob.email, permission: 'edit' }
  });

  // Notice:
  // - maDoc has NO GRANTS. Only Alice can open it!
  // - Charlie has ZERO GRANTS to any of Alice's documents!
  // If Charlie tries to download salaryDoc or maDoc, he must get 404 and DENIED logged.

  console.log('[Seed] Finished! Seed data summary:');
  console.log('----------------------------------------------------');
  console.log('1. Admin:   admin@trustvault.com   / Password123!');
  console.log('2. Owner:   alice@trustvault.com   / Password123!');
  console.log('3. Viewer:  bob@trustvault.com     / Password123!');
  console.log('4. Intruder charlie@trustvault.com / Password123!');
  console.log('----------------------------------------------------');
}

if (require.main === module) {
  runSeed();
}

module.exports = { runSeed };
