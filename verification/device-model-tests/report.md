# Empirical Verification Report: Device Model Test Coverage

## Executive Summary

This empirical report satisfies Step 0 of the Device Model Test Coverage task. It audits the current test suite state in `server/tests/`, analyzes existing device test coverage, examines event capturing harnesses and login helpers, details transaction rollback patterns, confirms batch assignments in `server/tests/batch-manifest.toml`, and verifies the absence of V2 remnants.

---

## 1. Existing Device Tests

The following tests in `server/tests/` touch devices, device names, device events, or device-related sync:

### `server/tests/devices.rs`
- `test_01_device_is_created_on_first_login`: Asserts first login creates a `devices` row with `user_id`, `client_id`, and a `sessions` row referencing `device_id`.
- `test_02_second_login_with_same_client_id_reuses_device`: Asserts logging in with an existing `client_id` reuses `device_id` and creates a second session.
- `test_03_second_login_with_different_client_id_creates_new_device`: Asserts logging in with a new `client_id` creates a second device.
- `test_04_device_limit_is_enforced`: Asserts attempting to register a 4th device when `server_max_devices_per_user = 3` returns HTTP 400 `device_limit_exceeded`.
- `test_05_get_users_me_devices_lists_all_devices`: Asserts `GET /users/me/devices` lists device objects with `client_id` and boolean `is_current`.
- `test_06_delete_users_me_devices_id_removes_device`: Asserts `DELETE /users/me/devices/:id` revokes target device and invalidates its session tokens.
- `test_07_deleting_current_device_is_rejected`: Asserts revoking the active device returns HTTP 400 `cannot_revoke_current_device`.
- `test_08_cross_user_device_access_returns_404`: Asserts revoking another user's device returns HTTP 404 `device_not_found`.
- `test_09_revocation_cascade_deletes_unconsumed_key_packages`: Asserts revoking a device deletes its unconsumed `key_packages`.
- `test_10_revocation_cascade_queues_mls_removes`: Asserts revoking a device queues rows in `pending_mls_removes`.
- `test_11_revocation_cascade_deletes_sessions`: Asserts revoking a device deletes all associated `sessions`.
- `test_12_encrypted_device_name_is_stored_on_new_devices`: Asserts `encrypted_device_name` provided during login is stored in `device_names`.
- `test_13_missing_encrypted_device_name_stores_null`: Asserts login without `encrypted_device_name` leaves no row / null in `device_names`.
- `test_14_invalid_encrypted_device_name_is_rejected`: Asserts invalid `encrypted_device_name` returns HTTP 400 `invalid_encrypted_device_name`.
- `test_15_devices_schema_has_platform_and_lacks_name`: Asserts `devices` PRAGMA table info contains `platform` and lacks legacy `name`.
- `test_16_login_finish_platform_validation`: Asserts device creation sets `platform = "web"`.
- `test_17_device_revocation`: Asserts basic multi-device revocation flow.
- `test_18_device_name_update`: Asserts `PATCH /users/me/devices/:id` updates `encrypted_device_name`.

### `server/tests/device_name_write.rs`
- `test_device_name_write`: Asserts `PATCH /users/me/devices/:id` writes `device_names` and returns payload with `user_seq` advancing monotonically.

### `server/tests/device_name_sync.rs`
- `test_device_name_sync`: Asserts `GET /users/me/sync` returns `device_state` array carrying `device_id`, `encrypted_device_name`, and `user_seq`.

### `server/tests/device_name_login.rs`
- `test_login_device_name_integration`: Asserts end-to-end integration between login with device names and `GET /users/me/devices`.

### `server/tests/device_name_validation.rs`
- `test_device_name_validation`: Asserts length and base64url format validation rules on `encrypted_device_name`.

### `server/tests/login.rs`
- `test_1_successful_login_with_valid_credentials` through `test_12_session_token_is_not_stored_in_plaintext`: Asserts core OPAQUE login flow, password checking, account disabling, state expiry, identity pubkey binding/mismatch, and session token hashing.

---

## 2. Test Harness for User Channel Events

Events published on user channels (`private-user-{user_id}`) or room channels (`private-room-{room_id}`) are captured in tests using `wiremock::MockServer`.

- **Mock Setup Helper Pattern**:
  ```rust
  async fn setup_test_app_with_sockudo_mock() -> (Router, SqlitePool, MockServer)
  ```
  Found in `server/tests/event_publishing.rs`, `server/tests/room_metadata_events.rs`, `server/tests/pending_adds.rs`, and `server/tests/message_threading.rs`.
- **Wiremock Registration**:
  ```rust
  Mock::given(method("POST"))
      .and(path("/apps/chat/events"))
      .respond_with(ResponseTemplate::new(200).set_body_json(json!({"ok": true})))
      .mount(&mock_server)
      .await;
  ```
- **Capturing Requests**:
  ```rust
  let requests = mock_server.received_requests().await.unwrap();
  ```
- **Parsing Event Payload**:
  ```rust
  let body_json: Value = serde_json::from_slice(&req.body).unwrap();
  assert_eq!(body_json["name"], "device.added"); // or "device.revoked", "device.name_updated"
  assert_eq!(body_json["channels"], json!([format!("private-user-{}", user_id)]));

  let data_str = body_json["data"].as_str().unwrap();
  let data_json: Value = serde_json::from_str(data_str).unwrap();
  ```
  `data_json` carries the `UserEventEnvelope` payload `{ event_type, user_seq, payload }` or inner payload fields.

---

## 3. Test Harness for `login_start` / `login_finish`

Login request helpers are defined in `server/tests/common/mod.rs`:

- **Helper Signatures**:
  ```rust
  pub async fn login_user(
      app: &Router,
      username: &str,
      password: &str,
      client_id: &str,
      identity_pubkey: Option<&str>,
  ) -> (StatusCode, Value)

  pub async fn login_user_with_device_name(
      app: &Router,
      username: &str,
      password: &str,
      client_id: &str,
      identity_pubkey: Option<&str>,
      encrypted_device_name: Option<&str>,
  ) -> (StatusCode, Value)
  ```
- **Direct HTTP Request Construction**:
  For testing validation rejections at `login_start` (e.g. invalid or missing `platform`), requests build a raw Axum `Request`:
  ```rust
  let req = Request::builder()
      .method("POST")
      .uri("/api/v1/auth/login/start")
      .header(header::CONTENT_TYPE, "application/json")
      .body(Body::from(json!({
          "username_token": username_token,
          "credential_request": cred_req_b64,
          "client_id": client_id,
          "platform": "windows", // or missing / empty
      }).to_string()))
      .unwrap();
  let resp = app.clone().oneshot(req).await.unwrap();
  ```

---

## 4. Test Harness for Rolled-Back Transactions

- **Existing Rollback Pattern**:
  In `server/tests/event_publishing.rs` (`test_10_no_publish_when_transaction_fails`), a request with an invalid parameter (`epoch: 999`) causes the transaction to fail and roll back, asserting zero Sockudo event requests were published.
- **`user_seq` Atomicity Assessment**:
  In `login_finish` and `revoke_device`, `allocate_user_seq(&mut tx, ...)` is called directly before `tx.commit().await?` within a single write transaction. There are no user-controlled parameters or fallible statements after `allocate_user_seq` prior to `tx.commit()`.
- **Limitation & Fallback Strategy**:
  Because production code contains no test hooks/failpoints to interrupt a transaction after `allocate_user_seq` but before `tx.commit()`, tests 6 and 7 cannot force a transaction rollback at that precise boundary without modifying production code. Per task instructions, tests 6 and 7 will be implemented as `#[ignore]` with comments explaining the missing test hook requirement, ensuring production code remains untouched.

---

## 5. Test Harness for `user_seq` Inspection

Reading `user_seq` directly from the database pool uses:

```rust
let user_seq: Option<i64> = sqlx::query_scalar("SELECT next_seq FROM user_seq WHERE user_id = ?")
    .bind(&user_id)
    .fetch_optional(&pool)
    .await
    .unwrap();
```
- `next_seq` represents the sequence counter value for the *next* allocation.
- The highest sequence allocated so far is `next_seq - 1`. If no sequence has been allocated for the user yet, `fetch_optional` returns `None` or `next_seq` is uncreated.

---

## 6. Batch Assignments

Test files receiving new tests and their batch assignments in `server/tests/batch-manifest.toml`:

- **`server/tests/devices.rs`**: Batch `auth`
- **`server/tests/login.rs`**: Batch `auth`

Batch command to verify: `make test-auth` (or running `cargo test --test devices` / `cargo test --test login`).

---

## 7. V2 Remnants

- Search for legacy `device.sync` event in `server/tests/`: **0 matches found**.
- Search for legacy `devices.name` column in `server/tests/`: **0 matches found**.
- Search for `LoginFinishRequest` platform references: **0 legacy occurrences found**.

Zero V2 device event or schema remnants exist in the test suite.
