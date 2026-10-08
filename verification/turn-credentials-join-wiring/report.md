# Step 0 Report — TURN Credentials V3 Alignment and Join Wiring

## 1. Current `POST /calls/turn-credentials` Handler
- **Path:** `POST /api/v1/calls/turn-credentials`
- **Auth:** Required (`AuthUser` session token or bot token).
- **Request Shape:** Empty JSON object `{}`.
- **Response Shape:**
  ```json
  {
    "urls": ["turn:turn.example.com:3478", "turns:turn.example.com:5349"],
    "username": "1735689600:AbCdEfGhIjKlMnOp",
    "credential": "dGVzdC1jcmVkZW50aWFs==",
    "ttl": 600
  }
  ```
- **Status Codes:**
  - `200 OK`: Successful credential generation.
  - `401 Unauthorized`: Missing or invalid Bearer token.
  - `429 Too Many Requests`: Exceeded `RATE_TURN_CREDENTIALS_PER_MIN`.
  - `501 Not Implemented`: `calling_disabled` (when `CALLING_ENABLED=false`) or `turn_not_configured` (when `TURN_URL` is empty).
- **Comparison:** Current handler matches the V2 Task 37 fact in `verification.md`. V3 §8.7.3 shows a singular `"url"` field in its example response shape.

## 2. Current HMAC Construction
- **Algorithm:** `HMAC-SHA1` (`Hmac<Sha1>`).
- **Secret:** `config.turn_shared_secret.as_bytes()`.
- **Username Format:** `<expiry_timestamp>:<opaque>`
  - `expiry_timestamp` = Unix epoch seconds (`now + config.turn_ttl_seconds as i64`).
  - `opaque` = 16 random bytes encoded as unpadded Base64URL (`URL_SAFE_NO_PAD.encode(...)`).
- **Credential Encoding:** Standard Base64 (`STANDARD.encode(mac_bytes)`).
- **Privacy Guarantee:** `user_id` is excluded from the username to protect user identity in coturn logs.
- **Confirmation:** Exactly matches V2 Task 37 fact.

## 3. Current URL Splitting
- **Parsing Logic:** `config.turn_url.split(',').map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect()`.
- **Comma-Separated Support:** Supported. `turn:1.2.3.4:3478,turns:5.6.7.8:5349` is split into `["turn:1.2.3.4:3478", "turns:5.6.7.8:5349"]`.
- **Response Field Name:** `urls` (plural array of strings).

## 4. Current Rate Limit
- **Rate Limit Key:** `RATE_TURN_CREDENTIALS_PER_MIN` (default 10 per minute per user).
- **Key Format:** `turn_credentials:{user_id}:min:{boundary}`.
- **Enforcement Site:** Enforced in `turn_credentials_handler` (`server/src/routes/calls.rs`).

## 5. Current Startup Validation
- **Mutual Requirement:** In `Config::from_env()` (`server/src/config.rs`), if `TURN_URL` is non-empty and `TURN_SHARED_SECRET` is empty, startup fails with error message:
  `"TURN_URL is set but TURN_SHARED_SECRET is empty"`.
- **Unset Behavior:** If `TURN_URL` is empty, startup succeeds, and `POST /calls/turn-credentials` returns 501 `turn_not_configured`.

## 6. Current `CALLING_ENABLED` Interaction
- When `CALLING_ENABLED=false`:
  - `POST /calls/turn-credentials` returns HTTP 501 `calling_disabled`.
  - `POST /rooms/:id/calls/:call_id/join` returns HTTP 501 `calling_disabled`.

## 7. Current `ice_servers` in Join Response
- **Call Join (`POST /rooms/:id/calls/:call_id/join`):** Currently returns `{ "ice_servers": [] }` (Phase 19 placeholder).
- **Session Join (`POST /rooms/:id/sessions/:session_id/join`):** Returns `{ "media_config": { "ice_servers": [ { "urls": [...], "username": "...", "credential": "..." } ] } }`.

## 8. Current `generate_turn_credentials` Signature
- **Signature:** `pub fn generate_turn_credentials(config: &Config) -> Result<TurnCredentialsResponse, anyhow::Error>` in `server/src/calls/turn.rs`.
- **Usability:** Can be called directly from `join_call` / `join_handler` in `server/src/calls/lifecycle.rs`.

## 9. Current `TURN_TTL_SECONDS` Config
- **Default:** 600 seconds.
- **Usage:** Included in `TurnCredentialsResponse.ttl` and used in expiry computation (`now + config.turn_ttl_seconds as i64`).

## 10. Current `TURN_URL` Splitting Behavior
- The full list of split and trimmed URLs is returned in `urls: Vec<String>`.

## 11. Existing Tests
- `server/tests/call_turn.rs` (registered under `messaging` batch in `server/tests/batch-manifest.toml`):
  1. `test_turn_credentials_success`
  2. `test_turn_credentials_calling_disabled`
  3. `test_turn_credentials_not_configured`
  4. `test_turn_credentials_unauthenticated`
  5. `test_turn_credentials_rate_limit`
  6. `test_startup_validation_turn_url_without_secret`
  7. `test_turn_credentials_no_audit_or_events`

## 12. V2 Remnants & Structural Dependencies
- `server/src/sessions/occupancy.rs` defines `IceServer` struct:
  ```rust
  pub struct IceServer {
      pub urls: Vec<String>,
      pub username: String,
      pub credential: String,
  }
  ```
  This struct is used in `JoinResponse.media_config.ice_servers` for session joins.
- `server/src/calls/turn.rs` defines `TurnCredentialsResponse`:
  ```rust
  pub struct TurnCredentialsResponse {
      pub urls: Vec<String>,
      pub username: String,
      pub credential: String,
      pub ttl: u64,
  }
  ```

---

## Decision & Reconciliation Classification

**Classification: Case C (Reconciled without Spec Change)**

- **Reconciliation:**
  - Standard WebRTC `RTCIceServer` objects (and Session Join in Phase 21 / Task 40c) use `urls: Vec<String>` (array of URL strings).
  - V2 Task 37 canonical fact specifies `urls` (plural array) for direct `POST /calls/turn-credentials`.
  - V3 §8.7.3's `"url"` example in `Response: { "url": "...", ... }` is a simplified/truncated example for a single URL.
  - The standalone endpoint response continues to return `urls` (plural array), preserving multi-URL TURN configuration support.
  - The call join response (`POST /rooms/:id/calls/:call_id/join`) returns `ice_servers`:
    ```json
    {
      "ice_servers": [
        {
          "urls": ["turn:turn.example.com:3478", "turns:turn.example.com:5349"],
          "username": "1735689600:AbCdEfGhIjKlMnOp",
          "credential": "dGVzdC1jcmVkZW50aWFs=="
        }
      ]
    }
    ```
  - If `TURN_URL` is empty or `CALLING_ENABLED=false`, join returns `ice_servers: []`.
  - The join response ICE server object does not include `ttl` (matching §8.7.5).
  - No spec change is required.

---

## Deliverables & Implementation Plan

1. **ICE Server Struct for Calls:**
   - Define `IceServer` struct in `server/src/calls/turn.rs` (or share / re-export):
     ```rust
     #[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
     pub struct IceServer {
         pub urls: Vec<String>,
         pub username: String,
         pub credential: String,
     }
     ```
   - Update `JoinCallResponse` in `server/src/calls/lifecycle.rs`:
     ```rust
     #[derive(Debug, Serialize)]
     pub struct JoinCallResponse {
         pub ice_servers: Vec<IceServer>,
     }
     ```

2. **Wire Credential Generator into Call Join:**
   - In `join_call` (`server/src/calls/lifecycle.rs`), after validating `calling_enabled`, room membership, client ownership, and call occupancy cap:
     - Check if `config.turn_url` is non-empty.
     - If non-empty, call `generate_turn_credentials(config)`.
     - If successful, construct `vec![IceServer { urls: creds.urls, username: creds.username, credential: creds.credential }]`.
     - If `turn_url` is empty or `calling_enabled` is false, return `ice_servers: vec![]`.
   - Each join invocation generates fresh credentials (fresh random `opaque` and `expiry_timestamp`). No caching.

3. **Standalone TURN Endpoint Alignment:**
   - Retain `POST /calls/turn-credentials` matching V2 Task 37 fact (`urls` array).
   - Ensure rate limit `RATE_TURN_CREDENTIALS_PER_MIN` continues to apply only to direct calls to `POST /calls/turn-credentials`, and not to `POST /rooms/:id/calls/:call_id/join`.

4. **Tests in `server/tests/call_turn.rs`:**
   - Add new test cases verifying call join response `ice_servers`:
     - Join with `TURN_URL` configured returns `ice_servers` with `urls`, `username`, `credential`.
     - Consecutive joins generate different `username` values (fresh opaque, no caching).
     - Join with `TURN_URL` empty returns `ice_servers: []`.
     - Join with `CALLING_ENABLED=false` returns 501 `calling_disabled`.
     - Join endpoint is not rate-limited by `RATE_TURN_CREDENTIALS_PER_MIN` (fire 20 joins; all succeed).
     - Cross-check: `credential` format from standalone endpoint and join response are generated by the same code path.

5. **Tracking File Updates:**
   - Update `task-ledger.md` (move TURN Credentials Join Wiring to done).
   - Update `verification.md` (add entry recording reconciled contract and join response `ice_servers` shape).
