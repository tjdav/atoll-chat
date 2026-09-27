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
