# Empirical Verification Report — Operator Queue Cleanup, Timeout, and Rate Limits

**Date:** 2026-10-15
**Task:** Task E — Operator Queue Cleanup, Timeout, and Rate Limits
**Status:** Verification Completed

---

## 1. Task B Dependency Confirmation
Confirmed in `server/migrations/0001_v2_schema.sql` (lines 619–650):
Table `bot_operator_queue` exists with columns:
- `id` (TEXT PRIMARY KEY)
- `bot_id` (TEXT NOT NULL REFERENCES bot_accounts(id))
- `room_id` (TEXT REFERENCES rooms(id))
- `audience` (TEXT NOT NULL CHECK(audience IN ('private', 'public')))
- `requester_user_id` (TEXT REFERENCES users(id))
- `payload` (TEXT NOT NULL)
- `payload_preview` (TEXT NOT NULL)
- `status` (TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'answered', 'expired')))
- `queued_at` (DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)
- `timeout_at` (DATETIME)
- `on_timeout` (TEXT NOT NULL DEFAULT 'ignore' CHECK(on_timeout IN ('ignore', 'canned')))
- `canned_response` (TEXT)
- `answered_at` (DATETIME)
- `responded_by` (TEXT REFERENCES users(id))
- `response` (TEXT)
- `routing` (TEXT CHECK(routing IN ('private', 'public')))

Indexes confirmed:
- `idx_bot_operator_queue_pending` ON `bot_operator_queue(bot_id, queued_at DESC) WHERE status = 'pending'`
- `idx_bot_operator_queue_timeout` ON `bot_operator_queue(timeout_at) WHERE status = 'pending' AND timeout_at IS NOT NULL`
- `idx_bot_operator_queue_retention` ON `bot_operator_queue(answered_at) WHERE status IN ('answered', 'expired')`

---

## 2. Task A Dependency Confirmation
Confirmed durable bot event publishing helper `prepare_durable_bot_event` exists in `server/src/bots/delivery.rs` (re-exported in `server/src/bots/mod.rs`):
```rust
pub async fn prepare_durable_bot_event(
    tx: &mut SqliteConnection,
    bot_id: &str,
    event_type: &str,
    mut payload: Value,
) -> Result<(i64, Value), sqlx::Error>
```
The timeout job uses this helper within a transaction when `on_timeout = 'canned'` to allocate `bot_seq`, append the row to `bot_event_log` under event type `"bot.operator_response"`, and return the payload for post-commit Sockudo publication.

---

## 3. Current Cleanup Job Registry
Located in `server/src/cleanup/mod.rs`:
- Trait `CleanupJob`:
  ```rust
  #[async_trait]
  pub trait CleanupJob: Send + Sync {
      fn name(&self) -> &'static str;
      async fn run(&self, ctx: &CleanupContext<'_>) -> Result<CleanupReport, CleanupError>;
  }
  ```
- Scheduler registration in `server/src/main.rs` (lines 398–420) registers jobs using `scheduler.register(Box::new(...))`.
- Examples: `BotCommandsTtlJob` (`server/src/cleanup/bot_commands.rs`) and `BotEventLogTtlJob` (`server/src/cleanup/bot_event_log.rs`).

---

## 4. Current Cleanup Scheduler Frequency
Confirmed in `server/src/main.rs` line 398:
```rust
let mut scheduler = server::cleanup::Scheduler::new(std::time::Duration::from_secs(
    config.cleanup_interval_minutes * 60,
));
```
Default `cleanup_interval_minutes` is 60 (hourly tick). The timeout job runs on this shared scheduler. Effective minimum timeout granularity is bounded by the hourly tick.

---

## 5. Current Config Pattern for Rate Limits
Located in `server/src/config.rs`:
- Defined on `RateLimitConfig` struct.
- Environment variable loading pattern in `Config::from_env()`:
  ```rust
  let rate_operator_queue_list_per_min = env::var("RATE_OPERATOR_QUEUE_LIST_PER_MIN")
      .ok()
      .and_then(|s| s.parse().ok())
      .unwrap_or(60);

  let rate_operator_queue_respond_per_min = env::var("RATE_OPERATOR_QUEUE_RESPOND_PER_MIN")
      .ok()
      .and_then(|s| s.parse().ok())
      .unwrap_or(30);

  let rate_operator_queue_enqueue_per_min = env::var("RATE_OPERATOR_QUEUE_ENQUEUE_PER_MIN")
      .ok()
      .and_then(|s| s.parse().ok())
      .unwrap_or(60);
  ```

---

## 6. Current RateLimitKey Enum
Located in `server/src/rate_limit.rs`:
Enum `RateLimitKey` variant patterns:
- `OperatorQueueList { bot_id: String, user_id: String }` -> `operator_queue_list:{bot_id}:{user_id}:min:{boundary}`
- `OperatorQueueRespond { bot_id: String, user_id: String }` -> `operator_queue_respond:{bot_id}:{user_id}:min:{boundary}`
- `OperatorQueueEnqueue { bot_id: String }` -> `operator_queue_enqueue:{bot_id}:min:{boundary}` (already added in Task D pass)
Window: `Window::Minute` for all three.

---

## 7. Current Rate Limit Enforcement Pattern
In route handlers (e.g., `server/src/routes/bots.rs`):
```rust
let decision = rate_limit::check(
    &state.pool,
    &state.config.rate_limits,
    RateLimitKey::OperatorQueueList {
        bot_id: bot_id.clone(),
        user_id: caller.user_id().to_string(), // or caller.caller_id()
    },
)
.await?;

if !decision.allowed {
    return Err(ApiError::TooManyRequests {
        message: "rate_limited".into(),
        reset_at: decision.reset_at,
    });
}
```

---

## 8. Current Test Harness for Cleanup Jobs
Located in `server/tests/cleanup.rs`:
- Tests construct `CleanupContextOwned` via `build_ctx(pool, config)`.
- Invoke `job.run(&ctx.as_ctx()).await.unwrap()`.
- Assert `report.rows_deleted` and check DB state directly.

---

## 9. Current Test Harness for Rate Limits
In integration tests (e.g. `server/tests/operator_queue_enqueue.rs`):
- Loop calling endpoint up to limit + 1.
- Assert HTTP response status is 429 (`TooManyRequests`) with `retry-after` header present.

---

## 10. Existing Tests & Batch Assignment
- Existing tests: `server/tests/operator_queue_schema.rs`, `server/tests/operator_queue_endpoints.rs`, `server/tests/operator_queue_enqueue.rs`.
- Batch assignment in `server/tests/batch-manifest.toml`: `bots` batch.
- New test file: `server/tests/operator_queue_cleanup.rs` added under `bots` batch in `batch-manifest.toml`.

---

## 11. Current TimeoutAt Computation
`timeout_at` in schema is nullable (`DATETIME`).
When `timeout == "never"`, `timeout_at` is `NULL`.
The timeout job queries `WHERE timeout_at IS NOT NULL AND timeout_at < CURRENT_TIMESTAMP AND status = 'pending'`, correctly skipping `NULL` rows.

---

## 12. Current canned_response Storage
`canned_response` in schema is `TEXT` (nullable).
When `on_timeout = 'canned'`, if `canned_response IS NULL`, the timeout job logs a warning with row id and bot id, marks the entry expired, and skips publishing the event without failing the job.

---

## 13. V2 Remnants Audit
Audited `server/src/`: No V2 remnants found assuming operator queue entries are unexpired or computing timeouts elsewhere. The cleanup jobs and rate limit checks cleanly finalize the feature lifecycle.
