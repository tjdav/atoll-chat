# Verification Report: Auth Endpoint Path and Capabilities Nested Object (Rename Task 2)

**Date:** March 2026
**Task:** Rename Task 2 of 2 — Auth Endpoint Path (`/ws/auth`) and Capabilities Nested Object (`websocket`)

---

## Client Confirmation Record

The client team confirmed receipt of the 2026-10-21 correction message *"Formal Response to Client Team — Superseding the v3.0.4 Contract Response"*, dated 2026-10-21. The client's V2-36 and V2-36b amendments are updated to consume the nested `websocket` capability object and use the `/ws/auth` subscription endpoint.

---

## Step 0 — Empirical Verification Items

### 1. Current Auth Endpoint Registration
- **Location:** `server/src/lib.rs:593`
- **Registration Code:** `.route("/sockudo/auth", post(routes::sockudo::auth_handler))`
- **Mount Mechanism:** Hardcoded string literal mounted at root app level outside `/api/v1/`.

### 2. Current Auth Handler
- **Location:** `server/src/routes/sockudo.rs:43` (`auth_handler`)
- **Request Shape:** `AuthRequest { socket_id: String, channel_name: String }`
- **Response Shape:** `AuthResponse { auth: String }`
- **HMAC Computation:** `state.publisher.sign_channel_auth(&payload.socket_id, &payload.channel_name)`
- **Confirmation:** Nothing in this task alters the HMAC computation or authentication signature format.

### 3. Current Config Field for Auth Path
- **Struct Field Name:** `Config.websocket_auth_path: String` (`server/src/config.rs:164`)
- **Env Var:** `WEBSOCKET_AUTH_PATH` (`server/src/config.rs:1103`)
- **Current Default:** `"/sockudo/auth"` (to be updated to `"/ws/auth"`)
- **Mount Path Integration:** `build_app` in `server/src/lib.rs` will read `&state.config.websocket_auth_path` when mounting the router instead of hardcoding the path string.

### 4. Current CapabilitiesResponse Struct
- **Location:** `server/src/routes/capabilities.rs:24`
- **Current Fields:** `version`, `calling`, `call_max_participants`, `sessions_enabled`, `max_sessions_per_room`, `max_session_participants`, `session_types`, `model_hosting_enabled`, `model_hosting_mode`, `stt_models_base_url`, `stt_default_model`, `tts_models_base_url`, `tts_default_model`, `tts_models`, `push_vapid_public_key`, `websocket_url`, `sockudo_app_key`, `sockudo_channel_prefix`, `client_events_enabled`, `altcha`, `storage_backend`, `storage_presign_supported`, `storage_presign_max_ttl_seconds`, `attachment_format`, `attachment_chunk_size`, `attachment_bucket_sizes`, `attachment_accept_ranges`, `username_oprf_enabled`, `oprf_suite`, `key_transparency_enabled`, `link_preview_proxy_enabled`, `safety_number_mode`, `moderation_mode`, `edit_window_seconds`, `reactions_per_message`, `sync_event_retention_days`, `threading_enabled`, `starred_items_per_user`, `preferences_max_encrypted_bytes`, `extension_proxy_enabled`, `extension_proxy_max_request_bytes`, `extension_proxy_max_response_bytes`, `extension_proxy_supports_streaming`, `extension_proxy_key`.
- **Flat Fields Present:** `websocket_url`, `sockudo_app_key`, `sockudo_channel_prefix`, `client_events_enabled`.
- **Confirmation:** `sockudo_auth_endpoint` was **NOT** present at the top level.

### 5. Current OpenAPI Schema for CapabilitiesResponse
- **Location:** `docs/openapi.json` (`components.schemas.CapabilitiesResponse.properties`)
- **Properties:** 44 top-level property keys matching the flat response DTO.

### 6. Current Auth Endpoint OpenAPI Annotation
- **Location:** `server/src/routes/sockudo.rs:20`
- **Annotation Path:** `#[utoipa::path(post, path = "/sockudo/auth", ...)]`
- **Alignment:** Matches current router mount path `/sockudo/auth`.

### 7. Client-Facing Assertions Inventory
- **`websocket_url`:** `server/tests/capabilities_audit.rs:25`, `server/tests/sockudo.rs:281`, `server/tests/end_to_end_walkthrough.rs:257`.
- **`sockudo_app_key`:** `server/tests/capabilities_audit.rs:26`.
- **`sockudo_channel_prefix`:** `server/tests/capabilities_audit.rs:27`, `server/tests/sockudo.rs:287`, `server/tests/end_to_end_walkthrough.rs:259`.
- **`sockudo_auth_endpoint`:** None in current test files.
- **`websocket.auth_endpoint`:** None currently (to be added).
- **`client_events_enabled`:** `server/tests/capabilities_audit.rs:28, 94, 162`, `server/tests/openapi_generation.rs:190` (retained at top level).
- **Test File Batch Assignments:**
  - `capabilities_audit.rs` → `capabilities` batch
  - `sockudo.rs` → `sockudo` batch
  - `end_to_end_walkthrough.rs` → `operations` batch
  - `openapi_generation.rs` → `operations` batch

### 8. Walkthrough Assertions
- **Location:** `server/tests/end_to_end_walkthrough.rs:255-260` (Phase 1)
- **Current Assertions:** `caps_json.get("websocket_url").is_some()`, `caps_json.get("pusher_app_key").is_some()`, `caps_json.get("sockudo_channel_prefix").is_some()`.
- **Planned Update:** Assert nested `caps_json.get("websocket").is_some()`, `websocket.url`, `websocket.protocol == "pusher-v7"`, `websocket.app_key`, `websocket.auth_endpoint == "/ws/auth"`, and top-level `client_events_enabled`. Assert flat fields are `None`.

### 9. Capabilities Test File
- **File & Batch:** `server/tests/capabilities_audit.rs` (`capabilities` batch)
- **Existing Tests:**
  - `test_capabilities_exact_key_set_enabled`: asserts 44 keys and `client_events_enabled == true`.
  - `test_capabilities_exact_key_set_disabled`: asserts 44 keys with disabled feature shapes.
  - `test_capabilities_client_events_enabled_toggle`: asserts boolean toggle behavior.

### 10. Auth Endpoint Tests
- **Files & Batch:** `server/tests/sockudo.rs` and `server/tests/sync_channel_auth.rs` (`sockudo` batch)
- **Occurrences of `/sockudo/auth` URL String:**
  - `server/tests/sockudo.rs:157, 188, 208, 228, 248`
  - `server/tests/sync_channel_auth.rs:53, 78, 100, 122, 166, 178`
- **Planned Update:** Re-target requests to `/ws/auth`. Add assertion that `POST /sockudo/auth` returns 404.

### 11. Config Field for `WEBSOCKET_AUTH_PATH`
- **Field & Env Var:** `Config.websocket_auth_path` / `WEBSOCKET_AUTH_PATH`
- **Default Value:** Changing from `"/sockudo/auth"` to `"/ws/auth"`.
- **Mount Path Derivation:** Router construction in `server/src/lib.rs` binds `&state.config.websocket_auth_path` at startup.

### 12. Protocol Constant
- **Choice:** Defined as `pub const WEBSOCKET_PROTOCOL: &str = "pusher-v7";` in `server/src/routes/capabilities.rs`.

### 13. Reverse-Proxy Documentation
- **File:** `server/README.md`
- **Lines:** 920, 999 (references to `POST /api/v1/sockudo/auth` and `POST /sockudo/auth` updated to `POST /ws/auth`).

### 14. Non-Server Callers of `/sockudo/auth`
- **Search Result:** Zero non-server callers found in the workspace. All references are internal server source files, integration test files, README, and verification reports.

---

## Specification Amendment — WebSocket-Neutral Naming (for Specification Team publication)

### §5.19 Environment Variables
The WebSocket configuration block uses protocol-neutral and Pusher protocol variable names:
```env
WEBSOCKET_URL=http://localhost:6001
WEBSOCKET_PUBLIC_URL=https://realtime.example.com
PUSHER_APP_ID=chat
PUSHER_APP_KEY=auto
PUSHER_APP_SECRET=auto
WEBSOCKET_AUTH_PATH=/ws/auth
WEBSOCKET_ENABLE_CLIENT_EVENTS=true
```

### §8.1 Capabilities Response Schema
The `GET /api/v1/capabilities` response object groups WebSocket connection details into a nested `websocket` object. Flat fields `websocket_url`, `sockudo_app_key`, `sockudo_channel_prefix`, and `sockudo_auth_endpoint` are removed. `client_events_enabled` remains a top-level feature flag.

```json
{
  "version": "3.0.4",
  "websocket": {
    "url": "wss://realtime.example.com/app/chat-key",
    "protocol": "pusher-v7",
    "app_key": "chat-key",
    "auth_endpoint": "/ws/auth"
  },
  "client_events_enabled": true
}
```

### §8.1.6 Channel Authentication Endpoint
The channel subscription authorization endpoint is mounted at the reverse-proxy root at `/ws/auth` by default (configurable via `WEBSOCKET_AUTH_PATH`), outside `/api/v1/`. Accepts both user session tokens and bot tokens via HTTP Bearer header.

- **`websocket.protocol` Disambiguation:** The `websocket.protocol` field specifies `"pusher-v7"`, informing client software of the subscription authentication protocol and wire message format.
