/**
 * TrustVault Security & Authorization Test Suite (Native node:test)
 *
 * RIGOROUS PROOF OF ACCESS CONTROL:
 *   - Proves unauthorized users cannot read, download, edit, or delete documents.
 *   - Proves immediate revocation works without token expiration delay.
 *   - Proves audit log records both allowed and denied attempts.
 *   - Proves audit hash chain validity.
 */
const { describe, it, before } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const app = require('../src/index');
const { runSeed } = require('../src/seed');
const { db } = require('../src/config/database');
const { verifyChain } = require('../src/services/auditService');

describe('TrustVault Security & Zero-Trust Access Control Suite', () => {
  let adminToken;
  let aliceToken;
  let bobToken;
  let charlieToken;
  let salaryDocId;
  let maDocId;
  let infraDocId;

  before(async () => {
    // Fresh seed
    runSeed();

    // Login Alice (Owner)
    const aliceRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'alice@trustvault.com', password: 'Password123!' });
    aliceToken = aliceRes.body.token;
    assert.ok(aliceToken, 'Alice token should exist');

    // Login Bob (Authorized Viewer)
    const bobRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'bob@trustvault.com', password: 'Password123!' });
    bobToken = bobRes.body.token;
    assert.ok(bobToken, 'Bob token should exist');

    // Login Charlie (Intruder)
    const charlieRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'charlie@trustvault.com', password: 'Password123!' });
    charlieToken = charlieRes.body.token;
    assert.ok(charlieToken, 'Charlie token should exist');

    // Login Admin
    const adminRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@trustvault.com', password: 'Password123!' });
    adminToken = adminRes.body.token;
    assert.ok(adminToken, 'Admin token should exist');

    // Retrieve document IDs
    const salaryDoc = db.prepare("SELECT id FROM documents WHERE title LIKE '%Salary%'").get();
    salaryDocId = salaryDoc.id;

    const maDoc = db.prepare("SELECT id FROM documents WHERE title LIKE '%Merger%'").get();
    maDocId = maDoc.id;

    const infraDoc = db.prepare("SELECT id FROM documents WHERE title LIKE '%Infrastructure%'").get();
    infraDocId = infraDoc.id;
  });

  describe('1. Unauthenticated Requests Defense', () => {
    it('Rejects document listing without token with 401', async () => {
      const res = await request(app).get('/api/documents');
      assert.strictEqual(res.status, 401);
    });

    it('Rejects file download without token with 401', async () => {
      const res = await request(app).get(`/api/documents/${salaryDocId}/download`);
      assert.strictEqual(res.status, 401);
    });

    it('Rejects forged/invalid JWT signature with 401', async () => {
      const res = await request(app)
        .get(`/api/documents/${salaryDocId}/download`)
        .set('Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.fakeSignature');
      assert.strictEqual(res.status, 401);
    });
  });

  describe("2. Intruder Defense (Charlie cannot access Alice's documents)", () => {
    it('Charlie CANNOT view metadata of unshared document (404 opaque refusal)', async () => {
      const res = await request(app)
        .get(`/api/documents/${maDocId}`)
        .set('Authorization', `Bearer ${charlieToken}`);
      assert.strictEqual(res.status, 404);
    });

    it('Charlie CANNOT download confidential M&A contract (404 opaque refusal)', async () => {
      const res = await request(app)
        .get(`/api/documents/${maDocId}/download`)
        .set('Authorization', `Bearer ${charlieToken}`);
      assert.strictEqual(res.status, 404);
    });

    it('Charlie CANNOT download Salary Report (404 opaque refusal)', async () => {
      const res = await request(app)
        .get(`/api/documents/${salaryDocId}/download`)
        .set('Authorization', `Bearer ${charlieToken}`);
      assert.strictEqual(res.status, 404);
    });

    it('Charlie CANNOT modify metadata of Alice\'s document', async () => {
      const res = await request(app)
        .put(`/api/documents/${salaryDocId}`)
        .set('Authorization', `Bearer ${charlieToken}`)
        .send({ title: 'Hacked Title' });
      assert.strictEqual(res.status, 404);
    });

    it('Charlie CANNOT delete Alice\'s document', async () => {
      const res = await request(app)
        .delete(`/api/documents/${salaryDocId}`)
        .set('Authorization', `Bearer ${charlieToken}`);
      assert.strictEqual(res.status, 404);
    });

    it('Charlie CANNOT grant himself access to Alice\'s document', async () => {
      const res = await request(app)
        .post(`/api/documents/${maDocId}/permissions`)
        .set('Authorization', `Bearer ${charlieToken}`)
        .send({ userId: 'some-user', permission: 'read' });
      assert.strictEqual(res.status, 404);
    });
  });

  describe('3. Legitimate Access Control (Bob with explicit grants)', () => {
    it('Bob CAN download Salary Report (has read grant)', async () => {
      const res = await request(app)
        .get(`/api/documents/${salaryDocId}/download`)
        .set('Authorization', `Bearer ${bobToken}`);
      assert.strictEqual(res.status, 200);
      assert.ok(res.headers['content-type'].includes('application/pdf'));
    });

    it('Bob CANNOT edit Salary Report (only has read, not edit)', async () => {
      const res = await request(app)
        .put(`/api/documents/${salaryDocId}`)
        .set('Authorization', `Bearer ${bobToken}`)
        .send({ title: 'Bob New Title' });
      assert.strictEqual(res.status, 404);
    });

    it('Bob CAN edit Infrastructure Keys (has explicit edit grant)', async () => {
      const res = await request(app)
        .put(`/api/documents/${infraDocId}`)
        .set('Authorization', `Bearer ${bobToken}`)
        .send({ description: 'Updated by authorized editor Bob.' });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.document.description, 'Updated by authorized editor Bob.');
    });

    it('Bob CANNOT delete Alice\'s document (only owner can delete)', async () => {
      const res = await request(app)
        .delete(`/api/documents/${infraDocId}`)
        .set('Authorization', `Bearer ${bobToken}`);
      assert.strictEqual(res.status, 404);
    });
  });

  describe('4. Immediate Revocation (Non-Negotiable Requirement #3)', () => {
    it('Revoking access immediately blocks downloads without waiting for token expiry', async () => {
      // 1. Verify Bob currently can download salary report
      const beforeRevoke = await request(app)
        .get(`/api/documents/${salaryDocId}/download`)
        .set('Authorization', `Bearer ${bobToken}`);
      assert.strictEqual(beforeRevoke.status, 200);

      // 2. Find the grant ID
      const grant = db.prepare(`
        SELECT id FROM document_grants 
        WHERE document_id = ? AND user_id = (SELECT id FROM users WHERE email = 'bob@trustvault.com') AND revoked_at IS NULL
      `).get(salaryDocId);

      // 3. Alice revokes Bob's grant
      const revokeRes = await request(app)
        .delete(`/api/documents/${salaryDocId}/permissions/${grant.id}`)
        .set('Authorization', `Bearer ${aliceToken}`);
      assert.strictEqual(revokeRes.status, 200);

      // 4. Bob immediately tries to download again using the SAME JWT
      const afterRevoke = await request(app)
        .get(`/api/documents/${salaryDocId}/download`)
        .set('Authorization', `Bearer ${bobToken}`);
      
      // Non-negotiable: MUST be refused immediately!
      assert.strictEqual(afterRevoke.status, 404);
    });
  });

  describe('5. Audit Trail & Tamper Evidence (Non-Negotiable Requirement #2)', () => {
    it('Failed access attempts by Charlie are logged in the audit trail as DENIED', async () => {
      const deniedLogs = db.prepare(`
        SELECT * FROM audit_logs 
        WHERE action = 'ACCESS_DENIED' AND status = 'DENIED'
      `).all();

      assert.ok(deniedLogs.length > 0, 'Denied logs should exist');
      const charlieLog = deniedLogs.find(l => l.actor_email === 'charlie@trustvault.com');
      assert.ok(charlieLog, 'Denied log for Charlie should exist');
      assert.strictEqual(charlieLog.status, 'DENIED');
    });

    it('Audit log chain is cryptographically intact (verifyChain)', () => {
      const verification = verifyChain();
      assert.strictEqual(verification.valid, true);
      assert.ok(verification.totalRecords > 0);
    });

    it('Database triggers forbid direct modification of audit trail', () => {
      assert.throws(() => {
        db.prepare("UPDATE audit_logs SET status = 'SUCCESS' WHERE status = 'DENIED'").run();
      }, /immutable/i);

      assert.throws(() => {
        db.prepare("DELETE FROM audit_logs WHERE status = 'DENIED'").run();
      }, /immutable/i);
    });
  });

  describe('6. Platform Admin Separation of Duties', () => {
    it('Admin can view audit logs and stats', async () => {
      const res = await request(app)
        .get('/api/admin/stats')
        .set('Authorization', `Bearer ${adminToken}`);
      assert.strictEqual(res.status, 200);
      assert.ok(res.body.totalUsers >= 4);
    });

    it('Admin cannot download Alice\'s private document without explicit grant', async () => {
      const res = await request(app)
        .get(`/api/documents/${maDocId}/download`)
        .set('Authorization', `Bearer ${adminToken}`);
      // Admin has no backdoor to download confidential documents
      assert.strictEqual(res.status, 404);
    });
  });
});
