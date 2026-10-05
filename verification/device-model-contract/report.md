# Verification Report: Device Model Contract and Endpoint Surface

## Executive Summary

This report verifies the current state of the device model and endpoint surface in the repository against the V3 Server Specification (`server-spec-v3.md`). It addresses schema conformance, endpoint implementations, live event publishing, sync state payload structures, device registration mechanisms, spec omissions, and legacy V2 remnants.

Specifically, it resolves the spec gap regarding device name updates by providing a concrete, minimal endpoint proposal (`PATCH /users/me/devices/:id`) aligned with V3 §6.21, §7.1, §7.2, §8.2, and §8.9.

---

## Technical Audit & Verification Answers

### a. Current `devices` Table Schema

The baseline schema migration (`server/migrations/0001_v2_schema.sql`) defines the `devices` table as follows:

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

#### Comparison against V3 Spec §7.1

V3 Spec §7.1 specifies the following schema:

```sql
CREATE TABLE devices (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    client_id   TEXT NOT NULL UNIQUE,
    platform    TEXT NOT NULL CHECK(platform IN ('web', 'ios', 'android', 'desktop')),
    last_seen   DATETIME,
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

#### Delta Analysis

1. **Missing `platform` Column**: The current table lacks the `platform` column and its associated `CHECK(platform IN ('web', 'ios', 'android', 'desktop'))` constraint.
2. **Extra Legacy `name` Column**: The current table contains a legacy `name` column. In V3, device names are stored encrypted in the separate `device_names` sync table.

---

### b. Current `device_names` Table Schema

The baseline schema migration (`server/migrations/0001_v2_schema.sql`) defines the `device_names` table as follows:

```sql
CREATE TABLE IF NOT EXISTS device_names (
    user_id               TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_id             TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    encrypted_device_name TEXT NOT NULL,
    user_seq              INTEGER NOT NULL,
    updated_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at            DATETIME,
    PRIMARY KEY (user_id, device_id)
);
CREATE INDEX IF NOT EXISTS idx_device_names_seq ON device_names(user_id, user_seq);
```

#### Comparison against V3 Spec §7.2

- **Spec Conformance**: The current `device_names` schema matches V3 Spec §7.2 exactly.
- **Key Columns Confirmed**:
  - `user_seq`: Present (`INTEGER NOT NULL`), supporting sequence-based user sync.
  - `deleted_at`: Present (`DATETIME`), supporting tombstone tracking and cleanup/pruning.

---

### c. Current Device-Related Endpoints

The codebase implements device routes in `server/src/routes/devices.rs` (registered in `server/src/lib.rs`):

#### 1. `GET /users/me/devices`
- **Method**: `GET`
- **Path**: `/users/me/devices`
- **Auth**: Required (Bearer token).
- **Request Shape**: Empty body.
- **Response Shape (200 OK)**:
  ```json
  {
    "devices": [
      {
        "id": "dev_...",
        "client_id": "c_...",
        "encrypted_device_name": "<base64url or null>",
        "created_at": "2026-03-30T12:00:00Z",
        "last_seen": "2026-03-30T12:05:00Z",
        "is_current": true
      }
    ]
  }
  ```
- **Implementation Status**: Implemented (`routes::devices::list`). Left-joins `devices` with `device_names` (`WHERE deleted_at IS NULL`) to attach `encrypted_device_name`.

#### 2. `PATCH /users/me/devices/:id`
- **Method**: `PATCH`
- **Path**: `/users/me/devices/{id}`
- **Auth**: Required (Bearer token).
- **Request Body**:
  ```json
  {
    "encrypted_device_name": "<base64url, 28–284 bytes decoded>"
  }
  ```
- **Response Shape (200 OK)**:
  ```json
  {
    "device_id": "dev_...",
    "encrypted_device_name": "<base64url>",
    "user_seq": 42,
    "updated_at": "2026-03-30T12:00:00Z",
    "deleted_at": null
  }
  ```
- **Headers**: `Cache-Control: no-store`.
- **Implementation Status**: Implemented (`routes::devices::update_name`).

#### 3. `DELETE /users/me/devices/:id`
- **Method**: `DELETE`
- **Path**: `/users/me/devices/{id}`
- **Auth**: Required (Bearer token).
- **Request Body**: Empty body.
- **Response Shape**: `204 No Content`.
- **Implementation Status**: Implemented (`routes::devices::revoke`). Checks current device (prevents self-revocation with 400 `cannot_revoke_current_device`), deletes unconsumed key packages, queues MLS removes, revokes push subscriptions, cascades device deletion, and logs audit action `device.revoke`.

---

### d. Current Device Name Write Path

Device name writes are executed via `sync::device_names::write_device_name` (`server/src/sync/device_names.rs`). The write path is triggered from two locations in the codebase:

1. **`PATCH /users/me/devices/:id`** (`server/src/routes/devices.rs`): Direct user update endpoint for device encrypted name.
2. **`POST /auth/login/finish`** (`server/src/routes/login.rs`): If `encrypted_device_name` is included in the login request and differs from the existing value in `device_names`, `write_device_name` is invoked to update/insert the name and allocate a new `user_seq`.

---

### e. Current `device.added`, `device.revoked`, and `device.name_updated` Events

Inspection of `server/src/` for user event publishers (`publish_user_event`) reveals the following:

1. **`device.added`**: Not currently published when a new device is created during `POST /auth/login/finish`.
2. **`device.revoked`**: Not currently published on `private-user-{user_id}` when `DELETE /users/me/devices/:id` is called (only an audit log entry `device.revoke` is written).
3. **`device.name_updated`**: In `server/src/sync/device_names.rs`, `write_device_name` publishes a user channel event, but uses a non-spec event name `device.sync` with payload `{ "device_id": row.device_id, "user_seq": row.user_seq }`.

#### Comparison against Spec §8.9

Spec §8.9 requires the following durable user channel events on `private-user-{user_id}`:
- **`device.added`**: `{ device_id, platform, added_at, user_seq }`
- **`device.revoked`**: `{ device_id, reason, user_seq }`
- **`device.name_updated`**: `{ device_id, encrypted_device_name, user_seq }`

---

### f. Current `device_state` in `GET /users/me/sync`

`GET /users/me/sync` (`server/src/sync/query.rs`) populates the `device_state` field in `SyncEnvelope`:

```json
{
  "read_state": [ ... ],
  "user_preferences": [ ... ],
  "device_state": [
    {
      "device_id": "dev_...",
      "encrypted_device_name": "<base64url>",
      "user_seq": 42,
      "updated_at": "2026-03-30T12:00:00Z",
      "deleted_at": null
    }
  ],
  "starred_items": [ ... ],
  "bot_settings": [ ... ],
  "max_seq": 42,
  "full_resync_required": false
}
```

#### Field Confirmation
Each item in `device_state` matches `DeviceStateRow` (`server/src/sync/device_names.rs`) and contains:
- `device_id`: String
- `encrypted_device_name`: String
- `user_seq`: i64
- `updated_at`: ISO 8601 DateTime
- `deleted_at`: Option<ISO 8601 DateTime> (included for tombstones when `since_seq > 0`)

---

### g. Device Registration Flow

1. **Creation Timing**: A `devices` row is **not** created during `POST /auth/register/finish`. Account registration establishes user identity, auth credentials, and default roles.
2. **Login Creation**: Device creation occurs during **`POST /auth/login/finish`** (`server/src/routes/login.rs`).
3. **Request Fields**:
   - `client_id`: Carried in `LoginFinishRequest.client_id` (string).
   - `platform`: Currently **absent** from `LoginFinishRequest` and the `devices` table.
4. **Device Flow Details**:
   - `find_by_client_id(&pool, user_id, client_id)` checks if a device already exists for the given user and client ID.
   - If missing, checks `count_devices < server_max_devices_per_user` (returns HTTP 400 `device_limit_exceeded` if capped), then calls `create_device(&pool, user_id, client_id)`.
   - If existing, calls `touch_last_seen(&pool, dev.id)`.
   - If `encrypted_device_name` is present in `LoginFinishRequest`, it calls `write_device_name` to populate `device_names`.

---

### h. Spec Gap Resolution: Device Name Update Endpoint Proposal

#### The Gap
V3 Spec §8.2 summarizes user endpoints but omitted `PATCH /users/me/devices/:id`, even though §6.21 defines Device Name Encryption, §7.2 defines the `device_names` table, and §8.9 defines the `device.name_updated` user event.

#### Proposed Endpoint Contract

```
PATCH /users/me/devices/:id
```

- **Purpose**: Set or update a device's encrypted name.
- **Auth**: Required (Bearer session token).
- **Rate Limit**: `RATE_DEVICE_NAME_PER_MIN` (default 30/min per user, key `device_name:{user_id}:min`).
- **Path Parameter**: `id` (device ID string).
- **Request Body**:
  ```json
  {
    "encrypted_device_name": "<base64url, 28–284 bytes decoded>"
  }
  ```
- **Validation**:
  - Returns HTTP 404 `device_not_found` if the device ID does not exist or does not belong to `auth.user_id`.
  - Returns HTTP 400 `missing_field` if `encrypted_device_name` is missing or empty.
  - Returns HTTP 400 `invalid_encrypted_device_name` if `encrypted_device_name` is not valid base64url or fails length checks (28–284 bytes decoded).
  - Returns HTTP 400 `field_renamed` if legacy field `device_name` is present in request body.
- **Server Behavior**:
  1. Verifies device ownership.
  2. Allocates next `user_seq` via `allocate_user_seq`.
  3. Upserts `device_names` table `(user_id, device_id, encrypted_device_name, user_seq, updated_at = CURRENT_TIMESTAMP, deleted_at = NULL)`.
  4. Publishes durable user channel event `device.name_updated` on `private-user-{user_id}`:
     ```json
     {
       "device_id": "<device_id>",
       "encrypted_device_name": "<ciphertext>",
       "user_seq": <user_seq>
     }
     ```
- **Response Body (200 OK)**:
  ```json
  {
    "device_id": "<device_id>",
    "encrypted_device_name": "<base64url>",
    "user_seq": <user_seq>,
    "updated_at": "<ISO 8601>",
    "deleted_at": null
  }
  ```
- **Headers**: `Cache-Control: no-store`.

#### Justification
This proposal aligns with `PATCH /users/me` (for `encrypted_display`), respects the primary key `(user_id, device_id)` of `device_names`, emits the exact `device.name_updated` event specified in §8.9, and builds cleanly on the existing implementation in `server/src/routes/devices.rs` and `server/src/sync/device_names.rs`.

---

### i. V2 Remnants Audit

1. **`devices` Schema**: The `devices` table in `server/migrations/0001_v2_schema.sql` retains a legacy `name TEXT` column and lacks the `platform` column with CHECK constraint required by §7.1.
2. **Event Naming**: `server/src/sync/device_names.rs` publishes `device.sync` with payload `{ device_id, user_seq }` instead of the spec-mandated `device.name_updated` with payload `{ device_id, encrypted_device_name, user_seq }`.
3. **Missing Live Events**: `POST /auth/login/finish` does not publish `device.added` events on device creation, and `DELETE /users/me/devices/:id` does not publish `device.revoked` events.
4. **Login Body**: `LoginFinishRequest` in `server/src/routes/login.rs` does not accept `platform`.

---

## Conclusion & Implementation Readiness

The device model verification is complete. The repository already contains the core structure for device management, `device_names` sync, and `GET /users/me/sync` integration. Following this verification report, Phase 5 implementation can proceed by updating the `devices` migration/schema (adding `platform`), updating event names and payloads to match §8.9, and adding `platform` to device creation.
