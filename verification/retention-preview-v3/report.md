# Step 0 Report — Retention Change Preview V3 Alignment

**Date:** 2026-10-06
**Status:** Completed
**Spec Reference:** Server Specification v3.0.3 §3.2, §4.1, §4.2, §4.5, §7.6, §7.7, §8.4, §10

---

## Empirical Verification Summary

### 1. Current `POST /rooms/:id/retention/preview` Handler
- **Route Path:** `/api/v1/rooms/:id/retention/preview` (registered in `server/src/lib.rs` as `post(routes::rooms::retention_preview)`).
- **Authentication:** `AuthUser` bearer token required.
- **Request Body:** JSON `{ "retention_days": <i64> }`.
- **Response Shape:**
  ```json
  {
    "current_retention_days": 90,
    "proposed_retention_days": 30,
    "messages_affected": 2,
    "attachments_affected": 1,
    "oldest_affected_at": "2026-06-01T00:00:00Z",
    "newest_affected_at": "2026-07-01T12:00:00Z"
  }
  ```
- **Response Headers:** `Cache-Control: no-store`.
- **HTTP Status Codes:** `200 OK` on success, `400 Bad Request` (`invalid_retention_days`) on invalid payload or range, `401 Unauthorized` if unauthenticated, `403 Forbidden` (`forbidden`) if non-owner member, `404 Not Found` (`room_not_found`) if non-member or room does not exist.
- **Comparison against V2 Task 31 Fact & V3 §8.4:** Matches the V2 Task 31 fact and V3 §8.4 contract path and response shape.

---

### 2. Current Authorization
- **Role Enforcement:** Checked via `rooms::get_room_for_user(&state.pool, &id, &auth.user_id)`.
- **Non-owner member:** If `current_user_role != "owner"`, returns HTTP 403 `forbidden`.
- **Non-member / Missing room:** If `get_room_for_user` returns `None`, returns HTTP 404 `room_not_found`.
- **Unauthenticated:** Axum `AuthUser` extractor returns HTTP 401 `unauthorized`.

---

### 3. Current `retention_days` Validation
- **Range Check:** `0 <= retention_days <= 365`. Values < 0 or > 365 return HTTP 400 `invalid_retention_days`.
- **Type / Missing Check:** Non-integer values or missing `retention_days` return HTTP 400 `invalid_retention_days`.
- **`retention_days = 0` ("forever"):** Explicitly short-circuited in `rooms::preview_retention_change` to return `messages_affected = 0`, `attachments_affected = 0`, `oldest_affected_at = null`, `newest_affected_at = null`.

---

### 4. Current Message Selection
- **SQL Query:**
  ```sql
  SELECT
      COUNT(*),
      MIN(created_at),
      MAX(created_at)
  FROM room_messages
  WHERE room_id = ?
    AND created_at < datetime('now', '-' || ? || ' days')
    AND deleted_at IS NULL
    AND content_type NOT IN ('commit', 'proposal')
  ```
- **Cutoff:** `created_at < datetime('now', '-' || ? || ' days')`.
- **Exclusions:**
  - Soft-deleted rows (`deleted_at IS NOT NULL`) are excluded.
  - MLS protocol rows (`content_type IN ('commit', 'proposal')`) are excluded.
- **Inclusions:**
  - Standard messages (`content_type = 'application'`) are included.
  - Bot messages (`content_type = 'bot'`) are included (since `content_type NOT IN ('commit', 'proposal')` matches `'bot'`).
  - Edit rows (`edit_of IS NOT NULL`) are included as they are standard message rows in `room_messages`.
  - Whisper rows (`target_user_ids IS NOT NULL`) are included as they are standard message rows in `room_messages`.

---

### 5. Current Attachment Selection
- **SQL Query:**
  ```sql
  SELECT COUNT(*)
  FROM attachments
  WHERE room_id = ?
    AND created_at < datetime('now', '-' || ? || ' days')
  ```
- **Cutoff:** `created_at < datetime('now', '-' || ? || ' days')`.
- **Scope:** Restricted to `room_id = ?`. User-scoped attachments (`room_id IS NULL`) are excluded.
- **Tombstones:** The `attachments` table has no `deleted_at` column; deletion removes rows directly.

---

### 6. Current Response Shape & Timestamp Computation
- **Fields:** `current_retention_days`, `proposed_retention_days`, `messages_affected`, `attachments_affected`, `oldest_affected_at`, `newest_affected_at`.
- **Timestamp Nullability:** `oldest_affected_at` and `newest_affected_at` are `null` when affected count is zero.
- **GAP IDENTIFIED:** Currently, `oldest_affected_at` and `newest_affected_at` are derived solely from `room_messages` (ignoring `attachments`). If `messages_affected == 0` but `attachments_affected > 0`, or if an affected attachment is older/newer than all affected messages, the timestamps do not account for the affected attachment.
- **Fix Required:** Compute `MIN` and `MAX` across the union of affected `room_messages` and affected `attachments`.

---

### 7. Current `current_retention_days` Resolution
- **Calculation:** `rooms::effective_message_retention_days(room_retention, limits.attachment_retention_days, server_max.attachment_retention_days)`.
- **Three-Tier Rule:** Evaluates `room_override` vs instance default (`limits.attachment_retention_days`) vs server hard max (`server_max.attachment_retention_days`), where `0` means "forever" (absorbing). Matches §4.1 and §4.4.

---

### 8. Current `0` (Forever) Handling
- Evaluates `proposed_retention_days == 0` and returns `messages_affected = 0`, `attachments_affected = 0`, `oldest_affected_at = null`, `newest_affected_at = null`.

---

### 9. Current Rate Limit
- No rate limiting is applied to `POST /rooms/:id/retention/preview`. This matches V3 §5.6 / §8.4 / V2 Task 31 fact (the endpoint is read-only and un-rate-limited).

---

### 10. Current `Cache-Control` Header
- Set to `no-store` (`header::CACHE_CONTROL, HeaderValue::from_static("no-store")`).

---

### 11. Existing Tests
- `server/tests/retention_preview.rs` (`test_retention_preview_flow`).
- **Batch Manifest Assignment:** Assigned to `messaging` batch in `server/tests/batch-manifest.toml`.

---

### 12. V2 Remnants
- No legacy V2 code paths or mismatched cutoffs found.
- The single gap to align with V3 §8.4 / Deliverable 5 is updating `oldest_affected_at` and `newest_affected_at` to evaluate across the union of affected messages and affected attachments.

---

## Action Plan to Close Gaps

1. **Union Timestamp Calculation (`server/src/rooms.rs`):**
   Update `rooms::preview_retention_change` to query `MIN(created_at)` and `MAX(created_at)` across affected attachments as well:
   - Query attachment `MIN(created_at)` and `MAX(created_at)` alongside `COUNT(*)`.
   - Take the overall minimum of message `MIN(created_at)` and attachment `MIN(created_at)` for `oldest_affected_at`.
   - Take the overall maximum of message `MAX(created_at)` and attachment `MAX(created_at)` for `newest_affected_at`.
   - If both `messages_affected == 0` and `attachments_affected == 0`, both timestamps are `None` (`null`).

2. **Comprehensive Integration Test Additions (`server/tests/retention_preview.rs`):**
   Add test coverage for:
   - Timestamp union calculation when affected attachments exist without affected messages, and when an attachment is older/newer than affected messages.
   - Whisper messages (`target_user_ids IS NOT NULL`) being included in message count.
   - Bot messages (`content_type = 'bot'`) being included in message count.
   - User-scoped attachments (`room_id IS NULL`) being excluded from room preview.
   - Rate limit absence (500 requests in a row succeed).
   - Non-integer or string `retention_days` returning 400.
   - Missing `retention_days` returning 400.
   - Endpoint read-only assertion (verifying `rooms.retention_days`, `room_messages`, and `attachments` are unmodified).

3. **Verification & Checks:**
   - Run `cargo test --test retention_preview` (and batch `messaging`).
   - Run `cargo fmt --check`.
   - Run `cargo clippy --all-targets -- -D warnings`.
   - Run `make check-batches`.
   - Run `cargo test --test test_batch_manifest`.
