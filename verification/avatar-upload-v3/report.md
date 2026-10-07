# Avatar Upload V3 Alignment Report

**Status:** Empirical Verification Complete
**Date:** 2025-05-20
**Phase:** 13 — Avatar Upload V3 Alignment

---

## 1. Current `POST /users/me/avatar` Handler

- **Path:** `POST /api/v1/users/me/avatar` (registered in `server/src/lib.rs`)
- **Handler:** `upload_avatar` in `server/src/routes/attachments.rs`
- **Auth:** `AuthUser` extractor (requires valid Bearer session token, HTTP 401 on missing/invalid auth)
- **Request Shape:**
  - `Content-Type: multipart/form-data; boundary=...`
  - Required single file part named `file`
  - Required form fields: `claimed_id`, `plaintext_size`, `encrypted_size`, `chunk_size`, `chunk_count`, `nonce_prefix`, `base_counter`
  - Optional form fields: `content_type` (defaults to `"application/octet-stream"`), `uploader_client_id`
  - Strict single file part check (`file_count == 1`); returns HTTP 400 `invalid_request` if 0 or >1 file parts provided
- **Response Shape:**
  - HTTP `201 Created`
  - Header: `Cache-Control: no-store`
  - Body: `AttachmentView` JSON:
    ```json
    {
      "id": "<64_char_hex_claimed_id>",
      "room_id": null,
      "uploader_id": "<calling_user_id>",
      "uploader_client_id": null,
      "storage_backend": "fs",
      "padded_size": 65536,
      "plaintext_size": 65536,
      "encrypted_size": 65536,
      "chunk_size": 16384,
      "chunk_count": 4,
      "nonce_prefix": "AQIDBAUGBw==",
      "base_counter": 0,
      "content_type": "image/png",
      "created_at": "2025-05-20T00:00:00Z"
    }
    ```
- **Comparison:** Matches V3 §8.2.7 ("Request: multipart/form-data with a single file part. Response: 201 with the attachment record.").

---

## 2. Current `attachments` Table Schema

From `server/migrations/0001_v2_schema.sql`:
```sql
CREATE TABLE IF NOT EXISTS attachments (
    id                 TEXT PRIMARY KEY,
    room_id            TEXT REFERENCES rooms(id) ON DELETE CASCADE,
    uploader_id        TEXT NOT NULL REFERENCES users(id),
    uploader_client_id TEXT,
    storage_backend    TEXT NOT NULL CHECK(storage_backend IN ('fs', 's3')),
    storage_key        TEXT NOT NULL,
    padded_size        INTEGER NOT NULL,
    plaintext_size     INTEGER NOT NULL,
    encrypted_size     INTEGER NOT NULL,
    chunk_size         INTEGER NOT NULL,
    chunk_count        INTEGER NOT NULL,
    nonce_prefix       TEXT NOT NULL,
    base_counter       INTEGER NOT NULL,
    content_type       TEXT NOT NULL DEFAULT 'application/octet-stream',
    created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```
- `room_id` is nullable (`TEXT REFERENCES rooms(id) ON DELETE CASCADE`) as established in Task 32.
- `uploader_id` is `TEXT NOT NULL REFERENCES users(id)`.

---

## 3. Current Attachment Insert for User Avatars

- `upload_avatar` passes `room_id = None` and `uploader_id = user_id` to `parse_multipart_strict_single_file`.
- `upload_attachment` in `server/src/attachments.rs` executes:
  ```sql
  INSERT INTO attachments (
      id, room_id, uploader_id, uploader_client_id,
      storage_backend, storage_key,
      padded_size, plaintext_size, encrypted_size,
      chunk_size, chunk_count, nonce_prefix, base_counter,
      content_type
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ```
- Binds `&req.room_id` (`None` -> SQLite `NULL`) and `&req.uploader_id` (calling user ID).

---

## 4. Current Response Shape

- Status: `201 Created`
- Headers: `Cache-Control: no-store`, `Content-Type: application/json`
- Fields in `AttachmentView`:
  - `id`: String (64-char hex SHA-256 hash)
  - `room_id`: Option<String> (`null` for user avatars)
  - `uploader_id`: String (user ID)
  - `uploader_client_id`: Option<String>
  - `storage_backend`: String (`"fs"` or `"s3"`)
  - `padded_size`: i64
  - `plaintext_size`: i64
  - `encrypted_size`: i64
  - `chunk_size`: i64
  - `chunk_count`: i64
  - `nonce_prefix`: String (7-byte base64 string)
  - `base_counter`: i64
  - `content_type`: String
  - `created_at`: DateTime<Utc> (ISO 8601)
- Matches `AttachmentView` specification in V3 §6.10.

---

## 5. Current Size Limit Resolution

- Helper function `get_effective_user_file_size_limit` in `server/src/routes/attachments.rs` reads `users.max_file_size_bytes`:
  ```rust
  let user_max_file_size: Option<i64> = sqlx::query_scalar("SELECT max_file_size_bytes FROM users WHERE id = ?")
      .bind(user_id)
      .fetch_optional(pool)
      .await?;
  ```
- Calls `limits::effective_file_size_limit`:
  - Priority 1: Per-user override (`users.max_file_size_bytes`) if `Some`.
  - Priority 2: Instance default (`config.max_file_size_bytes`).
  - Priority 3: Server hard max (`hard_max.file_size_bytes`).
- On size limit violation, returns HTTP `413 Payload Too Large` with error code `file_too_large` and details (`limit`, `received`).

---

## 6. Current Content Type Validation

- Multipart request header `Content-Type` must start with `"multipart/form-data"` (returns HTTP `415 Unsupported Media Type` if not).
- Form field `content_type` is parsed if provided (defaults to `"application/octet-stream"`).
- `upload_attachment` validates `content_type`: must be <= 128 characters, non-empty, printable ASCII without controls.
- The server does **not** restrict MIME types to `image/*` (or any image subtype). Any valid ASCII string is accepted. This matches V3 §8.2.7 (where uploaded C2SP ciphertext is opaque to the server).

---

## 7. Current Storage Backend Support

- Uses `State(storage): State<Arc<dyn Storage>>`.
- Supports both `filesystem` (`FsStorage`) and `s3` (`S3Storage`).
- Writes blob via `storage.write(&storage_key, &req.data).await?`.
- Storage key format: `attachments/{id[0..2]}/{id[2..4]}/{id}`.
- Both storage backends produce identical database entries and `AttachmentView` HTTP response shapes.

---

## 8. Current C2SP Handling

- Server treats `req.data` as opaque ciphertext.
- Hash verification: computes SHA-256 over `req.data` and verifies `computed_hash == claimed_id`.
- Manifest checks: verifies bucket size in `config.attachment_bucket_sizes`, `chunk_size == config.attachment_chunk_size`, `chunk_count > 0`, `0 < plaintext_size <= encrypted_size`, 7-byte `nonce_prefix`, `0 <= base_counter <= 2^32-1`.
- The server does **not** attempt to decrypt, parse, or inspect the byte payload.
- The C2SP purpose string `"user-avatar"` is client-side only (for HKDF context derivation) and is neither sent to nor validated by the server.

---

## 9. Current Event Publishing

- No Sockudo event is published on avatar upload.
- Reason: V3 §8.2.7 does not define an event for avatar upload. V3 §8.9 defines `user.updated` on the user channel when `profile_version` changes. Avatar upload alone does not modify `users.profile` or bump `profile_version`. The client updates `users.profile` separately via `PATCH /users/me`, which fires `user.updated`.
- Verified no events are fired.

---

## 10. Current Deletion Path

- There is **no** `DELETE /users/me/avatar` endpoint.
- Avatar attachments can be deleted via standard `DELETE /api/v1/attachments/{id}` if needed by the uploader.
- Matches V3 §8.2 (which omits `DELETE /users/me/avatar`).

---

## 11. Cross-User Visibility

- Checked `POST /api/v1/users/lookup`: returns `{ user_id, encrypted_display }`. Does **not** expose avatar attachment ID or profile blob.
- Checked `GET /api/v1/rooms/:id/members`: returns user member entries as `{ type: "user", user_id, role, joined_at }`. Does **not** expose avatar attachment ID.
- `users.profile` is self-only (returned by `GET /api/v1/users/me` and modified by `PATCH /api/v1/users/me`).
- Confirmed no endpoint leaks avatar attachment IDs across users (Interpretation A).

---

## 12. Existing Tests

- File: `server/tests/user_avatar.rs`
- Tests:
  1. `test_user_avatar_upload_happy_path`: uploads avatar, asserts 201 Created, `Cache-Control: no-store`, `room_id = null`, `uploader_id = caller`, downloadability, DB state, zero Sockudo events, zero audit logs.
  2. `test_user_avatar_upload_size_limit`: tests `max_file_size_bytes` override enforcement and 413 `file_too_large` response.
  3. `test_user_avatar_upload_unauthenticated`: tests 401 Unauthorized when missing token.
  4. `test_user_avatar_upload_wrong_content_type`: tests 415 Unsupported Media Type when content-type is non-multipart.
  5. `test_user_avatar_upload_multiple_file_parts`: tests 400 Bad Request when multiple `file` parts are sent.
  6. `test_user_avatar_upload_coexistence_with_room_attachment`: verifies coexistence of room-scoped attachments (`room_id != null`) and user-scoped avatar attachments (`room_id = null`).
- Batch Assignment: `user_avatar` in `server/tests/batch-manifest.toml` (part of `storage` batch).

---

## 13. V2 Remnants Audit

- `attachments.room_id` is nullable in `0001_v2_schema.sql`.
- No `avatar_id` or `avatar_file_id` column exists on `users` table.
- No V2 code paths assume `attachments.room_id` is NOT NULL for uploads.
- No endpoints leak avatar attachment IDs to other users.

---

## Summary of Status and Test Plan

The current implementation of `POST /users/me/avatar` in `server/src/routes/attachments.rs` already matches V3 §8.2.7 and §7.7 contracts!

To ensure complete verification and test coverage per Deliverable 10, we will add explicit test cases in `server/tests/user_avatar.rs` covering:
1. Server opacity check: upload arbitrary non-image / non-C2SP bytes (e.g. random binary pattern `0xDE, 0xAD, 0xBE, 0xEF`), verifying acceptance (201 Created) without parsing.
2. `profile_version` non-mutation check: verify uploading an avatar does NOT bump `profile_version` or alter `users.profile`.
3. Cross-user visibility check: verify `POST /users/lookup` and `GET /rooms/:id/members` do not expose the avatar attachment ID to other users.
4. S3 storage backend test (or dual backend verification).

All tests will run under the `storage` batch (`user_avatar` test runner).
