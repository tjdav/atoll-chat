# Step 0 Empirical Verification Report: register_finish Returns Session Token and Recovery Codes

**Date:** 2026-10-17
**Task:** Task A — register_finish Returns Session Token and Recovery Codes (Issue 1)
**Report Location:** `verification/register-finish-session-and-recovery/report.md`

---

## 1. Current `register_finish` Handler

- **Location:** `server/src/routes/register.rs` (`pub async fn register_finish`, lines 233–360).
- **Response Struct:**
  ```rust
  #[derive(Debug, Serialize, ToSchema)]
  pub struct RegisterFinishResponse {
      pub user_id: String,
      pub username_token: String,
      pub is_owner: bool,
  }
  ```
- **Transaction Lifecycle:**
  - Begins at line 316: `let mut tx = state.pool.begin().await?;`
  - Commits at line 348: `tx.commit().await?;`
- **Steps Inside Transaction:**
  1. Generate random 16-byte `user_id` encoded as a 22-character unpadded base64url string.
  2. `INSERT INTO users (id, username_token, encrypted_display, opaque_registration, identity_pubkey, profile_version) ...`
  3. If `state.config.key_transparency_enabled` is true, `INSERT INTO key_transparency_log (user_id, username_token, identity_pubkey) ...`
  4. If `is_owner` is true, look up owner role ID and `INSERT OR IGNORE INTO user_roles (user_id, role_id, granted_by) ...`
  5. Commit transaction (`tx.commit().await?`).

---

## 2. `recovery_code::persist_for_user` Helper

- **Module:** `server/src/recovery_code.rs`
- **Current Signature:**
  ```rust
  pub async fn persist_for_user(
      pool: &SqlitePool,
      user_id: &str,
  ) -> Result<String, RecoveryCodeError>
  ```
- **Return Type:** `Result<String, RecoveryCodeError>` (returns 1 plaintext Crockford Base32 20-character recovery code per call).
- **Accepts Pool vs. Transaction:** Currently accepts `&SqlitePool`. We will genericize `persist_for_user` to accept `executor: E` where `E: sqlx::Executor<'e, Database = sqlx::Sqlite>`, allowing it to take `&mut *tx` (inside transactions) or `&SqlitePool` without breaking any existing caller.
- **Return Value Content:** Generates fresh salt, hashes code using Argon2id, inserts `(id, user_id, code_hash, code_salt)` into `recovery_codes` table, and returns the plaintext code String.
- **Count Generated Per Call:** 1 code per call. Calling `persist_for_user` in a loop of 8 inside `register_finish` generates and persists exactly 8 recovery codes.

---

## 3. Session Creation Helper

- **Location:** `server/src/session.rs` (`pub async fn create_session`)
- **Current Signature:**
  ```rust
  pub async fn create_session(
      pool: &SqlitePool,
      user_id: &str,
      device_id: Option<&str>,
      expiry_days: u32,
  ) -> Result<SessionToken, SessionError>
  ```
- **Accepts Pool vs. Transaction:** Currently accepts `&SqlitePool`. We will genericize `create_session` to accept `executor: E` where `E: sqlx::Executor<'e, Database = sqlx::Sqlite>`, allowing `create_session(&mut *tx, &user_id, None, state.config.session_expiry_days)` to execute inside the `register_finish` transaction.
- **Return Value:** Returns `SessionToken { raw: String, hash: String }` where `raw` is a 43-character base64url unpadded random session token string.

---

## 4. `RegisterFinishResponse` Struct

- **Current Definition (`server/src/routes/register.rs`):**
  ```rust
  #[derive(Debug, Serialize, ToSchema)]
  pub struct RegisterFinishResponse {
      pub user_id: String,
      pub username_token: String,
      pub is_owner: bool,
  }
  ```
- **Target Definition:**
  ```rust
  #[derive(Debug, Serialize, ToSchema)]
  pub struct RegisterFinishResponse {
      pub user_id: String,
      pub username_token: String,
      pub is_owner: bool,
      pub session_token: String,
      pub recovery_codes: Vec<String>,
  }
  ```

---

## 5. OpenAPI Annotation for `register_finish`

- **Location:** `server/src/routes/register.rs` on `pub async fn register_finish`
- **Current Schema (`docs/openapi.json`):**
  ```json
  "RegisterFinishResponse": {
    "type": "object",
    "required": [
      "user_id",
      "username_token",
      "is_owner"
    ],
    "properties": {
      "is_owner": { "type": "boolean" },
      "user_id": { "type": "string" },
      "username_token": { "type": "string" }
    }
  }
  ```
- **Target Schema:** Will declare `session_token` (type string) and `recovery_codes` (array of strings) in `properties` and `required`.

---

## 6. Affected Tests and Batch Assignments

All test files calling `POST /api/v1/auth/register/finish`:

| Test File | Batch Name (`batch-manifest.toml`) |
|---|---|
| `server/tests/registration.rs` | `identity` |
| `server/tests/register_oprf.rs` | `identity` |
| `server/tests/token_split.rs` | `identity` |
| `server/tests/recovery_endpoints.rs` | `identity` |
| `server/tests/invites.rs` | `auth` |
| `server/tests/devices.rs` | `auth` |
| `server/tests/key_packages.rs` | `messaging` |
| `server/tests/openapi_generation.rs` | `operations` |
| `server/tests/common/mod.rs` | shared test helper |

---

## 7. Existing Assertions on `register_finish` Response

- Tests deserialize responses into `RegisterFinishResponse` or inspect JSON objects via `serde_json::Value`.
- Since `RegisterFinishResponse` is imported directly by test files (or parsed from JSON), extending `RegisterFinishResponse` with `session_token` and `recovery_codes` will allow serde deserialization to succeed across all tests.
- We will update the primary `register_finish` test cases in `auth` (`invites.rs` / `auth.rs` / `devices.rs`) and `identity` (`registration.rs` / `register_oprf.rs`) to explicitly assert the presence, format, and validity of `session_token` and `recovery_codes`.

---

## 8. Log Safety Audit

- **`register_finish` (`server/src/routes/register.rs`):** Logs `info!("bootstrap: user {} assigned owner role", user_id);`. Does NOT log session tokens or recovery codes.
- **`recovery_code` (`server/src/recovery_code.rs`):** Zero log/tracing statements.
- **`session` (`server/src/session.rs`):** Logs `session_id` on warnings (`warn!("best-effort ... for session {}", session_id)`). Does NOT log raw `session_token`.
- **Audit Result:** No log or tracing statement outputs `session_token` or `recovery_codes`. A comment will be placed in `register_finish` highlighting log safety compliance.
