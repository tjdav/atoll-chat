# Step 0 — Empirical Verification Report: Operator Queue Enqueue Endpoint & User Channel Events

**Date:** 2026-10-15
**Task:** Task D — Bot-Facing Enqueue Endpoint & User Channel Events
**Status:** Complete (Reconnaissance & Baseline Verification)

---

## 1. Task B Dependency (Schema & `derive_payload_preview`)
- **`bot_operator_queue` Table:** Confirmed present in `server/migrations/0001_v2_schema.sql` (lines 619–650). Contains columns:
  - `id` (TEXT PRIMARY KEY)
  - `bot_id` (TEXT NOT NULL REFERENCES bot_accounts(id) ON DELETE CASCADE)
  - `room_id` (TEXT)
  - `audience` (TEXT NOT NULL CHECK(audience IN ('private', 'public')))
  - `requester_user_id` (TEXT REFERENCES users(id) ON DELETE SET NULL)
  - `payload` (TEXT NOT NULL)
  - `payload_preview` (TEXT NOT NULL)
  - `status` (TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'answered', 'expired')))
  - `queued_at` (DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)
  - `timeout_at` (DATETIME)
  - `on_timeout` (TEXT NOT NULL DEFAULT 'ignore' CHECK(on_timeout IN ('ignore', 'canned')))
  - `canned_response` (TEXT)
  - `answered_at` (DATETIME)
  - `responded_by` (TEXT)
  - `response` (TEXT)
  - `routing` (TEXT CHECK(routing IN ('private', 'public')))
- **`derive_payload_preview` Helper:** Confirmed present in `server/src/bots/operator_queue.rs`. Evaluates string/object priority (`preview` -> `message` -> `question` -> `"[request]"`) and truncates at 120 chars with `...`.

---

## 2. Task C Dependency (Operator Endpoints & Respond Handler)
- **Operator Queue Endpoints:** Confirmed present in `server/src/routes/bots.rs`:
  - `GET /bots/:id/operator-queue` (`get_operator_queue_list`)
  - `GET /bots/:id/operator-queue/:request_id` (`get_operator_queue_entry`)
  - `POST /bots/:id/operator-queue/:request_id/respond` (`respond_operator_queue_entry` at line 1253)
- **Respond Publication Location:** `respond_operator_queue_entry` currently publishes `bot.operator_response` to `private-bot-{bot_id}` post-commit. Task D adds the non-durable publication of `operator.response.acked` to each designated operator on `private-user-{user_id}` following that.

---

## 3. Task A Dependency (Bot Event Delivery Helpers)
- **Durable Helpers:** Confirmed present in `server/src/bots/delivery.rs`:
  - `allocate_bot_seq`
  - `append_bot_event_log`
  - `prepare_durable_bot_event`
- **User Channel Note:** User channel events (`operator.queue.updated` and `operator.response.acked`) are non-durable best-effort WebSocket hints and do not consume `bot_seq` or `user_seq`.

---

## 4. Task E Status (Rate Limits)
- **Rate Limit Config & Variant:** Verified absent from `server/src/config.rs` and `server/src/rate_limit.rs`.
- **Task D Action:** Task D adds `rate_operator_queue_enqueue_per_min` (env `RATE_OPERATOR_QUEUE_ENQUEUE_PER_MIN`, default 60) to `Config` and `RateLimitKey::OperatorQueueEnqueue { bot_id: String }` with key format `operator_queue_enqueue:{bot_id}:min:{boundary}` to `RateLimitKey`. Scope for Task E is reduced accordingly.

---

## 5. Current Bot Token Auth
- **`resolve_caller` Helper:** Located in `server/src/routes/bots.rs` (lines 50–110).
- **Variant:** Returns `CallerIdentity::Bot(BotTokenContext)` when authenticated via `Authorization: Bearer <bot_token>`. Returns `CallerIdentity::User(AuthUser)` for user sessions. `POST /bots/me/operator-queue` enforces `CallerIdentity::Bot` and returns 401 `unauthorized` for user session tokens.

---

## 6. Current Bot Grant & Scope Checks
- **Grant Lookup Query:**
  ```sql
  SELECT EXISTS(
      SELECT 1 FROM room_bots
      WHERE room_id = ? AND bot_id = ? AND revoked_at IS NULL
  )
  ```
- **Scope Lookup Query (for `post_message` when `audience == "public"`):**
  ```sql
  SELECT EXISTS(
      SELECT 1 FROM room_bots rb
      JOIN room_bot_scopes rbs ON rbs.room_id = rb.room_id AND rbs.bot_id = rb.bot_id
      WHERE rb.room_id = ? AND rb.bot_id = ? AND rb.revoked_at IS NULL AND rbs.scope = 'post_message'
  )
  ```

---

## 7. User Channel Non-Durable Event Pattern
- **Pattern:** `Publisher::publish(&publisher, &format!("private-user-{}", user_id), event_name, payload).await`
- Used across call signaling (`call.signal`), session signaling (`session.signal`), and bot local messages (`bot.local_message`). Best-effort; failures do not roll back transactions or fail requests.

---

## 8. Current Operator Designation Lookup
- **Query:** `SELECT user_id FROM bot_operators WHERE bot_id = ? ORDER BY bound_at ASC`
- Used by `enumerate_operators` helper in `server/src/bots/operator_queue.rs`.

---

## 9. Current `payload_preview` Helper Location
- Helper `derive_payload_preview` is in `server/src/bots/operator_queue.rs`.

---

## 10. Current `validate_request_id` Rules
- Located in `server/src/bots/idempotency.rs`.
- **Rules:**
  - `!trimmed.is_empty()`
  - `trimmed.len() <= 128`
  - Printable ASCII bytes only (`(32..=126).contains(&byte)`)

---

## 11. Existing Tests & Batch
- **Existing Integration Tests:**
  - `server/tests/operator_queue_schema.rs`
  - `server/tests/operator_queue_endpoints.rs`
  - `server/tests/bot_channel_delivery.rs`
- **New Test Location:** `server/tests/operator_queue_enqueue.rs`
- **Batch Assignment:** Assigned to `bots` batch in `server/tests/batch-manifest.toml` and `server/Makefile`.

---

## 12. Current Test Harness Event Verification
- WireMock server intercepts `POST /publish` calls to Sockudo.
- Assertions parse recorded HTTP request bodies matching `channels` array and event `name`.

---

## 13. V2 Remnants & Conflicts
- No conflicting legacy assumption or state representation found in `server/src/` or `server/migrations/`.
