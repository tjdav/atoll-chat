# Client Verification Log

Status: Active — canonical verified facts for client implementation.

This file is the client team's verification log. It is separate from
`verification.md`, which belongs to the server team. Do not cross-reference
or modify the server's verification log.

**Specification:** https://raw.githubusercontent.com/tjdav/playground/refs/heads/bench-workspace-relay-11510657464757500912/client-spec.md
**Coralite reference:** https://coralite.dev/llms.txt

## Verified Facts

### C-V-A — Repository State and Client Toolchain

**Verified:** 2026-10-02

| Fact | Value |
|---|---|
| Repository layout | Empty aside from `server/` (Case A) |
| Node.js installed | `v22.22.1` (below spec's `≥ 22.22.2`) |
| pnpm installed | `10.30.3` |
| npm installed | `11.11.0` |
| Coralite latest stable | `0.47.1` |
| Coralite latest pre-release | `1.0.0-rc.5` |
| `coralite-scripts` latest pre-release | `1.0.0-rc.5` |
| Server working tree | Clean, no uncommitted changes |

**Blocker:** Node.js must be upgraded to `≥ 22.22.2` before any client
build task runs.

**Report:** `client-verification/cv-a/report.md`

### C-CORALITE-FEEDBACK — Coralite Issue Tracker URL

**Verified:** 2026-10-02

| Fact | Value |
|---|---|
| Coralite repository | `https://codeberg.org/tjdavid/coralite.git` |
| Coralite issue tracker | `https://codeberg.org/tjdavid/coralite/issues` |
| Coralite homepage | `https://coralite.dev` |

### C-INFRA-2 — Node 24 Enforcement and Build Pipeline Behavior

**Verified:** 2026-10-02

| Fact | Value |
|---|---|
| Active Node.js runtime | `v24.21.0` |
| Workspace Node floor | `>=24.0.0` (root, `@atoll/app`, `@atoll/extend`) |
| `.nvmrc` value | `24` |
| Installed `coralite` version | `1.0.0-rc.5` |
| Installed `coralite-scripts` version | `1.0.0-rc.5` |
| Build status | `done` (unblocked via C-INFRA-2b input directory mitigation) |
| Missing `src/components` behavior | Throws `CoraliteError: Root directory was not found: src/components` (CF-001) |
| Missing `public` directory behavior | Throws `Error: ENOENT: no such file or directory, lstat 'public'` in `copyDirectory` (CF-002) |

### C-INFRA-2b — Unblock Coralite Build Pipeline & Build Output Shape

**Verified:** 2026-10-02

| Fact | Value |
|---|---|
| Required input directories created | `packages/app/src/components/.gitkeep`, `packages/app/public/.gitkeep` |
| Build command | `pnpm --filter @atoll/app build` |
| Build status | Exits with 0 (success) |
| Built output files | `packages/app/dist/index.html` (511B), `packages/app/dist/app.html` (517B), `packages/app/dist/assets/css/main.css` (48B) |
| Injected head script | `<script>(() => { document.documentElement.setAttribute('data-coralite-ready', 'true'); })();</script>` |
| Injected CSP meta tag | `<meta http-equiv="Content-Security-Policy" content="script-src 'self' 'sha256-3SMB9nwEjM7evSTwt0wdVhh2AMYdu33TQRapZUlHl54='">` |
| CSS link resolution | `<link rel="stylesheet" href="/assets/css/main.css">` |

### C-INFRA-3 — Client Test Infrastructure & Batch Model

**Verified:** 2026-10-02

| Fact | Value |
|---|---|
| Unit test runner | Node.js built-in runner (`node --test`) |
| E2E / Component runner | Playwright (`@playwright/test` — to be installed by C-INFRA-4) |
| Batch manifest location & format | `packages/app/test-batches.js` (ES module exporting batch array) |
| `check-batches` invariant | Every `*.test.js` under `packages/app/tests/` must belong to exactly one batch (detects orphans, phantoms, duplicates) |
| Initial test batch | `unit-smoke` containing `tests/unit/smoke.test.js` |

### C-V-B — Client Testing Stack and Coralite Test Tooling

**Verified:** 2026-10-02

| Fact | Value |
|---|---|
| `coralite-scripts test` behavior | Launches testing-mode HTTP server on port 3000; does NOT execute test files or accept file filters |
| Testing mode (`mode: 'testing'`) | Injects velocity CSS, prototype patching, static `data-testid` retention, and testing symbol |
| Invocation granularity | Process-level server; batch filtering maps to runner level (`node --test <files>` or `playwright test <files>`) |
| Viable test runners | Node.js built-in runner (`node --test`) for unit tests; Playwright + `@axe-core/playwright` for component/E2E tests |
| Batch model alignment | JS batch manifest (`test-batches.js`) grouping specs into runner batches executed via `pnpm test:batch <batch>` |
| Report location | `client-verification/cv-b/report.md` |

### C-INFRA-4 — Playwright WebServer Launch & Component Batch Verification

**Verified:** 2026-10-02

| Fact | Value |
|---|---|
| `@playwright/test` installed version | `1.63.0` (pinned spec range `^1.61.0`) |
| `@axe-core/playwright` installed version | `4.10.1` (pinned spec range `^4.10.0`) |
| Playwright Chromium browser | Installed (`v1243`, Chrome Headless Shell 153.0.8010.12) |
| `coralite-scripts test` port behavior | Listens on port `3000` (configurable via `coralite.config.js` or `PORT`, portfinder fallback) |
| `webServer` integration | Playwright automatically starts `coralite-scripts test` on port 3000 and serves `/app.html` and `/index.html` |
| `component-smoke` batch result | Passed (2 passed, 12.2s execution time, well under 60-second budget) |
| `unit-smoke` batch result | Passed (3 passed, 0.09s execution time) |
| `check-batches` validation | OK — 2 test files across 2 batches |

### C-INFRA-5 — Design System Tokens Vocabulary & Base CSS Layer

**Verified:** 2026-10-02

| Fact | Value |
|---|---|
| CSS Layer Structure | `tokens.css` structured in `@layer tokens` (Primitives -> Non-color scales -> Semantic `:root` -> Dark-mode remap `[data-theme="dark"]`); `main.css` extended with `@layer base` |
| Primitives Ramps | Cool neutral (`--neutral-0`..`--neutral-950`), warm neutral (`--neutral-warm-50`, `--neutral-warm-200`), accent (`--accent-500: #2FB6AA` / `--accent-700: #297370`), warm accent (`--accent-warm-500: #EC7562`), destructive (`--destructive-500`, `--destructive-700`), status (`--success-500`, `--warning-500`, `--info-500`) |
| Non-color Scales | Spacing (`--space-0`..`--space-24`), typography (`--font-sans`, `--font-mono`, `--text-xs`..`--text-3xl`, `--weight-*`, `--leading-*`), radii (`--radius-sm`..`--radius-full`), shadows (`--shadow-sm`..`--shadow-xl`), motion (`--duration-*`, `--ease-*`), z-index ladder (`--z-base`..`--z-toast`), layout metrics (`--rail-width: 64px`, `--list-panel-min: 320px`, `--list-panel-max: 400px`, `--bubble-max-width: min(75%, 600px)`, `--mobile-nav-height: 56px`), safe areas (`env()`) |
| Semantic Vocabulary | Surfaces (`--surface-0`..`--surface-3`), text (`--text-primary`, `--text-muted`, `--text-inverse`), borders/dividers (`--border-subtle`, `--border-default`, `--divider`), bubbles (`--bubble-incoming`, `--bubble-outgoing`, `--bubble-outgoing-text`), accent (`--accent-fill`, `--accent-text`, `--accent-warm`), status (`--status-success`..`--status-error`) |
| Dark-mode Remap Mechanism | Selector `[data-theme="dark"]` overriding primitive `--accent-500: #4DD0C4` and remapping surface, text, border, bubble, and accent semantic tokens |
| Base CSS Layer | `@layer base` reset setting `*, *::before, *::after { box-sizing: border-box; }`, `html { height: 100dvh; font-family: var(--font-sans); ... }`, `body`, `#app`, and `@media (prefers-reduced-motion: reduce)` animation/transition override |
| Playwright Test Verification | `tests/component/tokens.spec.js` added and registered under `component-smoke` batch in `test-batches.js` |

### C-AUTH-1 — Auth Gate Event Contract & Custom Element Components

**Verified:** 2026-10-02

| Event / Mechanism | Payload / Behavior |
|---|---|
| `auth:view-change` | `{ view: 'login' \| 'register' \| 'recovery' }` emitted by links in sub-views; handled by `<auth-gate>` to update `state.view` |
| `auth:login:submit` | `{ username: string, password: string }` emitted on `auth-view-login` form submit |
| `auth:register:submit` | `{ inviteCode: string, username: string, displayName: string, password: string }` emitted on `auth-view-register` form submit |
| `auth:recovery:submit` | `{ username: string, recoveryCode: string, newPassword: string }` emitted on `auth-view-recovery` form submit |
| `auth:biometric:request` | Emitted when Face ID / biometric button is clicked on login view |
| Shell custom elements | `<auth-gate>`, `<auth-view-login>`, `<auth-view-register>`, `<auth-view-recovery>` defined in `src/components/containers/` |
| View switching mechanism | `active` attribute on sub-views with custom element getter `style: { display: (state) => (state.active ? 'block' : 'none') }` |

### C-V-C — Client-Side OPRF Library Availability & Wire-Format Compatibility

**Verified:** 2026-10-02

| Fact | Value |
|---|---|
| Recommended OPRF Library | `@noble/curves` (`^2.4.0`) |
| Recommended Hash Utility | `@noble/hashes` (`^1.7.0`) |
| Module Export | `@noble/curves/ed25519.js` (`ristretto255_oprf.oprf`) |
| OPRF Mode | Base mode (non-verifiable OPRF per RFC 9497) |
| Protocol Suite | `ristretto255-SHA512` |
| `voprf 0.5.0` Differential Test Parity | **100% Byte-Exact Match** |
| Wire Format (`blinded` / `evaluated`) | 32-byte compressed Ristretto255 point encoded as standard Base64 string |
| Wire Format (`username_token`) | 64-byte SHA-512 digest encoded as 86-character unpadded Base64url string |
| Pure-JS / Browser Native | Yes (0 external dependencies, tree-shakes to ~15 KiB, runs natively in browser/Node 24) |
| WASM Requirement | None |
| Report Location | `client-verification/cv-c/report.md` |

### C-AUTH-2 — OPRF Client Library & API Fetch Wrapper Contracts

**Verified:** 2026-10-02

| Symbol / Function | Signature & Return Type | Spec Reference & Behavior |
|---|---|---|
| `@noble/curves` installed | `2.4.0` | Runtime dependency in `packages/app/package.json` |
| `@noble/hashes` installed | `1.8.0` | Runtime dependency in `packages/app/package.json` |
| `blind(username)` | `async (username: string) => Promise<{ blindedBytes: Uint8Array, state: { blind: Uint8Array, usernameBytes: Uint8Array } }>` | Client spec §6.19 & RFC 9497. Returns 32-byte `blindedBytes` compressed Ristretto255 point and state object holding private scalar `blind`. |
| `finalize(username, evaluatedBytes, state)` | `async (username: string \| Uint8Array, evaluatedBytes: Uint8Array, state: { blind: Uint8Array }) => Promise<Uint8Array>` | Client spec §6.19 & RFC 9497 §2.2. Returns 64-byte finalized username token digest. Verified byte-exact against Rust `voprf 0.5.0` reference vector. |
| `deriveDisplayNameKey(token)` | `async (token: Uint8Array) => Promise<Uint8Array>` | Client spec §6.20 & §8.3. Computes `HKDF-Expand(token, info="display-name-encryption-v1", length=32)` returning 32-byte AES key. |
| `deriveDeviceNameKey(token)` | `async (token: Uint8Array) => Promise<Uint8Array>` | Client spec §6.21 & §8.3. Computes `HKDF-Expand(token, info="device-name-encryption-v1", length=32)` returning 32-byte AES key. |
| `createApiClient(options)` | `({ baseUrl: string, getAuthToken?: Function, fetchImpl?: typeof fetch }) => { get: Function, post: Function, del: Function }` | Client spec §4.3 & §21. Minimal fetch wrapper returning `{ get(path, { query, headers, signal }), post(path, { body, headers, signal }), del(path, { headers, signal }) }`. |
| `ApiError` | `class ApiError extends Error { status: number, code: string, message: string, details: any }` | Normalized API error thrown on non-2xx HTTP responses. |

### C-V-D — Client OPAQUE Library Availability & Wire Compatibility

**Verified:** 2026-10-02

| Fact | Value |
|---|---|
| Recommended OPAQUE Library | `@serenity-kit/opaque@1.1.0` |
| `opaque-ke 4.0.1` Differential Parity | **100% Byte-Exact Match** across registration, login, and 64-byte session key derivation |
| Cipher Suite | `Ristretto255`, `TripleDh<Ristretto255, Sha512>`, `Argon2` KSF |
| Wire Encoding (Client → Server) | Base64URL string (`URL_SAFE_NO_PAD`) |
| Wire Encoding (Server → Client) | Standard Base64 string (`STANDARD`); client MUST translate to Base64URL before calling `@serenity-kit/opaque` |
| WASM Architecture | Embedded base64 WASM bundle; auto-initialized / synchronous, requiring 0 build pipeline changes |
| Security Review | Audited via 7ASecurity whitebox review & penetration test (OTF Red Team Lab) |
| C-AUTH-3 Unblocked Strategy | Single pure JS application task using `@serenity-kit/opaque@1.1.0` |
| Report Location | `client-verification/cv-d/report.md` |

### C-AUTH-3a — OPAQUE Login Flow API Contract & Session Storage Contracts

**Verified:** 2026-10-02

| Endpoint / Method | Wire Payload / Key | Encoding & Format |
|---|---|---|
| `POST /api/v1/oprf/blind` | `{ "blinded": "<base64>" }` -> `{ "evaluated": "<base64>" }` | Standard Base64 32-byte compressed Ristretto255 point |
| `POST /api/v1/auth/login/start` | `{ "username_token": "<tokenStr>", "opaque_client_auth_state": "<startLoginRequest>" }` -> `{ "credential_response": "<base64>" }` | `username_token`: 86-char unpadded Base64URL; `opaque_client_auth_state`: Base64URL; `credential_response`: Standard Base64 |
| `POST /api/v1/auth/login/finish` | `{ "username_token": "<tokenStr>", "ke3": "<finishLoginRequest>" }` -> `{ "session_token": "<string>" }` | `ke3`: Base64URL; `session_token`: Bearer token string |
| Session Token Key | `atoll.session.token` | `localStorage` persistent storage string |
| Username Key | `atoll.session.username` | `localStorage` persistent storage string |
| OPRF Token Key | Module-scoped variable | Ephemeral `Uint8Array` in JS memory, never persisted |

### C-AUTH-3b — OPAQUE Registration Flow & Display Name Encryption Contracts

**Verified:** 2026-10-03

| Endpoint / Method / Key | Request Payload / Storage Key | Response Payload / Encoding & Format |
|---|---|---|
| `POST /api/v1/oprf/blind` | `{ "blinded": "<base64>" }` | `{ "evaluated": "<base64>" }` (Standard Base64 32-byte Ristretto255 points) |
| `POST /api/v1/auth/register/start` (Inferred) | `{ "username_token": "<b64url>", "opaque_client_registration_state": "<b64url>", "altcha": "<string>" }` | `{ "registration_response": "<base64>" }` |
| `POST /api/v1/auth/register/finish` | `{ "username_token": "<b64url>", "encrypted_display": "<b64url>", "opaque_record": "<b64url>", "identity_pubkey": "<b64url>" }` | `{ "session_token": "<string>", "user_id": "<string>", "recovery_codes": ["<string>", ...] }` |
| Display Name Encryption Format | `nonce (12 bytes) || ciphertext || tag (16 bytes)` | AES-256-GCM via Web Crypto (`encryptDisplayName`), max 256 UTF-8 bytes plaintext |
| Identity Public Key | `atoll.identity.public` | Ed25519 32-byte public key encoded as Base64URL string in `localStorage` |
| Identity Private Key | `atoll.identity.private` | Ed25519 32-byte private key encoded as Base64URL string in `localStorage` |
| Codec Helpers | `bytesToBase64(bytes)`, `base64ToBytes(s)` | Standard Base64 conversion helpers added to `packages/app/src/lib/codec/index.js` |
| Deferred Persistence Constraint | `registerFlow` does NOT persist credentials | Returns uncommitted session token, userId, recovery codes, identity keys, OPRF token, and username; caller persists after recovery code confirmation |

### C-INFRA-5b — Global CSS Bundling & Visual Verification Pattern

**Verified:** 2026-10-03

| Fact | Value |
|---|---|
| `postcss-import` installed version | `16.1.0` (`devDependencies` in `@atoll/app`) |
| Config location | `styles.processors.postcss.plugins: [postcssImport()]` in `packages/app/coralite.config.js` |
| Default build behavior | `coralite-scripts build` preserves native `@import` statements verbatim unless `postcss-import` is explicitly configured |
| Output bundle verification | `packages/app/tests/unit/css-bundle.test.js` runs production build and asserts file size >500B, absence of `@import` statements, and presence of design tokens and layers |
| Visual verification pattern | `packages/app/tests/component/css-applied.spec.js` asserts computed tokens, served CSS content, and captures `test-results/css-applied.png` screenshot and video |
| Recorded Coralite feedback | CF-004 (Tier 4 enhancement for dev/prod CSS `@import` resolution divergence) |

### C-AUTH-4 — Session Boot Sequence & Gate Contract on `app.html`

**Verified:** 2026-10-03

| Fact / Symbol | Value / Signature & Contract |
|---|---|
| Module location | `packages/app/src/lib/auth/boot.js` |
| Boot function factory | `createBootFlow(deps)` returning `async function bootFlow()` |
| Default export | `bootFlow = createBootFlow()` |
| Error class | `export class BootError extends Error { constructor(code, message) }` |
| Return shape | `{ redirected: boolean, reason?: string, hasOprfToken?: boolean, user?: Object \| null }` |
| Redirect reasons | `'no_session'`, `'no_username'`, `'session_expired'` (401), `'account_disabled'` (403) |
| Offline / Network failure handling | Network failure on `GET /users/me` continues without redirect with `user = null` |
| OPRF failure handling | OPRF re-derivation failure continues without redirect with `hasOprfToken = false` |
| Token re-derivation lifecycle | OPRF token is re-derived on every page boot load (module-scoped memory handle, not persisted) |
| Component tag | `<messenger-boot>` in `packages/app/src/components/containers/messenger-boot.html` |
| Page integration | `packages/app/src/pages/app.html` renders `<messenger-boot></messenger-boot>` |
| Test IDs & states | `data-testid="boot"` on inner container; `data-state` values: `'booting'`, `'ready'`, `'error'` |
| Event contract | Emits `app:ready` (`{ hasOprfToken, user }`) on success; `app:error` (`{ message }`) on unexpected error |
| Visual & test verification | Captured screenshot `packages/app/test-results/messenger-boot.png` and test execution video |

### C-V-E — Coralite rc.5 Plugin Context Delivery & c-token Reactivity

**Verified:** 2026-10-03

| Fact | Value |
|---|---|
| `client.context` runtime shape | Two-phase curried function `(pluginContext) => (instanceContext) => contextObject` |
| Context delivery targets | `client()` ONLY; `getters` receive `{ state, root, refs, slots, signal }`; `server()` receives server context |
| Plugin context namespacing | Namespaced under `ctx.<pluginName>` (e.g., `ctx.i18n.t(...)`) |
| Flat destructuring behavior | `client(({ state, t }) => ...)` fails with `TypeError: t is not a function` because `t` is `undefined` |
| `server()` `<c-token>` binding | `server()` return values merge into server state; populates `{{ key }}` tokens during SSR without `attributes` declaration |
| `client()` reactivity mechanism | `state.x = val` in `client()` marks key dirty and schedules DOM update without `attributes` declaration |
| C-INFRA-6 symptom root cause | Flat destructuring of `t` instead of namespaced `ctx.i18n.t(...)`, causing unhandled `TypeError` in `client()` |
| Report location | `client-verification/cv-e/report.md` |

### C-INFRA-6a — i18n Plugin & Locale Infrastructure Contracts

**Verified:** 2026-10-03

| Fact / Mechanism | Signature & Contract / Behavior |
|---|---|
| Factory module location | `packages/app/src/lib/i18n/index.js` |
| Factory export | `createI18n({ defaultLocale = 'en', locales = {}, initialLocale })` |
| Returned engine interface | `{ t(key, vars?), getLocale(), setLocale(locale), subscribe(cb), availableLocales() }` |
| Locale Storage Key | `atoll.preference.locale` (in `localStorage`) |
| Supported Locales | `['en', 'fr', 'de', 'ja', 'pt', 'it', 'es']` (`SUPPORTED_LOCALES`) |
| Default Locale | `'en'` (`DEFAULT_LOCALE`) |
| Fallback Chain | `active locale` → `default locale` → `verbatim key string` |
| Key set coverage | 35 user-facing string keys defined across all seven locale files (`en.js` through `es.js`) |
| Plugin definition location | `packages/app/src/plugins/i18n-plugin.js` |
| Plugin name | `i18n` |
| Required access pattern | `ctx.i18n.t(key, vars)` in `client()` and `server()`; NOT available in `getters` |
| `coralite.config.js` registration | Configured under `plugins: [ i18nPlugin({ defaultLocale: 'en' }) ]` |

### C-INFRA-6b — i18n Component Migration & Plugin Documentation Contracts

**Verified:** 2026-10-04

| Fact / Mechanism | Signature & Contract / Behavior |
|---|---|
| Factory Helper | `strings(keys: string[])` added to `createI18n` returning key-value object map (throwing TypeError if not an array) |
| Extended Plugin Surface | `server.context` returns `t`, `getLocale`, `strings`; `client.context` returns `t`, `getLocale`, `setLocale`, `strings`, `subscribeLocale(cb, { signal })` |
| Underscore Key Convention (CF-006) | All 35 translation keys across all 7 locale files (`en`, `fr`, `de`, `ja`, `pt`, `it`, `es`) use valid JS identifier underscore format (e.g. `auth_login_title`) |
| Migrated Components | `auth-view-login.html`, `auth-view-register.html`, `auth-view-recovery.html`, `auth-view-confirm.html`, `messenger-boot.html` (`auth-gate.html` confirmed stringless) |
| Component Four-Part Pattern | 1. Underscore key format; 2. `server({ i18n })` seeds state; 3. Getters read state identifiers; 4. `client({ state, i18n, signal })` subscribes with `{ signal }`; 5. Template binds getter identifiers |
| Plugin Documentation | `packages/app/docs/plugins/README.md` and `packages/app/docs/plugins/i18n.md` created covering overview, contract, component pattern, failure modes, known costs, and workflows |
| Test Coverage & Batches | Unit tests in `tests/unit/i18n.test.js` and `tests/unit/i18n-plugin.test.js`; Playwright test suite `tests/component/i18n-migration.spec.js` registered under `component-i18n` batch in `test-batches.js` |
| Verification Commands | `pnpm check-batches`, `pnpm test:batch unit-smoke`, `pnpm test:batch component-i18n`, `pnpm --filter @atoll/app build` exit zero |

### C-INFRA-6c — Component Hydration, `defineComponent` Prerequisite & Style Delivery

**Verified:** 2026-10-04

| Fact / Mechanism | Signature & Contract / Behavior |
|---|---|
| Component Wrapper Requirement | Every component's `<script type="module">` block MUST `import { defineComponent } from 'coralite'` and `export default defineComponent({ ... })` |
| Compiler Failure Mode without Wrapper | Without `defineComponent`, Coralite's build-time AST compiler silently drops `client()` from client bundles and omits the runtime loader script (`coralite-runtime`); build succeeds silently but hydration never runs |
| Enforcement Test Path | `packages/app/tests/unit/components-defineComponent.test.js` (unit test walking all HTML components) |
| Hydration Marker | `data-coralite-ready` attribute on `<html>` indicates client hydration completion |
| Scoped CSS Delivery Path | Component `<style>` blocks are emitted into `<head>` under `<style id="coralite-inline-styles">` using `@layer components` and `@scope` rules, NOT into `dist/assets/css/main.css` |
| Component Hydration Tests | `packages/app/tests/component/hydration.spec.js` asserting login, register, confirm, recovery, boot views, and runtime locale switching to French |
| Screenshots Produced | `packages/app/test-results/hydration-login.png` and `packages/app/test-results/hydration-fr.png` |

## Task C-AUTH-5 — Account Recovery Flow and Session Revocation

- **Recovery Flow Wire Contract**:
  - `POST /auth/recover/start` body: `{ recovery_code, username_token }`, response: `{ recovery_session, registration_response }`.
  - `POST /auth/recover/finish` body: `{ username_token, recovery_session, opaque_record, encrypted_display, identity_pubkey }`, response: `{ session_token, user_id }`.
- **Error Codes (`RecoverError`)**: `recovery_invalid`, `rate_limited`, `recovery_expired`, `opaque_failed`, `display_name_invalid`, `network`, `unknown`.
- **Display Name Form Field**: User re-enters display name on recovery form. Display name is encrypted with OPRF-derived key before initial start request.
- **Identity Keypair**: Regenerates Ed25519 identity keypair during recovery flow.
- **Revocation Handler Contract**: `RevocationHandler({ session, navigate })` exposes `handle(eventType, payload)`. Triggers `clearSession()` and redirects to `/index.html` on `session.revoked`, `account.disabled`, and `account.deleted` events.
- **Limitation**: `RecoverError.message` strings are English-only. Translation at component layer deferred to a future task.
