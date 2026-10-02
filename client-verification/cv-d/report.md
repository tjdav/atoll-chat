# Task C-V-D Verification Report — Client OPAQUE Library Availability & Wire Compatibility

**Date:** 2026-10-02
**Status:** Complete
**Author:** Client Verification Team

---

## 1. Question

The client specification (§16.2, §16.3, §16.9) specifies that the client runs OPAQUE asymmetric password-authenticated key exchange (aPAKE) locally for login, registration, and recovery flows. The server uses the Rust `opaque-ke 4.0.1` crate with `DefaultCipherSuite` (`Ristretto255`, `TripleDh<Ristretto255, Sha512>`, and `Argon2` KSF).

This verification report answers:
1. What JavaScript OPAQUE options are available in the npm ecosystem?
2. Are any candidate JavaScript libraries byte-for-byte wire-compatible with the server's `opaque-ke 4.0.1` implementation across registration, login, and session key derivation?
3. What is the wire encoding format for OPAQUE messages exchanged with the server?
4. What strategy is recommended for task C-AUTH-3 (OPAQUE Login & Registration Flows)?

---

## 2. Method

### Candidates Surveyed
We evaluated all published JavaScript / WASM OPAQUE libraries in the npm registry:

1. **`@serenity-kit/opaque@1.1.0`** (Published 8 months ago, MIT license, zero dependencies, inlined WebAssembly bundle compiled directly from `opaque-ke`).
2. **`@cloudflare/opaque-ts@0.7.5`** (Published >1 year ago, BSD-3-Clause, uses `@cloudflare/voprf-ts` + WebCrypto API + `@noble/hashes`).
3. **`opaque-wasm@2.1.0`** (Published >1 year ago, Proprietary license, requires external WASM file initialization via `initSync` / fetch).
4. **`opaque-ke-wasm` / `@opaque-ke/wasm`** (Do not exist on the npm registry).

### Empirical Differential Execution Test
To verify byte-level interoperation, we constructed a standalone Rust reference binary compiled against `opaque-ke 4.0.1` using the server's exact cipher suite configuration:

```rust
pub struct DefaultCipherSuite;
impl CipherSuite for DefaultCipherSuite {
    type OprfCs = Ristretto255;
    type KeyExchange = TripleDh<Ristretto255, Sha512>;
    type Ksf = opaque_ke::argon2::Argon2<'static>;
}
```

We executed a full round-trip OPAQUE exchange between `@serenity-kit/opaque@1.1.0` running in Node.js v24 and the `opaque-ke 4.0.1` Rust binary across:
1. `RegistrationRequest` (Client → Server)
2. `RegistrationResponse` (Server → Client)
3. `RegistrationRecord` / `ServerRegistration` password file storage
4. `CredentialRequest` (Client → Server)
5. `CredentialResponse` (Server → Client)
6. `CredentialFinalization` (Client → Server)
7. Final session key derivation comparison (`ServerLogin::finish`)

---

## 3. Evidence

### Candidate Evaluation Summary

| Feature / Metric | `@serenity-kit/opaque@1.1.0` | `@cloudflare/opaque-ts@0.7.5` | `opaque-wasm@2.1.0` |
|---|---|---|---|
| **Underlying Spec** | RFC 9807 / `opaque-ke` Rust crate | Draft IRTF CFRG `draft-opaque-07` | `opaque-ke` (v0.x Rust crate) |
| **Cipher Suite** | `Ristretto255`, `TripleDh`, `Sha512`, `Argon2` | `P-256` / `scrypt` / `SHA-256` | Legacy `opaque-ke` |
| **`opaque-ke 4.0.1` Parity** | **100% Byte-Exact Match** | Incompatible (different curve & KSF) | Incompatible (legacy struct layout) |
| **Package Size** | 324 kB packed / 889 kB unpacked | 25 kB packed / 142 kB unpacked | 91 kB packed / 280 kB unpacked |
| **WASM Loading** | Inlined embedded base64 bundle (synchronous/auto-initialized) | Pure JS (no WASM) | Asynchronous fetch / `init()` required |
| **Security Audit** | 7ASecurity Whitebox Review & Pen Test (Red Team Lab) | Internal Cloudflare review | None |
| **License** | MIT | BSD-3-Clause | Proprietary |

### Differential Test Output & Parity Confirmation

Running the differential test suite yielded full, byte-exact alignment across all handshake steps:

```text
=== 1. Server Setup ===
ServerSetup B64: kppudYRNVR/XZ5lBs0dUM+wm1sWuuN... (128 bytes)

=== 2. Registration Start ===
Client RegistrationRequest (b64url): JsXhTZY-97u0-TWnU8YScM6khCvjQpaiI54M89HYO0A (32 bytes)
Server RegistrationResponse (b64): fkqex3WzGvt84Lpk0EvUizewEQTfk7... (64 bytes)

=== 3. Registration Finish ===
RegistrationRecord (b64url): Yswo_DA2TYr2AV3dJ4H66uaVUz00... (192 bytes)
Server OPAQUE Registration Record (b64): 256 bytes

=== 4. Login Start ===
Client CredentialRequest (b64url): 6gtBUH3PdRlGJp04nfoVloyeQ50r6X70... (96 bytes)
Server CredentialResponse (b64): dFkPtDR9StVCDa7LUeceT15wDpTdVa... (320 bytes)

=== 5. Login Finish ===
Client Session Key (Hex): c36560a49dcaeb276d641af5a22c4f78ed6ab0dd345ad898d9a40b15811264054f07d5442f640e222bb653a9d4ccd11cddfeaa5bafd469456eb104704c060119
Server Session Key (Hex): c36560a49dcaeb276d641af5a22c4f78ed6ab0dd345ad898d9a40b15811264054f07d5442f640e222bb653a9d4ccd11cddfeaa5bafd469456eb104704c060119

>>> PARITY SUCCESS: Client and Server derived identical 64-byte Session Key! <<<
```

### Wire Format Encoding Rules

Analysis of `server/src/routes/register.rs` and `server/src/routes/login.rs` confirmed the wire encoding conventions:

1. **Client → Server Requests**:
   - The server helper function `decode_base64` accepts both standard Base64 (`STANDARD`) and URL-safe unpadded Base64 (`URL_SAFE_NO_PAD`).
   - The client MUST transmit messages formatted as Base64URL string representations (`URL_SAFE_NO_PAD`).

2. **Server → Client Responses**:
   - Server endpoints (`register_start`, `login_start`) serialize OPAQUE response messages using standard Base64 string encoding (`STANDARD`).
   - When passing server responses into `@serenity-kit/opaque@1.1.0` client methods, the client MUST convert standard Base64 strings to unpadded Base64URL strings (`.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')`).

### Handshake State Lifetime & Parameters
- Registration and login client states (`clientRegistrationState`, `clientLoginState`) are serialized string handles produced by `opaque.client.startRegistration` and `opaque.client.startLogin`.
- These state strings live in ephemeral JS memory during the single-request window (5-minute server timeout bound) and MUST NOT be persisted to long-term storage.

---

## 4. Security & Quality Checks

1. **Password Isolation**: The client's plaintext password is processed exclusively inside the WASM module boundaries during `startRegistration`, `finishRegistration`, `startLogin`, and `finishLogin`. Plaintext passwords never leave client memory and are never transmitted over the wire.
2. **Envelope Secrecy**: The long-term secret OPAQUE envelope (`registrationRecord`) is computed client-side and transmitted to the server during registration finish / recovery re-registration. The server stores `opaque_registration` without being able to decrypt the inner key material.
3. **Entropy Source**: `@serenity-kit/opaque` binds WASM `getrandom` directly to `crypto.getRandomValues()` in browser and Node environments. It does not use `Math.random`.
4. **Console Hygiene**: Verification confirmed that calling `@serenity-kit/opaque` APIs emits zero `console.log` or debug statements.
5. **Audited Codebase**: `@serenity-kit/opaque` underwent a full whitebox security review and penetration test conducted by 7ASecurity (funded via OTF's Red Team Lab).

---

## 5. Answer & Recommendation

**Recommended Strategy:** **WASM-Backed JS Library (`@serenity-kit/opaque@1.1.0`)**

- **Package Name**: `@serenity-kit/opaque`
- **Version Pin**: `1.1.0`
- **License**: MIT
- **Rationale**: `@serenity-kit/opaque@1.1.0` is compiled directly from the Rust `opaque-ke` crate using `wasm-bindgen`. It delivers **100% byte-exact wire compatibility** with the server's `opaque-ke 4.0.1` crate, embeds its WebAssembly payload synchronously inside its bundle (requiring zero external WASM asset pipeline setup), and is fully security audited.

### API Usage Example

```javascript
import * as opaque from "@serenity-kit/opaque";

// Helper utilities for Base64 / Base64URL translation
function b64ToB64url(s) {
  return s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

// --- Registration Flow ---
const regStart = opaque.client.startRegistration({ password: "user-password" });
// Send regStart.registrationRequest (Base64URL) to POST /api/v1/auth/register/start
// Receive serverResponse.registration_response (standard Base64)

const regFinish = opaque.client.finishRegistration({
  password: "user-password",
  registrationResponse: b64ToB64url(serverResponse.registration_response),
  clientRegistrationState: regStart.clientRegistrationState,
});
// regFinish.registrationRecord is Base64URL string sent to POST /api/v1/auth/register/finish

// --- Login Flow ---
const loginStart = opaque.client.startLogin({ password: "user-password" });
// Send loginStart.startLoginRequest (Base64URL) to POST /api/v1/auth/login/start
// Receive serverResponse.credential_response (standard Base64)

const loginFinish = opaque.client.finishLogin({
  clientLoginState: loginStart.clientLoginState,
  loginResponse: b64ToB64url(serverResponse.credential_response),
  password: "user-password",
});
// loginFinish.finishLoginRequest is Base64URL sent to POST /api/v1/auth/login/finish
// loginFinish.sessionKey is the derived 64-byte secret key (Base64URL)
```

---

## 6. Implications for C-AUTH-3

1. **Scope Confirmation**: C-AUTH-3 can proceed as a single pure JS application implementation task. No custom WASM build steps, no Rust toolchains, and no additional Coralite build plugins are required.
2. **Dependencies**: Add `@serenity-kit/opaque`: `1.1.0` to `packages/app/package.json` under runtime `dependencies` during task C-AUTH-3 implementation.
3. **Encoding Shims**: C-AUTH-3 must include a 2-line Base64-to-Base64URL translation helper when ingesting server responses (`registration_response`, `credential_response`).
4. **Auth Event Contract Unchanged**: Auth gate event signatures established in C-AUTH-1 (`auth:login:submit`, `auth:register:submit`, `auth:recovery:submit`) require no schema modifications.
