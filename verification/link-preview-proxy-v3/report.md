# Link Preview Proxy V3 Alignment Step 0 Report

## Executive Summary

- **Task:** Link Preview Proxy V3 Alignment (Phase 17 of §11)
- **Status:** Step 0 Complete — **Case B Identified (Specification Error)**
- **Finding:** V3 §8.1.2 mistakenly restates the link preview proxy request/response shape (`wrapped_content_key: <base64, RSA-OAEP>`, `encrypted_url`, `encrypted_metadata`), auth classification ("Public / Auth: None"), and rate limit scope ("per IP"). The server has no RSA keypair (all server keys are X25519 or Ed25519), advertises no RSA public key in `GET /capabilities`, and V3 §5.6 explicitly defines the rate limit key as `link_preview:{user_id}:min:{boundary}` per authenticated user. Furthermore, Extension Proxy (§8.1.5, Phase 26) reuses the exact same Ephemeral-Static X25519 ECDH Content Key mechanism and capabilities public key (`extension_proxy_key`).
- **Action:** Per prompt instructions for Case B, this task stops after Step 0 with the specification amendment proposal detailed below. No code changes are made. V2 Task 35 fact remains canonical until the spec is revised.

---

## Step 0 Empirical Audit (14 Items)

### 1. Current `POST /link-preview/proxy` Handler
- **Path:** `/api/v1/link-preview/proxy` (registered in `server/src/lib.rs` line 282).
- **Handler location:** `server/src/routes/link_preview.rs::proxy_handler`.
- **Auth:** Required (`AuthUser` extractor, expects `Authorization: Bearer <session_token>`).
- **Request shape:** `RequestEnvelope` JSON:
  ```json
  {
    "ephemeral_pubkey": "<base64_32B>",
    "nonce": "<base64_12B>",
    "ciphertext": "<base64>"
  }
  ```
- **Response shape:** `ResponseEnvelope` JSON:
  ```json
  {
    "nonce": "<base64_12B>",
    "ciphertext": "<base64>"
  }
  ```
  HTTP status 200 with `Content-Type: application/octet-stream`.
- **Status codes:**
  - `200 OK`: Successful fetch or encrypted error response envelope.
  - `400 Bad Request`: `invalid_request` for JSON parse error, invalid base64, key length mismatch (ephemeral pubkey != 32 bytes, nonce != 12 bytes), HKDF derivation failure, AES-GCM decryption failure, or request plaintext parse failure; `url_too_long` or `url_blocked` for SSRF guard error.
  - `401 Unauthorized`: Missing or invalid Bearer session token.
  - `429 Too Many Requests`: `rate_limited` with `Retry-After` header when user quota is exceeded.
  - `501 Not Implemented`: `proxy_disabled` when `LINK_PREVIEW_PROXY_ENABLED=false` or server proxy keys are uninitialized.
  - `502 Bad Gateway`: SSRF guard errors `fetch_failed` or `upstream_response_too_large`.
  - `500 Internal Server Error`: `rate_limit_error` or `internal_error`.
- **Comparison vs §8.1.2:**
  - §8.1.2 lists Request as: `{ "encrypted_url": "<base64>", "wrapped_content_key": "<base64, RSA-OAEP>", "nonce": "<base64, 12 bytes>" }`.
  - §8.1.2 lists Response as: `{ "encrypted_metadata": "<base64>", "nonce": "<base64, 12 bytes>" }`.
  - §8.1.2 lists Auth as "None" (Public).
  - Field name discrepancies: `ephemeral_pubkey` vs `wrapped_content_key`, `ciphertext` vs `encrypted_url`, `ciphertext` vs `encrypted_metadata`.
  - Auth discrepancy: Authenticated (`AuthUser`) vs Unauthenticated ("None").

### 2. Current Content Key Mechanism
- **Cryptographic construction:** Ephemeral-Static X25519 ECDH.
  - Server static secret key (`StaticSecret`, 32 bytes X25519).
  - Client ephemeral public key (`PublicKey`, 32 bytes X25519).
  - Shared secret derived via Diffie-Hellman (`server_secret.diffie_hellman(&client_pubkey)`).
- **KDF:** HKDF-SHA256 with `info = b"link-preview-content-key-v1"`, deriving 32-byte Content Key.
- **Cipher:** AES-256-GCM with 12-byte random nonce and 16-byte authentication tag.
- **Comparison vs §6.25 and V2 Task 35 fact:** Matches V2 Task 35 fact exactly. V3 §8.1.2 erroneously specifies "RSA-OAEP".

### 3. Current Key Path and Capability Field
- **Key path:** `LINK_PREVIEW_PROXY_KEY_PATH` defaults to `./data/link-preview.key`.
- **Key loading/generation:** `ProxyKeys::load_or_generate(key_path)`. Loads 32 bytes from file or generates 32 random bytes, sets Unix `0o600` permissions, derives X25519 public key.
- **Current capability field in `GET /capabilities`:** `extension_proxy_key` (Base64 string of 32-byte X25519 public key). `link_preview_proxy_key` was removed in Task 39a ("Removed Stale Fields" note).
- **Comparison vs §8.1:** §8.1 capabilities lists `extension_proxy_key` and does NOT list `link_preview_proxy_key` or any RSA public key.

### 4. Current SSRF Guard
- **Exact rules (`server/src/link_preview/ssrf.rs` and `server/src/proxy_common/ssrf.rs`):**
  - **Scheme:** `https://` required in production (`app_env == "production"`); `http://` permitted in non-production environments.
  - **URL length limit:** Maximum 2048 characters (`url_too_long`).
  - **Blocked IP ranges (`is_ip_blocked`):** Loopback (`127.0.0.0/8`, `::1`), private (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `fc00::/7`), link-local (`169.254.0.0/16`, `fe80::/10`), multicast (`224.0.0.0/4`, `ff00::/8`), reserved (`0.0.0.0/8`, `240.0.0.0/4`, `100.64.0.0/10`, `192.0.2.0/24`, `198.18.0.0/15`, `198.51.100.0/24`, `203.0.113.0/24`), IPv4-mapped IPv6, and cloud metadata addresses (`169.254.169.254`, `fd00:ec2::254`).
  - **IP pinning:** Hostname is resolved via `lookup_host`, target IP is pinned using `Client::builder().resolve(host_str, target_addr)`.
  - **Redirect re-validation:** Maximum 5 redirects (`Policy::none()`). Target URL scheme and resolved IP are re-evaluated per redirect hop.
  - **Body size cap:** `LINK_PREVIEW_PROXY_MAX_BYTES` (default 1,048,576 bytes).
  - **Decompression cap:** Bounded decoders for `gzip` and `deflate` enforcing `max_bytes` on decompressed output (`upstream_response_too_large`).
  - **Timeout:** `LINK_PREVIEW_PROXY_TIMEOUT_SECONDS` (default 5s) connect/read timeout, total timeout `2 * timeout_seconds`.
- **Comparison vs V2 Task 35 fact:** 100% matches V2 Task 35 fact.

### 5. Current HTML Handling
- **Behavior:** Fetches raw response body, decompresses if compressed (`gzip`/`deflate`), enforces `max_bytes`, encodes body as Base64 in `ResponsePlaintext.body`, and forwards response headers in allowlist (`content-type`, `content-length`, `etag`, `last-modified`, `cache-control`, `expires`).
- **Comparison vs §8.1.2 "strip all HTML":** Current implementation forwards raw response body bytes (base64-encoded). The client extracts OpenGraph metadata from the HTML.

### 6. Current Config Variables
- `LINK_PREVIEW_PROXY_ENABLED`: bool (default `false`).
- `LINK_PREVIEW_PROXY_TIMEOUT_SECONDS`: u64 (default `5`).
- `LINK_PREVIEW_PROXY_MAX_BYTES`: u64 (default `1,048,576`).
- `LINK_PREVIEW_PROXY_KEY_PATH`: String (default `"./data/link-preview.key"`).
- **Comparison vs §5.23:** Matches §5.23.

### 7. Current Rate Limit
- **Config:** `RATE_LINK_PREVIEW_PER_MIN` (default 10).
- **Key format:** `link_preview:{user_id}:min:{boundary}`.
- **Scope:** Per authenticated user (`user_id`).
- **Comparison vs §5.6 & §8.1.2:** §5.6 specifies `link_preview:{user_id}:min:{boundary}` per user. §8.1.2 erroneously states "Auth: None. Rate limit: RATE_LINK_PREVIEW_PER_MIN, per IP."

### 8. Current Auth
- **Current:** Endpoint requires Bearer Auth session token (`AuthUser`).
- **Comparison vs §8.1.2:** §8.1.2 classifies endpoint under "Public" with "Auth: None".

### 9. Current Response Envelopes
- **Request Envelope:** `{ "ephemeral_pubkey": "<base64_32B>", "nonce": "<base64_12B>", "ciphertext": "<base64>" }`.
- **Response Envelope:** `{ "nonce": "<base64_12B>", "ciphertext": "<base64>" }`.
- **Request Plaintext:** `{ "url": "<https URL>", "request_id": "<string>" }`.
- **Response Plaintext:** `{ "status": <u16>, "headers": { ... }, "body": "<base64>", "request_id": "<string>" }`.
- **Error Plaintext:** `{ "error": "<code_string>", "request_id": "<string>" }`.

### 10. Current `wrapped_content_key` Handling
- **RSA-OAEP presence:** Zero RSA-OAEP code paths exist in the codebase. All key wrapping in the proxy uses X25519 ECDH via `x25519_dalek` and HKDF-SHA256 via `hkdf`.

### 11. Current Capability Exposure
- `link_preview_proxy_enabled`: bool.
- `extension_proxy_key`: Base64 string of 32-byte X25519 public key (or `null` if both link preview and extension proxy are disabled).
- `link_preview_proxy_key`: NOT exposed (removed in Task 39a).
- No RSA public key is exposed anywhere in `GET /capabilities`.

### 12. Current Plaintext Non-Persistence
- **Discipline:** Plaintext URLs, headers, and response bodies are decrypted in memory only and never written to stdout, stderr, audit logs, or SQLite database.
- **Verification:** Unit test `test_roundtrip_fetch_success` and `test_link_preview_disabled_by_default` assert `SELECT COUNT(*) FROM audit_log` before and after proxy requests and confirm zero new audit rows or log entries.

### 13. Existing Tests
- `server/tests/link_preview.rs` (9 test cases):
  1. `test_link_preview_disabled_by_default`
  2. `test_capabilities_enabled`
  3. `test_unauthenticated_request`
  4. `test_roundtrip_fetch_success`
  5. `test_ssrf_blocks_private_ips`
  6. `test_ssrf_blocks_http_in_production`
  7. `test_size_limit_exceeded`
  8. `test_gzip_bomb_exceeds_cap`
  9. `test_rate_limiting`
- **Batch assignment in `server/tests/batch-manifest.toml`:** `name = "link_preview"` containing `["link_preview"]`.

### 14. V2 Remnants
- Struct definitions in `server/src/proxy_common/content_key.rs` and `server/src/link_preview/content_key.rs` (`RequestEnvelope`, `ResponseEnvelope`, `RequestPlaintext`, `ResponsePlaintext`, `ErrorPlaintext`), HKDF info string `b"link-preview-content-key-v1"`, and `AuthUser` extractor in `proxy_handler`.

---

## Discrepancy Classification & Decision

**Case B — V2 Task 35 is authoritative and V3 §8.1.2 is a specification error.**

### Rationale

1. **RSA-OAEP Impossibility:** V3 §8.1.2 specifies `wrapped_content_key: <base64, RSA-OAEP>`. However, the server has no RSA keypair (all server keys are X25519 or Ed25519), and no RSA public key is advertised in `GET /capabilities` (§8.1) or anywhere else. A client cannot perform RSA-OAEP wrapping without a server RSA public key.
2. **Key Capability Alignment:** V3 §8.1 and Task 39a advertise `extension_proxy_key` (Base64 X25519 public key) when link preview or extension proxy is enabled. Extension Proxy (§8.1.5, Phase 26) reuses this exact X25519 public key with Ephemeral-Static X25519 ECDH and HKDF `info = b"extension-proxy-content-key-v1"`.
3. **Rate Limit & Auth Mismatch:** V3 §8.1.2 states "Auth: None. Rate limit: RATE_LINK_PREVIEW_PER_MIN, per IP." But V3 §5.6 explicitly defines the rate limit key format for link preview as `link_preview:{user_id}:min:{boundary}` (per user), which requires an authenticated user identity (`user_id`).
4. **Envelope Field Names:** V3 §8.1.2's field names (`encrypted_url`, `wrapped_content_key`, `encrypted_metadata`) conflict with the canonical V2 Task 35 wire format (`ephemeral_pubkey`, `nonce`, `ciphertext`).

---

## Proposed Specification Amendment

Amend V3 §8.1.2 to state that `POST /link-preview/proxy` uses the canonical V2 Task 35 wire contract, Ephemeral-Static X25519 ECDH key agreement, and authenticated user rate limiting:

- **Endpoint:** `POST /api/v1/link-preview/proxy` (Requires Bearer Auth session token).
- **Rate limit:** `RATE_LINK_PREVIEW_PER_MIN` per user, key `link_preview:{user_id}:min:{boundary}` per §5.6.
- **Request Envelope:**
  ```json
  {
    "ephemeral_pubkey": "<base64, 32 bytes X25519>",
    "nonce": "<base64, 12 bytes>",
    "ciphertext": "<base64>"
  }
  ```
- **Response Envelope:**
  ```json
  {
    "nonce": "<base64, 12 bytes>",
    "ciphertext": "<base64>"
  }
  ```
- **Content Key Mechanism:** Ephemeral-Static X25519 ECDH against server's X25519 public key (exposed as `extension_proxy_key` in `GET /capabilities`), KDF HKDF-SHA256 with `info = b"link-preview-content-key-v1"` deriving 32-byte Content Key, AES-256-GCM encryption with 12-byte nonce.
