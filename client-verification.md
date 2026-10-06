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
| Visual verification pattern | `packages/app/tests/component/css-applied.spec.js` asserts computed tokens, served CSS content, and capturing `test-results/css-applied.png` screenshot and video |
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

### C-AUTH-5 — Account Recovery Flow and Session Revocation

- **Recovery Flow Wire Contract**:
  - `POST /auth/recover/start` body: `{ recovery_code, username_token }`, response: `{ recovery_session, registration_response }`.
  - `POST /auth/recover/finish` body: `{ username_token, recovery_session, opaque_record, encrypted_display, identity_pubkey }`, response: `{ session_token, user_id }`.
- **Error Codes (`RecoverError`)**: `recovery_invalid`, `rate_limited`, `recovery_expired`, `opaque_failed`, `display_name_invalid`, `network`, `unknown`.
- **Display Name Form Field**: User re-enters display name on recovery form. Display name is encrypted with OPRF-derived key before initial start request.
- **Identity Keypair**: Regenerates Ed25519 identity keypair during recovery flow.
- **Revocation Handler Contract**: `RevocationHandler({ session, navigate })` exposes `handle(eventType, payload)`. Triggers `clearSession()` and redirects to `/index.html` on `session.revoked`, `account.disabled`, and `account.deleted` events.
- **Limitation**: `RecoverError.message` strings are English-only. Translation at component layer deferred to a future task.

### C-CHAT-1 — Messenger Shell & Three-Panel Layout Architecture

**Verified:** 2026-10-04

| Fact / Mechanism | Signature & Contract / Behavior |
|---|---|
| Component Files Created | `packages/app/src/components/shell/messenger-shell.html`, `rail-host.html`, `surface-host.html` wrapped in `defineComponent` |
| Desktop Layout (≥1024px) | Renders 64px rail (`<rail-host>`), list panel (`320–400px`), and detail panel (`1fr`) side-by-side without bottom nav bar (`.shell__bottom-nav`) |
| Tablet Layout (768–1023px) | Hides rail, renders list panel and detail panel side-by-side, and displays bottom nav bar at base |
| Mobile Layout (<768px) | Renders detail panel and bottom nav bar only (`.surface__list` and `.shell__rail` hidden) |
| Viewport Height & Safe Areas | Height `100dvh`; safe area insets applied as padding on `.shell` (`--safe-top`, `--safe-right`, `--safe-bottom`, `--safe-left`) |
| Visibility Gate & Boot Coordination | `<messenger-shell>` hides until `app:ready` event sets `state.ready = true`; `<messenger-boot>` applies `:host([ready="true"]) { display: none !important; }` |
| Page Integration | `packages/app/src/pages/app.html` renders `<messenger-boot></messenger-boot>` and `<messenger-shell></messenger-shell>` as siblings |
| Accessibility Landmarks | `<rail-host aria-label="{{ railLabel }}">`, `<section class="surface__list" aria-label="{{ listLabel }}">`, `<main class="surface__detail" aria-label="{{ detailLabel }}">`, `<nav class="shell__bottom-nav" aria-label="{{ bottomNavLabel }}">` |
| Extended Locales | `app.shell.rail_label`, `app.shell.bottom_nav_label`, `app.shell.list_label`, `app.shell.detail_label` extended across all 7 locale files with 100% key parity |
| Documentation Path | `packages/app/docs/shell.md` covering layout breakpoints, component structure, extension integration points, gating, safe areas, and landmarks |
| Tests & Screenshots | Unit test `tests/unit/shell.test.js` (unit-smoke) and Playwright component test `tests/component/shell.spec.js` (component-smoke); screenshots captured at `packages/app/test-results/shell-desktop.png`, `shell-tablet.png`, and `shell-mobile.png` |

### C-CHAT-2 — Extension SDK Package (`@atoll/extend`), Registry & Plugin Core

**Verified:** 2026-10-05

| Fact / Symbol | Value / Signature & Behavior |
|---|---|
| Workspace Package | `@atoll/extend` (`packages/extend/package.json`) |
| `exports` Map | `"." -> "./src/index.js"`, `"./plugin" -> "./src/plugin.js"` |
| `defineExtension(ext)` Return Shape | Returns normalized extension object with defaults applied and `_sdkApiVersion: '1.0.0'` attached |
| Extension Defaults | `permissions: []`, `rail: null`, `list: null`, `slots: []`, `emits: []`, `publicEvents: []`, `listens: []`, `sessions: []`, `preferences: []`, `locales: null`, `assets: []`, `onRegister: null`, `onActivate: null`, `onDeactivate: null`, `detail.surfaces: ['panel']`, `detail.defaultSurface: 'panel'`, `detail.back: 'auto'`, `detail.actions: []`, `detail.slots: {}`, `detail.scope: {}`, `detail.settings: null` |
| Validation Rule (`validateExtensionShape`) | Enforces required fields (`id`, `apiVersion`, `hostApi`, `detail`, `detail.route`, `detail.component`, `detail.title`), `rail.label` requirement, `core.` reserved prefix guard, array types, and lifecycle function types |
| `ExtensionRegistry` API | `add(ext)`, `get(id)`, `has(id)`, `list()` (frozen array), `byRailOrder()` (frozen array sorted by `rail.order` ASC), `ownerOfRoute(route)`, `size()` |
| `createCtx({ extension, services, invocation })` | Returns fresh `ctx` object with `id`, `surface`, `scope`, `selection`, `position`, `platform`, `capabilities`, `state`, wrapped `storage`/`preferences` objects, and function accessors (`navigate`, `back`, `present`, `dismiss`, `toast`, `notify`, `openExternal`, `asset`, `hasPermission`, `fetch`, `fetchUserUrl`, `t`) that throw descriptive missing-plugin errors when unsupplied |
| Coralite Plugin Factory | Default export from `@atoll/extend/plugin` returning plugin named `'extensions'` with two-phase `server.context` and `client.context` exposing `{ registry, get, list, byRailOrder, ownerOfRoute, size }` namespaced under `ctx.extensions` |
| Config Ordering | `extensionPlugin({ extensions: [] })` registered FIRST in `packages/app/coralite.config.js` `plugins` array before `i18nPlugin` |
| Component Location Convention | Extension components live under `src/components/` (e.g. `src/components/extensions/<slug>/`) discovered via Coralite's `components` glob |
| Spec Ambiguity Resolution (§26.2 vs §4.4) | `defineExtension(ext)` returns a normalized extension object (not a Coralite plugin); `extensionPlugin` is the Coralite plugin exported from `@atoll/extend/plugin` |
| Unit Tests & Documentation | Unit tests in `extend-define-extension.test.js`, `extend-registry.test.js`, `extend-ctx.test.js`, `extend-plugin.test.js` (registered in `unit-smoke`); documentation in `packages/app/docs/plugins/extensions.md` and `README.md` |

### C-CHAT-3 — Deep Extension Validation, Phase 2 Link Validation & Vocabulary CLI

**Verified:** 2026-10-05

| Fact / Symbol | Value / Signature & Behavior |
|---|---|
| SDK Constants Export (`constants.js`) | Exports `EXTENSION_API_VERSION`, `RESERVED_ROUTES` (`['index', '404']`), `RESERVED_PREFERENCE_KEYS` (`['room_order']`), `RESERVED_PREFERENCE_PREFIXES` (`['_system:']`), `RESERVED_SLOTS` (`[]`), `PERMISSIONS` (`['network', 'storage']`), `PLATFORMS` (`['mobile', 'tablet', 'desktop']`), `SURFACES` (`['panel', 'overlay']`), and regex patterns (`PREFERENCE_KEY_PATTERN`, `EVENT_NAME_PATTERN`, `ROUTE_PATTERN`, `ID_PATTERN`, `API_VERSION_PATTERN`, `COMPONENT_TAG_PATTERN`, `SCHEMA_TYPE_PATTERN`) |
| Phase 1 Deep Shape Validation (`validate.js`) | Checks detailed shapes for `permissions`, `slots`, `emits`, `publicEvents`, `listens`, `sessions`, `preferences`, `assets`, `locales`, component tag naming (`x-<slug>-` prefix for third-party extensions), reserved routes, and reserved slots. Error messages formatted as `<context>: <reason>. <suggestion>` |
| Phase 2 Cross-Extension Link Validation (`validate-link.js`) | `validateLink(registry)` verifies cross-extension constraints: duplicate detail/list routes, route collisions, unresolved slot mounts, non-multiple slot overfill (`multiple: false`), unmatched event listeners, event schema agreement, duplicate session types, reserved preference key declarations, circular slot mounts, and warnings for rail order collisions, duplicate action icons, and scope key type inconsistencies |
| Vocabulary Aggregation (`vocab.js`) | `buildVocabulary(registry, options)` aggregates `components` (scanned recursively from `options.componentsDir` for `<template id="...">`), `slots`, `events`, `routes`, `sessions`, `preferences`, `permissions`, `icons`, `platforms`, `surfaces`, and `reserved` names |
| Plugin Eager Validation (`plugin.js`) | `extensionPlugin({ extensions })` runs Phase 1 and Phase 2 validation eagerly during factory call and shares single registry instance across server and client context resolvers |
| Aggregator Location | `packages/app/src/extensions/index.js` exporting `extensions = []` |
| Config Integration | `packages/app/coralite.config.js` imports `extensions` from `./src/extensions/index.js` |
| CLI Script & Package Script | `packages/app/scripts/extensions-vocab.js` exposing testable `main(argv, io)`; registered as `"extensions:vocab": "node scripts/extensions-vocab.js"` in `packages/app/package.json` |
| Unit Tests | `extend-validate.test.js`, `extend-validate-link.test.js`, `extend-vocab.test.js`, `extend-vocab-cli.test.js` registered under `unit-smoke` in `packages/app/test-batches.js` |
| Documentation | Updated `packages/app/docs/plugins/extensions.md` with Build-Time Validation and The Vocabulary Command sections |

### C-CHAT-4 — First-Party Core Extension Definitions & Shared Placeholder Component

**Verified:** 2026-10-05

| Fact / Symbol | Value / Signature & Behavior |
|---|---|
| Shared Placeholder Component | `packages/app/src/components/containers/extension-placeholder.html` wrapped in `defineComponent` with template, styles, getters (`heading`, `body`), and four-part i18n translation pattern (`ext.placeholder.heading`, `ext.placeholder.body`) |
| Ten Core Extensions | Defined under `packages/app/src/extensions/<name>/index.js`: `core.chat`, `core.media`, `core.documents`, `core.links`, `core.calls`, `core.settings`, `core.hangouts`, `core.profile`, `core.join`, `core.admin` |
| Rail-bearing Extensions & Orders | `core.chat` (10), `core.media` (20), `core.documents` (30), `core.links` (40), `core.calls` (50), `core.settings` (90) |
| Detail Routes (10) | `chat`, `media-viewer`, `document`, `link`, `call`, `settings-section`, `session`, `profile`, `join`, `admin-section` |
| List Routes (8) | `chats`, `media`, `documents`, `links`, `calls`, `settings`, `sessions`, `admin` |
| Voice Session Type | `core.hangouts` defines `sessions: [{ type: 'voice', maxParticipants: 12, maxPerRoom: 3, heartbeatInterval: 15, metadata: {...}, signaling: {...} }]` |
| Single Detail Route Limitation | SDK `detail` object shape is singular; `room-settings` (overlay for `core.chat`) is deferred to `core.chat`'s real-implementation task |
| Aggregator Export | `packages/app/src/extensions/index.js` exports `extensions = [chat, media, documents, links, calls, settings, hangouts, profile, join, admin]` |
| Vocabulary Output | `pnpm extensions:vocab` lists 10 components, 18 routes (10 details, 8 lists), and 1 session type (`voice`) |
| Unit Tests | `packages/app/tests/unit/extend-first-party.test.js` registered under `unit-smoke` batch in `packages/app/test-batches.js` (207/207 passing unit tests) |

### C-CHAT-5 — Router Plugin & Rail Rendering

**Verified:** 2026-10-05

| Fact / Symbol | Value / Signature & Behavior |
|---|---|
| Router Factory (`packages/app/src/lib/router/index.js`) | Exports pure `createRouter({ win, initialUrl })` factory. Methods: `getActiveRail()`, `getActiveDetail()`, `getSelection()`, `getParams()`, `navigate(params)`, `back()`, `subscribe(cb)`, `dispose()` |
| URL Query Format | Manages in-page URL state via query parameters: `rail` (active extension rail ID), `detail` (active detail route), `id` (active selection ID), and secondary parameters (e.g. `messageId`) |
| Router Plugin (`packages/app/src/plugins/router-plugin.js`) | Coralite plugin delivering `ctx.router` context surface. Server context provides safe no-ops. Client context creates singleton `createRouter({ win: window })` in Phase 1 and returns pure accessors in Phase 2 |
| Plugin Order (`coralite.config.js`) | Registered in order: `extensionPlugin({ extensions })`, `routerPlugin()`, `i18nPlugin({ defaultLocale: 'en' })` |
| Rail Component (`rail-host.html`) | Wrapped in `defineComponent`. Four-part i18n component pattern (`app_rail_aria_label`). Client block populates items dynamically from `extensions.byRailOrder()`. Applies `aria-current="page"` to active rail matching `router.getActiveRail()`. Navigation click handlers call `router.navigate({ rail: ext.id })`. Subscribes to `router.subscribe` with per-render `AbortController` cleanup |
| Rail Mobile/Tablet Visibility | Hidden on mobile (<768px) and tablet (768-1023px) viewports; visible only on desktop (>=1024px) |
| Locale Parity | Translation key `app_rail_aria_label` added across all seven locale files (`en`, `fr`, `de`, `ja`, `pt`, `it`, `es`) with 100% key parity across 45 keys |
| Test Suites & Batches | Unit test `packages/app/tests/unit/router.test.js` registered in `unit-smoke` (219 passing unit tests). Component test `packages/app/tests/component/rail.spec.js` registered in `component-smoke` (24 passing Playwright tests) |
| Documentation | Plugin guide created at `packages/app/docs/plugins/router.md` and registered in `packages/app/docs/plugins/README.md` |

### C-CHAT-6 — Surface Host Rendering Contract & Pass-Through Getter Rule

**Verified:** 2026-10-05

| Fact / Mechanism | Signature & Behavior |
|---|---|
| Surface Component (`surface-host.html`) | Wrapped in `defineComponent`. Four-part i18n pattern (`app_shell_list_label`, `app_shell_detail_label`). Reads `ctx.extensions` and `ctx.router`. Reconciles list panel (`.surface__list`) and detail panel (`.surface__detail`) on mount and route changes |
| Extension Resolution | List component resolved from active rail extension (`extensions.get(railId)` or fallback `extensions.byRailOrder()[0]`); detail component resolved from route owner (`extensions.ownerOfRoute(detailRoute)`) |
| DOM Tag Reconciliation (`reconcile`) | Replaces mounted DOM child element only when component tag changes. Navigating between routes sharing the same tag (e.g. `extension-placeholder`) retains existing child DOM node without remounting |
| Initial Canonicalization | On initial render without `rail` query parameter, executes `router.navigate({ rail: fallback.id }, { replace: true })` using `replaceState` to align URL with active surface without polluting back history |
| Router Extension | `createRouter` `navigate(params, options)` extended to support `options.replace` (bool) calling `history.replaceState` |
| Rail Fallback Alignment | `rail-host.html` updated with `getEffectiveRailId()` matching `surface-host` fallback to highlight first rail item when URL lacks `rail` parameter |
| Pass-Through Getter Rule | Getters must derive/compute state (conditionals, comparisons, coercions, composition, or `root`/`refs`/`slots` access). Bare alias getters `({ state }) => state.x` are prohibited; templates bind state keys `{{ x }}` directly |
| Component Audit | All components audited. `railLabel` removed from `rail-host.html`. Remaining getters across all components confirmed to compute derived values |
| Documentation Updates | `packages/app/docs/plugins/i18n.md` ("When to use a getter" section) and `packages/app/docs/shell.md` updated |
| Test Suites & Screenshots | Unit test `tests/unit/surface-reconcile.test.js` (unit-smoke) and Playwright component test `tests/component/surface.spec.js` (component-smoke). Visual verification screenshots generated at `test-results/surface-chat.png` and `test-results/surface-detail.png` |

### C-CHAT-7 — Icon Plugin, `<ui-icon>` Primitive & Rail Icon Rendering

**Verified:** 2026-10-05

| Fact / Mechanism | Signature & Behavior |
|---|---|
| Canonical Icons (`CANONICAL_ICONS`) | `['chat-round-line', 'gallery', 'document-text', 'link', 'phone', 'settings']` exported from `packages/app/src/lib/icons/index.js` |
| Solar Icon Map (`SOLAR_MAP`) | Maps canonical names to `@solar-icons/static` linear modules in `packages/app/src/lib/icons/solar-map.js`, normalizing default/named/string exports into SVG markup strings |
| Icon Functions | `getIconModule(name)` (returns raw SVG string or throws for unknown names), `listIcons()` (returns frozen array), `isIconName(name)` (returns boolean) |
| Icon Plugin (`iconPlugin`) | Defined in `packages/app/src/plugins/icon-plugin.js` with `name: 'icons'`. Registered in `coralite.config.js` between `extensionPlugin` and `routerPlugin`. Exposes `ctx.icons` (`get`, `list`, `has`) across server and client contexts |
| Primitive Component (`<ui-icon>`) | Defined in `packages/app/src/components/primitives/ui-icon.html` wrapped in `defineComponent`. Accepts attributes `name`, `size` ('sm' -> 16px, 'md' -> 20px, 'lg' -> 24px, or CSS length), `color`, `label`. Client block uses `observe('name')` to dynamically update inner wrapper with trusted SVG markup |
| Rail Host Integration (`rail-host.html`) | Instantiates `<ui-icon>` custom elements with `ext.rail.icon.name` for each item. Letter placeholders (`.rail__placeholder`) and unused `item*` attributes removed |
| Plugin Documentation | Created at `packages/app/docs/plugins/icons.md` and registered in `packages/app/docs/plugins/README.md` |
| Test Suites & Batches | Unit test `packages/app/tests/unit/icons.test.js` registered in `unit-smoke` (222 passing unit tests). Component test `packages/app/tests/component/ui-icon.spec.js` registered in `component-smoke` (33 passing Playwright tests) |

### C-INFRA-8 — Storage Plugin, In-Memory Backend & Migration Runner Contracts

**Verified:** 2026-10-05

| Fact / Mechanism | Signature & Contract / Behavior |
|---|---|
| Storage Plugin (`storagePlugin`) | Defined in `packages/app/src/plugins/storage-plugin.js` with `name: 'storage'`. Registered in `coralite.config.js` between icon plugin and router plugin |
| Direct-Key Context Surface | Plugin name `storage` **is** the namespace. Resolver returns keys directly on `ctx.storage` (`open`, `close`, `query`, `queryOne`, `execute`, `transaction`, `meta`). Zero inner wrapper keys (`ctx.storage.storage.open` prohibited) |
| Client Context Singleton | `pluginContext.__storage_client__` caches `createDb({ dbName, migrations })` across component instances |
| Server Context Behavior | `open`, `query`, `queryOne`, `execute`, `transaction` throw Error ("The database is client-only"); `close` and `meta` are safe no-ops |
| Backend Abstraction (`backends/`) | `resolveBackend({ prefer } = {})` in `backends/index.js` returns backend instance. Today supported backends array is `['memory']` (`createMemoryBackend()`) |
| Memory Backend Engine (`backends/memory.js`) | Supports `CREATE TABLE IF NOT EXISTS`, `INSERT` / `INSERT OR REPLACE`, `SELECT ... [WHERE ...] [ORDER BY ...]`, `UPDATE`, `DELETE`, `begin` (snapshot), `commit` (discard snapshot), `rollback` (restore snapshot) |
| Migration Runner (`migrations.js`) | `runMigrations({ backend, migrations })` bootstraps `_migrations` idempotently, compares applied names, executes unapplied `.sql` statements inside transaction blocks, inserts name into `_migrations`, and returns `{ applied, skipped }` |
| Statement Splitter (`splitStatements`) | Character-scanning scanner splitting on `;` while tracking single quotes `'...'`, double quotes `"..."`, and `--` line comments |
| First Migration (`0001-meta.sql`) | Defines `_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)` and `_meta (key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at INTEGER NOT NULL)` |
| DB Factory (`lib/db/index.js`) | `createDb({ dbName = 'messenger', backend, migrations = [] })` returning `{ open, close, query, queryOne, execute, transaction, meta }`. Handles single-flight concurrent `open()` initialization |
| Meta Subsystem | `meta.get(key)`, `meta.set(key, value)`, `meta.delete(key)` storing JSON-serialized string values in `_meta` table |
| Documentation & Tests | Documentation at `packages/app/docs/plugins/storage.md` and `docs/plugins/README.md`; unit tests in `tests/unit/db.test.js` (27 cases) and `tests/unit/storage-plugin.test.js` (8 cases) registered in `unit-smoke` batch |

### C-INFRA-9 — WASM SQLite Backend Implementation and Async DB Factory

**Verified:** 2026-10-05

| Fact / Mechanism | Signature & Contract / Behavior |
|---|---|
| Installed Library | `@sqlite.org/sqlite-wasm@3.53.4-build2` pinned under `dependencies` in `packages/app/package.json` |
| Registered Assets | `coralite.config.js` copies `dist/sqlite3.wasm` -> `assets/sqlite/sqlite3.wasm` (~848 KiB) and `dist/sqlite3-opfs-async-proxy.js` -> `assets/sqlite/sqlite3-opfs-async-proxy.js` (~32 KiB) |
| WASM Backend (`backends/wasm.js`) | Implements `createWasmBackend({ dbName = 'messenger' })`. Attempts OPFS persistence (`new sqlite3.oo1.OpfsDb('/' + dbName + '.sqlite3')`); falls back gracefully to in-memory SQLite (`new sqlite3.oo1.DB(':memory:', 'c')`) with `isPersistent() === false` when OPFS is unsupported or unavailable |
| Async Storage Contract | Every method on `backends/memory.js`, `backends/wasm.js`, `lib/db/migrations.js`, `lib/db/index.js` (`createDb`), and `plugins/storage-plugin.js` returns a `Promise`. Callers must `await` all storage methods |
| Environment Backend Selection | `resolveBackend({ prefer })` exports `SUPPORTED_BACKENDS = ['wasm', 'memory']`. Selects WASM backend automatically when `window` or `importScripts` is defined, falling back to memory backend in Node |
| Test Coverage & Batches | Unit test `packages/app/tests/unit/wasm-backend.test.js` (7 test cases covering WASM initialization, in-memory fallback, `exec`/`all`/`one`, transactions, migrations, and meta helpers) registered under `unit-smoke` batch in `test-batches.js`. Updated `db.test.js` (27 cases) and `storage-plugin.test.js` (8 cases) |
| Playwright Real-Browser Probe | Verified WASM backend opening, migration execution, read/write SQL, and reload persistence in Playwright Chromium browser via temporary `cv-wasm-probe` component. Screenshot captured at `test-results/wasm-probe.png`. Temporary fixture cleanly reverted |
| Documentation Path | Updated `packages/app/docs/plugins/storage.md` detailing WASM backend, OPFS fallback, and async storage contract |

### C-INFRA-10 — Storage Boot Integration

**Verified:** 2026-10-06

| Fact / Mechanism | Signature & Contract / Behavior |
|---|---|
| Extended Shell State | `DEFAULT_SHELL_STATE` in `packages/app/src/lib/state/index.js` includes `storageReady: false` and `storagePersistent: true` |
| Memory Backend `isPersistent()` | Method added to `packages/app/src/lib/db/backends/memory.js` returning `async () => false` |
| Boot Storage Initialization | `messenger-boot` converts `client()` block to straight-line `async` with top-level `await` (no nested IIFE), awaits `storage.open()` post-session validation, and writes `$state.storageReady` / `$state.storagePersistent` |
| Root Ref Diagnostic Attributes | `messenger-boot` sets `data-storage-ready` (`"true"` or `"false"`) and `data-storage-persistent` (`"true"` or `"false"`) on `ref="root"` |
| Non-Blocking Shell Reveal | Shell reveals on `isAuthenticated` write before `storage.open()` completes; storage failure keeps `data-state="ready"` without crashing shell |
| Documentation & Tests | Documentation at `packages/app/docs/plugins/state.md` and `packages/app/docs/plugins/storage.md`; unit tests in `tests/unit/state.test.js` and `tests/unit/db.test.js`; component tests in `tests/component/messenger-boot.spec.js` |

### C-INFRA-11 — Plugin Context Async Import Audit & Standing Policies

**Verified:** 2026-10-06

| Fact / Mechanism | Signature & Contract / Behavior |
|---|---|
| Plugin Audit Scope | All 4 application plugins under `packages/app/src/plugins/`: `i18n-plugin.js`, `icon-plugin.js`, `router-plugin.js`, `storage-plugin.js` |
| Audit Classification | `i18n-plugin.js` (Phase 1 async import `../lib/i18n/index.js`), `icon-plugin.js` (Phase 1 async import `../lib/icons/index.js`), `router-plugin.js` (Phase 1 async import `../lib/router/index.js`), `storage-plugin.js` (converted to Phase 1 async import `../lib/db/index.js`) |
| Async Import Pattern Rule | Static top-level imports in plugin files are not hoisted into the serialized client bundle. Every plugin `client.context` requiring values from another module MUST use Phase 1 async dynamic import (`client: { context: async (pluginContext) => { const { X } = await import('...'); return (_instanceContext) => ({ ... }) } }`) |
| Verification Node Script | Node script verifying zero file-scope imports referenced in `client.context` blocks across `packages/app/src/plugins/*.js` exits cleanly with zero offending references |
| Standing Policy 1 | Plugin `client.context` async imports policy recorded in `client-task-ledger.md` and `packages/app/docs/plugins/README.md` |
| Standing Policy 2 | Playwright test cache discipline (`rm -rf packages/app/.coralite packages/app/dist` and `lsof -t -i :3000 | xargs -r kill`) and seeding pattern (`page.evaluate()` on initial route) recorded in `client-task-ledger.md` and `packages/app/TESTING.md` |
| Task Template Checklist Items | Client task template extended with checklist items for plugin `client.context` async imports and Playwright cache discipline |

### C-INFRA-12 — Users Table and Display Name Repository

**Verified:** 2026-10-06

| Fact / Mechanism | Signature & Contract / Behavior |
|---|---|
| Migration `0002-users.sql` | Defines canonical `users` table (`user_id TEXT PRIMARY KEY`, `display_name TEXT`, `identity_pubkey TEXT`, `profile_version INTEGER NOT NULL DEFAULT 1`, `cached_at INTEGER NOT NULL`) and `idx_users_cached_at` index |
| Users Repository Factory | `createUsersRepository({ db })` in `packages/app/src/lib/db/repositories/users.js` exposing async methods: `get`, `upsert`, `remove`, `list`, `count`, `clearAll` |
| Partial Upsert Semantics | `upsert` uses `INSERT ... ON CONFLICT(user_id) DO UPDATE SET display_name = COALESCE(excluded.display_name, users.display_name), identity_pubkey = COALESCE(excluded.identity_pubkey, users.identity_pubkey), profile_version = excluded.profile_version, cached_at = excluded.cached_at`. Non-provided or explicit `null` fields retain existing values |
| Cursor Pagination | `list({ limit = 100, cursor } = {})` orders by `cached_at DESC` using cursor condition `cached_at < ?` |
| Repository Aggregator | `packages/app/src/lib/db/repositories/index.js` exports `createRepositories({ db })` returning `{ users }` and re-exports `createUsersRepository` |
| Unit Test Suite | `packages/app/tests/unit/repositories-users.test.js` exercising all 15 specified cases across backends, registered under `unit-smoke` batch in `test-batches.js` |
| Storage Documentation | Documentation authored under `packages/app/docs/storage/`: `README.md` (index), `repositories.md` (conventions), and `users.md` (users contract) |

### C-INFRA-13 — Rooms, Room Members, and Room Order Tables with Repositories

**Verified:** 2026-10-06

| Fact / Mechanism | Signature & Contract / Behavior |
|---|---|
| Migration `0003-rooms.sql` | Defines `rooms` (`room_id TEXT PRIMARY KEY`, `name`, `avatar_file_id`, `description`, `disappearing_timer`, `metadata_version INTEGER DEFAULT 1`, `updated_at INTEGER`), `room_members` (`room_id`, `user_id`, `role`, `joined_at`, `PRIMARY KEY (room_id, user_id)`), and `room_order` (`room_id TEXT PRIMARY KEY`, `position INTEGER`, `updated_at INTEGER`) with indexes |
| Rooms Repository | `createRoomsRepository({ db })` in `packages/app/src/lib/db/repositories/rooms.js` (`get`, `upsert` with partial `COALESCE` updates, transactional `remove`, `list` ordered by `updated_at DESC`, `count`, transactional `clearAll`) |
| Room Members Repository | `createRoomMembersRepository({ db })` in `packages/app/src/lib/db/repositories/room-members.js` (`listInRoom` ordered by `joined_at ASC`, `get`, `addMember`, `removeMember`, `removeAllInRoom`, `listRoomsForUser` ordered by `joined_at DESC`, `countInRoom`, `clearAll`) |
| Room Order Repository | `createRoomOrderRepository({ db })` in `packages/app/src/lib/db/repositories/room-order.js` (`list` ordered by `position ASC`, transactional dense `setOrder`, `moveBefore`, `getPosition`, `clearAll`) |
| Transactional Integrity | Foreign keys are omitted for backend engine compatibility. `rooms.remove` and `rooms.clearAll` execute transactional deletes across `rooms`, `room_members`, and `room_order`. `roomOrder.setOrder` replaces order densely inside a transaction |
| Repository Aggregator | `packages/app/src/lib/db/repositories/index.js` extended to expose `{ users, rooms, roomMembers, roomOrder }` and re-export factory functions |
| Unit Test Coverage | `tests/unit/repositories-rooms.test.js` (14 cases), `tests/unit/repositories-room-members.test.js` (12 cases), `tests/unit/repositories-room-order.test.js` (12 cases) registered under `unit-smoke` batch in `test-batches.js` |
| Storage Documentation | `packages/app/docs/storage/rooms.md` authored with purpose, schema, repository signatures, partial updates, referential integrity, eviction, and lifecycle details. `packages/app/docs/storage/README.md` updated |
