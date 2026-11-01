# TrustVault — 5-Minute Evaluation Video Script

> **Recording Tip**: Use any free screen recorder (Loom, OBS, or Windows `Win + G`). Keep it under 5 minutes. Follow this exact flow to show judges you hit every single criterion.

---

### Segment 1 (0:00 – 0:45) — Introduction & The Threat Problem
* **Screen**: Open the TrustVault login page showing the 4 demo account cards.
* **Spoken Script**:
  > *"Hello, this is TrustVault — a zero-trust document sharing platform built for the RISE challenge. Companies regularly face two expensive failures: permissions leak through folder inheritance or stale links, and nobody can legally prove who accessed a document after a leak occurs. 
  > TrustVault solves this with three non-negotiable principles: the server decides reachability on every request, taking access away works immediately, and the audit trail is cryptographically tamper-evident."*

---

### Segment 2 (0:45 – 1:45) — Secure Ingestion & Legitimate Sharing
* **Screen**: Log in as `alice@trustvault.com` (Document Owner).
* **Action**:
  1. Show existing confidential files: `Q4 2026 Executive Salary Report` and `Merger & Acquisition Term Sheet`.
  2. Click **Upload Document**, drag and drop a PDF or text file, select category `Legal`, and submit.
  3. Explain: *"Notice uploads inspect magic bytes on the server, reject spoofed MIME types, sanitize filenames against path traversal, and store files under opaque UUIDs."*
  4. Open the Salary Report $\rightarrow$ click **Manage Access** $\rightarrow$ grant `read` access to `bob@trustvault.com`.

---

### Segment 3 (1:45 – 2:30) — Proving Legitimate Access
* **Screen**: Log out of Alice $\rightarrow$ Log in as `bob@trustvault.com` (Viewer).
* **Action**:
  1. Show that Bob now sees the shared Salary Report.
  2. Click on the document $\rightarrow$ Click **Download Document**.
  3. The file downloads successfully. Show that Bob has no buttons or permissions to delete the document or share it with others.

---

### Segment 4 (2:30 – 3:30) — Simulating the Intruder Attack (Charlie)
* **Screen**: Log out of Bob $\rightarrow$ Log in as `charlie@trustvault.com` (Intruder).
* **Action**:
  1. Show Charlie's dashboard: Alice's confidential documents are completely invisible.
  2. Open the browser URL bar or DevTools and attempt to directly navigate to Alice's document: `/documents/<ALICE_DOC_ID>`.
  3. The server immediately returns an opaque **404 Not Found**.
  4. Explain: *"The server returns 404 rather than 403 to prevent document ID enumeration. Charlie cannot discern whether the document exists."*

---

### Segment 5 (3:30 – 4:15) — Immediate Access Revocation (Non-Negotiable #3)
* **Screen**: Log back in as `alice@trustvault.com` (Owner).
* **Action**:
  1. Open the Salary Report.
  2. In the Access Control List, click **Revoke Immediately** next to Bob's grant.
  3. Log back in as `bob@trustvault.com` using his existing session.
  4. Bob attempts to download the file again $\rightarrow$ **Blocked immediately with 404**.
  5. Explain: *"Permissions are never cached in JWT claims. Every download queries the database synchronously. Revocation works the exact millisecond it is issued."*

---

### Segment 6 (4:15 – 5:00) — Audit Trail & Tamper-Evidence Verification (Non-Negotiable #2)
* **Screen**: Log in as `admin@trustvault.com` (Compliance Officer / Auditor).
* **Action**:
  1. Open the **Security Dashboard**.
  2. Show the real-time telemetry: Total documents, total downloads, and **Blocked Intrusions (24h)**.
  3. Scroll through the Audit Trail: Point out the recorded `DOCUMENT_DOWNLOAD` by Bob, the `PERMISSION_REVOKED` by Alice, and the `ACCESS_DENIED` attempts by Charlie.
  4. Click the button: **"Verify SHA-256 Hash Chain"**.
  5. Show the green banner: *"Cryptographic chain verified across all records! Zero tampering detected."*
  6. Explain: *"Every log entry is chained via SHA-256 to the previous entry, and SQLite triggers block any UPDATE or DELETE operations on the audit table."*
  7. Conclude: *"Thank you. The full codebase, automated security test suite, THREATS.md, and PROMPTS.md are available in the repository."*
