# Link Preview Proxy v3.0.4 Alignment Verification Report

## Executive Summary

- **Task:** Link Preview Proxy v3.0.4 Alignment (Phase 17 of §11)
- **Specification:** Server Specification v3.0.4 (§5.9, §5.23, §5.31, §5.6, §7.13, §8.1, §8.1.2, §8.1.5, §12)
- **Status:** Verification Complete — Production Code 100% Matches Adopted v3.0.4 §8.1.2 Contract
- **Test Coverage Additions:** Added test suite in `server/tests/link_preview.rs` covering capabilities behavior across all enable/disable matrix combinations, shared key file loading and permissions, HKDF info string separation and replay prevention, envelope error conditions, and tracing log opacity.
- **Backup Finding:** Recorded gap that `LINK_PREVIEW_PROXY_KEY_PATH` is currently not packed by `server/src/backup/format.rs`.

---

## 1. Verification Against Adopted v3.0.4 §8.1.2

The production code in `server/src/` was audited against each requirement of adopted v3.0.4 §8.1.2:

| Contract Requirement | Specification | Production Code Location | Status / Finding |
|---|---|---|---|
| **Authentication** | Required. Bearer session token (`AuthUser`) | `server/src/routes/link_preview.rs::proxy_handler` (`auth: AuthUser`) | Matches. Unauthenticated requests return 401 Unauthorized. |
| **Rate Limit** | `RateLimitKey::LinkPreview`, key `link_preview:{user_id}:min:{boundary}`, `RATE_LINK_PREVIEW_PER_MIN` (default 10) | `server/src/routes/link_preview.rs` & `server/src/rate_limit.rs` | Matches. Enforces per-user rate limit. 11th request returns 429 with `Retry-After`. |
| **Request Envelope** | `{ "ephemeral_pubkey": "<base64>", "nonce": "<base64>", "ciphertext": "<base64>" }` | `server/src/proxy_common/content_key.rs::RequestEnvelope` | Matches. Standard JSON envelope with unpadded/flexible base64 strings. |
| **Response Envelope** | `{ "nonce": "<base64>", "ciphertext": "<base64>" }` | `server/src/proxy_common/content_key.rs::ResponseEnvelope` | Matches. Standard JSON envelope with unpadded/flexible base64 strings. |
| **Content Key Derivation** | Ephemeral-Static X25519 ECDH + `HKDF-Expand(shared, b"link-preview-content-key-v1", 32)` (SHA-256) | `server/src/link_preview/content_key.rs::derive_content_key` & `server/src/proxy_common/content_key.rs::derive_content_key` | Matches. 32-byte derived content key. |
| **Cipher** | AES-256-GCM with 12-byte random nonce and 16-byte authentication tag | `server/src/proxy_common/content_key.rs::encrypt_payload` / `decrypt_payload` | Matches. AES-256-GCM via `aes_gcm` crate. |
| **SSRF Guard** | HTTPS required in production, URL length limit (2048), blocked IP ranges (private, loopback, link-local, cloud metadata), IP pinning, redirect re-validation (max 5), body size cap, timeout | `server/src/link_preview/ssrf.rs` & `server/src/proxy_common/ssrf.rs` | Matches V2 Task 35 fact. |

---

## 2. RSA-OAEP Code Path Check

A codebase search for RSA-OAEP remnants in `server/src/` was performed:
```sh
grep -rniE "rsa|oaep|wrapped_content_key|encrypted_url|encrypted_metadata" server/src/
```
**Result:** Exactly 0 matches found in `server/src/`. No RSA keypair or RSA-OAEP decryption code exists in server production code.

---

## 3. Capabilities Behavior

 audited `GET /capabilities` handler in `server/src/routes/capabilities.rs`:

1. **`extension_proxy_key` Presence Logic:**
   ```rust
   let extension_proxy_key =
       if state.config.extension_proxy_enabled || state.config.link_preview_proxy_enabled {
           state
               .link_preview_keys
               .as_ref()
               .map(|k| k.public_key_base64.clone())
       } else {
           None
       };
   ```
   - `LINK_PREVIEW_PROXY_ENABLED=true` & `EXTENSION_PROXY_ENABLED=false`: `extension_proxy_key` is present (base64 string of 32-byte X25519 public key).
   - `LINK_PREVIEW_PROXY_ENABLED=false` & `EXTENSION_PROXY_ENABLED=true`: `extension_proxy_key` is present.
   - Both `true`: `extension_proxy_key` is present.
   - Both `false`: `extension_proxy_key` is `None` (serializes to `null`).

2. **Capability Field Set:**
   `GET /capabilities` response includes:
   - `link_preview_proxy_enabled`
   - `extension_proxy_enabled`
   - `extension_proxy_key`
   - `extension_proxy_max_request_bytes`
   - `extension_proxy_max_response_bytes`
   - `extension_proxy_supports_streaming`

   **Absence Check:** No `link_preview_proxy_key` field exists in `CapabilitiesResponse` or response output.

---

## 4. Shared Key File

Audited key management in `server/src/proxy_common/content_key.rs` and `server/src/lib.rs`:

- **Path:** Configured via `LINK_PREVIEW_PROXY_KEY_PATH` (defaults to `./data/link-preview.key`).
- **Shared Access:** `state.link_preview_keys` is loaded at startup via `ProxyKeys::load_or_generate(key_path)` and shared by both `routes/link_preview.rs` and `routes/extensions_proxy.rs`.
- **Permissions:** Generated on Unix with file mode `0600` (`PermissionsExt::from_mode(0o600)`).
- **HKDF Info Separation:**
  - Link Preview Proxy uses `b"link-preview-content-key-v1"`.
  - Extension Proxy uses `b"extension-proxy-content-key-v1"`.

---

## 5. HKDF Info String Separation & Replay Prevention

Because the HKDF info strings differ, an ECDH shared secret $S = \text{ECDH}(sk_{server}, pk_{client})$ yields distinct content keys:
$$K_{LP} = \text{HKDF-Expand}(S, \text{"link-preview-content-key-v1"}, 32)$$
$$K_{EP} = \text{HKDF-Expand}(S, \text{"extension-proxy-content-key-v1"}, 32)$$

A request payload encrypted under $K_{LP}$ for the link preview proxy cannot be decrypted by the extension proxy under $K_{EP}$. AES-256-GCM decryption fails authentication tag validation.

---

## 6. Backup Inclusion Audit & Recorded Gap

Audited `server/src/backup/format.rs` and `server/src/backup/job.rs`:

- **Current Behavior:** `build_backup_archive` packs `manifest.json`, `app.db`, `oprf.key`, and optional `attachments/`.
- **Finding (Gap):** `LINK_PREVIEW_PROXY_KEY_PATH` (e.g. `./data/link-preview.key`) is **not** included in the backup archive by `server/src/backup/format.rs`.
- **Action:** As instructed by the task specification, this gap is recorded as a finding. Backup code was not modified in this task.

---

## 7. Documentation Alignment

Audited comments and docstrings in `server/src/`. No comments or docstrings reference the superseded RSA-OAEP, per-IP, or unauthenticated link preview proxy shape.
