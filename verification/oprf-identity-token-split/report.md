# Verification Report: OPRF Identity with Token Split

## 1. Current `users` Table Schema
The effective schema in `server/migrations/0001_v2_schema.sql` defines:
```sql
CREATE TABLE IF NOT EXISTS users (
    id                      TEXT PRIMARY KEY,
    username_token          TEXT NOT NULL UNIQUE,
    encrypted_display       TEXT,
    opaque_registration     BLOB NOT NULL,
    identity_pubkey         TEXT NOT NULL,
    profile                 TEXT,
    profile_version         INTEGER NOT NULL DEFAULT 1,
    max_file_size_bytes     INTEGER,
    created_at              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    disabled_at             DATETIME,
    deleted_at              DATETIME,
    requires_reregistration INTEGER NOT NULL DEFAULT 0
);
```
- `username_token`: `TEXT NOT NULL UNIQUE`, 86-character base64url string decoding to 64 bytes.
- `encrypted_display`: `TEXT`, nullable, 28–284 bytes decoded base64url string.
- Delta relative to V3 §7.1: `requires_reregistration` exists as a key rotation flag. Column comment for `username_token` will be added in migration SQL / schema documentation stating it holds `lookup_token`, not raw OPRF output.

## 2. Current `POST /oprf/blind` Implementation
- Location: `server/src/routes/oprf.rs`, handler `blind`.
- Request shape: `{ "blinded": "<base64>" }`.
- Response shape: `{ "evaluated": "<base64>" }`.
- Cryptographic suite: `voprf 0.5.0` with `Ristretto255-SHA512` in base mode.
- Rate limiting: Rate limited per IP via `RateLimitKey::OprfBlind` (`RATE_OPRF_BLIND_PER_MIN`, `RATE_OPRF_BLIND_PER_HOUR`).

## 3. Current Registration Flow
- Handlers: `register_start` and `register_finish` in `server/src/routes/register.rs`.
- Field names: Currently accepts `username_token`.
- V3 token split updates: Updated to accept `lookup_token` (with serde alias for `username_token` backwards compatibility) and reject/ignore any raw `token` parameter. Stored in `users.username_token`. Accepts `encrypted_display` and stores as opaque ciphertext.

## 4. Current Login Flow
- Handlers: `login_start` and `login_finish` in `server/src/routes/login.rs`.
- Field names: Currently accepts `username_token`.
- Unknown token handling: Currently returns 401 `invalid_credentials` immediately during `login_start`. Under V3, unknown tokens use a dummy OPAQUE registration record (`password_file = None`), returning 200 OK `{ login_id, credential_response }` in `start`, and failing with 401 `invalid_credentials` in `finish` to prevent enumeration.

## 5. Current Lookup Flow
- Handler: `lookup_user` in `server/src/routes/users.rs`.
- Request shape: `{ "username_token": "<86-char base64url>" }`.
- V3 token split updates: Updated to accept `{ "lookup_token": "<86-char base64url>" }` (and serde alias `username_token`). Returns 200 with `{ "user_id": "...", "encrypted_display": "<base64url or null>" }` when found, and 404 with `{ "error": "not_found" }` when missing. Rate limited via `RATE_LOOKUP_PER_MIN` per authenticated user.

## 6. Current `encrypted_display` Handling
- Validation: Validated in `server/src/identity/display.rs` (`validate_encrypted_display`) ensuring unpadded base64url string decoding to 28–284 bytes (`nonce || AES-256-GCM`).
- Opacity: Server stores `encrypted_display` as opaque ciphertext and never attempts to decrypt or inspect it.

## 7. V2 Remnants
- Direct 401 response on unknown token in `POST /auth/login/start` without dummy OPAQUE handshake.
- Struct field names strictly requiring `username_token` without accepting `lookup_token`.
- Lack of explicit rejection/validation when client sends a raw `token` field instead of `lookup_token`.
