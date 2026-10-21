# Verification Report: Sessions Endpoints and Full Annotation Coverage Audit

## Executive Summary

An audit of the server router (`server/src/lib.rs`), handler source files (`server/src/routes/`), and OpenAPI specification (`docs/openapi.json`) was conducted to evaluate room session endpoint implementation, verify handler annotation status, and produce a complete router-vs-OpenAPI gap inventory.

The investigation confirms that all room sessions endpoints—including `POST /api/v1/rooms/:id/sessions/:session_id/signal`—are fully implemented and registered in the Axum router. However, seven room session handlers in `server/src/routes/room_sessions.rs` lack `#[utoipa::path(...)]` annotations and were omitted from `docs/openapi.json`. This reflects a systemic gap across 55 unique router paths across 10 functional domains where DTO schemas or partial paths were registered without full route coverage.

---

## 1. Sessions Routes in the Router

Search of `server/src/lib.rs` for all route registrations containing `"sessions"` identified 10 path registrations defining 13 `(Method, Path)` handlers:

| Registration Line | HTTP Method(s) | Router Path | Handler Function(s) |
|---|---|---|---|
| 310 | `GET` | `/admin/rooms/{id}/sessions` | `routes::room_sessions::list_admin` |
| 353 | `GET` | `/users/me/sessions` | `routes::sessions::list` |
| 354 | `DELETE` | `/users/me/sessions/{id}` | `routes::sessions::revoke` |
| 583 | `GET`, `POST` | `/rooms/{id}/sessions` | `routes::room_sessions::list`, `routes::room_sessions::create` |
| 587 | `PATCH`, `DELETE` | `/rooms/{id}/sessions/{session_id}` | `routes::room_sessions::patch`, `routes::room_sessions::delete` |
| 591 | `POST` | `/rooms/{id}/sessions/{session_id}/join` | `routes::room_sessions::join` |
| 595 | `POST` | `/rooms/{id}/sessions/{session_id}/leave` | `routes::room_sessions::leave` |
| 599 | `POST` | `/rooms/{id}/sessions/{session_id}/heartbeat` | `routes::room_sessions::heartbeat` |
| 603 | `GET` | `/rooms/{id}/sessions/{session_id}/roster` | `routes::room_sessions::roster` |
| 607 | `POST` | `/rooms/{id}/sessions/{session_id}/signal` | `routes::room_sessions::signal` |

All `/rooms/{id}/sessions...` routes are mounted under the `/api/v1` router scope in `server/src/lib.rs`.

---

## 2. Sessions Handler Annotations

Inspection of handler implementations in `server/src/routes/room_sessions.rs` and `server/src/routes/sessions.rs` revealed the following annotation status:

| Handler Function | File Path | `#[utoipa::path]` Present? | Annotated Path String |
|---|---|---|---|
| `list_admin` | `server/src/routes/room_sessions.rs:46` | **YES** | `/api/v1/admin/rooms/{id}/sessions` |
| `list` | `server/src/routes/sessions.rs:38` | **YES** | `/api/v1/users/me/sessions` |
| `revoke` | `server/src/routes/sessions.rs:73` | **YES** | `/api/v1/users/me/sessions/{id}` |
| `list` | `server/src/routes/room_sessions.rs:75` | **ABSENT** | N/A |
| `create` | `server/src/routes/room_sessions.rs:93` | **ABSENT** | N/A |
| `patch` | `server/src/routes/room_sessions.rs:137` | **ABSENT** | N/A |
| `delete` | `server/src/routes/room_sessions.rs:157` | **ABSENT** | N/A |
| `join` | `server/src/routes/room_sessions.rs:176` | **ABSENT** | N/A |
| `signal` | `server/src/routes/room_sessions.rs:241` | **ABSENT** | N/A |
| `leave` | `server/src/routes/room_sessions.rs:285` | **ABSENT** | N/A |
| `heartbeat` | `server/src/routes/room_sessions.rs:330` | **ABSENT** | N/A |
| `roster` | `server/src/routes/room_sessions.rs:380` | **ABSENT** | N/A |

Three administrative/user-scoped session handlers are fully annotated, while all eight room-scoped session lifecycle and signaling handlers lack `#[utoipa::path]` attributes.

---

## 3. Sessions Paths in OpenAPI Specification

Parsing `docs/openapi.json` for path keys containing `"sessions"` yields exactly 3 path items:

1. `/api/v1/admin/rooms/{id}/sessions`
2. `/api/v1/users/me/sessions`
3. `/api/v1/users/me/sessions/{id}`

All 7 room-scoped session operational paths (`/api/v1/rooms/{id}/sessions`, `/api/v1/rooms/{id}/sessions/{session_id}`, `/join`, `/leave`, `/heartbeat`, `/roster`, `/signal`) are missing from `docs/openapi.json`.

---

## 4. Spec-vs-Implementation for Signal Endpoint

Analysis of `POST /api/v1/rooms/:id/sessions/:session_id/signal` per V3 Server Spec §8.7.16 and §6.26:

1. **Router Registration**: Exists in `server/src/lib.rs` (line 607), delegating to `routes::room_sessions::signal`, which invokes `sessions::send_session_signal` (`server/src/sessions/signal.rs`).
2. **Authorization Model**: Auth requires `AuthUser` user session token. Authorization performs a two-tier check:
   - **Room Membership**: Queries `rooms::get_room_for_user(pool, room_id, caller_id)` against the SQLite database.
   - **Session Occupancy**: Queries `occupancy.is_client_of(session_id, caller_id, &req.sender_client_id)` against in-memory session occupancy store.
   - Calling user must be both a valid room member and an active participant registered in the session occupancy store; otherwise returns `404 Not Found` or `403 Forbidden` (`NotAParticipant`).
3. **Signature Verification & Envelope Opacity**:
   - The server enforces complete envelope opacity per §6.26.1 and §12.
   - Validates flexible base64 decoding and enforces a 64 KiB cap (`65,536 bytes`).
   - The server **does not** verify Ed25519 signatures, decode inner payloads, or inspect ciphertext.
4. **Occupancy Disclosure**:
   - `session.occupancy` events carrying `{ "room_id", "session_id", "participant_count" }` are published by `publish_occupancy_event` (`server/src/sessions/occupancy.rs`) to room WebSocket channel `private-room-{room_id}` upon join, leave, or heartbeat timeout.
   - All subscribed room members receive the occupancy updates per §8.2.

---

## 5. Full Router-vs-OpenAPI Diff

Cross-referencing Axum router registrations in `server/src/lib.rs` (120 unique paths, 139 method-path pairs) against `docs/openapi.json` (68 unique paths, 83 method-path pairs):

- **Router-Only Unique Paths**: 55 paths
- **OpenAPI-Only Unique Paths**: 3 paths (mismatched path prefix `/models/...` vs `/api/v1/models/...`)
- **Common (Both) Unique Paths**: 65 paths (30 matching path strings plus 35 OpenAPI paths mapped to router paths)

### (a) Router-Only Set (55 Paths)
```
/api/v1/admin/altcha/rotate
/api/v1/admin/audit
/api/v1/admin/backups
/api/v1/admin/config
/api/v1/admin/invites
/api/v1/admin/invites/{id}
/api/v1/admin/limits
/api/v1/admin/vapid/rotate
/api/v1/attachments/{id}
/api/v1/attachments/{id}/presign
/api/v1/calls/turn-credentials
/api/v1/keypackages
/api/v1/keypackages/claim
/api/v1/keypackages/count
/api/v1/models/manifest.json
/api/v1/models/stt/v1/{model_id}/{version}/{filename}
/api/v1/models/tts/v1/{model_id}/{version}/{filename}
/api/v1/roles
/api/v1/rooms
/api/v1/rooms/join
/api/v1/rooms/{id}
/api/v1/rooms/{id}/attachments
/api/v1/rooms/{id}/calls/{call_id}/end
/api/v1/rooms/{id}/calls/{call_id}/join
/api/v1/rooms/{id}/calls/{call_id}/leave
/api/v1/rooms/{id}/calls/{call_id}/signal
/api/v1/rooms/{id}/epoch
/api/v1/rooms/{id}/invites
/api/v1/rooms/{id}/invites/{invite_id}
/api/v1/rooms/{id}/leave
/api/v1/rooms/{id}/members
/api/v1/rooms/{id}/members/{uid}
/api/v1/rooms/{id}/members/{uid}/demote
/api/v1/rooms/{id}/members/{uid}/promote
/api/v1/rooms/{id}/messages
/api/v1/rooms/{id}/messages/{message_id}
/api/v1/rooms/{id}/messages/{message_id}/ciphertext
/api/v1/rooms/{id}/messages/{message_id}/reactions
/api/v1/rooms/{id}/messages/{message_id}/reactions/{reaction_id}
/api/v1/rooms/{id}/pending-adds
/api/v1/rooms/{id}/pending-adds/{add_id}/consume
/api/v1/rooms/{id}/pending-removes
/api/v1/rooms/{id}/pending-removes/{remove_id}/consume
/api/v1/rooms/{id}/retention/preview
/api/v1/rooms/{id}/sessions
/api/v1/rooms/{id}/sessions/{session_id}
/api/v1/rooms/{id}/sessions/{session_id}/heartbeat
/api/v1/rooms/{id}/sessions/{session_id}/join
/api/v1/rooms/{id}/sessions/{session_id}/leave
/api/v1/rooms/{id}/sessions/{session_id}/roster
/api/v1/rooms/{id}/sessions/{session_id}/signal
/api/v1/rooms/{id}/transfer
/api/v1/welcomes
/api/v1/welcomes/{id}
/api/v1/welcomes/{id}/consume
```

### (b) OpenAPI-Only Set (3 Paths - Prefix Mismatch)
```
/models/manifest.json
/models/stt/v1/{model_id}/{version}/{filename}
/models/tts/v1/{model_id}/{version}/{filename}
```
*Note: In `server/src/routes/models.rs`, `#[utoipa::path]` annotated paths omitted the `/api/v1` prefix, creating a path mismatch against the router mount point.*

---

## 6. Classification of Router-Only Paths

Every router-only path falls into one of three classifications:

1. **Root Aliases**: 0 paths. (Root endpoints `/health`, `/ready`, and `/sockudo/auth` are annotated and present in OpenAPI).
2. **Unannotated Spec-Backed Routes**: 45 paths across attachments, calls, keypackages, rooms, messaging, sessions, and models.
3. **Unannotated Operational/Admin Routes**: 10 paths across admin tools (`/admin/audit`, `/admin/backups`, `/admin/config`, `/admin/limits`, `/admin/invites`, `/admin/vapid/rotate`, `/admin/altcha/rotate`) and MLS welcome management (`/welcomes`, `/welcomes/{id}`, `/welcomes/{id}/consume`).
4. **Intentionally Excluded Routes**: 0 paths. No endpoint in the router is intentionally excluded from documentation.

---

## 7. Per-Domain Summary

Grouping the 55 router-only paths by domain:

| Domain | Unannotated Count | Unannotated Path List |
|---|---|---|
| **Admin** | 8 | `/admin/altcha/rotate`, `/admin/audit`, `/admin/backups`, `/admin/config`, `/admin/invites`, `/admin/invites/{id}`, `/admin/limits`, `/admin/vapid/rotate` |
| **Attachments** | 2 | `/attachments/{id}`, `/attachments/{id}/presign` |
| **Calls** | 5 | `/calls/turn-credentials`, `/rooms/{id}/calls/{call_id}/end`, `/rooms/{id}/calls/{call_id}/join`, `/rooms/{id}/calls/{call_id}/leave`, `/rooms/{id}/calls/{call_id}/signal` |
| **Keypackages** | 3 | `/keypackages`, `/keypackages/claim`, `/keypackages/count` |
| **Models** | 3 | `/models/manifest.json`, `/models/stt/...`, `/models/tts/...` (prefix mismatch) |
| **Roles** | 1 | `/roles` |
| **Rooms** | 18 | `/rooms`, `/rooms/join`, `/rooms/{id}`, `/rooms/{id}/attachments`, `/rooms/{id}/epoch`, `/rooms/{id}/invites`, `/rooms/{id}/invites/{invite_id}`, `/rooms/{id}/leave`, `/rooms/{id}/members`, `/rooms/{id}/members/{uid}`, `/rooms/{id}/members/{uid}/demote`, `/rooms/{id}/members/{uid}/promote`, `/rooms/{id}/pending-adds`, `/rooms/{id}/pending-adds/{add_id}/consume`, `/rooms/{id}/pending-removes`, `/rooms/{id}/pending-removes/{remove_id}/consume`, `/rooms/{id}/retention/preview`, `/rooms/{id}/transfer` |
| **Messaging** | 5 | `/rooms/{id}/messages`, `/rooms/{id}/messages/{message_id}`, `/rooms/{id}/messages/{message_id}/ciphertext`, `/rooms/{id}/messages/{message_id}/reactions`, `/rooms/{id}/messages/{message_id}/reactions/{reaction_id}` |
| **Sessions** | 7 | `/rooms/{id}/sessions`, `/rooms/{id}/sessions/{session_id}`, `/rooms/{id}/sessions/{session_id}/heartbeat`, `/rooms/{id}/sessions/{session_id}/join`, `/rooms/{id}/sessions/{session_id}/leave`, `/rooms/{id}/sessions/{session_id}/roster`, `/rooms/{id}/sessions/{session_id}/signal` |
| **Welcomes** | 3 | `/welcomes`, `/welcomes/{id}`, `/welcomes/{id}/consume` |
| **Total** | **55** | |

---

## 8. Recommendations

1. **Follow-Up Annotation Sweep**: Schedule a single annotation sweep task to add `#[utoipa::path(...)]` attributes across all 55 router paths and register them in `ApiDoc` (`server/src/openapi.rs`).
2. **Dynamic Test Verification Fix**: Update `server/tests/openapi_generation.rs` to replace static list comparisons with dynamic router extraction from `server/src/lib.rs`. Asserting that every router path is present in `docs/openapi.json` will permanently prevent unannotated routes from landing silently.

---

## 9. Sessions Contract Answers for the Client

Yes, `POST /api/v1/rooms/:id/sessions/:session_id/signal` exists in the router (registered in `server/src/lib.rs` line 607). The auth model requires the caller to be an authenticated user who is both a member of the room (verified via database) and an active session participant (verified against in-memory occupancy). The server treats the Ed25519 signal envelope as completely opaque, enforcing only base64url decoding and a 64 KiB max size cap without performing server-side signature verification or content decryption. Finally, `session.occupancy` events carrying the updated `participant_count` are published over WebSocket to `private-room-{room_id}`, making participant counts visible to all room members per §8.2.
