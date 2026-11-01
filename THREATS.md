# TrustVault — Threat Model

> This document identifies the security threats considered during the design and implementation of TrustVault, a secure document sharing platform. For each threat, we describe the attack vector, its severity, the mitigations we applied, the automated test coverage in place, and any residual risk we consciously accept.

---

## 1. Insecure Direct Object Reference (IDOR)

| Field | Detail |
|---|---|
| **Threat** | An attacker guesses or enumerates document UUIDs in the URL (e.g., `/api/documents/:id/download`) and accesses documents they are not authorized to view. |
| **Severity** | **Critical** |
| **Mitigation** | Every document endpoint calls `permissionService.canAccess(userId, documentId, requiredRole)` before any I/O. Documents are stored on disk using randomly generated UUIDs (v4), making enumeration infeasible. The UUID is never derived from sequential IDs or predictable values. |
| **Test Coverage** | `tests/security/idor.test.js` — Authenticated user attempts to access a document they have no ACL entry for; expects 404. |
| **Accepted Risk** | None. Server-side access control is the primary gate, and UUID randomness provides defence in depth. |

---

## 2. Broken Object-Level Authorization (BOLA)

| Field | Detail |
|---|---|
| **Threat** | An authenticated user manipulates API parameters (document ID, user ID) to access or modify another user's documents through legitimate API calls. |
| **Severity** | **Critical** |
| **Mitigation** | `permissionService.canAccess()` checks the *requesting* user's identity (from the verified JWT `id` claim) against the per-document ACL stored in the database on every single request. The user ID is never taken from the request body or query string — only from the validated token. |
| **Test Coverage** | `tests/security/bola.test.js` — User A creates a document, User B (authenticated) attempts GET, PATCH, and DELETE on it; all return 404. |
| **Accepted Risk** | None. |

---

## 3. Token Replay After Access Revocation

| Field | Detail |
|---|---|
| **Threat** | A user's JWT is still valid (not expired) after a document owner revokes their access. The revoked user replays the token to download the document before the token expires. |
| **Severity** | **High** |
| **Mitigation** | The JWT carries **only** identity claims (`{ id, email, role }`). It does **not** contain document permissions. Every request triggers a real-time database lookup via `permissionService.canAccess()`, so permission revocations take effect immediately — not at token expiry. |
| **Test Coverage** | `tests/security/revocation.test.js` — Grant access → verify download succeeds → revoke access → verify download returns 404, all within one test using the same JWT. |
| **Accepted Risk** | None. Permissions are never cached in the token. |

---

## 4. Path Traversal in File Upload

| Field | Detail |
|---|---|
| **Threat** | An attacker crafts a malicious filename like `../../etc/passwd` or `..\..\windows\system32\config\sam` in the `Content-Disposition` header to overwrite arbitrary files on the server. |
| **Severity** | **Critical** |
| **Mitigation** | Uploaded files are **never stored under their original filename**. Each upload is assigned a random UUID (v4), and the file is saved as `uploads/<uuid>` with no extension. The original filename is stored only in the database metadata column. The `path.basename()` function is applied to the original filename before storage as an additional safeguard, stripping any directory traversal sequences. |
| **Test Coverage** | `tests/security/path-traversal.test.js` — Upload with filename `../../etc/passwd`; verify the file is stored under a UUID name inside the uploads directory and no file is created outside it. |
| **Accepted Risk** | None. The original filename never influences the storage path. |

---

## 5. MIME Type Spoofing / XSS via File Upload

| Field | Detail |
|---|---|
| **Threat** | An attacker uploads an HTML or SVG file with a `Content-Type` of `application/pdf`. If the server serves the file inline, the browser executes embedded JavaScript, enabling stored XSS. |
| **Severity** | **High** |
| **Mitigation** | **Magic byte validation**: The upload handler reads the first 8 bytes of the file buffer and compares them against known file signatures (PDF `%PDF`, PNG `\x89PNG`, JPEG `\xFF\xD8\xFF`, DOCX/XLSX PK header). Files whose magic bytes don't match an allowed type are rejected, regardless of the declared MIME type. Additionally, download responses set `Content-Disposition: attachment` (never `inline`) and `X-Content-Type-Options: nosniff` via Helmet, preventing browser-side content sniffing. |
| **Test Coverage** | `tests/security/mime-spoofing.test.js` — Upload an HTML file with `mimetype: application/pdf`; expect 400 rejection. Upload a valid PDF; expect 201 success. |
| **Accepted Risk** | Magic byte validation covers common types but is not exhaustive for all formats. Polyglot files that start with valid PDF bytes but contain embedded HTML are theoretically possible but extremely unlikely to execute with `nosniff` and `attachment` disposition headers. |

---

## 6. Audit Log Tampering

| Field | Detail |
|---|---|
| **Threat** | An attacker (or a compromised admin) modifies or deletes audit log records to cover their tracks — e.g., deleting the record that shows they downloaded a confidential document. |
| **Severity** | **Critical** |
| **Mitigation** | Audit logs use a **SHA-256 hash chain**. Each log record's `integrity_hash` is computed as `SHA-256(event_type + actor_id + document_id + action + timestamp + previous_hash)`. The genesis record uses `'GENESIS'` as its `previous_hash`. A SQLite trigger (`BEFORE UPDATE` and `BEFORE DELETE` on the `audit_logs` table) prevents any modification or deletion of existing records — the trigger raises an error and aborts the transaction. |
| **Test Coverage** | `tests/security/audit-integrity.test.js` — Insert three audit records, verify the hash chain. Attempt `UPDATE` on a record; expect SQLite error. Attempt `DELETE`; expect SQLite error. Verify chain integrity after attempted tampering. |
| **Accepted Risk** | A sufficiently privileged attacker with direct filesystem access to the SQLite database file could bypass triggers by modifying the file at the byte level. This is accepted because such an attacker already has OS-level control. In production, database files should be on encrypted volumes with restricted filesystem permissions. |

---

## 7. SQL Injection

| Field | Detail |
|---|---|
| **Threat** | Malicious input in search queries, filter parameters, or any user-supplied data is interpolated into SQL strings, allowing arbitrary query execution (e.g., `'; DROP TABLE documents; --`). |
| **Severity** | **Critical** |
| **Mitigation** | All database queries use **parameterized statements** via `better-sqlite3`'s built-in parameter binding. User input is always passed as `?` placeholders: `db.prepare('SELECT * FROM documents WHERE title LIKE ?').all(`%${search}%`)`. No string concatenation or template interpolation is used in any SQL statement. |
| **Test Coverage** | `tests/security/sql-injection.test.js` — Search with payloads including `'; DROP TABLE documents; --`, `1 OR 1=1`, and `UNION SELECT` variations; verify the application returns normal results (or empty sets) and that all tables remain intact. |
| **Accepted Risk** | None. `better-sqlite3` uses parameterized queries by default when using the `?` placeholder syntax. |

---

## 8. Brute Force Login

| Field | Detail |
|---|---|
| **Threat** | An attacker uses automated tools to rapidly guess user passwords on the `/api/auth/login` endpoint. |
| **Severity** | **High** |
| **Mitigation** | **Rate limiting** is applied to authentication endpoints (`/api/auth/login`, `/api/auth/register`) using `express-rate-limit`. Configuration: 5 requests per 15-minute window per IP. After exceeding the limit, the server returns `429 Too Many Requests`. Passwords are hashed with **bcrypt** (cost factor 12), making offline brute force after a database compromise computationally expensive. |
| **Test Coverage** | `tests/security/rate-limit.test.js` — Send 6 login requests in rapid succession; verify the 6th receives a 429 response. |
| **Accepted Risk** | IP-based rate limiting can be bypassed by distributed attacks from many IPs or via proxy rotation. A production deployment should add CAPTCHA or account lockout. Noted as a known limitation. |

---

## 9. JWT Secret Weakness

| Field | Detail |
|---|---|
| **Threat** | The JWT signing secret is weak, default, or hardcoded (e.g., `"secret"`, `"changeme"`), allowing an attacker to forge valid tokens. |
| **Severity** | **Critical** |
| **Mitigation** | The JWT secret is loaded from the `JWT_SECRET` environment variable. The application **refuses to start** if `JWT_SECRET` is not set or is shorter than 32 characters. The `.env.example` file contains a placeholder value `CHANGE_ME_TO_A_RANDOM_SECRET` and a comment explaining the requirement. The seeding script generates a cryptographically random 64-character hex string for development. |
| **Test Coverage** | `tests/security/jwt-secret.test.js` — Verify that server initialization throws an error when `JWT_SECRET` is unset or fewer than 32 characters. Verify that a token signed with an incorrect secret is rejected with 401. |
| **Accepted Risk** | If a deployer ignores the validation and patches the startup check, they could use a weak secret. We can't prevent this, but we make it hard to do accidentally. |

---

## 10. Privilege Escalation

| Field | Detail |
|---|---|
| **Threat** | A viewer-role user modifies their request payload (e.g., sends `{ "role": "admin" }` in a profile update or tampers with the JWT) to escalate their platform role or per-document access level. |
| **Severity** | **Critical** |
| **Mitigation** | Platform roles (`admin`, `user`) are stored in the database and can only be changed by an admin through a dedicated admin endpoint with role verification middleware. The JWT is signed and verified on every request — any tampering invalidates the signature. Per-document ACL can only be modified by the document **owner** through `permissionService.grantAccess()` and `permissionService.revokeAccess()`, both of which verify ownership before executing. User-supplied `role` fields in request bodies are explicitly stripped/ignored by all non-admin endpoints. |
| **Test Coverage** | `tests/security/privilege-escalation.test.js` — Regular user sends PATCH to change own role to admin; verify 403. Viewer sends PATCH to grant themselves editor access to a document; verify 404. Tampered JWT with modified role claim; verify 401. |
| **Accepted Risk** | None. Role changes require server-side verification of the caller's current role. |

---

## 11. Enumeration Attacks

| Field | Detail |
|---|---|
| **Threat** | An attacker probes document IDs and distinguishes between "document exists but I'm forbidden" (403) and "document doesn't exist" (404). A 403 response confirms the document exists, enabling enumeration of valid document IDs. |
| **Severity** | **Medium** |
| **Mitigation** | All document endpoints return a **uniform 404** response (`{ "error": "Document not found" }`) for both non-existent documents and documents the user is not authorized to access. The response body, status code, and headers are identical in both cases. Timing differences are minimized by performing the permission check with a single database query that joins the documents and permissions tables, returning the same query time regardless of outcome. |
| **Test Coverage** | `tests/security/enumeration.test.js` — Request a non-existent document UUID and an existing document the user cannot access; verify both return identical 404 responses with the same body structure. |
| **Accepted Risk** | Extremely subtle timing side-channels may still exist at the microsecond level. This is accepted as infeasible to exploit in practice over a network. |

---

## 12. Session Fixation / Token Theft

| Field | Detail |
|---|---|
| **Threat** | An attacker steals a user's JWT (via XSS, network sniffing, or physical access) and replays it from a different device or IP address. |
| **Severity** | **High** |
| **Mitigation** | JWTs have a short expiration time (1 hour for the hackathon demo, configurable via `JWT_EXPIRY` env var). Tokens are stored in `httpOnly`, `secure`, `sameSite: strict` cookies, preventing JavaScript access (mitigating XSS-based theft). Helmet middleware sets security headers including `X-Content-Type-Options`, `X-Frame-Options`, and `Strict-Transport-Security` to reduce attack surface. HTTPS is enforced in production. |
| **Test Coverage** | `tests/security/token-security.test.js` — Verify that the `Set-Cookie` header includes `HttpOnly`, `Secure`, and `SameSite=Strict` flags. Verify that expired tokens are rejected with 401. |
| **Accepted Risk** | No IP binding is implemented — a stolen token is valid from any IP until expiration. IP binding was considered but rejected because it breaks legitimate use behind mobile networks and VPNs. This is noted as a known limitation. |

---

## 13. Denial of Service via Large File Uploads

| Field | Detail |
|---|---|
| **Threat** | An attacker uploads extremely large files to exhaust server disk space, or sends many concurrent uploads to overwhelm server resources. |
| **Severity** | **Medium** |
| **Mitigation** | `multer` is configured with a **10 MB file size limit** (`limits: { fileSize: 10 * 1024 * 1024 }`). Uploads exceeding this limit receive a 400 response before the full file is buffered. Rate limiting on upload endpoints (10 uploads per 15-minute window per user) prevents rapid-fire uploads. Only authenticated users can upload, so anonymous flooding is not possible. |
| **Test Coverage** | `tests/security/upload-limits.test.js` — Attempt to upload an 11 MB file; expect 400. Attempt 11 uploads in sequence; expect the 11th to receive 429. |
| **Accepted Risk** | A coordinated attack from many authenticated accounts could still fill disk. In production, per-user storage quotas and external storage (S3/GCS) should be used. For the hackathon demo, the 10 MB limit and rate limiting provide reasonable protection. |

---

## 14. Deleted Document Access

| Field | Detail |
|---|---|
| **Threat** | A soft-deleted document (marked as `deleted_at IS NOT NULL`) remains accessible through the API if the deletion flag is not checked on read operations. |
| **Severity** | **High** |
| **Mitigation** | All document query functions include a `WHERE deleted_at IS NULL` clause. The `permissionService.canAccess()` function checks this flag as part of its query — if the document is soft-deleted, it is treated as non-existent and returns the uniform 404 response. Document file content remains on disk (for potential recovery by a system administrator) but is inaccessible through any API endpoint. |
| **Test Coverage** | `tests/security/soft-delete.test.js` — Create and soft-delete a document. Attempt to access via GET, PATCH, and download endpoints; verify all return 404. Verify the file still exists on disk (for recovery purposes). Verify the audit log records the deletion event. |
| **Accepted Risk** | File content remains on disk after soft-deletion. A background job to purge files after a retention period would be appropriate in production but is beyond hackathon scope. |

---

## 15. Cross-Site Request Forgery (CSRF)

| Field | Detail |
|---|---|
| **Threat** | An attacker tricks an authenticated user into making unintended state-changing requests (e.g., revoking their own access, deleting a document) by embedding forged requests in a malicious page. |
| **Severity** | **Medium** |
| **Mitigation** | Authentication cookies are set with `sameSite: 'strict'`, preventing the browser from sending them on cross-origin requests. The API accepts only `Content-Type: application/json` for state-changing operations, which cannot be triggered by HTML forms (forms can only send `application/x-www-form-urlencoded` or `multipart/form-data`). Helmet's security headers add further defence. |
| **Test Coverage** | `tests/security/csrf.test.js` — Verify that `SameSite=Strict` is set on auth cookies. Verify that POST requests with `Content-Type: application/x-www-form-urlencoded` are rejected with 415 Unsupported Media Type. |
| **Accepted Risk** | None for browser-based attacks. API-to-API CSRF is not applicable since tokens are required. |

---

## 16. Response Data Leakage

| Field | Detail |
|---|---|
| **Threat** | API responses inadvertently include sensitive fields — password hashes, internal database IDs, server paths, or debug information — that could aid further attacks. |
| **Severity** | **Medium** |
| **Mitigation** | All API responses pass through serialization functions that explicitly select which fields to include (allowlist approach) rather than excluding sensitive ones (denylist). The `userSerializer` returns only `{ id, email, role, createdAt }` — never `password_hash`. The `documentSerializer` returns only `{ id, title, mimeType, size, createdAt, updatedAt }` — never `file_path` or `storage_key`. Error responses in production use generic messages; stack traces are only included when `NODE_ENV=development`. |
| **Test Coverage** | `tests/security/data-leakage.test.js` — Fetch user profile and document metadata; verify response bodies do not contain `password_hash`, `file_path`, `storage_key`, or `internal_id` fields. Verify error responses do not contain stack traces when `NODE_ENV=production`. |
| **Accepted Risk** | None. Allowlist serialization ensures new database columns are not automatically exposed. |

---

## 17. Race Condition in Permission Revocation

| Field | Detail |
|---|---|
| **Threat** | A user begins downloading a document, and simultaneously the owner revokes their access. Due to a race condition, the download completes despite the revocation. |
| **Severity** | **Medium** |
| **Mitigation** | The `checkDocumentAccess()` middleware performs the permission check **before** any file I/O. The file read stream is only opened after authorization succeeds. Because SQLite operations are serialized (SQLite uses a single-writer model), the permission check and the revocation cannot interleave at the database level — one completes fully before the other begins. If revocation commits first, the download check sees the updated state and rejects. If the download check passes first, the file streams to completion for that single request (which is correct — the user was authorized when the request was validated). |
| **Test Coverage** | `tests/security/race-condition.test.js` — Concurrent requests: one revoking access and one downloading. Run 100 iterations; verify no download succeeds after its corresponding revocation has committed. |
| **Accepted Risk** | A download that begins before revocation commits will complete. This is accepted as correct behavior — the user was authorized at the time of the check. The window is measured in milliseconds for SQLite. |

---

## 18. Log Injection

| Field | Detail |
|---|---|
| **Threat** | An attacker includes malicious content in fields that end up in audit logs — for example, a document name containing newlines, ANSI escape codes, or fake log entries. This can corrupt log parsing, inject false entries, or exploit log viewers (e.g., terminal escape sequences). |
| **Severity** | **Medium** |
| **Mitigation** | All user-supplied values written to audit logs are **sanitized** before insertion: newlines (`\n`, `\r`) are replaced with spaces, control characters (ASCII 0–31) are stripped, and string length is capped at 500 characters. The audit log fields are stored in dedicated database columns with parameterized queries (preventing SQL injection within the log itself). The hash chain integrity means any modification to sanitized values would be detected. |
| **Test Coverage** | `tests/security/log-injection.test.js` — Create a document with name `"Innocent\nFAKE_ENTRY admin deleted all"` and trigger an audit event. Verify the stored log entry contains no newline and the hash chain remains valid. Test with ANSI escape sequences; verify they are stripped. |
| **Accepted Risk** | Sanitization may alter legitimate document names containing special characters. This is accepted because audit log integrity is more important than preserving exact filenames in log records — the original filename is preserved in the documents table. |

---

## 19. Insecure Deserialization / JSON Body Abuse

| Field | Detail |
|---|---|
| **Threat** | An attacker sends deeply nested or excessively large JSON payloads to cause denial of service via CPU or memory exhaustion during parsing. Alternatively, unexpected fields like `__proto__` are used for prototype pollution. |
| **Severity** | **Medium** |
| **Mitigation** | Express `body-parser` is configured with a **100 KB JSON body limit** (`express.json({ limit: '100kb' })`). Input validation middleware checks for and rejects `__proto__`, `constructor`, and `prototype` keys in request bodies. All inputs are validated using schema validation (e.g., `joi` or manual checks) before processing. |
| **Test Coverage** | `tests/security/json-abuse.test.js` — Send a 200 KB JSON body; expect 413. Send a body containing `__proto__` key; expect 400. |
| **Accepted Risk** | None for typical payloads. Extremely deep but small JSON could theoretically slow parsing, but Express handles this within acceptable bounds. |

---

## 20. Insecure Default Configuration / Missing Security Headers

| Field | Detail |
|---|---|
| **Threat** | Missing security headers (CSP, HSTS, X-Frame-Options, etc.) leave the application vulnerable to clickjacking, MIME sniffing, and other browser-side attacks. Default configurations in Express may expose version information. |
| **Severity** | **Medium** |
| **Mitigation** | **Helmet** middleware is enabled with its full default set of headers: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `X-XSS-Protection: 0` (deprecated in modern browsers, Helmet disables it correctly), `Strict-Transport-Security`, `Content-Security-Policy` (restricting script and style sources), and `Referrer-Policy: no-referrer`. Express's `X-Powered-By` header is disabled by Helmet. |
| **Test Coverage** | `tests/security/headers.test.js` — Verify all security headers are present and correctly configured on API responses. Verify `X-Powered-By` is absent. |
| **Accepted Risk** | CSP is configured with a relatively permissive policy for the React frontend's needs. A stricter CSP with nonces would be ideal but adds complexity beyond hackathon scope. |

---

## Known Limitations and Accepted Risks

This section honestly acknowledges the security boundaries of TrustVault as built for a hackathon, and areas where a production deployment would require further investment.

| # | Limitation | Impact | Rationale |
|---|---|---|---|
| 1 | **Single-server SQLite** — no horizontal scaling | A single server is a single point of failure. If the server goes down, all data is unavailable. SQLite does not support concurrent writers across multiple server instances. | SQLite was chosen for zero-configuration deployment and hackathon simplicity. A production system would use PostgreSQL or a managed database with replication. |
| 2 | **No end-to-end encryption of file content at rest** | Files are stored as-is on the server filesystem. An attacker with filesystem access can read all documents. | Implementing client-side encryption with key management (envelope encryption, key escrow for sharing) is a substantial system design effort beyond hackathon scope. Server-side access controls and OS-level file permissions provide the security boundary. |
| 3 | **No IP-based access restrictions** | A stolen JWT can be used from any IP address. There are no geo-restrictions or IP allowlists. | IP binding breaks legitimate use cases (mobile networks, VPNs, corporate proxies). It was considered and deliberately excluded. |
| 4 | **No MFA (multi-factor authentication)** | Account security relies solely on password strength. Compromised passwords grant full access. | MFA (TOTP, SMS, WebAuthn) adds significant implementation complexity. Noted as the highest-priority enhancement for production. |
| 5 | **Demo deployment may use HTTP** | If the free-tier hosting provider does not support custom SSL, the demo may be served over HTTP, making tokens and credentials susceptible to network interception. | Free-tier deployment constraints. The code enforces HTTPS when available (secure cookies, HSTS headers). In production, TLS termination is mandatory. |
| 6 | **No file content scanning** | Uploaded files are validated by type (magic bytes) but not scanned for malware or sensitive content (PII, credentials). | Virus scanning and DLP require external services (ClamAV, Google DLP API) beyond the hackathon scope. |
| 7 | **No request signing or mutual TLS** | API requests are authenticated by JWT alone, without request-level integrity verification. | Request signing (e.g., AWS Signature V4) is complex and not standard for web applications. Appropriate for high-security API-to-API communication. |
| 8 | **Audit log storage is unbounded** | The audit_logs table grows indefinitely. Over time, this could impact SQLite performance. | A production system would implement log rotation, archival to external storage, or use a dedicated logging service. |
