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

### Future Planned Features

The following features are scheduled for subsequent phases:
- **Phase 8**: Server and room invite links.
- **Phase 9, 10, 11**: MLS group initialization, epoch commits, Welcome packets, KeyPackage exchanges.
