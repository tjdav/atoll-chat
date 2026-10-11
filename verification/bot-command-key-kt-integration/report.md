# Bot Command Key KT Integration Step 0 Empirical Report

## 1. Current `POST /rooms/:id/bot-messages` Handler

In `server/src/routes/room_bots.rs` (`post_bot_message`):
- The current SQL insert statement is:
  ```sql
  INSERT INTO room_messages (id, room_id, sender_bot_id, sender_client_id, bot_key_leaf_index, epoch, seq, content_type, ciphertext)
  VALUES (?, ?, ?, 'bot', ?, ?, ?, ?, ?)
  ```
- `bot_key_leaf_index` is queried via `current_bot_leaf_index_tx(&mut tx, bot_id)` inside the transaction and stored.
- `sender_bot_id` is set to `bot_id` and `sender_user_id` is omitted (null). `sender_client_id` is set to `'bot'` (derived as the bot's static connection client identifier).
- Per V3 §7.6 & §8.8.10, bot messages set `sender_bot_id = bot_id`, `sender_user_id = NULL`, and `bot_key_leaf_index` to the bot's currently active KT leaf index at insertion time.

## 2. Current `GET /rooms/:id/messages` Handler

In `server/src/routes/room_messages.rs` (`list`) and `server/src/room_messages.rs` (`list_messages`):
- `list_messages` queries `SELECT id, room_id, sender_user_id, sender_bot_id, sender_client_id, epoch, seq, content_type, reply_to, target_user_ids, edit_of, edit_sequence, bot_key_leaf_index, edited_at, deleted_at, created_at FROM room_messages`.
- `RoomMessageView` includes `sender_type` ("user" | "bot"), `sender_id` (user_id | bot_id), and `bot_key_leaf_index` (integer leaf index or `null`).

## 3. Current `GET /kt/bot/:id` Handler

In `server/src/routes/key_transparency.rs`:
- Endpoints `GET /kt/bot/:id` and `GET /kt/bot/:id/history` are mounted and registered in `server/src/lib.rs`.
- `GET /kt/bot/:id` queries `key_transparency_log` for the bot's current leaf and constructs the Merkle inclusion proof and tree head response including `bot_command_pubkey` (from `key_transparency_log.command_pubkey`).

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

In `server/src/key_transparency/log.rs`:
- `current_bot_leaf_index` (and `current_bot_leaf_index_tx`) helper function exists for finding a bot's current active leaf index running `SELECT MAX(leaf_index) FROM key_transparency_log WHERE bot_id = ?`.

## 7. Current `room_messages.bot_key_leaf_index` Type

In `server/migrations/0001_v2_schema.sql`:
- `bot_key_leaf_index INTEGER` (nullable).

## 8. Current Signature Verification on bot-messages

In `server/src/routes/room_bots.rs` (`post_bot_message`):
- Fetches `bot_identity_pubkey` from `bot_accounts WHERE id = ?`.
- Verifies Ed25519 signature over length-prefixed big-endian payload via `encode_bot_message_signing_input(&room_id, req.epoch as u64, &req.content_type, &decoded_ciphertext)` and `crate::signing::verify_publisher_key_signature(&bot_pubkey, &signing_input, &req.signature)`.

## 9. Current `POST /rooms/:id/bot-messages` Idempotency Wiring

In `server/src/routes/room_bots.rs` (`post_bot_message`):
- Uses `check_or_reserve_request_id` with `ENDPOINT_BOT_MESSAGES = 'bot-messages'`.
- Reservation and message insertion happen atomically inside a single SQLite transaction (`tx`).

## 10. Current `bot_commands` Handler

In `server/src/routes/room_bots.rs` (`post_bot_command`):
- Accepts base64url 32-byte `ephemeral_result_pubkey` and stores raw bytes in `bot_commands.ephemeral_result_pubkey`.
- Publishes `bot.command_invoked` carrying base64url-encoded `ephemeral_result_pubkey`.

## 11. Existing Tests

- `server/tests/bot_leaf_index.rs` (`bots` batch)
- `server/tests/kt_bot_endpoints.rs` (`identity` batch)
- `server/tests/bot_request_log.rs` (`bots` batch)
- `server/tests/bot_command_results.rs` (`bots` batch)
- `server/tests/kt_endpoints.rs` (`identity` batch)
- `server/tests/room_messages.rs` (`messaging` batch)

## 12. Step 0 Continuation Verification Checklist

Before implementation, all 7 continuation checklist items were empirically verified in the codebase:

1. **`append_bot_leaf` helper**: **Present** in `server/src/key_transparency/log.rs` (`append_bot_leaf`).
2. **`serialize_bot_leaf` and `bot_leaf_hash`**: **Present** in `server/src/key_transparency/merkle.rs`.
3. **`GET /kt/bot/:id` handler**: **Present** in `server/src/routes/key_transparency.rs`.
4. **`GET /kt/bot/:id/history` handler**: **Present** in `server/src/routes/key_transparency.rs`.
5. **Route registrations**: **Present** in `server/src/lib.rs` under `/kt/bot/{id}` and `/kt/bot/{id}/history`.
6. **`append_bot_leaf` call in `POST /bots`**: **Present** in `server/src/routes/bots.rs`.
7. **`room_messages` XOR CHECK constraint**: **Present** in `server/migrations/0001_v2_schema.sql` (`CHECK ((sender_user_id IS NOT NULL AND sender_bot_id IS NULL) OR (sender_user_id IS NULL AND sender_bot_id IS NOT NULL))`).

**Note on `sender_client_id` derivation:** On `POST /rooms/:id/bot-messages`, `sender_client_id` is set to `'bot'` representing the bot's client identity binding.
