# Step 0 Empirical Verification Report: Call Join, Leave, and End Lifecycle (Phase 19)

**Date:** 2025-05-22
**Task:** Call Join, Leave, and End Lifecycle (§8.7.5, §8.7.6, §8.7.8, §8.9, §12, §14.8)

---

### 1. Current Join Endpoint
- **Status:** Absent.
- **Verification:** `GET/POST /rooms/{id}/calls/{call_id}/join` is not registered in `server/src/lib.rs` and has no handler in `server/src/routes/calls.rs` or `server/src/calls/`. Section 8.7.5 is new work.

### 2. Current Leave Endpoint
- **Status:** Absent.
- **Verification:** `POST /rooms/{id}/calls/{call_id}/leave` is not registered in `server/src/lib.rs` and has no handler in `server/src/routes/calls.rs` or `server/src/calls/`. Section 8.7.6 is new work.

### 3. Current End Endpoint
- **Handler location:** `server/src/calls/lifecycle.rs` (`end_call`), routed at `POST /rooms/{id}/calls/{call_id}/end` in `server/src/routes/calls.rs`.
- **Request shape:** Empty body.
- **Response shape:** `EndCallResponse` (`{ "call_id": "c_...", "room_id": "r_...", "initiator_id": "u_...", "started_at": "...", "ended_at": "..." }`).
- **Status codes:** HTTP 200 OK on success, HTTP 401 Unauthorized, HTTP 403 Forbidden (non-initiator, non-owner), HTTP 404 Room Not Found / Call Not Found, HTTP 501 Calling Disabled.
- **Authorization:** `AuthUser` required. Caller must be a room member (`rooms::get_room_for_user`). Caller must be the call initiator (`call_sessions.initiator_id`) or room owner (`rooms.owner_id`).

### 4. Current `call.started` Publisher
- **Status:** Absent.
- **Verification:** No publisher call exists for `call.started` anywhere in `server/src/`. V3 §8.9 requires publishing `{ "call_id": "c_...", "room_id": "r_...", "initiator_id": "u_...", "started_at": "..." }` on `private-room-{room_id}` on the first join.

### 5. Current `call.ended` Publisher
- **Status:** Present in `server/src/calls/lifecycle.rs`, but missing `duration_seconds`.
- **Current payload:** `{ "call_id": call_id, "room_id": room_id, "ended_at": ended_at }`.
- **V3 §8.9 specification:** `{ "call_id": call_id, "room_id": room_id, "ended_at": ended_at, "duration_seconds": <int> }`.
- **Action:** Add `duration_seconds` calculated as `(ended_at - started_at).num_seconds()`, truncated toward zero, always an integer.

### 6. Current `call_sessions` Write Path
- **Status:** Formerly created lazily in V2 on first signal (removed in Phase 18). Currently only updated on call end or seeded manually in tests (`seed_call_session`).
- **Phase 19 requirement:** Created on first join (`INSERT INTO call_sessions (id, room_id, initiator_id, started_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)`).

### 7. Current Audit Entries
- **Status:** Constants `action::CALL_START` (`"call.start"`) and `action::CALL_END` (`"call.end"`) exist in `server/src/audit.rs`.
- **Current writes:** `CALL_END` is logged in `end_call` with metadata `{ "call_id": call_id, "room_id": room_id }`. `CALL_START` is currently not written anywhere.
- **Phase 19 requirement:** `CALL_START` will be written on first join with metadata `{ "call_id": call_id, "room_id": room_id }`. `CALL_END` remains written on first end with metadata `{ "call_id": call_id, "room_id": room_id }`.

### 8. Current `call_max_participants` Enforcement
- **Status:** Absent in call handlers.
- **Limits config:** `InstanceLimits` and `ServerHardMax` contain `call_max_participants` (server hard max 50, instance default 8).
- **Phase 19 requirement:** Join handler evaluates effective limit via `limits::get_limits(&pool, &server_hard_max)`. If `participant_count(store, call_id)` exceeds effective `call_max_participants` after adding, remove the just-added client and return HTTP 409 `call_full`.

### 9. Current ICE Server Source
- **Status:** `generate_turn_credentials` exists in `server/src/calls/turn.rs` for `POST /calls/turn-credentials`.
- **Phase 19 placeholder:** Join response returns `{ "ice_servers": [] }`. Phase 20 will wire the credential generator.

### 10. Current Rate Limits for Join, Leave, End
- **Status:** None exist in `server/src/rate_limit.rs`.
- **V3 §5.6 specification:** Only `RATE_CALL_SIGNAL_PER_MIN` (120/min) is specified for call signaling. Join, leave, and end are un-rate-limited.

### 11. Current `CallOccupancyStore` Shape
- **Location:** `server/src/calls/occupancy.rs`.
- **Current methods:** `add_client`, `remove_client`, `remove_user`, `is_participant`, `is_client_owner`, `find_user_for_client`, `participant_user_ids`, `clear_call`.
- **Addition required:** `pub async fn participant_count(&self, call_id: &str) -> usize` returning the count of distinct user IDs currently in `participants`.

### 12. Existing Tests & Batch Assignment
- **Test files:** `server/tests/call_lifecycle.rs` (7 tests) and `server/tests/call_signaling.rs` (14 tests).
- **Batch assignment:** `messaging` batch in `server/tests/batch-manifest.toml` (`make -C server test-messaging`).

### 13. V2 Remnants Audit
- **Verification:** Grep across `server/src` and `server/tests` confirmed zero remnants writing to `call_participants`, reading `rooms.call_active` or `rooms.call_participants`, publishing `call.signal` on room channels, or logging occupancy data.
