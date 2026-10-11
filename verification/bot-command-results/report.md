# Step 0 — Empirical Verification Report: Bot Command Results

**Phase / Task:** Phase 44 — Bot Command Results (`POST /bots/me/messages` invoker target, `bot.command_result`, `bot_commands` schema extension)
**Date:** 2026-10-11
**Specification Reference:** Server Specification v3.0.3 §5.6, §6.31, §7.10, §8.8.10, §8.8.11, §8.8.12, §8.9, §12

---

## 1. Current `bot_commands` Table Schema

The current definition of `bot_commands` in `server/migrations/0001_v2_schema.sql` (lines 554–565) is:

```sql
CREATE TABLE IF NOT EXISTS bot_commands (
    id               TEXT PRIMARY KEY,
    bot_id           TEXT NOT NULL REFERENCES bot_accounts(id) ON DELETE CASCADE,
    room_id          TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    sender_user_id   TEXT NOT NULL REFERENCES users(id),
    sender_client_id TEXT NOT NULL,
    ciphertext       BLOB NOT NULL,
    created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    delivered_at     DATETIME,
    acked_at         DATETIME,
    expired_at       DATETIME
);
```

**Verification:** Confirmed absence of `ephemeral_result_pubkey`, `result_at`, and `result_type` columns in the baseline migration.

---

## 2. Current `POST /rooms/:id/bot-commands` Handler

Located in `server/src/routes/room_bots.rs`:

```rust
#[derive(Deserialize)]
pub struct PostBotCommandReq {
    pub bot_id: String,
    pub ciphertext: String,
    pub request_id: Option<String>,
}
```

**Verification:** Confirmed the request body struct accepts only `bot_id`, `ciphertext`, and `request_id`. It does not accept `ephemeral_result_pubkey`.

---

## 3. Current `bot.command_invoked` Payload

Located in `server/src/routes/room_bots.rs` (`post_bot_command`):

```rust
let event_payload = json!({
    "command_id": command_id,
    "room_id": room_id,
    "sender_user_id": auth_user.user_id,
    "sender_client_id": sender_client_id,
    "ciphertext": ciphertext_trimmed,
});
```

**Verification:** Confirmed that `ephemeral_result_pubkey` is currently missing from the event payload.

---

## 4. Current `POST /bots/me/messages` Handler

**Verification:** Confirmed absence. The route `/bots/me/messages` is not registered in `server/src/lib.rs` and no handler exists in `server/src/routes/bots.rs` or elsewhere in `server/src/`.

---

## 5. Current `bot.command_result` Publisher

**Verification:** Confirmed absence. No code in `server/src/` publishes `bot.command_result`.

---

## 6. Current `RATE_BOT_COMMAND_RESULT_PER_MIN` Config

**Verification:** Confirmed absence in `server/src/config.rs` and `server/src/rate_limit.rs`. Must be added with default value `120` per §5.6.

---

## 7. Current `RATE_BOT_LOCAL_MESSAGE_PER_MIN` Config

**Verification:** Confirmed absence in `server/src/config.rs`. Must be added with default value `60` per §5.6.

---

## 8. Current Idempotency Helper

Located in `server/src/bots/idempotency.rs`:

```rust
pub const ENDPOINT_BOT_MESSAGES: &str = "bot-messages";
pub const ENDPOINT_BOT_COMMANDS: &str = "bot-commands";
```

Exposes `check_or_reserve_request_id`, `record_response_code`, and `validate_request_id`.

**Verification:** `ENDPOINT_BOT_COMMAND_RESULT` ("bot-command-result") must be added for deduplication under `POST /bots/me/messages`.

---

## 9. Current Bot Token Auth

Located in `server/src/routes/bots.rs` (`resolve_caller`):

- Reads `Authorization: Bearer <token>`.
- Calls `validate_bot_token(pool, raw_token)` returning `CallerIdentity::Bot(bot_ctx)` if valid.
- Otherwise falls back to `validate_session` returning `CallerIdentity::User(auth_user)`.

---

## 10. Current `acked_at` Semantics

Located in `server/src/routes/bots.rs` (`ack_bot_command`):

```rust
if acked_at.is_none() {
    sqlx::query("UPDATE bot_commands SET acked_at = CURRENT_TIMESTAMP WHERE id = ?")
        .bind(&command_id)
        .execute(&state.pool)
        .await?;
}
```

Sets `acked_at` timestamp on `bot_commands` idempotently. §8.8.12 requires `POST /bots/me/messages` (invoker target) to verify `acked_at IS NOT NULL` before delivering a result (returning 409 `command_not_acked` if null).

---

## 11. Current Channel Publishing for User Events

Non-durable user channel events (such as `call.signal`, `session.signal`, `bot.paused`) call `Publisher::publish` directly on `format!("private-user-{}", user_id)`. They allocate no `user_seq` and write no DB rows. `bot.command_result` follows this exact pattern.

---

## 12. Current Wire Format for `value_encrypted_bot` and Ciphertexts

The server treats encrypted payloads (including `value_encrypted_bot`, command ciphertexts, and result ciphertexts) as opaque base64url strings. The server does not perform parsing, ECDH derivation, or inspection. No server-side wire format helpers exist or are required for these opaque ciphertexts.

---

## 13. Current Size Caps

`POST /rooms/:id/bot-commands` enforces a 64 KiB cap (`decoded.len() > 65536` returns 413 `ciphertext_too_large`).
Proposal: Enforce the same 64 KiB (65,536 bytes) cap on result ciphertext for `POST /bots/me/messages` (`result_type != "none"`) for symmetry.

---

## 14. Existing Tests

The following test files touch `bot_commands` or `bot-commands`:
- `server/tests/bot_commands.rs` (assigned to `bots` batch in `server/tests/batch-manifest.toml`)
- `server/tests/bot_request_log.rs` (assigned to `bots` batch in `server/tests/batch-manifest.toml`)

No other test files in `server/tests/` insert into or query `bot_commands`.

---

## 15. V2 Remnants and Wire Shape Gaps

1. `POST /rooms/:id/bot-commands` request body lacked `ephemeral_result_pubkey` (v3.0.2 shape).
2. `bot.command_invoked` event payload lacked `ephemeral_result_pubkey`.
3. Test fixtures in `server/tests/bot_commands.rs` and `server/tests/bot_request_log.rs` posted command JSONs and inserted `bot_commands` SQL rows without `ephemeral_result_pubkey`.

---

## Conclusion & Action Plan

All 15 empirical checks are complete. Proceed to plan review and implementation of Phase 44.
