# Step 0 — Empirical Verification Report: Room Order Dedicated Table

**Task:** Phase 25 — Room Order Dedicated Table
**Spec Version:** Server Specification v3.0.3 (§7.2, §8.2.4, §8.2.6, §8.9, §14.2, §14.3)

---

## 1. Current `user_room_order` Table
- **Status:** Absent in `server/migrations/0001_v2_schema.sql`.
- **Target Schema (§7.2):**
  ```sql
  CREATE TABLE IF NOT EXISTS user_room_order (
      user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      room_id     TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      position    INTEGER NOT NULL,
      user_seq    INTEGER NOT NULL,
      updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, room_id)
  );
  CREATE INDEX IF NOT EXISTS idx_user_room_order_seq ON user_room_order(user_id, user_seq);
  ```
- **Action:** Add table definition and index directly to `server/migrations/0001_v2_schema.sql`.

## 2. Current `PATCH /users/me/room-order` Handler
- **Status:** Absent. No handler or route was present in `server/src/routes/` or `server/src/lib.rs`.
- **Target Contract (§8.2.6):**
  - Path: `PATCH /users/me/room-order`
  - Auth: Required (`AuthUser`)
  - Request: `{ "room_ids": ["r1", "r2", "r3"] }`
  - Response: `{ "room_ids": ["r1", "r2", "r3"], "user_seq": N }` (HTTP 200 OK)
  - `Cache-Control: no-store`

## 3. Current V2 Room-Order Storage
- **Status:** Evaluated. `server/src/sync/preferences.rs` already defines `RESERVED_KEYS = &["room_order"]`.
- **Behavior:** `room_order` is rejected when targeted via `/users/me/preferences/room_order` with HTTP 400 `reserved_key`. No dual storage or legacy preference fallback exists in code.

## 4. Current `room_order.sync` Event
- **Status:** Documented in `server/src/sync/envelope.rs` doc comments, but no active publisher existed in `server/src/`.
- **Target Event (§8.9):**
  - Event name: `room_order.sync`
  - Channel: `private-user-{user_id}` (durable)
  - Payload: `{ "room_ids": ["r1", "r2", "r3"], "user_seq": N }`
  - Envelope: carries `user_seq: N`

## 5. Current Sync Response Integration
- **Status:** Inspected `server/src/sync/query.rs`.
- **Current `SyncResponse` fields:** `read_state`, `user_preferences`, `device_state`, `starred_items`, `bot_settings`, `max_seq`, `full_resync_required`.
- **Integration:** Add `pub room_order: Option<RoomOrderSyncState>` to `SyncResponse`, where `RoomOrderSyncState` is `{ room_ids: Vec<String>, user_seq: i64 }`.
- **Filtering:** When `since_seq == 0`, return current `room_order` if rows exist (or `null`/`None` if none exist). When `since_seq > 0`, return `room_order` iff `user_seq > since_seq`.
- **`max_seq`:** `user_seq` from `user_room_order` participates in `max_seq` computation via `user_seq` sequence allocation table.

## 6. Current `user_seq` Allocation & No-Op Guard
- **No-Op Guard Rule:** If the requested `room_ids` matches the current stored room order array for the user byte-for-byte in exact order:
  - Do not allocate a new `user_seq`.
  - Do not perform database writes.
  - Do not publish `room_order.sync`.
  - Return current state `{ "room_ids": [...], "user_seq": N }` with HTTP 200 OK.
- **Write Path:** If different:
  - Open database transaction.
  - Allocate `user_seq` via `allocate_user_seq(tx, user_id)`.
  - `DELETE FROM user_room_order WHERE user_id = ?`.
  - `INSERT INTO user_room_order (user_id, room_id, position, user_seq, updated_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`.
  - Commit transaction.
  - Publish `room_order.sync` with `{ "room_ids": [...], "user_seq": N }`.

## 7. Current Last-Writer-Wins Behavior
- **Semantics:** Replaces all rows for `user_id` inside a single SQLite write transaction. Concurrent `PATCH` requests: the transaction committing last overwrites the room ordering entirely.

## 8. Current `room_ids` Validation
- **Rule:** Every `room_id` in `room_ids` must be a room where the user is an active member (`room_members` table).
- **Enforcement:** If any `room_id` is not a room the caller is a member of, reject the request with HTTP 403 `not_a_member`.

## 9. Current Empty `room_ids`
- **Behavior:** `{ "room_ids": [] }` is valid. It clears the user's room order (deletes all `user_room_order` rows), allocates `user_seq`, and publishes `room_order.sync` with `{ "room_ids": [], "user_seq": N }`.

## 10. Current Duplicate `room_ids`
- **Behavior:** Rejects request containing duplicate `room_id` entries with HTTP 400 `invalid_room_ids`.

## 11. Current Size Limits
- **Behavior:** Length of `room_ids` array must not exceed effective `rooms_per_user` limit resolved via `limits::get_limits(&state.pool, &state.server_hard_max)`. Exceeding limit rejects with HTTP 400 `too_many_rooms`.

## 12. Current GDPR Integration
- **Deletion (`anonymise_user` in `server/src/gdpr.rs`):** Add `DELETE FROM user_room_order WHERE user_id = ?` to transaction. Assert no residual rows remain.
- **Export (`build_export` in `server/src/gdpr.rs`):** Include `room_order.json` containing `{ "room_ids": [...], "user_seq": N, "updated_at": "..." }` or `{ "room_order": null }`.

## 13. Current Sync Pruning Coverage
- **Behavior:** `SyncPruningJob` in `server/src/cleanup/sync.rs` already iterates over `"user_room_order"`. Because `user_room_order` has no `deleted_at` column, `SyncPruningJob` logs `skipping sync table pruning (table absent or missing deleted_at column) table="user_room_order"`. This is correct for the physical set-replacement model.

## 14. Current Preferences Reserved-Key Enforcement
- **Behavior:** `server/src/sync/preferences.rs` includes `RESERVED_KEYS = &["room_order"]`. Requesting `PATCH /users/me/preferences/room_order` returns HTTP 400 `reserved_key`.

## 15. Existing Tests
- `server/tests/cleanup.rs` (Batch: `operations`): Asserts `user_room_order` skipping in sync pruning.
- `server/tests/preferences_validation.rs` (Batch: `sync`): Asserts `room_order` reserved key rejection.
- New test file: `server/tests/room_order.rs` will be added to the `sync` batch in `server/tests/batch-manifest.toml`.

## 16. V2 Remnants
- No remnants found in codebase. Dual storage is prohibited and preference shadow storage is blocked by reserved keys.
