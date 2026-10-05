# Step 0 Empirical Verification Report: User-Scoped Sync Foundation

## 1. Current `user_seq` Table
The `user_seq` table is present in `server/migrations/0001_v2_schema.sql` (lines 23–26). Its exact definition is:
```sql
CREATE TABLE IF NOT EXISTS user_seq (
    user_id     TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    next_seq    INTEGER NOT NULL DEFAULT 1
);
```
This definition matches V3 §7.2 exactly.

## 2. Current `read_state` Table
The `read_state` table is present in `server/migrations/0001_v2_schema.sql` (lines 181–190). Its exact definition is:
```sql
CREATE TABLE IF NOT EXISTS read_state (
    user_id              TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    room_id              TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    last_read_message_id TEXT,
    user_seq             INTEGER NOT NULL,
    updated_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at           DATETIME,
    PRIMARY KEY (user_id, room_id)
);
CREATE INDEX IF NOT EXISTS idx_read_state_seq ON read_state(user_id, user_seq);
```
It includes the `user_seq` column and the required `idx_read_state_seq` index. This matches V3 §7.2.

## 3. Current `GET /users/me/sync`
- **Handler**: `get_sync` in `server/src/routes/sync.rs`, which calls `sync::execute_sync` in `server/src/sync/query.rs`.
- **Query Parameters**: Requires `since_seq` (integer >= 0; missing, negative, or malformed parameters return HTTP 400 `invalid_since_seq`).
- **Response Shape**:
  ```json
  {
    "read_state": [ ... ],
    "user_preferences": [ ... ],
    "device_state": [ ... ],
    "starred_items": [ ... ],
    "max_seq": <integer>,
    "full_resync_required": <bool>
  }
  ```
  Note: `bot_settings` array is currently missing from `SyncResponse` and will be added as `bot_settings: []`.
- **Returned Resources**: Returns `read_state`, `user_preferences`, `device_state`, and `starred_items`.
- **`since_seq` Handling**: When `since_seq = 0`, calls `list_read_state_all` (returns active rows, excluding tombstones). When `since_seq > 0`, calls `list_read_state_since` (returns delta rows where `user_seq > since_seq`, including tombstones).
- **`max_seq`**: Currently computes the maximum `user_seq` across returned rows and `since_seq`. Will be updated to return the user's highest allocated `user_seq` (`next_seq - 1` from `user_seq`, or 0 if no rows exist) or `since_seq` if `since_seq` is higher.
- **`full_resync_required`**: Currently hardcoded to `false`. Will be updated to check whether `since_seq` is older than the retention window (`sync_event_retention_days`, default 90).

## 4. Current User Channel Publishing
- **Publishing Helper**: `publish_user_event` in `server/src/sync/envelope.rs` publishes `UserEventEnvelope` on channel `private-user-{user_id}` via Sockudo publisher.
- **Envelope Structure**:
  ```rust
  pub struct UserEventEnvelope {
      pub event_type: String,
      pub user_seq: i64,
      pub payload: serde_json::Value,
      pub emitted_at: DateTime<Utc>,
  }
  ```
- **Events carrying `user_seq`**: `read.sync`, `room_order.sync`, `preference.updated`, `starred_item.added`, `starred_item.removed`, `device.name_updated`.

## 5. Current Sequence Allocator
- **Allocator**: `allocate_user_seq` in `server/src/sync/seq.rs`.
- **Contract**: Accepts `tx: &mut sqlx::SqliteConnection` and `user_id: &str`. Executes an atomic upsert:
  ```sql
  INSERT INTO user_seq (user_id, next_seq) VALUES (?, 2)
  ON CONFLICT(user_id) DO UPDATE SET next_seq = next_seq + 1
  RETURNING next_seq - 1
  ```
- **Transactionality**: Called inside the SQLite write transaction before row insertion/update. If the transaction rolls back, `next_seq` remains unchanged and no sequence number is consumed.

## 6. Current Tombstone Handling
- **Mechanism**: Deleted rows are updated with `deleted_at = CURRENT_TIMESTAMP` and a newly allocated `user_seq`.
- **Sync Behavior**: `GET /users/me/sync?since_seq=N` (`N > 0`) queries `WHERE user_id = ? AND user_seq > ?`, returning tombstoned rows with `deleted_at` set so clients can apply deletions locally. `since_seq = 0` excludes tombstones.

## 7. Current `read.sync` Event
- In `server/src/sync/read_state.rs`, `write_read_state` constructs:
  ```json
  {
    "room_id": req.room_id,
    "last_read_message_id": result_row.last_read_message_id,
    "user_seq": result_row.user_seq,
    "updated_at": result_row.updated_at
  }
  ```
- Wrapped in `UserEventEnvelope` with `event_type = "read.sync"` and `user_seq`, then published to `private-user-{user_id}`.

## 8. V2 Remnants
- None. All user-scoped state channels and handlers in V3 use `user_seq` and sequence-synced events on `private-user-{user_id}`.
