# Step 0 Baseline Verification Report — recover_start Field Fallback Alignment

**Date:** 2026-10-17
**Task:** Accept `lookup_token` in `recover_start` (Issue 2)
**Target File:** `server/src/routes/recover.rs`
**Target Specs:** Server Specification v3.0.4 (§6.23, §8.1) & Client Contract Verification (`verification/client-contract-issues-verify/report.md`)

---

## 1. Current `recover_start` Handler and Request Struct

- **Handler Location:** `server/src/routes/recover.rs::recover_start`
- **Request Struct:** `RecoverStartRequest`
```rust
#[derive(Debug, Deserialize, ToSchema)]
pub struct RecoverStartRequest {
    pub recovery_code: String,
    pub username_token: String,
}
```
- **Field Definitions & Required Status:**
  - `recovery_code`: `String` — Required.
  - `username_token`: `String` — Required. (`lookup_token` is omitted and rejected with 400 Bad Request if provided without `username_token`).

---

## 2. Current `login_start` Handler and Token Resolution Logic

- **Handler Location:** `server/src/routes/login.rs::login_start`
- **Request Struct:** `LoginStartRequest`
```rust
#[derive(Debug, Deserialize, ToSchema)]
pub struct LoginStartRequest {
    pub lookup_token: Option<String>,
    pub username_token: Option<String>,
    pub credential_request: String,
    pub client_id: String,
    pub platform: Option<String>,
}
```
- **Token Resolution Pattern:**
```rust
let lookup_token = match body.lookup_token.or(body.username_token) {
    Some(ref tok) if !tok.trim().is_empty() => tok.trim().to_string(),
    _ => return Err(ApiError::Unauthorized("invalid_credentials".to_string())),
};
```

---

## 3. Current `register_start` Handler and Token Resolution Logic

- **Handler Location:** `server/src/routes/register.rs::register_start`
- **Request Struct:** `RegisterStartRequest`
```rust
#[derive(Debug, Deserialize, ToSchema)]
pub struct RegisterStartRequest {
    pub lookup_token: Option<String>,
    pub username_token: Option<String>,
    pub registration_request: String,
    pub altcha: Option<String>,
}
```
- **Token Resolution Pattern:**
```rust
let lookup_token = match body.lookup_token.or(body.username_token) {
    Some(ref tok) if !tok.trim().is_empty() => tok.trim().to_string(),
    _ => return Err(ApiError::BadRequest("missing_field".to_string())),
};
```

---

## 4. Error Code for Missing Token

- **`login_start` Missing Token Error Code:** `invalid_credentials` (HTTP 401 Unauthorized via `ApiError::Unauthorized("invalid_credentials".to_string())`).
- **`register_start` Missing Token Error Code:** `missing_field` (HTTP 400 Bad Request via `ApiError::BadRequest("missing_field".to_string())`).
- **`recover_start` Resolution:** `recover_start` will match `login_start`'s error code when neither token is supplied or when both are empty: `ApiError::Unauthorized("invalid_credentials".to_string())` (HTTP 401 Unauthorized).

---

## 5. Current `recover_start` Tests

All recovery endpoint tests reside in `server/tests/recovery_endpoints.rs`.

| Test Function | Endpoint URI | Field(s) Sent |
|---|---|---|
| `test_recovery_full_happy_path` | `POST /api/v1/auth/recover/start` | `recovery_code`, `username_token` |
| `test_recovery_wrong_code_and_unknown_token` (Call 1) | `POST /api/v1/auth/recover/start` | `recovery_code`, `username_token` |
| `test_recovery_wrong_code_and_unknown_token` (Call 2) | `POST /api/v1/auth/recover/start` | `recovery_code`, `username_token` |
| `test_recovery_rate_limiting` | `POST /api/v1/auth/recover/start` | `recovery_code`, `username_token` |
| `test_recovery_session_replay_and_code_replay` (Call 1) | `POST /api/v1/auth/recover/start` | `recovery_code`, `username_token` |
| `test_recovery_session_replay_and_code_replay` (Call 2) | `POST /api/v1/auth/recover/start` | `recovery_code`, `username_token` |
| `test_recovery_expired_session` | `POST /api/v1/auth/recover/start` | `recovery_code`, `username_token` |
| `test_recovery_session_revoked_events_published` | `POST /api/v1/auth/recover/start` | `recovery_code`, `username_token` |
| `test_recovery_invalid_registration_record` | `POST /api/v1/auth/recover/start` | `recovery_code`, `username_token` |

**Summary:** 7 test functions (9 total start invocations). 100% of existing tests send `username_token`. Zero tests send `lookup_token`.

---

## 6. Current OpenAPI Schema for `RecoverStartRequest`

From `docs/openapi.json`:
```json
"RecoverStartRequest": {
  "type": "object",
  "required": [
    "recovery_code",
    "username_token"
  ],
  "properties": {
    "recovery_code": {
      "type": "string"
    },
    "username_token": {
      "type": "string"
    }
  }
}
```

---

## 7. Server-Side Callers of `recover_start`

Search across `server/src/` confirms **zero internal calls** to `recover_start`.
- Axum Route: `server/src/lib.rs` (`/auth/recover/start`)
- OpenAPI Registration: `server/src/openapi.rs`
- Rate Limits: `server/src/config.rs` and `server/src/rate_limit.rs`
