# PROMPTS.md — AI Engineering Audit & Directives Log

> **Challenge Requirement**: Document how AI tools were directed throughout the build of TrustVault, including explicit examples where confident incorrect answers were identified and corrected—specifically in the domains of authorization, access control, and the audit trail.

---

## Entry 1 — 2026-11-01: Authorization Check Placement & TOCTOU Prevention

### What I asked
> "Create the Express route handler for downloading documents: `/api/documents/:id/download`. Read the file from storage and pipe it to the response with correct Content-Disposition headers."

### What the AI produced
```javascript
router.get('/:id/download', authenticateToken, async (req, res) => {
  const doc = await db.getDocument(req.params.id);
  const filePath = path.join(__dirname, '../../uploads', doc.storage_key);
  
  // Read file into memory first
  const fileBuffer = fs.readFileSync(filePath);
  
  // Authorization check performed after reading the file
  const hasAccess = await checkUserPermission(req.user.id, req.params.id);
  if (!hasAccess) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  
  res.setHeader('Content-Type', doc.mime_type);
  res.send(fileBuffer);
});
```

### What was wrong with it
1. **Timing & I/O Waste**: The handler reads the file from disk into RAM *before* verifying if the user has access. On large files, this opens a Denial of Service (DoS) attack where unprivileged users trigger disk thrashing.
2. **Timing Side-Channel**: Measuring response latency would allow an attacker to discern whether a file exists on disk based on disk read time before receiving the 403.
3. **Status Code Leak**: Returning `403 Forbidden` confirms the document exists, enabling document ID enumeration.

### What I did instead
Moved the authorization check into a standalone, synchronous middleware (`checkDocumentAccess('read')`) executed *before* route execution. The route handler only executes if the database query confirms active ownership or grant. If denied, it records the intrusion to the audit log and returns `404 Not Found` (opaque error).
- **Commit Reference**: `4d9f10a` — *refactor(auth): move document ACL check to pre-execution middleware with 404 opaque refusal*

---

## Entry 2 — 2026-11-01: Audit Trail Hash Chain Linkage

### What I asked
> "Implement an audit logger service that hashes each log record with SHA-256 so that it cannot be altered without detection."

### What the AI produced
```javascript
function logAudit(action, actorId, resourceId, status) {
  const id = uuidv4();
  const timestamp = new Date().toISOString();
  
  // Compute SHA-256 of the record fields
  const recordString = `${id}|${timestamp}|${actorId}|${action}|${status}`;
  const hash = crypto.createHash('sha256').update(recordString).digest('hex');
  
  db.prepare(`
    INSERT INTO audit_logs (id, timestamp, actor_id, action, status, record_hash)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, timestamp, actorId, action, status, hash);
}
```

### What was wrong with it
The AI computed an **isolated** checksum for each row. While this detects if someone edits a single row in place (assuming they don't rehash it), it provides **zero protection against record deletion or reordering**. An attacker or corrupt database administrator could simply `DELETE FROM audit_logs WHERE action = 'ACCESS_DENIED'`, and every remaining record would still show a "valid" checksum!

### What I did instead
Implemented a true **cryptographic blockchain/Merkle-style hash chain**:
Each row query fetches the `record_hash` of the immediately preceding record ($N-1$). The current record's hash is computed as:
$$\text{record\_hash} = \text{SHA256}(\text{id} + \text{timestamp} + \text{actor\_id} + \text{action} + \text{status} + \text{previous\_hash})$$
The first entry uses the sentinel `'GENESIS'`. If any row is deleted or modified, every subsequent record's `previous_hash` mismatch invalidates the chain. In addition, I created SQLite database-level triggers (`prevent_audit_update` and `prevent_audit_delete`) to reject `UPDATE` and `DELETE` at the database engine level.
- **Commit Reference**: `8a2e7c1` — *feat(audit): implement recursive SHA-256 hash chaining and DB immutable triggers*

---

## Entry 3 — 2026-11-02: Storing Permissions in JWT Claims (Immediate Revocation Trap)

### What I asked
> "Set up JWT tokens on login so the frontend knows what the user is allowed to do without hitting the database for every action."

### What the AI produced
```javascript
const token = jwt.sign(
  {
    id: user.id,
    email: user.email,
    role: user.role,
    permissions: userGrants.map(g => `${g.document_id}:${g.permission}`)
  },
  process.env.JWT_SECRET,
  { expiresIn: '8h' }
);
```

### What was wrong with it
This breaks Non-Negotiable Standard #3: **"Taking access away works immediately."**
If Alice shares a confidential document with Bob, and 10 minutes later revokes Bob's access in the database, Bob's 8-hour JWT still carries the permission claim. Any endpoint checking `jwt.permissions` would continue to permit downloads for the next 7 hours and 50 minutes.

### What I did instead
Stripped all authorization claims from the JWT. The token contains strictly identity: `{ id, email, role }`.
Every single request touching `/api/documents/:id` runs a real-time database query:
```sql
SELECT permission FROM document_grants 
WHERE document_id = ? AND user_id = ? AND revoked_at IS NULL
```
When an owner clicks "Revoke", the database records `revoked_at = datetime('now')`. The next request 1 millisecond later fails immediately.
- **Commit Reference**: `1f53bb9` — *fix(security): enforce stateless JWT identity and synchronous real-time ACL evaluation*

---

## Entry 4 — 2026-11-02: File Type Validation & MIME Spoofing

### What I asked
> "Write validation middleware for document uploads to ensure only safe formats (PDF, DOCX, TXT, PNG, JPEG) can be uploaded."

### What the AI produced
```javascript
const upload = multer({
  fileFilter: (req, file, cb) => {
    const allowed = ['application/pdf', 'image/png', 'image/jpeg', 'text/plain'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type'));
    }
  }
});
```

### What was wrong with it
The AI relied on `file.mimetype`. The `mimetype` header in a multipart form submission is sent by the HTTP client (browser, curl, or attacker script). An attacker can upload an executable file (`malware.exe`) or an HTML file containing stored XSS (`exploit.html`) and simply send `Content-Type: application/pdf`. Multer accepts it without inspecting the content.

### What I did instead
Built a two-stage validation pipeline:
1. Multer receives file into `memoryStorage()`.
2. `fileValidation.js` inspects the initial **magic bytes** of the binary buffer:
   - PDF must start with `%PDF-` (`0x25, 0x50, 0x44, 0x46`).
   - PNG must start with `0x89, 0x50, 0x4E, 0x47`.
   - DOCX/ZIP must start with `0x50, 0x4B, 0x03, 0x04`.
   - Text files are checked for non-text binary bytes.
If the magic bytes do not match the declared type, the upload is rejected with a `400 Bad Request` and an audit event (`FILE_VALIDATION_FAILED`) is recorded.
- **Commit Reference**: `6c3d982` — *feat(security): add magic-byte buffer inspection for file upload validation*

---

## Entry 5 — 2026-11-03: Filename Sanitization & Path Traversal

### What I asked
> "Save uploaded files to disk so they can be downloaded later with their original name."

### What the AI produced
```javascript
const storage = multer.diskStorage({
  destination: 'uploads/',
  filename: (req, file, cb) => {
    cb(null, file.originalname);
  }
});
```

### What was wrong with it
1. **Path Traversal**: If an attacker sends `originalname = "../../../../windows/system32/cmd.exe"`, the server writes outside the intended folder.
2. **File Overwrite**: Two users uploading `document.pdf` overwrite each other's data.
3. **Public Exposure**: Storing files with their original names under a static web directory makes them accessible without passing through authorization checks.

### What I did instead
1. Decoupled physical storage from original filenames completely. Physical files are stored strictly as `server/uploads/{uuid}.enc`.
2. The user's original filename is sanitized with regex (stripping null bytes, traversal characters, and directory separators) and saved only as metadata in the database.
3. When downloading, the server streams the file from the opaque storage key and sets `Content-Disposition: attachment; filename="{sanitized_name}"` with `X-Content-Type-Options: nosniff`.
- **Commit Reference**: `e201b44` — *fix(storage): enforce UUID-based opaque storage keys and strict filename sanitization*

---

## Entry 6 — 2026-11-04: Separation of Administrative Duties vs. Document Confidentiality

### What I asked
> "Allow administrators to view all documents across the platform so they can manage the system."

### What the AI produced
```javascript
function canAccess(userId, documentId, permission) {
  const user = db.getUser(userId);
  if (user.role === 'admin') {
    return { allowed: true, reason: 'ADMIN_SUPERUSER' };
  }
  // check owner and grants...
}
```

### What was wrong with it
This completely violates the **Principle of Least Privilege** and the confidentiality mandate:
In an enterprise, an administrator manages platform accounts, reviews compliance logs, and monitors system health. They should **not** automatically have read access to executive salary letters, confidential employee disputes, or M&A contracts unless the document owner explicitly grants it.

### What I did instead
Refactored the access model:
- Platform `admin` role grants permission to view platform-wide audit telemetry, verify hash chains, and activate/deactivate accounts.
- Document content (`/api/documents/:id/download`) requires an explicit ACL grant. An administrator who has not been granted access by the owner receives a `404 Not Found` just like any unprivileged user.
- **Commit Reference**: `94f107c` — *refactor(acl): implement separation of duties — admin cannot read document blobs without owner grant*

---

## Reusable Context & Directives Provided to AI Pair Programmer

To prevent common security antipatterns during development, the following instructions were provided at the beginning of each development session:

```text
TRUSTVAULT CORE SECURITY DIRECTIVES:
1. Zero-Trust Access Control: Never assume an authenticated user is authorized. Always verify ownership or active grants via SQLite on the live request.
2. Immediate Revocation: Never store permission sets in JWT tokens. JWT is for identity only.
3. No Information Leakage: Never return 403 on document endpoints; return 404 for both missing and unpermitted documents to prevent IDOR enumeration.
4. Tamper-Evident Auditing: Every state-changing action AND every failed/refused authorization attempt must be written to audit_logs with hash chaining.
5. Ingestion Defense: Always validate binary magic bytes, never rely on Content-Type header alone.
```
