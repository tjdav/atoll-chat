# Empirical Verification Report: Pending MLS Adds Coordination with Bot Targets

**Date:** 2025-02-12
**Task:** Pending MLS Adds Coordination with Bot Targets (§11 Phase 14)

---

### 1. Current `pending_mls_adds` Table
In `server/migrations/0001_v2_schema.sql` (lines 228–237):
```sql
CREATE TABLE IF NOT EXISTS pending_mls_adds (
    id               TEXT PRIMARY KEY,
    room_id          TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    target_user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_client_id TEXT NOT NULL,
    key_package_id   TEXT NOT NULL REFERENCES key_packages(id),
    queued_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    consumed_at      DATETIME
);
CREATE INDEX IF NOT EXISTS idx_pending_mls_adds_active ON pending_mls_adds(room_id, consumed_at) WHERE consumed_at IS NULL;
```
**Findings:** `target_bot_id` is missing, `target_user_id` is defined as `NOT NULL`, and no `CHECK` constraint exists for target XOR selection.

---

### 2. Current `POST /rooms/:id/members` Handler
In `server/src/rooms.rs` (`add_member`, lines 1333–1402):
- Queries target user devices from `devices WHERE user_id = ?`.
- Finds an unconsumed key package for each user device (`WHERE user_id = ? AND client_id = ? AND consumed = 0`).
- Marks non-last-resort key packages as consumed (`consumed = 1, consumed_at = CURRENT_TIMESTAMP`).
- Inserts `pending_mls_adds` row with `target_user_id`.
- Collects `added_client_ids` and publishes `mls.add_pending` in `server/src/routes/rooms.rs`.
- Does not inspect or set `target_bot_id`.

---

### 3. Current `GET /rooms/:id/pending-adds` Handler
In `server/src/rooms.rs` (`list_pending_adds`, lines 1132–1171):
- Selects `id, target_user_id, target_client_id, key_package_id, queued_at` where `consumed_at IS NULL`.
- `PendingAddView` struct has:
  ```rust
  pub struct PendingAddView {
      pub id: String,
      pub target_user_id: String,
      pub target_client_id: String,
      pub key_package_id: String,
      pub queued_at: DateTime<Utc>,
  }
  ```
- `target_bot_id` is absent. Response body shape is `{"pending_adds": [...]}` with `Cache-Control: no-store` header set in `server/src/routes/rooms.rs`. Requires room membership (returns 404 `room_not_found` / `NotAMember` for non-members).

---

### 4. Current `POST /rooms/:id/pending-adds/:add_id/consume` Handler
In `server/src/rooms.rs` (`consume_pending_add`, lines 1174–1220) and `server/src/routes/rooms.rs`:
- Marks `consumed_at = CURRENT_TIMESTAMP`.
- Returns `{ "id": add_id, "consumed_at": timestamp }` with `Cache-Control: no-store`.
- Error responses: 404 `pending_add_not_found`, 409 `already_consumed`, 404 `room_not_found` for non-members.

---

### 5. Current `mls.add_pending` Publish Site
In `server/src/routes/rooms.rs` (lines 405–418):
```rust
let mls_add_payload = json!({
    "room_id": id,
    "target_user_id": payload.user_id,
    "client_ids": outcome.added_client_ids,
});
```
Published on `private-room-{room_id}` channel. Omits `target_bot_id` field.

---

### 6. Current `room_bots` and `bot_accounts` Schemas
In `server/migrations/0001_v2_schema.sql` (lines 423–444, added in Phase 11):
```sql
CREATE TABLE IF NOT EXISTS bot_accounts (
    id                  TEXT PRIMARY KEY,
    display_name        TEXT NOT NULL,
    avatar_file_id      TEXT,
    owner_user_id       TEXT NOT NULL REFERENCES users(id),
    disabled_at         DATETIME,
    deleted_at          DATETIME
);

CREATE TABLE IF NOT EXISTS room_bots (
    room_id    TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    bot_id     TEXT NOT NULL REFERENCES bot_accounts(id) ON DELETE CASCADE,
    mode       TEXT NOT NULL CHECK(mode IN ('write_only', 'observer', 'member')),
    granted_by TEXT NOT NULL REFERENCES users(id),
    granted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    revoked_at DATETIME,
    PRIMARY KEY (room_id, bot_id)
);
```
Minimal schemas exist and satisfy foreign key constraints.

---

### 7. Current Bot Grant Endpoints
`POST /rooms/:id/bots`, `PATCH /rooms/:id/bots/:bot_id`, `DELETE /rooms/:id/bots/:bot_id` do **not** exist in the codebase.

---

### 8. Current Key Package Selection
Key package selection in `server/src/key_packages.rs` and `server/src/rooms.rs` queries `key_packages` using `user_id = ? AND client_id = ?`. Selection logic is currently user-device bound.

---

### 9. Current `key_packages` Schema
In `server/migrations/0001_v2_schema.sql` (lines 192–204):
```sql
CREATE TABLE IF NOT EXISTS key_packages (
    id             TEXT PRIMARY KEY,
    user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    client_id      TEXT NOT NULL,
    cipher_suite   INTEGER NOT NULL DEFAULT 1,
    key_package    BLOB NOT NULL,
    init_key_hash  BLOB,
    is_last_resort INTEGER NOT NULL DEFAULT 0,
    consumed       INTEGER NOT NULL DEFAULT 0,
    consumed_at    DATETIME,
    created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```
**Justification for Extension:** `user_id` is currently `NOT NULL`. Bot key packages belong to bot accounts (`bot_id`). To allow bot accounts to upload and maintain key packages, `key_packages` must be updated to make `user_id` nullable, add `bot_id TEXT REFERENCES bot_accounts(id) ON DELETE CASCADE`, and add `CHECK ((user_id IS NOT NULL AND bot_id IS NULL) OR (user_id IS NULL AND bot_id IS NOT NULL))`.

---

### 10. Current `mls.add_pending` Fanout
Event is published exclusively to the room channel `private-room-{room_id}` as a best-effort Sockudo message. There is no whisper/user channel fanout for this event.

---

### 11. Existing Tests & Batch Assignment
Tests in `server/tests/pending_adds.rs` (12 tests):
- `test_list_pending_adds_requires_room_membership`
- `test_list_pending_adds_success`
- `test_list_pending_adds_empty_room`
- `test_consume_pending_add_success`
- `test_consume_pending_add_not_found`
- `test_consume_pending_add_already_consumed`
- `test_consume_pending_add_requires_membership`
- `test_pending_adds_ordering_and_filtering`
- `test_multiple_devices_for_added_member`
- `test_member_add_skips_device_with_no_key_package`
- `test_mls_add_pending_event_published_on_member_add`
- `test_mls_add_pending_publish_failure_does_not_fail_member_add`

**Batch Assignment:** `sockudo` batch in `server/tests/batch-manifest.toml`.

---

### 12. V2 Remnants
- `pending_mls_adds` schema has `target_user_id TEXT NOT NULL` without `target_bot_id` or XOR CHECK.
- `PendingAddView` struct has `pub target_user_id: String` (must be `Option<String>`) and lacks `pub target_bot_id: Option<String>`.
- `list_pending_adds` assumes `target_user_id` is always a non-null string.
- `mls.add_pending` event payload is hardcoded with `"target_user_id": payload.user_id` and missing `"target_bot_id"`.
