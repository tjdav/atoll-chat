# Step 0 — Empirical Verification Report: Operator Queue Cleanup, Timeout, and Rate Limits

**Date:** 2026-10-15
**Task:** Operator Queue Track — Task E (Cleanup, Timeout, and Rate Limits)

---

## 1. Task B Dependency
- **Schema Confirmation:** `bot_operator_queue` table exists in `server/migrations/0001_v2_schema.sql` (lines 619–638).
- **Columns:** `id`, `bot_id`, `room_id`, `audience`, `requester_user_id`, `payload`, `payload_preview`, `status` (CHECK `pending`|`answered`|`expired`), `queued_at`, `timeout_at`, `on_timeout` (CHECK `ignore`|`canned`), `canned_response`, `answered_at`, `responded_by`, `response`, `routing` (CHECK `private`|`public`).
- **Indexes:**
  - `idx_bot_operator_queue_timeout` ON `bot_operator_queue(timeout_at) WHERE status = 'pending' AND timeout_at IS NOT NULL` (lines 644–646).
  - `idx_bot_operator_queue_retention` ON `bot_operator_queue(answered_at) WHERE status IN ('answered', 'expired')` (lines 648–650).

---

## 2. Task A Dependency
- **Helper File:** `server/src/bots/delivery.rs` (re-exported in `server/src/bots/mod.rs`).
- **Helper Signature:**
  ```rust
  pub async fn prepare_durable_bot_event(
      tx: &mut SqliteConnection,
      bot_id: &str,
      event_type: &str,
      mut payload: Value,
  ) -> Result<(i64, Value), sqlx::Error>
  ```
- **Functionality:** Inside a caller transaction, allocates monotonic `bot_seq` via `allocate_bot_seq`, attaches `bot_seq` to payload, writes row to `bot_event_log`, and returns `(bot_seq, payload)` for post-commit Sockudo publication.

---

## 3. Current Cleanup Job Registry
- **Module Location:** `server/src/cleanup/`
- **Trait Definition:** `CleanupJob` in `server/src/cleanup/mod.rs`:
  ```rust
  #[async_trait]
  pub trait CleanupJob: Send + Sync {
      fn name(&self) -> &'static str;
      async fn run(&self, ctx: &CleanupContext<'_>) -> Result<CleanupReport, CleanupError>;
  }
  ```
- **Registration Pattern:** Registered on the shared scheduler in `server/src/main.rs` via `scheduler.register(Box::new(...))`.
- **Templates:** `BotCommandsTtlJob` (`server/src/cleanup/bot_commands.rs`) and `BotEventLogTtlJob` (`server/src/cleanup/bot_event_log.rs`).

---

## 4. Current Cleanup Scheduler Frequency
- **Scheduler Interval:** Configured via `config.cleanup_interval_minutes` in `server/src/config.rs` (defaults to 60 minutes).
- **Initialization:** In `server/src/main.rs` line 398: `server::cleanup::Scheduler::new(Duration::from_secs(config.cleanup_interval_minutes * 60))`.
- **Granularity Constraint:** The scheduler runs hourly (every 60 minutes). The effective minimum timeout for the `OperatorQueueTimeoutJob` is bounded by this hourly tick interval. A row with a 5-minute timeout will expire at the next hourly scheduler tick after `timeout_at` passes.

---

## 5. Current Config Pattern for Rate Limits
- **Struct:** `RateLimitConfig` in `server/src/config.rs`.
- **Environment Parsing:** `Config::from_env` reads `RATE_*` env vars, parses with `.unwrap_or(...)`.
- **Task E Declarations:**
  - `rate_operator_queue_list_per_min: u32`, default 60, env `RATE_OPERATOR_QUEUE_LIST_PER_MIN`
  - `rate_operator_queue_respond_per_min: u32`, default 30, env `RATE_OPERATOR_QUEUE_RESPOND_PER_MIN`
  - `rate_operator_queue_enqueue_per_min: u32`, default 60, env `RATE_OPERATOR_QUEUE_ENQUEUE_PER_MIN`

---

## 6. Current RateLimitKey Enum
- **Location:** `server/src/rate_limit.rs`.
- **Key Generation Pattern:** Handled in `compute_rate_limit_key`:
  - `OperatorQueueList { bot_id: String, user_id: String }` -> `operator_queue_list:{bot_id}:{user_id}:min:{boundary}` (`Window::Minute`, `config.rate_operator_queue_list_per_min`)
  - `OperatorQueueRespond { bot_id: String, user_id: String }` -> `operator_queue_respond:{bot_id}:{user_id}:min:{boundary}` (`Window::Minute`, `config.rate_operator_queue_respond_per_min`)
  - `OperatorQueueEnqueue { bot_id: String }` -> `operator_queue_enqueue:{bot_id}:min:{boundary}` (`Window::Minute`, `config.rate_operator_queue_enqueue_per_min`)

---

## 7. Current Rate Limit Enforcement
- **Enforcement Helper:** `check_rate_limit(&state.pool, &state.config.rate_limits, key).await?`.
- **Call Site Example:** `rotate_bot_keys` in `server/src/routes/bots.rs` (lines 2175–2188).
- **Error Behavior:** If `!decision.allowed`, returns `ApiError::TooManyRequests { message: "rate_limited".into(), reset_at: decision.reset_at }` with HTTP 429 and `Retry-After` header.
- **Wiring Target:** Enforced on Task C's list (`GET /bots/:id/operator-queue`) and respond (`POST /bots/:id/operator-queue/:request_id/respond`) handlers before any database queries or transactions.

---

## 8. Current Test Harness for Cleanup Jobs
- **Pattern:** Test cases construct a `CleanupContext` (or `CleanupContextOwned`) with a test database pool and test config, seed rows directly into SQLite with past timestamps (e.g., `datetime('now', '-1 hour')` or `datetime('now', '-8 days')`), invoke `job.run(&ctx).await`, and assert affected rows and published events.

---

## 9. Current Test Harness for Rate Limits
- **Pattern:** Test loops construct and send requests until the limit is exceeded, asserting HTTP 200/201/204 up to limit N, HTTP 429 on request N+1, and verifying presence of `Retry-After` header.

---

## 10. Existing Tests
- **Existing Schema Suite:** `server/tests/operator_queue_schema.rs` (7 test functions testing DB schema, cascade deletes, self-binding, grant/revoke, operator visibility, purge on deletion, payload preview derivation).
- **Batch Assignment:** `bots` batch in `server/tests/batch-manifest.toml`.
- **New Test File:** `server/tests/operator_queue_cleanup.rs` added under the `bots` batch in `server/tests/batch-manifest.toml`.

---

## 11. Current TimeoutAt Computation
- **Nullable Column:** `timeout_at` is nullable (`DATETIME`) in `bot_operator_queue`. `timeout = "never"` stores `timeout_at = NULL`.
- **Timeout Job Behavior:** The timeout job queries `WHERE status = 'pending' AND timeout_at IS NOT NULL AND timeout_at < CURRENT_TIMESTAMP`. NULL `timeout_at` rows are cleanly skipped.

---

## 12. Current Canned Response Storage
- **Nullable Column:** `canned_response` is nullable (`TEXT`) in `bot_operator_queue`.
- **Timeout Job Behavior:** If `on_timeout = 'canned'` and `canned_response IS NULL`, the timeout job logs a warning with `id` and `bot_id`, marks status as `expired`, and skips event publication without failing the job run.

---

## 13. V2 Remnants
- **Search Result:** No legacy code paths, conflicts, or assumptions were found in `server/src/`. All operator queue interactions are grounded in V3 spec & working spec contracts.

---
