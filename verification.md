
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
