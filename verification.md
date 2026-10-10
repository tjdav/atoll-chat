
## Bot Command Routing Verification Fact (Phase 32)
- **ID:** Phase 32 Bot Command Routing
- **Date:** 2026-10-09
- **Status:** Complete. Canonical.
- **Spec / Amendment references:** V3 Spec §4.5, §5.6, §6.31, §7.10, §8.8.10, §8.8.15, §8.9, §12
- **Verified Facts:**
  - **Schema:** `bot_commands` table added to `server/migrations/0001_v2_schema.sql` per §7.10 (`id PRIMARY KEY`, `bot_id REFERENCES bot_accounts(id) ON DELETE CASCADE`, `room_id REFERENCES rooms(id) ON DELETE CASCADE`, `sender_user_id REFERENCES users(id)`, `sender_client_id TEXT NOT NULL`, `ciphertext BLOB NOT NULL`, `created_at DATETIME`, `delivered_at DATETIME`, `acked_at DATETIME`, `expired_at DATETIME`). Partial index `idx_bot_commands_pending ON bot_commands(bot_id, acked_at) WHERE acked_at IS NULL AND expired_at IS NULL`.
  - **Command Submission (`POST /rooms/:id/bot-commands`):**
    - Authenticated human user session required (`AuthUser`). Bot tokens return 403 `forbidden`.
    - Caller must be a member of `room_id` (404 `room_not_found` for non-members).
    - Bot must have an active grant in `room_id` (`revoked_at IS NULL`) with `read_commands` scope in `room_bot_scopes` (403 `bot_not_granted`).
    - Ciphertext must be non-empty unpadded base64url, decoded length ≤ 64 KiB (400 `invalid_ciphertext` / 413 `ciphertext_too_large`).
    - `request_id` validated as printable ASCII string (1..=64 chars) and echoed in response for client-side correlation.
    - Rate limit `RATE_BOT_COMMAND_PER_MIN` (default 60) enforced per `(bot_id, sender_user_id)`. Key format `bot_command:{bot_id}:{user_id}:min:{boundary}`.
    - Stores command row in `bot_commands` with `sender_client_id` derived from user session device binding.
    - Publishes durable `bot.command_invoked` on `private-bot-{bot_id}` carrying `{ command_id, room_id, sender_user_id, sender_client_id, ciphertext }`. Event payload does NOT include `command_name` or any decrypted content. Event is NOT published on room or user channels.
    - On successful publish, updates `delivered_at = CURRENT_TIMESTAMP`.
    - Returns HTTP 202 Accepted `{ command_id, created_at, request_id }` with `Cache-Control: no-store`.
  - **Command Acknowledgement (`POST /bots/me/commands/:id/ack`):**
    - Bot token auth required (`CallerIdentity::Bot`). User session tokens return 403 `forbidden`.
    - Command must exist (404 `command_not_found`) and match caller's `bot_id` (403 `forbidden`).
    - Sets `acked_at = CURRENT_TIMESTAMP` idempotently (already-acked commands return 204 without re-writing).
    - Returns HTTP 204 No Content with `Cache-Control: no-store`. No event is published, no `user_seq` is allocated.
  - **TTL Cleanup Job:**
    - `BotCommandsTtlJob` registered on shared hourly scheduler (`main.rs`). Reads `BOT_COMMAND_TTL_HOURS` (default 24).
    - Sets `expired_at = CURRENT_TIMESTAMP` for commands where `acked_at IS NULL AND expired_at IS NULL AND created_at < datetime('now', '-' || N || ' hours')`.
    - Does not delete rows. Preserves expired rows for audit and bot bookkeeping. Idempotent.
  - **Ciphertext Opacity & Privacy:**
    - Server treats command ciphertexts as opaque bytes. Never decrypts, parses, inspects, or logs ciphertext contents (§12).
- **Link to report:** [verification/bot-command-routing/report.md](verification/bot-command-routing/report.md)

## Bot Settings Encryption Verification Fact (Phase 30)
- **ID:** Phase 30 Bot Settings Encryption
- **Date:** 2026-10-09
- **Status:** Complete. Canonical.
- **Spec / Amendment references:** V3 Spec §6.31, §7.10, §8.2.4, §8.8.10, §8.8.11, §8.9, §12, §14.2
- **Verified Facts:**
  - **Case A Ephemeral Key Delivery:** V3 Spec §6.31 step 6 & 7 and §8.8.14 specify that `value_encrypted_bot` is a single base64url string encoding `ephemeral_pubkey (32) || nonce (12) || ciphertext || tag (16)`. The client embeds `ephemeral_pubkey` into `value_encrypted_bot`, the server stores `value_encrypted_bot` opaquely in `bot_settings.value_encrypted_bot`, `GET /bots/me/settings` returns `value_encrypted_bot` to the bot, and the bot parses `ephemeral_pubkey` from the first 32 bytes of the decoded binary payload after fetch.
  - **Schema:** `bot_settings` table added to `server/migrations/0001_v2_schema.sql` per §7.10 (`bot_id REFERENCES bot_accounts(id) ON DELETE CASCADE`, `key`, `is_secret INTEGER CHECK(is_secret IN (0, 1))`, `value_encrypted_client TEXT`, `value_encrypted_bot TEXT NOT NULL`, `user_seq INTEGER NOT NULL`, `updated_at DATETIME`, PK `(bot_id, key)`, XOR CHECK `(is_secret = 1 AND value_encrypted_client IS NULL) OR (is_secret = 0 AND value_encrypted_client IS NOT NULL)`). Index `idx_bot_settings_seq ON bot_settings(user_seq)`.
  - **`user_seq` Ownership:** `bot_settings.user_seq` is the operator's sequence, allocated via `allocate_user_seq(tx, owner_user_id)`.
  - **Operator Endpoints:**
    - `GET /users/me/bots/:bot_id/settings`: Bearer auth required (`AuthUser`), owner-only (`bot_accounts.owner_user_id == user_id`). Returns `{ settings: [ { key, value_encrypted_client, is_secret, user_seq } ] }` ordered by `key ASC`. `value_encrypted_client` is `null` for secret settings. `Cache-Control: no-store`.
    - `PATCH /users/me/bots/:bot_id/settings/:key`: Bearer auth required, owner-only. Request body `{ is_secret: bool, value_encrypted_bot: string, value_encrypted_client?: string, ephemeral_pubkey?: string }`. Validates base64url encoding and XOR constraints. No-op guard skips write/user_seq/events on matching values. Allocates operator `user_seq`, upserts row, publishes durable `bot_settings.updated` on `private-user-{owner_user_id}` and durable `bot.settings_updated` on `private-bot-{bot_id}`.
    - `DELETE /users/me/bots/:bot_id/settings/:key`: Bearer auth required, owner-only. Returns 404 `setting_not_found` if absent. On existing setting: allocates operator `user_seq`, deletes row, publishes both events, returns 204 No Content.
  - **Bot Endpoint:** `GET /bots/me/settings`: Bot token auth required (`validate_bot_token`). Returns `{ settings: [ { key, value_encrypted_bot, is_secret, user_seq } ] }` ordered by `key ASC`. `Cache-Control: no-store`.
  - **Sync Integration:** `GET /users/me/sync` joins `bot_settings` with `bot_accounts` filtering by `owner_user_id = caller_id`. Returns `bot_settings` array ordered by `user_seq ASC`. Participates in `max_seq` calculation.
  - **Opacity & GDPR:** Server stores ciphertexts opaquely without decryption or ECDH inspection (§12). `bot_settings.key` is opaque; `room:` prefix is unparsed. On operator account deletion, `bot_accounts` rows and cascaded `bot_settings` rows are deleted.
- **Link to report:** [verification/bot-settings-encryption/report.md](verification/bot-settings-encryption/report.md)

## Bot Request Idempotency Verification Fact (Phase 46)
- **ID:** Phase 46 Bot Request Idempotency
- **Date:** 2026-10-10
- **Status:** Complete. Canonical.
- **Spec / Amendment references:** V3 Spec §4.5, §5.6, §7.10, §8.8.10, §8.8.11, §8.9
- **Verified Facts:**
  - **Case A Classification:** Standard interpretation (Interpretation A) applies. Deduplication uses `bot_request_log` `(bot_id, request_id, endpoint, response_code, created_at)` without requiring a `response_body` column. Duplicate `request_id` calls to the same endpoint return the same status code (202 Accepted) with an idempotent response payload.
  - **Cross-Endpoint Conflict:** Reusing a `request_id` across different endpoints returns 409 `request_id_conflict`.
  - **Cleanup Rule:** 24-hour retention for `bot_request_log` rows via periodic scheduler job.
- **Link to report:** [verification/bot-request-idempotency/report.md](verification/bot-request-idempotency/report.md)

## Bot Declarations Verification Fact (Phase 43)
- **ID:** Phase 43 Bot Declarations
- **Date:** 2026-10-10
- **Status:** Complete. Canonical.
- **Spec / Amendment references:** V3 Spec §7.10, §8.8.1, §8.8.2, §8.8.3, §8.9, §14.3, §14.6, §14.8
- **Verified Facts:**
  - **Schema:** Added `declarations TEXT` column to `bot_accounts` in `server/migrations/0001_v2_schema.sql`.
  - **Top-Level Validation Rules:** `validate_declarations_top_level` validates top-level JSON object shape: `schema_version` integer equal to `1` (400 `unsupported_schema_version` for other integers/missing), `commands` array, `settings` array. Total payload length bounded to 256 KiB (413 `declarations_too_large`). Unknown top-level fields are accepted and ignored. Inner contents of `commands` and `settings` are opaque.
  - **`POST /bots` & `GET /bots/:id`:**
    - `POST /bots` accepts optional `declarations`, validates shape, stores UTF-8 JSON string, and returns `declarations` object in response.
    - `GET /bots/:id` returns parsed `declarations` JSON object or `null`.
  - **`PATCH /bots/:id` & Event Fanout:**
    - `PATCH /bots/:id` accepts `{ display_name, declarations }` using `double_option` deserialization to distinguish omitted fields from explicit `"declarations": null` (clearing column).
    - Requires at least one field to update (400 `no_fields_to_update`).
    - Applies value-level no-op guard skipping DB write, event publishing, and audit logging on unchanged declarations.
    - On declaration change or clear: updates `bot_accounts.declarations`, publishes `bot.updated` carrying `changed: ["commands"]` on `private-bot-{bot_id}` (omitting `avatar_file_id`) and on each granted room channel (`room_bots WHERE bot_id = ? AND revoked_at IS NULL`, omitting `scopes` and `avatar_file_id`).
    - Writes `bot.declaration_update` audit log entry with metadata `{"bot_id": bot_id, "room_id": null}`.
  - **Opacity & GDPR:** Server never logs declarations content. GDPR export (`build_export`) includes owned bot accounts and declarations in `bot_accounts.json`. Account deletion (`anonymise_user`) cascades owned `bot_accounts` rows.
- **Link to report:** [verification/bot-declarations/report.md](verification/bot-declarations/report.md)
