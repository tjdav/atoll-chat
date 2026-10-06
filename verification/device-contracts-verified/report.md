# Verification Report: Device Model Behavioral Contracts

## Executive Summary

This report documents the behavioral contract verification for Phase 5 (Device Model Implementation) of the V3 Server Specification (`server-spec-v3.md`). Building upon the baseline findings in `verification/device-platform-and-events/report.md`, this task audited the remaining runtime behavioral invariants: `platform` validation, `user_seq` transaction atomicity, event publish timing, event payload shapes, `GET /users/me/sync` response contracts, test coverage, and V2 legacy code remnants.

---

## Technical Audit Findings

### a. `platform` Validation at `login_start`

- **Code Path**: Handled in `server/src/routes/login.rs` inside the `login_start` endpoint function (lines 104–118).
- **Validation Mechanics**:
  ```rust
  let platform_input = body
      .platform
      .as_deref()
      .map(|s| s.trim())
      .filter(|s| !s.is_empty());

  let platform = match platform_input {
      Some("web") | Some("ios") | Some("android") | Some("desktop") => {
          platform_input.unwrap().to_string()
      }
      _ => return Err(ApiError::BadRequest("invalid_platform".to_string())),
  };
  ```
- **Verification Criteria**:
  1. **Request with `client_id` present and `platform` absent/null/empty**: `platform_input` evaluates to `None`, matching `_` and returning HTTP 400 `invalid_platform`.
  2. **Request with `platform` set to invalid value (e.g. `"windows"`)**: `platform_input` evaluates to `Some("windows")`, matching `_` and returning HTTP 400 `invalid_platform`.
  3. **Request with valid `platform` (`"web"`, `"ios"`, `"android"`, `"desktop"`)**: Binds `platform` string, stores it on `PendingLogin`, and proceeds with login handshake.
- **Contract Status**: **Verified**. All validation invariants are enforced in production code.

---

### b. `device.added` Sequence Atomicity

- **Code Path**: Handled in `server/src/routes/login.rs` inside the `login_finish` endpoint function (lines 310–349).
- **Transaction Boundaries**:
  ```rust
  let mut tx = state.pool.begin().await?;

  sqlx::query(
      r#"
      INSERT INTO devices (id, user_id, client_id, platform)
      VALUES (?, ?, ?, ?)
      "#,
  )
  .bind(&dev_id)
  .bind(&pending.user_id)
  .bind(&pending.client_id)
  .bind(&pending.platform)
  .execute(&mut *tx)
  .await?;

  let user_seq = crate::sync::allocate_user_seq(&mut tx, &pending.user_id)
      .await
      .map_err(|e| {
          ApiError::InternalCustom(StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
      })?;

  tx.commit().await?;
  ```
- **Atomicity Assessment**: `allocate_user_seq` takes `&mut tx` and executes inside the exact same transaction as the `INSERT INTO devices`. If the device creation fails or rolls back before `tx.commit()`, SQLite rolls back the entire transaction, leaving `user_seq.next_seq` unconsumed and unchanged.
- **Contract Status**: **Verified**.
- **Test Gap**: No integration test exists in `server/tests/` asserting that a rolled-back device creation does not advance `user_seq`.

---

### c. `device.revoked` Sequence Atomicity

- **Code Path**: Handled in `server/src/devices.rs` inside the `revoke_device` function (lines 173–237).
- **Transaction Boundaries**:
  ```rust
  let mut tx = pool.begin().await?;

  // 1. Look up device...
  // 2. Delete unconsumed KeyPackages...
  // 3. Queue MLS Removes...
  // 4. Delete push subscriptions...

  // 5. Allocate user_seq for device.revoked event
  let user_seq = crate::sync::allocate_user_seq(&mut tx, user_id)
      .await
      .map_err(|e| DeviceError::Database(sqlx::Error::Protocol(e.to_string())))?;

  // 6. Delete device row
  sqlx::query("DELETE FROM devices WHERE id = ? AND user_id = ?")
      .bind(device_id)
      .bind(user_id)
      .execute(&mut *tx)
      .await?;

  tx.commit().await?;
  ```
- **Atomicity Assessment**: `allocate_user_seq` executes using `&mut tx` inside the same transaction as the deletion of key packages, pending MLS removes, push subscriptions, and the `devices` row. If revocation fails or is rolled back, `user_seq.next_seq` remains unchanged.
- **Contract Status**: **Verified**.
- **Test Gap**: No integration test exists in `server/tests/` asserting that a rolled-back revocation does not advance `user_seq`.

---

### d. `device.added` Event Publish Timing

- **Code Path**: Handled in `server/src/routes/login.rs` (lines 349–360).
- **Execution Order**:
  ```rust
  tx.commit().await?;

  let payload = serde_json::json!({
      "device_id": dev_id,
      "platform": pending.platform,
      "added_at": added_at,
      "user_seq": user_seq,
  });
  let envelope = crate::sync::UserEventEnvelope::new("device.added", user_seq, payload);
  if let Err(e) =
      crate::sync::publish_user_event(&state.publisher, &pending.user_id, &envelope).await
  {
      tracing::warn!(error = %e, user_id = %pending.user_id, "device.added publish failed");
  }
  ```
- **Publish Timing**: `publish_user_event` is called **after** `tx.commit().await?`. Subscribers can never observe a `device.added` event for a device insert that is subsequently rolled back.
- **Contract Status**: **Verified**.

---

### e. `device.revoked` Event Publish Timing

- **Code Path**: Handled in `server/src/devices.rs` (lines 237–247).
- **Execution Order**:
  ```rust
  tx.commit().await?;

  let payload = serde_json::json!({
      "device_id": device_id,
      "reason": "revoked_by_user",
      "user_seq": user_seq,
  });
  let envelope = crate::sync::UserEventEnvelope::new("device.revoked", user_seq, payload);
  if let Err(e) = crate::sync::publish_user_event(publisher, user_id, &envelope).await {
      tracing::warn!(error = %e, user_id = %user_id, "device.revoked publish failed");
  }
  ```
- **Publish Timing**: `publish_user_event` is called **after** `tx.commit().await?`. Subscribers can never observe a `device.revoked` event for a revocation that is subsequently rolled back.
- **Contract Status**: **Verified**.

---

### f. `device.name_updated` Payload and Legacy Event Search

- **Code Path**: Handled in `server/src/sync/device_names.rs` in function `write_device_name` (lines 95–105).
- **Event Name & Payload**:
  ```rust
  let payload = serde_json::json!({
      "device_id": row.device_id,
      "encrypted_device_name": row.encrypted_device_name,
      "user_seq": row.user_seq,
  });
  let envelope = UserEventEnvelope::new("device.name_updated", row.user_seq, payload);
  ```
  - **Event Name**: `"device.name_updated"`.
  - **Payload**: Exactly `{ "device_id": String, "encrypted_device_name": String, "user_seq": i64 }`.
- **Legacy Event Search (`device.sync`)**:
  - `grep -rn "device.sync" server/src/` returned zero matches.
- **Contract Status**: **Verified**. Payload strictly matches V3 §8.9. No `device.sync` remnants exist.

---

### g. Comprehensive Test Coverage Audit

| Test Item | Status | Citation / Note |
|---|---|---|
| `device.added` shape assertion (`{ device_id, platform, added_at, user_seq }`) | **MISSING** | No test in `server/tests/` asserts the published `device.added` event payload over Sockudo. |
| `device.revoked` shape assertion (`{ device_id, reason: "revoked_by_user", user_seq }`) | **MISSING** | No test in `server/tests/` asserts the published `device.revoked` event payload over Sockudo. |
| `device.name_updated` shape assertion (`{ device_id, encrypted_device_name, user_seq }`) | **MISSING** | No test in `server/tests/` asserts the published `device.name_updated` event payload over Sockudo. |
| `platform` validation: invalid value rejected | **MISSING** | No test in `server/tests/` sends invalid `platform` to `login_start` and asserts HTTP 400 `invalid_platform`. (`push_subscriptions.rs` tests push endpoints only). |
| `platform` validation: missing value rejected | **MISSING** | No test in `server/tests/` sends `login_start` with missing `platform` when `client_id` is present and asserts HTTP 400 `invalid_platform`. |
| Rolled-back device creation does not consume a seq | **MISSING** | No test in `server/tests/` asserts that a failed/rolled-back device creation leaves `user_seq` unadvanced. |
| Rolled-back revocation does not consume a seq | **MISSING** | No test in `server/tests/` asserts that a failed/rolled-back revocation leaves `user_seq` unadvanced. |
| `device_state` in `GET /users/me/sync` unchanged in shape | **PRESENT** | `server/tests/device_name_sync.rs` (`test_device_name_sync`) asserts `device_state` elements carry `device_id`, `encrypted_device_name`, `user_seq`. |

---

### h. `device_state` Sync Response Contract

- **Code Path**: Defined in `server/src/sync/query.rs` and `server/src/sync/device_names.rs`.
- **Response Array**: `device_state` in `SyncResponse` struct (`server/src/sync/query.rs`: line 41).
- **Element Shape (`DeviceStateRow`)**:
  - `device_id`: `String`
  - `encrypted_device_name`: `String`
  - `user_seq`: `i64`
  - `updated_at`: `DateTime<Utc>` (serialized to ISO 8601 string)
  - `deleted_at`: `Option<DateTime<Utc>>` (`null` or ISO 8601 string)
- **Contract Status**: **Verified**. Unchanged from Phase 3 baseline contract.

---

### i. V2 Legacy Code Remnants Search

The following searches were performed across all source files under `server/src/`:

1. `grep -rn "devices.name" server/src/` -> 0 results (**CLEAN**)
2. `grep -rn "device.sync" server/src/` -> 0 results (**CLEAN**)
3. `grep -rn "LoginFinishRequest" server/src/ | grep -i "platform"` -> 0 results (**CLEAN**)

- **Contract Status**: **Verified**. Zero legacy V2 column/event/field references remain in application code.

---

## Conclusion & Summary of Gaps

All runtime behavioral contracts defined in V3 Server Specification §6.21, §6.22, §7.1, §8.2, §8.9, and §8.10 are **fully implemented and verified** in application source code.

However, seven test coverage gaps were identified:
1. Missing `device.added` event payload shape assertion test.
2. Missing `device.revoked` event payload shape assertion test.
3. Missing `device.name_updated` event payload shape assertion test.
4. Missing `login_start` invalid `platform` rejection test.
5. Missing `login_start` missing `platform` rejection test.
6. Missing rolled-back device creation `user_seq` atomicity test.
7. Missing rolled-back device revocation `user_seq` atomicity test.

These gaps do not block Phase 6 (Room metadata with encrypted blob) since all runtime server contracts are satisfied. The test gaps are recorded as follow-up items in `task-ledger.md`.
