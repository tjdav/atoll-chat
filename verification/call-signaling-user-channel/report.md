# Step 0 Empirical Verification Report: Call Signaling Relay (Phase 18)

## Overview
This report establishes the ground truth baseline for call signaling prior to implementing Phase 18 (Call Signaling Relay) per V3 Specification §2.2, §5.6, §6.24, §7.9, §8.7.7, §8.9, §8.10, and §12.

---

## 1. Current Call Signaling Endpoints
Under `/rooms/:id/calls/*`, the current codebase (`server/src/routes/calls.rs`, `server/src/lib.rs`) exposes:
- `POST /api/v1/rooms/:id/calls/:call_id/signal`: Auth required (`AuthUser`).
  - Request shape: `{ "signal_type": "<string>", "payload": "<string>" }`
  - Response shape: `{ "delivered_to": <usize> }` (HTTP 202 ACCEPTED)
- `POST /api/v1/rooms/:id/calls/:call_id/end`: Auth required (`AuthUser`).
  - Response shape: `{ "call_id": "...", "room_id": "...", "initiator_id": "...", "started_at": "...", "ended_at": "..." }`
- `POST /api/v1/calls/turn-credentials`: Auth required (`AuthUser`).
  - Response shape: `{ "url": "...", "username": "...", "credential": "...", "ttl": 600 }`

**Comparison against §8.7:**
§8.7 specifies:
- `POST /rooms/:id/calls/:call_id/join` (Phase 19)
- `POST /rooms/:id/calls/:call_id/leave` (Phase 19)
- `POST /rooms/:id/calls/:call_id/signal` (Phase 18) — Request shape: `{ "sender_client_id": "<client_id>", "target_user_id": "<user_id>", "target_client_id": "<client_id>", "envelope": "<base64url>" }`, Response: `{ "delivered_to": 1 }` (HTTP 200 OK).
- `POST /rooms/:id/calls/:call_id/end` (Phase 19)
- `GET /rooms/:id/calls` (Phase 37)

The endpoints `join`, `leave`, and call history `GET` do not yet exist.

---

## 2. Current Signal Handler
Located in `server/src/calls/signal.rs` (`send_signal`):
- Currently accepts V2 `SignalRequest { signal_type, payload }`.
- Performs database queries on the persistent `call_participants` table to find all active participants where `user_id != caller_id` and `left_at IS NULL`.
- Publishes `call.signal` events to `private-user-{target_user_id}` for each active participant found in the database.

---

## 3. Current `call.signal` Payload
Currently in `server/src/calls/signal.rs`:
```json
{
  "call_id": "<call_id>",
  "sender_user_id": "<caller_id>",
  "signal_type": "<signal_type>",
  "payload": "<payload>"
}
```

**Comparison against §8.9:**
V3 §8.9 specifies:
```json
{
  "call_id": "c_...",
  "sender_user_id": "u_...",
  "sender_client_id": "c_...",
  "target_client_id": "c_...",
  "envelope": "<base64url>"
}
```
V3 removes `signal_type` and `payload` (the signal content is encrypted end-to-end inside `envelope`) and adds `sender_client_id` and `target_client_id`.

---

## 4. Current Call Occupancy
There is currently **no in-memory call occupancy data structure** in the codebase.
Call participation is managed through SQL reads/writes to the `call_participants` table in SQLite (`server/migrations/0001_v2_schema.sql`).

**Comparison against §7.9:**
V3 §7.9 specifies:
```rust
pub struct CallOccupancyStore {
    inner: Arc<RwLock<HashMap<String, CallOccupancy>>>,
}

pub struct CallOccupancy {
    pub participants: HashMap<String, ParticipantEntry>, // user_id -> entry
    pub call_started_at: Instant,
}

pub struct ParticipantEntry {
    pub client_ids: HashSet<String>,
}
```
V3 removes the `call_participants` table completely and holds occupancy purely in memory.

---

## 5. Current `call_participants` Table
The `call_participants` table exists in `server/migrations/0001_v2_schema.sql` (lines 369–375):
```sql
CREATE TABLE IF NOT EXISTS call_participants (
    call_id   TEXT NOT NULL REFERENCES call_sessions(id) ON DELETE CASCADE,
    user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    left_at   DATETIME,
    PRIMARY KEY (call_id, user_id)
);
```
§7.9 does not list `call_participants`. Per task directives, V3 is a clean break and `call_participants` will be removed from `0001_v2_schema.sql`.

---

## 6. Current `rooms.call_active` and `rooms.call_participants` Columns
An audit of `server/migrations/0001_v2_schema.sql` confirms that neither `call_active` nor `call_participants` columns exist on the `rooms` table in `0001_v2_schema.sql`.

---

## 7. Current `call_sessions` Table
The `call_sessions` table exists in `server/migrations/0001_v2_schema.sql` (lines 360–367):
```sql
CREATE TABLE IF NOT EXISTS call_sessions (
    id           TEXT PRIMARY KEY,
    room_id      TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    initiator_id TEXT NOT NULL REFERENCES users(id),
    started_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ended_at     DATETIME
);
CREATE INDEX IF NOT EXISTS idx_call_sessions_room ON call_sessions(room_id, started_at DESC);
```
This schema matches V3 §7.9 exactly and is retained for call history (§8.7.4).

---

## 8. Current `RATE_CALL_SIGNAL_PER_MIN`
`RATE_CALL_SIGNAL_PER_MIN` is not currently implemented in `server/src/config.rs` or `server/src/rate_limit.rs`.
V3 §5.6 specifies default 120, key format: `call_signal:{user_id}:{call_id}:min:{boundary}` (per user per call).

---

## 9. Current Capabilities
In `server/src/routes/capabilities.rs`:
- `calling: state.config.calling_enabled`
- `call_max_participants: state.config.call_max_participants`

Both fields are present in `GET /capabilities` matching V3 §8.1.

---

## 10. Current `CALLING_ENABLED`
In `server/src/config.rs`:
- `CALLING_ENABLED` environment variable (default `false`).
- When `calling_enabled = false`, `send_signal` returns `CallError::CallingDisabled`, mapped via `ApiError::From` to HTTP 501 `calling_disabled`. Matches V3 §8.7.

---

## 11. Current Call Occupancy Logging/Persistence Audit
- Persistence: `send_signal` and `end_call` write to `call_participants` SQL table.
- Logging: `send_signal` and `end_call` emit `tracing::warn!` on event publish failures with `call_id` and `room_id`.
- Audit: `end_call` writes an audit log entry for `CALL_END` (on `call_sessions`).
- V3 §12 Normative Constraint: Call occupancy MUST NOT be persisted to database, logged to stdout/stderr, or exported to metrics/tracing.

---

## 12. Current Whisper/Room-Channel Fanout for Calls
- `call.signal`: Published exclusively on `private-user-{target_user_id}` (user channel). No `call.signal` events are published on `private-room-{room_id}`.
- `call.started` and `call.ended`: Published on `private-room-{room_id}` (room channel).

---

## 13. Existing Tests
In `server/tests/`:
- `call_signaling.rs`
- `call_lifecycle.rs`
- `call_turn.rs`

Batch Assignment in `server/tests/batch-manifest.toml`: Assigned to batch `messaging`.

---

## 14. V2 Remnants Identified
1. `call_participants` table in `server/migrations/0001_v2_schema.sql`.
2. `call_participants` SQL queries in `server/src/calls/signal.rs` and `server/src/calls/lifecycle.rs`.
3. V2 signal request/response shape (`signal_type`, `payload`, status 202 ACCEPTED).

---

## Summary
Step 0 empirical verification is complete. The repository baseline is understood and ready for Phase 18 implementation.
