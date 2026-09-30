# Encrypted Chat Server (Phase 1)

This is the foundation for a self-hosted, end-to-end encrypted group messaging system.

## Prerequisites

- Rust 1.85+
- cargo

## Build

```bash
cargo build --release
```

## Run in Development

```bash
cp .env.example .env
cargo run
```

Migrations will run automatically on startup. The SQLite database will be created at the path specified by `DB_PATH` in your `.env` file (by default, `./data/app.db`).

## Testing Endpoints

Check the health of the server:
```bash
curl http://localhost:8080/health
```

View server capabilities:
```bash
curl http://localhost:8080/api/v1/capabilities
```

## Verify Database

You can verify the created SQLite database using:
```bash
sqlite3 data/app.db ".tables"
```

## Roles and Permissions

This system uses a role-based access control (RBAC) model. The following global roles are pre-seeded:

- **owner**: Has full access to everything. Granted the `*` wildcard permission.
- **admin**: Can manage users, instance config, rooms, backups, and generate unlimited invites.
- **inviter**: Can generate limited invites.
- **member**: Basic role allowing room creation, joining, and messaging.

### Wildcard Permission
The `*` permission satisfies any permission check. The `owner` role uses this to ensure it always has access, even to new permissions added in the future.

### Bootstrap Behavior
The server checks the number of users on startup. If no users exist, it logs that the first registration will become the owner. If users exist, it assumes the owner role is already assigned.

### Endpoints
- `GET /api/v1/roles` - Returns the four global roles ordered by descending level. (Unauthenticated)

### Testing
You can run the unit and integration tests using:

```bash
cargo test
```

## Registration Flow

User onboarding uses the OPAQUE asymmetric password-authenticated key exchange protocol (`opaque-ke` 4.0.1).

### Handshake Overview

The registration process consists of a two-step HTTP handshake:

1. **Start (`POST /api/v1/auth/register/start`)**: The client sends its username and OPAQUE `RegistrationRequest`. The server validates username format (3–32 alphanumeric/underscore/dash chars), checks for username availability using domain-separated hashing (`username-v1:`), executes `ServerRegistration::start`, stores pending correlation data in memory, and returns a `registration_id` alongside the base64-encoded `registration_response`.
2. **Finish (`POST /api/v1/auth/register/finish`)**: The client computes the OPAQUE `RegistrationUpload` and submits it with the `registration_id` and optional `invite_code`. The server completes registration with `ServerRegistration::finish`, records the user in the database, and assigns the appropriate role.

### Bootstrap vs Invite Path

- **Bootstrap Path**: If no users exist in the system, the first registrant does not require an invite code and is automatically assigned the `owner` role.
- **Invite Path**: Once at least one user exists, subsequent registrations require a valid, unexpired, and non-revoked invite code with remaining uses (`current_uses < max_uses`).

### State Correlation & TTL

- Correlation state between `/start` and `/finish` is held entirely in memory in `RegistrationStore` without OPAQUE server state (as OPAQUE 4.0.1 server registration start is stateless).
- Entries automatically expire after **5 minutes** (`REGISTRATION_TTL`).

### Cipher Suite

- **OPRF**: Ristretto255
- **Key Exchange**: TripleDh (Ristretto255 + SHA-512)
- **Key Stretching Function (KSF)**: Argon2

### Example `curl` Commands

**Start Registration:**
```bash
curl -X POST http://localhost:8080/api/v1/auth/register/start \
  -H "Content-Type: application/json" \
  -d '{
    "username": "alice",
    "registration_request": "<base64_request_bytes>"
  }'
```

**Finish Registration (Bootstrap / Owner):**
```bash
curl -X POST http://localhost:8080/api/v1/auth/register/finish \
  -H "Content-Type: application/json" \
  -d '{
    "registration_id": "<registration_id_from_start>",
    "registration_upload": "<base64_upload_bytes>"
  }'
```

**Finish Registration (With Invite Code):**
```bash
curl -X POST http://localhost:8080/api/v1/auth/register/finish \
  -H "Content-Type: application/json" \
  -d '{
    "registration_id": "<registration_id_from_start>",
    "registration_upload": "<base64_upload_bytes>",
    "invite_code": "INVITE123"
  }'
```

### Inserting Test Invites Manually

To manually insert an invite code for testing:

```bash
sqlite3 data/app.db "INSERT INTO server_invites (id, code, max_uses, current_uses) VALUES ('test_inv_1', 'INVITE123', 1, 0);"
```

## ALTCHA Configuration

ALTCHA is a privacy-friendly, self-hosted Proof-of-Work (PoW) CAPTCHA alternative that protects registration endpoints from automated bot traffic without tracking users or requiring third-party services.

### Environment Variables

| Variable | Description | Default |
| --- | --- | --- |
| `ALTCHA_ENABLED` | Enable or disable ALTCHA protection for registration endpoints. | `true` |
| `ALTCHA_HMAC_SECRET` | Secret key used to sign and verify ALTCHA challenges. Set to `auto` to generate and persist a 32-byte secret in `instance_config`. | `auto` |
| `ALTCHA_ALGORITHM` | PoW hash algorithm used for challenge derivation. | `PBKDF2/SHA-256` |
| `ALTCHA_COST` | PoW difficulty cost (number of iterations). | `5000` |

### Security & Deterministic Mode

A security advisory disclosed in July 2026 affected ALTCHA PoW v2 fallback verification when challenges omitted `keySignature` or verifiers omitted the `hmac_key_signature_secret`. To remain secure against single KDF execution bypasses:

- The server uses **deterministic effort mode with matching HMAC signature secrets** on both challenge creation and verification.
- Probabilistic mode is not used.
- The `altcha` crate is pinned to `v0.2.0` or later, which includes the official fix for the advisory.

### Client Integration (`<altcha-widget>`)

Frontend applications integrate the official `<altcha-widget>` web component:

1. Configure the widget `challengeurl` to `GET /api/v1/auth/register/challenge`.
2. The widget automatically fetches a challenge, solves it in a Web Worker, and populates a hidden form field named `altcha`.
3. The base64-encoded JSON solution payload is included in `POST /api/v1/auth/register/start` and `POST /api/v1/auth/register/finish` requests as the `altcha` field.

### Local Development

For local development or testing without solving PoW challenges, ALTCHA can be disabled by setting:

```env
ALTCHA_ENABLED=false
```

When disabled, `GET /api/v1/auth/register/challenge` returns HTTP 404 (`{"error":"altcha_disabled"}`), and registration endpoints skip ALTCHA payload verification.

## Login Flow

User authentication uses the OPAQUE key exchange protocol to perform authenticated password validation without transmitting the raw password.

### Handshake & Stateful Server Model

Unlike registration (which is stateless on the server side in `opaque-ke` 4.0.1), **login is stateful**. The server must retain state between the two HTTP rounds because OPAQUE derives ephemeral key exchange material in round 1 that is required during round 2.

The handshake consists of two HTTP steps:

1. **Start (`POST /api/v1/auth/login/start`)**:
   - The client sends its `username`, base64-encoded `credential_request`, and device `client_id`.
   - The server looks up the user by domain-separated hash (`username-v1:`). Unknown users and disabled accounts are handled uniformly or with dedicated error codes (`invalid_credentials`, `account_disabled`).
   - The server executes `ServerLogin::start`, creates a `PendingLogin` containing the ephemeral `ServerLogin` state, stores it in `LoginStore`, and returns a `login_id` and base64-encoded `credential_response`.

2. **Finish (`POST /api/v1/auth/login/finish`)**:
   - The client computes the OPAQUE `credential_finalization` and submits it with `login_id` and optional `identity_pubkey`.
   - The server removes (`take`) the `PendingLogin` state from `LoginStore` (preventing second-round replays), executes `ServerLogin::finish`, verifies or stores the client's Ed25519 `identity_pubkey`, issues a bearer session token, and returns the authentication payload.

### State Correlation & TTL

- `LoginStore` persists the `ServerLogin` state in memory between rounds.
- Correlation records expire automatically after **5 minutes** (`LOGIN_TTL`).

### OPAQUE Session Key vs Bearer Tokens

- The OPAQUE handshake produces a shared session key on both client and server. The client derives its local CoreCrypto database encryption key from this session key.
- The server does **not** store or transmit the OPAQUE session key; it is discarded immediately after login completes.
- Bearer tokens are issued by `session::create_session` for HTTP request authentication.

### Session Token Format & Storage

- **Raw Token**: 32 cryptographically secure random bytes from `OsRng`, base64url-encoded without padding (43 characters). Returned to the client.
- **Database Storage**: The raw token is **never** stored in the database. The `sessions` table stores the SHA-256 hex digest (64 characters).
- **Sliding Expiry**: When `SESSION_SLIDING=true` (default), active sessions automatically extend their `expires_at` timestamp on every valid call to `session::validate_session`.

### Example `curl` Commands

**Start Login:**
```bash
curl -X POST http://localhost:8080/api/v1/auth/login/start \
  -H "Content-Type: application/json" \
  -d '{
    "username": "alice",
    "credential_request": "<base64_credential_request_bytes>",
    "client_id": "client_device_identifier_12345"
  }'
```

**Finish Login:**
```bash
curl -X POST http://localhost:8080/api/v1/auth/login/finish \
  -H "Content-Type: application/json" \
  -d '{
    "login_id": "<login_id_from_start>",
    "credential_finalization": "<base64_credential_finalization_bytes>",
    "identity_pubkey": "<base64_ed25519_pubkey_bytes>"
  }'
```

**Using the Session Token:**
```bash
curl -H "Authorization: Bearer <session_token>" http://localhost:8080/api/v1/capabilities
```

## Authentication & Session Management

All protected endpoints require HTTP Bearer Token authentication via the `Authorization` header.

### Bearer Token Scheme

Requests to authenticated endpoints must include the standard header:
```
Authorization: Bearer <raw_session_token>
```

### `AuthUser` Extractor

Handlers declare `auth: AuthUser` as a parameter to enforce authentication:

```rust
pub async fn my_handler(auth: AuthUser) -> Result<Json<MyResponse>, ApiError> {
    // auth.user_id, auth.username, auth.session_id, auth.expires_at, etc.
}
```

The `AuthUser` extractor:
1. Extracts the Bearer token from the `Authorization` header. Missing or malformed headers return HTTP 401 (`{"error":"unauthorized"}`).
2. Validates the session token hash against the database. Invalid or expired sessions return HTTP 401 (`{"error":"unauthorized"}`).
3. Queries the user record. If the account is disabled (`disabled_at IS NOT NULL`), the session is immediately revoked and HTTP 401 (`{"error":"account_disabled"}`) is returned. Missing user records also trigger session revocation and HTTP 401 (`{"error":"unauthorized"}`).
4. Never panics on malformed input or unexpected states. Database errors yield HTTP 500 (`{"error":"internal"}`).

### Session Lifecycle

- **Creation**: Upon successful login (`POST /api/v1/auth/login/finish`), a 32-byte cryptographically secure session token is generated. The client receives the raw token while the server stores only its SHA-256 hex digest (`token_hash`) in the `sessions` table.
- **Validation & Sliding Expiry**: On each authenticated request, `session::validate_session` verifies the token hash and checks `expires_at > CURRENT_TIMESTAMP` and `revoked_at IS NULL`. On success, it updates `last_seen_at = CURRENT_TIMESTAMP` and (if `SESSION_SLIDING=true`) extends `expires_at`.
- **Revocation**: Setting `revoked_at = CURRENT_TIMESTAMP` immediately invalidates the session for future requests.

### User & Profile Endpoints

- **`GET /api/v1/users/me`**: Returns the current user's profile, assigned roles, ownership status, and effective file size limits.
- **`PATCH /api/v1/users/me`**: Updates `display_name` (1–64 characters after trimming, control characters prohibited) and `profile_blob` (valid base64 string). Attempts to modify `username` return HTTP 400 (`{"error":"username_immutable"}`). Successful updates increment `profile_version`.

### Session Management Endpoints

- **`GET /api/v1/users/me/sessions`**: Returns all active (non-revoked, non-expired) sessions for the authenticated user, ordered by creation date descending. Includes `is_current: true` for the requesting session.
- **`DELETE /api/v1/users/me/sessions/:id`**: Revokes a specific active session by ID. Revoking the current active session via this endpoint is prohibited (HTTP 400 `{"error":"cannot_revoke_current_session"}`) — clients must use `/auth/logout`.
- **`POST /api/v1/auth/logout`**: Revokes the current session. Accepts an optional JSON body `{"all_sessions": true}` to revoke all active sessions for the user across all devices.

### Example `curl` Commands

**Get User Profile:**
```bash
curl -s -H "Authorization: Bearer <session_token>" \
  http://localhost:8080/api/v1/users/me
```

**Update Display Name:**
```bash
curl -s -X PATCH http://localhost:8080/api/v1/users/me \
  -H "Authorization: Bearer <session_token>" \
  -H "Content-Type: application/json" \
  -d '{"display_name": "Alice Smith"}'
```

**List Active Sessions:**
```bash
curl -s -H "Authorization: Bearer <session_token>" \
  http://localhost:8080/api/v1/users/me/sessions
```

**Revoke a Specific Session:**
```bash
curl -s -X DELETE http://localhost:8080/api/v1/users/me/sessions/<session_id_to_revoke> \
  -H "Authorization: Bearer <session_token>"
```

**Logout Current Device:**
```bash
curl -s -X POST http://localhost:8080/api/v1/auth/logout \
  -H "Authorization: Bearer <session_token>"
```

**Logout All Devices:**
```bash
curl -s -X POST http://localhost:8080/api/v1/auth/logout \
  -H "Authorization: Bearer <session_token>" \
  -H "Content-Type: application/json" \
  -d '{"all_sessions": true}'
```

### Security Guarantees

- **Token Hash Privacy**: Raw session tokens are never persisted in plaintext or logged.
- **Immediate Revocation**: Session revocation is immediate and effective on the very next HTTP request.
- **Disabled User Guard**: Disabled accounts are blocked instantly on every request, revoking active sessions on access attempt.
- **Cross-User Isolation**: Revocation endpoints strictly enforce ownership checks, returning HTTP 404 for non-existent or other users' session IDs to prevent enumeration.

## Devices

Devices represent distinct client installations (keyed by `client_id`).

### Implicit Device Creation & Limits

- Devices are created implicitly during login (`POST /api/v1/auth/login/finish`).
- When a client logs in with a `client_id`, the server looks up an existing device for `(user_id, client_id)`.
- If the device exists, its `last_seen` timestamp is updated, and the new session is linked to its device ID.
- If the device does not exist, the server checks the user's active device count against `SERVER_MAX_DEVICES_PER_USER` (default `20`). If the count is at or above the limit, login fails with HTTP 400 (`{"error":"device_limit_exceeded"}`). Otherwise, a new device row is created.
- Optional `device_name` (1–64 trimmed characters, no control characters) can be provided during login finish.

### Identity Pubkey
- The `users.identity_pubkey` column stores a single identity public key per user (first-device-wins rule).

### Device Endpoints

- **`GET /api/v1/users/me/devices`**: Lists all devices for the authenticated user, ordered by creation date descending. Returns device details (`id`, `client_id`, `name`, `created_at`, `last_seen`) and `is_current: true` for the device associated with the current session.
- **`DELETE /api/v1/users/me/devices/:id`**: Revokes the specified device.
  - Attempting to revoke the current session's device returns HTTP 400 (`{"error":"cannot_revoke_current_device"}`). To revoke the current device, users should log out or revoke it from another device.
  - If the device exists and belongs to the user, revocation executes atomically and returns HTTP 204 No Content.
  - Non-existent devices or devices belonging to other users return HTTP 404 (`{"error":"device_not_found"}`).

### Revocation Cascade

Device revocation executes within an atomic SQLite database transaction:

1. **Delete Sessions**: Deleting the device row cascades via foreign key (`ON DELETE CASCADE`) to all sessions linked to `device_id`, instantly revoking access across all active tokens for that device.
2. **Remove KeyPackages**: Unconsumed KeyPackages (`consumed = 0`) matching `(user_id, client_id)` are deleted from `key_packages`.
3. **Queue MLS Removes**: For every room the user participates in (`room_members`), an entry is inserted into `pending_mls_removes` with a new unique ID, `room_id`, `target_user_id`, and `target_client_id`.

### `pending_mls_removes` Table

The `pending_mls_removes` queue serves as a coordination point for Phase 10:
- When a device is revoked, MLS Remove proposals are queued per room.
- Phase 10 consumes this queue to construct and broadcast actual MLS Remove commits for room members.

## Invites

Server invite codes manage user onboarding after system bootstrap.

### Code Format & Security

- Invite codes are generated using **Crockford Base32** (`0123456789ABCDEFGHJKMNPQRSTVWXYZ`, excluding `I`, `L`, `O`, `U` to avoid visual confusion and offensive words) with cryptographically secure random generation (`OsRng`).
- Code length is configurable via `INVITE_CODE_LENGTH` (default `8`).
- **One-time code return**: An invite code is returned **only once**, in the JSON response of `POST /api/v1/admin/invites` upon creation. Subsequent `GET /api/v1/admin/invites` calls omit the code field to prevent code scraping.

### Permission Enforcement

- **`invite.unlimited`** (Owner / Admin): Can create invites with any valid `max_uses` or expiry, list all invites across all users, and revoke any invite.
- **`invite.limited`** (Inviter): Can create invites with `max_uses` bounded between `1` and `INVITE_LIMITED_MAX_USES` (default `10`), capped at `INVITE_LIMITED_MAX_OPEN` (default `50`) total active unredeemed invites. When listing invites, limited inviters see only invites created by themselves. Attempting to revoke another user's invite returns HTTP 404.

### Endpoints

- **`POST /api/v1/admin/invites`**: Creates a new invite code. Accepts optional `max_uses` (`0` = unlimited) and `expires_in_days` (`0` = never).
- **`GET /api/v1/admin/invites`**: Lists invites ordered by creation date descending. Accepts query parameters `include_revoked=true|false` and `created_by_me=true|false`.
- **`DELETE /api/v1/admin/invites/:id`**: Revokes an invite code (`revoked_at = CURRENT_TIMESTAMP`). Revoking an already revoked invite returns HTTP 409 Conflict.
- **`GET /api/v1/invites/:code`**: Public endpoint to validate an invite code before starting registration. Returns `{ "valid": true, "remaining_uses": N, "expires_at": "..." }` or `{ "valid": false, "reason": "not_found" | "expired" | "revoked" | "exhausted" }` with HTTP 200.

### Rate Limiting

Invite creation and public redemption validation are rate-limited using fixed time windows:

- `InviteCreate`: Hourly and daily limits per user ID (`RATE_INVITE_CREATE_HOURLY`, `RATE_INVITE_CREATE_DAILY`).
- `InviteRedeem`: Per-minute limit per IP address (`RATE_INVITE_REDEEM_PER_MIN`).

When a rate limit is exceeded, the server returns HTTP 429 Too Many Requests with a `Retry-After` header and response JSON body:
```json
{
  "error": "rate_limited",
  "message": "invite creation rate limit exceeded",
  "details": {
    "reset_at": "2026-09-27T15:00:00Z"
  }
}
```

### Registration Integration

During user registration (`POST /api/v1/auth/register/finish`), non-bootstrap registrations validate and consume the invite within an exclusive write transaction. Concurrent redemptions of a single-use invite are handled atomically so that exactly one registration succeeds and subsequent attempts fail with HTTP 403 (`{"error":"invalid or expired invite"}`).

## Admin API

Administrative configuration and limit management endpoints are guarded by the `config.edit` permission.

### Instance Config

Instance runtime configuration is stored as key-value pairs in the `instance_config` table.

#### Key Categories

- **Exposed Keys** (readable and editable via admin API):
  - `moderation_mode`: `"messenger"` | `"discord"`
  - `altcha_enabled`: `true` | `false`
  - `safety_number_mode`: `"warn"` | `"block"` | `"off"`
  - `push_enabled`: `true` | `false`
- **Secret Keys** (stored in DB but strictly omitted from admin API):
  - `altcha_hmac_secret`, `vapid_public_key`, `vapid_private_key`, `sockudo_app_key`, `sockudo_app_secret`

#### Config Endpoints

- **`GET /api/v1/admin/config`**: Returns non-secret exposed configuration options.
- **`PATCH /api/v1/admin/config`**: Updates exposed configuration keys. Rejects attempts to modify secret keys or unknown fields with HTTP 400. Automatically logs `config.update` audit entries.

### Instance Limits

Instance limits represent the middle tier of the three-tier resource limit hierarchy (`user_override` -> `instance_limit` -> `server_hard_max`).

#### Limits Endpoints

- **`GET /api/v1/admin/limits`**: Returns current instance limits alongside `server_hard_max` bounds.
- **`PATCH /api/v1/admin/limits`**: Accepts full `InstanceLimits` JSON payload. Rejects values exceeding `server_hard_max` or below key minimums with HTTP 400. Automatically logs `limits.update` audit entries.

## Audit Log

The audit logging system records administrative and operational events into the `audit_log` table using lexicographically sortable ULIDs for entry IDs.

### Logging Principles

- **Best-effort Execution**: Audit logging operations never block or fail primary requests. If an audit write fails, an error is logged and the operation continues.
- **Secret Protection**: Secret key values are **never** stored in audit entries. For secret updates (`secret.update`), metadata records only the key name.
- **Index Support**: Database indexes `idx_audit_actor_created`, `idx_audit_action_created`, and `idx_audit_created` optimize filtering and range queries.

### Audit Endpoint

- **`GET /api/v1/admin/audit`**: Returns paginated audit log entries ordered by creation date descending (`created_at DESC`).
  - Query parameters: `actor_id`, `action`, `target_type`, `target_id`, `before` (ISO 8601), `after` (ISO 8601), `per_page` (default 50, max 100).
  - Response includes `next_before` timestamp for cursor-based pagination.

## Readiness Check

- **`GET /ready`**: Public, unauthenticated endpoint for orchestrator and container readiness probes.
  - Checks database connection (`SELECT 1`), OPRF key availability, and Sockudo server health (if `SOCKUDO_URL` is configured).
  - Returns HTTP 200 with `{ "status": "ready", "checks": { "database": "ok", "oprf_key": "ok", "sockudo": "skipped" } }` when all active checks succeed.
  - Returns HTTP 503 with `{ "status": "not_ready", "checks": { ... } }` if any check fails.

## Cleanup Scheduler

The cleanup scheduler runs background maintenance jobs to keep the database bounded and enforce retention policies.

### Environment Variables

| Variable | Description | Default |
| --- | --- | --- |
| `CLEANUP_ENABLED` | Enable or disable the cleanup job scheduler (`true` or `false`). | `true` |
| `CLEANUP_INTERVAL_MINUTES` | Interval in minutes between scheduled cleanup cycles. | `60` |
| `CLEANUP_STARTUP_DELAY_SECS` | Initial startup delay in seconds before running the first cleanup cycle. | `30` |
| `AUDIT_RETENTION_DAYS` | Retention period in days for audit log entries. Set to `0` to disable audit log pruning. | `90` |

### Cleanup Jobs & Retention Policies

1. **`sessions`**: Deletes sessions where `expires_at < datetime('now', '-30 days')` or `revoked_at < datetime('now', '-30 days')`. Preserves active and recently expired/revoked sessions within the 30-day grace period.
2. **`rate_limits`**: Deletes expired rate limit windows older than 24 hours (`window_start < datetime('now', '-24 hours')`).
3. **`audit`**: Deletes audit log entries older than `AUDIT_RETENTION_DAYS` (`created_at < datetime('now', '-' || AUDIT_RETENTION_DAYS || ' days')`). Skips pruning when `AUDIT_RETENTION_DAYS=0`.
4. **`welcomes`**: Deletes stale onboarding welcome packets older than 7 days (`created_at < datetime('now', '-7 days')`).
5. **`memory_stores`**: Purges expired in-memory registration and login correlation states older than 5 minutes (`LOGIN_TTL`/`REGISTRATION_TTL`) from `RegistrationStore` and `LoginStore`.

### Sequential Execution

Cleanup jobs execute sequentially in registration order rather than in parallel. Because SQLite uses a single-writer concurrency model, sequential execution prevents database lock contention between cleanup jobs and minimizes impact on active application traffic.

### Disabling & Verification

For local development or debugging, disable the scheduler by setting:

```env
CLEANUP_ENABLED=false
```

When enabled, job execution status can be verified through structured application logs:

```
cleanup: job=sessions status=ok rows_deleted=0 duration_ms=2
cleanup: job=rate_limits status=ok rows_deleted=0 duration_ms=1
cleanup: job=audit status=ok rows_deleted=0 duration_ms=1
cleanup: job=welcomes status=ok rows_deleted=0 duration_ms=1
cleanup: job=memory_stores status=ok rows_deleted=0 duration_ms=0
```

### Future Planned Jobs

The following cleanup jobs are scheduled to be integrated in future phases:
- **Attachment Pruning**: Prunes orphaned and expired file attachments (Phase 12).
- **Message Retention Enforcement**: Prunes expired MLS message history according to room retention policies (Phase 10).

## GDPR Endpoints

The server provides endpoints to satisfy GDPR data subject rights for account deletion (Right to Erasure, Art. 17) and data portability (Right to Data Portability, Art. 20).

### Environment Variables

| Variable | Description | Default |
| --- | --- | --- |
| `DATA_RETENTION_DAYS` | Data retention period in days. Reserved for future message/attachment cleanup enforcement. | `0` |
| `EXPORT_RATE_LIMIT_HOURS` | Rate limit window in hours for `GET /api/v1/users/me/export`. | `24` |

### Account Deletion (`DELETE /api/v1/users/me`)

The deletion endpoint anonymises user personal data while maintaining referential integrity across shared conversation histories and system records.

#### Re-Authentication Requirement
- Account deletion is destructive and irreversible. To prevent unauthorized deletion via stale session tokens, the request session's `created_at` timestamp must be within the last **5 minutes** (300 seconds).
- If the session is older than 5 minutes, the server returns HTTP 403 Forbidden with `{"error":"fresh_session_required"}`. The client must re-authenticate via the two-round OPAQUE login flow (`/auth/login/start` and `/auth/login/finish`) to obtain a fresh session before retrying.
- The request body must explicitly contain `{"confirm": "DELETE"}`. Otherwise, the server returns HTTP 400 Bad Request with `{"error":"confirmation_required"}`.

#### Last-Owner Safeguard
- If the user has the `owner` role (`role_owner`) and is the **only remaining user with that role**, the deletion request is rejected with HTTP 409 Conflict (`{"error":"last_owner_cannot_delete"}`).
- This prevents accidentally rendering an instance unadministered. The owner role must be granted to another user before the account can be deleted.

#### Anonymisation Behavior
Instead of hard-deleting the user row (which would cascade and destroy shared messages or corrupt conversation threads for remaining room members), the deletion operation executes atomically in a single SQLite transaction:
1. Deletes all unconsumed KeyPackages (`consumed = 0`).
2. Deletes all push subscriptions.
3. Queues MLS Remove entries in `pending_mls_removes` for all rooms the user is a member of.
4. Deletes `recovery_vault` entries if present.
5. Deletes all devices, which cascades to delete active sessions.
6. Anonymises the `users` table row:
   - `username` is replaced with `deleted_<16_hex_chars>` to prevent collision while signaling deletion.
   - `username_hash` is replaced with random hex bytes so the original handle can be reused by new registrants.
   - `display_name` and `profile_blob` are set to `NULL`.
   - `opaque_registration` is replaced with 32 random bytes to prevent future authentication.
   - `identity_pubkey` is cleared (`""`).
   - `disabled_at` and `deleted_at` are set to `CURRENT_TIMESTAMP`.
7. Deletes `room_members` records for the user.
8. Writes an audit entry with action `user.delete`.

### Data Export (`GET /api/v1/users/me/export`)

The export endpoint allows users to download a machine-readable ZIP archive of their personal data.

#### Rate Limit
- Data exports are rate-limited to **1 export per `EXPORT_RATE_LIMIT_HOURS` window** (default 24 hours).
- Subsequent requests within the window return HTTP 429 Too Many Requests (`{"error":"rate_limited"}`).

#### Export Contents
The endpoint buffers and returns a synchronous ZIP file (`Content-Type: application/zip`) containing:
- **`profile.json`**: Account ID, username, display name, profile blob, roles, and creation timestamp.
- **`devices.json`**: Linked client devices and `last_seen` timestamps.
- **`sessions.json`**: Session history including creation, expiration, and revocation dates.
- **`rooms.json`**: Joined room IDs and membership dates.
- **`messages.json`**: Encrypted message history metadata (base64-encoded `mls_data`). Note that message content is end-to-end encrypted; the server holds only ciphertext and cannot decrypt message payloads.
- **`audit.json`**: Audit entries where the user was the actor (`actor_id = user_id`).
- **`README.txt`**: Standard archive notice detailing contents and security guidelines.

#### Audit Logging
- Every data export logs an audit entry with action `user.export`.

### Legal & Instance Controller Obligations

- The software provides the technical mechanisms for data erasure and portability under GDPR Art. 17 and Art. 20.
- Instance operators (data controllers) remain responsible for establishing appropriate legal bases, maintaining privacy notices, and adhering to local data protection regulation obligations.

## HTTPS and Static Hosting

### Reverse Proxy Requirement
TLS termination is performed at a reverse proxy (e.g. Traefik, Caddy, Nginx, or Coolify). The Axum application server listens on plain HTTP and expects reverse proxies to set standard forward headers when `TRUST_PROXY=true`.

#### Reverse Proxy Examples

**Coolify / Traefik (`dynamic.yml`):**
```yaml
http:
  routers:
    chat-router:
      rule: "Host(`chat.example.com`)"
      service: "chat-service"
      entryPoints: ["websecure"]
      tls:
        certResolver: "letsencrypt"
```

**Caddy (`Caddyfile`):**
```caddyfile
chat.example.com {
    reverse_proxy 127.0.0.1:8080
}
```

### Environment Variables

| Variable | Description | Default |
| --- | --- | --- |
| `TRUST_PROXY` | Set to `true` when running behind a trusted reverse proxy to read `X-Forwarded-Proto`. | `false` |
| `HSTS_MAX_AGE` | Duration in seconds for the `Strict-Transport-Security` header. Set to `0` to disable. | `31536000` |
| `HSTS_INCLUDE_SUBDOMAINS` | Include `; includeSubDomains` in the HSTS header when `true`. | `true` |
| `CLIENT_STATIC_DIR` | Optional directory path serving compiled SPA static files. Unset/empty in dev returns 404 for unmatched paths. | Unset |

### HTTPS Redirection & HSTS Behavior
- In `APP_ENV=production`, if `TRUST_PROXY=true` and `X-Forwarded-Proto: http` is received, the server returns `301 Moved Permanently` with a `Location` header directing clients to `{APP_URL}{path_and_query}`.
- When serving HTTPS requests in production, the `Strict-Transport-Security` header is included on responses if `HSTS_MAX_AGE > 0`.
- Development mode (`APP_ENV=development`) does not enforce redirects or send HSTS headers.

### Exemptions
- **`/health` and `/ready`**: Internal orchestrator probes (Kubernetes, Docker, Coolify) perform readiness and liveness checks over plain HTTP on local container networks. Requests to `/health` and `/ready` skip HTTPS redirection checks.

### Startup Validation
- Startup bails with a fatal error if `APP_ENV=production` and `APP_URL` does not start with `https://`:
  ```
  FATAL: APP_URL must use https:// in production (got "http://chat.example.com")
  ```
- A warning is logged at startup if `APP_ENV=production` and `TRUST_PROXY=false`:
  ```
  warn: TRUST_PROXY=false in production. Set TRUST_PROXY=true if behind a reverse proxy.
  ```

### Local Testing Middleware
You can simulate reverse proxy requests locally using `curl`:

```bash
# Test HTTP to HTTPS redirect
curl -i -H "X-Forwarded-Proto: http" http://localhost:8080/api/v1/capabilities

# Test HSTS header on HTTPS request
curl -i -H "X-Forwarded-Proto: https" http://localhost:8080/api/v1/capabilities
```

## Rooms

Rooms represent the unit of conversation in the system. Phase 7a implements relational room management, membership, permission enforcement, and room lifecycle control.

### Room Architecture & ID Generation

- **Server-Generated Room IDs**: Room IDs are cryptographically secure random 22-character base64url strings generated by the server (16 bytes of entropy). In Phase 10, this ID will be used as the MLS `group_id`.
- **Relational Representation**: Rooms are tracked via `rooms`, `room_members`, and `room_epochs` tables. Epoch state starts at epoch 0 with sequence 0.
- **1:1 vs Group Conversations**: 1:1 direct messages are represented as 2-member rooms.

### Permission Model & Roles

Per specification §3.2, the room `member` role allows sending messages, uploading attachments, and leaving rooms. Adding new members is restricted to the room owner:
- **Owner**: Can add members, delete the room, and manage room settings.
- **Member**: Can list members, read room metadata, and leave the room.
- **Non-Members**: All room-scoped endpoints return HTTP 404 (`{"error":"room_not_found"}`) to non-members to prevent existence probing.

### Leave Semantics & Implicit Transfer

When a member leaves a room (`POST /api/v1/rooms/:id/leave`):
1. **Sole Member**: If no other members remain, the room is deleted automatically (`outcome: "room_deleted"`).
2. **Regular Member**: The member is removed from `room_members` (`outcome: "left"`).
3. **Owner Leave**: Ownership automatically transfers to the longest-tenured moderator, or to the longest-tenured member if no moderators exist (`outcome: "transferred_ownership"`, returning `new_owner_id`).

### Three-Tier Resource Limits

Room creation and membership enforcement respects instance limits and server hard max bounds:
- **Rooms Per User (`rooms_per_user`)**: Enforced at room creation time (`RoomLimitReached` -> HTTP 409).
- **Room Size (`room_size`)**: Enforced when adding members (`RoomFull` -> HTTP 409).
- **Attachment Retention (`retention_days`)**: Optional room override clamped to `min(instance, server_max)` on creation.
- **File Size (`max_file_size_bytes`)**: Optional room override clamped to `min(instance, server_max)` on creation.

### Room Endpoints

- **`POST /api/v1/rooms`**: Creates a new room with the requesting user as the owner.
  - Body: `{"name_encrypted": "<base64|null>", "retention_days": 30, "max_file_size_bytes": 52428800}`
  - Returns HTTP 201 Created with `RoomWithRole`.
  - Errors: `room_limit_reached` (409), `invalid_retention` (400), `invalid_file_size` (400).
- **`GET /api/v1/rooms`**: Lists all rooms joined by the authenticated user, ordered by `joined_at DESC`.
- **`GET /api/v1/rooms/:id`**: Returns metadata and role for a joined room. Returns 404 if not a member.
- **`DELETE /api/v1/rooms/:id`**: Deletes a room. Owner-only (403 for regular members, 404 for non-members). Cascades to all child tables via foreign keys.
- **`POST /api/v1/rooms/:id/leave`**: Leaves a room. Returns `{ "outcome": "left" | "transferred_ownership" | "room_deleted", "new_owner_id": "..." }`. Returns 400 `not_a_member` for non-members.
- **`GET /api/v1/rooms/:id/members`**: Lists members in a room, ordered owner first, then moderators, then members by `joined_at ASC`. Member-only (404 for non-members).
- **`POST /api/v1/rooms/:id/members`**: Adds a user to a room. Owner-only.
  - Body: `{"user_id": "<target_user_id>"}`
  - Returns HTTP 201 Created with the new `RoomMember`.
  - Errors: `forbidden` (403), `user_not_found` (404), `already_member` (409), `room_full` (409).

### Moderation

Phase 7b adds moderation capabilities governed by instance-wide configuration (`moderation_mode` in `instance_config`):

- **Messenger mode (default)**: Only room owners can kick members. Moderators cannot exist, and promotion/demotion endpoints return 409 (`moderation_disabled`).
- **Discord mode**: Room owners can promote members to moderators and demote moderators to members. Both owners and moderators can kick members.

#### Moderation Permission Matrix

| Role | Kick Members | Promote / Demote Moderators | Explicit Ownership Transfer |
|---|---|---|---|
| `owner` | Yes (Messenger & Discord) | Yes (Discord mode only) | Yes |
| `moderator` | Yes (Discord mode only) | No | No |
| `member` | No | No | No |

#### Moderation Endpoints

- **`DELETE /api/v1/rooms/:id/members/:uid`**: Kicks a member from a room.
  - Owner or moderator (in Discord mode).
  - Returns HTTP 204 No Content on success.
  - Automatically queues MLS Remove entries in `pending_mls_removes` for every device associated with the kicked user.
  - Errors: `cannot_kick_self` (400), `cannot_kick_owner` (400), `forbidden` (403), `member_not_found` (404), `room_not_found` (404).
- **`POST /api/v1/rooms/:id/members/:uid/promote`**: Promotes a member to moderator (Discord mode only).
  - Owner-only.
  - Returns HTTP 204 No Content on success.
  - Errors: `cannot_modify_owner` (400), `forbidden` (403), `member_not_found` (404), `room_not_found` (404), `moderation_disabled` (409), `already_moderator` (409).
- **`POST /api/v1/rooms/:id/members/:uid/demote`**: Demotes a moderator to member (Discord mode only).
  - Owner-only.
  - Returns HTTP 204 No Content on success.
  - Errors: `cannot_modify_owner` (400), `forbidden` (403), `member_not_found` (404), `room_not_found` (404), `moderation_disabled` (409), `not_a_moderator` (409).
- **`POST /api/v1/rooms/:id/transfer`**: Explicitly transfers room ownership to another member.
  - Owner-only.
  - Body: `{"user_id": "<new_owner_user_id>"}`
  - Returns HTTP 204 No Content on success.
  - Atomically updates target's role to `owner`, requester's role to `member`, and room `owner_id` to the target.
  - Errors: `cannot_transfer_to_self` (400), `forbidden` (403), `member_not_found` (404), `room_not_found` (404).

#### Leave vs Transfer

- **Leave (`POST /api/v1/rooms/:id/leave`)**: Implicit handover triggered when the owner leaves the room. Ownership automatically passes to the longest-tenured moderator (or longest-tenured member), and the previous owner is removed from the room.
- **Transfer (`POST /api/v1/rooms/:id/transfer`)**: Explicit handover designated by the owner. The previous owner remains in the room as a regular `member`.

## Room Invites

Room invite codes allow room members to grant room membership to other users via shareable tokens without needing to know the invitee's user ID.

### Server Invites vs Room Invites

- **Server Invites**: Grant the ability to create an account on the instance during onboarding.
- **Room Invites**: Grant membership in a specific room. The recipient must already have an account on the instance.

### Permission Model & Creation

- **Any Room Member**: Unlike adding members directly (owner-only), any room member can create and revoke room invites.
- **Code Return Security**: Invite codes are returned **only once** upon creation (`POST /api/v1/rooms/:id/invites`). Subsequent listing calls (`GET /api/v1/rooms/:id/invites`) omit the code field to prevent code scraping.
- **Crockford Base32**: Codes are generated using uppercase Crockford Base32 characters (`0123456789ABCDEFGHJKMNPQRSTVWXYZ`) with configurable length (`ROOM_INVITE_CODE_LENGTH`, default `8`).
- **Expiry & Uses**: Room invites do not expire by default unless `expires_in_days` (1–365) is explicitly requested. `max_uses` defaults to `ROOM_INVITE_DEFAULT_USES` (default `1`, `0` = unlimited).

### Endpoints

- **`POST /api/v1/rooms/:id/invites`**: Generates a new room invite code. Member-only (404 `room_not_found` for non-members).
  - Body: `{"max_uses": 5, "expires_in_days": 30}` (optional).
  - Returns HTTP 201 Created with full invite object including `code`.
  - Errors: `invalid_max_uses` (400), `invalid_expiry` (400), `room_not_found` (404).
- **`GET /api/v1/rooms/:id/invites`**: Lists room invites for a room. Member-only.
  - Query parameter: `include_revoked=true|false` (default `false`).
  - Returns HTTP 200 OK with `invites` array (**code field omitted**).
- **`DELETE /api/v1/rooms/:id/invites/:invite_id`**: Revokes a room invite. Any member can revoke any invite in the room.
  - Returns HTTP 204 No Content on success.
  - Errors: `room_not_found` (404), `invite_not_found` (404, returned also if already revoked).
- **`POST /api/v1/rooms/join`**: Publicly redeem a room invite code to join a room.
  - Body: `{"code": "ABCD1234"}`
  - Returns HTTP 200 OK with `{"room_id": "...", "member_role": "member", "already_member": false}`.
  - If the user is already a member, returns `already_member: true` without consuming a use count.

### Error Semantics & HTTP Status Codes

- **HTTP 404 (`invite_not_found`)**: Code was never valid or does not exist.
- **HTTP 410 Gone (`invite_revoked`, `invite_expired`, `invite_exhausted`)**: Code existed but is no longer usable. This distinguishes terminal state errors from non-existent codes for client UX messaging.
- **HTTP 409 Conflict (`room_full`)**: The room capacity limit (`room_size`) has been reached. Does not consume an invite use.

### Concurrency & Rate Limiting

- **`BEGIN IMMEDIATE` Write Serialization**: Invite redemption uses `BEGIN IMMEDIATE` transactions to prevent write lock contention and race conditions on single-use invite redemptions.
- **Rate Limiting**: Protected by the `InviteRedeem` rate limit (`RATE_INVITE_REDEEM_PER_MIN`, default 10 requests per minute per IP address). Exceeding limit returns HTTP 429 `rate_limited`.
- **Case Sensitivity**: Codes are strictly case-sensitive uppercase. Clients must normalize user input to uppercase before submission.

### Future Integration (Phase 10)

Phase 8 handles the relational room membership and invite lifecycle. Phase 10 will extend `/rooms/join` to automatically trigger MLS Welcome packet generation for joining devices.

## KeyPackages

KeyPackages are single-use, pre-generated credentials used in MLS (Message Layer Security) to add users to group conversations. The server operates as a blind mailbox — storing opaque KeyPackage payloads and serving them when requested by peers.

### Endpoints

- **`POST /api/v1/keypackages`**: Uploads a batch of KeyPackages for devices owned by the authenticated user.
  - Body: `{"packages": [{"client_id": "...", "cipher_suite": 1, "key_package_data": "<base64>", "is_last_resort": false}]}`
  - Validation: Batch size 1–50. `client_id` must match a device registered to the user. `cipher_suite` 1–255. `key_package_data` base64 decoding to 1 byte – 64 KB.
  - Returns HTTP 201 Created with `{ "uploaded": N, "unconsumed_count": M }`.
- **`GET /api/v1/keypackages/count`**: Returns unconsumed KeyPackage counts for the authenticated user.
  - Returns HTTP 200 OK with `{ "total": M, "by_client": { "client_id_1": count, ... } }`.
- **`POST /api/v1/keypackages/claim`**: Claims an unconsumed KeyPackage for a target user.
  - Body: `{"user_id": "<target_user_id>"}`
  - Returns HTTP 200 OK with the claimed package fields.
  - Errors: `no_packages_available` (404), `user_not_found` (404), `rate_limited` (429).

### Quota Enforcement

- Upload quota is checked per `(user_id, client_id)` pair inside a `BEGIN IMMEDIATE` SQLite transaction.
- Quota limit is calculated from instance setting `keypackages_per_device` (default 20), clamped to server hard max `SERVER_MAX_KEYPACKAGES_PER_DEVICE` (50).
- Exceeding the quota returns HTTP 409 Conflict (`{"error":"quota_exceeded"}`).

### Claim Preference & Last-Resort Semantics

- Claims execute atomically using `BEGIN IMMEDIATE` transactions to prevent concurrent claims from receiving the same KeyPackage.
- Claims always select the **oldest unconsumed non-last-resort package** first.
- Non-last-resort packages are marked consumed (`consumed = 1`, `consumed_at = CURRENT_TIMESTAMP`) upon claim.
- If no normal packages exist, claim falls back to the **oldest unconsumed last-resort package** (`is_last_resort = 1`).
- Last-resort packages remain unconsumed when claimed and can be claimed multiple times (per RFC 9420 last-resort fallback semantics).
- V1 stores `is_last_resort` flags and respects claim preference, but does **not** enforce exhaustion fallback tracking or last-resort package replenishment logic.

### Rate Limiting

- KeyPackage claims are rate-limited per claiming user using fixed time windows:
  - `RATE_KP_CLAIM_PER_MIN` (default 30 claims/min)
  - `RATE_KP_CLAIM_HOURLY` (default 200 claims/hour)
- Exceeding either limit returns HTTP 429 Too Many Requests (`{"error":"rate_limited"}`).

### Integration with Phase 10

Phase 10 (epoch linearization and Welcome generation) will consume `pending_mls_removes` and claim KeyPackages to construct and deliver MLS Welcome packets to newly added devices.

## Messages and Welcomes

Phase 10 delivers messaging support, welcome packet routing, and MLS epoch linearization via compare-and-swap (CAS) semantics.

### Table Schema

- **`room_messages`**: Stores committed MLS ciphertexts.
  - Columns: `id` (ULID), `room_id`, `sender_user_id`, `sender_client_id`, `epoch`, `seq`, `content_type` (`application`, `commit`, `proposal`), `ciphertext` (BLOB), `created_at`.
  - Indexes: `idx_room_messages_room_epoch_seq`, `idx_room_messages_room_created`, `idx_room_messages_sender`.
- **`welcomes`**: Stores encrypted onboarding welcome packets for new room members.
  - Columns: `id` (ULID), `room_id`, `recipient_user_id`, `recipient_client_id`, `welcome_data` (BLOB), `consumed` (0 or 1), `created_at`.
  - Index: `idx_welcomes_recipient`.
- **`room_epochs`**: Extended with `confirmed_transcript_hash` (BLOB) and `updated_at`. Tracks room state epoch and current monotonic sequence number.

### Messaging & MLS Epoch CAS Semantics

- **Message Content Types**:
  - `application`: Monotonically increments `sequence` within the current epoch.
  - `proposal`: Sequenced identically to application messages within the current epoch.
  - `commit`: Advances `epoch` to `current_epoch + 1`, resets `sequence` to `0`, and updates `confirmed_transcript_hash`. Requires a 32-byte base64-encoded `transcript_hash`.
- **Epoch Linearization Guarantee**:
  - Submissions execute within `BEGIN IMMEDIATE` transactions to prevent write races.
  - If a message or commit is submitted at an outdated epoch, the server returns HTTP 409 Conflict with error `epoch_mismatch` and details `{"expected": <current_epoch>, "received": <stale_epoch>}`.
  - **Re-merge Workflow**: When receiving 409 `epoch_mismatch`, the client fetches the latest epoch (`GET /api/v1/rooms/:id/epoch`), retrieves missed commits (`GET /api/v1/rooms/:id/messages?since_epoch=N`), downloads commit ciphertexts (`GET /api/v1/rooms/:id/messages/:message_id/ciphertext`), re-merges local proposals, and retries the commit at the new epoch.

### Welcome Routing Flow

- **Creation**: When adding a member (`POST /api/v1/rooms/:id/members`), providing optional `welcome_data` creates a welcome row targeted at the recipient's primary (most recently registered) device. If the target has no devices registered, returns HTTP 400 Bad Request (`{"error":"target_has_no_device"}`).
- **Consumption**: Recipient lists unconsumed welcomes via `GET /api/v1/welcomes`, fetches the welcome ciphertext via `GET /api/v1/welcomes/:id`, and marks it consumed via `POST /api/v1/welcomes/:id/consume`. Attempting to consume an already-consumed welcome returns HTTP 409 Conflict (`{"error":"already_consumed"}`).
- **Multi-Device Welcome Limitation**: Phase 10 attaches welcome packets to the target's most recent device. Multi-device welcome fanout is managed at the client / MLS layer in Phase 11.

### Scope Boundaries

- Phase 10 implements server-side persistence and CAS linearization.
- Real-time Sockudo event delivery, WebSocket subscriptions, catch-up replay, and `pending_mls_removes` consumption are deferred to Phase 11.

## Sockudo Integration

Phase 11 integrates Sockudo for push-based real-time event delivery and exposes pending MLS removes for client-side processing.

### Overview & Pusher Protocol

- **Protocol**: Clients connect directly to Sockudo via WebSocket using the Pusher protocol.
- **App Credentials**: On first startup with default settings (`SOCKUDO_APP_KEY=auto`, `SOCKUDO_APP_SECRET=auto`), the server generates 24-byte random app keys and 32-byte random secrets, persisting them in `instance_config`. External credentials can be provided via environment variables.
- **Private Channels**: Public channels are not used. All room channels follow the naming convention `private-room-<room_id>`.

### Channel Authentication (`POST /api/v1/sockudo/auth`)

Before Sockudo allows a WebSocket client to subscribe to a private channel, the client requests a signature from the server:
- Body: `{"socket_id": "1234.5678", "channel_name": "private-room-<room_id>"}`
- Validation:
  - `socket_id` must match `^\d+\.\d+$` (HTTP 400 `invalid_socket_id`).
  - `channel_name` must start with `private-room-` (HTTP 400 `invalid_channel_name`).
  - Requesting user must be an active member of the room. Rejects non-members and non-existent rooms uniformly with HTTP 403 `forbidden` to prevent room enumeration.
- Response: `{ "auth": "<app_key>:<signature_hex>" }` computed via `HMAC-SHA256(app_secret, "socket_id:channel_name")`.

### Realtime Publish Flow

When a client submits a message or commit (`POST /api/v1/rooms/:id/messages`):
1. The message transaction completes and commits to `room_messages` / `room_epochs`.
2. After transaction commit, the server asynchronously publishes a Pusher event named `message` to `private-room-<room_id>`.
3. Event Payloads (Metadata only — **no ciphertext**):
   - Commit: `{ "type": "commit", "message_id": "...", "sender_user_id": "...", "sender_client_id": "...", "new_epoch": N, "created_at": "..." }`
   - Application / Proposal: `{ "type": "application", "message_id": "...", "sender_user_id": "...", "sender_client_id": "...", "epoch": N, "seq": M, "created_at": "..." }`
4. Delivery is **advisory**: If publishing fails or Sockudo is down, message submission still succeeds (HTTP 201). Clients catch up on missed events via polling `GET /api/v1/rooms/:id/messages?since_epoch=N`.

### Why Ciphertext is Omitted from Events

Ciphertexts are intentionally omitted from event payloads to prevent network fanout amplification (e.g. broadcasting 64 KB to 100 members produces 6.4 MB of traffic) and preserve database-backed message list durable storage as the single source of truth. Subscribed clients fetch ciphertexts on demand via `GET /api/v1/rooms/:id/messages/:message_id/ciphertext`.

### Pending MLS Removes Workflow

The server queues remove intentions in `pending_mls_removes` when members or devices are removed, but never generates MLS commits server-side (as MLS state is held strictly client-side):
1. A member is kicked or a device is revoked.
2. `pending_mls_removes` queues an entry for each target device.
3. Active room members list pending removes via `GET /api/v1/rooms/:id/pending-removes`.
4. The client constructs an MLS Remove commit and submits it via `POST /api/v1/rooms/:id/messages`.
5. Upon successful commit submission, the client marks the remove consumed via `POST /api/v1/rooms/:id/pending-removes/:remove_id/consume` (HTTP 204). Consuming twice returns HTTP 404 (`remove_not_found`).

### Client Catch-Up & Realtime Architecture

1. Client fetches capabilities (`GET /api/v1/capabilities`) to get `websocket_url`, `sockudo_app_key`, and `sockudo_channel_prefix`.
2. Client connects to Sockudo WebSocket and requests channel auth for `private-room-<room_id>`.
3. Client receives `message` events in real time.
4. Client fetches ciphertexts on demand and periodically polls `GET /api/v1/rooms/:id/messages?since_epoch=N` on reconnect or network interruption.
5. Client lists and processes `GET /api/v1/rooms/:id/pending-removes` to complete room membership removals.

## Attachments

Phase 12 delivers encrypted attachment storage, HTTP Range streaming support, and S3 presigned URLs.

### Client-Side Encryption & Wire Format

The server stores opaque padded ciphertext and never sees plaintext or encryption keys. File encryption is performed client-side using C2SP chunked AES-256-GCM:

```
+-------------------------------------------------------------------------+
|                              Blob (Total Bytes)                        |
+-------------------+--------------------+------------------+-------------+
| Header (56 bytes) | Chunk 0 (16 KB+16) | Chunk 1 (16 KB+16) | Tail Chunk  |
+-------------------+--------------------+------------------+-------------+
```

1. **Header Offset (56 bytes)**:
   - `salt` (24 bytes)
   - `commitment` (32 bytes)
2. **Chunk Derivation**:
   - Fixed protocol chunk size: 16 KiB (16,384 bytes plaintext).
   - Each chunk contains 16 KiB of plaintext plus a 16-byte AES-256-GCM authentication tag (16,400 bytes ciphertext per chunk).
   - Independent chunk encryption enables random-access seeking and partial decryption in Phase 12b.

### Content-Addressing & Manifest Metadata

- **Storage Key**: Attachments are content-addressed by SHA-256 hex digest of the padded ciphertext: `attachments/{id[0..2]}/{id[2..4]}/{id}`.
- **MLS Application Message**: The client embeds the encryption key and attachment `id` in the MLS application message payload.
- **Manifest Fields**:
  - `chunk_size`: Fixed protocol chunk size (16,384 bytes).
  - `chunk_count`: Total chunks including padding tail.
  - `nonce_prefix`: Base64-encoded 7-byte nonce prefix.
  - `base_counter`: 32-bit counter for IV derivation.
  - `plaintext_size`: Original unpadded file size.
  - `encrypted_size`: Total padded ciphertext size.

### Storage Backends

Storage is selected at startup via `STORAGE_BACKEND`:

- **Filesystem (`fs`)**: Default backend storing files at `STORAGE_FS_PATH` (default `./data/attachments`) using two-level subfolder sharding (`attachments/ab/cd/abcd...`). Writes are made to temporary files (`.tmp`) and atomically renamed.
- **S3 (`s3`)**: Object storage backend via `rust-s3`. Requires `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, and `S3_SECRET_ACCESS_KEY`. Set `S3_PATH_STYLE=true` for MinIO or self-hosted S3 endpoints.

### Bucket Sizes

To prevent metadata side-channel leaks about exact file sizes, uploaded file data must pad to one of the configured strictly increasing bucket sizes:
```env
ATTACHMENT_BUCKET_SIZES=65536,524288,4194304,33554432,268435456
```
Each bucket size must be a positive multiple of 4096 bytes.

### Endpoints & Upload Paths

All endpoints require room membership and authentication via `AuthUser`.

- **`POST /api/v1/rooms/:id/attachments`**:
  - Supports two upload paths:
    - **Multipart (`multipart/form-data`)**: `file` binary part alongside manifest fields (`claimed_id`, `plaintext_size`, `encrypted_size`, `chunk_size`, `chunk_count`, `nonce_prefix`, `base_counter`, `content_type`, `uploader_client_id`).
    - **Octet-stream (`application/octet-stream`)**: Binary payload in HTTP request body with manifest metadata in custom headers (`X-Claimed-Id`, `X-Plaintext-Size`, `X-Encrypted-Size`, `X-Chunk-Size`, `X-Chunk-Count`, `X-Nonce-Prefix`, `X-Base-Counter`, `X-Content-Type`, `X-Uploader-Client-Id`).
  - Hash Verification: The server computes SHA-256 of the binary payload before writing to storage. Mismatches return HTTP 400 (`{"error":"hash_mismatch"}`).
  - Idempotent Re-upload: Uploading an identical blob to the same room by the same uploader returns the existing attachment record without re-writing storage.
- **`GET /api/v1/attachments/:id`**:
  - Serves full encrypted blob or requested byte ranges with `Content-Type: application/octet-stream` and `X-Content-Type-Options: nosniff`.
  - Headers: Includes `Accept-Ranges: bytes` on both 200 OK and 206 Partial Content responses so video/audio players know seeking is supported. Includes metadata headers (`X-Attachment-Content-Type`, `X-Attachment-Chunk-Size`, `X-Attachment-Chunk-Count`, `X-Attachment-Plaintext-Size`, `X-Attachment-Encrypted-Size`, `X-Attachment-Nonce-Prefix`, `X-Attachment-Base-Counter`).
  - Caching & ETag: Includes `Cache-Control: private, max-age=86400, immutable` and `ETag: "<id>"`. Requests with matching `If-None-Match` return `304 Not Modified` (ETag validation takes precedence over range requests per RFC 7233).
  - **Range Requests**: Supports single byte-range requests via the `Range` header:
    - `Range: bytes=0-1023` -> returns HTTP `206 Partial Content` with `Content-Range: bytes 0-1023/<padded_size>` and `Content-Length: 1024`.
    - `Range: bytes=1024-` -> returns HTTP `206 Partial Content` with bytes from offset 1024 through the end of the blob.
    - `Range: bytes=-1024` -> returns HTTP `206 Partial Content` with the last 1024 bytes.
    - Ranges extending beyond total file size are clipped to `total_size - 1`.
    - Out-of-bounds start positions (`start >= total_size`), malformed syntax, multiple ranges, or non-`bytes` units return HTTP `416 Range Not Satisfiable` with no body and `Content-Range: bytes */<padded_size>`.
- **`POST /api/v1/attachments/:id/presign`**:
  - Generates a TTL-limited presigned URL for direct download from S3 backends (`storage_backend == "s3"`).
  - Body: `{"expires_in_seconds": 300}` (optional; defaults to `S3_PRESIGN_TTL_SECONDS`).
  - TTL Clamping: Requested TTL is clamped to `[30, 2 × S3_PRESIGN_TTL_SECONDS]` (default clamping window 30s to 1200s).
  - Filesystem Backends: Returns HTTP `501 Not Implemented` (`{"error":"presign_not_supported"}`).
  - Access & Rate Limiting: Requires room membership. Rate limited per user (`RATE_PRESIGN_PER_MIN`, default 60/min). Exceeding limit returns HTTP 429 `rate_limited` with `details: { reset_at }`.
- **`DELETE /api/v1/attachments/:id`**:
  - Uploader-only deletion. Returns HTTP 204 No Content on success, HTTP 403 Forbidden for non-uploaders, and HTTP 404 for missing attachments.
  - Database row deletion commits first; blob removal from disk/S3 occurs post-commit best-effort.

### Client-Side Range Translation & Batching

The server serves requested raw byte offsets without interpreting plaintext semantics. The client translates desired plaintext byte ranges into encrypted C2SP byte bounds using manifest metadata:

```
plaintext_range = [p_start, p_end]   // e.g. [60000, 70000]
start_chunk = p_start / 16384
end_chunk   = p_end / 16384

encrypted_start = 56 + start_chunk * (16384 + 16)
encrypted_end   = 56 + (end_chunk + 1) * (16384 + 16) - 1

Header: Range: bytes=encrypted_start-encrypted_end
```

**Range Batching Guidance**:
Clients can batch multiple consecutive chunks in a single HTTP `Range` request spanning `start_chunk` through `end_chunk`. The maximum batch size equals the largest bucket size configured on the server.

### Media Streaming & Presigned URL Expiry

- **MP4 Fast-Start Requirement**: Clients must validate/re-encode MP4 video files with fast-start (`moov` atom placed before `mdat`) prior to upload. Fast-start allows video players to immediately parse index metadata and begin playback without downloading the entire file.
- **Presign URL Expiry Handling**: Clients should not cache presigned URLs beyond their `expires_at` timestamp. A fresh presigned URL should be requested per seek or per chunk batch to avoid 403 errors from S3.

### Retention

Attachments are pruned by a scheduled job that runs as part of the cleanup
scheduler. The retention window is computed per room as:

    effective_retention = MIN(
        room.retention_days,
        instance.attachment_retention_days,
        server_max.attachment_retention_days
    )

A value of `0` at any tier means "retain forever." Because `0` is the least
restrictive value, if any tier specifies `0`, the effective retention is `0`
and nothing is pruned.

The pruning job runs hourly. It queries rooms with attachments, computes
each room's effective retention, and deletes attachments whose `created_at`
is older than the cutoff.

**Blob deletion is best-effort.** The database row is deleted first, then
the blob. If the blob delete fails, the blob becomes orphaned but harmless.
Orphaned blobs are logged at `warn` and counted in the job's report. A
future orphan-scan job can clean them up.

**Retention does not accelerate deletion.** Deleting an attachment explicitly
(via `DELETE /attachments/:id`) removes the row immediately, but a message
tombstone (Phase 11b) does not accelerate the attachment's pruning. The
retention policy governs both.

### Capabilities Advertisement

`GET /api/v1/capabilities` advertises attachment and storage capabilities:
```json
{
  "storage_backend": "fs",
  "storage_presign_supported": false,
  "storage_presign_max_ttl_seconds": 0,
  "attachment_accept_ranges": true,
  "attachment_format": "c2sp-chunked-aes256gcm-v1",
  "attachment_chunk_size": 16384,
  "attachment_bucket_sizes": [65536, 524288, 4194304, 33554432, 268435456]
}
```

### Known Limitations

- **Cryptographic Shredding**: Once a peer downloads and caches a blob, the server cannot force its deletion from peer devices.
- **Presigned URL Scope**: Presigned URLs grant access to the entire encrypted object for the duration of the TTL. Clients attach a `Range` header directly when fetching from S3.
- **Orphaned Blobs on Room Deletion**: Room deletion cascades database attachment rows (`ON DELETE CASCADE`), but underlying storage blobs remain in filesystem/S3 storage until a background orphan-scan job is implemented.

## Backups

The server includes an automated backup mechanism that snapshots the SQLite database and OPRF key file on a configurable interval.

### Environment Variables

| Variable | Description | Default |
| --- | --- | --- |
| `BACKUP_ENABLED` | Enable or disable the backup job scheduler (`true` or `false`). | `true` |
| `BACKUP_PATH` | Path where backup files are stored on disk. | `./data/backups` |
| `BACKUP_INTERVAL_HOURS` | Interval in hours between automated backups. | `24` |
| `BACKUP_RETENTION_COUNT` | Number of backups to retain. `0` keeps all backups. | `30` |
| `BACKUP_INCLUDE_ATTACHMENTS` | Whether to include filesystem attachment files in backups. | `false` |

### Encryption Scheme & Key Derivation

Backups are encrypted at rest using **AES-256-GCM**:
- **Key Derivation**: The 32-byte backup encryption key is derived via `HKDF-Expand` (SHA-256) from the OPRF key file contents (`OPAQUE_OPRF_KEY_PATH`) using the info string `"backup-encryption-v1"`.
- **Nonce & Tag**: A random 12-byte nonce is generated per backup file using `OsRng`. The 16-byte GCM authentication tag is appended to the ciphertext.
- **On-Disk Format**: `[12 bytes: nonce] [ciphertext] [16 bytes: tag]` (extension `.cbak`).

### Archive Format

Each decrypted backup is an uncompressed POSIX `tar` archive containing:
1. `manifest.json`: Metadata including ISO 8601 creation timestamp, server version, original database path, OPRF key path, storage backend, and attachment count. Written as the first entry in the archive.
2. `app.db`: A consistent snapshot of the SQLite database file, taken after performing `PRAGMA wal_checkpoint(TRUNCATE)`.
3. `oprf.key`: The OPRF key file contents.
4. `attachments/`: (Optional) Filesystem attachment blobs when `BACKUP_INCLUDE_ATTACHMENTS=true` and `STORAGE_BACKEND=fs`.

### Admin API Endpoints

Backups are managed via the Admin API, requiring the `backup.manage` permission (granted to `owner` and `admin` roles):

- **`GET /api/v1/admin/backups`**: Lists existing backup files ordered by creation date descending (`created_at DESC`).
  - Returns HTTP 200 with `{ "backups": [ { "filename": "backup-2026-09-29T14-30-00Z.cbak", "size_bytes": 1048576, "created_at": "..." } ] }`.
  - Returns HTTP 501 `{"error":"backup_disabled"}` if `BACKUP_ENABLED=false`.
- **`POST /api/v1/admin/backups`**: Synchronously triggers a manual backup.
  - Returns HTTP 201 Created with `{ "filename": "...", "size_bytes": N, "created_at": "..." }`.
  - Concurrent manual or scheduled backups are locked via a mutex (`backup_lock`). Returns HTTP 409 Conflict (`{"error":"backup_in_progress"}`) if another backup is running.
  - Returns HTTP 501 `{"error":"backup_disabled"}` if `BACKUP_ENABLED=false`.

### Restore Procedure (`server restore`)

Restoring from a backup is **CLI-only** and requires shell access to the host machine. It is intentionally omitted from the HTTP API.

1. **Stop the server process** to release database file locks.
2. **Ensure the OPRF key file is present** at `OPAQUE_OPRF_KEY_PATH`. The OPRF key file is required to derive the backup decryption key.
3. **Execute the restore command**:
   ```bash
   ./target/release/server restore --from ./data/backups/backup-2026-09-29T14-30-00Z.cbak --confirm
   ```
4. **Start the server process**.

> **Note**: Restoring without `--confirm` will abort with an error.

### Constraints & Limitations

- **S3 Attachment Blobs**: Attachment blobs stored on S3 are **not** backed up by the server. Operators should rely on S3 bucket versioning and lifecycle policies. Setting `BACKUP_INCLUDE_ATTACHMENTS=true` when `STORAGE_BACKEND=s3` causes a fatal startup error.
- **OPRF Key Dependency**: Moving a backup file to a fresh server deployment requires copying the original OPRF key file first, as the backup key is derived from it.
- **First Backup Delay**: The backup scheduler runs its first cycle after a **60-second** initial startup delay to allow the server to settle before taking snapshots.

## Push Subscriptions

The server supports Web Push (VAPID) and native push notification subscription management for clients.

### Overview & VAPID Key Management

VAPID (Voluntary Application Server Identification) key pairs allow web browsers to verify the application server sending push notifications.

- **`PUSH_ENABLED`**: Default `true`. Controls whether push subscription functionality is active.
- **`PUSH_VAPID_PUBLIC_KEY`** and **`PUSH_VAPID_PRIVATE_KEY`**: Default `"auto"`.
  - In `"auto"` mode, the server generates a P-256 key pair on first startup and persists both keys in `instance_config`. Subsequent restarts load the persisted key pair.
  - In explicit mode, both env vars must provide base64url-encoded keys (public key 65 bytes starting with `0x04`, private key 32 bytes). Mixed auto/explicit configurations fail startup validation.
- **Security**: The private key is kept strictly secret in `instance_config` and memory, and is never logged or exposed in API responses. The public key is exposed via `GET /api/v1/capabilities` so clients can subscribe.

### Endpoints

1. **`POST /api/v1/users/me/push-subscriptions`**
   - Registers or updates a push subscription.
   - **Web / Desktop Payload**: Requires `platform` (`"web"` or `"desktop"`), `endpoint`, `p256dh`, `auth`, and `browser_id`.
   - **iOS / Android Payload**: Requires `platform` (`"ios"` or `"android"`), `push_token`, and optional `device_id`.
   - **Web Reregistration**: Keyed by `(user_id, browser_id)`. Re-registering with the same `browser_id` updates the existing subscription row in-place rather than creating duplicates.
   - **Response**: HTTP 201 Created returning `PushSubscriptionView` (`id`, `platform`, `browser_id`, `device_id`, `created_at`, `last_used_at`). Secret fields (`endpoint`, `p256dh`, `auth`, `push_token`) are omitted.
2. **`GET /api/v1/users/me/push-subscriptions`**
   - Lists active subscriptions for the authenticated user (`revoked_at IS NULL`).
   - Returns `{ "subscriptions": [...] }`. Secrets are omitted.
3. **`DELETE /api/v1/users/me/push-subscriptions/:id`**
   - Revokes a subscription by setting `revoked_at = CURRENT_TIMESTAMP`.
   - Returns HTTP 204 No Content. Returns HTTP 404 if not found or owned by another user.

### Device Revocation Cascade

When a user revokes a device (`DELETE /api/v1/users/me/devices/:id`), all push subscriptions associated with that `device_id` are hard-deleted inside the revocation transaction. Subscriptions without a `device_id` are preserved.

### Capabilities Advertisement

`GET /api/v1/capabilities` includes:
- `push_enabled`: boolean indicating if push is enabled.
- `push_vapid_public_key`: base64url string when `push_enabled == true`, or `null` when disabled.

### Delivery

When an application message is submitted (`POST /api/v1/rooms/:id/messages`), the server composes a notification payload and dispatches it in the background to all eligible subscribed devices belonging to room members.

#### Environment Variables

| Variable | Description | Default |
| --- | --- | --- |
| `PUSH_DELIVERY_ENABLED` | Enable or disable background push delivery (`true` or `false`). Requires `PUSH_ENABLED=true`. | `true` |
| `PUSH_SUPPRESSION_WINDOW_SECS` | Time window in seconds to suppress push for devices with active WebSocket sessions. | `30` |
| `PUSH_DELIVERY_TIMEOUT_SECS` | Timeout in seconds for individual push delivery requests. | `10` |
| `PUSH_MAX_CONCURRENT_DELIVERIES` | Maximum number of in-flight concurrent delivery requests. | `32` |
| `PUSH_VAPID_SUBJECT` | Contact URI / mailto / URL for VAPID JWT `sub` claim. Defaults to `APP_URL` or `mailto:admin@<app_name>`. | Unset |

#### Dispatch Flow & Per-Device Suppression

1. **Trigger**: Delivery is triggered upon application message submission. Commits and proposals do not trigger push notifications.
2. **Detached Execution**: Dispatch is spawned as a detached background task (`tokio::spawn`), allowing the message submission HTTP response to return immediately without waiting for push delivery. Push delivery is advisory — failures do not affect message submission.
3. **Recipient Lookup**: Room members are fetched excluding the sender (users do not receive push for their own messages).
4. **Per-Device Suppression**: Active sessions (`sessions.last_seen_at`) are checked per device. If a device has updated its session within `PUSH_SUPPRESSION_WINDOW_SECS` (confirmed via session heartbeat), push delivery to that specific device is suppressed. Other devices belonging to the same user still receive push notifications.
5. **Batch Dispatch**: Eligible subscriptions are dispatched concurrently, bounded by `PUSH_MAX_CONCURRENT_DELIVERIES` using stream buffering.

#### Web Push Payload Schema (V1)

Notifications carry metadata only:

```json
{
  "type": "message",
  "room_id": "<room_id>",
  "sender_user_id": "<user_id>",
  "encrypted_payload": "",
  "notification_id": "<ulid>",
  "priority": "high",
  "collapse_key": "<room_id>",
  "timestamp": "<ISO 8601>"
}
```

- `encrypted_payload`: Empty in V1. The server does not see message plaintext. Upon receiving a notification, the client's service worker uses `room_id` and `sender_user_id` to show a notification, fetches missing message ciphertexts via the delta sync API, and decrypts locally using the room key.
- `collapse_key`: Set to `room_id` so the push service collapses multiple incoming messages in the same conversation into a single notification.

#### Result Handling & Subscription Cleanup

- **Success**: Updates `last_used_at = CURRENT_TIMESTAMP` on the subscription row.
- **410 Gone / 404 Not Found**: The push endpoint is no longer valid. The subscription row is immediately deleted (`DELETE FROM push_subscriptions`).
- **Transient Failures / Timeouts**: Logged at `warn`. The subscription is preserved for future attempts.

### Native Delivery

Native push notification senders for iOS (APNs) and Android (FCM) extend push delivery across all supported platforms (`web`, `desktop`, `ios`, `android`).

#### Environment Variables

| Variable | Description | Default |
| --- | --- | --- |
| `PUSH_APNS_KEY` | File path to APNs `.p8` key or inline PKCS#8 PEM string. | Unset |
| `PUSH_APNS_KEY_ID` | 10-character Key ID from Apple Developer Portal. | Unset |
| `PUSH_APNS_TEAM_ID` | 10-character Team ID from Apple Developer Portal. | Unset |
| `PUSH_APNS_BUNDLE_ID` | App bundle identifier (used as `apns-topic` header). | Unset |
| `PUSH_APNS_USE_SANDBOX` | Connect to `api.sandbox.push.apple.com` if `true`, else `api.push.apple.com`. | `false` |
| `PUSH_FCM_SERVICE_ACCOUNT_JSON` | File path to Google service account JSON or inline JSON string. | Unset |

#### Provider Configuration & Graceful Startup

- Senders are registered only when all required configuration options for that provider are supplied.
- Partial configuration (e.g. key ID set but team ID missing) logs a startup `warn` message and disables that specific provider without failing server startup.
- Mobile credentials and private keys (`.p8` key contents and service account JSON) are strictly secret and never logged or exposed in API responses.

#### APNs Payload Envelope

APNs notifications use HTTP/2 with JWT ES256 authentication and bundle the `aps` dictionary alongside custom payload fields:

```json
{
  "aps": {
    "alert": {
      "title": "New message",
      "body": "New message"
    },
    "sound": "default",
    "badge": 1,
    "mutable-content": 0,
    "thread-id": "<room_id>"
  },
  "type": "message",
  "room_id": "<room_id>",
  "sender_user_id": "<user_id>",
  "encrypted_payload": "",
  "notification_id": "<ulid>",
  "priority": "high",
  "collapse_key": "<room_id>",
  "timestamp": "<ISO 8601>"
}
```

- **Device Token Validation**: APNs device tokens are validated locally before issuing network calls. Tokens not matching 64 hex characters are rejected immediately with a permanent failure error to prevent unnecessary round trips.

#### FCM Payload Envelope

FCM requests use HTTP/1.1 to the FCM HTTP v1 API (`fcm.googleapis.com`) with OAuth 2.0 bearer tokens obtained via service account authentication (scope `https://www.googleapis.com/auth/firebase.messaging`):

```json
{
  "message": {
    "token": "<push_token>",
    "notification": {
      "title": "New message",
      "body": "New message"
    },
    "data": {
      "type": "message",
      "room_id": "<room_id>",
      "sender_user_id": "<user_id>",
      "encrypted_payload": "",
      "notification_id": "<ulid>",
      "priority": "high",
      "collapse_key": "<room_id>",
      "timestamp": "<ISO 8601>"
    },
    "android": {
      "priority": "high",
      "collapse_key": "<room_id>",
      "notification": {
        "channel_id": "messages"
      }
    }
  }
}
```

#### Status Code Mapping

- **410 Gone / 404 Not Found / UNREGISTERED**: Indicates invalid or expired tokens/endpoints. The subscription is deleted (`DELETE FROM push_subscriptions`).
- **401 Unauthorized / 400 Bad Request**: Permanent errors (e.g. invalid credentials or malformed payloads). Logged at `warn`, subscription preserved.
- **429 / 5xx / Timeouts**: Transient errors. Logged at `warn`, subscription preserved for future attempts.

#### Capabilities & Client Guidance

`GET /api/v1/capabilities` advertises provider availability in `push_providers`:

```json
{
  "push_enabled": true,
  "push_providers": {
    "web": true,
    "desktop": true,
    "ios": true,
    "android": true
  }
}
```

Clients check `push_providers` on startup to determine whether native push registration should be attempted for their platform.

#### Pre-Deployment Manual Verification Checklist

Automated CI integration tests mock APNs and FCM endpoints using synthetic credentials. Before deploying to production, operators should manually verify end-to-end delivery:

1. Obtain valid APNs `.p8` credentials from Apple Developer Console and FCM Service Account JSON from Firebase Console.
2. Set `PUSH_ENABLED=true`, `PUSH_DELIVERY_ENABLED=true`, and provider credentials in `.env`.
3. Start the server and confirm `push: APNs sender registered` and `push: FCM sender registered` appear in server logs.
4. Verify `GET /api/v1/capabilities` returns `ios: true` and `android: true` in `push_providers`.
5. Install and launch the iOS/Android client on physical devices, register push subscriptions, and send a message from another account.
6. Confirm real-time notification alerts appear on physical mobile devices.
