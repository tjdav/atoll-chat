# Step 0 Report — OpenAPI Annotations for User Endpoints

**Date:** 2026-10-12
**Task:** OpenAPI Annotations — User Endpoints
**Status:** Verification Complete

---

## 1. Current ApiDoc Struct

Location: `server/src/openapi.rs`

- **Info Metadata:**
  - Title: `"Atoll Encrypted Chat API"`
  - Version: `"3.0.4"`
  - Description: `"OpenAPI specification for the Atoll server API. Derived from code annotations. Source of truth remains Server Spec v3.0.4."`
- **Paths List (4 pilot paths):**
  1. `crate::routes::health::handler` (`GET /api/v1/health`)
  2. `crate::routes::ready::handler` (`GET /api/v1/ready`)
  3. `crate::routes::capabilities::handler` (`GET /api/v1/capabilities`)
  4. `crate::routes::users::get_me` (`GET /api/v1/users/me`)
- **Schemas List (9 schemas):**
  - `HealthResponse`
  - `ReadinessResponse`
  - `CapabilitiesResponse`
  - `AltchaCapView`
  - `SessionTypeCapView`
  - `TtsCapabilityModelView`
  - `VoiceMetadata`
  - `UserProfileResponse`
  - `UserLimitsResponse`

All four pilot paths are present.

---

## 2. Current Pilot Annotations

Convention across pilot handlers:
- **Summary:** One short, imperative sentence (e.g., `"Current user profile"`).
- **Description:** Direct section reference to Server Spec v3.0.4 (e.g., `"Fetches the current authenticated user's profile and limits (Server Spec v3.0.4 §8.2, §8.2.1)."`).
- **Security:** Declared using `security(("bearer_auth" = []))`.
- **Responses:** Status code, description, and `body = <Type>`. Error responses reference standard HTTP status codes (e.g., status = 401, description = "Unauthorized").

Example from `server/src/routes/users.rs`:
```rust
#[utoipa::path(
    get,
    path = "/api/v1/users/me",
    tag = "User",
    summary = "Current user profile",
    description = "Fetches the current authenticated user's profile and limits (Server Spec v3.0.4 §8.2, §8.2.1).",
    security(
        ("bearer_auth" = [])
    ),
    responses(
        (status = 200, description = "User profile retrieved successfully", body = UserProfileResponse),
        (status = 401, description = "Unauthorized")
    )
)]
```

---

## 3. Current User Endpoint Handlers (22 Endpoints)

| # | Endpoint | Router Path | Handler Location | Request Type | Response Type | Notes |
|---|---|---|---|---|---|---|
| 1 | POST /auth/logout | `/auth/logout` | `server/src/routes/sessions.rs::logout` | `Option<Json<LogoutRequest>>` | `StatusCode` (204) | Handled in `sessions.rs`. Request struct `LogoutRequest` derives `Deserialize`. Response is empty 204. |
| 2 | GET /users/me | `/users/me` | `server/src/routes/users.rs::get_me` | None | `Json<UserProfileResponse>` | Already annotated in pilot. Struct `UserProfileResponse` derives `Serialize, ToSchema`. |
| 3 | PATCH /users/me | `/users/me` | `server/src/routes/users.rs::patch_me` | `Json<Value>` | `Json<UserProfileResponse>` | Request is `PatchUserProfileRequest` (to be created as typed struct). Response reuses `UserProfileResponse`. |
| 4 | DELETE /users/me | `/users/me` | `server/src/routes/users.rs::delete_me` | `Option<Json<Value>>` | `Response` (204 / Error) | Request is `DeleteAccountRequest` (`confirm: "DELETE"`). Returns 204 No Content on success. |
| 5 | GET /users/me/export | `/users/me/export` | `server/src/routes/users.rs::export_me` | None | `Response` (`application/zip`) | Binary zip export payload. |
| 6 | POST /users/lookup | `/users/lookup` | `server/src/routes/users.rs::lookup_user` | `Json<Value>` (raw JSON) | `Json<UserLookupResponse>` | Request is `UserLookupRequest` (`lookup_token`, `username_token`). Response struct `UserLookupResponse` derives `Serialize`. |
| 7 | GET /users/me/devices | `/users/me/devices` | `server/src/routes/devices.rs::list` | None | `Json<ListDevicesResponse>` | Response struct `ListDevicesResponse` contains `Vec<DeviceResponse>`. Both derive `Serialize`. |
| 8 | DELETE /users/me/devices/:id | `/users/me/devices/{id}` | `server/src/routes/devices.rs::revoke` | Path(`id`) | `StatusCode` (204) | Empty 204 response. |
| 9 | GET /users/me/sessions | `/users/me/sessions` | `server/src/routes/sessions.rs::list` | None | `Json<SessionListResponse>` | Response struct `SessionListResponse` contains `Vec<SessionResponseItem>`. Both derive `Serialize`. |
| 10 | DELETE /users/me/sessions/:id | `/users/me/sessions/{id}` | `server/src/routes/sessions.rs::revoke` | Path(`id`) | `StatusCode` (204) | Empty 204 response. |
| 11 | POST /users/me/push-subscriptions | `/users/me/push-subscriptions` | `server/src/routes/push_subscriptions.rs::register` | `Json<RegisterSubscriptionBody>` | `Json<PushSubscriptionView>` | Request struct `RegisterSubscriptionBody` derives `Deserialize`. Response struct `PushSubscriptionView` derives `Serialize`. Returns 201. |
| 12 | DELETE /users/me/push-subscriptions/:id | `/users/me/push-subscriptions/{id}` | `server/src/routes/push_subscriptions.rs::revoke` | Path(`id`) | `StatusCode` (204) | Empty 204 response. |
| 13 | GET /users/me/sync | `/users/me/sync` | `server/src/routes/sync.rs::get_sync` | Query(`GetSyncQuery`) | `Json<SyncResponse>` | Query `GetSyncQuery` (`since_seq`). Response struct `SyncResponse` derives `Serialize`. |
| 14 | POST /users/me/read-state | `/users/me/read-state` | `server/src/routes/read_state.rs::write` | `Json<WriteReadStateRequest>` | `Json<ReadStateRow>` | Request `WriteReadStateRequest` derives `Deserialize`. Response `ReadStateRow` derives `Serialize`. |
| 15 | PATCH /users/me/room-order | `/users/me/room-order` | `server/src/routes/room_order.rs::patch_room_order` | `Json<Value>` | `Json<RoomOrderSyncState>` | Request is `PatchRoomOrderRequest` (`room_ids: Vec<String>`). Response struct `RoomOrderSyncState` derives `Serialize`. |
| 16 | GET /users/me/preferences/:key | `/users/me/preferences/{key}` | `server/src/routes/preferences.rs::get` | Path(`key`) | `Json<PreferenceRow>` | Response struct `PreferenceRow` derives `Serialize`. |
| 17 | PATCH /users/me/preferences/:key | `/users/me/preferences/{key}` | `server/src/routes/preferences.rs::write` | Path(`key`), `Json<Value>` | `Json<PreferenceRow>` | Request is `WritePreferenceRequest` (`value: String`). Response struct `PreferenceRow` derives `Serialize`. |
| 18 | DELETE /users/me/preferences/:key | `/users/me/preferences/{key}` | `server/src/routes/preferences.rs::delete` | Path(`key`) | `StatusCode` (204) | Empty 204 response. |
| 19 | GET /users/me/starred-items | `/users/me/starred-items` | `server/src/routes/starred.rs::get_starred_items` | Query(`ListStarQuery`) | `Json<ListStarredItemsResponse>` | Query `ListStarQuery` (`type`, `room_id`, `limit`, `cursor`, `include_deleted`). Response struct `ListStarredItemsResponse` derives `Serialize`. |
| 20 | POST /users/me/starred-items | `/users/me/starred-items` | `server/src/routes/starred.rs::post_star` | `Json<StarRequest>` | `Json<StarredItemView>` | Request struct `StarRequest` derives `Deserialize`. Response struct `StarredItemView` derives `Serialize`. |
| 21 | DELETE /users/me/starred-items/:item_id | `/users/me/starred-items/{item_id}` | `server/src/routes/starred.rs::delete_star` | Path(`item_id`), Query(`UnstarQuery`) | `StatusCode` (204) | Query `UnstarQuery` (`item_type`). Empty 204 response. |
| 22 | POST /users/me/avatar | `/users/me/avatar` | `server/src/routes/attachments.rs::upload_avatar` | Multipart form | `Json<AttachmentView>` | Multipart request. Response struct `AttachmentView` derives `Serialize`. |

---

## 4. Current User Response Types

List of distinct response types in the user domain:

1. `UserProfileResponse` (`server/src/routes/users.rs`) — already derives `Serialize, ToSchema`.
2. `UserLimitsResponse` (`server/src/routes/users.rs`) — already derives `Serialize, ToSchema`.
3. `UserLookupResponse` (`server/src/routes/users.rs`) — derives `Serialize`. Needs `ToSchema`.
4. `DeviceResponse` (`server/src/routes/devices.rs`) — derives `Serialize`. Needs `ToSchema`.
5. `ListDevicesResponse` (`server/src/routes/devices.rs`) — derives `Serialize`. Contains `Vec<DeviceResponse>`. Needs `ToSchema`.
6. `DeviceStateRow` (`server/src/sync/device_names.rs`) — derives `Serialize`. Returned by `PATCH /users/me/devices/{id}` (via `update_name`). Needs `ToSchema`.
7. `SessionResponseItem` (`server/src/routes/sessions.rs`) — derives `Serialize`. Needs `ToSchema`.
8. `SessionListResponse` (`server/src/routes/sessions.rs`) — derives `Serialize`. Contains `Vec<SessionResponseItem>`. Needs `ToSchema`.
9. `PushSubscriptionView` (`server/src/push/subscriptions.rs`) — derives `Serialize`. Needs `ToSchema`.
10. `PushSubscriptionListResponse` (or inline JSON `{ subscriptions: Vec<PushSubscriptionView> }`) — created as `PushSubscriptionListResponse` in `push/subscriptions.rs` or `routes/push_subscriptions.rs`. Needs `Serialize, ToSchema`.
11. `SyncResponse` (`server/src/sync/query.rs`) — derives `Serialize`. Uses nested types `ReadStateRow`, `PreferenceRow`, `DeviceStateRow`, `StarredItemRow`, `BotSettingSyncRow`, `RoomOrderSyncState`. All need `ToSchema`.
12. `ReadStateRow` (`server/src/sync/read_state.rs`) — derives `Serialize`. Needs `ToSchema`.
13. `PreferenceRow` (`server/src/sync/preferences.rs`) — derives `Serialize`. Contains opaque ciphertext `value`. Needs `ToSchema` with `value` annotated as base64url ciphertext.
14. `StarredItemRow` (`server/src/starred/mod.rs`) — derives `Serialize`. Needs `ToSchema`.
15. `StarredItemView` (`server/src/starred/mod.rs`) — derives `Serialize`. Needs `ToSchema`.
16. `ListStarredItemsResponse` (`server/src/starred/list.rs`) — derives `Serialize`. Contains `Vec<StarredItemView>`. Needs `ToSchema`.
17. `BotSettingSyncRow` (`server/src/sync/query.rs`) — derives `Serialize`. Contains `value_encrypted_client`. Needs `ToSchema`.
18. `RoomOrderSyncState` (`server/src/sync/room_order.rs`) — derives `Serialize`. Needs `ToSchema`.
19. `AttachmentView` (`server/src/attachments.rs`) — derives `Serialize`. Returned by `upload_avatar`. Needs `ToSchema`.

---

## 5. Current Request Types

List of distinct request body and query types in the user domain:

1. `LogoutRequest` (`server/src/routes/sessions.rs`) — derives `Deserialize`. Needs `ToSchema`.
2. `UserLookupRequest` (`server/src/routes/users.rs`) — derives `Deserialize`. Needs `ToSchema`.
3. `PatchUserProfileRequest` (`server/src/routes/users.rs`) — created with `encrypted_display`, `profile`. Needs `Deserialize, ToSchema`.
4. `DeleteAccountRequest` (`server/src/routes/users.rs`) — created with `confirm` ("DELETE"). Needs `Deserialize, ToSchema`.
5. `UpdateDeviceNameRequest` (`server/src/routes/devices.rs`) — created with `encrypted_device_name`. Needs `Deserialize, ToSchema`.
6. `RegisterSubscriptionBody` (`server/src/routes/push_subscriptions.rs`) — derives `Deserialize`. Needs `ToSchema`.
7. `GetSyncQuery` (`server/src/routes/sync.rs`) — derives `Deserialize`. Needs `IntoParams` or `ToSchema`.
8. `WriteReadStateRequest` (`server/src/routes/read_state.rs`) — derives `Deserialize`. Needs `ToSchema`.
9. `PatchRoomOrderRequest` (`server/src/routes/room_order.rs`) — derives `Deserialize`. Needs `ToSchema`.
10. `WritePreferenceRequest` (`server/src/routes/preferences.rs`) — created with `value`. Needs `Deserialize, ToSchema`.
11. `ListStarQuery` (`server/src/starred/list.rs`) — derives `Deserialize`. Needs `IntoParams` or `ToSchema`.
12. `StarRequest` (`server/src/starred/write.rs`) — derives `Deserialize`. Needs `ToSchema`.
13. `UnstarQuery` (`server/src/routes/starred.rs`) — derives `Deserialize`. Needs `IntoParams` or `ToSchema`.
14. `UserAvatarUploadForm` (`server/src/routes/attachments.rs`) — multipart form struct with `file`, `claimed_id`, `plaintext_size`, `encrypted_size`, `chunk_size`, `chunk_count`, `nonce_prefix`, `base_counter`, `content_type`, `uploader_client_id`. Needs `ToSchema`.

---

## 6. Current Error Response Shape

V3 Server Spec §8 Error format:
```json
{ "error": "machine_readable_code", "message": "Human-readable message", "details": {} }
```

In `server/src/error.rs`:
Currently, `ApiError` is an enum implementing `IntoResponse`. No single error struct was defined with `ToSchema`.
We define a dedicated error response struct in `server/src/error.rs`:
```rust
#[derive(Serialize, ToSchema)]
pub struct ErrorResponse {
    pub error: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<serde_json::Value>,
}
```
This struct represents the standard error shape from §8 and will be derived with `ToSchema` and added to `ApiDoc` components.

---

## 7. Current Auth Middleware & Security Scheme

- Extractor: `AuthUser` in `server/src/auth.rs`.
- Header format: `Authorization: Bearer <session_token>`.
- Security Scheme:
  We define a `bearer_auth` SecurityScheme in `ApiDoc`:
  ```rust
  #[derive(OpenApi)]
  #[openapi(
      ...
      components(
          schemas(...),
          security_schemes(
              ("bearer_auth" = SecurityScheme::Http(
                  HttpBuilder::new()
                      .scheme(HttpAuthScheme::Bearer)
                      .bearer_format("session_token")
                      .description(Some("Session token Bearer authentication"))
                      .build()
              ))
          )
      )
  )]
  ```
  And every authenticated path includes `security(("bearer_auth" = []))`. Note: `POST /users/lookup` also requires `bearer_auth` per §8.2.3.

---

## 8. Current Multipart Handlers

Endpoint: `POST /users/me/avatar` (`server/src/routes/attachments.rs::upload_avatar`).

Pattern in `utoipa`:
```rust
#[derive(ToSchema)]
pub struct UserAvatarUploadForm {
    #[schema(format = Binary, value_type = String)]
    pub file: Vec<u8>,
    pub claimed_id: String,
    pub plaintext_size: i64,
    pub encrypted_size: i64,
    pub chunk_size: i64,
    pub chunk_count: i64,
    pub nonce_prefix: String,
    pub base_counter: i64,
    pub content_type: Option<String>,
    pub uploader_client_id: Option<String>,
}
```
And handler path attribute:
```rust
#[utoipa::path(
    post,
    path = "/api/v1/users/me/avatar",
    tag = "User",
    summary = "Upload user avatar",
    description = "Uploads a user avatar image as a multipart/form-data payload (Server Spec v3.0.4 §8.2, §8.2.7).",
    security(("bearer_auth" = [])),
    request_body(
        content = UserAvatarUploadForm,
        content_type = "multipart/form-data",
        description = "Multipart avatar file and manifest metadata"
    ),
    responses(
        (status = 201, description = "Avatar uploaded successfully", body = AttachmentView),
        (status = 400, description = "Bad request", body = ErrorResponse),
        (status = 401, description = "Unauthorized", body = ErrorResponse),
        (status = 413, description = "File too large", body = ErrorResponse)
    )
)]
```

---

## 9. Current CLI Subcommand

Verified `cargo run --bin server -- openapi generate` (or via `generate_openapi_file`) exists and writes to `docs/openapi.json`. Tested in integration test `openapi_generation.rs`.

---

## 10. Current Committed docs/openapi.json

- **Current Paths Count:** 4 paths (`/api/v1/health`, `/api/v1/ready`, `/api/v1/capabilities`, `/api/v1/users/me`).
- **File Size:** ~2.1 KB.
- **Format:** Pretty-printed JSON formatted with 2-space indentation.

---

## 11. Current CI or Makefile Staleness Check

Location: `server/Makefile` target `openapi-check`:
```makefile
openapi-check:
	cargo run --bin server -- openapi generate --out docs/openapi.json
	git diff --exit-code docs/openapi.json
```
Confirmed `make openapi-check` executes generator and checks `git diff --exit-code`.

---

## 12. Current Tests

Location: `server/tests/openapi_generation.rs`.
- `test_openapi_doc_validity`: Validates title, version ("3.0.4"), pilot paths presence, paths count (4).
- `test_openapi_cli_subcommand_out_flag`: Tests custom output path.
- `test_openapi_cli_default_invocation`: Tests default output path.

Will be extended to assert the 22 user endpoints + 4 pilot paths (25 unique route paths in total, since `/users/me`, `/users/me/devices/{id}`, `/users/me/push-subscriptions/{id}`, `/users/me/preferences/{key}`, `/users/me/starred-items/{item_id}` combine HTTP methods under single path keys in OpenAPI), bearer security requirement on authenticated user paths, multipart request body on `POST /users/me/avatar`, binary response on `GET /users/me/export`, ciphertext field descriptions, and schema presence in `components.schemas`.

---

## 13. V2 Remnants

Audited codebase for conflicting or legacy schema definitions:
- No competing OpenAPI generator frameworks exist.
- No legacy V2 user response definitions exist.
- Wire shapes and Serde derives remain untouched; `ToSchema` is strictly additive.
