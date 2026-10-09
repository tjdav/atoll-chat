# Step 0 Empirical Verification Report: Bot Account Model

**Phase:** Phase 27 (§11 Phased Build Plan)
**Target:** Bot accounts, bot tokens, declared scopes, room bot grants, scope dependencies, mode derivation, bot avatar upload, and bot events.

---

### 1. Current `bot_accounts` Schema
Found in `server/migrations/0001_v2_schema.sql` (lines 459–469):
```sql
CREATE TABLE IF NOT EXISTS bot_accounts (
    id                  TEXT PRIMARY KEY,
    display_name        TEXT NOT NULL,
    avatar_file_id      TEXT,
    owner_user_id       TEXT NOT NULL REFERENCES users(id),
    bot_identity_pubkey TEXT,
    bot_command_pubkey  TEXT,
    identity_pubkey     TEXT,
    disabled_at         DATETIME,
    deleted_at          DATETIME
);
```
**Comparison to §7.10:**
- Missing `created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP`.
- Columns `bot_identity_pubkey`, `bot_command_pubkey`, and `identity_pubkey` were added in Phase 16 as nullable `TEXT`. Per §7.10, they must be `TEXT NOT NULL`.

### 2. Current `bot_tokens` Table
- **Status:** Absent in `0001_v2_schema.sql` and SQLite database.

### 3. Current `bot_declared_scopes` Table
- **Status:** Absent in `0001_v2_schema.sql` and SQLite database.

### 4. Current `room_bots` Schema
Found in `server/migrations/0001_v2_schema.sql` (lines 471–483):
```sql
CREATE TABLE IF NOT EXISTS room_bots (
    room_id    TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    bot_id     TEXT NOT NULL REFERENCES bot_accounts(id) ON DELETE CASCADE,
    mode       TEXT NOT NULL CHECK(mode IN ('write_only', 'observer', 'member')),
    granted_by TEXT NOT NULL REFERENCES users(id),
    granted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    revoked_at DATETIME,
    PRIMARY KEY (room_id, bot_id)
);
```
- Matches §7.10. Has `mode` CHECK constraint with `'write_only'`, `'observer'`, `'member'` and `revoked_at`.

### 5. Current `room_bot_scopes` Table
- **Status:** Absent in `0001_v2_schema.sql` and SQLite database.

### 6. Current Bot CRUD Endpoints
- **Status:** `POST /bots`, `GET /bots/:id`, `PATCH /bots/:id`, `DELETE /bots/:id` do not exist in `server/src/routes/`.

### 7. Current Token Endpoints
- **Status:** `POST /bots/:id/tokens`, `DELETE /bots/:id/tokens/:token_id` do not exist.

### 8. Current Avatar Endpoints
- **Status:** `POST /bots/:id/avatar`, `DELETE /bots/:id/avatar` do not exist.

### 9. Current Room Bot Grant Endpoints
- **Status:** `GET /rooms/:id/bots`, `POST /rooms/:id/bots`, `PATCH /rooms/:id/bots/:bot_id`, `DELETE /rooms/:id/bots/:bot_id` do not exist.
- Phase 11 wired member list pagination (`GET /rooms/:id/members`) to merge active, non-revoked bots into the member list.

### 10. Current Scope Dependency Rules
- **Status:** Absent in Rust code. Standard vocabulary and dependencies (`post_reaction`, `edit_message`, `delete_message` requiring `read_content`) need to be implemented in `server/src/bots/scopes.rs`.

### 11. Current Mode Derivation
- **Status:** Absent in Rust code. Mode derivation rule per §7.10 / §8.8.7:
  - If scopes include any of `read_content`, `post_reaction`, `edit_message`, `delete_message` $\rightarrow$ `member`.
  - Else if scopes include `read_metadata` $\rightarrow$ `observer`.
  - Else $\rightarrow$ `write_only`.

### 12. Current `pending_mls_adds` Call from Grant
- **Status:** Confirmed. `queue_pending_mls_add_batch` and `select_bot_key_packages` exist in `server/src/rooms.rs` accepting `MlsTarget::Bot(bot_id)`. Ready for invocation upon grant or patch transition to `member` mode.

### 13. Current `pending_mls_removes` Call from Revoke
- **Status:** Confirmed. `queue_pending_mls_remove_batch` exists in `server/src/rooms.rs` accepting `MlsTarget::Bot(bot_id)`. Ready for invocation upon revoke, patch transition away from `member` mode, or bot deletion.

### 14. Current Event Publishers
- **Status:** None of `bot.added`, `bot.revoked`, `bot.updated`, `bot.created`, `bot.deleted`, `bot.grant_updated`, `bot.keys_rotated` are published anywhere currently.

### 15. Current Rate Limits
- **Status:** `RATE_BOT_CREATE_PER_HOUR` (5), `RATE_BOT_GRANT_PER_HOUR` (50), `RATE_BOT_TOKEN_ISSUE_PER_HOUR` (20), `RATE_BOT_KEY_ROTATE_PER_HOUR` (5) are absent from `server/src/config.rs` and `server/src/rate_limit.rs`.

### 16. Current Bot Token Authentication
- **Status:** Currently `AuthUser` in `server/src/auth.rs` only authenticates human user session tokens against `sessions`.
- **Bot Token Validation:** A bot token is a 43-character raw base64url string. It is hashed via SHA-256 and matched against `bot_tokens.token_hash` where `revoked_at IS NULL` and `expires_at` is NULL or > NOW.
- **Distinction & Routing Auth:** Routes accepting either the bot's owner session token or a bot token matching `:id` (such as `GET /bots/:id`, `PATCH /bots/:id`, avatar, token management) will validate both caller types via an `AuthCaller` or `AuthOwnerOrBot` helper.

### 17. Current Avatar Storage Reuse
- **Status:** Confirmed. `attachments::store_attachment` in `server/src/attachments.rs` handles multipart stream processing and content-addressed storage for any attachment. `POST /bots/:id/avatar` can store the file with `room_id = NULL` and `uploader_id = <owner_user_id>`, setting `bot_accounts.avatar_file_id`.

### 18. Existing Tests
- `server/tests/kt_endpoints.rs`: `test_key_transparency_log_schema_xor_check_and_bot_accounts` (batch: `identity`).
- `server/tests/room_members_pagination.rs`: `test_member_list_pagination_merged_users_and_bots` and `test_member_list_pagination_revoked_and_deleted_bots_excluded` (batch: `messaging`).
- `server/tests/pending_removes.rs`: `test_pending_mls_removes_bot_target` (batch: `sockudo`).
- `server/tests/retention_preview.rs`: `test_retention_preview_bot_and_whisper_messages` (batch: `messaging`).

### 19. V2 Remnants
- Baseline `0001_v2_schema.sql` contains minimal `bot_accounts` schema lacking `created_at` and allowing NULL pubkeys.
- Test fixtures in `server/tests/kt_endpoints.rs` and `server/tests/room_members_pagination.rs` insert test bot rows without pubkeys or `created_at`.
