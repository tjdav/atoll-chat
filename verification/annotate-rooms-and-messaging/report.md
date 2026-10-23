# Empirical Verification Report: Annotate Rooms and Messaging Domains

## Baseline Verification & Inventory

### 1. Router Registrations in `server/src/lib.rs`

All 22 paths in scope are registered in `server/src/lib.rs` under `api_routes` (prefixed with `/api/v1`):

1. `GET /api/v1/rooms` and `POST /api/v1/rooms` — Lines 411–412: `.route("/rooms", post(routes::rooms::create).get(routes::rooms::list))`
2. `POST /api/v1/rooms/join` — Line 414: `.route("/rooms/join", post(routes::room_invites::join))`
3. `GET /api/v1/rooms/{id}`, `PATCH /api/v1/rooms/{id}`, `DELETE /api/v1/rooms/{id}` — Lines 416–419: `.route("/rooms/{id}", get(routes::rooms::get).patch(routes::rooms::update_metadata).delete(routes::rooms::delete))`
4. `POST /api/v1/rooms/{id}/leave` — Line 429: `.route("/rooms/{id}/leave", post(routes::rooms::leave))`
5. `GET /api/v1/rooms/{id}/members` and `POST /api/v1/rooms/{id}/members` — Lines 431–432: `.route("/rooms/{id}/members", get(routes::rooms::list_members).post(routes::rooms::add_member))`
6. `DELETE /api/v1/rooms/{id}/members/{uid}` — Lines 435–436: `.route("/rooms/{id}/members/{uid}", delete(routes::rooms::kick_member))`
7. `POST /api/v1/rooms/{id}/members/{uid}/promote` — Lines 439–440: `.route("/rooms/{id}/members/{uid}/promote", post(routes::rooms::promote_member))`
8. `POST /api/v1/rooms/{id}/members/{uid}/demote` — Lines 443–444: `.route("/rooms/{id}/members/{uid}/demote", post(routes::rooms::demote_member))`
9. `POST /api/v1/rooms/{id}/retention/preview` — Lines 447–448: `.route("/rooms/{id}/retention/preview", post(routes::rooms::retention_preview))`
10. `POST /api/v1/rooms/{id}/transfer` — Lines 451–452: `.route("/rooms/{id}/transfer", post(routes::rooms::transfer_ownership))`
11. `GET /api/v1/rooms/{id}/invites` and `POST /api/v1/rooms/{id}/invites` — Lines 422–423: `.route("/rooms/{id}/invites", post(routes::room_invites::create).get(routes::room_invites::list))`
12. `DELETE /api/v1/rooms/{id}/invites/{invite_id}` — Lines 426–427: `.route("/rooms/{id}/invites/{invite_id}", delete(routes::room_invites::revoke))`
13. `GET /api/v1/rooms/{id}/pending-adds` — Lines 555–556: `.route("/rooms/{id}/pending-adds", get(routes::rooms::list_pending_adds))`
14. `POST /api/v1/rooms/{id}/pending-adds/{add_id}/consume` — Lines 559–560: `.route("/rooms/{id}/pending-adds/{add_id}/consume", post(routes::rooms::consume_pending_add))`
15. `GET /api/v1/rooms/{id}/pending-removes` — Lines 547–548: `.route("/rooms/{id}/pending-removes", get(routes::pending_removes::list))`
16. `POST /api/v1/rooms/{id}/pending-removes/{remove_id}/consume` — Lines 551–552: `.route("/rooms/{id}/pending-removes/{remove_id}/consume", post(routes::pending_removes::consume))`
17. `GET /api/v1/rooms/{id}/epoch` — Line 542: `.route("/rooms/{id}/epoch", get(routes::room_messages::get_epoch))`
18. `GET /api/v1/rooms/{id}/messages` and `POST /api/v1/rooms/{id}/messages` — Lines 458–459: `.route("/rooms/{id}/messages", post(routes::room_messages::submit).get(routes::room_messages::list))`
19. `PATCH /api/v1/rooms/{id}/messages/{message_id}` and `DELETE /api/v1/rooms/{id}/messages/{message_id}` — Lines 462–463: `.route("/rooms/{id}/messages/{message_id}", patch(routes::room_messages::edit).delete(routes::room_messages::delete_message))`
20. `GET /api/v1/rooms/{id}/messages/{message_id}/reactions` and `POST /api/v1/rooms/{id}/messages/{message_id}/reactions` — Lines 531–532: `.route("/rooms/{id}/messages/{message_id}/reactions", get(routes::reactions::list).post(routes::reactions::add))`
21. `DELETE /api/v1/rooms/{id}/messages/{message_id}/reactions/{reaction_id}` — Lines 535–536: `.route("/rooms/{id}/messages/{message_id}/reactions/{reaction_id}", delete(routes::reactions::remove))`
22. `GET /api/v1/rooms/{id}/messages/{message_id}/ciphertext` — Lines 539–540: `.route("/rooms/{id}/messages/{message_id}/ciphertext", get(routes::room_messages::get_ciphertext))`

All 22 path strings match the expected task list.

---

### 2. Handler Annotation Status

None of the handlers currently have `#[utoipa::path]` attributes:

- `routes::rooms::create` (`POST /rooms`) — Missing
- `routes::rooms::list` (`GET /rooms`) — Missing
- `routes::room_invites::join` (`POST /rooms/join`) — Missing
- `routes::rooms::get` (`GET /rooms/{id}`) — Missing
- `routes::rooms::update_metadata` (`PATCH /rooms/{id}`) — Missing
- `routes::rooms::delete` (`DELETE /rooms/{id}`) — Missing
- `routes::rooms::leave` (`POST /rooms/{id}/leave`) — Missing
- `routes::rooms::list_members` (`GET /rooms/{id}/members`) — Missing
- `routes::rooms::add_member` (`POST /rooms/{id}/members`) — Missing
- `routes::rooms::kick_member` (`DELETE /rooms/{id}/members/{uid}`) — Missing
- `routes::rooms::promote_member` (`POST /rooms/{id}/members/{uid}/promote`) — Missing
- `routes::rooms::demote_member` (`POST /rooms/{id}/members/{uid}/demote`) — Missing
- `routes::rooms::retention_preview` (`POST /rooms/{id}/retention/preview`) — Missing
- `routes::rooms::transfer_ownership` (`POST /rooms/{id}/transfer`) — Missing
- `routes::room_invites::list` (`GET /rooms/{id}/invites`) — Missing
- `routes::room_invites::create` (`POST /rooms/{id}/invites`) — Missing
- `routes::room_invites::revoke` (`DELETE /rooms/{id}/invites/{invite_id}`) — Missing
- `routes::rooms::list_pending_adds` (`GET /rooms/{id}/pending-adds`) — Missing
- `routes::rooms::consume_pending_add` (`POST /rooms/{id}/pending-adds/{add_id}/consume`) — Missing
- `routes::pending_removes::list` (`GET /rooms/{id}/pending-removes`) — Missing
- `routes::pending_removes::consume` (`POST /rooms/{id}/pending-removes/{remove_id}/consume`) — Missing
- `routes::room_messages::get_epoch` (`GET /rooms/{id}/epoch`) — Missing
- `routes::room_messages::list` (`GET /rooms/{id}/messages`) — Missing
- `routes::room_messages::submit` (`POST /rooms/{id}/messages`) — Missing
- `routes::room_messages::edit` (`PATCH /rooms/{id}/messages/{message_id}`) — Missing
- `routes::room_messages::delete_message` (`DELETE /rooms/{id}/messages/{message_id}`) — Missing
- `routes::reactions::list` (`GET /rooms/{id}/messages/{message_id}/reactions`) — Missing
- `routes::reactions::add` (`POST /rooms/{id}/messages/{message_id}/reactions`) — Missing
- `routes::reactions::remove` (`DELETE /rooms/{id}/messages/{message_id}/reactions/{reaction_id}`) — Missing
- `routes::room_messages::get_ciphertext` (`GET /rooms/{id}/messages/{message_id}/ciphertext`) — Missing

---

### 3. OpenAPI Presence

Empirically verified that none of the 22 path keys exist in `docs/openapi.json`.

---

### 4. Request and Response Types per Handler

- Room list (`GET /rooms`): Response `RoomListResponse` (`{ rooms: Vec<RoomWithRole> }`).
- Room create (`POST /rooms`): Request `CreateRoomRequest` (`retention_days: Option<i64>`, `max_file_size_bytes: Option<i64>`), Response 201 `RoomWithRole`.
- Room get (`GET /rooms/{id}`): Response 200 `RoomWithRole`.
- Room patch (`PATCH /rooms/{id}`): Request `UpdateMetadataRequest` (`{ metadata: Option<Option<String>> }`), Response 200 `RoomWithRole`.
- Room delete (`DELETE /rooms/{id}`): Response 204 No Content.
- Join room (`POST /rooms/join`): Request `JoinRoomRequest` (`code: String`), Response 200 `JoinRoomResponse` (`room_id`, `member_role`, `already_member`).
- Leave room (`POST /rooms/{id}/leave`): Response 200 `LeaveResponse` (`outcome`, `new_owner_id`).
- Members list (`GET /rooms/{id}/members`): Query `ListMembersQueryParams`, Response 200 `MemberListResponse` (`members: Vec<RoomMemberItem>`, `next_cursor: Option<String>`).
- Member add (`POST /rooms/{id}/members`): Request `AddMemberRequest` (`user_id`, `welcome_data`), Response 201 `RoomMember`.
- Kick member (`DELETE /rooms/{id}/members/{uid}`): Response 204 No Content.
- Promote member (`POST /rooms/{id}/members/{uid}/promote`): Response 204 No Content.
- Demote member (`POST /rooms/{id}/members/{uid}/demote`): Response 204 No Content.
- Retention preview (`POST /rooms/{id}/retention/preview`): Request `RetentionPreviewRequest` (`retention_days: i64`), Response 200 `RetentionPreviewResult`.
- Transfer ownership (`POST /rooms/{id}/transfer`): Request `TransferOwnershipRequest` (`user_id: String`), Response 204 No Content.
- Invites list (`GET /rooms/{id}/invites`): Query `ListRoomInvitesQuery`, Response 200 `ListRoomInvitesResponse` (`invites: Vec<RoomInviteView>`).
- Invite create (`POST /rooms/{id}/invites`): Request `CreateRoomInviteRequest` (`max_uses`, `expires_in_days`), Response 201 `CreateRoomInviteResponse`.
- Invite revoke (`DELETE /rooms/{id}/invites/{invite_id}`): Response 204 No Content.
- Pending adds list (`GET /rooms/{id}/pending-adds`): Response 200 `PendingAddsResponse` (`pending_adds: Vec<PendingAddView>`).
- Pending add consume (`POST /rooms/{id}/pending-adds/{add_id}/consume`): Response 200 `ConsumePendingAddResponse` (`id`, `consumed_at`).
- Pending removes list (`GET /rooms/{id}/pending-removes`): Response 200 `ListPendingRemovesResponse` (`removes: Vec<PendingRemove>`).
- Pending remove consume (`POST /rooms/{id}/pending-removes/{remove_id}/consume`): Response 204 No Content.
- Epoch (`GET /rooms/{id}/epoch`): Response 200 `EpochResponse` (`epoch: i64`, `sequence: i64`).
- Messages list (`GET /rooms/{id}/messages`): Query `ListQuery` (`since_epoch`, `since_seq`, `limit`), Response 200 `ListMessagesResult` (`messages: Vec<RoomMessageView>`, `next_cursor: Option<String>`).
- Message submit (`POST /rooms/{id}/messages`): Request `SubmitMessageRequest` (`sender_client_id`, `epoch`, `content_type`, `ciphertext`, `transcript_hash`, `reply_to`, `target_user_ids`), Response 201 `RoomMessageView`.
- Message edit (`PATCH /rooms/{id}/messages/{message_id}`): Request `EditMessageRequest` (`ciphertext`, `content_type`), Response 201 `RoomMessageView`.
- Message delete (`DELETE /rooms/{id}/messages/{message_id}`): Response 204 No Content.
- Reactions list (`GET /rooms/{id}/messages/{message_id}/reactions`): Response 200 `ListReactionsResponse` (`message_id`, `reactions: Vec<ReactionSummary>`).
- Reaction add (`POST /rooms/{id}/messages/{message_id}/reactions`): Request `AddReactionInput` (`reaction`, `sender_client_id`, `client_id`), Response 201 Created / 200 OK `AddReactionResponse`.
- Reaction remove (`DELETE /rooms/{id}/messages/{message_id}/reactions/{reaction_id}`): Response 204 No Content.
- Message ciphertext (`GET /rooms/{id}/messages/{message_id}/ciphertext`): Response 200 `MessageCiphertextResponse` (`id`, `ciphertext`).

---

### 5. ToSchema Derive Status

- Types already deriving `ToSchema`:
  - `RoomMessageView` (`server/src/room_messages.rs`)
  - `ReactionSummary` (`server/src/reactions/list.rs`)
  - `EditMessageRequest` (`server/src/routes/room_messages.rs`)
  - `ListQuery` (`server/src/routes/room_messages.rs`)
  - `EpochResponse` (`server/src/routes/room_messages.rs`)
  - `MessageCiphertextResponse` (`server/src/routes/room_messages.rs`)
  - `AddReactionInput` (`server/src/routes/reactions.rs`)
  - `AddReactionResponse` (`server/src/routes/reactions.rs`)
  - `ListReactionsResponse` (`server/src/routes/reactions.rs`)

- Types needing `ToSchema` or `IntoParams` added:
  - `Room` (`server/src/rooms.rs`)
  - `RoomWithRole` (`server/src/rooms.rs`)
  - `RoomMember` (`server/src/rooms.rs`)
  - `RoomMemberItem` (`server/src/rooms.rs` — tagged enum with user / bot discriminator)
  - `PendingRemove` (`server/src/rooms.rs`)
  - `PendingAddView` (`server/src/rooms.rs`)
  - `RetentionPreviewResult` (`server/src/rooms.rs`)
  - `CreateRoomRequest` (`server/src/routes/rooms.rs`)
  - `UpdateMetadataRequest` (`server/src/routes/rooms.rs`)
  - `RoomListResponse` (`server/src/routes/rooms.rs`)
  - `ListMembersQueryParams` (`server/src/routes/rooms.rs` -> derive `IntoParams`, `ToSchema`)
  - `MemberListResponse` (`server/src/routes/rooms.rs`)
  - `AddMemberRequest` (`server/src/routes/rooms.rs`)
  - `LeaveResponse` (`server/src/routes/rooms.rs`)
  - `RetentionPreviewRequest` (`server/src/routes/rooms.rs`)
  - `TransferOwnershipRequest` (`server/src/routes/rooms.rs`)
  - `PendingAddsResponse` (`server/src/routes/rooms.rs`)
  - `ConsumePendingAddResponse` (`server/src/routes/rooms.rs`)
  - `CreateRoomInviteRequest` (`server/src/routes/room_invites.rs`)
  - `CreateRoomInviteResponse` (`server/src/routes/room_invites.rs`)
  - `ListRoomInvitesQuery` (`server/src/routes/room_invites.rs` -> derive `IntoParams`, `ToSchema`)
  - `ListRoomInvitesResponse` (`server/src/routes/room_invites.rs`)
  - `RoomInviteView` (`server/src/room_invites.rs`)
  - `JoinRoomRequest` (`server/src/routes/room_invites.rs`)
  - `JoinRoomResponse` (`server/src/routes/room_invites.rs`)
  - `ListPendingRemovesResponse` (`server/src/routes/pending_removes.rs`)
  - `SubmitMessageRequest` (`server/src/routes/room_messages.rs`)
  - `ListMessagesResult` (`server/src/room_messages.rs`)

---

### 6. Query Parameter Types

- `ListMembersQueryParams` (`limit`, `cursor`) -> derives `IntoParams` and `ToSchema`.
- `ListRoomInvitesQuery` (`include_revoked`) -> derives `IntoParams` and `ToSchema`.
- `ListQuery` (`since_epoch`, `since_seq`, `limit`) -> derives `IntoParams` and `ToSchema`.

---

### 7. Non-Spec Route Identification

- `/api/v1/rooms/{id}/transfer`: Discrepancy. The V3 spec §3.5 describes a three-endpoint transfer-ownership flow (`initiate`, `accept`, `cancel`). The server implements a single `POST /rooms/{id}/transfer` endpoint which immediately transfers ownership to `user_id`. The OpenAPI annotation describes the actual handler, and notes the spec discrepancy in its description.
- `/api/v1/rooms/{id}/messages/{message_id}/ciphertext`: Discrepancy. Not defined in V3 spec. Implementation-defined route returning `{ id, ciphertext }` (`MessageCiphertextResponse`).
- `/api/v1/rooms/{id}/epoch`: Discrepancy. Not defined in V3 spec. Implementation-defined route returning `{ epoch, sequence }` (`EpochResponse`).

---

### 8. Ciphertext Field Annotations

- `SubmitMessageRequest.ciphertext`: Annotated with `format = Binary` and §6.4 reference.
- `EditMessageRequest.ciphertext`: Annotated with `format = Binary` (already annotated).
- `RoomMessageView.ciphertext`: Annotated with `format = Binary` (already annotated).
- `MessageCiphertextResponse.ciphertext`: Annotated with `format = Binary`.

---

### 9. Request Body Specifics

- Room create (`POST /rooms`): `retention_days: Option<i64>`, `max_file_size_bytes: Option<i64>`.
- Room patch (`PATCH /rooms/{id}`): `UpdateMetadataRequest` (`metadata: Option<Option<String>>`).
- Member add (`POST /rooms/{id}/members`): `AddMemberRequest` (`user_id`, `welcome_data`). Supports user and bot targets per Phase 11/14.
- Invite create (`POST /rooms/{id}/invites`): `CreateRoomInviteRequest` (`max_uses`, `expires_in_days`).
- Pending add consume (`POST /rooms/{id}/pending-adds/{add_id}/consume`): No body, returns `{ id, consumed_at }`.
- Reaction add (`POST /rooms/{id}/messages/{message_id}/reactions`): `AddReactionInput` (`reaction`, `sender_client_id`, `client_id`).

---

### 10. Error Codes per Handler

- Room list: `401`
- Room create: `400` (`invalid_request`), `401`, `403` (`room_limit_reached`)
- Room get: `401`, `404` (`room_not_found`)
- Room patch: `400` (`invalid_json`, `invalid_body`, `missing_field`, `invalid_metadata`), `401`, `403` (`forbidden`), `404` (`room_not_found`), `429` (`rate_limited`)
- Room delete: `401`, `403` (`forbidden`), `404` (`room_not_found`)
- Join room: `400` (`invalid_code`), `401`, `404` (`invite_not_found`), `409` (`already_member`), `429` (`rate_limited`)
- Leave room: `400` (`not_a_member`), `401`, `404` (`room_not_found`)
- Members list: `400` (`invalid_limit`, `invalid_cursor`), `401`, `404` (`room_not_found`), `429` (`rate_limited`)
- Member add: `400` (`invalid_welcome_data`), `401`, `403` (`forbidden`, `member_limit_reached`), `404` (`room_not_found`), `409` (`already_member`)
- Kick member: `401`, `403` (`forbidden`), `404` (`room_not_found`, `member_not_found`)
- Promote member: `401`, `403` (`forbidden`), `404` (`room_not_found`, `member_not_found`)
- Demote member: `401`, `403` (`forbidden`), `404` (`room_not_found`, `member_not_found`)
- Retention preview: `400` (`invalid_retention_days`), `401`, `403` (`forbidden`), `404` (`room_not_found`)
- Transfer ownership: `401`, `403` (`forbidden`), `404` (`room_not_found`, `target_not_member`)
- Invites list: `401`, `403` (`forbidden`), `404` (`room_not_found`)
- Invite create: `400` (`invalid_request`), `401`, `403` (`forbidden`), `404` (`room_not_found`)
- Invite revoke: `401`, `403` (`forbidden`), `404` (`room_not_found`, `invite_not_found`)
- Pending adds list: `401`, `404` (`room_not_found`)
- Pending add consume: `401`, `404` (`room_not_found`, `add_not_found`)
- Pending removes list: `401`, `404` (`room_not_found`)
- Pending remove consume: `401`, `404` (`room_not_found`, `remove_not_found`)
- Epoch: `401`, `404` (`room_not_found`)
- Messages list: `400` (`invalid_cursor`), `401`, `404` (`room_not_found`)
- Message submit: `400` (`invalid_request`, `ciphertext_too_large`), `401`, `403` (`forbidden`), `404` (`room_not_found`), `409` (`whisper_limit`)
- Message edit: `400` (`invalid_request`), `401`, `403` (`forbidden`, `edit_window_expired`), `404` (`room_not_found`, `message_not_found`), `409` (`message_deleted`, `cannot_edit_edit`)
- Message delete: `401`, `403` (`forbidden`), `404` (`room_not_found`, `message_not_found`)
- Reactions list: `401`, `404` (`room_not_found`, `message_not_found`)
- Reaction add: `400` (`missing_field`, `invalid_reaction`), `401`, `404` (`room_not_found`, `message_not_found`), `409` (`reaction_limit_reached`)
- Reaction remove: `400` (`invalid_reaction`), `401`, `403` (`forbidden`), `404` (`room_not_found`, `reaction_not_found`)
- Message ciphertext: `401`, `404` (`room_not_found`, `message_not_found`)

---

### 11. Current Ignored-Test Failure List

Running `test_router_and_openapi_paths_match_one_to_one`:
- Baseline before Task B: 42 missing router paths.
- Expected after Task B: 20 missing router paths (remaining in Tasks C & D).

---

### 12. Batch Assignment

- Integration test suite `server/tests/openapi_generation.rs` is registered under the `operations` batch in `server/tests/batch-manifest.toml`.
