# Verification Report: Client Events Enabled Capability

**Date:** 2026-10-24
**Target Spec:** Server Spec v3.0.4 (§5.19, §8.1)
**Deliverable:** `verification/client-events-enabled-capability/report.md`

---

## Executive Summary

This report completes Step 0 empirical verification for adding the top-level `client_events_enabled: bool` capability field to `CapabilitiesResponse` and advertising it via `GET /api/v1/capabilities`.

---

## 1. Current CapabilitiesResponse Struct

- **File:** `server/src/routes/capabilities.rs`
- **Struct:** `CapabilitiesResponse`
- **Current Fields and Types (43 fields total):**
  1. `version: String`
  2. `calling: bool`
  3. `call_max_participants: u32`
  4. `sessions_enabled: bool`
  5. `max_sessions_per_room: u32`
  6. `max_session_participants: u32`
  7. `session_types: Vec<SessionTypeCapView>`
  8. `model_hosting_enabled: bool`
  9. `model_hosting_mode: String`
  10. `stt_models_base_url: String`
  11. `stt_default_model: String`
  12. `tts_models_base_url: String`
  13. `tts_default_model: String`
  14. `tts_models: Vec<TtsCapabilityModelView>`
  15. `push_vapid_public_key: Option<String>`
  16. `websocket_url: String`
  17. `sockudo_app_key: String`
  18. `sockudo_channel_prefix: String`
  19. `altcha: AltchaCapView`
  20. `storage_backend: String`
  21. `storage_presign_supported: bool`
  22. `storage_presign_max_ttl_seconds: u64`
  23. `attachment_format: String`
  24. `attachment_chunk_size: u64`
  25. `attachment_bucket_sizes: Vec<u64>`
  26. `attachment_accept_ranges: bool`
  27. `username_oprf_enabled: bool`
  28. `oprf_suite: String`
  29. `key_transparency_enabled: bool`
  30. `link_preview_proxy_enabled: bool`
  31. `safety_number_mode: String`
  32. `moderation_mode: String`
  33. `edit_window_seconds: i64`
  34. `reactions_per_message: i64`
  35. `sync_event_retention_days: u64`
  36. `threading_enabled: bool`
  37. `starred_items_per_user: u32`
  38. `preferences_max_encrypted_bytes: usize`
  39. `extension_proxy_enabled: bool`
  40. `extension_proxy_max_request_bytes: u64`
  41. `extension_proxy_max_response_bytes: u64`
  42. `extension_proxy_supports_streaming: bool`
  43. `extension_proxy_key: Option<String>`

- **Absence Confirmation:** Confirmed that `client_events_enabled` is currently absent from `CapabilitiesResponse`.

---

## 2. Current Config Field for Client Events

- **Config Struct Field:** `pub websocket_enable_client_events: bool` (`server/src/config.rs`)
- **Source Environment Variable:** `WEBSOCKET_ENABLE_CLIENT_EVENTS` (post-Rename Task 1 alias)
- **Default Value:** `true` (when `WEBSOCKET_ENABLE_CLIENT_EVENTS` is unset or empty)
- **Value Type:** `bool`
- **Parsing Mechanism:**
  ```rust
  let websocket_enable_client_events = env::var("WEBSOCKET_ENABLE_CLIENT_EVENTS")
      .map(|v| v.trim().eq_ignore_ascii_case("true") || v.trim() == "1")
      .unwrap_or(true);
  ```

---

## 3. Current Capabilities Handler

- **File & Function:** `pub async fn handler(State(state): State<AppState>) -> impl IntoResponse` in `server/src/routes/capabilities.rs`
- **Response Construction:** Constructed at line 194 returning `Json(CapabilitiesResponse { ... })`.
- **Config Access:** The handler accesses config directly through `AppState` via `state.config.websocket_enable_client_events`.

---

## 4. Current OpenAPI Schema for CapabilitiesResponse

- **File:** `docs/openapi.json` (`components.schemas.CapabilitiesResponse`)
- **Property Count:** 43 properties currently.
- **`*_enabled` Feature-Flag Booleans:** `sessions_enabled`, `model_hosting_enabled`, `username_oprf_enabled`, `key_transparency_enabled`, `link_preview_proxy_enabled`, `extension_proxy_enabled`.
- **Pattern:** Top-level boolean properties. `client_events_enabled` follows this exact pattern as a top-level `bool` sibling to the other `*_enabled` flags.

---

## 5. Current Capabilities Tests & Batch Assignment

- **Audit Test Suite:** `server/tests/capabilities_audit.rs`
  - `test_capabilities_exact_key_set_enabled`
  - `test_capabilities_exact_key_set_disabled`
  - **Batch Assignment:** `transport` batch (`server/tests/batch-manifest.toml`)
- **OpenAPI Schema Test Suite:** `server/tests/openapi_generation.rs`
  - **Batch Assignment:** `operations` batch (`server/tests/batch-manifest.toml`)

---

## 6. Test Fixtures Direct Construction Search

- **Search Query:** `CapabilitiesResponse` in `server/tests/`
- **Result:** Zero occurrences in `server/tests/`. Tests query `GET /api/v1/capabilities` over HTTP/axum service and parse returned JSON via `serde_json::Value`. No test directly constructs `CapabilitiesResponse` in Rust code.

---

## 7. Existing Assertions Affected

- **`server/tests/capabilities_audit.rs`:**
  - `EXPECTED_CAPABILITIES_KEYS` array needs `"client_events_enabled"` added (and `"pusher_app_key"` corrected to `"sockudo_app_key"`).
  - `assert_eq!(actual_keys.len(), 42)` will fail because the total field count increases from 42 to 43 key strings on wire.
- **`server/tests/openapi_generation.rs`:**
  - Will add explicit assertions for `client_events_enabled` in `CapabilitiesResponse` schema properties.
