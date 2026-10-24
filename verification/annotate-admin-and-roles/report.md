# Step 0 — Empirical Verification Report: Annotate Admin and Roles (and Confirm Models)

## 1. Current Router Registration
Inspected `server/src/lib.rs` for registrations:
- `GET, PATCH /api/v1/admin/config` — `server/src/lib.rs:237-240`
- `GET, PATCH /api/v1/admin/limits` — `server/src/lib.rs:241-244`
- `GET /api/v1/admin/audit` — `server/src/lib.rs:245`
- `GET, POST /api/v1/admin/backups` — `server/src/lib.rs:266-269`
- `POST /api/v1/admin/vapid/rotate` — `server/src/lib.rs:270-273`
- `POST /api/v1/admin/altcha/rotate` — `server/src/lib.rs:274-277`
- `GET, POST /api/v1/admin/invites` — `server/src/lib.rs:347-350`
- `DELETE /api/v1/admin/invites/{id}` — `server/src/lib.rs:351-354`
- `GET /api/v1/roles` — `server/src/lib.rs:290`
- `GET /models/manifest.json` — `server/src/lib.rs:538`
- `GET /models/stt/v1/{model_id}/{version}/{filename}` — `server/src/lib.rs:542`
- `GET /models/tts/v1/{model_id}/{version}/{filename}` — `server/src/lib.rs:546`

Admin and roles routes are registered on `api_routes` nested under `/api/v1`. Models routes are registered on `app` at root `/models/...`.

## 2. Current Handler Annotation Status
- `get_config_handler`, `patch_config_handler` (`server/src/routes/admin.rs`): Unannotated.
- `get_limits_handler`, `patch_limits_handler` (`server/src/routes/admin.rs`): Unannotated.
- `get_audit_handler` (`server/src/routes/admin.rs`): Unannotated.
- `list`, `trigger` (`server/src/routes/admin_backups.rs`): Unannotated.
- `post_rotate_vapid_handler`, `post_rotate_altcha_handler` (`server/src/routes/admin.rs`): Unannotated.
- `create_invite_handler`, `list_invites_handler`, `revoke_invite_handler` (`server/src/routes/invites.rs`): Unannotated (`validate_invite_public_handler` is annotated).
- `handler` (`server/src/routes/roles.rs`): Unannotated.
- `get_manifest_handler`, `serve_stt_file_handler`, `serve_tts_file_handler` (`server/src/routes/models.rs`): Annotated (`#[utoipa::path]` present on all three).

## 3. Current OpenAPI Presence
- 8 Admin path keys: Absent from `docs/openapi.json`.
- 1 Roles path key: Absent from `docs/openapi.json`.
- 3 Models path keys: Present in `docs/openapi.json` at `/models/manifest.json`, `/models/stt/v1/{model_id}/{version}/{filename}`, and `/models/tts/v1/{model_id}/{version}/{filename}`.

## 4. Models Path Comparison
- Router path string: `/models/manifest.json`, `/models/stt/v1/{model_id}/{version}/{filename}`, `/models/tts/v1/{model_id}/{version}/{filename}`.
- OpenAPI declared path: `/models/manifest.json`, `/models/stt/v1/{model_id}/{version}/{filename}`, `/models/tts/v1/{model_id}/{version}/{filename}`.
- Alignment Status: Match. Both router and OpenAPI declare root `/models/...` paths per Server Spec v3.0.4 §8.1.3 and §8.1.4. No fix or modification is required for models.

## 5. Request and Response Types
- `GET /api/v1/admin/config`: Response `InstanceConfig`.
- `PATCH /api/v1/admin/config`: Request `serde_json::Value` (or `PatchConfigReq`), Response `InstanceConfig`.
- `GET /api/v1/admin/limits`: Response `LimitsResponse`.
- `PATCH /api/v1/admin/limits`: Request `InstanceLimits`, Response `LimitsResponse`.
- `GET /api/v1/admin/audit`: Query `AuditQuery`, Response `AuditListResponse`.
- `GET /api/v1/admin/backups`: Response `BackupListResponse`.
- `POST /api/v1/admin/backups`: Response `BackupItemResponse` (HTTP 201). Triggers a database backup side-effect.
- `POST /api/v1/admin/vapid/rotate`: Response `RotateVapidResponse`. Triggers key rotation side-effect.
- `POST /api/v1/admin/altcha/rotate`: Response `RotateAltchaResponse`. Triggers secret rotation side-effect.
- `GET /api/v1/admin/invites`: Query `ListInvitesQuery`, Response `ListInvitesResponse`.
- `POST /api/v1/admin/invites`: Request `CreateInviteRequest`, Response `CreateInviteResponse` (HTTP 201).
- `DELETE /api/v1/admin/invites/{id}`: Response 204 No Content.
- `GET /api/v1/roles`: Response `RolesResponse`.

## 6. ToSchema Derive Status
Need `ToSchema` derive and ApiDoc schema registration:
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
- `Permission` (`server/src/permissions.rs`)

Already have `ToSchema` derive:
- `CreateInviteRequest`, `CreateInviteResponse`, `InviteListItem`, `ListInvitesResponse` (`server/src/routes/invites.rs`)

## 7. Query Parameter Types
- `admin/audit`: `AuditQuery` in `server/src/routes/admin.rs` (needs `#[derive(IntoParams)]`).
- `admin/invites`: `ListInvitesQuery` in `server/src/routes/invites.rs` (already derives `IntoParams`).

## 8. Error Codes per Handler
- Admin endpoints (`config`, `limits`, `audit`, `backups`, `vapid/rotate`, `altcha/rotate`): 401 Unauthorized, 403 Forbidden.
- `PATCH /admin/config`: 400 invalid_config_key / invalid_config_value.
- `PATCH /admin/limits`: 400 exceeds_server_max / below_minimum.
- `POST /admin/backups`: 500 backup_failed, 501 backup_disabled, 409 backup_in_progress.
- `admin/invites`:
  - GET: 401, 403.
  - POST: 401, 403, 400 bad_request, 429 rate_limited.
  - DELETE: 401, 403, 404 invite_not_found, 409 invite_already_revoked.
- `roles`: 401 Unauthorized.

## 9. Spec References
- `admin/config`, `admin/limits`, `admin/audit`, `admin/backups`: §8.3 or implementation-defined.
- `admin/vapid/rotate`: §5.9, §8.3.
- `admin/altcha/rotate`: §5.11, §8.3.
- `admin/invites`: §7.3, §8.3.
- `roles`: §3.1 (listing endpoint is implementation-defined).
- `models`: §8.1.3, §8.1.4.

## 10. Security-Sensitive Fields
- `admin/config`: `InstanceConfig` exposes only safe operational flags (`moderation_mode`, `altcha_enabled`, `safety_number_mode`, `push_enabled`). Secret keys (`SECRET_KEYS`) are redacted/excluded by the handler and will not be present in schema.
- `admin/backups`: Returns metadata (`filename`, `size_bytes`, `created_at`). File downloads are not directly served via this DTO.

## 11. Ignored-Test Failure List
Ran `cargo test --test openapi_generation test_router_and_openapi_paths_match_one_to_one -- --ignored --nocapture`:
- Missing path count: 9
- Missing paths:
  `/api/v1/admin/altcha/rotate`
  `/api/v1/admin/audit`
  `/api/v1/admin/backups`
  `/api/v1/admin/config`
  `/api/v1/admin/invites`
  `/api/v1/admin/invites/{id}`
  `/api/v1/admin/limits`
  `/api/v1/admin/vapid/rotate`
  `/api/v1/roles`
- Categorization: Exactly 8 admin paths + 1 roles path. Zero non-matching residual paths.

## 12. Batch Assignment
Batch: `operations` (`server/tests/batch-manifest.toml`).
