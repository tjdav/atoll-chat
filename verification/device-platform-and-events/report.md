# Empirical Verification Report: Device Platform & Event Publishing Baseline

## Executive Summary

This report documents the empirical audit of the repository state prior to implementing Phase 5 (Device Model Implementation) of the V3 Server Specification (`server-spec-v3.md`). It addresses schema baseline, endpoint signatures, event publishing infrastructure, test fixtures, and V2 remnants.

---

## Technical Audit Findings

### 1. Current `devices` Table Schema

The baseline migration file (`server/migrations/0001_v2_schema.sql`) defines `devices` as:

```sql
CREATE TABLE IF NOT EXISTS devices (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    client_id   TEXT NOT NULL UNIQUE,
    platform    TEXT NOT NULL CHECK(platform IN ('web', 'ios', 'android', 'desktop')),
    last_seen   DATETIME,
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_devices_user ON devices(user_id);
```

- **Confirmation**: `platform` column with `CHECK(platform IN ('web', 'ios', 'android', 'desktop'))` constraint is present.
- **Confirmation**: The legacy `name` column is absent from `0001_v2_schema.sql`.

---

### 2. Current `create_device` Signature and INSERT Statement

Located in `server/src/devices.rs`:

```rust
pub async fn create_device(
    pool: &SqlitePool,
    user_id: &str,
    client_id: &str,
    platform: &str,
) -> Result<Device, DeviceError>
```

INSERT statement:

```sql
INSERT INTO devices (id, user_id, client_id, platform)
VALUES (?, ?, ?, ?)
```

- **Confirmation**: `platform` is present in both `create_device` signature and its SQL query.

---

### 3. Current `LoginStartRequest` and `PendingLogin`

Located in `server/src/routes/login.rs`:

```rust
#[derive(Debug, Deserialize)]
pub struct LoginStartRequest {
    pub lookup_token: Option<String>,
    pub username_token: Option<String>,
    pub credential_request: String,
    pub client_id: String,
    pub platform: Option<String>,
}
```

Located in `server/src/login.rs`:

```rust
pub struct PendingLogin {
    pub user_id: String,
    pub username_token: String,
    pub encrypted_display: Option<String>,
    pub client_id: String,
    pub platform: String,
    pub server_login_state: ServerLogin<DefaultCipherSuite>,
    pub created_at: Instant,
}
```

- **Confirmation**: `client_id` and `platform` are present in both `LoginStartRequest` and `PendingLogin`.

---

### 4. Current `LoginFinishRequest`

Located in `server/src/routes/login.rs`:

```rust
#[derive(Debug, Deserialize)]
pub struct LoginFinishRequest {
    pub login_id: String,
    pub credential_finalization: String,
    pub identity_pubkey: Option<String>,
    pub encrypted_device_name: Option<String>,
}
```

- **Confirmation**: `platform` is absent from `LoginFinishRequest`.

---

### 5. Current `write_device_name` Publish Site

Located in `server/src/sync/device_names.rs`:

```rust
let payload = serde_json::json!({
    "device_id": row.device_id,
    "encrypted_device_name": row.encrypted_device_name,
    "user_seq": row.user_seq,
});
let envelope = UserEventEnvelope::new("device.name_updated", row.user_seq, payload);
if let Err(e) = publish_user_event(publisher, &req.user_id, &envelope).await {
    tracing::warn!(error = %e, user_id = %req.user_id, "device.name_updated publish failed");
}
```

- **Confirmation**: Event name is `"device.name_updated"`.
- **Confirmation**: Payload is `{ "device_id": ..., "encrypted_device_name": ..., "user_seq": ... }`.

---

### 6. Current Device Creation Site

Located in `server/src/routes/login.rs` inside `login_finish`:

```rust
let payload = serde_json::json!({
    "device_id": dev_id,
    "platform": pending.platform,
    "added_at": added_at,
    "user_seq": user_seq,
});
let envelope = crate::sync::UserEventEnvelope::new("device.added", user_seq, payload);
if let Err(e) = crate::sync::publish_user_event(&state.publisher, &pending.user_id, &envelope).await {
    tracing::warn!(error = %e, user_id = %pending.user_id, "device.added publish failed");
}
```

- **Confirmation**: Device creation runs inside `login_finish` using `pending.platform` and publishes `device.added`.

---

### 7. Current Device Deletion Site

Located in `server/src/routes/devices.rs` (`revoke` handler) delegating to `crate::devices::revoke_device` in `server/src/devices.rs`:

```rust
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

- **Confirmation**: `revoke_device` allocates `user_seq` inside the deletion transaction and publishes `device.revoked` post-commit.

---

### 8. Event Publisher Search

- **`device.added`**: Published in `server/src/routes/login.rs`.
- **`device.revoked`**: Published in `server/src/devices.rs`.
- **`device.name_updated`**: Published in `server/src/sync/device_names.rs`.
- **`device.sync`**: Zero references found in `server/src/`.

---

### 9. Test Fixtures Inserting into `devices`

Every direct `INSERT INTO devices` statement in `server/tests/`:

- `server/tests/sync_contract.rs:309`: `INSERT INTO devices (id, user_id, client_id, platform) VALUES ('d999', 'u_prune', 'c999', 'web')`
- `server/tests/identity_schema.rs:47`: `INSERT INTO devices (id, user_id, client_id, platform) VALUES ('dev_1', 'user_1', 'client_1', 'web')`
- `server/tests/cleanup.rs:459`: `INSERT INTO devices (id, user_id, client_id, platform) VALUES ('d_sync', 'u_sync', 'c_sync', 'web')`
- `server/tests/cleanup.rs:465`: `INSERT INTO devices (id, user_id, client_id, platform) VALUES ('d_sync_recent', 'u_sync', 'c_sync_recent', 'web')`
- `server/tests/cleanup.rs:684`: `INSERT INTO devices (id, user_id, client_id, platform) VALUES ('d_noseq', 'u_no_seq', 'c_noseq', 'web')`
- `server/tests/push_delivery.rs:263`: `INSERT INTO devices (id, user_id, client_id, platform) VALUES ('dev-b', 'user-b', 'client-b', 'web')`

- **Confirmation**: All test fixtures in `server/tests/` include `platform` in their column lists.

---

### 10. V2 Remnants

- **`devices.name`**: Zero references found in `server/src/`.
- **Summary**: All legacy V2 column references have been removed.
