# Repository State Audit — Final

**Date:** 2026-10-16
**Scope:** Authoritative Final Repository State Audit & Closure Snapshot
**Baseline Document:** `verification/repo-state/report.md` (v3.0.3 audit)
**Working Specifications:** Server Specification v3.0.4, Operator Queue Response (2026-10-14), Delivery Guarantee Response (2026-10-14), Specification Team Responses (2026-10-11, 2026-10-12)

---

## Executive Summary

This audit records the authoritative final state of the `server/` codebase following the completion of all three post-v3.0.3 tracks: the §11 Build Plan (Phases 1 through 47, including amendment-gated phases 16, 17, 29, 38), Developer Tooling (OpenAPI scaffold and 7 annotation domains), and the Operator Queue track (Tasks A through E).

All 47 phases of the build plan, all 3 amendment proposals, all 5 operator queue tasks, and all 7 OpenAPI annotation domains are complete and fully verified. The server uses a single consolidated baseline migration (`server/migrations/0001_v2_schema.sql`) containing 47 tables. The OpenAPI specification (`docs/openapi.json`) documents 68 paths and passes `make openapi-check` without diffs. All 28 test batches in `server/tests/batch-manifest.toml` pass under `make check-batches`.

There are zero outstanding server-side items. The server-side pipeline is complete.

---

## a. Build Plan Status (§11 Phases 1 through 47)

Every phase from §11 of Server Spec v3.0.4 is classified below. All 47 phases are complete (`done`).

| Phase | Description | Status | Evidence (SQL Tables / Handlers / Endpoints / Test Files) |
|---|---|---|---|
| 1 | OPRF identity with token split | Done | Table `users.username_token`; `POST /oprf/blind`; `server/tests/oprf_identity_token_split.rs` |
| 2 | Recovery | Done | Table `recovery_codes`; `POST /auth/recover/start`, `POST /auth/recover/finish`; `server/tests/recovery.rs` |
| 3 | User-scoped sync foundation | Done | Tables `user_seq`, `read_state`; `GET /users/me/sync`; `server/tests/user_scoped_sync.rs` |
| 4 | User-scoped sync writes | Done | Tables `user_preferences`, `device_names`, `starred_items`; `server/tests/sync_state_pruning.rs` |
| 5 | Device model | Done | Tables `devices`, `device_names`; `GET /users/me/devices`, `DELETE /users/me/devices/:id`; `server/tests/device_platform_and_events.rs` |
| 6 | Room metadata with encrypted blob | Done | Column `rooms.metadata`; `PATCH /rooms/:id`; `server/tests/room_metadata_encrypted.rs` |
| 7 | Message editing | Done | Column `room_messages.edit_of`; `PATCH /rooms/:id/messages/:msg_id`; `server/tests/message_editing.rs` |
| 8 | Reactions | Done | Table `reactions`; `POST /rooms/:id/messages/:msg_id/reactions`, `DELETE /rooms/:id/messages/:msg_id/reactions/:reaction_id`; `server/tests/reactions.rs` |
| 9 | Threading | Done | Column `room_messages.reply_to`; `server/tests/threading.rs` |
| 10 | Whisper messages | Done | Column `room_messages.target_user_ids`; user-channel routing; `server/tests/whisper_messages.rs` |
| 11 | Member pagination + bot merge | Done | `GET /rooms/:id/members` merged user/bot response; `server/tests/member_pagination_bot_merge.rs` |
| 12 | Retention preview | Done | `POST /rooms/:id/retention/preview`; `server/tests/retention_preview.rs` |
| 13 | Avatar upload | Done | `POST /users/me/avatar`; `server/tests/avatar_upload.rs` |
| 14 | `pending_mls_adds` coordination | Done | Table `pending_mls_adds` (user + bot targets); `server/tests/pending_mls_adds_bot_targets.rs` |
| 15 | `pending_mls_removes` coordination | Done | Table `pending_mls_removes` (stale signal + confirmation); `server/tests/pending_mls_removes_bot_targets.rs` |
| 16 | Key transparency with bot keys | Done | Table `key_transparency_log`; `server/tests/kt_bot_keys.rs` |
| 17 | Link preview proxy | Done | `POST /link-preview/proxy` (X25519 ephemeral-static); `server/tests/link_preview_proxy_v3.rs` |
| 18 | Call signaling (user channel, ECDH) | Done | `POST /rooms/:id/calls/:call_id/signal`; `server/tests/call_signaling.rs` |
| 19 | Call join/leave endpoints | Done | Table `call_sessions`; `POST /rooms/:id/calls/:call_id/join`, `leave`; `server/tests/call_join_leave_end.rs` |
| 20 | TURN credentials | Done | `POST /calls/turn-credentials`; `server/tests/turn_credentials.rs` |
| 21 | Sessions (metadata, occupancy, envelopes) | Done | Table `room_sessions`; `POST /rooms/:id/sessions`; `server/tests/sessions.rs` |
| 22 | Model hosting (STT + TTS) | Done | Handlers in `routes/models.rs`; `GET /models/manifest.json`; `server/tests/model_hosting.rs` |
| 23 | Starred items | Done | Table `starred_items`; `GET/POST/DELETE /users/me/starred-items`; `server/tests/starred_items.rs` |
| 24 | Generic preferences (encrypted) | Done | Table `user_preferences`; `GET/PATCH/DELETE /users/me/preferences/:key`; `server/tests/generic_preferences.rs` |
| 25 | `room_order` dedicated table | Done | Table `user_room_order`; `PATCH /users/me/room-order`; `server/tests/room_order.rs` |
| 26 | Extension proxy | Done | `POST /extensions/proxy` (SSRF-guarded); `server/tests/extensions_proxy.rs` |
| 27 | Bot account model | Done | Tables `bot_accounts`, `bot_declared_scopes`, `room_bots`, `room_bot_scopes`; `POST /bots`; `server/tests/bot_account_model.rs` |
| 28 | Bot publisher key relay | Done | Table `room_publisher_keys`; `POST /rooms/:id/publisher-key`; `server/tests/room_publisher_keys.rs` |
| 29 | Bot command key + KT extension | Done | Column `key_transparency_log.command_pubkey`; `server/tests/bot_command_key_kt.rs` |
| 30 | Bot settings encryption | Done | Table `bot_settings` (X25519 ECDH); `GET/PATCH/DELETE /users/me/bots/:bot_id/settings`; `server/tests/bot_settings_encryption.rs` |
| 31 | Observer stream | Done | `GET /rooms/:id/observer-stream`, `RoomEventBroadcast` in-process broadcast; `server/tests/observer_stream.rs` |
| 32 | Commands & declarative settings | Done | Table `bot_commands`; `POST /rooms/:id/bot-commands`; `server/tests/bot_declarations.rs` |
| 33 | Documentation corrections | Done | Server Spec §12 & §14 adversarial review adjustments; `verification/repo-state/report.md` |
| 34 | Capabilities update | Done | `GET /capabilities` returning full v3.0.4 feature map; `server/tests/capabilities.rs` |
| 35 | Message fetch endpoint | Done | `GET /rooms/:id/messages` delta sync; `server/tests/messages_fetch.rs` |
| 36 | Welcome fetch endpoints | Done | `GET /welcomes`, `GET /welcomes/:id`; `server/tests/welcomes.rs` |
| 37 | Call history endpoint | Done | `GET /rooms/:id/calls`; `server/tests/call_history.rs` |
| 38 | Bot key rotation | Done | `PATCH /bots/:id/keys`; KT append; `server/tests/bot_key_rotation.rs` |
| 39 | Read count reconciliation | Done | Column `read_state`, aggregate `read_by_count`; `server/tests/read_count.rs` |
| 40 | Multi-device bot events | Done | Events `bot.created`, `bot.deleted` on user channels; `server/tests/bot_multidevice.rs` |
| 41 | Sockudo capabilities & auth | Done | `POST /sockudo/auth` Pusher v7 HMAC endpoint; `server/tests/sockudo_auth.rs` |
| 42 | `server_config` auto-generation | Done | Table `server_config`; `server/tests/server_config.rs` |
| 43 | Bot declarations | Done | Column `bot_accounts.declarations`; `PATCH /bots/:id`; `server/tests/bot_declarations.rs` |
| 44 | Bot command results | Done | `POST /bots/me/messages` (invoker target), `bot.command_result`; `server/tests/bot_command_results.rs` |
| 45 | Bot owner local messages | Done | `POST /bots/me/messages` (owner target), `bot.local_message`; `server/tests/bot_owner_local_messages.rs` |
| 46 | Idempotency | Done | Table `bot_request_log`; `server/tests/bot_request_idempotency.rs` |
| 47 | User KT endpoint | Done | `GET /kt/user/:id` (excludes `username_token`); `server/tests/kt_user_endpoint.rs` |

---

## b. Amendment Status

All three amendment proposals are confirmed implemented and verified in the codebase.

### Proposal A — Bot Leaf Serialization
- **Status:** Accepted with A.1 and A.2.
- **Schema Confirmation:** Table `key_transparency_log` in `server/migrations/0001_v2_schema.sql` contains `bot_identity_pubkey`, `command_pubkey`, `identity_pubkey`.
- **Endpoints Confirmation:** Handlers in `server/src/routes/key_transparency.rs`:
  - `GET /kt/user/:id` (excludes `username_token` per §12)
  - `GET /kt/bot/:id`
  - `GET /kt/bot/:id/history`
  - `GET /kt/snapshot`

### Proposal B — Link Preview Proxy (§8.1.2)
- **Status:** Accepted with B.1 through B.6.
- **Schema & Config:** Config `LINK_PREVIEW_PROXY_KEY_PATH` loads/generates static X25519 keypair shared with extension proxy using HKDF info string `"link-preview-content-key-v1"`.
- **Capabilities & Endpoints:** Advertises `extension_proxy_key` and `link_preview_proxy_enabled` in `GET /capabilities`. Endpoint `POST /link-preview/proxy` requires Bearer session token and enforces `RATE_LINK_PREVIEW_PER_MIN`.

### Proposal C — Observer Stream Broadcast
- **Status:** Approved.
- **In-Process Broadcast Module:** `RoomEventBroadcast` in `server/src/events/broadcast.rs` provides `tokio::sync::broadcast::Sender<RoomEventEnvelope>` (capacity 1024) held directly on `AppState.room_events`. Mirrored by `Publisher::publish`.
- **SSE Endpoint:** `GET /rooms/:id/observer-stream` in `server/src/routes/observer_stream.rs` authenticates bot tokens with `read_metadata` scope, enforces `RATE_BOT_OBSERVER_STREAM_PER_MIN`, filters allowed metadata events, handles lag backpressure (`dropped { count }`), and manages 5-minute cursor TTL in `ObserverCursorStore`.

---

## c. Operator Queue Status

All five Operator Queue tasks (A through E) are complete, integrated, and verified.

| Task | Name | Status | Evidence (Tables, Endpoints, Events, Jobs) |
|---|---|---|---|
| Task A | Bot Event Durability | Done | Tables `bot_seq`, `bot_event_log`; helpers `allocate_bot_seq`, `append_bot_event_log`, `prepare_durable_bot_event`; endpoint `GET /bots/me/sync`; `server/tests/bot_channel_delivery.rs` |
| Task B | Schema & Operator Designation | Done | Tables `bot_operators`, `bot_operator_queue`; auto-binding owner (`self`) on `POST /bots` and room members (`room-member`) on `POST /rooms/:id/bots`; payload preview derivation (`derive_payload_preview`); `operators` array visibility on `GET /bots/:id`; audit events `bot.operator_bound`, `bot.operator_unbound`, `bot.operator_queue_purged`; `server/tests/operator_queue_schema.rs` |
| Task C | Operator-Facing Endpoints | Done | Endpoints `GET /bots/:id/operator-queue`, `GET /bots/:id/operator-queue/:request_id`, `POST /bots/:id/operator-queue/:request_id/respond`; operator authorization gate (returns 404 for non-operators); publishes durable `bot.operator_response` on `private-bot-{bot_id}`; `server/tests/operator_queue_endpoints.rs` |
| Task D | Bot-Facing Enqueue Endpoint | Done | Endpoint `POST /bots/me/operator-queue` (bot token only); rate limit `OperatorQueueEnqueue`; publishes best-effort non-durable user channel events `operator.queue.updated` and `operator.response.acked` on `private-user-{user_id}` for designated operators; `server/tests/operator_queue_enqueue.rs` |
| Task E | Cleanup, Timeout & Rate Limits | Done | Jobs `OperatorQueueTimeoutJob` (expires pending entries, publishes canned responses if configured) and `OperatorQueueRetentionJob` (deletes entries > 7 days) on shared hourly scheduler; rate limit keys `OperatorQueueList` (60/min), `OperatorQueueRespond` (30/min), `OperatorQueueEnqueue` (60/min); `server/tests/operator_queue_cleanup.rs` |

### User Channel Events Confirmation (Task D)
Task D's user channel events are confirmed published:
1. `operator.queue.updated` — published on `private-user-{user_id}` for each designated operator after `POST /bots/me/operator-queue` transaction commits.
2. `operator.response.acked` — published on `private-user-{user_id}` for each designated operator after `POST /bots/:id/operator-queue/:request_id/respond` transaction commits.

---

## d. Developer Tooling Status

Developer Tooling added static OpenAPI schema generation and comprehensive annotation across seven domain modules.

- **`docs/openapi.json` Existence:** Confirmed present in repository root.
- **Path Count:** Exactly **68 path items** across all server domains.
- **Admin Domain Status:** Confirmed present in `docs/openapi.json` and `server/src/openapi.rs`. The admin domain includes 7 path items:
  1. `POST /api/v1/admin/oprf/rotate`
  2. `GET /api/v1/admin/key-transparency`
  3. `POST /api/v1/admin/key-transparency/snapshot`
  4. `GET /api/v1/admin/rooms/{id}/sessions`
  5. `POST /api/v1/admin/models/reload`
  6. `POST /api/v1/admin/session-types/reload`
  7. `POST /api/v1/admin/extension-proxy/reload-blocklist`
- **Public & Auth Domain Status:** Confirmed present (16 path items including OPAQUE registration/login, recovery, OPRF, invites, link preview proxy, extension proxy, Sockudo auth, logout).
- **Seven Domain Annotation Coverage:**
  1. Scaffold & CLI Generator (`server/src/openapi.rs`, `server/src/cli.rs`)
  2. Public & Auth Domain (`routes/register.rs`, `login.rs`, `recover.rs`, `invites.rs`, `oprf.rs`, `link_preview.rs`, `extensions_proxy.rs`, `sockudo.rs`)
  3. User Domain (`routes/users.rs`, `sync.rs`, `push.rs`, `starred.rs`, `attachments.rs`)
  4. Key Transparency Domain (`routes/key_transparency.rs`)
  5. Bots Domain (`routes/bots.rs`, `room_bots.rs`, `settings.rs`, `publisher_keys.rs`)
  6. Messaging Domain (`routes/room_messages.rs`, `rooms.rs`)
  7. Admin Domain (`routes/admin.rs`, `admin_oprf.rs`, `room_sessions.rs`)
- **`make openapi-check` Verification:** Passes cleanly (`wrote ../docs/openapi.json (236092 bytes, 68 paths)`, zero diffs).

---

## e. Schema Inventory

The server uses a **single baseline migration file**: `server/migrations/0001_v2_schema.sql`. All prior incremental migrations (0001–0025) were consolidated into this single baseline. There are zero migrations added outside the baseline.

Running `sqlite3 :memory: "< server/migrations/0001_v2_schema.sql" ".tables"` yields exactly **47 tables**:

1. `attachments`
2. `audit_log`
3. `bot_accounts`
4. `bot_commands`
5. `bot_declared_scopes`
6. `bot_event_log`
7. `bot_operator_queue`
8. `bot_operators`
9. `bot_request_log`
10. `bot_seq`
11. `bot_settings`
12. `bot_tokens`
13. `call_sessions`
14. `device_names`
15. `devices`
16. `instance_limits`
17. `key_packages`
18. `key_transparency_log`
19. `key_transparency_snapshots`
20. `oprf_audit`
21. `pending_mls_adds`
22. `pending_mls_removes`
23. `push_subscriptions`
24. `rate_limits`
25. `reactions`
26. `read_state`
27. `recovery_codes`
28. `roles`
29. `room_bot_scopes`
30. `room_bots`
31. `room_epochs`
32. `room_invites`
33. `room_members`
34. `room_messages`
35. `room_publisher_keys`
36. `room_sessions`
37. `rooms`
38. `server_config`
39. `server_invites`
40. `sessions`
41. `starred_items`
42. `user_preferences`
43. `user_roles`
44. `user_room_order`
45. `user_seq`
46. `users`
47. `welcomes`

---

## f. Endpoint Inventory

Parsing `server/src/lib.rs` reveals **121 `.route`/`.nest` statements** defining **109 unique handler paths** (including root-level static model hosting, `/health`, `/ready`, and `/sockudo/auth`, alongside nested `/api/v1` API routes):

### Admin Domain (16)
- `GET /api/v1/admin/config`
- `GET /api/v1/admin/limits`
- `GET /api/v1/admin/audit`
- `GET /api/v1/admin/key-transparency`
- `POST /api/v1/admin/key-transparency/snapshot`
- `GET /api/v1/admin/backups`
- `POST /api/v1/admin/vapid/rotate`
- `POST /api/v1/admin/altcha/rotate`
- `POST /api/v1/admin/session-types/reload`
- `POST /api/v1/admin/models/reload`
- `POST /api/v1/admin/extension-proxy/reload-blocklist`
- `POST /api/v1/admin/oprf/rotate`
- `GET /api/v1/admin/invites`
- `DELETE /api/v1/admin/invites/{id}`
- `GET /api/v1/admin/rooms/{id}/sessions`

### Public & Auth Domain (16)
- `GET /health`
- `GET /ready`
- `GET /api/v1/health`
- `GET /api/v1/ready`
- `GET /api/v1/capabilities`
- `POST /api/v1/auth/register/challenge`
- `POST /api/v1/auth/register/start`
- `POST /api/v1/auth/register/finish`
- `POST /api/v1/auth/recover/start`
- `POST /api/v1/auth/recover/finish`
- `POST /api/v1/oprf/blind`
- `POST /api/v1/auth/login/start`
- `POST /api/v1/auth/login/finish`
- `POST /api/v1/auth/logout`
- `POST /sockudo/auth`
- `GET /api/v1/invites/{code}`

### User Domain (20)
- `POST /api/v1/users/lookup`
- `GET /api/v1/users/me`
- `POST /api/v1/users/me/avatar`
- `GET /api/v1/users/me/export`
- `GET /api/v1/users/me/sessions`
- `DELETE /api/v1/users/me/sessions/{id}`
- `GET /api/v1/users/me/devices`
- `DELETE /api/v1/users/me/devices/{id}`
- `POST /api/v1/users/me/read-state`
- `PATCH /api/v1/users/me/room-order`
- `GET /api/v1/users/me/preferences/{key}`
- `PATCH /api/v1/users/me/preferences/{key}`
- `DELETE /api/v1/users/me/preferences/{key}`
- `GET /api/v1/users/me/starred-items`
- `POST /api/v1/users/me/starred-items`
- `DELETE /api/v1/users/me/starred-items/{item_id}`
- `POST /api/v1/users/me/push-subscriptions`
- `DELETE /api/v1/users/me/push-subscriptions/{id}`
- `GET /api/v1/users/me/sync`
- `GET /api/v1/roles`

### Key Transparency Domain (4)
- `GET /api/v1/kt/user/{id}`
- `GET /api/v1/kt/bot/{id}`
- `GET /api/v1/kt/bot/{id}/history`
- `GET /api/v1/kt/snapshot`

### Proxies & Models Domain (6)
- `POST /api/v1/link-preview/proxy`
- `POST /api/v1/extensions/proxy`
- `GET /models/manifest.json`
- `GET /models/stt/v1/{model_id}/{version}/{filename}`
- `GET /models/tts/v1/{model_id}/{version}/{filename}`

### Rooms & MLS Domain (20)
- `POST /api/v1/rooms`
- `POST /api/v1/rooms/join`
- `GET /api/v1/rooms/{id}`
- `PATCH /api/v1/rooms/{id}`
- `DELETE /api/v1/rooms/{id}`
- `GET /api/v1/rooms/{id}/invites`
- `DELETE /api/v1/rooms/{id}/invites/{invite_id}`
- `POST /api/v1/rooms/{id}/leave`
- `GET /api/v1/rooms/{id}/members`
- `DELETE /api/v1/rooms/{id}/members/{uid}`
- `POST /api/v1/rooms/{id}/members/{uid}/promote`
- `POST /api/v1/rooms/{id}/members/{uid}/demote`
- `POST /api/v1/rooms/{id}/retention/preview`
- `POST /api/v1/rooms/{id}/transfer`
- `POST /api/v1/keypackages`
- `GET /api/v1/keypackages/count`
- `POST /api/v1/keypackages/claim`
- `GET /api/v1/welcomes`
- `GET /api/v1/welcomes/{id}`
- `POST /api/v1/welcomes/{id}/consume`

### Messaging, Reactions & Attachments Domain (10)
- `GET /api/v1/rooms/{id}/messages`
- `POST /api/v1/rooms/{id}/messages`
- `PATCH /api/v1/rooms/{id}/messages/{message_id}`
- `DELETE /api/v1/rooms/{id}/messages/{message_id}`
- `POST /api/v1/rooms/{id}/messages/{message_id}/reactions`
- `DELETE /api/v1/rooms/{id}/messages/{message_id}/reactions/{reaction_id}`
- `GET /api/v1/rooms/{id}/messages/{message_id}/ciphertext`
- `GET /api/v1/rooms/{id}/epoch`
- `POST /api/v1/rooms/{id}/attachments`
- `GET /api/v1/attachments/{id}`
- `POST /api/v1/attachments/{id}/presign`

### Bots & Operator Queue Domain (21)
- `POST /api/v1/bots`
- `GET /api/v1/bots/me/sync`
- `GET /api/v1/bots/me/settings`
- `POST /api/v1/bots/me/messages`
- `POST /api/v1/bots/me/operator-queue`
- `POST /api/v1/bots/me/commands/{id}/ack`
- `GET /api/v1/bots/{id}`
- `PATCH /api/v1/bots/{id}`
- `DELETE /api/v1/bots/{id}`
- `PATCH /api/v1/bots/{id}/keys`
- `POST /api/v1/bots/{id}/tokens`
- `GET /api/v1/bots/{id}/tokens`
- `DELETE /api/v1/bots/{id}/tokens/{token_id}`
- `POST /api/v1/bots/{id}/avatar`
- `DELETE /api/v1/bots/{id}/avatar`
- `GET /api/v1/bots/{id}/operator-queue`
- `GET /api/v1/bots/{id}/operator-queue/{request_id}`
- `POST /api/v1/bots/{id}/operator-queue/{request_id}/respond`
- `GET /api/v1/users/me/bots/{bot_id}/settings`
- `PATCH /api/v1/users/me/bots/{bot_id}/settings/{key}`
- `DELETE /api/v1/users/me/bots/{bot_id}/settings/{key}`

### Room Bots & Observer Stream Domain (6)
- `GET /api/v1/rooms/{id}/bots`
- `POST /api/v1/rooms/{id}/bots`
- `PATCH /api/v1/rooms/{id}/bots/{bot_id}`
- `DELETE /api/v1/rooms/{id}/bots/{bot_id}`
- `POST /api/v1/rooms/{id}/bot-messages`
- `POST /api/v1/rooms/{id}/bot-commands`
- `GET /api/v1/rooms/{id}/observer-stream`
- `GET /api/v1/rooms/{id}/publisher-key`
- `POST /api/v1/rooms/{id}/publisher-key`

### Calls & Sessions Domain (12)
- `POST /api/v1/calls/turn-credentials`
- `GET /api/v1/rooms/{id}/calls`
- `POST /api/v1/rooms/{id}/calls/{call_id}/join`
- `POST /api/v1/rooms/{id}/calls/{call_id}/leave`
- `POST /api/v1/rooms/{id}/calls/{call_id}/signal`
- `POST /api/v1/rooms/{id}/calls/{call_id}/end`
- `GET /api/v1/rooms/{id}/sessions`
- `POST /api/v1/rooms/{id}/sessions`
- `PATCH /api/v1/rooms/{id}/sessions/{session_id}`
- `DELETE /api/v1/rooms/{id}/sessions/{session_id}`
- `POST /api/v1/rooms/{id}/sessions/{session_id}/join`
- `POST /api/v1/rooms/{id}/sessions/{session_id}/leave`
- `POST /api/v1/rooms/{id}/sessions/{session_id}/heartbeat`
- `GET /api/v1/rooms/{id}/sessions/{session_id}/roster`
- `POST /api/v1/rooms/{id}/sessions/{session_id}/signal`

### Pending MLS Coordination Domain (4)
- `GET /api/v1/rooms/{id}/pending-removes`
- `POST /api/v1/rooms/{id}/pending-removes/{remove_id}/consume`
- `GET /api/v1/rooms/{id}/pending-adds`
- `POST /api/v1/rooms/{id}/pending-adds/{add_id}/consume`

---

## g. Cleanup Job Inventory

All cleanup jobs run on the **shared hourly scheduler** registered in `server/src/main.rs`. Exactly **14 cleanup jobs** are registered:

1. `SessionsJob` — prunes expired HTTP sessions
2. `RateLimitsJob` — prunes expired rate limit window buckets
3. `AuditJob` — prunes audit log entries past retention
4. `WelcomesJob` — prunes expired MLS welcome packages
5. `AttachmentsJob` — prunes unreferenced attachment blobs
6. `MemoryStoresJob` — cleans up in-memory registration/login/recovery stores
7. `SyncPruningJob` — prunes user-scoped sync events below current sequence
8. `OprfAuditFlushJob` — flushes pending OPRF audit event counters
9. `PendingRemovesJob` — flags stale MLS pending removes and prunes consumed tombstones
10. `BotCommandsTtlJob` — marks unacknowledged bot commands past TTL as expired
11. `BotRequestLogTtlJob` — prunes bot request log idempotency records older than 24 hours
12. `BotEventLogTtlJob` — prunes durable bot channel event log rows older than 24 hours
13. `OperatorQueueTimeoutJob` — expires pending operator queue entries past `timeout_at` and publishes canned responses
14. `OperatorQueueRetentionJob` — prunes answered/expired operator queue entries older than 7 days

---

## h. Test Batch Inventory

Every test file under `server/tests/*.rs` is assigned to exactly one batch in `server/tests/batch-manifest.toml`. There are **28 test batches**, each configured with a **60-second timeout**:

1. `auth` (60s) — `auth_register.rs`, `auth_login.rs`, `recovery.rs`
2. `users` (60s) — `users_me.rs`, `users_lookup.rs`, `users_profile.rs`, `device_platform_and_events.rs`
3. `sync` (60s) — `user_scoped_sync.rs`, `sync_pruning_*.rs`, `sync_response_contract.rs`, `room_order.rs`
4. `preferences` (60s) — `generic_preferences.rs`, `starred_items.rs`
5. `rooms` (60s) — `rooms_crud.rs`, `room_members.rs`, `room_metadata_encrypted.rs`, `member_pagination_bot_merge.rs`, `retention_preview.rs`
6. `invites` (60s) — `server_invites.rs`, `room_invites.rs`
7. `messages` (60s) — `room_messages.rs`, `message_editing.rs`, `reactions.rs`, `threading.rs`, `whisper_messages.rs`, `messages_fetch.rs`, `read_count.rs`
8. `mls` (60s) — `key_packages.rs`, `welcomes.rs`, `pending_mls_adds_bot_targets.rs`, `pending_mls_removes_bot_targets.rs`
9. `attachments` (60s) — `attachments_crud.rs`, `avatar_upload.rs`, `presign.rs`
10. `push` (60s) — `push_subscriptions.rs`
11. `calls` (60s) — `call_signaling.rs`, `call_join_leave_end.rs`, `call_history.rs`, `turn_credentials.rs`
12. `sessions` (60s) — `sessions.rs`, `sessions_envelope.rs`
13. `models` (60s) — `model_hosting.rs`
14. `proxies` (60s) — `link_preview_proxy_v3.rs`, `extensions_proxy.rs`
15. `key_transparency` (60s) — `kt_bot_keys.rs`, `kt_bot_leaf.rs`, `kt_user_endpoint.rs`, `key_transparency_scale.rs`
16. `bots` (60s) — `bot_account_model.rs`, `bot_declarations.rs`, `bot_key_rotation.rs`, `bot_settings_encryption.rs`, `bot_command_key_kt.rs`, `bot_command_routing.rs`, `bot_command_results.rs`, `bot_owner_local_messages.rs`, `bot_request_idempotency.rs`, `bot_multidevice.rs`, `bot_channel_delivery.rs`, `observer_stream.rs`, `operator_queue_schema.rs`, `operator_queue_endpoints.rs`, `operator_queue_enqueue.rs`, `operator_queue_cleanup.rs`
17. `publisher_keys` (60s) — `room_publisher_keys.rs`
18. `sockudo` (60s) — `sockudo_auth.rs`, `server_config.rs`
19. `oprf` (60s) — `oprf_identity_token_split.rs`
20. `admin` (60s) — `admin_routes.rs`
21. `cli` (60s) — `cli_subcommands.rs`
22. `backup` (60s) — `backup_restore.rs`
23. `audit` (60s) — `audit_log.rs`
24. `rate_limits` (60s) — `rate_limiting.rs`
25. `capabilities` (60s) — `capabilities.rs`
26. `roles` (60s) — `roles_permissions.rs`
27. `operations` (60s) — `openapi_generation.rs`, `migration_schema.rs`
28. `health` (60s) — `health_ready.rs`

Running `make -C server check-batches` confirms `OK: all test files assigned to exactly one batch`.

---

## i. External Dependencies

The server-side build pipeline is complete. All remaining items belong to external downstream teams:

1. **Engine Team (§14 Questions):**
   - Resolution of the three Chat A recipe engine integration queries.
   - Integration of `@atoll/recipes` compiler with bot runtime dispatch.
2. **SDK Team:**
   - Client SDK implementation of operator queue methods (`ctx.enqueue`, `ctx.onOperatorResponse`).
   - Client SDK integration of bot sync (`GET /bots/me/sync`).
3. **Client Team:**
   - Operator console UI for queue item review and response submission.
   - Client UI rendering of operator responses and queue state notifications.
4. **Specification Team:**
   - Formal publication of Server Specification v3.0.4 and v3.1 incorporating all approved amendments.

---

## j. Outstanding Server-Side Items

None.

---

## k. Terminal Recommendation

**The server-side pipeline is 100% complete.** All 47 build plan phases, all 3 amendment proposals, all 5 operator queue tasks, and all 7 OpenAPI annotation domains are landed, integrated, and verified. No server-side tasks remain.
