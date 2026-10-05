# Step 0 Empirical Verification: Sync Pruning and Bot Settings Type

## 1. Current `BotSettingSyncRow` Type

`BotSettingSyncRow` struct exists in `server/src/sync/query.rs`:

```rust
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct BotSettingSyncRow {
    pub bot_id: String,
    pub key: String,
    pub is_secret: bool,
    pub value_encrypted_client: Option<String>,
    pub user_seq: i64,
}
```

- `SyncResponse` in `server/src/sync/query.rs` uses `pub bot_settings: Vec<BotSettingSyncRow>`.
- `is_secret` is a Rust `bool`, serializing to JSON `true`/`false` rather than an integer.

## 2. Current `read.sync` Publish Site

Located in `server/src/sync/read_state.rs` (lines 107–113):

```rust
    let payload = serde_json::json!({
        "room_id": req.room_id,
        "last_read_message_id": result_row.last_read_message_id,
        "user_seq": result_row.user_seq,
    });
    let envelope = UserEventEnvelope::new("read.sync", result_row.user_seq, payload);
    if let Err(e) = publish_user_event(publisher, &req.user_id, &envelope).await {
        tracing::warn!(error = %e, user_id = %req.user_id, "read.sync publish failed");
    }
```

The payload is strictly `{ "room_id", "last_read_message_id", "user_seq" }`. `updated_at` is absent from the published payload.

## 3. Current Cleanup Job Registry

`server/src/cleanup/` directory structure:
- `mod.rs`: Defines `CleanupJob` trait, `CleanupContext`, `CleanupReport`, and `Scheduler`.
- `attachments.rs`
- `audit.rs`
- `memory.rs`
- `oprf_audit.rs`
- `rate_limits.rs`
- `sessions.rs`
- `sync.rs`
- `welcomes.rs`

Jobs register on the shared hourly scheduler in `server/src/main.rs`:
`scheduler.register(Box::new(server::cleanup::sync::SyncPruningJob));`

## 4. Current Tombstone Pruning

`SyncPruningJob` exists in `server/src/cleanup/sync.rs`. Currently, it prunes tombstones for `read_state`, `device_names`, and `starred_items`.
To fulfill all task requirements:
- Expand check across all 6 sync tables (`read_state`, `user_preferences`, `user_room_order`, `device_names`, `starred_items`, `bot_settings`).
- Dynamically check if tables exist and possess a `deleted_at` column.
- Enforce defensive invariant: `user_seq <= (SELECT next_seq - 1 FROM user_seq WHERE user_id = <table>.user_id)`.
- Log deleted counts per table at `info` level without row contents.

## 5. Current Retention Boundary Evaluation

Retention boundary logic lives in `is_full_resync_required` (`server/src/sync/query.rs`).
- Recomputed fresh from SQLite on every `GET /users/me/sync` request (no in-memory caching).
- Determines `min_seq` across active/retained rows in sync tables. If `since_seq < min_seq`, returns `full_resync_required = true`.
- Evaluates if state with `user_seq <= since_seq` has timestamps older than `sync_event_retention_days`.

## 6. Current Test Coverage

- Sync contract and foundation tests: `server/tests/sync_contract.rs`, `server/tests/sync_foundation.rs`, registered under `sync` batch in `server/tests/batch-manifest.toml`.
- Cleanup scheduler and job tests: `server/tests/cleanup.rs`, registered under `operations` batch.

## 7. V2 Remnants

- `read.sync` with `updated_at`: None found in `server/src/`.
- `bot_settings` as `Vec<serde_json::Value>`: None found in `server/src/`.
