# Empirical Verification Report: Bot Owner Local Messages

## 1. Phase 44 Status
- `POST /bots/me/messages` endpoint exists in `server/src/routes/bots.rs` in function `post_bot_messages`.
- Registered in `server/src/lib.rs` (line 436): `.route("/bots/me/messages", post(routes::bots::post_bot_messages))`.
- Currently handles `target: "invoker"`.

## 2. Current `target: "owner"` Handling
- `post_bot_messages` explicitly checks `target == "owner"` and returns `Err(ApiError::BadRequest("unsupported_target".into()))`.
- Yields HTTP status 400 Bad Request with JSON body `{"error": "unsupported_target"}`.

## 3. Current `ENDPOINT_BOT_COMMAND_RESULT` Constant
- `pub const ENDPOINT_BOT_COMMAND_RESULT: &str = "bot-command-result";` exists in `server/src/bots/idempotency.rs`.
- Choice for Phase 45: Add a distinct constant `pub const ENDPOINT_BOT_LOCAL_MESSAGE: &str = "bot-local-message";` in `server/src/bots/idempotency.rs`. This prevents cross-target request_id collision when a bot reuses a `request_id` across `invoker` and `owner` target modes.

## 4. Current Idempotency Helper
- `check_or_reserve_request_id`, `record_response_code`, and `validate_request_id` exist in `server/src/bots/idempotency.rs` and are re-exported in `server/src/bots/mod.rs`.

## 5. Current Bot Token Auth
- Uses `resolve_caller(&state.pool, &headers, &state)`.
- Rejects non-bot callers (`CallerIdentity::User`) with HTTP 401 Unauthorized (`ApiError::Unauthorized("unauthorized".into())`).
- Extracts `bot_ctx` (`BotConnectionState`).

## 6. Current `bot_accounts.owner_user_id` Lookup
- Standard query pattern in `server/src/routes/bots.rs`:
  ```rust
  SELECT owner_user_id FROM bot_accounts WHERE id = ? AND deleted_at IS NULL
  ```
- Yields `owner_user_id`. Returns 404 `bot_not_found` if missing or soft-deleted.

## 7. Current `RATE_BOT_LOCAL_MESSAGE_PER_MIN` Config
- Present in `server/src/config.rs`: `rate_bot_local_message_per_min`, defaulted to 60 in `Config::default()`, read from `RATE_BOT_LOCAL_MESSAGE_PER_MIN` environment variable.

## 8. Current `RATE_BOT_COMMAND_RESULT_PER_MIN` Config
- Present in `server/src/config.rs`: `rate_bot_command_result_per_min` (default 120).
- Phase 45 adds `RateLimitKey::BotLocalMessage { bot_id: String }` in `server/src/rate_limit.rs` using `config.rate_bot_local_message_per_min`, formatted as `bot_local_message:{bot_id}:min:{boundary}`.

## 9. Current User-Channel Non-Durable Publish Pattern
- Direct publish via `Publisher::publish(&state.publisher, &format!("private-user-{}", user_id), event_name, payload)`.
- Does not allocate a `user_seq`. Event is non-durable and live-only per V3 Spec §8.9.

## 10. Current `result_type` Validation
- For `target: "invoker"`, allowed values are `["local_message", "toast", "panel", "none"]`.
- For `target: "owner"`, per §8.8.12 field table, content is required. Allowed values: `["local_message", "toast", "panel"]`.
- If `"none"` or any unrecognized string is provided for `target: "owner"`, returns HTTP 400 Bad Request with `invalid_result_type`.

## 11. Current Ciphertext and `bot_result_pubkey` Validation
- `ciphertext`: required base64url string. Decodes to non-empty bytes. Decoded length <= 64 KiB (65536 bytes). Missing/malformed base64url yields 400 `invalid_ciphertext`. Length > 65536 bytes yields 413 `ciphertext_too_large`.
- `bot_result_pubkey`: required base64url string. Decodes to exactly 32 bytes. Missing/malformed/incorrect length yields 400 `invalid_bot_result_pubkey`.

## 12. Existing Tests
- Located in `server/tests/bot_command_results.rs`, registered under batch `bots` in `server/tests/batch-manifest.toml`:
  - `test_post_bot_messages_invoker_happy_path`
  - `test_post_bot_messages_unsupported_owner_target`
  - `test_post_bot_messages_validation_matrix`
  - `test_post_bot_messages_idempotency_and_conflicts`
  - `test_post_bot_messages_rate_limit`
  - `test_post_bot_messages_opacity_and_no_logging`
- Phase 45 tests will be placed in `server/tests/bot_local_messages.rs` under batch `bots`.

## 13. V2 Remnants
- None. `POST /bots/me/messages` and `bot.local_message` have zero legacy V2 implementations or assumptions.
