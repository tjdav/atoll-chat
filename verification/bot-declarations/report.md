# Step 0 — Empirical Verification: Bot Declarations (Phase 43)

## 1. Current `bot_accounts.declarations` Column
- **Presence**: Confirmed present in `server/migrations/0001_v2_schema.sql` (lines 469–480).
- **Type & Nullability**: Column definition is not explicitly present in `bot_accounts` table in `0001_v2_schema.sql` line 469–480!
Wait, let's verify line 469–480 of `server/migrations/0001_v2_schema.sql`:
```sql
CREATE TABLE IF NOT EXISTS bot_accounts (
    id                  TEXT PRIMARY KEY,
    display_name        TEXT NOT NULL,
    avatar_file_id      TEXT,
    bot_identity_pubkey TEXT NOT NULL,
    bot_command_pubkey  TEXT NOT NULL,
    identity_pubkey     TEXT NOT NULL,
    owner_user_id       TEXT NOT NULL REFERENCES users(id),
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    disabled_at         DATETIME,
    deleted_at          DATETIME
);
```
Wait! `declarations TEXT` is **NOT** present in `bot_accounts` table in `server/migrations/0001_v2_schema.sql`!
Let's check if `declarations` column was in `0001_v2_schema.sql` or if it needs to be added to `0001_v2_schema.sql`.
Per V3 Spec §7.10:
`declarations TEXT,` is in `bot_accounts`.
In `0001_v2_schema.sql`, line 477 has `owner_user_id`. `declarations` line needs to be added to `bot_accounts` in `0001_v2_schema.sql`.

Let's re-verify all 11 items for the Step 0 report:

1. **Current `bot_accounts.declarations` column**:
   - Column `declarations TEXT` is specified in V3 Spec §7.10.
   - In `server/migrations/0001_v2_schema.sql`, `bot_accounts` currently lacks `declarations TEXT`. It will be added as `declarations TEXT,` right after `owner_user_id`. Nullable TEXT column.

2. **Current `POST /bots` handler**:
   - In `server/src/routes/bots.rs`: `CreateBotReq` struct does NOT currently have a `declarations` field (`Option<serde_json::Value>`).
   - `create_bot` currently inserts into `bot_accounts` without binding `declarations`.
   - `CreateBotReq` needs `pub declarations: Option<serde_json::Value>`.

3. **Current `GET /bots/:id` handler**:
   - `get_bot` queries `bot_accounts` selecting `id, display_name, avatar_file_id, bot_identity_pubkey, bot_command_pubkey, identity_pubkey, owner_user_id, CAST(created_at AS TEXT) AS created_at`.
   - `BotView` struct currently does NOT include `declarations`.
   - Returns `bot_id`, `display_name`, `avatar_file_id`, `bot_identity_pubkey`, `bot_command_pubkey`, `identity_pubkey`, `declared_scopes`, `owner_user_id`, `created_at`, `bot_token`.

4. **Current `PATCH /bots/:id` handler**:
   - `PatchBotReq` struct currently has `pub display_name: Option<String>`.
   - `patch_bot` only checks `req.display_name`. If present, updates `display_name` and emits `bot.updated` with `changed: ["display_name"]` (or display_name update logic). If no fields changed, currently returns `get_bot`.

5. **Current `bot.updated` publisher**:
   - Emits `{ "bot_id": bot_id, "changed": changed }` on `private-bot-{bot_id}` and `{ "room_id": room_id, "bot_id": bot_id, "changed": changed }` on `private-room-{room_id}` for each granted room channel.
   - When `declarations` changes, `changed` is `["commands"]`.

6. **Current bot channel enumeration**:
   - In `server/src/routes/bots.rs` (lines 351, 417), granted room IDs for a bot are queried with:
     `SELECT room_id FROM room_bots WHERE bot_id = ? AND revoked_at IS NULL`.

7. **Current `bot.declaration_update` audit constant**:
   - Currently absent in `server/src/audit.rs`.
   - Will be added as `pub const BOT_DECLARATION_UPDATE: &str = "bot.declaration_update";` in `server/src/audit.rs`.

8. **Current GDPR export**:
   - In `server/src/gdpr.rs`: `build_export` currently fetches owned bots' settings (`bot_settings.json`), but does NOT export bot declarations.
   - Will be updated to export bot accounts metadata including `declarations` (e.g. in `bot_accounts.json` or `bots.json`).

9. **Current schema shape validation patterns**:
   - `rooms.metadata` and `bot_settings` values are checked for basic shape or string length limits using `serde_json::Value` inspection or base64 decoding.
   - Top-level declarations shape validation will check: `value` is JSON Object, `schema_version` is integer `1` (return 400 `unsupported_schema_version` if integer != 1 or missing `schema_version`), `commands` is array, `settings` is array. Total JSON string size <= 256 KiB (reject with 413 `declarations_too_large`). Unknown top-level fields are accepted and ignored.

10. **Existing tests**:
    - `server/tests/bots.rs`: Tests bot account CRUD, token creation/deletion, avatar upload/deletion.
    - Assigned to `bots` batch in `server/tests/batch-manifest.toml`.

11. **V2 remnants / Gaps**:
    - `bot_accounts` schema in `0001_v2_schema.sql` lacked `declarations TEXT` column.
    - `PatchBotReq` lacked `declarations`.
    - `BotView` lacked `declarations`.
    - Audit constant `BOT_DECLARATION_UPDATE` missing.
    - GDPR export lacked bot declarations.

---
