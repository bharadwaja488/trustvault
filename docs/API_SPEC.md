# TrustVault — REST API Specification & Authorization Matrix

All endpoints (except health and login) require an HTTP Authorization header:
`Authorization: Bearer <JWT_TOKEN>`

---

## Authorization Matrix

| Endpoint | Method | Role Allowed | Required Doc Permission | Audit Event Logged | Response on Denial |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `/api/auth/login` | POST | Public | None | `LOGIN` or `LOGIN_FAILED` | `401 Unauthorized` |
| `/api/auth/me` | GET | Authenticated | None | None | `401 Unauthorized` |
| `/api/auth/users` | GET | Authenticated | None | None | `401 Unauthorized` |
| `/api/auth/register` | POST | Admin | None | `USER_CREATED` | `403 Forbidden` |
| `/api/documents` | GET | Authenticated | None (filtered to permitted) | None | `401 Unauthorized` |
| `/api/documents` | POST | Authenticated | None (becomes owner) | `DOCUMENT_UPLOAD` | `400 / 401` |
| `/api/documents/:id` | GET | Authenticated | Read (or Owner) | `DOCUMENT_VIEW` | `404 Not Found` |
| `/api/documents/:id/download` | GET | Authenticated | Read (or Owner) | `DOCUMENT_DOWNLOAD` | `404 Not Found` |
| `/api/documents/:id` | PUT | Authenticated | Edit (or Owner) | `DOCUMENT_UPDATE` | `404 Not Found` |
| `/api/documents/:id` | DELETE | Authenticated | Owner Only | `DOCUMENT_DELETE` | `404 Not Found` |
| `/api/documents/:id/permissions` | GET | Authenticated | Owner or Admin | None | `404 Not Found` |
| `/api/documents/:id/permissions` | POST | Authenticated | Owner or Admin | `PERMISSION_GRANTED` | `404 Not Found` |
| `/api/documents/:id/permissions/:grantId`| DELETE | Authenticated | Owner or Admin | `PERMISSION_REVOKED` | `404 Not Found` |
| `/api/documents/:id/activity` | GET | Authenticated | Owner or Admin | None | `404 Not Found` |
| `/api/admin/stats` | GET | Admin | None | None | `403 Forbidden` |
| `/api/admin/audit-logs` | GET | Admin | None | None | `403 Forbidden` |
| `/api/admin/audit-verify` | GET | Admin | None | None | `403 Forbidden` |
| `/api/admin/users` | GET | Admin | None | None | `403 Forbidden` |
| `/api/admin/users/:id` | PUT | Admin | None | `USER_UPDATED` | `403 Forbidden` |

---

## Detailed Endpoint Signatures

### 1. Document Upload
- **Method**: `POST`
- **Path**: `/api/documents`
- **Content-Type**: `multipart/form-data`
- **Form Fields**:
  - `file`: Binary file (PDF, DOCX, XLSX, TXT, PNG, JPG, max 10MB)
  - `title`: String (Required)
  - `description`: String (Optional)
  - `category`: String (e.g. `HR`, `Legal`, `Finance`, `Engineering`)
- **Success Response**: `201 Created`
  ```json
  {
    "message": "Document uploaded successfully",
    "document": {
      "id": "uuid-v4",
      "title": "Q4 Salary Report",
      "category": "HR",
      "file_size": 104230,
      "original_filename": "Q4_Salaries.pdf"
    }
  }
  ```

### 2. Document Download Stream
- **Method**: `GET`
- **Path**: `/api/documents/:id/download`
- **Security Check**: Synchronous real-time DB check against `document_grants`
- **Headers Sent by Server**:
  - `Content-Type`: MIME type of document
  - `Content-Disposition`: `attachment; filename="sanitized.pdf"`
  - `X-Content-Type-Options`: `nosniff`
  - `Cache-Control`: `no-store, no-cache, must-revalidate, private`
- **Response**: Binary stream of file bytes.

### 3. Grant Permission
- **Method**: `POST`
- **Path**: `/api/documents/:id/permissions`
- **Body**:
  ```json
  {
    "userId": "uuid-of-target-user",
    "permission": "read" // or "edit"
  }
  ```
- **Response**: `201 Created`

### 4. Revoke Permission (Immediate)
- **Method**: `DELETE`
- **Path**: `/api/documents/:id/permissions/:grantId`
- **Response**: `200 OK`
  ```json
  { "message": "Access revoked successfully. Takes effect immediately." }
  ```

### 5. Audit Log Chain Verification
- **Method**: `GET`
- **Path**: `/api/admin/audit-verify`
- **Response**: `200 OK`
  ```json
  {
    "valid": true,
    "totalRecords": 42,
    "brokenAt": null
  }
  ```
