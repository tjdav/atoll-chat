# Empirical Verification Report: Device Model Implementation

## Executive Summary

This report completes Step 0 empirical verification for the Device Model Implementation task. It records the current exact database schema, function signatures, structs, and publisher behavior in the codebase before any changes are made, confirming the four gaps identified in the task prompt and verifying that no V2 remnants exist that would break on replacing the legacy `devices.name` column with `platform`.

---

## Technical Audit & Verification Answers

### 1. Current `devices` Table Schema

The baseline schema migration (`server/migrations/0001_v2_schema.sql`) contains:

```sql
CREATE TABLE IF NOT EXISTS devices (
    id        TEXT PRIMARY KEY,
    user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    client_id TEXT NOT NULL UNIQUE,
    name      TEXT,
    last_seen DATETIME,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_devices_user ON devices(user_id);
```

- **Legacy `name` column**: Present (`name TEXT`).
- **`platform` column**: Absent.

---

### 2. Current `create_device` Function

In `server/src/devices.rs`:

```rust
pub async fn create_device(
    pool: &SqlitePool,
    user_id: &str,
    client_id: &str,
) -> Result<Device, DeviceError> {
    let mut id_bytes = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut id_bytes);
    let device_id = URL_SAFE_NO_PAD.encode(id_bytes);

    sqlx::query(
        r#"
        INSERT INTO devices (id, user_id, client_id)
        VALUES (?, ?, ?)
        "#,
    )
    .bind(&device_id)
    .bind(user_id)
    .bind(client_id)
    .execute(pool)
    .await?;

    let row = sqlx::query(
        r#"
        SELECT d.id, d.user_id, d.client_id, dn.encrypted_device_name, d.last_seen, d.created_at
        FROM devices d
        LEFT JOIN device_names dn
            ON d.id = dn.device_id AND d.user_id = dn.user_id AND dn.deleted_at IS NULL
        WHERE d.id = ?
        "#,
    )
    .bind(&device_id)
    .fetch_one(pool)
    .await?;

    Ok(Device {
        id: row.get("id"),
        user_id: row.get("user_id"),
        client_id: row.get("client_id"),
        encrypted_device_name: row.get("encrypted_device_name"),
        last_seen: row.get("last_seen"),
        created_at: row.get("created_at"),
    })
}
```

- **Signature**: `pub async fn create_device(pool: &SqlitePool, user_id: &str, client_id: &str) -> Result<Device, DeviceError>`
- **INSERT statement**: `INSERT INTO devices (id, user_id, client_id) VALUES (?, ?, ?)`
- **`platform` setting**: Confirmed absent.

---

### 3. Current `LoginFinishRequest` Struct

In `server/src/routes/login.rs`:

```rust
#[derive(Debug, Deserialize)]
pub struct LoginFinishRequest {
    pub login_id: String,
    pub credential_finalization: String,
    pub identity_pubkey: Option<String>,
    pub encrypted_device_name: Option<String>,
}
```

- **Fields**: `login_id`, `credential_finalization`, `identity_pubkey`, `encrypted_device_name`.
- **`platform` field**: Confirmed absent. Note: `platform` is passed during `LoginStartRequest` or `LoginFinishRequest`. In `LoginStartRequest`, `client_id` is passed (`pub client_id: String`). In `PendingLogin`, `client_id` is stored. Adding `platform` to `LoginFinishRequest` or `LoginStartRequest`/`PendingLogin` allows `platform` to be stored upon device creation during `login_finish`.

---

### 4. Current `write_device_name` Publisher

In `server/src/sync/device_names.rs`:

```rust
    // 5. Publish device.sync event post-commit
    let payload = serde_json::json!({
        "device_id": row.device_id,
        "user_seq": row.user_seq,
    });
    let envelope = UserEventEnvelope::new("device.sync", row.user_seq, payload);
    if let Err(e) = publisher.publish_user(&req.user_id, envelope).await {
        tracing::warn!(error = %e, user_id = %req.user_id, "device.sync publish failed");
    }
```

- **Event Name**: `"device.sync"`
- **Payload**: `{ "device_id": row.device_id, "user_seq": row.user_seq }`
- **Spec requirement (§8.9)**: Event name `"device.name_updated"` with payload `{ device_id, encrypted_device_name, user_seq }`.

---

### 5. Current Device Creation Site

In `server/src/routes/login.rs` (`login_finish` handler):

```rust
    let device_id = match existing_device {
        Some(dev) => {
            let _ = crate::devices::touch_last_seen(&state.pool, &dev.id).await;
            dev.id
        }
        None => {
            let count = crate::devices::count_devices(&state.pool, &pending.user_id).await?;
            if count >= state.config.server_max_devices_per_user {
                return Err(ApiError::BadRequest("device_limit_exceeded".to_string()));
            }
            let new_dev =
                crate::devices::create_device(&state.pool, &pending.user_id, &pending.client_id)
                    .await?;
            new_dev.id
        }
    };
```

- **Site**: `POST /auth/login/finish` (`login_finish` function).
- **Behavior**: Calls `create_device` when `existing_device` is `None`. Does not publish `device.added`.

---

### 6. Current Device Deletion Site

In `server/src/routes/devices.rs` (`revoke` handler):

```rust
pub async fn revoke(
    State(state): State<AppState>,
    Path(target_device_id): Path<String>,
    auth: AuthUser,
) -> Result<impl IntoResponse, ApiError> {
    if target_device_id == auth.device_id {
        return Err(ApiError::BadRequest("cannot_revoke_current_device".to_string()));
    }

    devices::revoke_device(&state.pool, &auth.user_id, &target_device_id).await?;

    state
        .audit
        .log(&auth.user_id, audit::DEVICE_REVOKE, json!({ "target_device_id": target_device_id }))
        .await;

    Ok(StatusCode::NO_CONTENT)
}
```

- **Site**: `DELETE /users/me/devices/:id` (`routes::devices::revoke`).
- **Behavior**: Calls `devices::revoke_device`, logs audit entry, returns `204 NO_CONTENT`. Does not publish `device.revoked`.

---

### 7. Current `device.added`, `device.revoked`, `device.name_updated` Publishers

- Search for `device.added` in `server/src/`: **0 results**.
- Search for `device.revoked` in `server/src/`: **0 results**.
- Search for `device.name_updated` in `server/src/`: **0 results**.
- Search for `device.sync` in `server/src/`: Found in `server/src/sync/device_names.rs`.

---

### 8. Current `platform` Handling

- Search for `platform` in `server/src/`: Found in push native (`push_apns`, `push_fcm`), but **0 results for device platform**.

---

### 9. V2 Remnants Audit

- No code in `server/src/` reads `devices.name`.
- `devices.name` column exists only in `server/migrations/0001_v2_schema.sql`.
- Direct `INSERT INTO devices` in test fixtures (`server/tests/sync_contract.rs`, `server/tests/identity_schema.rs`, `server/tests/cleanup.rs`, `server/tests/push_delivery.rs`, `server/tests/push_suppression.rs`) specify `(id, user_id, client_id)`. Adding `platform` as `NOT NULL` will require updating these test `INSERT` statements to include `platform` (e.g. `'web'`).

---

## Summary & Readiness

All nine empirical verification questions are answered. The findings confirm all assumptions and gaps stated in the prompt. We are ready to proceed with implementation planning.
