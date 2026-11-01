# TrustVault — Secure Document Sharing with a Real Audit Trail

> **RISE Assessment Submission**  
> Built for zero-trust document sharing where the wrong person can never read the file, and you can mathematically prove who accessed it afterwards.

---

## 1. Quick Start & Test Credentials

### Demo Accounts
All pre-seeded demo accounts use the standard password: `Password123!`

| Role | Persona Name | Email | Purpose in Testing |
| :--- | :--- | :--- | :--- |
| **Admin / Auditor** | David Auditor | `admin@trustvault.com` | Monitors platform audit trails, verifies cryptographic hash chains, manages users. Has **no backdoor** to private documents without owner grant. |
| **Document Owner** | Alice Johnson | `alice@trustvault.com` | Uploads confidential documents (salary reports, contracts), grants/revokes granular permissions. |
| **Authorized Viewer** | Bob Smith | `bob@trustvault.com` | Holds authorized read/edit access granted by Alice. Tests immediate revocation when removed. |
| **Intruder / Pen-Tester** | Charlie Brown | `charlie@trustvault.com` | Authenticated user with **zero permissions** to Alice's files. Used by judges to attempt unauthorized access. |

---

## 2. The Three Non-Negotiables: How TrustVault Meets Them

### 1. Reachable ONLY by Authorized Users (Server Decides Every Time)
* **Zero Client-Side Reliance**: Hiding UI elements is purely cosmetic. The server executes a dynamic SQL authorization query (`permissionService.canAccess()`) before any file byte is streamed.
* **Opaque Storage**: Uploaded files are stripped of original filenames and stored in `server/uploads/{uuid}.enc`. Files cannot be accessed directly via static URLs.
* **Enumeration Defense**: Requesting an unauthorized document returns `404 Not Found` (identical to a non-existent document), preventing attackers from guessing valid document UUIDs.

### 2. Proven Access & Tamper-Evident Black Box Audit
* **Complete Event Coverage**: TrustVault logs uploads, downloads, metadata edits, deletions, permission grants, permission revocations, and **every refused intrusion attempt (`status: DENIED`)**.
* **Cryptographic Hash Chaining**: Every audit entry includes:
  $$\text{record\_hash} = \text{SHA256}(\text{id} + \text{timestamp} + \text{actor\_id} + \text{action} + \text{status} + \text{previous\_hash})$$
  Deleting or altering any single row breaks the hash chain, immediately flagged by `verifyChain()`.
* **Database Engine Immutability**: SQLite database triggers (`prevent_audit_update` and `prevent_audit_delete`) abort any manual SQL `UPDATE` or `DELETE` commands on the audit table.

### 3. Immediate Access Revocation
* **No Stale JWT Windows**: Many architectures store permissions in a JWT claim, leaving a 15–60 minute window where a revoked user can still download files.
* **TrustVault's Solution**: JWT carries *only* identity (`id`, `email`, `role`). Document permissions are checked live against `document_grants` on every request. When an owner clicks "Revoke", the grant receives `revoked_at = NOW()`. The very next byte request fails within milliseconds.

---

## 3. Architecture & Tech Stack

```
                   ┌────────────────────────────────────────┐
                   │        React 18 + Tailwind UI          │
                   │ (Owner Portal, Viewer, Admin Dashboard)│
                   └───────────────────┬────────────────────┘
                                       │ HTTPS (Bearer Token)
                                       ▼
                   ┌────────────────────────────────────────┐
                   │       Express Security Gateway         │
                   │ (Helmet, CORS, IP Rate Limiter, Multer)│
                   └───────────────────┬────────────────────┘
                                       │
                     ┌─────────────────┴─────────────────┐
                     ▼                                   ▼
          [Document Controller]                 [Authorization Engine]
          - Magic-byte validation               - Synchronous ACL check
          - Opaque UUID storage                 - Opaque 404 refusal
          - Byte streaming proxy                - Separation of duties
                     │                                   │
                     └─────────────────┬─────────────────┘
                                       │
                                       ▼
                   ┌────────────────────────────────────────┐
                   │    Tamper-Evident Audit Interceptor    │
                   │   Logs ALLOWED and DENIED attempts     │
                   │   Calculates SHA-256 Hash Chain        │
                   └───────────────────┬────────────────────┘
                                       │
                     ┌─────────────────┴─────────────────┐
                     ▼                                   ▼
        ┌─────────────────────────┐         ┌─────────────────────────┐
        │   SQLite DB (WAL Mode)  │         │ Isolated Storage Folder │
        │  - Users & Grants       │         │ - Opaque {uuid}.enc     │
        │  - Immutable Audit Log  │         │ - No static HTTP route  │
        │  - Triggers & Indexes   │         │ - Validated magic bytes │
        └─────────────────────────┘         └─────────────────────────┘
```

* **Backend**: Node.js, Express, better-sqlite3 (synchronous WAL mode eliminates TOCTOU race conditions).
* **Frontend**: React 18, Vite, Tailwind CSS, Lucide icons, date-fns.
* **Security & Auth**: JWT (identity only), bcryptjs (salt rounds 10-12), crypto (SHA-256 hash chains), helmet, express-rate-limit.

---

## 4. Local Installation & Running Tests

### Prerequisites
* Node.js v18+ or v20+
* npm or pnpm

### 1. Clone & Install Dependencies
```bash
# Clone the repository
git clone <your-repo-url>
cd trustvault

# Install root, server, and client dependencies
cd server && npm install
cd ../client && npm install
cd ..
```

### 2. Configure Environment
```bash
# In the project root, copy .env.example
cp .env.example .env
```

### 3. Seed Database with Demo Personas & Confidential Documents
```bash
cd server
npm run seed
```
This populates Alice's executive salary reports, contracts, and sets up the permission matrix.

### 4. Run Automated Security Test Suite
```bash
cd server
npm test
```
The test suite executes comprehensive penetration scenarios:
* Verifies unauthenticated calls fail with 401.
* Proves Charlie (intruder) cannot read, download, edit, or delete Alice's files (returns 404).
* Proves Bob can download authorized files.
* **Proves immediate revocation**: Bob downloads $\rightarrow$ Alice revokes $\rightarrow$ Bob immediately receives 404 with the same token.
* Verifies `ACCESS_DENIED` events exist in the audit log.
* Validates SHA-256 hash chain integrity.
* Tests database-level triggers blocking direct audit row tampering.

### 5. Run the Application
In terminal 1 (Backend):
```bash
cd server
npm run dev
# Server running at http://localhost:3000
```

In terminal 2 (Frontend):
```bash
cd client
npm run dev
# Vite UI running at http://localhost:5173
```
Open `http://localhost:5173` in your browser.

---

## 5. Deployment Guide (Free Tier on Render)

### Deploy Backend + Frontend as Single Service on Render:
1. Build client:
   ```bash
   cd client && npm run build
   ```
2. The server is pre-configured to statically serve `client/dist` in production when `NODE_ENV=production`.
3. Create a **Web Service** on [Render.com](https://render.com/):
   - **Environment**: Node
   - **Build Command**: `npm install && cd server && npm install && cd ../client && npm install && npm run build && cd ../server && node src/seed.js`
   - **Start Command**: `cd server && node src/index.js`
   - **Environment Variables**:
     - `NODE_ENV`: `production`
     - `PORT`: `3000`
     - `JWT_SECRET`: `<generate-long-random-string>`

---

## 6. What Was Built vs. Deliberately Omitted

### What Was Built:
1. Three core platform personas (Admin, Owner, Viewer) + Intruder persona.
2. Secure drag-and-drop file ingestion with magic-byte verification (PDF, DOCX, XLSX, TXT, images).
3. Centralized synchronous authorization engine (`permissionService.canAccess`).
4. Instant revocation per-document and per-user.
5. Append-only SHA-256 hash-chained audit log with SQLite immutability triggers.
6. Opaque 404 response strategy against IDOR enumeration.
7. Search by document title, owner, category, and date range.
8. Interactive Admin Compliance Dashboard with live cryptographic hash-chain verification tool.
9. Automated security penetration test suite.

### What Was Deliberately Not Built (and Why):
* **Folder Hierarchy / Nested Inheritance**: Folder inheritance causes cascading permission leaks (someone gets access to a folder to see one file and accidentally sees forty). Per-document grants are explicitly auditable and zero-trust.
* **Public / Shareable Secret Links**: "Anyone with the link" links can be forwarded, leaked in Slack, or cached by proxies. Every byte in TrustVault requires authenticated identity.
* **Client-Side Permissions in JWT**: Sacrificing 1ms of database query time to store permissions in JWT creates a 1-hour revocation vulnerability window. We chose strict immediate revocation over JWT claim caching.

---

## 7. Submission Artifacts Checklist

- [x] **Live Deployed URL**: Ready for Render / Railway / Fly.io.
- [x] **Seed Data & Credentials**: Included in this README and Login screen helper card.
- [x] **THREATS.md**: Comprehensive 18+ threat matrix covering STRIDE, mitigations, tests, and accepted risks.
- [x] **PROMPTS.md**: Dated log of AI pair programming with 6 specific caught failures (auth, hash chaining, revocation, magic bytes).
- [x] **Automated Security Tests**: `server/tests/security.test.js` validating all attack barriers.
- [x] **Database Schema & Seed Script**: `server/src/config/database.js` and `server/src/seed.js`.
