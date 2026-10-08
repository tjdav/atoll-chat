# Step 0 Empirical Verification Report: Starred Items V3 Alignment

**Date:** October 2023
**Task:** Starred Items V3 Alignment (Phase 23)
**Spec Reference:** Server Specification v3.0.3 §4.2, §5.6, §6.28, §7.2, §8.2.4, §8.2.9, §8.9, §14.2, §14.3
**Status:** Verification-only — 100% Alignment Confirmed

---

## 1. Current `starred_items` Table

**Location:** `server/migrations/0001_v2_schema.sql` (lines 307–318)

```sql
CREATE TABLE IF NOT EXISTS starred_items (
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item_id    TEXT NOT NULL,
    item_type  TEXT NOT NULL,
    room_id    TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    user_seq   INTEGER NOT NULL,
    starred_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at DATETIME,
    PRIMARY KEY (user_id, item_id, item_type)
);
CREATE INDEX IF NOT EXISTS idx_starred_items_seq ON starred_items(user_id, user_seq);
CREATE INDEX IF NOT EXISTS idx_starred_items_room ON starred_items(user_id, room_id, starred_at DESC);
```

**Comparison with V3 §7.2:**
- Composite Primary Key `PRIMARY KEY (user_id, item_id, item_type)` matches §7.2.
- Foreign keys `users(id) ON DELETE CASCADE` and `rooms(id) ON DELETE CASCADE` match §7.2.
- Columns `user_id`, `item_id`, `item_type`, `room_id`, `user_seq`, `starred_at`, `deleted_at` match §7.2.
- Indexes `idx_starred_items_seq` on `(user_id, user_seq)` and `idx_starred_items_room` on `(user_id, room_id, starred_at DESC)` match §7.2.
- Allowed `item_type` values (`attachment`, `message`, `link`) are validated at the application boundary in Rust via `validate_item_type` (`server/src/starred/write.rs`).

---

## 2. Current `POST /users/me/starred-items` Handler

**Location:** `server/src/routes/starred.rs` (`post_star`) & `server/src/starred/write.rs` (`star_item`)

- **Path:** `POST /api/v1/users/me/starred-items`
- **Auth:** `AuthUser` Bearer session token required (HTTP 401 if missing/invalid).
- **Request Envelope:** `{"item_id": "...", "item_type": "...", "room_id": "..."}`
- **Response Envelope:** `StarredItemView` (`{"item_id": "...", "item_type": "...", "room_id": "...", "user_seq": N, "starred_at": "...", "deleted_at": null}`)
- **Status Codes:**
  - `201 Created` for fresh star or re-star of a tombstoned item (allocates new `user_seq`, sets `starred_at = now`, clears `deleted_at = null`).
  - `200 OK` for an existing active star (idempotent, returns existing row without bumping `user_seq`).
  - `400 Bad Request` (`invalid_item_type`) for unrecognised `item_type`.
  - `404 Not Found` (`room_not_found`) if caller is not a member of `room_id`.
  - `409 Conflict` (`starred_items_limit_reached`) if active star count reaches `max_starred_items_per_user`.
  - `429 Too Many Requests` when rate limited.
- **Headers:** Includes `Cache-Control: no-store`.

---

## 3. Current `DELETE /users/me/starred-items/:item_id` Handler

**Location:** `server/src/routes/starred.rs` (`delete_star`) & `server/src/starred/write.rs` (`unstar_item`)

- **Path:** `DELETE /api/v1/users/me/starred-items/:item_id?item_type=`
- **Auth:** `AuthUser` Bearer session token required.
- **Query Params:** `item_type` (required, non-empty string).
- **Response:** HTTP `204 No Content` with empty body and `Cache-Control: no-store`.
- **Status Codes:**
  - `204 No Content` on successful soft deletion (sets `deleted_at = now`, allocates new `user_seq`).
  - `400 Bad Request` (`invalid_item_type`) if `item_type` query param is missing, empty, or invalid.
  - `404 Not Found` (`starred_item_not_found`) if item is not starred or already tombstoned.
  - `429 Too Many Requests` when rate limited.

---

## 4. Current `GET /users/me/starred-items` Handler

**Location:** `server/src/routes/starred.rs` (`get_starred_items`) & `server/src/starred/list.rs` (`list_starred_items`)

- **Path:** `GET /api/v1/users/me/starred-items`
- **Auth:** `AuthUser` Bearer session token required.
- **Query Params:**
  - `type`: Optional filter (`attachment` | `message` | `link`).
  - `room_id`: Optional room ID filter.
  - `limit`: Optional page size (default 100, clamped to max 500).
  - `cursor`: Optional opaque pagination cursor string.
  - `include_deleted`: Optional boolean (default false).
- **Response Envelope:** `{"items": [...], "next_cursor": "..." | null, "has_more": bool}`
- **Cursor Format:** Opaque unpadded base64url JSON payload containing `{"user_id": "<uid>", "last_item_id": "<id>", "last_item_type": "<type>", "last_starred_at": "<iso>"}`.
- **Cursor Validation:** Decode failure, JSON parse failure, or `cursor.user_id != caller.user_id` returns HTTP `400 Bad Request` (`invalid_cursor`).
- **Ordering:** Ordered by `starred_at DESC, item_id ASC, item_type ASC`.
- **Headers:** Includes `Cache-Control: no-store`.

---

## 5. Current `starred_item.added` Event Payload

**Location:** `server/src/starred/write.rs` (lines 101–110, 169–178)

- **Event Name:** `starred_item.added`
- **Channel:** `private-user-{user_id}`
- **Envelope:** `UserEventEnvelope` carrying `user_seq`.
- **Payload Shape:**
  ```json
  {
    "item_id": "...",
    "item_type": "...",
    "room_id": "...",
    "user_seq": 123
  }
  ```
- **Comparison:** Matches V3 §8.9 (`starred_item.added`) payload specification.

---

## 6. Current `starred_item.removed` Event Payload

**Location:** `server/src/starred/write.rs` (lines 235–243)

- **Event Name:** `starred_item.removed`
- **Channel:** `private-user-{user_id}`
- **Envelope:** `UserEventEnvelope` carrying `user_seq`.
- **Payload Shape:**
  ```json
  {
    "item_id": "...",
    "item_type": "...",
    "user_seq": 123
  }
  ```
- **Asymmetry Verification:** `room_id` is deliberately **absent** from `starred_item.removed`, exactly matching V3 §8.9 specification.

---

## 7. Current Limit Config

**Location:** `server/src/config.rs` (lines 128, 449–458, 1475)

- **Env Var:** `SERVER_MAX_STARRED_ITEMS_PER_USER`
- **Hard Max Limit:** 100,000
- **Instance Default:** 10,000
- **Startup Enforcement:** Config loading validates `(100..=100000).contains(&max_starred_items_per_user)`, panicking/failing startup if configured outside the allowed range per V3 §4.2.

---

## 8. Current Limit Enforcement Behavior

**Location:** `server/src/starred/write.rs` (lines 130–136)

- **Query:** `SELECT COUNT(*) FROM starred_items WHERE user_id = ? AND deleted_at IS NULL`
- **Active Stars Only:** Excludes soft-deleted rows (`deleted_at IS NOT NULL`). Soft-deleted items do not count against the limit.
- **Breach Behavior:** Returns `StarError::LimitReached` mapped to HTTP `409 Conflict` (`starred_items_limit_reached`).

---

## 9. Current Rate Limit

**Location:** `server/src/routes/starred.rs` (lines 20–22, 63–65)

- **Variant:** `RateLimitKey::Edit { user_id }`
- **Config:** `RATE_EDIT_PER_MIN` (default 30/min)
- **Key Format:** `edit:{user_id}:min:{boundary}`
- **Breach Behavior:** Returns HTTP `429 Too Many Requests` (`message: "rate limited"`, `reset_at`).

---

## 10. Current Sync Integration

**Location:** `server/src/routes/sync.rs`, `server/src/sync/starred.rs`, `server/src/sync/query.rs`

- `GET /users/me/sync` calls `list_starred_items_since` or `list_starred_items_all`.
- **Response Array:** Includes `starred_items` in response JSON body.
- **Ordering:** Sorted by `user_seq ASC`.
- **Tombstones:** Includes tombstoned rows (`deleted_at IS NOT NULL`) when `user_seq > since_seq`.
- **Cursor Synchronization:** Highest `starred_items.user_seq` participates in resolving `max_seq` returned in the sync response.

---

## 11. Current GDPR Integration

**Location:** `server/src/gdpr.rs` (`anonymise_user` & `build_export`)

- **Account Deletion:** `anonymise_user` executes `DELETE FROM starred_items WHERE user_id = ?` inside the deletion transaction.
- **Data Export:** `build_export` fetches all starred items for the user (`SELECT ... FROM starred_items WHERE user_id = ? ORDER BY starred_at ASC`) and packs `starred_items.json` into the exported ZIP archive matching V3 §14.3.

---

## 12. Current Sync Pruning Coverage

**Location:** `server/src/cleanup/sync.rs` (`SyncPruningJob`)

- `ALLOWED_SYNC_TABLES` includes `"starred_items"`.
- `SyncPruningJob` runs on the hourly scheduler and prunes tombstoned rows (`deleted_at IS NOT NULL` and `deleted_at < datetime('now', '-N days')` where $N =$ `sync_event_retention_days`).
- Enforces defensive `user_seq <= max_user_seq` invariant before deleting rows.

---

## 13. Current Membership Check

**Location:** `server/src/starred/write.rs` (lines 43–52)

- Executes `SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?`.
- Non-members trigger `StarError::RoomNotFound` -> HTTP `404 Not Found` (`room_not_found`).

---

## 14. Current `item_type` Validation

**Location:** `server/src/starred/write.rs` (`validate_item_type`)

- Validates against allowlist `["attachment", "message", "link"]`.
- Invalid string triggers `StarError::InvalidItemType` -> HTTP `400 Bad Request` (`invalid_item_type`).

---

## 15. Current Idempotency

**Location:** `server/src/starred/write.rs` (lines 54–121)

- **Active Star Re-star:** If active star exists (`deleted_at.is_none()`), returns existing row, `is_created = false`, HTTP `200 OK`, without bumping `user_seq`.
- **Tombstoned Star Re-star:** Clears `deleted_at`, updates `starred_at = now`, allocates new `user_seq`, `is_created = true`, HTTP `201 Created`.

---

## 16. Existing Tests

**Manifest Assignment:** `starred_items` batch in `server/tests/batch-manifest.toml`

**Test Files:**
- `server/tests/starred_items.rs` (5 tests covering CRUD, spec cursor, limit enforcement, validation, sync, GDPR).
- `server/tests/sync_foundation.rs`, `server/tests/sync_endpoint.rs`, `server/tests/sync_contract.rs` (sync state verification).
- `server/tests/cleanup.rs` (tombstone pruning verification).
- `server/tests/capabilities_audit.rs` (capabilities verification).
- `server/tests/migration_schema.rs` (schema verification).

---

## 17. V2 Remnants Audit

- **Cursor Format:** Uses standard opaque base64url JSON with `user_id` validation. No legacy cursor remnants found.
- **Event Shapes:** `starred_item.removed` cleanly omits `room_id`; `starred_item.added` includes `room_id`. No legacy payload remnants found.
- **Membership & Limit Rules:** Strictly enforced on all endpoints.

---

## Conclusion & Action Plan

The current codebase is in **100% alignment** with Server Specification v3.0.3 and the V2 Task 42 canonical fact. No production code changes or spec amendments are required.

To ensure comprehensive regression coverage for V3-specific concerns, we will expand `server/tests/starred_items.rs` with additional assertions covering:
1. Asymmetry assertions: `starred_item.removed` payload strictly omits `room_id` while `starred_item.added` includes `room_id`.
2. Opaque cursor stability across page boundaries with tie-breaking on `(item_id, item_type)`.
3. Cursor from a different `user_id` returning HTTP 400 `invalid_cursor`.
4. Re-star of a tombstoned item allocating new `user_seq` vs. active item re-star returning HTTP 200 without bumping `user_seq`.
5. Active vs tombstoned star count limit semantics.
6. Rate limit enforcement (31st request returns HTTP 429).
7. Non-member POST returning HTTP 404 `room_not_found`.
8. Invalid `item_type` returning HTTP 400 `invalid_item_type`.
9. Response header `Cache-Control: no-store` verification on `GET`, `POST`, and `DELETE`.
