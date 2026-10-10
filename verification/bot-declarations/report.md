# Empirical Verification Report — Bot Declarations

## Overview
This report establishes the baseline empirical reality for Phase 43 (Bot Declarations) per V3 Specification §7.10, §8.8.1–§8.8.3, §8.9, §14.3, §14.6, and §14.8 prior to code modifications.

---

## 1. Current `bot_accounts.declarations` Column
- **Presence:** Not present in `server/migrations/0001_v2_schema.sql`.
- **Exact Location:** `server/migrations/0001_v2_schema.sql` lines 469–479 define `CREATE TABLE IF NOT EXISTS bot_accounts`.
- **Action Required:** Add `declarations TEXT` (nullable) to `bot_accounts` in `server/migrations/0001_v2_schema.sql`.

---

## 2. Current `POST /bots` Handler
- **Location:** `server/src/routes/bots.rs` (`create_bot`).
- **Request Shape:** `CreateBotReq` with `display_name`, `bot_identity_pubkey`, `bot_command_pubkey`, `identity_pubkey`, `declared_scopes`.
- **Declarations Handling:** Does not currently accept `declarations`.
- **Action Required:** Extend `CreateBotReq` with optional `declarations: Option<serde_json::Value>`. Store UTF-8 JSON string if present after top-level validation and size check.

---

## 3. Current `GET /bots/:id` Handler
- **Location:** `server/src/routes/bots.rs` (`get_bot`).
- **Response Shape:** `BotView` with `bot_id`, `display_name`, `avatar_file_id`, `bot_identity_pubkey`, `bot_command_pubkey`, `identity_pubkey`, `declared_scopes`, `owner_user_id`, `created_at`, optional `bot_token`.
- **Declarations Handling:** Does not currently select or return `declarations`.
- **Action Required:** Extend `BotView` with `declarations: Option<serde_json::Value>`. Select `declarations` from `bot_accounts` and return parsed JSON object or `null`.

---

## 4. Current `PATCH /bots/:id` Handler
- **Location:** `server/src/routes/bots.rs` (`patch_bot`).
- **Request Shape:** `PatchBotReq { display_name: Option<String> }`.
- **Declarations Handling:** Does not currently accept `declarations`.
- **Action Required:** Extend `PatchBotReq` with `declarations: Option<serde_json::Value>`. Implement validation, no-op guard, update, event publication, and audit logging.

---

## 5. Current `bot.updated` Publisher
- **Current Behavior:** Publishes `{ "bot_id": bot_id, "changed": ["display_name"] }` or `{ "bot_id": bot_id, "changed": ["avatar"] }` to `private-bot-{bot_id}` and each granted `private-room-{room_id}`.
- **Spec Alignment for `changed: ["commands"]`:**
  - Bot Channel (`private-bot-{bot_id}`): `{ "bot_id": bot_id, "changed": ["commands"] }` (omits `avatar_file_id`).
  - Room Channel (`private-room-{room_id}`): `{ "room_id": room_id, "bot_id": bot_id, "changed": ["commands"] }` (omits `scopes` and `avatar_file_id`).

---

## 6. Current Bot Channel Enumeration
- **Query Pattern:**
  ```sql
  SELECT room_id FROM room_bots WHERE bot_id = ? AND revoked_at IS NULL
  ```
- **Validation:** Verified present in `patch_bot`, `upload_bot_avatar`, and `delete_bot_avatar` in `server/src/routes/bots.rs`. Reused for declarations update fanout.

---

## 7. Current `bot.declaration_update` Audit Constant
- **Status:** Absent in `server/src/audit.rs`.
- **Action Required:** Add `pub const BOT_DECLARATION_UPDATE: &str = "bot.declaration_update";` to `action` module in `server/src/audit.rs`.

---

## 8. Current GDPR Export
- **Location:** `server/src/gdpr.rs` (`build_export`).
- **Status:** Currently exports `bot_settings.json` for owned bots, but does not export bot declarations.
- **Action Required:** Add query for owned active bots with non-null declarations (`SELECT id, display_name, declarations FROM bot_accounts WHERE owner_user_id = ? AND deleted_at IS NULL AND declarations IS NOT NULL`) and export `bot_declarations.json` containing array of `{ "bot_id": id, "display_name": display_name, "declarations": parsed_val }`.

---

## 9. Current Schema Shape Validation Patterns
- **Validation Rules:**
  - Value must be a JSON object (`val.is_object()`).
  - `schema_version` must be an integer (`val["schema_version"].as_i64()`). Require `schema_version == 1` (reject missing/non-int with 400 `invalid_declarations`, unsupported version with 400 `unsupported_schema_version`).
  - `commands` must be an array (`val["commands"].is_array()`, reject non-array with 400 `invalid_declarations`).
  - `settings` must be an array (`val["settings"].is_array()`, reject non-array with 400 `invalid_declarations`).
  - Contents of `commands` and `settings` are opaque and unvalidated.
  - Unknown top-level fields are accepted and ignored.
- **Size Limit:** Enforce 256 KiB limit (`262,144` bytes) on raw declarations JSON string, returning 413 `declarations_too_large` on breach.

---

## 10. Existing Tests
- **Test File:** `server/tests/bots.rs`.
- **Test Cases:** `test_bot_schema_and_constraints`, `test_bot_tokens_and_rate_limits`, `test_bot_creation_rate_limit`, `test_bot_crud_and_events`.
- **Batch Assignment:** `bots` in `server/tests/batch-manifest.toml`.

---

## 11. V2 Remnants
- **Inspection:** No V2 code paths found that assume declarations do not exist, parse declarations contents, or publish `bot.updated` without a `changed` array.

---

## Conclusion
Repository baseline verified. Proceeding to implement Phase 43 deliverables.
