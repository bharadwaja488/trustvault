# TrustVault — Hackathon Submission Form Answers

> Copy and paste these answers directly into the corresponding text boxes on the **My submission** form at `https://hackathon.snovasys.com/user/submission`.

---

### Project Title
**TrustVault — Zero-Trust Document Sharing Platform with Cryptographic Audit Trails**

### One-Line Description
**A zero-trust confidential document platform featuring real-time server authorization, immediate access revocation, and a tamper-evident SHA-256 hash-chained audit trail.**

---

### Question 1: Where is the authorization decision made when someone downloads a file, and what would happen if that line were removed?

**Answer:**
The authorization decision is made on the server inside `server/src/middleware/authorize.js` within the `checkDocumentAccess('read')` middleware, specifically at line 66:
```javascript
const result = canAccess(req.user.id, documentId, requiredPermission);
```
which delegates to `server/src/services/permissionService.js` at line 33:
```javascript
function canAccess(userId, documentId, requiredPermission) {
  const document = db.prepare('SELECT * FROM documents WHERE id = ? AND is_deleted = 0').get(documentId);
  if (!document) return { allowed: false, reason: 'NOT_FOUND' };
  if (document.owner_id === userId) return { allowed: true, reason: 'OWNER', document };
  const grant = db.prepare(`
    SELECT * FROM document_grants 
    WHERE document_id = ? AND user_id = ? AND permission IN ('read', 'edit') AND revoked_at IS NULL
  `).get(documentId, userId);
  if (grant) return { allowed: true, reason: 'GRANT', document };
  return { allowed: false, reason: 'UNAUTHORIZED' };
}
```
**What would happen if this check were removed:**
If `checkDocumentAccess` were omitted from `/api/documents/:id/download`, the endpoint would suffer from an Insecure Direct Object Reference (IDOR / BOLA) flaw: any authenticated user with a valid JWT could supply any document UUID in the URL and stream the confidential file bytes directly from storage. 

Furthermore, our automated test suite explicitly guards against this: running `npm test` without this line immediately triggers multiple test failures (`Charlie CANNOT download confidential M&A contract`, `Charlie CANNOT download Salary Report`, and `Revoking access immediately blocks downloads`), proving that our automated tests actively validate the presence and correctness of this gate.

---

### Question 2: Explain your permission model in your own words.

**Answer:**
We designed a dual-layer permission model based on the Principle of Least Privilege:

1. **Platform Roles vs. Resource ACL**:
   - `admin`: System-level auditor. Can view platform-wide telemetry, verify cryptographic audit chains, and manage user status. **Crucially, administrators do NOT have automatic access to read or download confidential document files.** This enforces separation of duties and neutralizes insider threats.
   - `user`: Standard employee or external partner who can upload, own, or receive access to documents.

2. **Per-Document Access Control Lists (ACL)**:
   - Rather than folder-based inheritance (which causes accidental over-granting when users add files to shared folders), access is managed strictly per document:
     - `OWNER`: Full administrative control over the document (can view, download, update metadata, grant access, revoke access, and delete).
     - `EDITOR`: Can view, download, and update document content/metadata.
     - `VIEWER`: Read-only streaming access.
     - `NONE`: Default state. Any user without an active grant receives a generic `404 Not Found` response to prevent document enumeration.

---

### Question 3: What does "taking access away immediately" mean in your design, and what does it cost you?

**Answer:**
In TrustVault, "taking access away immediately" means that the moment a document owner revokes a user's grant, any subsequent request from that user—even 1 millisecond later using an unexpired, cryptographically valid JWT—is refused.

**The Design:**
We strictly rejected the conventional pattern of caching user permissions inside JWT claims. While caching permissions in tokens reduces database reads, it introduces a dangerous vulnerability window where a revoked user can continue accessing files until token expiry (typically 15 to 60 minutes). In our architecture, the JWT contains *only* identity claims (`id`, `email`, `role`). Every single request to download or view a file triggers a synchronous SQL query against `document_grants` verifying that `revoked_at IS NULL`. When access is revoked, we set `revoked_at = datetime('now')`.

**What it costs us:**
- **Database I/O**: Every file download performs a sub-millisecond indexed query (`idx_grants_document` and `idx_grants_user`).
- **Statelessness Trade-off**: The authentication layer is stateless, but the authorization layer is stateful. We accepted this cost because in a high-security vault, guaranteeing zero leakage upon access termination is strictly more important than saving a 0.2ms database indexed lookup.

---

### Question 4: How is the audit trail protected against retroactive modification?

**Answer:**
The audit trail is protected through three independent defensive layers:

1. **Cryptographic SHA-256 Hash Chaining**:
   Every log entry's hash is computed across its own fields concatenated with the hash of the immediately preceding record:
   $$\text{record\_hash} = \text{SHA256}(\text{id} + \text{timestamp} + \text{actor\_id} + \text{action} + \text{status} + \text{previous\_hash})$$
   The genesis record begins with `'GENESIS'`. If an attacker or rogue administrator attempts to delete, reorder, or alter any historical record, the entire hash chain downstream is invalidated. Our built-in `verifyChain()` function scans the chain and pinpoints the exact index of any discrepancy.

2. **Database Engine Immutability Triggers**:
   At the SQLite engine level, two triggers (`prevent_audit_update` and `prevent_audit_delete`) intercept any `UPDATE` or `DELETE` SQL operations on the `audit_logs` table and raise an abort exception:
   `'Audit log records are immutable — updates are forbidden'`.

3. **Logging Refused Attempts**:
   Audit systems that only record successful actions are incomplete forensic records. TrustVault logs every refused access attempt (`action: 'ACCESS_DENIED'`, `status: 'DENIED'`) with actor identity, IP address, user agent, and attempted permission.

---

### Question 5: How did you use AI, where was it confident and wrong, and how did you verify it?

**Answer:**
We used AI as an accelerator for boilerplate scaffolding and initial route prototypes, but maintained strict human oversight over security-critical boundaries. We maintained a running `PROMPTS.md` log documenting 7 specific entries where AI produced confident but dangerous security flaws:

1. **Authorization Check Placement**: The AI generated a download route that read the entire file from disk into RAM before checking permissions. This created a Denial of Service vector and timing side-channel. We caught this and refactored the check into a pre-execution middleware returning an opaque 404.
2. **Audit Checksums vs. Hash Chains**: The AI generated an audit logger that hashed each record in isolation. We identified that this allowed silent row deletions without checksum breakage, and replaced it with true recursive hash chaining.
3. **JWT Permission Caching**: The AI attempted to store document grants inside the JWT payload to "optimize database load." We rejected this because it completely breaks the immediate revocation mandate.
4. **MIME Type Spoofing**: The AI validated uploads using `req.file.mimetype` (client-supplied header). We replaced it with magic-byte buffer inspection to detect disguised executables.
5. **Separation of Duties**: The AI gave the `admin` role superuser bypass to download all files. We caught this violation of least privilege and restricted admins to audit metadata only.

All verifications were confirmed through our 19-stage automated security test suite (`server/tests/security.test.js`).

---

### Question 6: What did you choose NOT to build, what gaps remain, and why?

**Answer:**
In accordance with the principle that "a smaller system with a permission model that holds beats a larger one with a hole in it," we deliberately chose not to build:

1. **Folder Hierarchies and Inheritance**: Hierarchical folder inheritance is the #1 source of real-world enterprise permission leaks (e.g., adding a user to view one subfolder accidentally exposes parent documents). Per-document explicit grants provide clear, unambiguous, and auditable access boundaries.
2. **Public Secret Links ("Anyone with this link can view")**: Unauthenticated tokens can be forwarded in email, leaked in Slack, or cached by intermediate proxies, making audit trails legally inadmissible because you cannot prove who actually downloaded the file. Every access in TrustVault requires authenticated identity.
3. **Client-Side End-to-End Encryption (E2EE)**: True client-side E2EE requires complex browser key management (WebCrypto, key rotation, zero-knowledge recovery) that could not be built robustly within 7 days. Instead, we focused on opaque server-side UUID storage and zero-trust proxy streaming.
4. **Known Accepted Gaps**:
   - Single-node SQLite storage (sufficient for thousands of enterprise documents, but would migrate to PostgreSQL + private S3 object storage for multi-region scale).
   - Rate limiting is memory-bound (per-node) rather than distributed Redis-backed.
   - Multi-Factor Authentication (MFA) was deferred in favor of bulletproof authorization and audit mechanics.
