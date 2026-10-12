# Step 0 — Empirical Verification Report: OpenAPI Annotations — Messaging Endpoints

## 1. Current ApiDoc Struct
`ApiDoc` is located in `server/src/openapi.rs`.
- Current paths: 20 path items covering Public domain (`/api/v1/health`, `/api/v1/ready`, `/api/v1/capabilities`) and User domain (`/api/v1/auth/logout`, `/api/v1/users/lookup`, `/api/v1/users/me`, `/api/v1/users/me/avatar`, `/api/v1/users/me/devices`, `/api/v1/users/me/devices/{id}`, `/api/v1/users/me/export`, `/api/v1/users/me/preferences/{key}`, `/api/v1/users/me/push-subscriptions`, `/api/v1/users/me/push-subscriptions/{id}`, `/api/v1/users/me/read-state`, `/api/v1/users/me/room-order`, `/api/v1/users/me/sessions`, `/api/v1/users/me/sessions/{id}`, `/api/v1/users/me/starred-items`, `/api/v1/users/me/starred-items/{item_id}`, `/api/v1/users/me/sync`).
- Current schemas: 32 schemas registered under `components.schemas` (including `ErrorResponse`, `UserProfileResponse`, `AttachmentView`, `UserAvatarUploadForm`, `SyncResponse`, etc.).

## 2. Current Error Response Schema
`ErrorResponse` is defined in `server/src/error.rs` with `#[derive(ToSchema)]` and registered in `ApiDoc` components. It represents `{ "error": "code", "message": "msg", "details": {} }` per V3 §8.

## 3. Current Bearer Security Scheme
Defined in `server/src/openapi.rs` via `SecurityAddon` modifier:
Adds HTTP Bearer scheme `bearer_auth` with `bearer_format = "session_token"`. Referenced by all authenticated endpoints.

## 4. Current Messaging Endpoint Handlers
1. `GET /rooms/:id/messages` -> `crate::routes::room_messages::list`, query `ListQuery`, returns `Json<ListMessagesResult>`.
2. `POST /rooms/:id/messages` -> `crate::routes::room_messages::submit`, body `SubmitMessageRequest`, returns `(StatusCode::CREATED, Json<SubmitOutcome>)`.
3. `PATCH /rooms/:id/messages/:message_id` -> `crate::routes::room_messages::edit`, body `EditMessageRequest`, returns `(StatusCode::CREATED, HeaderMap, Json<Value>)` (serializes `RoomMessageView`).
4. `DELETE /rooms/:id/messages/:message_id` -> `crate::routes::room_messages::delete_message`, returns `StatusCode::NO_CONTENT`.
5. `POST /rooms/:id/messages/:message_id/reactions` -> `crate::routes::reactions::add`, body `AddReactionInput`, returns `(StatusCode, HeaderMap, Json<AddReactionResponse>)`.
6. `DELETE /rooms/:id/messages/:message_id/reactions/:reaction_id` -> `crate::routes::reactions::remove`, returns `(StatusCode::NO_CONTENT, HeaderMap)`.
7. `POST /rooms/:id/attachments` -> `crate::routes::attachments::upload`, body `axum::extract::Request` (`multipart/form-data` or `application/octet-stream`), returns `(StatusCode::CREATED, Json<AttachmentView>)`.
8. `GET /attachments/:id` -> `crate::routes::attachments::download`, returns `Response` (`application/octet-stream` binary).
9. `DELETE /attachments/:id` -> `crate::routes::attachments::delete_attachment`, returns `StatusCode::NO_CONTENT`.
10. `GET /welcomes` -> `crate::routes::welcomes::list`, returns `Json<WelcomesListResponse>`.
11. `GET /welcomes/:id` -> `crate::routes::welcomes::get`, returns `Json<WelcomeDetailResponse>` (contains base64url encoded `welcome_data`).

## 5. Current Message Response Types
`ListMessagesResult` in `server/src/room_messages.rs`:
- `messages`: `Vec<RoomMessageView>`
- `next_cursor`: `Option<MessageCursor>`

`RoomMessageView` in `server/src/room_messages.rs`:
Fields match §8.5.1:
- `id`: `String`
- `room_id`: `String`
- `sender_type`: `String` ("user" | "bot")
- `sender_id`: `String`
- `sender_client_id`: `String`
- `epoch`: `i64`
- `seq`: `i64`
- `content_type`: `String`
- `ciphertext`: `Option<String>` (base64url ciphertext blob, null on tombstones)
- `reply_to`: `Option<String>`
- `target_user_ids`: `Option<Vec<String>>` (array of user IDs for whispers, null for public messages)
- `edit_of`: `Option<String>`
- `edit_sequence`: `i64`
- `bot_key_leaf_index`: `Option<i64>` (present iff sender_type is "bot")
- `read_by_count`: `i64`
- `created_at`: `DateTime<Utc>`
- `deleted_at`: `Option<DateTime<Utc>>`

## 6. Current Attachment Response Types
`AttachmentView` in `server/src/attachments.rs`:
Fields: `id`, `room_id`, `uploader_id`, `uploader_client_id`, `content_type`, `plaintext_size`, `encrypted_size`, `chunk_size`, `chunk_count`, `nonce_prefix`, `base_counter`, `created_at`, `storage_backend`.
Derived once with `#[derive(ToSchema)]` in `server/src/attachments.rs`.

## 7. Current Welcome Response Types
- `WelcomesListResponse` in `server/src/routes/welcomes.rs`: `welcomes`: `Vec<WelcomeView>`.
- `WelcomeView` in `server/src/welcomes.rs`: `id`, `room_id`, `recipient_user_id`, `recipient_client_id`, `created_at`, `consumed`.
- `WelcomeDetailResponse` in `server/src/routes/welcomes.rs`: `id`, `room_id`, `recipient_user_id`, `recipient_client_id`, `created_at`, `consumed`, `welcome_data`: `String` (base64url string).

## 8. Current Reaction Response Types
`AddReactionResponse` in `server/src/routes/reactions.rs`:
Fields: `id`, `room_id`, `message_id`, `reaction`, `sender_user_id`, `created_at`.
Typed struct deriving `Serialize`.

## 9. Current Request Body Types
- `SubmitMessageRequest` (`routes/room_messages.rs`): `sender_client_id`, `epoch`, `content_type`, `ciphertext`, `transcript_hash`, `reply_to`, `target_user_ids`.
- `EditMessageRequest` (`routes/room_messages.rs`): `ciphertext`, `content_type`.
- `AddReactionInput` (`routes/reactions.rs`): `reaction`, `sender_client_id`, `client_id`.
- `RoomAttachmentUploadForm` (`routes/attachments.rs`): multipart form schema representing room attachment upload payload.

## 10. Current Query Parameter Types
- `ListQuery` (`routes/room_messages.rs`): `since_epoch`, `since_seq`, `limit`, `cursor`.

## 11. Current Path Parameter Naming
Axum router path templates in `server/src/lib.rs`:
- `/rooms/{id}/messages`
- `/rooms/{id}/messages/{message_id}`
- `/rooms/{id}/messages/{message_id}/reactions`
- `/rooms/{id}/messages/{message_id}/reactions/{reaction_id}`
- `/rooms/{id}/attachments`
- `/attachments/{id}`
- `/welcomes`
- `/welcomes/{id}`

Utoipa path macros will use matching `{id}`, `{message_id}` (or `{msg_id}` mapped in path parameter attribute), `{reaction_id}`, `{attachment_id}` (or `{id}`).

## 12. Current Multipart Handlers
`upload` in `routes/attachments.rs` accepts `Multipart` (or `application/octet-stream`). A `RoomAttachmentUploadForm` struct with `#[derive(ToSchema)]` will document the `multipart/form-data` request body shape, reusing the pattern established by `UserAvatarUploadForm`.

## 13. Current Streaming Responses
None in messaging endpoints. All message and welcome endpoints return JSON or fixed byte streams.

## 14. Current Ciphertext Field Conventions
`#[schema(format = Binary, description = "... (base64url unpadded). See §...")]` as used in user domain annotations.

## 15. Current Tests
`server/tests/openapi_generation.rs`:
Tests 20 expected paths, schema validity, bearer auth requirement, and serde round-tripping. Will be expanded to include messaging endpoints and schemas.

## 16. V2 Remnants
None. Code paths consistently use V3 types.
