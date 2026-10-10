# Empirical Verification Report: Bot Request Idempotency

**Date:** 2026-10-10
**Target:** Phase 46 — Bot Request Idempotency (`bot_request_log`)

---

## Executive Summary & Classification

This verification evaluates the current repository state for implementing `bot_request_log` idempotency deduplication across bot endpoints (`POST /rooms/:id/bot-messages` and `POST /rooms/:id/bot-commands`).

**Ambiguity Resolution & Classification:** **Interpretation A (Case A)**.
- **Rationale:** Section 8.8.10 specifies "A duplicate request_id for the same endpoint returns the original response." Section 7.10 specifies `bot_request_log` with columns `(bot_id, request_id, endpoint, response_code, created_at)`. Storing `response_code` (e.g. 202) and returning the same HTTP status code (202 Accepted) with an idempotent response payload satisfies the server contract without requiring schema modifications or response body persistence.
- **Proceeding:** Proceeding directly to implementation (Case A).

---

## 13 Verification Checklist Items

### 1. Current `bot_request_log` Table
- **Status:** Absent.
- **Finding:** Searched `server/migrations/0001_v2_schema.sql` and database runtime tables. The table `bot_request_log` is not present.

### 2. Current `POST /rooms/:id/bot-messages` Handler
- **Status:** Absent.
- **Finding:** The endpoint `POST /rooms/:id/bot-messages` is absent from `server/src/routes/` and `server/src/lib.rs`.
- **Plan:** Will implement `post_bot_message` in `server/src/routes/room_bots.rs` and register route `/rooms/{id}/bot-messages` in `server/src/lib.rs`. Request JSON accepts `{ epoch, ciphertext, content_type, signature, request_id? }`.

### 3. Current `POST /rooms/:id/bot-commands` Handler
- **Status:** Present (`post_bot_command` in `server/src/routes/room_bots.rs`).
- **Request Shape:** `PostBotCommandReq { bot_id: String, ciphertext: String, request_id: String }`.
- **Current Behavior:** Validates `request_id` format (non-empty, printable ASCII, length <= 64), but does not persist or deduplicate against any table.

### 4. Current Idempotency Infrastructure
- **Status:** Absent.
- **Finding:** No deduplication helper or `request_log` pattern currently exists in `server/src/`.

### 5. Current Cleanup Job Registry
- **Status:** Present.
- **Finding:** Cleanup modules exist in `server/src/cleanup/` (`bot_commands.rs`, `sync.rs`, `pending_removes.rs`, etc.). Registered in `server/src/cleanup/mod.rs` and invoked periodically by the scheduler in `server/src/main.rs`.

### 6. Current `bot_request_log` TTL Config
- **Status:** Unconfigured.
- **Finding:** V3 Spec §4.5 mandates a 24-hour pruning retention for bot request log idempotency records. Stored as hardcoded constant `BOT_REQUEST_LOG_TTL_HOURS = 24` in `server/src/cleanup/bot_request_log.rs`.

### 7. Current Bot Token Authentication on Bot Messages
- **Status:** Verified.
- **Finding:** Uses `crate::routes::bots::resolve_caller(&state.pool, &headers, &state).await?`. Rejects non-bot callers or tokens not matching target `bot_id`.

### 8. Current Bot Grant Scope Check on Bot Messages
- **Status:** Verified.
- **Finding:** Verifies active row in `room_bots` (`revoked_at IS NULL`) and `room_bot_scopes` row with `scope = 'post_message'`. Returns 403 `bot_not_granted` if missing.

### 9. Current Bot Grant Scope Check on Bot Commands
- **Status:** Verified.
- **Finding:** Verifies active row in `room_bots` (`revoked_at IS NULL`) and `room_bot_scopes` row with `scope = 'read_commands'`. Returns 403 `bot_not_granted` if missing.

### 10. Current Response Shapes
- **`POST /rooms/:id/bot-messages`:** `202 Accepted` `{ "message_id": "...", "created_at": "..." }` (fresh write) or `{ "message_id": "...", "created_at": "...", "idempotent": true }` (deduplicated replay).
- **`POST /rooms/:id/bot-commands`:** `202 Accepted` `{ "command_id": "...", "created_at": "...", "request_id": "...", "idempotent": true }` (deduplicated replay).

### 11. Current Error Code Conventions
- **Conflict (409):** `ApiError::Conflict("request_id_conflict".into())` yields `{ "error": "request_id_conflict" }`.
- **Bad Request (400):** `ApiError::BadRequest("invalid_request_id".into())` yields `{ "error": "invalid_request_id" }`.

### 12. Existing Tests
- **Files:** `server/tests/bot_commands.rs`, `server/tests/bots.rs`, `server/tests/room_bots.rs`.
- **Batch:** `bots`.
- **New Tests:** `server/tests/bot_request_log.rs` registered in `bots` batch in `server/tests/batch-manifest.toml`.

### 13. V2 Remnants
- `PostBotCommandReq` accepts `request_id` and validates format, but does not perform deduplication check or storage.

---

## Conclusion

The project state is verified. Proceeding with deliverables under Case A.
