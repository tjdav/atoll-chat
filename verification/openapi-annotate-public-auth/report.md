# Step 0 Empirical Verification Report — OpenAPI Annotations: Public and Auth Endpoints

**Date:** 2026-10-16
**Scope:** OpenAPI path annotations and schema definitions for Public and Auth Domain Endpoints.

---

### 1. Current ApiDoc Struct
- **Location:** `server/src/openapi.rs`
- **Paths Count:** 53 path items currently in `ApiDoc` (including operator queue endpoints from prior bot tasks).
- **Admin Domain Status:** Confirmed present. All 7 admin handlers (`/admin/oprf/rotate`, `/admin/key-transparency`, `/admin/key-transparency/snapshot`, `/admin/rooms/{id}/sessions`, `/admin/models/reload`, `/admin/session-types/reload`, `/admin/extension-proxy/reload-blocklist`) and schemas (`RotateOprfRequest`, `RotateOprfResponse`, `KeyTransparencyStatsResponse`, `ModelReloadResponse`, `SessionTypesReloadResponse`, `ExtensionProxyBlocklistReloadResponse`) are registered in `ApiDoc`.

### 2. Current Error Response Schema
- `ErrorResponse` struct is defined in `server/src/error.rs` with `#[derive(ToSchema)]` and standard V3 error envelope fields (`error`, `message`, `details`).

### 3. Current Bearer Security Scheme
- `SecurityAddon` in `server/src/openapi.rs` registers `bearer_auth` HTTP Bearer scheme with `session_token` format.

### 4. Current ALTCHA Capabilities
- `GET /capabilities` returns `CapabilitiesResponse` which contains `altcha: AltchaCapView`. `AltchaCapView` derives `ToSchema` and is registered in `ApiDoc`.

### 5. Current Auth Endpoint Handlers
- `GET /health` -> `routes::health::handler` -> `HealthResponse`
- `GET /ready` -> `routes::ready::handler` -> `ReadinessResponse`
- `GET /capabilities` -> `routes::capabilities::handler` -> `CapabilitiesResponse`
- `GET /auth/register/challenge` -> `routes::register::register_challenge` -> `AltchaChallengeResponse`
- `POST /auth/register/start` -> `routes::register::register_start` -> `RegisterStartRequest` -> `RegisterStartResponse`
- `POST /auth/register/finish` -> `routes::register::register_finish` -> `RegisterFinishRequest` -> `RegisterFinishResponse`
- `POST /auth/login/start` -> `routes::login::login_start` -> `LoginStartRequest` -> `LoginStartResponse`
- `POST /auth/login/finish` -> `routes::login::login_finish` -> `LoginFinishRequest` -> `LoginFinishResponse`
- `POST /auth/recover/start` -> `routes::recover::recover_start` -> `RecoverStartRequest` -> `RecoverStartResponse`
- `POST /auth/recover/finish` -> `routes::recover::recover_finish` -> `RecoverFinishRequest` -> `RecoverFinishResponse`
- `POST /auth/logout` -> `routes::sessions::logout` -> `LogoutRequest` -> HTTP 204 (already annotated in user domain)
- `GET /invites/{code}` -> `routes::invites::validate_invite_public_handler` -> `ValidateInviteResponse`
- `POST /oprf/blind` -> `routes::oprf::blind` -> `OprfBlindRequest` -> `OprfBlindResponse`
- `POST /link-preview/proxy` -> `routes::link_preview::proxy_handler` -> `LinkPreviewProxyRequest` -> `LinkPreviewProxyResponse` (Requires `AuthUser`)
- `POST /extensions/proxy` -> `routes::extensions_proxy::proxy_handler` -> `application/octet-stream` (Requires `AuthUser`)
- `GET /models/stt/v1/{model_id}/{version}/{filename}` -> `routes::models::serve_stt_file_handler` -> binary `application/octet-stream`
- `GET /models/tts/v1/{model_id}/{version}/{filename}` -> `routes::models::serve_tts_file_handler` -> binary `application/octet-stream`
- `GET /models/manifest.json` -> `routes::models::get_manifest_handler` -> `CombinedManifestResponse`
- `POST /sockudo/auth` -> `routes::sockudo::auth` -> `SockudoAuthRequest` -> `SockudoAuthResponse` (Requires `AuthUser`, accepts user session tokens and bot tokens)

### 6. Current Unauthenticated Endpoints
The following 15 endpoints do not require authentication and will omit the `security` attribute in utoipa:
1. `GET /api/v1/health`
2. `GET /api/v1/ready`
3. `GET /api/v1/capabilities`
4. `GET /api/v1/auth/register/challenge`
5. `POST /api/v1/auth/register/start`
6. `POST /api/v1/auth/register/finish`
7. `POST /api/v1/auth/login/start`
8. `POST /api/v1/auth/login/finish`
9. `POST /api/v1/auth/recover/start`
10. `POST /api/v1/auth/recover/finish`
11. `GET /api/v1/invites/{code}`
12. `POST /api/v1/oprf/blind`
13. `GET /models/stt/v1/{model_id}/{version}/{filename}`
14. `GET /models/tts/v1/{model_id}/{version}/{filename}`
15. `GET /models/manifest.json`

### 7. Current ALTCHA Challenge Response
- Response struct `AltchaChallengeResponse` with fields `algorithm`, `challenge`, `maxnumber`, `salt`, `signature` referencing §6.3.

### 8. Current OPRF Blind Endpoint
- `OprfBlindRequest`: `{ blinded: String }` (base64url format, format: byte)
- `OprfBlindResponse`: `{ evaluated: String }` (base64url format, format: byte)

### 9. Current Link Preview Proxy Endpoint
- Requires Bearer authentication (`AuthUser`).
- `LinkPreviewProxyRequest`: `{ ephemeral_pubkey: String, nonce: String, ciphertext: String }` with `format: byte`.
- `LinkPreviewProxyResponse`: `{ nonce: String, ciphertext: String }` with `format: byte`.

### 10. Current Extension Proxy Endpoint
- Requires Bearer authentication (`AuthUser`).
- Request body: `application/octet-stream` (binary payload).
- Response body: `application/octet-stream` (binary payload).
- Encrypted envelope carrying Content Key encryption of extension request/response plaintext per §8.1.5.

### 11. Current Model Serving Endpoints
- Content-Type: `application/octet-stream`.
- HTTP 200 (OK): Full model binary file.
- HTTP 206 (Partial Content): Single-range support documented.
- HTTP 416 (Range Not Satisfiable): Multi-range rejection documented.
- HTTP 404 (Not Found): Missing model file.

### 12. Current Sockudo Auth Endpoint
- Path: `/sockudo/auth` (mounted at reverse-proxy root, outside `/api/v1/`).
- Security: Bearer auth (`bearer_auth`). Accepts both user session tokens and bot tokens.
- `SockudoAuthRequest`: `{ socket_id: String, channel_name: String }`.
- `SockudoAuthResponse`: `{ auth: String }` where `auth` is `"<app_key>:<hex-hmac>"`.

### 13. Current Invites Endpoints
- `GET /invites/{code}` is unauthenticated. Returns `ValidateInviteResponse`: `{ valid: bool, expires_at: Option<DateTime<Utc>>, remaining_uses: Option<i64>, reason: Option<String> }`.

### 14. Current Test Harness
- Existing paths in `ApiDoc` total 53 (including operator queue endpoints). Adding the 16 new path items in this task brings the total expected path count in `openapi_generation.rs` to 69.

### 15. V2 Remnants
- No legacy V2 assumptions found in these handlers or types.
