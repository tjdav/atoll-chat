# Step 0 Report — Bot Key Rotation

This report establishes the baseline repository state before implementing Phase 38 (Bot Key Rotation, V3 Server Spec §8.8.17).

## 1. Current `PATCH /bots/:id/keys` handler
- **Status:** Absent.
- **Finding:** Currently, no route handler for `PATCH /bots/:id/keys` exists in `server/src/routes/bots.rs` or `server/src/lib.rs`.

## 2. Current `RATE_BOT_KEY_ROTATE_PER_HOUR` config
- **Status:** Absent.
- **Finding:** `Config` in `server/src/config.rs` contains rate limit parameters for `rate_bot_create_per_hour`, `rate_bot_grant_per_hour`, `rate_bot_token_issue_per_hour`, `rate_bot_command_per_min`, `rate_bot_message_per_min`, `rate_bot_command_result_per_min`, and `rate_bot_local_message_per_min`, but lacks `rate_bot_key_rotate_per_hour`. It must be added with default `5` reading `RATE_BOT_KEY_ROTATE_PER_HOUR`.

## 3. Current `RateLimitKey::BotKeyRotate` variant
- **Status:** Absent.
- **Finding:** `RateLimitKey` in `server/src/rate_limit.rs` does not currently include `BotKeyRotate`. Must be added as `RateLimitKey::BotKeyRotate { bot_id: String }` using key format `bot_key_rotate:{bot_id}:hour:{boundary}` with `Window::Hour` (%Y-%m-%d-%H).

## 4. Current `bot.keys_rotated` publishers
- **Status:** Absent.
- **Finding:** Searching `server/src/` for `keys_rotated` yields zero occurrences.

## 5. Current `bot.key_rotate` audit constant
- **Status:** Absent.
- **Finding:** `audit::action` in `server/src/audit.rs` contains `BOT_DECLARATION_UPDATE`, but not `BOT_KEY_ROTATE`. `pub const BOT_KEY_ROTATE: &str = "bot.key_rotate";` must be added.

## 6. Current `append_bot_leaf` helper signature
- **Status:** Present and callable inside transactions.
- **Location:** `server/src/key_transparency/log.rs` line 37.
- **Signature:**
  ```rust
  pub async fn append_bot_leaf(
      tx: &mut SqliteConnection,
      bot_id: &str,
      bot_identity_pubkey: &str,
      command_pubkey: &str,
      identity_pubkey: &str,
  ) -> Result<i64, ApiError>
  ```
- **Requirements:** Takes `&mut SqliteConnection` (or `&mut *tx`), inserts a row into `key_transparency_log` with `bot_id`, `bot_identity_pubkey`, `command_pubkey`, `identity_pubkey` (leaving `user_id` and `username_token` NULL), and returns the new `leaf_index`.

## 7. Current `current_bot_leaf_index` helper
- **Status:** Present.
- **Location:** `server/src/key_transparency/log.rs`.
- **Signatures:**
  ```rust
  pub async fn current_bot_leaf_index(
      pool: &SqlitePool,
      bot_id: &str,
  ) -> Result<Option<i64>, ApiError>

  pub async fn current_bot_leaf_index_tx(
      conn: &mut SqliteConnection,
      bot_id: &str,
  ) -> Result<Option<i64>, ApiError>
  ```

## 8. Current `bot_accounts` pubkey columns
- **Status:** Present, non-null, and updatable.
- **Schema:** Defined in `0001_v2_schema.sql` lines 504–508:
  - `bot_identity_pubkey TEXT NOT NULL`
  - `bot_command_pubkey TEXT NOT NULL`
  - `identity_pubkey TEXT NOT NULL`
- **Updatability:** Updatable via SQL `UPDATE bot_accounts SET bot_identity_pubkey = ?, bot_command_pubkey = ?, identity_pubkey = ? WHERE id = ? AND deleted_at IS NULL`.

## 9. Current `POST /bots` implementation
- **Location:** `server/src/routes/bots.rs::create_bot`.
- **Pattern:**
  1. Checks rate limit (`RateLimitKey::BotCreate`).
  2. Validates inputs (32-byte base64url for all three pubkeys via `validate_pubkey_32`).
  3. Starts transaction `state.pool.begin().await`.
  4. Calls `allocate_user_seq(&mut tx, &auth_user.user_id)`.
  5. Inserts into `bot_accounts` returning `created_at`.
  6. Inserts declared scopes into `bot_declared_scopes` and initial bot token into `bot_tokens`.
  7. Calls `append_bot_leaf(&mut tx, &bot_id, ...)`.
  8. Commits transaction.
  9. Publishes `bot.created` event on `private-user-{owner_user_id}` with `user_seq`.
  10. Returns 201 Created with `Cache-Control: no-store`.

## 10. Current `PATCH /bots/:id` handler
- **Location:** `server/src/routes/bots.rs::patch_bot`.
- **Auth Pattern:**
  1. Resolves caller via `resolve_caller(&state.pool, &headers, &state)`.
  2. Queries `owner_user_id` from `bot_accounts WHERE id = ? AND deleted_at IS NULL` (returns 404 `bot_not_found` if absent).
  3. Calls `caller.is_owner_or_bot(&bot_id, &owner_user_id)` (returns 403 `forbidden` if false).
  4. Accepts bot owner user session token or bot token where `bot_token.bot_id == :id`.

## 11. Current user-channel durable publish pattern
- **Pattern:**
  Inside transaction `tx`, calls `allocate_user_seq(&mut tx, &owner_user_id).await?`.
  After `tx.commit()`, publishes payload containing `"user_seq": user_seq` to `private-user-{owner_user_id}` via `Publisher::publish(&state.publisher, &format!("private-user-{}", owner_user_id), event_name, payload)`.

## 12. Current bot-channel non-durable publish pattern
- **Pattern:**
  Calls `Publisher::publish(&state.publisher, &format!("private-bot-{}", bot_id), event_name, payload)` without `user_seq`.

## 13. Current `room_messages.bot_key_leaf_index` behavior after bot key change
- **Status:** Frozen at message creation time.
- **Finding:** `POST /rooms/:id/bot-messages` records the result of `current_bot_leaf_index` into `room_messages.bot_key_leaf_index` upon insertion. No update or migration path exists in the codebase that alters `room_messages.bot_key_leaf_index` on existing rows.

## 14. Current behavior for `bot_settings` and `bot_commands` after rotation
- **Status:** No migration path exists.
- **Finding:** Existing `bot_settings.value_encrypted_bot` and `bot_commands.ciphertext` rows remain unchanged in the database. As specified in V3 Spec §6.31 and Phase 30, the server does not decrypt or re-encrypt settings/commands upon key rotation; clients/bots re-write settings or re-submit commands post-rotation.

## 15. Existing tests
- **Batch `bots` (`server/tests/batch-manifest.toml`):**
  - `bot_command_results.rs`
  - `bot_commands.rs`
  - `bot_declarations.rs`
  - `bot_leaf_index.rs`
  - `bot_local_messages.rs`
  - `bot_request_log.rs`
  - `bot_settings.rs`
  - `bots.rs`
  - `room_bots.rs`
- **Batch `identity`:**
  - `kt_bot_endpoints.rs`
- **New Test File:**
  - `server/tests/bot_key_rotation.rs` will be added under the `bots` batch in `server/tests/batch-manifest.toml`.

## 16. V2 remnants
- **Status:** None found.
- **Finding:** Zero code paths assume bot keys are immutable or rewrite `bot_key_leaf_index` on message history.
