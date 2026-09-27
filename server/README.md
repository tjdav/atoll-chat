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
