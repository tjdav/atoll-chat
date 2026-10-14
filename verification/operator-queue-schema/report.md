# Empirical Verification Report: Operator Queue Schema & Designation

**Date:** 2026-10-14
**Scope:** Verification for Operator Queue Schema and Operator Designation (Task B)

---

### 1. Current `bot_accounts` Schema
From `server/migrations/0001_v2_schema.sql`:
```sql
CREATE TABLE IF NOT EXISTS bot_accounts (
    id                  TEXT PRIMARY KEY,
    display_name        TEXT NOT NULL,
    avatar_file_id      TEXT,
    bot_identity_pubkey TEXT NOT NULL,
    bot_command_pubkey  TEXT NOT NULL,
    identity_pubkey     TEXT NOT NULL,
    owner_user_id       TEXT NOT NULL REFERENCES users(id),
    declarations        TEXT,
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    disabled_at         DATETIME,
    deleted_at          DATETIME
);
```
**FK Target:** New tables `bot_operators` and `bot_operator_queue` reference `bot_accounts(id) ON DELETE CASCADE`.

---

### 2. Current `bot_accounts` Handlers & Bot Creation Transaction
- `POST /bots` (`create_bot` in `server/src/routes/bots.rs`).
- Transaction flow: Begins `state.pool.begin()`, allocates `user_seq` for owner, inserts into `bot_accounts`, inserts declared scopes into `bot_declared_scopes`, inserts token into `bot_tokens`, appends leaf to Key Transparency log (`append_bot_leaf`), and commits.
- **Operator Binding Insertion Point:** The self-binding insertion (`INSERT INTO bot_operators (bot_id, user_id, bound_at, bound_by, binding) VALUES (?, ?, CURRENT_TIMESTAMP, ?, 'self')`) is added inside `create_bot`'s transaction immediately following the `bot_accounts` insert.

---

### 3. Current `GET /bots/:id` Handler & Visibility Patterns
- Handler: `get_bot` in `server/src/routes/bots.rs`.
- Response DTO: `BotView`.
- Current Auth: Evaluates caller via `resolve_caller` and checks `caller.is_owner_or_bot(&bot_id, &owner_user_id)`.
- Visibility pattern: Fields with `#[serde(skip_serializing_if = "Option::is_none")]` (such as `bot_token` and `connected` in `RoomBotView`) are omitted from JSON output when `None`. The `operators` field (`Option<Vec<OperatorView>>`) uses this exact pattern.

---

### 4. Current Bot Token Auth & Operator Visibility Pattern
- `resolve_caller` in `server/src/routes/bots.rs` checks the `Authorization: Bearer <token>` header:
  1. Validates bot tokens (`validate_bot_token`) -> returns `CallerIdentity::Bot(bot_ctx)`.
  2. Validates user session tokens (`validate_session`) -> returns `CallerIdentity::User(auth_user)`.
- **Operators Visibility Check:**
  - Owner (`CallerIdentity::User` where `user_id == owner_user_id`) -> sees `operators`.
  - Designated operator (`CallerIdentity::User` where `SELECT 1 FROM bot_operators WHERE bot_id = ? AND user_id = ?` is true) -> sees `operators`.
  - Bot self (`CallerIdentity::Bot` where `b.bot_id == target_bot_id`) -> sees `operators`.
  - All other authenticated callers -> `operators` is `None` (omitted from JSON response).

---

### 5. Current `room_bots` Grant Flow
Located in `server/src/routes/room_bots.rs`:
- `POST /rooms/:id/bots` (`grant_bot`): Verifies room membership/role, checks rate limits, scope dependencies, declared scopes, and active bot limit (10). Inserts into `room_bots` and `room_bot_scopes`.
  - **Operator Addition:** Option B is implemented. `GrantBotReq` accepts an optional `operators: Option<Vec<String>>` field. When provided, each `user_id` is validated as a member of `room_id` (returning 400 `invalid_operator` if not). Valid users are inserted into `bot_operators` with `binding = 'room-member'` and `bound_by = auth_user.user_id`.
- `PATCH /rooms/:id/bots/:bot_id` (`patch_room_bot`): Updates mode and scope entries. Does not alter operator bindings.
- `DELETE /rooms/:id/bots/:bot_id` (`delete_room_bot`): Revokes the grant by setting `revoked_at = CURRENT_TIMESTAMP`.
  - **Operator Removal:** Deletes `bot_operators` rows where `bot_id = ? AND binding = 'room-member' AND bound_by = granter_user_id` (where `granter_user_id` is `room_bots.granted_by`). Self-bindings and bindings from other grants remain untouched.

---

### 6. Current `bot_accounts.declarations` Column & Server Knowledge
- The `declarations` column exists on `bot_accounts` and stores JSON data.
- The server validates declaration structure but does not interpret recipe semantics server-side to classify bots as "operated". Option B (explicit `operators` parameter in `grant_bot`) provides explicit client control over operator bindings.

---

### 7. Current Cleanup Job Registry Pattern
- Scheduler in `server/src/cleanup/mod.rs` and job registration in `server/src/main.rs`.
- Registration pattern: `scheduler.register(Box::new(server::cleanup::<module>::<JobStruct>));`.
- Task E will register the operator queue timeout job following this pattern.

---

### 8. Current Audit Action Constants
- Defined in `server/src/audit.rs` (`pub mod action`).
- Bot audit constants currently present: `BOT_DECLARATION_UPDATE`, `BOT_KEY_ROTATE`.
- Constants to be added in this task:
  - `pub const BOT_OPERATOR_BOUND: &str = "bot.operator.bound";`
  - `pub const BOT_OPERATOR_UNBOUND: &str = "bot.operator.unbound";`
  - `pub const BOT_OPERATOR_QUEUE_PURGED: &str = "bot.operator_queue_purged";`

---

### 9. Current Bot Deletion Path
- `DELETE /bots/:id` (`delete_bot` in `server/src/routes/bots.rs`).
- `delete_bot` soft-deletes `bot_accounts` (`UPDATE bot_accounts SET deleted_at = CURRENT_TIMESTAMP`).
- Soft-deletion does not trigger SQLite `ON DELETE CASCADE`. Therefore, `delete_bot` will explicitly delete rows from `bot_operator_queue` and `bot_operators` inside its transaction, count deleted queue entries N, and log the `BOT_OPERATOR_QUEUE_PURGED` audit entry with `metadata = { "bot_id": bot_id, "entries": N }`.

---

### 10. Current `bot_settings` Table Schema Pattern
- Defined in `0001_v2_schema.sql`: `PRIMARY KEY (bot_id, key)` with `FOREIGN KEY (bot_id) REFERENCES bot_accounts(id) ON DELETE CASCADE`.
- `bot_operators` follows this exact bot-scoped pattern: `PRIMARY KEY (bot_id, user_id)` with FK references to `bot_accounts(id)` and `users(id)`.

---

### 11. Existing Tests & Batch Assignment
- Existing tests touching bot accounts, grants, and deletion:
  - `server/tests/bots.rs`
  - `server/tests/room_bots.rs`
  - `server/tests/bot_declarations.rs`
  - `server/tests/bot_key_rotation.rs`
  - `server/tests/bot_settings.rs`
  - `server/tests/observer_stream.rs`
- All assigned to the `bots` batch in `server/tests/batch-manifest.toml`.
- New test suite: `server/tests/operator_queue_schema.rs` assigned to the `bots` batch.

---

### 12. V2 Remnants
- No remnants found. All bot tables and handlers strictly conform to V3 consolidated schema.
