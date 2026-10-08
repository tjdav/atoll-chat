# Empirical Verification Report: Sessions V3 Alignment — Envelope, Types, and Occupancy

## Executive Summary

This empirical report verifies the repository state for sessions prior to aligning session signaling, metadata opacity, schema, types, and occupancy with Server Specification v3.0.3 (§2.2, §5.26, §5.26.1, §6.26, §6.26.1, §7.9, §8.7, §8.7.11, §8.7.13, §8.9, §10, §12).

---

## 1. Current `room_sessions` Schema

**Location:** `server/migrations/0001_v2_schema.sql` (lines 370–383)

```sql
CREATE TABLE IF NOT EXISTS room_sessions (
    id               TEXT PRIMARY KEY,
    room_id          TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    extension_id     TEXT NOT NULL,
    session_type     TEXT NOT NULL,
    metadata         TEXT,
    metadata_version INTEGER NOT NULL DEFAULT 1,
    position         INTEGER NOT NULL,
    created_by       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_room_sessions_room_pos ON room_sessions(room_id, position ASC);
CREATE INDEX IF NOT EXISTS idx_room_sessions_created_by ON room_sessions(created_by);
```

### Comparison against V3 §7.9

V3 §7.9 specifies:
```sql
CREATE TABLE IF NOT EXISTS room_sessions (
    id               TEXT PRIMARY KEY,
    room_id          TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    extension_id     TEXT NOT NULL,
    session_type     TEXT NOT NULL,
    created_by       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    metadata         TEXT,
    metadata_version INTEGER NOT NULL DEFAULT 1,
    position         INTEGER NOT NULL DEFAULT 0,
    max_participants INTEGER,
    created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_room_sessions_room ON room_sessions(room_id, position);
CREATE INDEX IF NOT EXISTS idx_room_sessions_extension ON room_sessions(room_id, extension_id, session_type);
```

### Differences Noted:
1. `max_participants INTEGER` column is missing in `0001_v2_schema.sql`.
2. `position` column lacks `DEFAULT 0` constraint.
3. Index `idx_room_sessions_extension ON room_sessions(room_id, extension_id, session_type)` is missing in `0001_v2_schema.sql`.
4. Index `idx_room_sessions_room_pos` should be named `idx_room_sessions_room`.
5. No `session_participants` table exists in SQLite schema or codebase (confirmed in-memory occupancy only).

---

## 2. Current Session Endpoints

**Location:** `server/src/routes/room_sessions.rs` & `server/src/main.rs`

- `GET /api/v1/rooms/:id/sessions` — Auth required. Query params: `extension_id`, `session_type`. Returns `{ sessions: [...] }`.
- `POST /api/v1/rooms/:id/sessions` — Auth required. Body: `CreateRoomSessionRequest`. Returns status 201 with `RoomSessionView`.
- `PATCH /api/v1/rooms/:id/sessions/:session_id` — Auth required. Body: `PatchRoomSessionRequest`. Returns status 200 with `RoomSessionView`.
- `DELETE /api/v1/rooms/:id/sessions/:session_id` — Auth required. Returns status 204.
- `POST /api/v1/rooms/:id/sessions/:session_id/join` — Auth required. Body: `{ client_id }`. Returns status 200 with `JoinResponse` (`roster`, `media_config`).
- `POST /api/v1/rooms/:id/sessions/:session_id/leave` — Auth required. Body: `{ client_id }`. Returns status 204.
- `POST /api/v1/rooms/:id/sessions/:session_id/heartbeat` — Auth required. Body: `{ client_id }`. Returns status 204.
- `GET /api/v1/rooms/:id/sessions/:session_id/roster` — Auth required. Returns status 200 with `RosterResponse` (`roster`).
- `POST /api/v1/rooms/:id/sessions/:session_id/signal` — Auth required. Body: `SignalRequest`. Returns status 200 (unicast) or 202 (broadcast) with `SignalResponse` (`delivered_to`).
- `GET /api/v1/admin/rooms/:id/sessions` — Admin auth required. Read-only session list.
- `POST /api/v1/admin/session-types/reload` — Admin auth required. Atomic reload of session types TOML configuration.

### Comparison against V3 §8.7

All endpoints match V3 §8.7 specifications.

---

## 3. Current Signal Endpoint Request Shape

**Location:** `server/src/sessions/signal.rs`

```rust
pub struct SignalRequest {
    pub sender_client_id: String,
    pub target_client_id: Option<String>,
    pub signal_type: String,
    pub payload: String,
}
```

### Comparison against V3 §8.7.11

V3 §8.7.11 / §6.26.1 specifies:
```json
{
  "sender_client_id": "<client_id>",
  "target_client_id": "<client_id, optional>",
  "envelope": "<base64url>"
}
```

V2 plaintext fields `signal_type` and `payload` are present in the clear. V3 replaces them with a single opaque `envelope` field (unpadded base64url).

---

## 4. Current `session.signal` Payload

**Location:** `server/src/sessions/signal.rs`

Currently published on `private-user-{target_user_id}`:
```json
{
  "room_id": "...",
  "session_id": "...",
  "sender_user_id": "...",
  "sender_client_id": "...",
  "target_client_id": "...", // if unicast
  "signal_type": "...",
  "payload": "..."
}
```

### Comparison against V3 §8.9

V3 §8.9 specifies:
```json
{
  "room_id": "...",
  "session_id": "...",
  "sender_user_id": "...",
  "sender_client_id": "...",
  "target_client_id": "...", // optional
  "envelope": "<base64url>"
}
```

`signal_type` and `payload` are removed from the event payload and replaced by `envelope`.

---

## 5. Current Session Signal Rate Limit

**Location:** `server/src/rate_limit.rs` & `server/src/routes/room_sessions.rs`

- Rate limit key variant: `RateLimitKey::SessionSignal { user_id, session_id }`
- Key format: `session_signal:{user_id}:{session_id}:min:{boundary}`
- Config default: `RATE_SESSION_SIGNAL_PER_MIN = 120` (120 req/min per user per session).

---

## 6. Current Session Types Config

**Location:** `server/src/sessions/types_config.rs`

- Schema: `[[session_type]]` entries with `type`, `extension_id`, `max_participants`, `max_per_room`.
- Rules:
  - `type` validated against `^[a-z][a-z0-9_-]*$`.
  - `extension_id` non-empty.
  - `1 <= max_participants <= server_max_participants`.
  - `1 <= max_per_room <= server_max_per_room`.
  - No duplicate session types.
- Effective enabled state: `effective_enabled = declared_enabled && allowlist_loaded`.
- Atomic reload: `POST /admin/session-types/reload` parses new config, validates, and swaps state in-memory via `SessionTypesStore::swap`. Rejects invalid config with HTTP 400 without modifying current state.

---

## 7. Current `SESSIONS_ENABLED` Capabilities Field

**Location:** `server/src/routes/capabilities.rs`

- Capabilities exposes `sessions_enabled: state.session_types.is_effective_enabled()`.
- Reflects `declared_enabled && allowlist_loaded` rather than raw environment variable `SESSIONS_ENABLED`.

---

## 8. Current Session Occupancy Store

**Location:** `server/src/sessions/occupancy.rs`

- In-memory data structure: `OccupancyStore(Arc<RwLock<HashMap<String, SessionOccupancy>>>)`.
- `SessionOccupancy` holds `participants: HashMap<String, Participant>`.
- `Participant` holds `client_ids: HashSet<String>` and `last_heartbeat: HashMap<String, Instant>`.
- `Participant` does NOT carry any `connection` media-routing field.
- Non-persisted: never written to SQLite database.
- Non-logged: no participant IDs, client IDs, or participant counts written to tracing or stdout/stderr logs.
- Roster ordering: sorted by `user_id ASC` with `client_ids` sorted ASC within each user.

---

## 9. Current `session.occupancy` Debounce

**Location:** `server/src/sessions/occupancy.rs`

- Debounce mechanism: `ensure_debounce` helper spawns a background tokio task sleeping `session_occupancy_debounce_ms` (default 1000ms = ≤1/sec/session).
- Coalesces rapid participant changes.
- Published payload: `{ "room_id": "...", "session_id": "...", "participant_count": N }`. Count only; contains zero participant identifiers.

---

## 10. Current Session Metadata Handling

**Location:** `server/src/sessions/crud.rs`

- `room_sessions.metadata` is stored as `Option<String>`.
- `validate_metadata` checks base64 encoding (unpadded / padded URL-safe) and asserts decoded length ≤ 65,536 bytes (64 KiB cap, matching room metadata cap).
- Server treats metadata as opaque ciphertext bytes and never parses or decrypts it as JSON.
- `metadata_version` increments ONLY when metadata changes byte-for-byte. A position-only patch or no-op patch does NOT increment `metadata_version`.

---

## 11. Current `room_sessions` Position Handling

**Location:** `server/src/sessions/crud.rs`

- Positions are dense `0..N-1`.
- Secondary tie-break by `id ASC`.
- Re-sequenced inside SQLite transactions via `resequence_positions(&mut tx, room_id)` on creation, position patch, and deletion.

---

## 12. Current `session.updated` Payload

**Location:** `server/src/sessions/crud.rs`

- Event payload includes `changed` array:
  - `["metadata"]` when metadata changed (`metadata` and `metadata_version` included in payload).
  - `["position"]` when position changed (`position` included in payload).
  - `["metadata", "position"]` when both changed (`metadata`, `metadata_version`, and `position` included).
- No-op patch emits no event and returns current state.

---

## 13. Current Disabled-Mode Behavior

**Location:** `server/src/routes/room_sessions.rs` & `server/src/sessions/crud.rs`

When `sessions_enabled` is effective false (`effective_enabled() == false`):
- `POST .../join`, `POST .../leave`, `POST .../heartbeat`, `POST .../signal` return HTTP 501 `sessions_disabled`.
- `GET .../roster` returns HTTP 403 `not_a_participant`.
- `GET /rooms/:id/sessions` returns HTTP 200 OK with `sessions: [...]` where `participant_count` is 0 for all returned sessions.

---

## 14. Current `media_config.ice_servers`

**Location:** `server/src/sessions/occupancy.rs`

- Session join response includes `media_config: { ice_servers: [...] }`.
- `IceServer` struct: `{ urls: Vec<String>, username: String, credential: String }`.
- Invokes `crate::calls::turn::generate_turn_credentials(config)` on join when TURN is configured.
- Reuses standard `IceServer` shape matching Phase 20 call join response.

---

## 15. Existing Tests

Every test touching sessions is registered in `server/tests/batch-manifest.toml`:
1. `server/tests/room_session_signal.rs` — Batch: `messaging`
2. `server/tests/room_sessions.rs` — Batch: `messaging`
3. `server/tests/room_session_occupancy.rs` — Batch: `messaging`
4. `server/tests/session_types_config.rs` — Batch: `auth`

All 32 test cases across these 4 test files are currently passing.

---

## 16. V2 Remnants

1. `SignalRequest` in `server/src/sessions/signal.rs` uses `signal_type` and `payload` fields in the clear instead of `envelope`.
2. `send_session_signal` validates `signal_type` and `payload` instead of `envelope`.
3. `session.signal` event payload in `send_session_signal` carries `signal_type` and `payload` in the clear instead of `envelope`.
4. `room_sessions` table in `server/migrations/0001_v2_schema.sql` lacks `max_participants INTEGER`, default on `position`, and index `idx_room_sessions_extension`.
5. Tests in `server/tests/room_session_signal.rs` send `signal_type` and `payload` instead of `envelope`.

---

## Conclusion

The repository is in a clean baseline state. The alignment requires updating `SignalRequest` and `session.signal` event payload to use `envelope`, updating `0001_v2_schema.sql` to match V3 §7.9, adding tests asserting envelope opacity, and updating existing signal tests to supply `envelope`.
