# Step 0 Verification Report: Operator-Facing Queue Endpoints

## 1. Task A Dependency
`allocate_bot_seq`, `append_bot_event_log`, and `prepare_durable_bot_event` are present and fully implemented in `server/src/bots/delivery.rs` (re-exported in `server/src/bots/mod.rs`).

Signatures and Module Paths:
- `server::bots::delivery::allocate_bot_seq(tx: &mut SqliteConnection, bot_id: &str) -> Result<i64, sqlx::Error>`
- `server::bots::delivery::append_bot_event_log(tx: &mut SqliteConnection, bot_id: &str, bot_seq: i64, event_type: &str, payload: &Value) -> Result<(), sqlx::Error>`
- `server::bots::delivery::prepare_durable_bot_event(tx: &mut SqliteConnection, bot_id: &str, event_type: &str, payload: Value) -> Result<(i64, Value), sqlx::Error>`

## 2. Task B Dependency
`bot_operators` and `bot_operator_queue` tables exist with complete schemas in `server/migrations/0001_v2_schema.sql`.
`derive_payload_preview(payload: &Value) -> String` exists in `server/src/bots/operator_queue.rs`.

## 3. Current Operator Authorization Check
The authorization gate pattern is implemented in `server/src/routes/bots.rs`:
- Caller identity resolved via `resolve_caller(&state.pool, &headers, &state).await?`.
- Checks if caller is bot owner (`CallerIdentity::User(u)` with `u.user_id == owner_user_id`), or bot self (`CallerIdentity::Bot(b)` with `b.bot_id == bot_id`), or designated operator (`is_bot_operator(&state.pool, &bot_id, &user_id).await?`).
- Non-operators receive `404 not_found` (to avoid information disclosure per proposal §6). Non-existent bot ID or non-existent request ID also returns `404 not_found`.

## 4. Current Bot Token Auth
`resolve_caller` supports both user session tokens (`CallerIdentity::User`) and bot tokens (`CallerIdentity::Bot`).
For operator queue endpoints:
- A user session caller is authorized if they are the bot owner or a designated operator.
- A bot token caller is authorized if `bot_token.bot_id == :id`.

## 5. Current Error Response Conventions
Standard `ApiError` variants in `server/src/error.rs`:
- 400: `ApiError::BadRequest("invalid_routing".into())`, `"invalid_response".into()`, `"invalid_cursor".into()`, `"invalid_status".into()`.
- 404: `ApiError::NotFound("not_found".into())`.
- 409: `ApiError::Conflict("already_answered".into())`.
- 410: `ApiError::Gone("expired".into())`.
Response envelope format: `{"error": {"code": "<error_code>", "message": "..."}}`.

## 6. Current Pagination Cursor Pattern
Cursor encoding/decoding uses unpadded base64url (`URL_SAFE_NO_PAD`).
Cursor struct for operator queue listing:
- `status = "pending"`: cursor encodes `{"queued_at": "...", "id": "..."}`. ORDER BY `queued_at DESC, id ASC`.
  Comparison for next page: `(queued_at < cursor_queued_at) OR (queued_at = cursor_queued_at AND id > cursor_id)`.
- `status = "answered"`: cursor encodes `{"answered_at": "...", "id": "..."}`. ORDER BY `answered_at DESC, id ASC`.
  Comparison for next page: `(answered_at < cursor_answered_at) OR (answered_at = cursor_answered_at AND id > cursor_id)`.

## 7. Current Publication Path for Durable Bot Events
To publish durable bot events:
Inside transaction:
`let (bot_seq, payload) = prepare_durable_bot_event(&mut tx, &bot_id, "bot.operator_response", payload).await?;`
After transaction commit:
`Publisher::publish(&state.publisher, &format!("private-bot-{}", bot_id), "bot.operator_response", payload).await;`

## 8. Current Time Formatting
`Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)` produces standard ISO 8601 strings (e.g., `2026-01-15T09:00:00.000Z`).

## 9. Current Audit Action Constants
Decision: No audit log entry is written on `respond`. This matches proposal §14.8 and working spec decisions.

## 10. Existing Tests
- `server/tests/operator_queue_schema.rs` tests Task B schema, operator bindings, and CASCADE deletions.
- New integration tests will be placed in `server/tests/operator_queue_endpoints.rs` under the `bots` batch in `server/tests/batch-manifest.toml`.

## 11. Current Test Harness
Existing integration tests use `common::setup_test_app().await` which sets up a wiremock `Publisher` server to record published Sockudo events for assertion.

## 12. V2 Remnants
None.

## Routing Contradiction Resolution
Working Spec Resolution:
The database schema stores `audience` as a single string (`'private'` or `'public'`).
Option 1 is adopted per server team recommendations:
- The operator does not send `routing` (or if present in the request body, returns 400 `invalid_routing`).
- Request body accepts `{ "response": "..." }`.
- Delivery `routing` value in `bot.operator_response` payload is set to the entry's stored `audience` column value.
