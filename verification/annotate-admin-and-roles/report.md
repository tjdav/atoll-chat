# Step 0 Report — Annotate Admin and Roles (and Confirm Models)

**Date:** 2026-10-16
**Task:** Task D — Annotate Admin and Roles (and Confirm Models)
**Batch Assignment:** `operations`

---

## 1. Current Router Registration

The exact line registrations in `server/src/lib.rs` for admin, roles, and models endpoints:

| Endpoint | Method(s) | Registration Line in `server/src/lib.rs` | Mount Path |
|---|---|---|---|
| Admin Config | GET, PATCH | Line 253-254 (`.route("/admin/config", get(...).patch(...))`) | `/api/v1/admin/config` |
| Admin Limits | GET, PATCH | Line 257-258 (`.route("/admin/limits", get(...).patch(...))`) | `/api/v1/admin/limits` |
| Admin Audit | GET | Line 260 (`.route("/admin/audit", get(...))`) | `/api/v1/admin/audit` |
| Admin Backups | GET, POST | Line 286-287 (`.route("/admin/backups", get(...).post(...))`) | `/api/v1/admin/backups` |
| Admin VAPID Rotate | POST | Line 290-291 (`.route("/admin/vapid/rotate", post(...))`) | `/api/v1/admin/vapid/rotate` |
| Admin ALTCHA Rotate | POST | Line 294-295 (`.route("/admin/altcha/rotate", post(...))`) | `/api/v1/admin/altcha/rotate` |
| Admin Invites | POST, GET | Line 399 (`.route("/admin/invites", post(...).get(...))`) | `/api/v1/admin/invites` |
| Admin Invite ID | DELETE | Line 403 (`.route("/admin/invites/{id}", delete(...))`) | `/api/v1/admin/invites/{id}` |
| Roles | GET | Line 323 (`.route("/roles", get(...))`) | `/api/v1/roles` |
| Models Manifest | GET | Line 655 (`.route("/models/manifest.json", get(...))`) | `/models/manifest.json` (root) |
| Models STT Serve | GET | Line 659 (`.route("/models/stt/v1/{model_id}/{version}/{filename}", get(...))`) | `/models/stt/v1/{model_id}/{version}/{filename}` (root) |
| Models TTS Serve | GET | Line 663 (`.route("/models/tts/v1/{model_id}/{version}/{filename}", get(...))`) | `/models/tts/v1/{model_id}/{version}/{filename}` (root) |

**Models Mount Confirm:** Models endpoints are registered at root (`/models/...`), NOT under `/api/v1/models/...`.

---

## 2. Current Handler Annotation Status

| Path Key | Handler Function(s) | `#[utoipa::path]` Present? | File Location |
|---|---|---|---|
| `/api/v1/admin/config` | `get_config_handler`, `patch_config_handler` | No | `server/src/routes/admin.rs` |
| `/api/v1/admin/limits` | `get_limits_handler`, `patch_limits_handler` | No | `server/src/routes/admin.rs` |
| `/api/v1/admin/audit` | `get_audit_handler` | No | `server/src/routes/admin.rs` |
| `/api/v1/admin/backups` | `list`, `trigger` | No | `server/src/routes/admin_backups.rs` |
| `/api/v1/admin/vapid/rotate` | `post_rotate_vapid_handler` | No | `server/src/routes/admin.rs` |
| `/api/v1/admin/altcha/rotate` | `post_rotate_altcha_handler` | No | `server/src/routes/admin.rs` |
| `/api/v1/admin/invites` | `list_invites_handler`, `create_invite_handler` | No | `server/src/routes/invites.rs` |
| `/api/v1/admin/invites/{id}` | `revoke_invite_handler` | No | `server/src/routes/invites.rs` |
| `/api/v1/roles` | `handler` | No | `server/src/routes/roles.rs` |
| `/models/manifest.json` | `get_manifest_handler` | **Yes** | `server/src/routes/models.rs` |
| `/models/stt/v1/{model_id}/{version}/{filename}` | `serve_stt_file_handler` | **Yes** | `server/src/routes/models.rs` |
| `/models/tts/v1/{model_id}/{version}/{filename}` | `serve_tts_file_handler` | **Yes** | `server/src/routes/models.rs` |

---

## 3. Current OpenAPI Presence

| Expected Path Key | Present in `docs/openapi.json`? | Path String in OpenAPI |
|---|---|---|
| `/api/v1/admin/config` | No | N/A |
| `/api/v1/admin/limits` | No | N/A |
| `/api/v1/admin/audit` | No | N/A |
| `/api/v1/admin/backups` | No | N/A |
| `/api/v1/admin/vapid/rotate` | No | N/A |
| `/api/v1/admin/altcha/rotate` | No | N/A |
| `/api/v1/admin/invites` | No | N/A |
| `/api/v1/admin/invites/{id}` | No | N/A |
| `/api/v1/roles` | No | N/A |
| `/models/manifest.json` | **Yes** | `/models/manifest.json` |
| `/models/stt/v1/{model_id}/{version}/{filename}` | **Yes** | `/models/stt/v1/{model_id}/{version}/{filename}` |
| `/models/tts/v1/{model_id}/{version}/{filename}` | **Yes** | `/models/tts/v1/{model_id}/{version}/{filename}` |

---

## 4. Models Path Comparison

- **Router registered path strings:**
  - `/models/manifest.json`
  - `/models/stt/v1/{model_id}/{version}/{filename}`
  - `/models/tts/v1/{model_id}/{version}/{filename}`
- **OpenAPI declared path strings:**
  - `/models/manifest.json`
  - `/models/stt/v1/{model_id}/{version}/{filename}`
  - `/models/tts/v1/{model_id}/{version}/{filename}`
- **Answer:** They match 100%. No fix or modification is needed for models endpoints or annotations.

---

## 5. Request and Response Types per Handler

1. **`admin/config` (`GET` and `PATCH`)**:
   - Response: `InstanceConfig` (from `crate::config_ops::InstanceConfig`).
   - Secret Redaction: `InstanceConfig` does NOT expose secret keys (`SECRET_KEYS` = `sockudo_app_secret`, `vapid_private_key`, `altcha_hmac_secret`). Only `EXPOSED_KEYS` are serialized. `InstanceConfig` already derives `Serialize, Deserialize, ToSchema`.
   - Request (`PATCH`): `serde_json::Value` (raw JSON object of config key-value pairs).

2. **`admin/limits` (`GET` and `PATCH`)**:
   - Response: `LimitsResponse` (fields: `limits: InstanceLimits`, `server_hard_max: ServerHardMax`). Needs `ToSchema`.
   - Request (`PATCH`): `InstanceLimits` (derived `ToSchema`).

3. **`admin/audit` (`GET`)**:
   - Query: `AuditQuery` (needs `IntoParams`).
   - Response: `AuditListResponse` (fields: `entries: Vec<AuditEntry>`, `next_before: Option<DateTime<Utc>>`). Needs `ToSchema`. `AuditEntry` also needs `ToSchema`.

4. **`admin/backups` (`GET` and `POST`)**:
   - Response (`GET`): `BackupListResponse` (fields: `backups: Vec<BackupItem>`). Needs `ToSchema`. `BackupItem` needs `ToSchema`.
   - Response (`POST`): `TriggerBackupResponse` (fields: `ok: bool`, `backup: BackupItem`). Needs `ToSchema`. Side-effect operation that triggers an immediate backup.

5. **`admin/vapid/rotate` (`POST`)**:
   - Response: `RotateVapidResponse` (fields: `public_key: String`, `subscriptions_revoked: u64`). Catastrophic rotation invalidating client push subscriptions. Needs `ToSchema`.

6. **`admin/altcha/rotate` (`POST`)**:
   - Response: `RotateAltchaResponse` (fields: `ok: bool`). Catastrophic rotation invalidating outstanding ALTCHA challenges. Needs `ToSchema`.

7. **`admin/invites` (`GET`, `POST`) and `admin/invites/{id}` (`DELETE`)**:
   - Query (`GET`): `ListInvitesQuery` (fields: `before`, `limit`). Derived `IntoParams`.
   - Response (`GET`): `ServerInviteListResponse` (fields: `invites: Vec<ServerInviteItem>`, `next_before: Option<DateTime<Utc>>`). Needs `ToSchema`. `ServerInviteItem` needs `ToSchema`.
   - Request (`POST`): `CreateServerInviteRequest` (fields: `max_uses`, `expires_in_seconds`). Derived `ToSchema`.
   - Response (`POST`): `ServerInviteItem` (201 Created).
   - Response (`DELETE`): `204 No Content`.

8. **`roles` (`GET`)**:
   - Response: `RoleListResponse` (fields: `roles: Vec<RoleView>`). Needs `ToSchema`. `RoleView` needs `ToSchema`.

---

## 6. ToSchema & IntoParams Derive Status

- **Types needing `ToSchema` added:**
  - `LimitsResponse` (`routes/admin.rs`)
  - `AuditListResponse` (`routes/admin.rs`)
  - `AuditEntry` (`audit.rs`)
  - `BackupListResponse` (`routes/admin_backups.rs`)
  - `TriggerBackupResponse` (`routes/admin_backups.rs`)
  - `BackupItem` (`routes/admin_backups.rs`)
  - `RotateVapidResponse` (`routes/admin.rs`)
  - `RotateAltchaResponse` (`routes/admin.rs`)
  - `ServerInviteListResponse` (`routes/invites.rs`)
  - `ServerInviteItem` (`routes/invites.rs`)
  - `RoleListResponse` (`routes/roles.rs`)
  - `RoleView` (`routes/roles.rs`)

- **Types needing `IntoParams` added:**
  - `AuditQuery` (`routes/admin.rs`)
  - `ListInvitesQuery` (`routes/invites.rs`) (already has `IntoParams`? Check: `invites.rs` has `#[into_params(parameter_in = Query)]`).

- **Already deriving `ToSchema`:**
  - `InstanceConfig` (`config_ops.rs`)
  - `InstanceLimits` (`limits.rs`)
  - `ServerHardMax` (`limits.rs`)
  - `CreateServerInviteRequest` (`routes/invites.rs`)

All newly derived schemas must be registered in `ApiDoc` components in `server/src/openapi.rs`.

---

## 7. Query Parameter Types

- `admin/audit`: `AuditQuery` (fields: `actor_id`, `action`, `target_type`, `target_id`, `before`, `after`, `per_page`). Will derive `IntoParams` with `#[into_params(parameter_in = Query)]`.
- `admin/invites`: `ListInvitesQuery` (fields: `before`, `limit`). Already derives `IntoParams` with `#[into_params(parameter_in = Query)]`.

---

## 8. Error Codes per Handler

- `GET`, `PATCH /admin/config`: 401 unauthorized, 403 forbidden (`invalid_permission`), 400 `invalid_request` / `invalid_config_key` / `invalid_config_value`.
- `GET`, `PATCH /admin/limits`: 401 unauthorized, 403 forbidden, 400 `invalid_request` / `exceeds_server_max` / `below_minimum`.
- `GET /admin/audit`: 401 unauthorized, 403 forbidden.
- `GET`, `POST /admin/backups`: 401 unauthorized, 403 forbidden, 500 `backup_failed`.
- `POST /admin/vapid/rotate`: 401 unauthorized, 403 forbidden, 500 `rotation_failed`.
- `POST /admin/altcha/rotate`: 401 unauthorized, 403 forbidden.
- `GET`, `POST /admin/invites`, `DELETE /admin/invites/{id}`: 401 unauthorized, 403 forbidden, 404 `not_found`.
- `GET /roles`: 401 unauthorized.

---

## 9. Specification References

- `admin/config`, `admin/limits`, `admin/audit`, `admin/backups`, `admin/vapid/rotate`, `admin/altcha/rotate`: §8.3 lists administrative endpoints; specific sub-endpoints are implementation-defined admin tools.
- `admin/invites`: §8.3 and §7.3.
- `roles`: §3.1 describes system roles; the listing endpoint `/api/v1/roles` is implementation-defined.
- `models`: §8.1.3 and §8.1.4.

---

## 10. Security-Sensitive Fields

- `admin/config`: Config response uses `InstanceConfig`, which explicitly filters out `SECRET_KEYS` (`sockudo_app_secret`, `vapid_private_key`, `altcha_hmac_secret`) via `EXPOSED_KEYS`. The OpenAPI schema accurately declares only exposed configuration fields.
- `admin/backups`: Response includes `BackupItem` with `filename`, `size_bytes`, `created_at`. No direct unauthenticated URL is exposed; backups are downloaded out-of-band or via admin file access.

---

## 11. Current Ignored-Test Failure List

Ran `cargo test --manifest-path server/Cargo.toml --test openapi_generation test_router_and_openapi_paths_match_one_to_one -- --ignored --nocapture`:

- **Missing path count:** 9 paths in router missing from OpenAPI.
- **Paths in router missing from OpenAPI (9):**
  - `/api/v1/admin/altcha/rotate`
  - `/api/v1/admin/audit`
  - `/api/v1/admin/backups`
  - `/api/v1/admin/config`
  - `/api/v1/admin/invites`
  - `/api/v1/admin/invites/{id}`
  - `/api/v1/admin/limits`
  - `/api/v1/admin/vapid/rotate`
  - `/api/v1/roles`
- **Paths in OpenAPI missing from router (1):**
  - `/ws/auth` (Wait! Note on `/ws/auth` in test: `/ws/auth` is registered as `&state.config.websocket_auth_path` in `lib.rs`, which defaults to `/ws/auth`. In unit tests without custom config, `state.config.websocket_auth_path` is `/ws/auth`. The test route parser reads literal strings from `lib.rs`, so it sees `&state.config.websocket_auth_path` instead of `"/ws/auth"`. Let's check how `/ws/auth` is parsed in `openapi_generation.rs`).

---

## 12. Batch Assignment

The integration test suite and changes belong to the `operations` batch.
