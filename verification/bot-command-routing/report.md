# Empirical Verification Report: Bot Command Routing

**Phase:** 32
**Task:** Bot Command Routing
**Spec Reference:** Server Specification v3.0.3 (§4.5, §5.6, §6.31, §7.10, §8.8.10, §8.8.15, §8.9, §12)
**Report File:** `verification/bot-command-routing/report.md`

---

## Findings

### 1. Phase 27 Status
**Confirmed.** The bot account model (Phase 27) has completely landed in the repository.
- Schema tables present in `server/migrations/0001_v2_schema.sql`: `bot_accounts`, `bot_tokens`, `bot_declared_scopes`, `room_bots`, `room_bot_scopes`, `bot_settings`.
- Endpoints and helpers present in `server/src/bots/` and `server/src/routes/bots.rs`, `room_bots.rs`.
- Integration test suites `server/tests/bots.rs` and `server/tests/room_bots.rs` exist and pass under the `bots` batch.

### 2. Current `bot_commands` Table
**Absent.** The `bot_commands` table is not currently present in `server/migrations/0001_v2_schema.sql`. It will be added directly to `0001_v2_schema.sql` conforming to §7.10:

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
CREATE INDEX IF NOT EXISTS idx_bot_commands_pending
    ON bot_commands(bot_id, acked_at)
    WHERE acked_at IS NULL AND expired_at IS NULL;
```

### 3. Current `POST /rooms/:id/bot-commands` Handler
**Absent.** No handler exists in `server/src/routes/`. It will be implemented in `server/src/routes/room_bots.rs` (or a dedicated route module re-exported in `routes/mod.rs`).

### 4. Current `POST /bots/me/commands/:id/ack` Handler
**Absent.** No handler exists in `server/src/routes/`. It will be implemented in `server/src/routes/bots.rs`.

### 5. Current `bot.command_invoked` Publisher
**Absent.** No `bot.command_invoked` event publisher exists in `server/src/`. It will be added to the `POST /rooms/:id/bot-commands` handler, publishing durable events to `private-bot-{bot_id}`.

### 6. Current Bot Token Authentication on `/bots/me/*`
**Confirmed.** `validate_bot_token` in `server/src/bots/auth.rs` validates bearer tokens against `bot_tokens` joined with `bot_accounts`. `resolve_caller` in `server/src/routes/bots.rs` parses the `Authorization: Bearer <token>` header, attempting `validate_bot_token` first and returning `CallerIdentity::Bot(BotAuthCtx)`, falling back to `validate_session` for `CallerIdentity::User(AuthUser)`.

### 7. Current `read_commands` Scope Check
**Confirmed.** Grant scopes are stored in `room_bot_scopes(room_id, bot_id, scope)`. To check if a bot has an active grant with `read_commands` scope in a room, the handler queries `room_bots` and `room_bot_scopes` for an unrevoked grant (`revoked_at IS NULL`) with `scope = 'read_commands'`.

### 8. Current `sender_client_id` Source
**Derived.** `AuthUser` contains `device_id: Option<String>` from the session. The `sender_client_id` is derived by querying `SELECT client_id FROM devices WHERE id = ?`. If missing or unlinked, it queries `SELECT client_id FROM devices WHERE user_id = ? ORDER BY created_at DESC LIMIT 1`, falling back to `"unknown"`.

### 9. Current `request_id` Handling
**Interpretation:** `request_id` in `POST /rooms/:id/bot-commands` is validated as a non-empty string (1..=64 characters, printable ASCII) and echoed back in the 202 Accepted response. It serves as a client-side request correlation ID. Because `bot_commands` schema (§7.10) does not contain a `request_id` column or unique constraint, `request_id` is not used for DB-level idempotency or deduplication.

### 10. Current TTL Cleanup Job
**Absent.** No `bot_commands` cleanup job exists in `server/src/cleanup/`. A new cleanup job will be added at `server/src/cleanup/bot_commands.rs` implementing `CleanupJob` and registered on the hourly scheduler in `server/src/main.rs`. Config option `BOT_COMMAND_TTL_HOURS` (default 24) is defined in `server/src/config.rs`.

### 11. Current Rate Limits
`RATE_BOT_COMMAND_PER_MIN=60` and `RATE_BOT_FETCH_PER_MIN=30` exist in `RateLimitConfig` in `server/src/config.rs`. However, `RateLimitKey::BotCommand` is not yet defined in `server/src/rate_limit.rs`.
- `RateLimitKey::BotCommand { bot_id, user_id }` will be added with key format `bot_command:{bot_id}:{user_id}:min:{boundary}`.
- Discrepancy Note: `RATE_BOT_FETCH_PER_MIN` (default 30) is listed in §5.6, but no bot fetch endpoint exists in §8.8. The rate limit remains configured for potential future endpoints.

### 12. Current `delivered_at` Write Path
**Absent.** Interpretation: The server sets `delivered_at = CURRENT_TIMESTAMP` on the `bot_commands` row in SQLite immediately after the `bot.command_invoked` event is successfully published to `private-bot-{bot_id}`.

### 13. Current `expired_at` Write Path
**Absent.** Set exclusively by the hourly TTL cleanup job (`expired_at = CURRENT_TIMESTAMP`) for rows where `acked_at IS NULL AND expired_at IS NULL AND created_at < datetime('now', '-' || N || ' hours')`.

### 14. Current Indexing
**Absent.** The partial index `idx_bot_commands_pending` on `bot_commands(bot_id, acked_at) WHERE acked_at IS NULL AND expired_at IS NULL` will be created in `server/migrations/0001_v2_schema.sql`.

### 15. Existing Tests
No existing tests touch bot commands. A new integration test suite `server/tests/bot_commands.rs` will be created and registered under the `bots` batch in `server/tests/batch-manifest.toml`.

### 16. V2 Remnants
None found. No code path parses command ciphertexts or logs cleartext command payloads.

---

## Conclusion
Dependency Phase 27 is complete and verified. Ready to proceed with implementation.
