# C-V-C — Verify Client-Side OPRF Library Availability Report

**Date:** 2026-10-02
**Task:** C-V-C (Verify Client-Side OPRF Library Availability)
**Status:** Complete

---

## 1. Question

Does a JavaScript OPRF library exist that provides Ristretto255-SHA512 in base (non-verifiable) mode per RFC 9497, with an RFC 9497 §2.2 finalization step whose output is byte-for-byte compatible with the server's `voprf 0.5.0` Rust crate (`voprf::OprfClient::finalize()`), producing an 86-character unpadded base64url string decoding to 64 bytes?

If so, what is the exact library, version, and wire-format mapping? If not, what is the optimal implementation strategy (hybrid, WASM port, or custom) and its implications for C-AUTH-2?

---

## 2. Method

To answer this question conclusively, we inspected npm packages, evaluated their maintenance status, dependencies, and bundle characteristics, and performed a differential execution test between a reference Rust server program utilizing `voprf 0.5.0` and client JavaScript candidates.

### Packages Evaluated
1. **`@noble/curves`** (`v2.4.0`) — Active (published <1 month ago), MIT license, 0 dependencies. Evaluated `@noble/curves/ed25519.js` (`ristretto255_oprf.oprf`).
2. **`@cloudflare/voprf-ts`** (`v1.0.0`) — Published >1 year ago, BSD-3-Clause license. Evaluated `OPRFClient` with suite `ristretto255-SHA512`.
3. **`@privacyresearch/oprf-ts`** (`v0.0.7`) — Published >1 year ago, GPL-3.0 license. Evaluated suite support.
4. **`@plumbox/oprf`** (`v0.1.0`) — Published <1 week ago, MIT license. Evaluated dependencies (`libsodium-wrappers-sumo`) and finalization output.
5. **`@aldenml/ecc`** (`v1.1.0`) — Published >1 year ago, MIT license. Evaluated browser suitability.

### Differential Testing Procedure
- Created a temporary Rust workspace in `/tmp` using `voprf = "=0.5.0"` configured with `OprfServer::<Ristretto255>::new_from_seed(&key_bytes, b"username-oprf-v1")`.
- Constructed a Node.js `v24.21.0` test runner executing candidate JS implementations for blinding and finalization against the Rust server evaluator.
- Evaluated blinding factor randomness, wire-format serialization (`BlindedElement` and `EvaluationElement` standard base64 encoding), finalization hash construction, and unpadded base64url output formatting.

---

## 3. Evidence

### Candidate Survey Findings

| Candidate | Version | Maintenance | License | Size | Ristretto255 Support | RFC 9497 Finalize Compatible | Browser / Pure JS |
|---|---|---|---|---|---|---|---|
| **`@noble/curves`** | `2.4.0` | Active (<1 mo) | MIT | ~100kB (tree-shakes to ~15kB) | Yes | **Yes (Byte-Exact)** | Yes (0 deps) |
| **`@cloudflare/voprf-ts`** | `1.0.0` | Inactive (>1 yr) | BSD-3-Clause | 676kB | No (throws `bad group name ristretto255`) | No | No (requires SJCL) |
| **`@privacyresearch/oprf-ts`** | `0.0.7` | Inactive (>1 yr) | GPL-3.0 | 84kB | No (only ed25519 / secp256k1) | No | Yes |
| **`@plumbox/oprf`** | `0.1.0` | Active (1 wk) | MIT | 5.3MB | Custom libsodium construction | No | No (5.3MB WASM) |
| **`@aldenml/ecc`** | `1.1.0` | Inactive (>1 yr) | MIT | 1.1MB | C-bindings wrapper | No | No |

#### Note on `@cloudflare/voprf-ts`
While `Oprf.Suite.RISTRETTO255_SHA512` is defined in its TypeScript enum, instantiating `new OPRFClient(Oprf.Suite.RISTRETTO255_SHA512)` fails at runtime with `Error: group: bad group name ristretto255`. Its underlying curve backend (`groupSjcl.js`) only implements NIST P-curves.

### Differential Test Output

We performed an end-to-end differential test between `@noble/curves@2.4.0` (`ristretto255_oprf.oprf`) and `voprf 0.5.0` (Rust crate).

#### Input Data
- Username: `alice` (`b"alice"`)
- OPRF Domain Separator: `b"username-oprf-v1"`
- Server Seed Key: `[42u8; 32]`

#### Rust Reference Run Output (`voprf 0.5.0`)
```text
Blinded bytes len: 32
Blinded hex: 18fcd8497bb4b3d9cbb0c11bd2d36020a85c4283a24624046ee80056f293860c
Eval bytes len: 32
Eval hex: acbe450c4deda149defde6b8930db19b4e8f8f58375b6b8d2742ec4e20accb1d
Token bytes len: 64
Token hex: 136dcf0ba9870c4a7a5312bcc25e7c83cb100869b07f63f630da45370fa087c949056fb7f591fdc78dd577ee4843f04f2d74252645607c71cb182adf2d790e4d
Token base64url no pad: E23PC6mHDEp6UxK8wl58g8sQCGmwf2P2MNpFNw-gh8lJBW-39ZH9x43Vd-5IQ_BPLXQlJkVgfHHLGCrfLXkOTQ
Token base64url len: 86
```

#### Node.js Run Output (`@noble/curves@2.4.0` `ristretto255_oprf.oprf`)
```text
Blinded Hex (from JS): 2e6c460d7ee9907edcee677b86911cc7f466963c47371edba95345a734027f0f
Rust Server Evaluated Output:
EVAL_HEX=8e0bc20c830b6f534c26ff1f2f12f1657a45f31e2b9f81d28387345d99b1677c
EVAL_B64=jgvCDIMLb1NMJv8fLxLxZXpF8x4rn4HSg4c0XZmxZ3w=
Final Token len: 64
Final Token Hex (from JS): 136dcf0ba9870c4a7a5312bcc25e7c83cb100869b07f63f630da45370fa087c949056fb7f591fdc78dd577ee4843f04f2d74252645607c71cb182adf2d790e4d
Final Token Base64url (from JS): E23PC6mHDEp6UxK8wl58g8sQCGmwf2P2MNpFNw-gh8lJBW-39ZH9x43Vd-5IQ_BPLXQlJkVgfHHLGCrfLXkOTQ
Final Token Base64url len: 86
```

#### Key Verification Findings
1. **Byte-Exact Parity:** The 64-byte finalized output from `@noble/curves` (`136dcf0ba9870c...`) and its 86-character base64url encoding (`E23PC6mHDEp6UxK8...`) are 100% byte-for-byte identical to Rust `voprf 0.5.0`!
2. **RFC 9497 Finalize Construction:** `@noble/curves` implements the exact RFC 9497 §2.2 finalize hash input format:
   `I2OSP(len(username), 2) || username || I2OSP(32, 2) || unblinded_element || "Finalize"`
   followed by SHA-512 digest returning 64 bytes.
3. **Wire Format Mapping:**
   - Client sends standard base64 of 32-byte compressed Ristretto255 point `blinded` in `POST /api/v1/oprf/blind`.
   - Server returns standard base64 of 32-byte compressed Ristretto255 point `evaluated`.
   - Client decodes standard base64 to 32 bytes and passes to `ristretto255_oprf.oprf.finalize(usernameBytes, blindBytes, evalBytes)`.
   - Client encodes 64-byte output as unpadded base64url (`URL_SAFE_NO_PAD`) resulting in an 86-character string.

### Security & Blinding Factor Check
- `@noble/curves` `ristretto255_oprf.oprf.blind(input)` generates scalar `r` using uniform sampling from 64 random bytes via `globalThis.crypto.getRandomValues()` (or custom CSPRNG `rng` function).
- Unblinding calculates `unblinded = evaluated * r^-1 mod L`.
- The scalar `r` remains in client ephemeral memory during the flow and is never transmitted to or inferable by the server.

### Mock Endpoint Feasibility
- Creating a mock server endpoint for client unit/component testing (`POST /api/v1/oprf/blind`) is straightforward:
  ```js
  import { ristretto255_oprf } from '@noble/curves/ed25519.js';

  // Mock server evaluation handler
  function mockOprfBlindHandler(reqBody, mockServerPrivateKey) {
    const blindedBytes = Uint8Array.from(atob(reqBody.blinded), c => c.charCodeAt(0));
    const evalBytes = ristretto255_oprf.oprf.blindEvaluate(mockServerPrivateKey, blindedBytes);
    return { evaluated: btoa(String.fromCharCode(...evalBytes)) };
  }
  ```
- Alternatively, live tests can hit the real server's `POST /api/v1/oprf/blind` endpoint which is already implemented and verified.

---

## 4. Answer & Recommendation

**Recommended Strategy:** **Strategy 1 — Pure-JS Library (`@noble/curves` `v2.4.0`)**

### Rationale
- `@noble/curves` `v2.4.0` is an active, zero-dependency, high-quality pure JavaScript library.
- Its `ristretto255_oprf.oprf` module provides native RFC 9497 `ristretto255-SHA512` base mode OPRF methods with byte-exact compatibility with `voprf 0.5.0` (Rust).
- It runs natively in modern browsers and Node.js `>=24` without WASM assets, build pipeline modifications, or Node.js polyfills.
- It tree-shakes cleanly to ~15 KiB.

### Recommended Version Pins
- `@noble/curves`: `^2.4.0` (or pinned `2.4.0`)
- `@noble/hashes`: `^1.7.0` (or pinned `1.7.0` for hash utility functions if needed)

### Flow Code Reference Example
```js
import { ristretto255_oprf } from '@noble/curves/ed25519.js';

/**
 * Executes client-side OPRF protocol flow.
 * @param {string} username Plaintext handle (e.g. "alice")
 * @returns {Promise<string>} 86-character base64url username token
 */
export async function deriveUsernameToken(username) {
  const usernameBytes = new TextEncoder().encode(username);

  // 1. Client blind (RFC 9497 Ristretto255-SHA512)
  const { blind, blinded } = ristretto255_oprf.oprf.blind(usernameBytes);

  // 2. Base64 encode 32B compressed Ristretto255 point for wire
  const blindedB64 = btoa(String.fromCharCode(...blinded));

  // 3. Request server evaluation
  const response = await fetch('/api/v1/oprf/blind', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ blinded: blindedB64 }),
  });
  if (!response.ok) {
    throw new Error(`OPRF blind request failed: ${response.status}`);
  }
  const { evaluated: evaluatedB64 } = await response.json();

  // 4. Decode 32B evaluated point
  const evalBytes = Uint8Array.from(atob(evaluatedB64), c => c.charCodeAt(0));

  // 5. Finalize (unblind + SHA-512 per RFC 9497 §2.2)
  const tokenBytes = ristretto255_oprf.oprf.finalize(usernameBytes, blind, evalBytes);

  // 6. Base64url unpadded encode 64B digest to 86-char string
  // In browser: custom base64url or URL-safe replacement without padding
  const base64 = btoa(String.fromCharCode(...tokenBytes));
  const base64url = base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  return base64url;
}
```

---

## 5. Implications for C-AUTH-2

1. **No WASM Pipeline Needed:** C-AUTH-2 does not require WASM assets, Rust-to-WASM compilation, or Coralite asset array configuration changes.
2. **Straightforward Implementation Scope:** C-AUTH-2 can be implemented as a single, clean client task installing `@noble/curves` and implementing:
   - Client OPRF module (`src/lib/oprf.js` or equivalent).
   - API client wrapper for `/api/v1/oprf/blind` and related auth endpoints.
   - Session memory token store (caching `username_token` in memory without disk persistence).
   - Unit and component tests in `tests/unit/oprf.test.js` / `tests/component/auth-gate.spec.js`.
3. **Task Ledger Update:** C-AUTH-2 remains a single task; no splitting into sub-tasks (C-AUTH-2a / C-AUTH-2b) or WASM build pre-requisite is necessary.
