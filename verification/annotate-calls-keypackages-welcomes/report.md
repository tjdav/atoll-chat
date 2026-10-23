# Empirical Verification Report: Annotate Calls, Keypackages, and Welcomes

## Step 0 — Baseline Verification & Inventory

### 1. Router Registrations in `server/src/lib.rs`

All 11 paths in scope are registered in `server/src/lib.rs` under `api_routes` (prefixed with `/api/v1`):

1. `POST /api/v1/calls/turn-credentials` — Lines 563–564: `.route("/calls/turn-credentials", post(routes::calls::turn_credentials_handler))`
2. `POST /api/v1/rooms/{id}/calls/{call_id}/join` — Lines 567–568: `.route("/rooms/{id}/calls/{call_id}/join", post(routes::calls::join_handler))`
3. `POST /api/v1/rooms/{id}/calls/{call_id}/leave` — Lines 571–572: `.route("/rooms/{id}/calls/{call_id}/leave", post(routes::calls::leave_handler))`
4. `POST /api/v1/rooms/{id}/calls/{call_id}/signal` — Lines 575–576: `.route("/rooms/{id}/calls/{call_id}/signal", post(routes::calls::signal_handler))`
5. `POST /api/v1/rooms/{id}/calls/{call_id}/end` — Lines 579–580: `.route("/rooms/{id}/calls/{call_id}/end", post(routes::calls::end_handler))`
6. `POST /api/v1/keypackages` — Line 454: `.route("/keypackages", post(routes::key_packages::upload))`
7. `GET /api/v1/keypackages/count` — Line 455: `.route("/keypackages/count", get(routes::key_packages::count))`
8. `POST /api/v1/keypackages/claim` — Line 456: `.route("/keypackages/claim", post(routes::key_packages::claim))`
9. `GET /api/v1/welcomes` — Line 543: `.route("/welcomes", get(routes::welcomes::list))`
10. `GET /api/v1/welcomes/{id}` — Line 544: `.route("/welcomes/{id}", get(routes::welcomes::get))`
11. `POST /api/v1/welcomes/{id}/consume` — Line 545: `.route("/welcomes/{id}/consume", post(routes::welcomes::consume))`

---

### 2. Handler Annotation Status

None of the 11 handlers currently have `#[utoipa::path]` attributes:

- `routes::calls::turn_credentials_handler` (`POST /calls/turn-credentials`) — Absent
- `routes::calls::join_handler` (`POST /rooms/{id}/calls/{call_id}/join`) — Absent
- `routes::calls::leave_handler` (`POST /rooms/{id}/calls/{call_id}/leave`) — Absent
- `routes::calls::signal_handler` (`POST /rooms/{id}/calls/{call_id}/signal`) — Absent
- `routes::calls::end_handler` (`POST /rooms/{id}/calls/{call_id}/end`) — Absent
- `routes::key_packages::upload` (`POST /keypackages`) — Absent
- `routes::key_packages::count` (`GET /keypackages/count`) — Absent
- `routes::key_packages::claim` (`POST /keypackages/claim`) — Absent
- `routes::welcomes::list` (`GET /welcomes`) — Absent
- `routes::welcomes::get` (`GET /welcomes/{id}`) — Absent
- `routes::welcomes::consume` (`POST /welcomes/{id}/consume`) — Absent

---

### 3. OpenAPI Presence

Empirically verified that none of the 11 path keys exist in `docs/openapi.json`.

---

### 4. Request and Response Types per Handler

1. `POST /calls/turn-credentials`: Empty request body. Response `200 OK` with `TurnCredentialsResponse` (`urls: Vec<String>`, `username: String`, `credential: String`, `ttl: u64`).
2. `POST /rooms/{id}/calls/{call_id}/join`: Request `JoinCallRequest` (`client_id: String`), Response `200 OK` with `JoinCallResponse` (`ice_servers: Vec<IceServer>`).
3. `POST /rooms/{id}/calls/{call_id}/leave`: Request `LeaveCallRequest` (`client_id: String`), Response `204 No Content`.
4. `POST /rooms/{id}/calls/{call_id}/signal`: Request `SignalRequest` (`sender_client_id: String`, `target_user_id: String`, `target_client_id: String`, `envelope: String`), Response `200 OK` with `SignalResponse` (`delivered_to: usize`). `envelope` is annotated format: binary with §6.24 reference.
5. `POST /rooms/{id}/calls/{call_id}/end`: Empty request body. Response `200 OK` with `EndCallResponse` (`call_id`, `room_id`, `initiator_id`, `started_at`, `ended_at`).
6. `POST /keypackages`: Request `UploadKeyPackagesRequest` (`packages: Vec<UploadPackageItem>`), Response `201 Created` with `UploadKeyPackagesResponse` (`uploaded: usize`, `unconsumed_count: u32`). `key_package_data` is annotated format: binary with §7.5 reference.
7. `GET /keypackages/count`: Query params none. Response `200 OK` with `UnconsumedCount` (`total: u32`, `by_client: HashMap<String, u32>`).
8. `POST /keypackages/claim`: Request `ClaimKeyPackageRequest` (`user_id: String`), Response `200 OK` with `ClaimKeyPackageResponse` (`id`, `user_id`, `client_id`, `cipher_suite`, `key_package_data`, `is_last_resort`). `key_package_data` is annotated format: binary.
9. `GET /welcomes`: Query params none. Response `200 OK` with `WelcomesListResponse` (`welcomes: Vec<WelcomeView>`).
10. `GET /welcomes/{id}`: Path param `{id}`. Response `200 OK` with `WelcomeDetailResponse` (`id`, `room_id`, `recipient_user_id`, `recipient_client_id`, `created_at`, `consumed`, `welcome_data`). `welcome_data` is JSON base64url string representation of binary welcome data, annotated format: binary.
11. `POST /welcomes/{id}/consume`: Path param `{id}`. Response `200 OK` with `ConsumeWelcomeResponse` (`id`, `room_id`, `consumed`).

---

### 5. ToSchema Derive Status and Registration Needs

- Calls schemas:
  - `TurnCredentialsResponse` (`server/src/calls/turn.rs` -> needs `ToSchema`, register as `TurnCredentialsResponse`)
  - `CallIceServer` (`server/src/calls/turn.rs` -> needs `ToSchema` with `#[schema(as = CallIceServer)]`, register as `CallIceServer` to avoid collision with `crate::sessions::IceServer`)
  - `JoinCallRequest` (`server/src/calls/lifecycle.rs` -> needs `ToSchema`, register as `JoinCallRequest`)
  - `JoinCallResponse` (`server/src/calls/lifecycle.rs` -> needs `ToSchema`, register as `JoinCallResponse`)
  - `LeaveCallRequest` (`server/src/calls/lifecycle.rs` -> needs `ToSchema`, register as `LeaveCallRequest`)
  - `EndCallResponse` (`server/src/calls/lifecycle.rs` -> needs `ToSchema`, register as `EndCallResponse`)
  - `CallSignalRequest` (`server/src/calls/signal.rs` -> needs `ToSchema` with `#[schema(as = CallSignalRequest)]`, register as `CallSignalRequest` to avoid collision with `crate::sessions::SignalRequest`)
  - `CallSignalResponse` (`server/src/calls/signal.rs` -> needs `ToSchema` with `#[schema(as = CallSignalResponse)]`, register as `CallSignalResponse` to avoid collision with `crate::sessions::SignalResponse`)

- Keypackages schemas:
  - `UploadPackageItem` (`server/src/routes/key_packages.rs` -> needs `ToSchema`)
  - `UploadKeyPackagesRequest` (`server/src/routes/key_packages.rs` -> needs `ToSchema`)
  - `UploadKeyPackagesResponse` (`server/src/routes/key_packages.rs` -> needs `ToSchema`)
  - `ClaimKeyPackageRequest` (`server/src/routes/key_packages.rs` -> needs `ToSchema`)
  - `ClaimKeyPackageResponse` (`server/src/routes/key_packages.rs` -> needs `ToSchema`)
  - `UnconsumedCount` (`server/src/key_packages.rs` -> needs `ToSchema`)

- Welcomes schemas:
  - `WelcomesListResponse` (`server/src/routes/welcomes.rs` -> already derives `ToSchema`)
  - `WelcomeDetailResponse` (`server/src/routes/welcomes.rs` -> already derives `ToSchema`)
  - `ConsumeWelcomeResponse` (`server/src/routes/welcomes.rs` -> already derives `ToSchema`)
  - `WelcomeView` (`server/src/welcomes.rs` -> already derives `ToSchema`)

All required schemas will be registered in `ApiDoc` components list in `server/src/openapi.rs`.

---

### 6. Query Parameter Types

- None of the 11 endpoints take query parameter structs.
- `GET /keypackages/count` and `GET /welcomes` take no query parameters.

---

### 7. Ciphertext and Opaque Field Annotations

- Call signal `envelope` in `CallSignalRequest`: `#[schema(format = Binary, description = "Opaque base64url encrypted call signaling envelope (§6.24)")]`.
- Keypackage `key_package_data` in `UploadPackageItem`: `#[schema(format = Binary, description = "Base64url encoded binary MLS KeyPackage (§7.5)")]`.
- Keypackage `key_package_data` in `ClaimKeyPackageResponse`: `#[schema(format = Binary, description = "Base64url encoded binary MLS KeyPackage (§7.5)")]`.
- Welcome `welcome_data` in `WelcomeDetailResponse`: `#[schema(format = Binary, description = "Base64url encoded binary MLS Welcome message (§8.7.2, §7.5)")]`.

---

### 8. Error Codes per Handler

- `POST /calls/turn-credentials`: `401` (`unauthorized`), `429` (`rate_limited`), `501` (`calling_disabled`), `501` (`turn_not_configured`)
- `POST /rooms/{id}/calls/{call_id}/join`: `400` (`invalid_request`), `401` (`unauthorized`), `403` (`client_not_owned`), `404` (`room_not_found`), `409` (`call_ended`, `call_full`, `call_id_conflict`), `501` (`calling_disabled`)
- `POST /rooms/{id}/calls/{call_id}/leave`: `400` (`invalid_request`), `401` (`unauthorized`), `403` (`client_not_owned`), `404` (`room_not_found`), `501` (`calling_disabled`)
- `POST /rooms/{id}/calls/{call_id}/signal`: `400` (`invalid_envelope`, `target_user_mismatch`), `401` (`unauthorized`), `403` (`not_a_participant`, `sender_client_not_owned`), `404` (`call_not_found`, `target_not_found`, `room_not_found`), `429` (`rate_limited`), `501` (`calling_disabled`)
- `POST /rooms/{id}/calls/{call_id}/end`: `401` (`unauthorized`), `403` (`forbidden`), `404` (`call_not_found`, `room_not_found`), `501` (`calling_disabled`)
- `POST /keypackages`: `400` (`empty_batch`, `batch_size_exceeded`, `invalid_client_id`, `invalid_cipher_suite`, `invalid_key_package_data`, `unknown_client_id`), `401` (`unauthorized`), `409` (`limit_reached`)
- `GET /keypackages/count`: `401` (`unauthorized`)
- `POST /keypackages/claim`: `400` (`invalid_request`), `401` (`unauthorized`), `404` (`not_found`), `409` (`consumed`), `429` (`rate_limited`)
- `GET /welcomes`: `400` (`invalid_request`), `401` (`unauthorized`)
- `GET /welcomes/{id}`: `400` (`invalid_request`), `401` (`unauthorized`), `404` (`welcome_not_found`)
- `POST /welcomes/{id}/consume`: `401` (`unauthorized`), `404` (`welcome_not_found`), `409` (`already_consumed`)

---

### 9. Spec References

- Call endpoints: §8.7.3 (`/calls/turn-credentials`), §8.7.5 (`/rooms/{id}/calls/{call_id}/join`), §8.7.6 (`/rooms/{id}/calls/{call_id}/leave`), §8.7.7 & §6.24 (`/rooms/{id}/calls/{call_id}/signal`), §8.7.8 (`/rooms/{id}/calls/{call_id}/end`).
- Keypackage endpoints: §7.5. Keypackage upload, count, and claim endpoints correlate with MLS KeyPackage storage in §7.5.
- Welcome endpoints: §8.7.1 (`GET /welcomes`, `POST /welcomes/{id}/consume`), §8.7.2 (`GET /welcomes/{id}`).

---

### 10. Current Ignored-Test Failure List Subset

Subset of router-only paths missing from OpenAPI for calls, keypackages, and welcomes (11 paths):

1. `/api/v1/calls/turn-credentials`
2. `/api/v1/keypackages`
3. `/api/v1/keypackages/claim`
4. `/api/v1/keypackages/count`
5. `/api/v1/rooms/{id}/calls/{call_id}/end`
6. `/api/v1/rooms/{id}/calls/{call_id}/join`
7. `/api/v1/rooms/{id}/calls/{call_id}/leave`
8. `/api/v1/rooms/{id}/calls/{call_id}/signal`
9. `/api/v1/welcomes`
10. `/api/v1/welcomes/{id}`
11. `/api/v1/welcomes/{id}/consume`

Count before Task C: 20 router-only missing paths.
Expected count after Task C: 9 router-only missing paths (which will be addressed in Task D).

---

### 11. Batch Assignment

- Test file `server/tests/openapi_generation.rs` is registered under the `operations` batch in `server/tests/batch-manifest.toml`.
- All tests for this task are run via `make -C server test-operations`.
