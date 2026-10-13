# Step 0 — Empirical Verification Report: OpenAPI Annotations — Admin Endpoints

**Date:** 2026-10-13
**Status:** Complete
**Domain:** Admin Endpoints (`/admin/...`)

---

## 1. Current ApiDoc Struct
- **Paths count:** 41 paths registered in `ApiDoc` in `server/src/openapi.rs`.
- **KT-Domain Annotations:** Present in `paths(...)`:
  - `crate::routes::key_transparency::get_user_kt_handler` (`GET /api/v1/kt/user/{id}`)
  - `crate::routes::key_transparency::get_bot_kt_handler` (`GET /api/v1/kt/bot/{id}`)
  - `crate::routes::key_transparency::get_bot_kt_history_handler` (`GET /api/v1/kt/bot/{id}/history`)
  - `crate::routes::key_transparency::get_kt_snapshot_handler` (`GET /api/v1/kt/snapshot`)
- **Schemas list:** Contains 60+ components including `UserKtResponse`, `BotKtResponse`, `BotKtHistoryEntry`, `BotKtHistoryResponse`, `KtSnapshotResponse`, `KtTreeHead`, `KtAuditorSignature`.

## 2. Current Error Response Schema
- **Defined:** `ErrorResponse` is defined in `server/src/error.rs`:
  ```rust
  #[derive(Debug, Serialize, ToSchema)]
  pub struct ErrorResponse {
      pub error: String,
      pub message: String,
      #[schema(value_type = Object)]
      pub details: serde_json::Value,
  }
  ```
- **Usage:** Referenced across error status codes (400, 401, 403, 404, 409, 429, 500, 502, 503).

## 3. Current Bearer Security Scheme
- **Defined:** `bearer_auth` SecurityScheme is configured in `SecurityAddon` in `server/src/openapi.rs`:
  ```rust
  components.add_security_scheme(
      "bearer_auth",
      SecurityScheme::Http(
          HttpBuilder::new()
              .scheme(HttpAuthScheme::Bearer)
              .bearer_format("session_token")
              .description(Some("Session token Bearer authentication"))
              .build(),
      ),
  );
  ```
- All admin domain path annotations reference `security(("bearer_auth" = []))`.

## 4. Current Admin Endpoint Handlers
For each of the admin endpoints in scope:

1. **POST /admin/oprf/rotate**
   - Handler location: `server/src/routes/admin_oprf.rs` -> `pub async fn rotate`
   - Request type: `RotateOprfRequest`
   - Response type: `RotateOprfResponse` (wrapped in tuple with `HeaderMap` for `Cache-Control: no-store`)

2. **GET /admin/key-transparency**
   - Handler location: `server/src/routes/admin.rs` -> `pub async fn get_key_transparency_handler`
   - Request type: None
   - Response type: `KeyTransparencyStatsResponse`

3. **POST /admin/key-transparency/snapshot**
   - Handler location: `server/src/routes/admin.rs` -> `pub async fn post_key_transparency_snapshot_handler`
   - Request type: None
   - Response type: `SnapshotView` (`crate::key_transparency::SnapshotView`)

4. **GET /admin/rooms/:id/sessions**
   - Handler location: Note: no dedicated admin handler exists in `server/src/routes/admin.rs`. The endpoint specified in §8.3 (`GET /admin/rooms/:id/sessions`) is a read-only variant returning the room session list. In code, `crate::routes::room_sessions::list` handles room session listing (`GET /rooms/:id/sessions`). For OpenAPI spec completeness per §8.3, `crate::routes::room_sessions::list_admin` / path annotation will cover `GET /api/v1/admin/rooms/{id}/sessions` or adapt `crate::routes::room_sessions::list_admin`.
   - Request type: Query parameters (`ListRoomSessionsQuery`)
   - Response type: `SessionListResponse` (`Vec<RoomSessionView>`)

5. **POST /admin/models/reload**
   - Handler location: `server/src/routes/admin.rs` -> `pub async fn post_reload_models_handler`
   - Request type: None
   - Response type: `ModelReloadResponse`

6. **POST /admin/session-types/reload**
   - Handler location: `server/src/routes/admin.rs` -> `pub async fn post_reload_session_types_handler`
   - Request type: None
   - Response type: `SessionTypesReloadResponse`

7. **POST /admin/extension-proxy/reload-blocklist**
   - Handler location: `server/src/routes/admin.rs` -> `pub async fn post_reload_extension_proxy_blocklist_handler`
   - Request type: None
   - Response type: `ExtensionProxyBlocklistReloadResponse`

## 5. Current Admin Response Types
Exact shapes of admin response structs:

- **`RotateOprfResponse`** (`server/src/routes/admin_oprf.rs`):
  ```rust
  pub struct RotateOprfResponse {
      pub backup_path: String,
      pub users_flagged: u64,
      pub rotated_at: String,
      pub restart_required: bool,
  }
  ```
- **`KeyTransparencyStatsResponse`** (`server/src/routes/admin.rs`):
  ```rust
  pub struct KeyTransparencyStatsResponse {
      pub enabled: bool,
      pub tree_size: i64,
      pub oldest_leaf_added_at: Option<DateTime<Utc>>,
      pub newest_leaf_added_at: Option<DateTime<Utc>>,
  }
  ```
- **`SnapshotView`** (`server/src/key_transparency/snapshot.rs`):
  ```rust
  pub struct SnapshotView {
      pub id: String,
      pub tree_size: i64,
      pub root_hash: String,
      pub signature: String,
      pub created_at: DateTime<Utc>,
  }
  ```
- **`SessionListResponse`** (`server/src/routes/room_sessions.rs`):
  ```rust
  pub struct SessionListResponse {
      pub sessions: Vec<RoomSessionView>,
  }
  ```
- **`ModelReloadResponse`** (`server/src/routes/admin.rs`):
  ```rust
  pub struct ModelReloadResponse {
      pub reloaded: bool,
      pub stt_models: usize,
      pub tts_models: usize,
  }
  ```
- **`SessionTypesReloadResponse`** (`server/src/routes/admin.rs`):
  ```rust
  pub struct SessionTypesReloadResponse {
      pub reloaded: bool,
      pub session_types: Vec<crate::sessions::SessionTypeAdminView>,
  }
  ```
- **`ExtensionProxyBlocklistReloadResponse`** (`server/src/routes/admin.rs`):
  ```rust
  pub struct ExtensionProxyBlocklistReloadResponse {
      pub reloaded: bool,
      pub suffix_count: usize,
  }
  ```

## 6. Current Admin Authorization
- **Auth Extractor:** `AuthUser` (verifies Bearer session token).
- **Permission Extractor:** `RequirePermission<ConfigEdit>` (checks global permission `config.edit` held by global roles `owner` level 100 and `admin` level 80).
- **OpenAPI Representation:** Operations declare `security(("bearer_auth" = []))` and document admin permission (`config.edit`) requirement in the description.

## 7. Current Request Body Types
- **POST /admin/oprf/rotate:** `RotateOprfRequest`:
  ```rust
  pub struct RotateOprfRequest {
      pub confirm: Option<bool>,
  }
  ```
- **GET /admin/key-transparency:** None.
- **POST /admin/key-transparency/snapshot:** None.
- **GET /admin/rooms/:id/sessions:** None (optional query params `extension_id`, `session_type`).
- **POST /admin/models/reload:** None.
- **POST /admin/session-types/reload:** None.
- **POST /admin/extension-proxy/reload-blocklist:** None.

## 8. Current Path Parameter Naming
- Path parameter for room sessions: router uses `:id` (`/admin/rooms/:id/sessions` / `/rooms/:id/sessions`). Utoipa annotation parameter uses `{id}`.

## 9. Current Shared Types with Prior Domains
- **Reused Types (derived in prior domains):**
  - `SnapshotView` (`crate::key_transparency::SnapshotView` / reused from KT snapshot response)
  - `RoomSessionView` & `SessionListResponse` (`crate::routes::room_sessions::SessionListResponse`)
  - `SessionTypeAdminView` (`crate::sessions::SessionTypeAdminView`)
- **New Types Introduced in This Task:**
  - `RotateOprfRequest`
  - `RotateOprfResponse`
  - `KeyTransparencyStatsResponse`
  - `ModelReloadResponse`
  - `SessionTypesReloadResponse`
  - `ExtensionProxyBlocklistReloadResponse`

## 10. Current Admin-Mixed Endpoints
- Path prefix comparison: `/api/v1/admin/rooms/{id}/sessions` vs `/api/v1/rooms/{id}/sessions`. Distinct path keys in OpenAPI specification, zero collision.

## 11. Current Streaming Responses
- Confirmed: None in the admin domain.

## 12. Current Multipart Handlers
- Confirmed: None in the admin domain.

## 13. Current Tests
- `server/tests/openapi_generation.rs`:
  - Current path count assertion: 41.
  - Round-trips serde.
  - Tests default CLI invocation and `--out` flag.

## 14. V2 Remnants
- Confirmed: None. No lingering v2 response structs or competing definitions.

---

**Step 0 Report Complete.**
