# Step 0 Report — OpenAPI Annotations (Bots Endpoints)

**Task:** OpenAPI Annotations — Bots Endpoints
**Date:** 2026-10-11
**Spec Version:** Server Specification v3.0.4

---

## 1. Current ApiDoc Struct
- **Location:** `server/src/openapi.rs`
- **Paths List:** Currently contains 38 operation entries spanning public, user, and messaging domains.
- **Schemas List:** Contains 51 derived schemas including `ErrorResponse`, `UserProfileResponse`, `RoomMessageView`, `SubmitMessageRequest`, `AttachmentView`, `WelcomeView`, etc.
- **Prior Task Confirmation:** Confirm messaging-domain annotations from the prior task (`RoomMessageView`, `ListMessagesResult`, `SubmitMessageRequest`, `EditMessageRequest`, `AddReactionInput`, `AddReactionResponse`, `ListReactionsResponse`, `WelcomeView`, `WelcomesListResponse`, `WelcomeDetailResponse`, `ConsumeWelcomeResponse`, `AttachmentView`, `UserAvatarUploadForm`, `RoomAttachmentUploadForm`, `PresignRequest`, `PresignResponse`) are present in `ApiDoc`.

## 2. Current Error Response Schema
- `ErrorResponse` struct defined in `server/src/error.rs` derives `utoipa::ToSchema`.
- Included in `ApiDoc` components and referenced by all error responses.

## 3. Current Bearer Security Scheme
- `SecurityAddon` in `server/src/openapi.rs` configures HTTP Bearer security scheme `bearer_auth` with format `session_token`.
- Will be referenced across all authenticated bots endpoints (user session tokens, bot tokens, or dual auth).

## 4. Current Publisher-Key Annotations
- `GET /rooms/:id/publisher-key` and `POST /rooms/:id/publisher-key` in `server/src/routes/publisher_keys.rs` were NOT annotated in prior tasks.
- **Gap noted:** This task will annotate both publisher-key endpoints under the bots/room-siblings surface.

## 5. Current Bot Endpoint Handlers
Total 25 path endpoints across bot account management, tokens, avatar, room grants, commands, settings, messages, publisher keys, and observer stream:
1. `POST /bots` — §8.8.1 -> `crate::routes::bots::create_bot` (`server/src/routes/bots.rs`). Req: `CreateBotReq`. Resp: `BotView` (201).
2. `GET /bots/:id` — §8.8.2 -> `crate::routes::bots::get_bot` (`server/src/routes/bots.rs`). Req: Path `{id}`. Resp: `BotView` (200).
3. `PATCH /bots/:id` — §8.8.3 -> `crate::routes::bots::patch_bot` (`server/src/routes/bots.rs`). Req: Path `{id}`, Body `PatchBotReq`. Resp: `BotView` (200).
4. `DELETE /bots/:id` — §8.8 table -> `crate::routes::bots::delete_bot` (`server/src/routes/bots.rs`). Req: Path `{id}`. Resp: 204.
5. `PATCH /bots/:id/keys` — §8.8.17 -> `crate::routes::bots::rotate_bot_keys` (`server/src/routes/bots.rs`). Req: Path `{id}`, Body `RotateBotKeysReq`. Resp: `BotView` (200).
6. `POST /bots/:id/avatar` — §8.8.4 -> `crate::routes::bots::upload_bot_avatar` (`server/src/routes/bots.rs`). Req: Path `{id}`, Multipart `UserAvatarUploadForm`. Resp: `AttachmentView` (201).
7. `DELETE /bots/:id/avatar` — §8.8.5 -> `crate::routes::bots::delete_bot_avatar` (`server/src/routes/bots.rs`). Req: Path `{id}`. Resp: 204.
8. `POST /bots/:id/tokens` — §8.8.18 -> `crate::routes::bots::create_token` (`server/src/routes/bots.rs`). Req: Path `{id}`. Resp: `CreateTokenResp` (201).
9. `GET /bots/:id/tokens` — §8.8.19 -> `crate::routes::bots::get_bot_tokens` (`server/src/routes/bots.rs`). Req: Path `{id}`. Resp: `ListTokensResp` (200).
10. `DELETE /bots/:id/tokens/:token_id` — §8.8.20 -> `crate::routes::bots::delete_token` (`server/src/routes/bots.rs`). Req: Path `{id}`, `{token_id}`. Resp: 204.
11. `GET /rooms/:id/bots` — §8.8.6 -> `crate::routes::room_bots::list_room_bots` (`server/src/routes/room_bots.rs`). Req: Path `{id}`. Resp: `ListRoomBotsResp` (200).
12. `POST /rooms/:id/bots` — §8.8.7 -> `crate::routes::room_bots::grant_bot` (`server/src/routes/room_bots.rs`). Req: Path `{id}`, Body `GrantBotReq`. Resp: `RoomBotView` (201).
13. `PATCH /rooms/:id/bots/:bot_id` — §8.8.8 -> `crate::routes::room_bots::patch_room_bot` (`server/src/routes/room_bots.rs`). Req: Path `{id}`, `{bot_id}`, Body `PatchRoomBotReq`. Resp: `RoomBotView` (200).
14. `DELETE /rooms/:id/bots/:bot_id` — §8.8.9 -> `crate::routes::room_bots::delete_room_bot` (`server/src/routes/room_bots.rs`). Req: Path `{id}`, `{bot_id}`. Resp: 204.
15. `POST /rooms/:id/bot-messages` — §8.8.10 -> `crate::routes::room_bots::post_bot_message` (`server/src/routes/room_bots.rs`). Req: Path `{id}`, Body `PostBotMessageReq`. Resp: `PostBotMessageResp` (202).
16. `POST /rooms/:id/bot-commands` — §8.8.11 -> `crate::routes::room_bots::post_bot_command` (`server/src/routes/room_bots.rs`). Req: Path `{id}`, Body `PostBotCommandReq`. Resp: `PostBotCommandResp` (202).
17. `POST /bots/me/commands/:id/ack` — §8.8.21 -> `crate::routes::bots::ack_bot_command` (`server/src/routes/bots.rs`). Req: Path `{id}`. Resp: 204.
18. `POST /bots/me/messages` — §8.8.12 -> `crate::routes::bots::post_bot_messages` (`server/src/routes/bots.rs`). Req: Body `PostBotMessagesReq`. Resp: 204.
19. `GET /bots/me/settings` — §8.8.14 -> `crate::routes::bots::get_bot_settings_me` (`server/src/routes/bots.rs`). Req: None. Resp: `GetBotSettingsResp` (200).
20. `GET /users/me/bots/:bot_id/settings` — §8.8.14 -> `crate::routes::bots::get_bot_settings_owner` (`server/src/routes/bots.rs`). Req: Path `{bot_id}`. Resp: `GetBotSettingsResp` (200).
21. `PATCH /users/me/bots/:bot_id/settings/:key` — §8.8.14 -> `crate::routes::bots::patch_bot_setting_owner` (`server/src/routes/bots.rs`). Req: Path `{bot_id}`, `{key}`, Body `PatchBotSettingRequest`. Resp: `BotSettingView` (200).
22. `DELETE /users/me/bots/:bot_id/settings/:key` — §8.8.14 -> `crate::routes::bots::delete_bot_setting_owner` (`server/src/routes/bots.rs`). Req: Path `{bot_id}`, `{key}`. Resp: 204.
23. `GET /rooms/:id/publisher-key` — §8.8.15 -> `crate::routes::publisher_keys::get_publisher_key` (`server/src/routes/publisher_keys.rs`). Req: Path `{id}`, Query `PublisherKeyQuery`. Resp: `PublisherKeyResponse` (200).
24. `POST /rooms/:id/publisher-key` — §8.8.16 -> `crate::routes::publisher_keys::publish_publisher_key` (`server/src/routes/publisher_keys.rs`). Req: Path `{id}`, Body `PublishPublisherKeyRequest`. Resp: `PublisherKeyResponse` (200).
25. `GET /rooms/:id/observer-stream` — §8.8.13 -> `crate::routes::observer_stream::observer_stream_handler` (`server/src/routes/observer_stream.rs`). Req: Path `{id}`, Header `Last-Event-ID`. Resp: `text/event-stream`.

## 6. Current Bot Response Types
- `BotView`
- `CreateTokenResp`
- `BotTokenItem` / `ListTokensResp`
- `RoomBotView`
- `ListRoomBotsResp`
- `PostBotMessageResp`
- `PostBotCommandResp`
- `GetBotSettingsResp`
- `BotSettingView`
- `PublisherKeyResponse`
- `AttachmentView` (shared)

## 7. Current Bot Request Types
- Body types: `CreateBotReq`, `PatchBotReq`, `RotateBotKeysReq`, `GrantBotReq`, `PatchRoomBotReq`, `PostBotMessageReq`, `PostBotCommandReq`, `PostBotMessagesReq`, `PatchBotSettingRequest`, `PublishPublisherKeyRequest`.
- Query types: `PublisherKeyQuery` (derives `Deserialize`, query field `epoch`).
- Path param syntax: `{id}`, `{bot_id}`, `{token_id}`, `{key}`.

## 8. Current Auth Variations
- **User session only:** `POST /bots` (§8.8.1).
- **Bot token only:** `POST /rooms/:id/bot-messages` (§8.8.10), `POST /bots/me/commands/:id/ack` (§8.8.21), `POST /bots/me/messages` (§8.8.12), `GET /bots/me/settings` (§8.8.14), `GET /rooms/:id/observer-stream` (§8.8.13).
- **User session or bot token:** `GET /bots/:id` (§8.8.2), `PATCH /bots/:id` (§8.8.3), `DELETE /bots/:id` (§8.8 table), `PATCH /bots/:id/keys` (§8.8.17), `POST /bots/:id/avatar` (§8.8.4), `DELETE /bots/:id/avatar` (§8.8.5), `POST /bots/:id/tokens` (§8.8.18), `GET /bots/:id/tokens` (§8.8.19), `DELETE /bots/:id/tokens/:token_id` (§8.8.20).
- **User session room member / operator:** `GET /rooms/:id/bots`, `POST /rooms/:id/bots`, `PATCH /rooms/:id/bots/:bot_id`, `DELETE /rooms/:id/bots/:bot_id`, `POST /rooms/:id/bot-commands`, `GET /users/me/bots/:bot_id/settings`, `PATCH /users/me/bots/:bot_id/settings/:key`, `DELETE /users/me/bots/:bot_id/settings/:key`, `GET /rooms/:id/publisher-key`, `POST /rooms/:id/publisher-key`.

## 9. Current Multipart Handlers
- `POST /bots/:id/avatar` is `multipart/form-data`. Reuses `UserAvatarUploadForm` pattern.

## 10. Current Streaming Responses
- `GET /rooms/:id/observer-stream` returns `text/event-stream`. Documented as a string body with `text/event-stream` media type and comprehensive operation description detailing event types (`message.new`, `message.edited`, `message.deleted`, `room.member_added`, `room.member_removed`, `room.updated`), backpressure (`dropped { count }`), reconnection (`Last-Event-ID`), and cursor semantics per §8.8.13.

## 11. Current Ciphertext Field Conventions
- Bot message ciphertext (`PostBotMessageReq.ciphertext`): format `binary`, base64url encoded. References §6.33, §8.8.10.
- Bot command ciphertext (`PostBotCommandReq.ciphertext`): format `binary`, base64url encoded. References §6.31.
- Bot settings ciphertexts (`value_encrypted_bot`, `value_encrypted_client`): format `binary`, base64url encoded. References §6.31, §7.10, §8.8.14.
- Observer stream: omits ciphertext (§8.8.13).

## 12. Current Signing Field Conventions
- Bot message signature (`PostBotMessageReq.signature`): format `binary` (64-byte Ed25519 signature base64url encoded). References §8.10 bot message signing context.
- Publisher key signature (`PublishPublisherKeyRequest.signature`, `PublisherKeyResponse.signature`): format `binary` (64-byte Ed25519 signature base64url encoded). References §8.10 publisher key signing context.

## 13. Current Opaque Field Conventions
- Bot settings `value_encrypted_bot`: format `binary`, base64url encoded `ephemeral_pubkey (32) || nonce (12) || ciphertext || tag (16)` per §7.10.
- Bot command `ephemeral_result_pubkey`: format `binary`, base64url encoded 32-byte X25519 public key per §6.31.

## 14. Current Tests
- `server/tests/openapi_generation.rs`: Currently asserts 20 unique path items in `test_openapi_doc_validity`.
- Will be expanded to assert all new bot paths, schemas (`BotView`, `RoomBotView`, `BotSettingsView`, `PublisherKeyResponse`, etc.), security requirements, format: binary ciphertext/signature annotations, and updated path item count.

## 15. V2 Remnants / Repo Gaps
- `GET /bots/:id/tokens` (§8.8.19) handler was missing in `server/src/routes/bots.rs`. Adding `get_bot_tokens` in `server/src/routes/bots.rs` and registering in `server/src/lib.rs` completes the surface.
- `GET /rooms/:id/publisher-key` and `POST /rooms/:id/publisher-key` were unannotated in the rooms task. Adding annotations in `server/src/routes/publisher_keys.rs`.

---

## Split Decision

**Recommendation: Cover in one pass.**
The bots domain contains ~25 endpoints and shared models (`BotView`, `RoomBotView`, `BotSettingsView`). Covering the domain in a single pass avoids splitting shared schemas across tasks, avoids duplicate type derivations, and keeps the document generation fully consistent.
