# Step 0 — Empirical Verification Report: Runtime Response vs. OpenAPI Schema Contract Test

## 1. Current Test Harness Analysis
A review of `server/tests/common/mod.rs` reveals the existing test harness capabilities:
- **App Boot**: `setup_test_app()` and `setup_test_app_with_custom_config()` build an `AppState` and construct the Axum `Router` using `server::build_app(state)`.
- **Database Creation**: `setup_test_db()` or test app setups connect to an in-memory SQLite database (`sqlite::memory:` or temporary SQLite file) and execute all migrations (`sqlx::migrate!("./migrations")`).
- **User Registration & Login**: `register_user(app, username, password, invite_code)` executes OPRF challenge, start, and finish steps, inserting user rows. `login_user(...)` completes OPRF login and returns session token in response. `create_test_user_and_session(app, pool)` directly inserts a user record and creates a session token via `server::session::create_session`.
- **Authenticated Requests**: Requests are constructed via `axum::http::Request::builder()` with `Authorization: Bearer <session_token>` (or `Bearer <bot_token>`) and executed against the router using `app.clone().oneshot(req).await`.

## 2. OpenAPI Accessor
- `ApiDoc::openapi()` in `server::openapi::ApiDoc` returns `utoipa::openapi::OpenApi`.
- In test code, `serde_json::to_value(ApiDoc::openapi()).unwrap()` converts the live OpenAPI document into a `serde_json::Value` DOM for schema navigation and validation.

## 3. Schema Validator Crate Evaluation
- **Cargo.toml Status**: `jsonschema` is not currently in `server/Cargo.toml`.
- **Recommendation**: Add `jsonschema = "0.29"` (or compatible version) to `[dev-dependencies]` in `server/Cargo.toml`.
- **License Compatibility**: `jsonschema` is dual-licensed under MIT / Apache-2.0, fully compatible with the project's AGPL 3.0 license.
- **Validation Approach**: Using `jsonschema::options().with_document(&full_openapi_doc).build(&schema)` or resolving `$ref` pointers directly against `#/components/schemas/<Name>` allows validating runtime `serde_json::Value` responses against OpenAPI 3.1 JSON Schemas.

## 4. Endpoint Inventory for Initial Set
12 endpoints selected covering diverse response shapes and authentication modes:
1. `GET /api/v1/capabilities` (unauth, rich object `CapabilitiesResponse`)
2. `GET /api/v1/users/me` (auth, single object `UserProfileResponse`)
3. `GET /api/v1/users/me/sync?since_seq=0` (auth, object with arrays `SyncResponse`)
4. `GET /api/v1/rooms` (auth, array of `RoomView`)
5. `GET /api/v1/rooms/{id}` (auth, single object `RoomView`)
6. `GET /api/v1/rooms/{id}/members` (auth, discriminated union list `RoomMemberItem`)
7. `GET /api/v1/rooms/{id}/messages` (auth, array of `RoomMessageItem`)
8. `GET /api/v1/bots/{id}` (auth, single object with optional fields `BotView`)
9. `GET /api/v1/bots/me/settings` (bot token auth, list `GetBotSettingsMeResp`)
10. `GET /api/v1/kt/user/{id}` (auth, nested object `UserKtResponse`)
11. `GET /api/v1/kt/bot/{id}` (auth, nested object `BotKtResponse`)
12. `GET /api/v1/kt/snapshot` (auth, object `KtSnapshotResponse`)

## 5. Fixture Requirements
- **Shared Fixture Strategy**: A single shared setup helper (`setup_contract_test_fixture`) boots the app and initializes:
  - User Alice + Session Token
  - User Bob + Session Token (joined to Alice's room)
  - Room (created by Alice)
  - Message (posted in room)
  - Bot (created by Alice, granted to room) + Bot Token
  - Key Transparency entries for Alice and Bot + KT Snapshot
- All 12 endpoints execute read operations against this shared fixture state.

## 6. Error Response Handling
- Shared schema: `ErrorResponse` (`{ "error": "code", "message": "..." }`) registered under `#/components/schemas/ErrorResponse`.
- `test_error_responses_match_openapi_schemas` validates 3-5 error cases (e.g., 401 Unauthorized, 404 Not Found) against `ErrorResponse`.

## 7. Response Content Types
- All 12 chosen endpoints return `application/json; charset=utf-8`.
- Binary and multipart endpoints are excluded from this initial set.

## 8. Schema Extraction Method
- Helper function `extract_response_schema(doc, path, method, status_code)` navigates `doc["paths"][path][method]["responses"][status_code]["content"]["application/json"]["schema"]`.
- Resolves `$ref` pointers (e.g. `#/components/schemas/UserProfileResponse`) against `doc["components"]["schemas"]`.
- dereferences and constructs a `jsonschema::JSONSchema` validator instance.

## 9. Batch Assignment
- File: `server/tests/contract_test.rs`.
- Registered under the `operations` batch in `server/tests/batch-manifest.toml`.
- Expected execution time is ~1–3s, well within the 60s timeout budget.

## 10. Prior Art Findings
- Searched `server/tests/`. `openapi_generation.rs` verifies OpenAPI document structure and router registrations, but no runtime HTTP response body schema validation existed prior to this task.
