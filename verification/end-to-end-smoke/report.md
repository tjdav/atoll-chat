# Empirical Verification Report — End-to-End Smoke Walkthrough

**Date:** 2026-10-17
**Scope:** Continuous End-to-End Smoke Walkthrough Integration Test
**Test Location:** `server/tests/end_to_end_walkthrough.rs`
**Execution Command:** `cargo test --manifest-path server/Cargo.toml --test end_to_end_walkthrough`
**Batch Command:** `make -C server test-operations`
**Runtime:** 9.29s (passes well within the 60s batch budget)

---

## Executive Summary

The end-to-end smoke walkthrough exercises the server as a single continuous chain from registration through bot creation, room management, operator queue submission, operator response, bot sync, key transparency verification, and cleanup job execution.

The walkthrough passes end-to-end against a fresh in-memory SQLite database and full Axum router stack, confirming that cross-domain interactions hold together cleanly across all server domains.

---

## 1. Test Harness Inventory (`server/tests/common/mod.rs`)

An audit of `server/tests/common/mod.rs` was completed in Step 0:

* **Database & App Setup:**
  * `pub async fn setup_test_db() -> SqlitePool`: Connects to in-memory SQLite database and applies all migrations from `./migrations`.
  * `pub async fn setup_test_app() -> (Router, SqlitePool)`: Spawns in-memory test app with default test configuration.
  * `pub async fn setup_test_app_with_custom_config<F>(modify: F) -> (Router, SqlitePool, Arc<AltchaConfig>)`: Spawns test app with custom `Config` mutator.
* **Registration & Auth Helpers:**
  * `pub async fn fetch_and_solve_altcha(app: &Router) -> String`: Solves test ALTCHA challenge via `/api/v1/altcha/challenge`.
  * `pub async fn obtain_username_token(app: &Router, username: &str) -> String`: Performs OPRF blind + eval + HKDF derivation for username lookup token.
  * `pub async fn register_user(app: &Router, username: &str, password: &str, invite_code: Option<&str>) -> String`: Full 2-step OPAQUE registration returning `user_id`.
  * `pub async fn login_user(app: &Router, username: &str, password: &str, client_id: &str, identity_pubkey: Option<&str>) -> (StatusCode, Value)`: Full 2-step OPAQUE login returning `(status, response_json)`.

---

## 2. Phase Summary & Purpose

1. **Phase 1 — Boot and capabilities:** Boot full Axum app with wiremock Sockudo publisher. Assert `/health`, `/ready`, `/capabilities`, and OpenAPI path count sanity check (68 documented OpenAPI path keys).
2. **Phase 2 — Registration and login:** Perform 2-step OPAQUE registration & login for Alice using harness helpers. Verify `users` row, `key_transparency_log` user leaf, and session authentication.
3. **Phase 3 — User state:** Verify `/users/me/sync?since_seq=0` initial state and `PATCH /users/me` encrypted display name update with valid 32-byte base64url payload.
4. **Phase 4 — Bot creation and operator self-binding:** Execute `POST /bots`. Confirm bot account creation, owner auto-bound as `self` operator in `bot_operators`, and `key_transparency_log` bot leaf creation.
5. **Phase 5 — Room creation and bot grant:** Create server invite for Bob, register Bob, create RoomX, invite Bob, create room invite code, redeem room invite code for Bob, and grant bot to RoomX with Bob designated as `room-member` operator.
6. **Phase 6 — User message send and fetch:** Post application message from Alice using valid `sender_client_id`. Confirm `message.new` event broadcast and fetch via `GET /rooms/:id/messages` verifying `sender_type="user"` and null `bot_key_leaf_index`.
7. **Phase 7 — Bot message send with KT leaf:** Post signed bot message via `POST /rooms/:id/bot-messages`. Confirm 202 Accepted, `sender_type="bot"`, and `bot_key_leaf_index` populated from the bot's KT leaf.
8. **Phase 8 — Bot command submission:** Post encrypted bot command from Alice (`POST /rooms/:id/bot-commands`). Verify pending status, `bot.command_invoked` event log entry, and bot ack (`POST /bots/me/commands/:id/ack`).
9. **Phase 9 — Operator queue enqueue:** Bot submits operator request (`POST /bots/me/operator-queue`). Verify 201 Created and pending row in `bot_operator_queue`.
10. **Phase 10 — Operator list:** Query `GET /bots/:id/operator-queue?status=pending` as Alice (self operator) and Bob (room-member operator). Register Carol (non-operator) and assert 404 NOT_FOUND authorization gate.
11. **Phase 11 — Operator responds:** Bob responds to request (`POST /bots/:id/operator-queue/:request_id/respond`). Confirm status `answered`, `responded_by = Bob`, and `bot.operator_response` event log entry.
12. **Phase 12 — Bot sync:** Bot queries `GET /bots/me/sync?since_bot_seq=0`. Confirm return of `bot.command_invoked` and `bot.operator_response` events ordered by sequence.
13. **Phase 13 — KT verification:** Create KT snapshot and fetch `GET /kt/bot/:id`, `GET /kt/user/:id`, and `GET /kt/snapshot`. Verify inclusion proof presence and `username_token` exclusion on user KT.
14. **Phase 14 — Timeout cleanup:** Seed pending operator queue request past `timeout_at` with `on_timeout='canned'`. Execute `OperatorQueueTimeoutJob`. Confirm status `expired`, `responded_by = NULL`, and canned response event log entry.
15. **Phase 15 — Retention cleanup:** Seed answered operator queue request older than 7 days. Execute `OperatorQueueRetentionJob`. Confirm pruning of old entry while retaining recent answered entry.
16. **Phase 16 — Final state check:** Query `GET /bots/me/sync` to confirm timeout event visibility, verify OpenAPI path count, confirm 14 registered cleanup jobs on scheduler, and verify wiremock captured Sockudo publishes.

---

## 3. What the Walkthrough Exercises vs. Does Not Exercise

* **Exercised:**
  * Full HTTP router & Axum middleware stack.
  * OPAQUE user registration and login state transitions.
  * Owner self-binding on `POST /bots`.
  * Room grant-time operator binding for room members.
  * Message sequence numbers, sender type classification, and KT bot leaf index attachment.
  * Bot command submission, event log sequence allocation, and command ack.
  * Operator queue submission, operator listing (with non-operator 404 secrecy gate), and operator response.
  * Bot channel event durability and replay via `GET /bots/me/sync`.
  * Key transparency tree head snapshotting, inclusion proof generation, and privacy exclusions.
  * Direct invocation of scheduler cleanup jobs against shared DB state.
  * Wiremock capture of background Sockudo event publishing.
* **Not Exercised (and Why):**
  * Real OPAQUE client crypto (uses test harness OPAQUE cipher suite helpers).
  * Real MLS client group key exchange (server treats ciphertext as opaque bytes; test passes opaque bytes).
  * WebSocket Sockudo TCP connection (wiremock captures HTTP publish API calls).
  * WebRTC media transport (out of scope for server core test suite).

---

## 4. Test Result

* **Status:** PASS (0 failures, 1 passed).
* **Test Runtime:** 9.29 seconds.
* **Gaps / Bugs Identified:** Zero bugs found. The composed server stack functions end to end without error.
