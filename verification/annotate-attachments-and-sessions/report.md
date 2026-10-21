# Empirical Verification Report: Annotate Attachments and Sessions (Client-Blocking Paths)

## Step 0 — Baseline Verification & Inventory

### 1. Handler Inventory

#### Attachments (`server/src/routes/attachments.rs`)

1. `upload`
   - Location: `server/src/routes/attachments.rs`
   - Current `#[utoipa::path]` presence: Absent
   - Request types: Multipart form data OR `application/octet-stream` body (with `X-` headers); Path parameter `room_id`.
   - Response types: `AttachmentView`
   - ToSchema status: `AttachmentView` derives `ToSchema` and is registered in `ApiDoc`.

2. `download`
   - Location: `server/src/routes/attachments.rs`
   - Current `#[utoipa::path]` presence: Absent
   - Request types: Path parameter `id`, `Range` header, `If-None-Match` header.
   - Response types: Binary body (`application/octet-stream`), `200 OK`, `206 Partial Content`, `304 Not Modified`, `416 Range Not Satisfiable`.
   - ToSchema status: Binary body response, no DTO schema needed.

3. `delete_attachment`
   - Location: `server/src/routes/attachments.rs`
   - Current `#[utoipa::path]` presence: Absent
   - Request types: Path parameter `id`.
   - Response types: `204 No Content`.
   - ToSchema status: N/A (`204 No Content`).

4. `presign`
   - Location: `server/src/routes/attachments.rs`
   - Current `#[utoipa::path]` presence: Absent
   - Request types: Path parameter `id`, Body `PresignRequest`.
   - Response types: `PresignResponse`.
   - ToSchema status: `PresignRequest` and `PresignResponse` derive `ToSchema` and are registered in `ApiDoc`.

#### Sessions (`server/src/routes/room_sessions.rs`)

5. `list`
   - Location: `server/src/routes/room_sessions.rs`
   - Current `#[utoipa::path]` presence: Absent
   - Request types: Path parameter `room_id` (`{id}`), Query `ListRoomSessionsQuery`.
   - Response types: `SessionListResponse`.
   - ToSchema status: `SessionListResponse` derives `ToSchema` and is registered in `ApiDoc`. `ListRoomSessionsQuery` needs `IntoParams` / `ToSchema`.

6. `create`
   - Location: `server/src/routes/room_sessions.rs`
   - Current `#[utoipa::path]` presence: Absent
   - Request types: Path parameter `room_id` (`{id}`), Body `CreateRoomSessionRequest`.
   - Response types: `201 Created` with `RoomSessionView`.
   - ToSchema status: `RoomSessionView` derives `ToSchema`. `CreateRoomSessionRequest` needs `ToSchema`.

7. `patch`
   - Location: `server/src/routes/room_sessions.rs`
   - Current `#[utoipa::path]` presence: Absent
   - Request types: Path parameters `room_id` (`{id}`), `session_id` (`{session_id}`), Body `PatchRoomSessionRequest`.
   - Response types: `200 OK` with `RoomSessionView`.
   - ToSchema status: `RoomSessionView` derives `ToSchema`. `PatchRoomSessionRequest` needs `ToSchema`.

8. `delete`
   - Location: `server/src/routes/room_sessions.rs`
   - Current `#[utoipa::path]` presence: Absent
   - Request types: Path parameters `room_id` (`{id}`), `session_id` (`{session_id}`).
   - Response types: `204 No Content`.
   - ToSchema status: N/A (`204 No Content`).

9. `join`
   - Location: `server/src/routes/room_sessions.rs`
   - Current `#[utoipa::path]` presence: Absent
   - Request types: Path parameters `room_id` (`{id}`), `session_id` (`{session_id}`), Body `JoinSessionRequest`.
   - Response types: `200 OK` with `JoinResponse` (containing `roster` and `media_config` with `ice_servers`).
   - ToSchema status: `JoinSessionRequest`, `JoinResponse`, `MediaConfig`, `IceServer`, `RosterUserItem` need `ToSchema`.

10. `leave`
    - Location: `server/src/routes/room_sessions.rs`
    - Current `#[utoipa::path]` presence: Absent
    - Request types: Path parameters `room_id` (`{id}`), `session_id` (`{session_id}`), Body `LeaveSessionRequest`.
    - Response types: `204 No Content`.
    - ToSchema status: `LeaveSessionRequest` needs `ToSchema`.

11. `heartbeat`
    - Location: `server/src/routes/room_sessions.rs`
    - Current `#[utoipa::path]` presence: Absent
    - Request types: Path parameters `room_id` (`{id}`), `session_id` (`{session_id}`), Body `HeartbeatSessionRequest`.
    - Response types: `204 No Content`.
    - ToSchema status: `HeartbeatSessionRequest` needs `ToSchema`.

12. `roster`
    - Location: `server/src/routes/room_sessions.rs`
    - Current `#[utoipa::path]` presence: Absent
    - Request types: Path parameters `room_id` (`{id}`), `session_id` (`{session_id}`).
    - Response types: `200 OK` with `RosterResponse`.
    - ToSchema status: `RosterResponse` and `RosterUserItem` need `ToSchema`.

13. `signal`
    - Location: `server/src/routes/room_sessions.rs`
    - Current `#[utoipa::path]` presence: Absent
    - Request types: Path parameters `room_id` (`{id}`), `session_id` (`{session_id}`), Body `SignalRequest`.
    - Response types: `200 OK` (unicast) / `202 Accepted` (broadcast) with `SignalResponse`.
    - ToSchema status: `SignalRequest` and `SignalResponse` need `ToSchema`. `SignalRequest.envelope` must be annotated with `format = Binary` (or `format = Byte`) referencing §6.26.1. `target_client_id` is optional/nullable string.

---

### 2. Attachment Handler Details

- `upload` (`POST /api/v1/rooms/{id}/attachments`):
  - Request shape: `multipart/form-data` fields: `file` (binary), `claimed_id` (string), `plaintext_size` (i64), `encrypted_size` (i64), `chunk_size` (i64), `chunk_count` (i64), `nonce_prefix` (string), `base_counter` (i64), `content_type` (optional string), `uploader_client_id` (optional string). Form struct: `RoomAttachmentUploadForm`.
  - Response: `201 Created` with `AttachmentView`.
  - Expected status codes: `201 Created`, `400 Bad Request` (`invalid_request`), `401 Unauthorized`, `403 Forbidden` (`not_a_member`), `413 Payload Too Large`, `415 Unsupported Media Type`.
  - Spec references: V3 Server Spec §8.6 and §7.7.

- `download` (`GET /api/v1/attachments/{id}`):
  - Path params: `id` (string).
  - Headers: `Range` (optional), `If-None-Match` (optional).
  - Response content type: `application/octet-stream`.
  - Range support: Full support (`parse_range_header`), returns `206 Partial Content` with `Content-Range: bytes start-end/total_size` when range is requested, or `416 Range Not Satisfiable` if unsatisfiable. `304 Not Modified` if ETag matches.
  - Expected status codes: `200 OK`, `206 Partial Content`, `304 Not Modified`, `401 Unauthorized`, `403 Forbidden`, `404 Not Found`, `416 Range Not Satisfiable`.
  - Spec references: V3 Server Spec §8.6.

- `delete_attachment` (`DELETE /api/v1/attachments/{id}`):
  - Path params: `id` (string).
  - Response: `204 No Content`.
  - Expected status codes: `204 No Content`, `401 Unauthorized`, `403 Forbidden` (non-uploader), `404 Not Found`.
  - Spec references: V3 Server Spec §8.6.

- `presign` (`POST /api/v1/attachments/{id}/presign`):
  - Path params: `id` (string).
  - Request body: `PresignRequest` (`{ expires_in_seconds?: u64 }`).
  - Response body: `PresignResponse` (`{ url: string, expires_at: DateTime<Utc> }`).
  - Expected status codes: `200 OK`, `400 Bad Request`, `401 Unauthorized`, `404 Not Found`, `429 Too Many Requests`, `501 Not Implemented` (`presign_not_supported` for filesystem backend).
  - Spec references: V3 Server Spec §8.6.

---

### 3. Session Handler Details

All session handlers require authentication (`AuthUser`).

1. `list` (`GET /api/v1/rooms/{id}/sessions`):
   - Path params: `id` (room ID). Query params: `ListRoomSessionsQuery` (`extension_id`, `session_type`).
   - Response: `200 OK` with `SessionListResponse`.
   - Error status codes: `400 Bad Request` (`invalid_session_type`), `401 Unauthorized`, `404 Not Found` (`room_not_found`).
   - References: V3 Server Spec §8.7.12 and §5.26.

2. `create` (`POST /api/v1/rooms/{id}/sessions`):
   - Path params: `id` (room ID). Body: `CreateRoomSessionRequest` (`extension_id`, `session_type`, `metadata?`, `position?`, `max_participants?`).
   - Response: `201 Created` with `RoomSessionView`.
   - Error status codes: `400 Bad Request`, `401 Unauthorized`, `403 Forbidden` (Moderator/Discord mode), `409 Conflict` (`session_limit_reached`), `429 Too Many Requests` (`rate_limited`), `501 Not Implemented` (`sessions_disabled`).
   - References: V3 Server Spec §8.7.

3. `patch` (`PATCH /api/v1/rooms/{id}/sessions/{session_id}`):
   - Path params: `id` (room ID), `session_id` (session ID). Body: `PatchRoomSessionRequest` (`metadata?`, `position?`).
   - Response: `200 OK` with `RoomSessionView`.
   - Error status codes: `400 Bad Request` (`no_changes` / `invalid_metadata`), `401 Unauthorized`, `403 Forbidden`, `404 Not Found` (`session_not_found`).
   - References: V3 Server Spec §8.7.

4. `delete` (`DELETE /api/v1/rooms/{id}/sessions/{session_id}`):
   - Path params: `id` (room ID), `session_id` (session ID).
   - Response: `204 No Content`.
   - Error status codes: `401 Unauthorized`, `403 Forbidden`, `404 Not Found` (`session_not_found`).
   - References: V3 Server Spec §8.7.

5. `join` (`POST /api/v1/rooms/{id}/sessions/{session_id}/join`):
   - Path params: `id` (room ID), `session_id` (session ID). Body: `JoinSessionRequest` (`client_id`).
   - Response: `200 OK` with `JoinResponse` (`roster`, `media_config`).
   - Error status codes: `400 Bad Request` (`invalid_client_id`), `401 Unauthorized`, `404 Not Found` (`room_not_found` / `session_not_found`), `409 Conflict` (`session_full`), `429 Too Many Requests` (`rate_limited`), `501 Not Implemented` (`sessions_disabled`).
   - References: V3 Server Spec §8.7.13.

6. `leave` (`POST /api/v1/rooms/{id}/sessions/{session_id}/leave`):
   - Path params: `id` (room ID), `session_id` (session ID). Body: `LeaveSessionRequest` (`client_id`).
   - Response: `204 No Content`.
   - Error status codes: `400 Bad Request` (`invalid_client_id`), `401 Unauthorized`, `404 Not Found`, `501 Not Implemented` (`sessions_disabled`).
   - References: V3 Server Spec §8.7.13.

7. `heartbeat` (`POST /api/v1/rooms/{id}/sessions/{session_id}/heartbeat`):
   - Path params: `id` (room ID), `session_id` (session ID). Body: `HeartbeatSessionRequest` (`client_id`).
   - Response: `204 No Content`.
   - Error status codes: `400 Bad Request` (`invalid_client_id`), `401 Unauthorized`, `404 Not Found` (`not_a_participant` / `session_not_found`), `429 Too Many Requests`, `501 Not Implemented` (`sessions_disabled`).
   - References: V3 Server Spec §8.7.13.

8. `roster` (`GET /api/v1/rooms/{id}/sessions/{session_id}/roster`):
   - Path params: `id` (room ID), `session_id` (session ID).
   - Response: `200 OK` with `RosterResponse`.
   - Error status codes: `401 Unauthorized`, `403 Forbidden` (`not_a_participant`), `404 Not Found` (`session_not_found`), `501 Not Implemented` (`sessions_disabled`).
   - References: V3 Server Spec §8.7.13.

9. `signal` (`POST /api/v1/rooms/{id}/sessions/{session_id}/signal`):
   - Path params: `id` (room ID), `session_id` (session ID). Body: `SignalRequest` (`sender_client_id`, `target_client_id?`, `envelope`).
   - Envelope annotation: `format = Binary` (or `format = Byte`) with V3 Spec §6.26.1 and §12 reference in description.
   - `target_client_id`: Optional nullable string (`Option<String>`).
   - Response: `200 OK` with `SignalResponse` (`delivered_to: 1`) for unicast; `202 Accepted` with `SignalResponse` (`delivered_to: N`) for broadcast.
   - Error status codes: `400 Bad Request` (`invalid_envelope` / `invalid_client_id`), `401 Unauthorized`, `403 Forbidden` (`not_a_participant`), `404 Not Found` (`session_not_found` / `target_not_found`), `429 Too Many Requests`, `501 Not Implemented` (`sessions_disabled`).
   - References: V3 Server Spec §8.7.11 and §6.26.1.

---

### 4. Session Schema State

- Already derived `ToSchema` and in `ApiDoc`:
  - `RoomSessionView` (`server/src/sessions/crud.rs`)
  - `SessionListResponse` (`server/src/routes/room_sessions.rs`)

- Need `ToSchema` / `IntoParams` derives added:
  - `RoomAttachmentUploadForm` (New form struct in `server/src/routes/attachments.rs`)
  - `ListRoomSessionsQuery` (`server/src/sessions/crud.rs` -> derive `IntoParams`, `ToSchema`)
  - `CreateRoomSessionRequest` (`server/src/sessions/crud.rs` -> derive `ToSchema`)
  - `PatchRoomSessionRequest` (`server/src/sessions/crud.rs` -> derive `ToSchema`)
  - `JoinSessionRequest` (`server/src/routes/room_sessions.rs` -> derive `ToSchema`)
  - `LeaveSessionRequest` (`server/src/routes/room_sessions.rs` -> derive `ToSchema`)
  - `HeartbeatSessionRequest` (`server/src/routes/room_sessions.rs` -> derive `ToSchema`)
  - `RosterResponse` (`server/src/sessions/occupancy.rs` -> derive `ToSchema`)
  - `RosterUserItem` (`server/src/sessions/occupancy.rs` -> derive `ToSchema`)
  - `JoinResponse` (`server/src/sessions/occupancy.rs` -> derive `ToSchema`)
  - `MediaConfig` (`server/src/sessions/occupancy.rs` -> derive `ToSchema`)
  - `IceServer` (`server/src/sessions/occupancy.rs` -> derive `ToSchema`)
  - `SignalRequest` (`server/src/sessions/signal.rs` -> derive `ToSchema` with `envelope` `format = Binary`/`Byte`)
  - `SignalResponse` (`server/src/sessions/signal.rs` -> derive `ToSchema`)

- Need `ApiDoc` schema registration in `server/src/openapi.rs`:
  - `RoomAttachmentUploadForm`
  - `ListRoomSessionsQuery`
  - `CreateRoomSessionRequest`
  - `PatchRoomSessionRequest`
  - `JoinSessionRequest`
  - `LeaveSessionRequest`
  - `HeartbeatSessionRequest`
  - `RosterResponse`
  - `RosterUserItem`
  - `JoinResponse`
  - `MediaConfig`
  - `IceServer`
  - `SignalRequest`
  - `SignalResponse`

---

### 5. Router Registration Lines in `server/src/lib.rs`

- Line 583: `"/rooms/{id}/sessions", get(routes::room_sessions::list).post(routes::room_sessions::create)`
- Line 587: `"/rooms/{id}/sessions/{session_id}", patch(routes::room_sessions::patch).delete(routes::room_sessions::delete)`
- Line 591: `"/rooms/{id}/sessions/{session_id}/join", post(routes::room_sessions::join)`
- Line 595: `"/rooms/{id}/sessions/{session_id}/leave", post(routes::room_sessions::leave)`
- Line 599: `"/rooms/{id}/sessions/{session_id}/heartbeat", post(routes::room_sessions::heartbeat)`
- Line 603: `"/rooms/{id}/sessions/{session_id}/roster", get(routes::room_sessions::roster)`
- Line 607: `"/rooms/{id}/sessions/{session_id}/signal", post(routes::room_sessions::signal)`
- Line 610: `"/rooms/{id}/attachments", post(routes::attachments::upload)`
- Line 612: `"/attachments/{id}", get(routes::attachments::download).delete(routes::attachments::delete_attachment)`
- Line 616: `"/attachments/{id}/presign", post(routes::attachments::presign)`

---

### 6. Path Parameter Naming

Router uses Axum format (`:id`, `:session_id`).
Utoipa path annotations use OpenAPI format (`{id}`, `{session_id}`).

Mapping:
- `/rooms/{id}/attachments` -> `:id`
- `/attachments/{id}` -> `:id`
- `/attachments/{id}/presign` -> `:id`
- `/rooms/{id}/sessions` -> `:id`
- `/rooms/{id}/sessions/{session_id}` -> `:id`, `:session_id`
- `/rooms/{id}/sessions/{session_id}/join` -> `:id`, `:session_id`
- `/rooms/{id}/sessions/{session_id}/leave` -> `:id`, `:session_id`
- `/rooms/{id}/sessions/{session_id}/heartbeat` -> `:id`, `:session_id`
- `/rooms/{id}/sessions/{session_id}/roster` -> `:id`, `:session_id`
- `/rooms/{id}/sessions/{session_id}/signal` -> `:id`, `:session_id`

---

### 7. Ignored Test Failure List Subset

Total missing router paths in ignored test (`test_router_and_openapi_paths_match_one_to_one`): 52 paths.

Attachments (3 unique path keys):
1. `/api/v1/attachments/{id}`
2. `/api/v1/attachments/{id}/presign`
3. `/api/v1/rooms/{id}/attachments`

Sessions (7 unique path keys):
4. `/api/v1/rooms/{id}/sessions`
5. `/api/v1/rooms/{id}/sessions/{session_id}`
6. `/api/v1/rooms/{id}/sessions/{session_id}/heartbeat`
7. `/api/v1/rooms/{id}/sessions/{session_id}/join`
8. `/api/v1/rooms/{id}/sessions/{session_id}/leave`
9. `/api/v1/rooms/{id}/sessions/{session_id}/roster`
10. `/api/v1/rooms/{id}/sessions/{session_id}/signal`

Total unique path keys to be added in this task: **10**
Expected missing count after this task: **42** (52 - 10).

---

### 8. Batch Assignment

- Test file `server/tests/openapi_generation.rs` is registered under the `operations` batch in `server/tests/batch-manifest.toml`.
- All tests for this task are run via `make -C server test-operations`.
