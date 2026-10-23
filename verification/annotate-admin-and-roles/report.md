# Step 0 — Empirical Verification Report: Annotate Admin and Roles (and Confirm Models)

## 1. Current Router Registration
Inspected `server/src/lib.rs` to verify path registrations on the Axum router:

- **Admin endpoints** (nested under `/api/v1` via `app.nest("/api/v1", api_routes)` at line 521):
  - `GET`, `PATCH /api/v1/admin/config`: line 231 (`.route("/admin/config", get(...).patch(...))`)
  - `GET`, `PATCH /api/v1/admin/limits`: line 235 (`.route("/admin/limits", get(...).patch(...))`)
  - `GET /api/v1/admin/audit`: line 239 (`.route("/admin/audit", get(...))`)
  - `GET`, `POST /api/v1/admin/backups`: line 258 (`.route("/admin/backups", get(...).post(...))`)
  - `POST /api/v1/admin/vapid/rotate`: line 262 (`.route("/admin/vapid/rotate", post(...))`)
  - `POST /api/v1/admin/altcha/rotate`: line 266 (`.route("/admin/altcha/rotate", post(...))`)
  - `GET`, `POST /api/v1/admin/invites`: line 335 (`.route("/admin/invites", post(...).get(...))`)
  - `DELETE /api/v1/admin/invites/{id}`: line 339 (`.route("/admin/invites/{id}", delete(...))`)

- **Roles endpoint** (nested under `/api/v1`):
  - `GET /api/v1/roles`: line 282 (`.route("/roles", get(...))`)

- **Models endpoints** (mounted directly at root on `app` when `model_hosting_mode.registers_routes()` is true):
  - `GET /models/manifest.json`: line 508 (`.route("/models/manifest.json", get(...))`)
  - `GET /models/stt/v1/{model_id}/{version}/{filename}`: line 512 (`.route("/models/stt/v1/{model_id}/{version}/{filename}", get(...))`)
  - `GET /models/tts/v1/{model_id}/{version}/{filename}`: line 516 (`.route("/models/tts/v1/{model_id}/{version}/{filename}", get(...))`)

## 2. Current Handler Annotation Status
- `get_config_handler`, `patch_config_handler` (`server/src/routes/admin.rs`): Unannotated.
- `get_limits_handler`, `patch_limits_handler` (`server/src/routes/admin.rs`): Unannotated.
- `get_audit_handler` (`server/src/routes/admin.rs`): Unannotated.
- `list`, `trigger` (`server/src/routes/admin_backups.rs`): Unannotated.
- `post_rotate_vapid_handler`, `post_rotate_altcha_handler` (`server/src/routes/admin.rs`): Unannotated.
- `create_invite_handler`, `list_invites_handler`, `revoke_invite_handler` (`server/src/routes/invites.rs`): Unannotated.
- `handler` (`server/src/routes/roles.rs`): Unannotated.
- Models handlers (`get_manifest_handler`, `serve_stt_file_handler`, `serve_tts_file_handler` in `server/src/routes/models.rs`): All 3 are ALREADY ANNOTATED with `#[utoipa::path(...)]`.

## 3. Current OpenAPI Presence
- Admin (8 path keys): None present in `docs/openapi.json`.
- Roles (1 path key): Not present in `docs/openapi.json`.
- Models (3 path keys): All 3 paths are ALREADY PRESENT in `docs/openapi.json`:
  - `/models/manifest.json`
  - `/models/stt/v1/{model_id}/{version}/{filename}`
  - `/models/tts/v1/{model_id}/{version}/{filename}`

## 4. Models Path Comparison
- **Router registration:**
  - `/models/manifest.json`
  - `/models/stt/v1/{model_id}/{version}/{filename}`
  - `/models/tts/v1/{model_id}/{version}/{filename}`
- **OpenAPI declaration:**
  - `/models/manifest.json`
  - `/models/stt/v1/{model_id}/{version}/{filename}`
  - `/models/tts/v1/{model_id}/{version}/{filename}`
- **Conclusion:** The router and OpenAPI annotations MATCH exactly. No fix or modification is required for models endpoints or annotations.

## 5. Request and Response Types
- `GET`, `PATCH /api/v1/admin/config`:
  - GET response: `InstanceConfig` (`moderation_mode`, `altcha_enabled`, `safety_number_mode`, `push_enabled`).
  - PATCH request: `serde_json::Value` (map of exposed key to string/bool value); response `InstanceConfig`.
  - Secret redaction: `InstanceConfig` exposes only non-secret keys (`EXPOSED_KEYS`). Secret keys (`altcha_hmac_secret`, `vapid_private_key`, `pusher_app_secret`, etc.) are never returned by `get_config` or accepted by `patch_config` (which rejects non-exposed keys).
- `GET`, `PATCH /api/v1/admin/limits`:
  - GET response: `LimitsResponse` (`limits: InstanceLimits`, `server_hard_max: ServerHardMax`).
  - PATCH request: `InstanceLimits`; response `LimitsResponse`.
- `GET /api/v1/admin/audit`:
  - Query parameters: `AuditQuery` (`actor_id`, `action`, `target_type`, `target_id`, `before`, `after`, `per_page`).
  - Response: `AuditListResponse` (`entries: Vec<AuditEntry>`, `next_before: Option<DateTime<Utc>>`).
- `GET`, `POST /api/v1/admin/backups`:
  - GET response: `BackupListResponse` (`backups: Vec<BackupItemResponse>`).
  - POST response: `BackupItemResponse` (`filename`, `size_bytes`, `created_at`), status 201 Created. Side-effect operation (triggers backup job).
- `POST /api/v1/admin/vapid/rotate`:
  - Response: `RotateVapidResponse` (`public_key`, `subscriptions_revoked`). Catastrophic operation (invalidates existing push subscriptions).
- `POST /api/v1/admin/altcha/rotate`:
  - Response: `RotateAltchaResponse` (`ok: bool`). Catastrophic operation (invalidates outstanding ALTCHA challenges).
- `GET`, `POST /api/v1/admin/invites` & `DELETE /api/v1/admin/invites/{id}`:
  - GET: Query `ListInvitesQuery` (`include_revoked`, `created_by_me`), Response `ListInvitesResponse` (`invites: Vec<InviteListItem>`).
  - POST: Request `CreateInviteRequest` (`max_uses`, `expires_in_days`), Response `CreateInviteResponse` (`id`, `code`, `max_uses`, `current_uses`, `expires_at`, `created_at`), status 201 Created.
  - DELETE: Path `id: String`, status 204 No Content.
  - Server-wide invite management distinct from room invites.
- `GET /api/v1/roles`:
  - Response: `RolesResponse` (`roles: Vec<Role>`).

## 6. ToSchema Derive Status
- Types needing `ToSchema`:
  - `InstanceConfig` (`server/src/config_ops.rs`)
  - `LimitsResponse` (`server/src/routes/admin.rs`)
  - `InstanceLimits` (`server/src/limits.rs`)
  - `ServerHardMax` (`server/src/limits.rs`)
  - `AuditListResponse` (`server/src/routes/admin.rs`)
  - `AuditEntry` (`server/src/audit.rs`)
  - `BackupListResponse`, `BackupItemResponse` (`server/src/routes/admin_backups.rs`)
  - `RotateVapidResponse`, `RotateAltchaResponse` (`server/src/routes/admin.rs`)
  - `RolesResponse` (`server/src/routes/roles.rs`)
  - `Role` (`server/src/roles.rs`)
- Types needing `IntoParams`:
  - `AuditQuery` (`server/src/routes/admin.rs`)
- Types already deriving `ToSchema` / `IntoParams`:
  - `CreateInviteRequest`, `CreateInviteResponse`, `ListInvitesQuery`, `InviteListItem`, `ListInvitesResponse` (`server/src/routes/invites.rs`)

All new schemas will be registered in `ApiDoc` components in `server/src/openapi.rs`.

## 7. Query Parameter Types
- `AuditQuery` (`server/src/routes/admin.rs`): Query params for audit log filtering/pagination. Will derive `IntoParams`.
- `ListInvitesQuery` (`server/src/routes/invites.rs`): Query params for server invite listing. Already derives `IntoParams`.

## 8. Error Codes per Handler
- `admin/config`: 400 (`invalid_config_key`, `invalid_config_value`), 401 (`unauthorized`), 403 (`forbidden`), 500 (`internal_error`).
- `admin/limits`: 400 (`exceeds_server_max`, `below_minimum`), 401 (`unauthorized`), 403 (`forbidden`), 500 (`internal_error`).
- `admin/audit`: 401 (`unauthorized`), 403 (`forbidden`), 500 (`internal_error`).
- `admin/backups`: 401 (`unauthorized`), 403 (`forbidden`), 409 (`backup_in_progress`), 500 (`backup_failed`), 501 (`backup_disabled`).
- `admin/vapid/rotate`: 401 (`unauthorized`), 403 (`forbidden`), 500 (`internal_error`).
- `admin/altcha/rotate`: 401 (`unauthorized`), 403 (`forbidden`), 500 (`internal_error`).
- `admin/invites`:
  - GET: 401 (`unauthorized`), 403 (`forbidden`).
  - POST: 400 (`invalid_request`), 401 (`unauthorized`), 403 (`forbidden`, `invite_limit_reached`), 429 (`too_many_requests`).
  - DELETE: 401 (`unauthorized`), 403 (`forbidden`), 404 (`invite_not_found`), 409 (`invite_already_revoked`).
- `roles`: 401 (`unauthorized`), 500 (`internal_error`).

## 9. Spec References
- `admin/config`, `admin/limits`, `admin/audit`: Server Spec v3.0.4 §8.3.
- `admin/backups`: §8.3 and §13 (Backup and Disaster Recovery).
- `admin/vapid/rotate`: §5.9 (Push Notifications) and §8.3.
- `admin/altcha/rotate`: §5.11 (ALTCHA Anti-Spam) and §8.3.
- `admin/invites`: §7.3 (Server Invites) and §8.3.
- `roles`: §3.1 (Roles and Permissions); listing endpoint marked implementation-defined.
- `models`: §8.1.3 and §8.1.4.

## 10. Security-Sensitive Fields
- `admin/config`: Response shape does NOT include secret values. `InstanceConfig` exposes only `moderation_mode`, `altcha_enabled`, `safety_number_mode`, and `push_enabled`.
- `admin/backups`: Response shape returns `filename`, `size_bytes`, `created_at`. Does not expose raw file URLs or secrets. Protected by `BackupManage` permission requirement.

## 11. Current Ignored-Test Failure List
Running `cargo test --test openapi_generation test_router_and_openapi_paths_match_one_to_one -- --ignored --nocapture`:
- Total missing router paths: 20
- Missing paths list:
  1. `/api/v1/admin/altcha/rotate` (Admin)
  2. `/api/v1/admin/audit` (Admin)
  3. `/api/v1/admin/backups` (Admin)
  4. `/api/v1/admin/config` (Admin)
  5. `/api/v1/admin/invites` (Admin)
  6. `/api/v1/admin/invites/{id}` (Admin)
  7. `/api/v1/admin/limits` (Admin)
  8. `/api/v1/admin/vapid/rotate` (Admin)
  9. `/api/v1/roles` (Roles)
  10. `/api/v1/calls/turn-credentials` (Calls)
  11. `/api/v1/keypackages` (Keypackages)
  12. `/api/v1/keypackages/claim` (Keypackages)
  13. `/api/v1/keypackages/count` (Keypackages)
  14. `/api/v1/rooms/{id}/calls/{call_id}/end` (Calls)
  15. `/api/v1/rooms/{id}/calls/{call_id}/join` (Calls)
  16. `/api/v1/rooms/{id}/calls/{call_id}/leave` (Calls)
  17. `/api/v1/rooms/{id}/calls/{call_id}/signal` (Calls)
  18. `/api/v1/welcomes` (Welcomes)
  19. `/api/v1/welcomes/{id}` (Welcomes)
  20. `/api/v1/welcomes/{id}/consume` (Welcomes)

Task D will annotate the 8 Admin paths and 1 Roles path, resolving items 1-9.

## 12. Batch Assignment
- `operations`
