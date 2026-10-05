# Step 0 Empirical Verification Report: User-Scoped Sync Response Contract

## 1. Current `SyncResponse` Struct
Located in `server/src/sync/query.rs`:
```rust
#[derive(Debug, Clone, Serialize)]
pub struct SyncResponse {
    pub read_state: Vec<ReadStateRow>,
    pub user_preferences: Vec<PreferenceRow>,
    pub device_state: Vec<DeviceStateRow>,
    pub starred_items: Vec<StarredItemRow>,
    pub bot_settings: Vec<serde_json::Value>,
    pub max_seq: i64,
    pub full_resync_required: bool,
}
```
- Present arrays: `read_state`, `user_preferences`, `device_state`, `starred_items`, `bot_settings`.
- Currently `bot_settings` uses `Vec<serde_json::Value>`. To strictly match §8.2.4 typed contract, `BotSettingSyncRow` struct will be defined (`bot_id`, `key`, `is_secret`, `value_encrypted_client`, `user_seq`) and used as `Vec<BotSettingSyncRow>`.

## 2. Current `max_seq` Computation
Located in `server/src/sync/query.rs` (lines 78–84):
```rust
let highest_allocated: Option<i64> =
    sqlx::query_scalar("SELECT next_seq - 1 FROM user_seq WHERE user_id = ?")
        .bind(&query.user_id)
        .fetch_optional(pool)
        .await?;

let max_seq = std::cmp::max(query.since_seq, highest_allocated.unwrap_or(0));
```
- Queries `user_seq` table for `next_seq - 1` for the given `user_id`. If no row exists in `user_seq`, defaults to `0`.
- Takes `max(since_seq, highest_allocated)`, ensuring defensive protection against stale client cursors where `since_seq > next_seq - 1`.

## 3. Current `full_resync_required` Behavior
Located in `server/src/sync/query.rs` (lines 105–172):
- If `since_seq == 0`, returns `false`.
- If `since_seq > 0`:
  1. Checks minimum `user_seq` across active/tombstoned sync tables (`read_state`, `user_preferences`, `device_names`, `starred_items`). If `since_seq < min_seq`, returns `true` (since_seq is below minimum retained sequence).
  2. Checks if any timestamp corresponding to `user_seq <= since_seq` is older than `sync_event_retention_days` (`datetime('now', '-N days')`). If so, returns `true`.
- Evaluation logic is in place, but relies on tombstone pruning to advance the retention boundary.

## 4. Current `sync_event_retention_days` Source
- Declared in `server/src/config.rs`: `Config::sync_event_retention_days` (default `90`).
- Configured via env var `SYNC_EVENT_RETENTION_DAYS`.
- Passed from `server/src/routes/sync.rs` into `SyncQuery`.

## 5. Current `read.sync` Payload
Located in `server/src/sync/read_state.rs` (lines 108–113):
```json
{
  "room_id": "...",
  "last_read_message_id": "...",
  "user_seq": 123,
  "updated_at": "2025-10-05T10:35:00Z"
}
```
- **Discrepancy against §8.9**: Includes `updated_at` field which is not present in §8.9.
- **Target Payload**: `{ "room_id": "...", "last_read_message_id": "...", "user_seq": 123 }`.

## 6. Current Tombstone Retention
- Spec §4.5 requires: "Sync state pruning `sync_event_retention_days`: Deletes rows older than the window whose user_seq is below the current max".
- Currently, no `SyncPruningJob` exists in `server/src/cleanup/` to delete tombstones where `deleted_at < datetime('now', '-N days')`.
- Deliverable 5 will add `SyncPruningJob` in `server/src/cleanup/sync.rs` registered on the shared hourly scheduler.

## 7. Current `full_resync_required` Client Handling
- Documented in `server/src/sync/query.rs` and `server-spec-v3.md` §6.22:
  If `{ "full_resync_required": true }` is returned, the client discards its cursor and refetches all current state (`since_seq = 0`).

## 8. V2 Remnants
- None. `max_seq` is computed from `user_seq.next_seq - 1` and retention window evaluation is fully sequence-based.
