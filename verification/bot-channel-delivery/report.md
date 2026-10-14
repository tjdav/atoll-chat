# Step 0 Report — Bot Channel Delivery Guarantee

**Date:** 2026-10-14
**Task:** Bot Channel Delivery Guarantee

---

### 1. Current `user_seq` Table and Allocator

#### `user_seq` Table Schema (`server/migrations/0001_v2_schema.sql`):
```sql
CREATE TABLE IF NOT EXISTS user_seq (
    user_id     TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    next_seq    INTEGER NOT NULL DEFAULT 1
);
```

#### `allocate_user_seq` Function (`server/src/sync/seq.rs`):
```rust
pub async fn allocate_user_seq(
    tx: &mut sqlx::SqliteConnection,
    user_id: &str,
) -> Result<i64, SyncError> {
    let next: i64 = sqlx::query_scalar(
        "INSERT INTO user_seq (user_id, next_seq) VALUES (?, 2)
         ON CONFLICT(user_id) DO UPDATE SET next_seq = next_seq + 1
         RETURNING next_seq - 1",
    )
    .bind(user_id)
    .fetch_one(&mut *tx)
    .await?;

    Ok(next)
}
```
**Transaction Signature:** `tx: &mut sqlx::SqliteConnection`. Returns `Result<i64, ...>`.
This task's `allocate_bot_seq` will mirror this signature and query logic using the `bot_seq` table.

---

### 2. Current User Sync Endpoint

- **Handler:** `get_sync` in `server/src/routes/sync.rs`, invoking `execute_sync` in `server/src/sync/query.rs`.
- **Response Struct (`SyncResponse` in `server/src/sync/query.rs`):**
  ```rust
  pub struct SyncResponse {
      pub read_state: Vec<ReadStateRow>,
      pub user_preferences: Vec<PreferenceRow>,
      pub device_state: Vec<DeviceStateRow>,
      pub starred_items: Vec<StarredItemRow>,
      pub bot_settings: Vec<BotSettingSyncRow>,
      pub room_order: Option<RoomOrderSyncState>,
      pub max_seq: i64,
      pub full_resync_required: bool,
  }
  ```
- **`max_seq` Computation:**
  ```rust
  let highest_allocated: Option<i64> =
      sqlx::query_scalar("SELECT next_seq - 1 FROM user_seq WHERE user_id = ?")
          .bind(&query.user_id)
          .fetch_optional(pool)
          .await?;
  let max_seq = std::cmp::max(query.since_seq, highest_allocated.unwrap_or(0));
  ```
- **`full_resync_required` Logic:**
  Returns `true` if `since_seq` is smaller than `min_retained_seq` across all sync tables for the user, or if any row corresponding to `user_seq <= since_seq` has a timestamp older than `retention_days`.
- **Bot Sync Adaptation:**
  For `GET /bots/me/sync?since_bot_seq=N`, `max_bot_seq` computes `std::cmp::max(since_bot_seq, highest_allocated.unwrap_or(0))` from `bot_seq`, and `full_resync_required` compares `since_bot_seq` against the minimum `bot_seq` in `bot_event_log` for the bot or checks if retained log rows are older than 24 hours.

---

### 3. Current Bot Channel Publishers

#### `bot.command_invoked`:
- **File & Handler:** `post_bot_command` in `server/src/routes/room_bots.rs` (lines 987–1005).
- **Call Site:**
  ```rust
  let event_payload = json!({
      "command_id": command_id,
      "room_id": room_id,
      "sender_user_id": auth_user.user_id,
      "sender_client_id": sender_client_id,
      "ciphertext": ciphertext_trimmed,
      "ephemeral_result_pubkey": erpk_trimmed,
  });

  Publisher::publish(
      &state.publisher,
      &format!("private-bot-{}", bot_id),
      "bot.command_invoked",
      event_payload,
  ).await;
  ```

#### `bot.settings_updated`:
- **File & Handlers:** `update_bot_setting` and `delete_bot_setting` in `server/src/bots/settings.rs` (lines 300–310, 368–378).
- **Call Site:**
  ```rust
  let bot_payload = json!({
      "bot_id": bot_id,
      "keys_changed": [key],
      "user_seq": user_seq
  });

  Publisher::publish(
      publisher,
      &format!("private-bot-{}", bot_id),
      "bot.settings_updated",
      bot_payload,
  ).await;
  ```

---

### 4. Current Non-Durable Bot Channel Publishers

- `bot.grant_updated`: Published in `server/src/routes/room_bots.rs` (line 575).
- `bot.updated`: Published in `server/src/routes/bots.rs` and `server/src/routes/room_bots.rs`.
- `bot.keys_rotated`: Published on `private-bot-{bot_id}` in `server/src/routes/bots.rs` (line 1966) (non-durable on bot channel; durable copy on owner user channel).
- `room.publisher_key_updated`: Published on bot channel in `server/src/routes/publisher_keys.rs` (line 315).

**Confirmation:** None of these non-durable events allocate `bot_seq` or write to `bot_event_log`. They remain live-only and are un-modified by this task.

---

### 5. Current `bot_accounts` Schema

```sql
CREATE TABLE IF NOT EXISTS bot_accounts (
    id                  TEXT PRIMARY KEY,
    display_name        TEXT NOT NULL,
    avatar_file_id      TEXT,
    bot_identity_pubkey TEXT NOT NULL,
    bot_command_pubkey  TEXT NOT NULL,
    identity_pubkey     TEXT NOT NULL,
    owner_user_id       TEXT NOT NULL REFERENCES users(id),
    declarations        TEXT,
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    disabled_at         DATETIME,
    deleted_at          DATETIME
);
```
**FK Target:** `bot_accounts(id)` is the target for `bot_seq.bot_id` and `bot_event_log.bot_id` with `ON DELETE CASCADE`.

---

### 6. Current Bot Token Authentication

- **`resolve_caller`:** Function in `server/src/routes/bots.rs` extracts the Bearer token from the `Authorization` header.
- **Pattern:** Calls `validate_bot_token(pool, raw_token)` from `server/src/bots/auth.rs`. If a valid bot token is found, returns `CallerIdentity::Bot(BotAuthCtx)`. Otherwise falls back to user session validation and returns `CallerIdentity::User(AuthUser)`.
- **Bot Sync Requirement:** `GET /bots/me/sync` requires `CallerIdentity::Bot(ctx)`. If `resolve_caller` yields `CallerIdentity::User(_)`, the endpoint returns `401 Unauthorized` (`ApiError::Unauthorized("unauthorized".into())`).

---

### 7. Current Cleanup Job Registry

- **Registry & Interface:** Defined in `server/src/cleanup/mod.rs` (`CleanupJob` trait, `Scheduler::register`).
- **Jobs:** Located in `server/src/cleanup/*.rs` (e.g. `bot_commands.rs`, `bot_request_log.rs`).
- **Registration Pattern (`server/src/main.rs`):**
  ```rust
  scheduler.register(Box::new(server::cleanup::bot_commands::BotCommandsTtlJob));
  scheduler.register(Box::new(server::cleanup::bot_request_log::BotRequestLogTtlJob));
  ```
- **New Job:** `BotEventLogTtlJob` will be defined in `server/src/cleanup/bot_event_log.rs` with `BOT_EVENT_LOG_RETENTION_HOURS = 24` and registered in `main.rs`.

---

### 8. Current `AppState`

- `AppState` in `server/src/lib.rs` holds `bot_connection_state: bots::BotConnectionState` for in-memory liveness tracking.
- **Confirmation:** Database-backed sequence and log tables (`bot_seq`, `bot_event_log`) do not require any new fields in `AppState`.

---

### 9. Current Transaction Patterns for Bot Events

- For `bot.command_invoked` in `post_bot_command` (`server/src/routes/room_bots.rs`):
  1. Transaction `tx` starts (`state.pool.begin().await`).
  2. `bot_commands` row inserted inside `tx`.
  3. `tx.commit().await` executes.
  4. `Publisher::publish` publishes `bot.command_invoked` live after commit.
- **New Pattern:**
  Inside `tx` (before commit), `prepare_durable_bot_event` calls `allocate_bot_seq` and `append_bot_event_log`, injecting `bot_seq` into the payload and inserting into `bot_event_log`. Then `tx.commit().await` executes. After commit, `Publisher::publish` sends the payload with `bot_seq`.

---

### 10. Current Event Payload Inclusion

- `bot.command_invoked` payload currently lacks sequence information.
- `bot.settings_updated` payload currently carries `user_seq` (operator's sequence) but lacks `bot_seq`.
- **Confirmation:** Adding `bot_seq` to both payloads is a non-breaking, additive change.

---

### 11. Current Test Harness

- Tests use `wiremock::MockServer` to mock Sockudo (`/apps/chat/events`).
- Mock server URL is configured in `Config.sockudo_url`.
- HTTP requests are sent via `axum::Router` (tower TestClient / oneshot).
- Published events are inspected using `mock_server.received_requests().await`.

---

### 12. Existing Tests & Batch Assignments

- `bot.command_invoked` is tested in `server/tests/bot_commands.rs`.
- `bot.settings_updated` is tested in `server/tests/bot_settings.rs`.
- Batch assignment: Both files belong to the `bots` batch in `server/tests/batch-manifest.toml`.
- The new integration test file `server/tests/bot_channel_delivery.rs` will also be assigned to the `bots` batch.

---

### 13. V2 Remnants

- `post_bot_command` (`server/src/routes/room_bots.rs`) publishes `bot.command_invoked` without allocating `bot_seq` or logging.
- `update_bot_setting` & `delete_bot_setting` (`server/src/bots/settings.rs`) publish `bot.settings_updated` without allocating `bot_seq` or logging.
- No existing code path assumes the bot channel has no sequence, but these existing publishers need updating to allocate `bot_seq` and append to `bot_event_log`.
