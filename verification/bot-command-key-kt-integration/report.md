# Bot Command Key KT Integration Step 0 Empirical Report

## 1. Current `POST /rooms/:id/bot-messages` Handler

In `server/src/routes/room_bots.rs` (`post_bot_message`):
- The current SQL insert statement is:
  ```sql
  INSERT INTO room_messages (id, room_id, sender_user_id, sender_client_id, epoch, seq, content_type, ciphertext)
  VALUES (?, ?, ?, 'bot', ?, ?, ?, ?)
  ```
- `bot_key_leaf_index` is omitted from the column list, leaving its value as `NULL`.
- Currently, `sender_user_id` is bound to `owner_user_id` while `sender_bot_id` is `NULL`.
- Per V3 §7.6 & §8.8.10, bot messages must set `sender_bot_id = bot_id`, `sender_user_id = NULL`, and `bot_key_leaf_index` to the bot's currently active KT leaf index at insertion time.

## 2. Current `GET /rooms/:id/messages` Handler

In `server/src/routes/room_messages.rs` (`list`) and `server/src/room_messages.rs` (`list_messages`):
- `list_messages` queries `SELECT id, room_id, sender_user_id, sender_client_id, epoch, seq, content_type, reply_to, target_user_ids, edit_of, edit_sequence, edited_at, deleted_at, created_at FROM room_messages`.
- `RoomMessageView` does not currently include `sender_type`, `sender_id`, or `bot_key_leaf_index`.
- Per §8.5.1, the message fetch response must return `sender_type` ("user" | "bot"), `sender_id` (user_id | bot_id), and `bot_key_leaf_index` (integer leaf index or `null`).

## 3. Current `GET /kt/bot/:id` Handler

In `server/src/routes/key_transparency.rs`:
- Endpoints `GET /kt/bot/:id` and `GET /kt/bot/:id/history` are not yet mounted.
- When implemented, `GET /kt/bot/:id` queries `key_transparency_log` for the bot's current leaf and constructs the Merkle inclusion proof and tree head response including `bot_command_pubkey` (from `key_transparency_log.command_pubkey`).

## 4. Current `bot_accounts` Schema

In `server/migrations/0001_v2_schema.sql`:
- `bot_accounts` contains `bot_command_pubkey TEXT NOT NULL`, populated at creation time during `POST /bots` (`create_bot` in `server/src/routes/bots.rs`).
- No path permits `bot_command_pubkey` to be NULL.

## 5. Current `key_transparency_log` Schema

In `server/migrations/0001_v2_schema.sql`:
```sql
CREATE TABLE IF NOT EXISTS key_transparency_log (
    leaf_index           INTEGER PRIMARY KEY,
    user_id              TEXT REFERENCES users(id) ON DELETE CASCADE,
    bot_id               TEXT REFERENCES bot_accounts(id) ON DELETE CASCADE,
    username_token       TEXT,
    bot_identity_pubkey  TEXT,
    identity_pubkey      TEXT,
    command_pubkey       TEXT,
    added_at             DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (
        (user_id IS NOT NULL AND bot_id IS NULL)
        OR
        (user_id IS NULL AND bot_id IS NOT NULL)
    )
);
```
- `command_pubkey` stores `bot_command_pubkey` for bot leaves.
- `bot_identity_pubkey` stores `bot_identity_pubkey` for bot leaves.

## 6. Current KT Helper for Leaf Index Lookup

In `server/src/key_transparency/`:
- No helper function currently exists for finding a bot's current active leaf index.
- This task adds `pub async fn current_bot_leaf_index(pool: &SqlitePool, bot_id: &str) -> Result<Option<i64>, ApiError>` in `server/src/key_transparency/log.rs` running `SELECT MAX(leaf_index) FROM key_transparency_log WHERE bot_id = ?`.

## 7. Current `room_messages.bot_key_leaf_index` Type

In `server/migrations/0001_v2_schema.sql`:
- `bot_key_leaf_index INTEGER` (nullable).

## 8. Current Signature Verification on bot-messages

In `server/src/routes/room_bots.rs` (`post_bot_message`):
- Fetches `bot_identity_pubkey` from `bot_accounts WHERE id = ?`.
- Verifies Ed25519 signature over length-prefixed big-endian payload via `crate::signing::verify_publisher_key_signature(&bot_pubkey, &signing_input, &req.signature)`.

## 9. Current `POST /rooms/:id/bot-messages` Idempotency Wiring

In `server/src/routes/room_bots.rs` (`post_bot_message`):
- Uses `check_or_reserve_request_id` with `ENDPOINT_BOT_MESSAGES = 'bot-messages'`.
- Reservation and message insertion happen atomically inside a single SQLite transaction (`tx`).

## 10. Current `bot_commands` Handler

In `server/src/routes/room_bots.rs` (`post_bot_command`):
- Accepts base64url 32-byte `ephemeral_result_pubkey` and stores raw bytes in `bot_commands.ephemeral_result_pubkey`.
- Publishes `bot.command_invoked` carrying base64url-encoded `ephemeral_result_pubkey`.

## 11. Existing Tests

- `server/tests/bot_request_log.rs` (`bots` batch)
- `server/tests/bot_command_results.rs` (`bots` batch)
- `server/tests/kt_endpoints.rs` (`identity` batch)
- `server/tests/room_messages.rs` (`messaging` batch)

## 12. V2 Remnants

- `post_bot_message` setting `sender_user_id = owner_user_id` instead of `sender_bot_id = bot_id`.
- `post_bot_message` omitting `bot_key_leaf_index` from message insert.
- `list_messages` omitting `sender_type`, `sender_id`, and `bot_key_leaf_index` from fetch response.
- Missing `append_bot_leaf` call on `POST /bots` and missing `GET /kt/bot/:id` and `GET /kt/bot/:id/history` handlers in `server/src/routes/key_transparency.rs`.
