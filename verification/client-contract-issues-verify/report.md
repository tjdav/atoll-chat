# Client Contract Issues Verification Report

**Date:** 2026-10-17
**Status:** Complete — Empirical Verification Report
**Target Specs:** Server Specification v3.0.4 (§5.19, §6.2, §6.19, §6.23, §8.1, §8.1.6) & Client Specification v2.0 / §16.3

---

## Executive Summary

The client team filed five contract issues against Server Specification v3.0.4 and implementation, plus a recommendation for a schema-runtime contract test suite (Issue 6). This verification audit evaluated the actual Rust server codebase (`server/src/`), the generated OpenAPI specification (`docs/openapi.json`), and Server Specification v3.0.4.

Zero code changes were made during this verification step.

### Summary Classification Matrix

| Issue | Title | Server Runtime State | OpenAPI Schema State | Server Spec v3.0.4 State | Classification |
|---|---|---|---|---|---|
| **Issue 1** | `register_finish` response shape | Emits `{ user_id, username_token, is_owner }`. No recovery code generated; no session token issued. | Matches code (`user_id`, `username_token`, `is_owner`). | Underspecified on exact `register_finish` DTO response body. | **Spec Decision Required / Genuine Gap** (Client expects auto-login & recovery codes) |
| **Issue 2** | `recover_start` request shape | Accepts `username_token` ONLY. Rejects `lookup_token`. | Matches code (`username_token` required). | §6.23 specifies passing `lookup_token`. | **Genuine Gap** (Code & OpenAPI diverge from Spec §6.23) |
| **Issue 3** | `sockudo_url` vs `websocket_url` | Emits `websocket_url`. | Declares `websocket_url`. | §5.19 & §8.1 mandate `sockudo_url`. | **Code & Annotation Drift / Wrong Client Recommendation** |
| **Issue 4** | `sockudo_auth_endpoint` in capabilities | Omitted from response. | Omitted from schema. | §5.19 & §8.1 mandate `sockudo_auth_endpoint`. | **Genuine Gap** (Missing field in code and OpenAPI) |
| **Issue 5** | `sockudo_channel_prefix` in OpenAPI | Emits `sockudo_channel_prefix`. | Declares `sockudo_channel_prefix`. | §5.19 & §8.1 explicitly state field is deliberately removed. | **Code & Annotation Drift / Wrong Client Recommendation** |
| **Issue 6** | Contract test suite | No runtime-vs-OpenAPI response shape validation test exists. | N/A | N/A | **Reasonable Suggestion** (Low priority, out of scope for v3.0.5) |

---

## Detailed Empirical Findings

### Issue 1 — `register_finish` Response Shape

#### a. Actual `register_finish` Handler (`server/src/routes/register.rs`)
The handler uses the response struct `RegisterFinishResponse`:
```rust
#[derive(Debug, Serialize, ToSchema)]
pub struct RegisterFinishResponse {
    pub user_id: String,
    pub username_token: String,
    pub is_owner: bool,
}
```
Every field emitted by runtime:
1. `user_id` (String) — Base64url encoded 16 random bytes (22 chars).
2. `username_token` (String) — The user's lookup token (86 chars base64url).
3. `is_owner` (bool) — Indicates if the user was assigned the bootstrap `owner` role.

#### b. OpenAPI Document (`docs/openapi.json`)
The `RegisterFinishResponse` schema declares:
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

#### c. Server Spec §6.2
Server Spec §6.2 describes the handshake stages ("Registration: start then finish. Both within 5 minutes.") but does not specify the explicit JSON response body structure for `POST /auth/register/finish`. §8.1 lists `POST /auth/register/finish` under Public routes.

#### d. Client Expectation (Client Spec §16.3)
The client team expects `POST /auth/register/finish` to return:
1. `session_token` — To auto-login the user upon registration completion.
2. `recovery_codes` (or `recovery_code`) — To present initial recovery material to the user immediately upon registration.

#### e. Recovery Code Generation & Storage Inspection
- Plaintext recovery codes are generated and Argon2id hashed via `recovery_code::persist_for_user(pool, user_id)` in `server/src/recovery_code.rs`.
- `register_finish` in `server/src/routes/register.rs` **does not** call `persist_for_user`. No recovery code is created or inserted into the `recovery_codes` table at registration time.

#### f. Session Token Issuance Inspection
- `register_finish` inserts the user into `users`, records the initial Key Transparency leaf, and assigns `owner` role if applicable.
- `register_finish` **does not** call `session::create_session`. No session token is issued or returned.

#### g. Classification
**Spec Decision Required / Genuine Gap**: While the current server code matches its OpenAPI annotation, it leaves registration incomplete for client v1 UX (requiring a separate manual login call and leaving accounts without initial recovery codes). Adding `session_token` and `recovery_codes` to `RegisterFinishResponse` is a necessary enhancement for v3.0.5.

---

### Issue 2 — `recover_start` Request Shape

#### a. Actual `recover_start` Handler (`server/src/routes/recover.rs`)
The handler uses the request struct:
```rust
#[derive(Debug, Deserialize, ToSchema)]
pub struct RecoverStartRequest {
    pub recovery_code: String,
    pub username_token: String,
}
```
The handler reads `body.username_token` directly. It does **not** accept `lookup_token`. Passing `lookup_token` without `username_token` produces a JSON deserialization error (400 Bad Request).

#### b. OpenAPI Document (`docs/openapi.json`)
`RecoverStartRequest` requires `recovery_code` and `username_token`. `lookup_token` is not declared.

#### c. Server Spec §6.23
Server Spec §6.23 step 4 explicitly states:
> "Call `POST /auth/recover/start` with `{ recovery_code, lookup_token }`."

#### d. Comparison against `login_start` and `register_start`
- `login_start` (`server/src/routes/login.rs`) accepts both:
  ```rust
  pub struct LoginStartRequest {
      pub lookup_token: Option<String>,
      pub username_token: Option<String>, ...
  }
  let lookup_token = match body.lookup_token.or(body.username_token) ...
  ```
- `register_start` (`server/src/routes/register.rs`) accepts both:
  ```rust
  pub struct RegisterStartRequest {
      pub lookup_token: Option<String>,
      pub username_token: Option<String>, ...
  }
  let lookup_token = match body.lookup_token.or(body.username_token) ...
  ```
- `recover_start` diverges from `login_start`, `register_start`, and Server Spec §6.23 by enforcing `username_token` exclusively.

#### e. Classification
**Genuine Gap**: The server implementation and OpenAPI schema diverge from Server Spec §6.23 and fail to match the fallback pattern used in `login_start` and `register_start`. `recover_start` must accept `lookup_token` (or `username_token`).

---

### Issue 3 — `sockudo_url` vs `websocket_url` in Capabilities

#### a. Actual `capabilities` Handler (`server/src/routes/capabilities.rs`)
The handler emits:
```rust
pub struct CapabilitiesResponse {
    ...
    pub websocket_url: String,
    pub sockudo_app_key: String,
    pub sockudo_channel_prefix: String,
    ...
}
```
The runtime emits the field name `websocket_url`.

#### b. OpenAPI Document (`docs/openapi.json`)
`CapabilitiesResponse` declares `websocket_url` as a required string property.

#### c. Server Spec §5.19 & §8.1
Server Spec §5.19 and §8.1 specify the capability field names:
- `sockudo_url`
- `sockudo_app_key`
- `sockudo_auth_endpoint`

`websocket_url` was renamed to `sockudo_url` in Server Spec v3.0.3 to establish consistent `sockudo_*` naming across capabilities and configuration.

#### d. Artifact Disagreement Analysis
- Runtime and OpenAPI **agree** with each other (`websocket_url`).
- Runtime and OpenAPI **disagree with Server Spec v3.0.4** (Code Drift & Annotation Drift).

#### e. Evaluation of Client Recommendation
The client team recommended changing the spec back to `websocket_url`.
- **Server Team Position:** In Server Spec v3.0.3, the field was intentionally renamed to `sockudo_url` to group all Sockudo connection parameters (`sockudo_url`, `sockudo_app_key`, `sockudo_auth_endpoint`).
- The client's proposal to rename the specification is a **Wrong Recommendation**.
- The server runtime and OpenAPI annotation must be updated in v3.0.5 to emit `sockudo_url`.

#### f. Classification
**Code Drift & Annotation Drift** (with **Wrong Recommendation** from Client).

---

### Issue 4 — `sockudo_auth_endpoint` in Capabilities

#### a. Actual `capabilities` Handler (`server/src/routes/capabilities.rs`)
`CapabilitiesResponse` does **not** contain a `sockudo_auth_endpoint` field. The field is omitted from the JSON output.

#### b. OpenAPI Document (`docs/openapi.json`)
`CapabilitiesResponse` in `docs/openapi.json` does **not** declare `sockudo_auth_endpoint`.

#### c. Server Spec §5.19 & §8.1
Server Spec §5.19 & §8.1 mandate that `GET /capabilities` advertises `sockudo_auth_endpoint` (defaulting to `"/sockudo/auth"`).

#### d. Classification
**Genuine Gap**: Both the runtime handler and the OpenAPI schema omit `sockudo_auth_endpoint`.

---

### Issue 5 — `sockudo_channel_prefix` in Capabilities

#### a. Actual `capabilities` Handler (`server/src/routes/capabilities.rs`)
The handler emits:
```rust
sockudo_channel_prefix: "private-room-".to_string()
```

#### b. OpenAPI Document (`docs/openapi.json`)
`CapabilitiesResponse` declares `sockudo_channel_prefix` as a required string property.

#### c. Server Spec §5.19 & §8.1
Server Spec §5.19 & §8.1 state explicitly:
> "`sockudo_channel_prefix` is deliberately not exposed; channel prefixes are structural and clients hardcode them."

#### d. Specification Rationale
Channel prefixes are multi-valued and structural (`private-room-`, `private-user-`, `private-bot-`). Advertising a single string `"private-room-"` is incomplete and misleading. The field was deliberately removed in Server Spec v3.0.3.

#### e. Evaluation of Client Recommendation
The client team requested formalizing `sockudo_channel_prefix` in the specification.
- The server team **rejects** adding `sockudo_channel_prefix` to Server Spec v3.0.4.
- The client's recommendation is a **Wrong Recommendation**.
- The server runtime and OpenAPI schema must be updated to remove `sockudo_channel_prefix`.

#### f. Classification
**Code Drift & Annotation Drift** (with **Wrong Recommendation** from Client).

---

### Issue 6 — Schema-Runtime Contract Testing

#### a. Current Test Coverage
`server/tests/openapi_generation.rs` validates that:
1. `docs/openapi.json` can be generated and parsed.
2. Every route registered in `server/src/lib.rs` exists in `docs/openapi.json`.

However, there is currently **no test** that invokes Axum endpoints and compares actual JSON response bodies against the OpenAPI JSON Schema definitions.

#### b. Diagnostic Value
A runtime-vs-schema contract test would have immediately flagged:
- Issue 3 (`sockudo_url` vs `websocket_url` mismatch once schema was updated).
- Issue 4 (`sockudo_auth_endpoint` missing from runtime JSON).
- Issue 5 (`sockudo_channel_prefix` present in runtime JSON when removed from schema).

#### c. Classification
**Reasonable Suggestion** (Low priority; out of scope for v3.0.5 code patch, recommended as a follow-up test task).

---

## Summary of Classifications

1. **Genuine Gaps / Code Fixes Required:**
   - **Issue 1:** Update `register_finish` handler to generate/persist initial recovery codes (`recovery_code::persist_for_user`), create an HTTP session token (`session::create_session`), and return `session_token` and `recovery_codes` in `RegisterFinishResponse`.
   - **Issue 2:** Update `recover_start` handler and `RecoverStartRequest` DTO to accept `lookup_token` or `username_token` (`body.lookup_token.or(body.username_token)`), matching `login_start` and `register_start`.
   - **Issue 3:** Update `capabilities` handler to emit `sockudo_url` instead of `websocket_url`.
   - **Issue 4:** Update `capabilities` handler to emit `sockudo_auth_endpoint: "/sockudo/auth"`.
   - **Issue 5:** Update `capabilities` handler to remove `sockudo_channel_prefix`.

2. **OpenAPI Schema Updates Required:**
   - Update `RegisterFinishResponse` schema to include `session_token` and `recovery_codes`.
   - Update `RecoverStartRequest` schema to accept optional `lookup_token` and optional `username_token`.
   - Update `CapabilitiesResponse` schema: rename `websocket_url` -> `sockudo_url`, add `sockudo_auth_endpoint`, remove `sockudo_channel_prefix`.

3. **Wrong Recommendations Corrected:**
   - **Issue 3:** Reject client recommendation to revert spec to `websocket_url`. Standardize on `sockudo_url`.
   - **Issue 5:** Reject client recommendation to restore `sockudo_channel_prefix` in spec. Remove field from code and OpenAPI.

---

## Formal Response to the Client Team

**To:** Client Development Team
**From:** Server Development Team
**Subject:** Response to Client Contract Issues (v3.0.4 Verification & v3.0.5 Patch Scope)

Thank you for filing contract issues 1 through 5. We acknowledge the urgency of the registration and recovery blockers for client v1 integration. We have completed a comprehensive code and specification audit against Server Specification v3.0.4.

Here is our formal response and technical resolution plan:

### 1. Issue 1 — `register_finish` Response Shape (Blocker)
- **Finding:** Confirmed. The server currently returns `{ user_id, username_token, is_owner }` without auto-issuing a session token or generating initial recovery codes.
- **Resolution:** In release **v3.0.5**, `POST /auth/register/finish` will be updated to:
  1. Generate and persist initial recovery codes via `recovery_code::persist_for_user`.
  2. Create an initial session via `session::create_session`.
  3. Return `session_token` and `recovery_codes` (array of strings) in `RegisterFinishResponse`.

### 2. Issue 2 — `recover_start` Request Shape (Blocker)
- **Finding:** Confirmed. `recover_start` required `username_token` strictly, whereas Server Spec §6.23 specified `lookup_token`, and both `login_start` and `register_start` accept `lookup_token` or `username_token`.
- **Resolution:** In release **v3.0.5**, `POST /auth/recover/start` will accept both `lookup_token` and `username_token` (`lookup_token.or(username_token)`), aligning with `login_start` and `register_start`.

### 3. Issue 3 — `sockudo_url` vs `websocket_url` in Capabilities
- **Finding:** Empirical audit confirms code and OpenAPI drift. The runtime currently emits `websocket_url`.
- **Counter-Proposal:** We **do not accept** the recommendation to rename the specification field to `websocket_url`. Server Spec v3.0.3 deliberately established `sockudo_url` for consistency alongside `sockudo_app_key` and `sockudo_auth_endpoint`.
- **Resolution:** In release **v3.0.5**, the server runtime and OpenAPI schema will be updated to emit `sockudo_url`, aligning code with Server Spec v3.0.4 §5.19 & §8.1.

### 4. Issue 4 — `sockudo_auth_endpoint` in Capabilities
- **Finding:** Confirmed. `sockudo_auth_endpoint` was omitted from the capabilities response.
- **Resolution:** In release **v3.0.5**, `GET /capabilities` will emit `sockudo_auth_endpoint: "/sockudo/auth"` per Server Spec §5.19.

### 5. Issue 5 — `sockudo_channel_prefix` in Capabilities
- **Finding:** Empirical audit confirms runtime code and OpenAPI drift.
- **Counter-Proposal:** We **do not accept** adding `sockudo_channel_prefix` to the specification. Channel prefixes are multi-valued and structural (`private-room-`, `private-user-`, `private-bot-`).
- **Resolution:** In release **v3.0.5**, `sockudo_channel_prefix` will be removed from the server runtime response and `docs/openapi.json`, aligning code with Server Spec v3.0.4.

### 6. Target Release & Timeline
All confirmed code fixes and OpenAPI schema adjustments will land together in patch release **v3.0.5**. Follow-up task entries have been recorded in the server task ledger.

---
*Authoritative report recorded at `verification/client-contract-issues-verify/report.md`.*
