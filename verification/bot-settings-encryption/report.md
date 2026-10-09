# Empirical Verification Report: Bot Settings Encryption

**Task / Phase:** Phase 30 / V3 Spec §6.31, §7.10, §8.2.4, §8.8.10, §8.8.11, §8.9, §12, §14.2
**Date:** October 9, 2026
**Status:** Case A — Verified. Ephemeral public key delivery path exists via embedded wire format.

---

## Executive Summary

An empirical audit of the repository and Server Specification v3.0.3 was conducted prior to implementation. The audit confirms that Phase 24 (generic preferences) and Phase 27 (bot account model) are fully landed in the codebase.

Regarding the `ephemeral_pubkey` delivery path: Server Specification v3.0.3 §6.31 and §8.8.14 explicitly specify that `value_encrypted_bot` is a single base64url string encoding `ephemeral_pubkey (32) || nonce (12) || ciphertext || tag (16)`. The client embeds the 32-byte ephemeral X25519 public key into `value_encrypted_bot` during encryption, the server stores `value_encrypted_bot` opaquely in the database, `GET /bots/me/settings` returns `value_encrypted_bot` to the bot, and the bot parses `ephemeral_pubkey` from the first 32 bytes of the decoded binary payload after fetch.

Therefore, **Case A applies**. No specification gap exists and no amendment request is required.

---

## 17-Point Verification Matrix

### 1. Phase 24 and 27 Status
- **Generic Preferences (Phase 24 / Task 24c):** Fully implemented and tested in `server/src/sync/preferences.rs` and `server/src/routes/preferences.rs`. Schema table `user_preferences` is present in `server/migrations/0001_v2_schema.sql`.
- **Bot Account Model (Phase 27):** Fully implemented and tested in `server/src/bots/` and `server/src/routes/bots.rs`. Schema tables `bot_accounts`, `bot_tokens`, `bot_declared_scopes`, `room_bots`, and `room_bot_scopes` are present in `server/migrations/0001_v2_schema.sql`. Column `bot_accounts.bot_command_pubkey` is populated at creation.

### 2. Current `bot_settings` Table
- **Status:** Absent from `server/migrations/0001_v2_schema.sql`.
- **Target Schema (§7.10):**
  ```sql
  CREATE TABLE IF NOT EXISTS bot_settings (
      bot_id                 TEXT NOT NULL REFERENCES bot_accounts(id) ON DELETE CASCADE,
      key                    TEXT NOT NULL,
      is_secret              INTEGER NOT NULL CHECK(is_secret IN (0, 1)),
      value_encrypted_client TEXT,
      value_encrypted_bot    TEXT NOT NULL,
      user_seq               INTEGER NOT NULL,
      updated_at             DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (bot_id, key),
      CHECK (
          (is_secret = 1 AND value_encrypted_client IS NULL)
          OR
          (is_secret = 0 AND value_encrypted_client IS NOT NULL)
      )
  );
  CREATE INDEX IF NOT EXISTS idx_bot_settings_seq ON bot_settings(user_seq);
  ```
- **Note:** `user_seq` is the operator's sequence number. No denormalized `owner_user_id` column exists in `bot_settings`; sync queries filter by joining `bot_accounts.owner_user_id`.

### 3. Current `GET /bots/me/settings` Handler
- **Status:** Absent in `server/src/routes/bots.rs`.
- **Target Contract (§8.8.10, §8.8.14):** Authenticated via bot token (`validate_bot_token`). Returns `{ "settings": [ { "key": "...", "value_encrypted_bot": "<base64url>", "is_secret": bool, "user_seq": N } ] }` ordered by `key ASC`.

### 4. Current `GET /users/me/bots/:bot_id/settings` Handler
- **Status:** Absent in `server/src/routes/bots.rs`.
- **Target Contract (§8.8.11):** Authenticated via user session (`AuthUser`). Restricted to bot owner (`bot_accounts.owner_user_id == user_id`). Returns `{ "settings": [ { "key": "...", "value_encrypted_client": "<base64url>" | null, "is_secret": bool, "user_seq": N } ] }` ordered by `key ASC`. `value_encrypted_client` is `null` for secrets (`is_secret = true`).

### 5. Current `PATCH /users/me/bots/:bot_id/settings/:key` Handler
- **Status:** Absent in `server/src/routes/bots.rs`.
- **Target Contract (§8.8.11):** Authenticated via user session (`AuthUser`). Owner-only. Accepts `{ "is_secret": bool, "value_encrypted_bot": "<base64url>", "value_encrypted_client": "<base64url>"? }`. Optional `"ephemeral_pubkey"` string field in JSON request is accepted and validated if present.

### 6. Current `DELETE /users/me/bots/:bot_id/settings/:key` Handler
- **Status:** Absent in `server/src/routes/bots.rs`.
- **Target Contract (§8.8.11):** Authenticated via user session (`AuthUser`). Owner-only. Deletes setting row, allocates operator `user_seq`, publishes events, returns 204 No Content. Returns 404 `setting_not_found` if row does not exist.

### 7. `ephemeral_pubkey` Delivery Path
- **Analysis:** Server Specification v3.0.3 §6.31 step 6 & 7 and §8.8.14 explicitly define the wire construction:
  - `value_encrypted_bot` is a single base64url string encoding `ephemeral_pubkey (32) || nonce (12) || ciphertext || tag (16)`.
  - The `ephemeral_pubkey` is embedded inside `value_encrypted_bot` and is carried through the database row in `bot_settings.value_encrypted_bot`.
  - `GET /bots/me/settings` returns `value_encrypted_bot` directly to the bot.
  - The bot decodes base64url and extracts the first 32 bytes as `ephemeral_pubkey`.
- **Conclusion:** The delivery path is fully defined by the wire format. Case A applies.

### 8. Current Bot Token Authentication
- **Status:** Implemented in `server/src/bots/auth.rs` (`validate_bot_token`).
- **Behavior:** Accepts `Authorization: Bearer <bot_token>`, computes SHA-256 hash, queries `bot_tokens` JOIN `bot_accounts`, verifies token non-revocation and account active status, returns `BotAuthCtx { bot_id, owner_user_id, token_id }`.

### 9. Current Operator Authorization
- **Status:** Standard pattern across bot routes (`server/src/routes/bots.rs`).
- **Behavior:** Queries `SELECT owner_user_id FROM bot_accounts WHERE id = ? AND deleted_at IS NULL AND disabled_at IS NULL`. Asserts caller's `user_id` matches `owner_user_id`. Returns 403 `forbidden` on mismatch, 404 `bot_not_found` if bot does not exist.

### 10. Current X25519 and HKDF Usage
- **Crates:** `x25519-dalek = "2.0"`, `hkdf = "0.12"`, `sha2 = "0.10"`.
- **Usage:** Used in `server/src/proxy_common/content_key.rs` for ephemeral-static ECDH and HKDF-SHA256. For bot settings, the server acts purely as a relay and stores the encrypted payload opaquely without performing ECDH or HKDF itself (§12).

### 11. Current Sync Response `bot_settings` Field
- **Status:** `BotSettingSyncRow` struct defined in `server/src/sync/query.rs` matching §8.2.4:
  ```rust
  #[derive(Debug, Serialize, Deserialize, PartialEq, Eq)]
  pub struct BotSettingSyncRow {
      pub bot_id: String,
      pub key: String,
      pub is_secret: bool,
      pub value_encrypted_client: Option<String>,
      pub user_seq: i64,
  }
  ```
- Currently returns placeholder `json!([])` in `get_user_sync_state`. Phase 30 will populate this query by joining `bot_settings` with `bot_accounts` on `owner_user_id = <caller>`.

### 12. Current `bot_settings.updated` and `bot.settings_updated` Events
- **Status:** Absent in current event publishers.
- **Specification (§8.9):**
  - `bot_settings.updated` with `{ bot_id, key, user_seq }` published on `private-user-{owner_user_id}` (durable).
  - `bot.settings_updated` with `{ bot_id, keys_changed, user_seq }` published on `private-bot-{bot_id}` (durable for bot channel).

### 13. Current Key Validation
- **Rules:** `bot_settings.key` is opaque to the server (§7.10).
- **Validation:** String length 1..=256 chars. Printable ASCII or valid UTF-8 without control characters.
- **Prefixes:** `room:{room_id}:` prefix is permitted and unparsed by the server. Underscore `_` prefix is permitted for bot settings.

### 14. Current `is_secret` Wire Type
- **Wire DTO:** JSON boolean (`true` / `false`).
- **Database Column:** `INTEGER NOT NULL CHECK(is_secret IN (0, 1))`.

### 15. Current Size Limits
- **Config:** `PREFERENCES_MAX_ENCRYPTED_BYTES` default is 131,072 bytes (128 KiB).
- **Validation:** `value_encrypted_bot` and `value_encrypted_client` decoded length must be `<= state.config.preferences_max_encrypted_bytes`.
- **Minimum decoded length for `value_encrypted_bot`:** 60 bytes (`32B ephemeral_pubkey + 12B nonce + 0B ct + 16B tag`).
- Exceeding maximum returns 413 `value_too_large` or 400 `invalid_value_encrypted_bot`.

### 16. Existing Tests
- `server/tests/sync_foundation.rs` and `server/tests/sync_contract.rs` test that `bot_settings` field exists in `GET /users/me/sync`.
- `server/tests/cleanup.rs` tests skipping of `bot_settings` in sync table pruning.
- New integration suite `server/tests/bot_settings.rs` will be added to the `bots` batch in `server/tests/batch-manifest.toml`.

### 17. V2 Remnants
- No legacy V2 code paths or assumptions exist for bot settings. Clean break baseline.

---

## Decision Point Result

**Classification:** Case A — Ephemeral Public Key Delivery Path Exists.
**Action:** Proceed to implementation of Deliverables 1 through 15.
