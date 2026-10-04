# Client Task Ledger

Status: Active — source of truth for client implementation progress.

This file is the client team's tracking document. It is separate from
`task-ledger.md`, which belongs to the server team. Do not cross-reference
or modify the server's ledger.

**Specification:** https://raw.githubusercontent.com/tjdav/playground/refs/heads/bench-workspace-relay-11510657464757500912/client-spec.md
**Coralite reference:** https://coralite.dev/llms.txt

## Summary

| Status | Count |
|---|---|
| Pending | 3 |
| Done | 22 |
| Blocked | 0 |

## Client Tasks

| Task | Deliverable | Status | Depends On | Batch |
|---|---|---|---|---|
| C-V-A | Verify repo state and toolchain | done | — | — |
| C-V-B | Verify Client Testing Stack and Coralite Test Tooling | done | C-INFRA-2 | — |
| C-V-C | Verify Client-Side OPRF Library Availability | done | C-AUTH-1 | — |
| C-V-D | Verify Client OPAQUE Library Availability and Wire Compatibility | done | C-AUTH-2, C-V-C | — |
| C-V-E | Verify Coralite rc.5 Plugin Context Delivery and c-token Reactivity | done | C-INFRA-6 | — |
| C-INFRA-0 | Establish client tracking files | done | C-INFRA-0 | — |
| C-CORALITE-FEEDBACK | Establish Coralite Upstream Feedback Policy | done | C-INFRA-0 | — |
| C-INFRA-1 | Monorepo setup | done | C-INFRA-0 | — |
| C-INFRA-2 | Coralite & Plugin Configuration | done | C-INFRA-1 | — |
| C-INFRA-2b | Unblock Coralite Build Pipeline | done | C-INFRA-2 | — |
| C-INFRA-3 | Establish Client Test Infrastructure and Batch Model | done | C-INFRA-1 | unit-smoke |
| C-INFRA-4 | Playwright Browser Testing Setup | done | C-INFRA-2, C-INFRA-3 | component-smoke |
| C-INFRA-5 | Design System Tokens & Base CSS | done | C-INFRA-1 | component-smoke |
| C-INFRA-5b | Bundle Global CSS with postcss-import | done | C-INFRA-5, C-INFRA-3, C-INFRA-4 | unit-smoke, component-smoke |
| C-INFRA-6a | Create i18n Plugin and Locale Infrastructure | done | C-V-E | unit-smoke |
| C-INFRA-6b | Migrate Component Translations to i18n Plugin | done | C-INFRA-6a | component-i18n |
| C-INFRA-6c | Fix Component Hydration by Wrapping in defineComponent | done | C-V-F, C-INFRA-6b | unit-smoke, component-smoke |
| C-AUTH-1 | Auth Gate Shell & Routing | done | C-INFRA-2, C-INFRA-5 | component-smoke |
| C-AUTH-2 | OPRF Blinding Client & API Client | done | C-INFRA-2, C-V-C | unit-smoke |
| C-AUTH-3a | OPAQUE Login Flow and Session Storage | done | C-AUTH-1, C-AUTH-2, C-V-D | unit-smoke, component-smoke |
| C-AUTH-3b | OPAQUE Registration Flow & Display Name Encryption | done | C-AUTH-3a, C-INFRA-4 | unit-smoke |
| C-AUTH-3b2 | Register Form Wiring & ALTCHA Integration | pending | C-AUTH-3b, C-AUTH-1 | component-smoke |
| C-AUTH-3b3 | Recovery Code Display & Confirmation Screen | pending | C-AUTH-3b2 | component-smoke |
| C-AUTH-4 | Session Persistence & Boot Sequence | done | C-AUTH-3a, C-INFRA-3 | unit-smoke, component-auth |
| C-AUTH-5 | Account Recovery Flow and Session Revocation | done | C-AUTH-3a | — |
| C-CHAT-1 | Messenger Shell & Three-Panel Layout | pending | C-INFRA-2, C-INFRA-5 | — |
| C-CHAT-2 | Extension SDK (@atoll/extend) Core Implementation | pending | C-INFRA-1 | — |
| C-CHAT-3 | Extension System Validation & Vocabulary Command | pending | C-CHAT-2 | — |
| C-CHAT-4 | First-Party Core Extensions Skeleton | pending | C-CHAT-2, C-CHAT-3 | — |
| C-CHAT-5 | Conversation List & Room Creation UI | pending | C-CHAT-1, C-CHAT-4, C-INFRA-3 | — |

## Blockers

None — all client tasks are unblocked.

## Coralite Feedback Policy

**Applies to:** Every client task, forever. Baked into the client task template and the client task ledger.

**Rule:**

When any client task encounters friction with Coralite, the implementer MUST classify it and act according to the tier. Silent workarounds are prohibited.

### Friction Tiers

| Tier | Condition | Action |
|---|---|---|
| **T1 — Bug** | Coralite behaves incorrectly: violates its own docs, produces wrong output, crashes on valid input. | File a bug report upstream. If the bug blocks the task, pause the task and mark it `blocked-upstream`. |
| **T2 — Missing feature, has clean alternative** | Coralite does not support a pattern, but a different pattern achieves the same result without hacks. | Restructure the task to use the supported pattern. Record the friction in the feedback file. Do not work around. |
| **T3 — Missing feature, no clean alternative** | Coralite does not support a pattern, and no supported pattern achieves the result. | File a feature request upstream. If the task can proceed with a documented, isolated, clearly-marked temporary shim, do so with a `TODO(coralite): <feedback-id>` comment and a ledger entry. If not, pause the task and mark it `blocked-upstream`. |
| **T4 — Enhancement / optimization** | Coralite works, but a pattern would benefit it broadly. Not blocking. | File a feature request upstream. Record in the feedback file. Proceed with the current task. |

### Escalation Channels

- **Bugs and feature requests:** File at the Coralite repository's issue tracker (`https://codeberg.org/tjdavid/coralite/issues`).
- **Alternative:** If the issue tracker is unavailable, record the proposal in `client-coralite-feedback.md` with enough detail that it can be filed later.

### What Workaround Means

A workaround is any of:

- Reimplementing a Coralite primitive inside application code.
- Reaching past Coralite's API into its internals (importing from `coralite/src/…`, patching prototypes, mutating its internal state).
- Using a third-party library to duplicate a Coralite feature.
- Writing non-idiomatic component code (e.g., vanilla custom elements, inline handlers) to escape a Coralite constraint.

None of these are acceptable without a T3-tier entry. The default is to restructure, file, or pause.

### Pointer to Feedback File

All entries are recorded in `client-coralite-feedback.md` at the repo root.

### Client Task Template Standard Sections

````markdown
### N. Coralite Friction

If during this task you encounter friction with Coralite — a bug, a missing
feature, a pattern the framework does not support — stop and classify it
against the tiers in `client-coralite-feedback.md`. Do not work around it
silently.

- **T1 (bug):** File a bug report upstream. If it blocks this task, mark
  the task `blocked-upstream` and stop.
- **T2 (missing feature, clean alternative):** Restructure the task. Add a
  `client-coralite-feedback.md` entry.
- **T3 (missing feature, no clean alternative):** File a feature request
  upstream. If a documented, isolated, clearly-marked temporary shim allows
  the task to proceed, do so with a `TODO(coralite): CF-NNN` comment and a
  ledger entry. Otherwise mark the task `blocked-upstream` and stop.
- **T4 (enhancement):** File a feature request upstream. Add an entry.
  Proceed.

Every entry gets an ID (`CF-NNN`, sequential). Record it in the task's
report and in `client-coralite-feedback.md`.

### N+1. Tracking File Updates

On completion:

1. Update `client-task-ledger.md`:
   - Change this task's status from `pending` to `done`, or to
     `blocked-upstream` if T1/T3 pause it.
   - Record the deliverables produced.
   - Record any Coralite feedback IDs raised.
   - Update the Summary table counts.

2. Update `client-verification.md` if this task produced a fact future
   client tasks must rely on.

3. Update `client-coralite-feedback.md` if any friction was encountered.

4. Do not modify `task-ledger.md` or `verification.md`.
````

## Plugin Documentation Policy

Every future plugin task creates `packages/app/docs/plugins/<plugin>.md` in the same commit that lands the plugin and adds a row to `packages/app/docs/plugins/README.md`.

## Coralite Feedback IDs

| ID | Task | Type | Tier | Status |
|---|---|---|---|---|
| CF-001 | C-INFRA-2 | Bug (missing `src/components` directory causes `CoraliteError` crash) | T1 | filed-upstream; client-mitigated-by-input |
| CF-002 | C-INFRA-2 | Bug (missing `public` directory causes `ENOENT` `copyDirectory` crash) | T1 | filed-upstream; client-mitigated-by-input |
| CF-003 | C-AUTH-1 | Missing feature (`coralite-scripts test` dev server omits client JS script bundle links) | T2 | filed-upstream; client-mitigated-by-architecture |
| CF-004 | C-INFRA-5b | Enhancement (dev/prod CSS `@import` resolution divergence in default build pipeline) | T4 | filed-upstream; client-mitigated-by-configuration |
| CF-005 | C-V-E | Documentation bug (Getters context definition in LLM ref §6.4 vs runtime) | T4 | filed-upstream; client-mitigated-by-architecture |
| CF-006 | C-INFRA-6b | Bug / Framework constraint (SSR in-place AST token mutation prevents multi-render token substitution) | T1/T2 | filed-upstream; client-mitigated-by-architecture |

## Notes

- **C-INFRA-0 Deliverables:**
  - Created `client-task-ledger.md` (repo root) with task status tracking and Wave 0/1 task breakdown.
  - Created `client-verification.md` (repo root) with verified C-V-A facts and specification links.
  - Created `client-verification/cv-a/report.md` with C-V-A verification report.
- **C-CORALITE-FEEDBACK Deliverables:**
  - Created `client-coralite-feedback.md` at repo root tracking Coralite upstream friction.
  - Added `Coralite Feedback Policy` and `Coralite Feedback IDs` registry table to `client-task-ledger.md`.
  - Recorded verified Coralite issue tracker URL in `client-verification.md`.
- **C-INFRA-1 Deliverables:**
  - Created `pnpm-workspace.yaml` declaring `packages/*`.
  - Created root `package.json` with workspace metadata, scripts, packageManager, and Node.js engine requirement (`>=22.22.2`).
  - Created root `.nvmrc` containing `22.22.2`.
  - Created `packages/app/package.json` for `@atoll/app`.
  - Created `packages/extend/package.json` for `@atoll/extend`.
  - Extended root `.gitignore` with client Node.js, build output, and log ignore rules.
- **C-INFRA-2 Deliverables & Status:**
  - Status: `done` (unblocked by C-INFRA-2b input directory mitigation).
  - Raised Node.js floor to `>=24.0.0` across root, `@atoll/app`, and `@atoll/extend` `package.json` files and updated `.nvmrc` to `24`.
  - Installed `coralite@1.0.0-rc.5` and `coralite-scripts@1.0.0-rc.5` under Node `v24.21.0` and generated `pnpm-lock.yaml`.
  - Created `packages/app/coralite.config.js`, `src/pages/index.html`, `src/pages/app.html`, `src/styles/main.css`, `src/styles/tokens.css`, `src/styles/utilities.css`, and `packages/app/.gitignore`.
- **C-INFRA-2b Deliverables:**
  - Created placeholder directories `packages/app/src/components/.gitkeep` and `packages/app/public/.gitkeep`.
  - Unblocked Coralite build step: `pnpm --filter @atoll/app build` executed successfully producing `packages/app/dist/index.html` and `packages/app/dist/app.html`.
  - Annotated CF-001 and CF-002 entries as `filed-upstream; client-mitigated-by-input`.
  - Updated C-INFRA-2 status from `blocked-upstream` to `done`.
- **C-INFRA-3 Deliverables & Status:**
  - Status: `done`.
  - Created `packages/app/tests/unit/smoke.test.js` (smoke tests asserting pinned dependencies and node engine floor).
  - Created `packages/app/test-batches.js` (batch manifest exporting `unit-smoke` batch).
  - Created `packages/app/scripts/check-batches.js` (manifest validator for orphans, phantoms, duplicates).
  - Created `packages/app/scripts/run-batch.js` (batch runner dispatching `unit` to `node --test`).
  - Created `packages/app/TESTING.md` (contributor guide for test batch architecture).
  - Updated `packages/app/package.json` with `test:batch` and `check-batches` scripts.
- **C-V-B Deliverables & Status:**
  - Status: `done`.
  - Produced verification report at `client-verification/cv-b/report.md`.
  - Verified `coralite-scripts test` serves testing-mode HTTP server without executing tests or accepting file filters.
  - Determined two-runner architecture: Node.js built-in runner (`node --test`) for unit tests and Playwright (`@playwright/test`) + `@axe-core/playwright` for component/E2E tests.
- **C-INFRA-4 Deliverables & Status:**
  - Status: `done`.
  - Installed `@playwright/test` (`1.63.0`) and `@axe-core/playwright` (`4.10.1`) as devDependencies in `packages/app/package.json`.
  - Downloaded Playwright Chromium browser binaries (`v1243`).
  - Observed `coralite-scripts test` port behavior: default port `3000` (portfinder fallback).
  - Created `packages/app/playwright.config.js` with `webServer` launching `coralite-scripts test`.
  - Extended `packages/app/test-batches.js` with `runner` field across batches and added `component-smoke` batch.
  - Extended `packages/app/scripts/run-batch.js` to dispatch `playwright` runner with 60s timeout handling.
  - Extended `packages/app/scripts/check-batches.js` to validate `runner` fields and check `tests/component/` and `tests/e2e/` for orphans.
  - Created `packages/app/tests/component/smoke.spec.js` asserting placeholder headings on `/app.html` (`Messenger Shell`) and `/index.html` (`Auth Gate`).
  - Updated `packages/app/TESTING.md` with Playwright workflow documentation.
- **C-INFRA-5 Deliverables & Status:**
  - Status: `done`.
  - Populated `packages/app/src/styles/tokens.css` with primitives (cool neutrals, warm neutrals, Lagoon Blue/Dark Aquamarine accent `--accent-500: #2FB6AA` / `--accent-700: #297370`, Coral Reef `--accent-warm-500: #EC7562`, destructive, status), non-color scales (spacing `--space-0`..`--space-24`, font families, font sizes `--text-xs`..`--text-3xl`, weights, line-heights, radii `--radius-sm`..`--radius-full`, shadows, motion, z-index ladder, layout metrics, safe areas), semantic tokens (`:root`), and dark-mode remap (`[data-theme="dark"]`).
  - Extended `packages/app/src/styles/main.css` with `@layer base` containing `box-sizing` reset, `html` (`100dvh`, font family, line height, primary text, surface-0 background), `body` / `#app` height, and `prefers-reduced-motion` override.
  - Created `packages/app/tests/component/tokens.spec.js` asserting light mode token resolution, dark-mode remap behavior, non-color scales, and reduced motion override.
  - Registered `tests/component/tokens.spec.js` in `packages/app/test-batches.js` under `component-smoke` batch.
- **C-AUTH-1 Deliverables & Status:**
  - Status: `done`.
  - Created `packages/app/src/components/containers/auth-gate.html` (root shell managing view state `'login' | 'register' | 'recovery'`).
  - Created `packages/app/src/components/containers/auth-view-login.html` (login form with `active` attribute, `biometricHidden` getter, and event emitters for `auth:login:submit`, `auth:view-change`, and `auth:biometric:request`).
  - Created `packages/app/src/components/containers/auth-view-register.html` (register form with invite code, ALTCHA placeholder, username, display name, password, and event emitters for `auth:register:submit` and `auth:view-change`).
  - Created `packages/app/src/components/containers/auth-view-recovery.html` (recovery form with username, recovery code, new password, and event emitters for `auth:recovery:submit` and `auth:view-change`).
  - Updated `packages/app/src/pages/index.html` to render `<auth-gate></auth-gate>`.
  - Created `packages/app/tests/component/auth-gate.spec.js` and updated `packages/app/tests/component/smoke.spec.js`.
  - Registered `tests/component/auth-gate.spec.js` in `packages/app/test-batches.js` under `component-smoke` batch.
  - Recorded CF-003 in `client-coralite-feedback.md` and `client-task-ledger.md`.
- **C-V-C Deliverables & Status:**
  - Status: `done`.
  - Produced verification report at `client-verification/cv-c/report.md`.
  - Conducted differential execution test between `@noble/curves@2.4.0` (`ristretto255_oprf.oprf`) and `voprf 0.5.0` (Rust crate), establishing 100% byte-exact parity on RFC 9497 §2.2 finalize hash output and 86-character base64url username token generation.
  - Recommended Strategy 1 (Pure-JS via `@noble/curves@^2.4.0`). Confirmed no WASM pipeline or WASM build steps are required.
  - Updated C-AUTH-2 dependencies to include C-V-C and noted that C-AUTH-2 scope is confirmed as a single pure-JS task.
- **C-AUTH-2 Deliverables & Status:**
  - Status: `done`.
  - Installed `@noble/curves` (`2.4.0`) and `@noble/hashes` (`1.8.0`) under `dependencies` in `packages/app/package.json`.
  - Created `packages/app/src/lib/oprf/index.js` exporting `blind(username)`, `finalize(username, evaluatedBytes, state)`, `deriveDisplayNameKey(token)`, and `deriveDeviceNameKey(token)` with spec section JSDocs.
  - Created `packages/app/src/lib/api/index.js` exporting `createApiClient({ baseUrl, getAuthToken, fetchImpl })` and `ApiError`.
  - Created `packages/app/tests/unit/oprf.test.js` testing blinding output lengths, deterministic finalization, domain separation, UTF-8 handling, and byte-exact C-V-C / RFC 9497 differential vector matching.
  - Created `packages/app/tests/unit/api.test.js` testing GET query params, POST JSON bodies, DELETE, auth header injection, 204 No Content, non-JSON response handling, error normalization, and AbortSignal propagation.
  - Registered test files in `unit-smoke` batch in `packages/app/test-batches.js`.
  - Confirmed `pnpm check-batches`, `pnpm test:batch unit-smoke`, and `pnpm --filter @atoll/app build` pass.
- **C-V-D Deliverables & Status:**
  - Status: `done`.
  - Produced verification report at `client-verification/cv-d/report.md`.
  - Conducted differential execution test between `@serenity-kit/opaque@1.1.0` and `opaque-ke 4.0.1` (Rust crate), establishing 100% byte-exact parity across registration (`RegistrationRequest`, `RegistrationResponse`, `RegistrationUpload`), login (`CredentialRequest`, `CredentialResponse`, `CredentialFinalization`), and 64-byte session key derivation.
  - Recommended Strategy 2 (`@serenity-kit/opaque@1.1.0`). Confirmed C-AUTH-3 is unblocked as a single pure JS task requiring zero custom WASM build steps or pipeline plugins.
- **C-AUTH-3a Deliverables & Status:**
  - Status: `done`.
  - Installed `@serenity-kit/opaque` (`1.1.0`) under `dependencies` in `packages/app/package.json`.
  - Created `packages/app/src/lib/codec/index.js` exporting `base64ToBase64url`, `base64urlToBase64`, `bytesToBase64url`, `base64urlToBytes`.
  - Created `packages/app/src/lib/auth/opaque.js` exporting `startLogin({ password })` and `finishLogin({ clientLoginState, loginResponse, password })` with automatic base64url translation for server responses.
  - Created `packages/app/src/lib/auth/session.js` managing session token (`atoll.session.token`), username (`atoll.session.username`), module-scoped ephemeral OPRF token bytes, and fallback for restricted storage environments.
  - Created `packages/app/src/lib/api/client.js` exporting configured `api` singleton.
  - Created `packages/app/src/lib/auth/flows.js` exporting `LoginError`, `createLoginFlow(deps)`, and `loginFlow`.
  - Updated `packages/app/src/components/containers/auth-view-login.html` to run `loginFlow` on submit, set reactive pending/error UI state, and redirect to `/app.html` on success.
  - Created unit tests (`codec.test.js`, `auth-opaque.test.js`, `auth-session.test.js`, `auth-login-flow.test.js`) and component test (`auth-login-flow.spec.js`), registered under `unit-smoke` and `component-smoke` in `test-batches.js`.
  - Verified `pnpm check-batches`, `pnpm test:batch unit-smoke` (33 passing unit tests), and `pnpm --filter @atoll/app build`.
- **C-AUTH-3b Deliverables & Status:**
  - Status: `done`.
  - Added `bytesToBase64` and `base64ToBytes` helper functions to `packages/app/src/lib/codec/index.js`.
  - Created `packages/app/src/lib/crypto/display-name.js` exporting `encryptDisplayName` and `decryptDisplayName` using Web Crypto AES-256-GCM per client spec §6.20.
  - Created `packages/app/src/lib/auth/identity.js` exporting `generateIdentityKeypair`, `getIdentityPublicKey`, `getIdentityPrivateKey`, `setIdentityKeypair`, `clearIdentityKeypair` using Ed25519 (`@noble/curves/ed25519.js`) with Base64URL `localStorage` storage (`atoll.identity.private`, `atoll.identity.public`) and in-memory fallback.
  - Extended `packages/app/src/lib/auth/opaque.js` with `startRegistration({ password })` and `finishRegistration({ clientRegistrationState, registrationResponse, password })`.
  - Extended `packages/app/src/lib/auth/flows.js` exporting `RegisterError`, `createRegisterFlow(deps)`, and `registerFlow` executing OPRF blinding/finalization, display name encryption, OPAQUE registration, Ed25519 keypair generation, without unconfirmed persistence.
  - Created unit test suites (`crypto-display-name.test.js`, `auth-identity.test.js`, `auth-register-flow.test.js` with simulated OPAQUE server) registered in `unit-smoke` in `test-batches.js`.
  - Added C-AUTH-3b2 and C-AUTH-3b3 to task ledger as `pending`.
- **C-INFRA-5b Deliverables & Status:**
  - Status: `done`.
  - Installed `postcss-import` (`^16.1.0` -> `16.1.0`) as devDependency in `packages/app/package.json`.
  - Configured `styles.processors.postcss.plugins: [postcssImport()]` in `packages/app/coralite.config.js`.
  - Created `packages/app/tests/unit/css-bundle.test.js` asserting build output size (> 500B), lack of `@import` statements, and presence of design tokens and layers.
  - Created `packages/app/tests/component/css-applied.spec.js` asserting computed tokens, served CSS content, and capturing visual artifacts (`test-results/css-applied.png` and video).
  - Updated `packages/app/TESTING.md` with CSS Bundle Verification section.
  - Registered test files in `packages/app/test-batches.js` under `unit-smoke` and `component-smoke`.
  - Recorded CF-004 in `client-coralite-feedback.md` and `client-task-ledger.md`.
- **C-V-E Deliverables & Status:**
  - Status: `done`.
  - Produced verification report at `client-verification/cv-e/report.md`.
  - Determined ground truth for Coralite rc.5 plugin context delivery: `client.context` uses two-phase curried resolver `(pluginContext) => (instanceContext) => contextObject`; delivers plugin context strictly to `client()` under `ctx.<pluginName>` (e.g. `ctx.i18n.t(...)`).
  - Proved `getters` receive strictly `{ state, root, refs, slots, signal }` without plugin context.
  - Proved `server()` returns merge into server state and populate `<c-token>` placeholders without `attributes` declarations.
  - Proved `state.x = val` in `client()` triggers reactive updates without `attributes` declarations.
  - Pinpointed C-INFRA-6 symptom root cause: flat destructuring of `t` instead of namespaced `ctx.i18n.t(...)`, which caused unhandled `TypeError: t is not a function` in `client()`.
  - Confirmed C-INFRA-6c scope is determined by C-V-E's findings (components must use namespaced destructuring `ctx.i18n`). Note: C-INFRA-6b is superseded.
  - Recorded CF-005 in `client-coralite-feedback.md` and `client-task-ledger.md`.
- **C-INFRA-6a Deliverables & Status:**
  - Status: `done`.
  - Created `packages/app/src/lib/i18n/index.js` (i18n factory exporting `createI18n`, `SUPPORTED_LOCALES`, and `DEFAULT_LOCALE`).
  - Created seven locale files (`en.js`, `fr.js`, `de.js`, `ja.js`, `pt.js`, `it.js`, `es.js`) in `packages/app/src/lib/i18n/locales/` covering 35 user-facing keys across 6 components with 100% key parity.
  - Created `packages/app/src/lib/i18n/locales/index.js` exporting frozen combined `locales` object.
  - Created `packages/app/src/plugins/i18n-plugin.js` defining the `i18n` Coralite plugin using two-phase resolvers for `server.context` and `client.context`.
  - Updated `packages/app/coralite.config.js` to register `i18nPlugin({ defaultLocale: 'en' })`.
  - Added unit test suites (`i18n.test.js`, `i18n-locales.test.js`, `i18n-plugin.test.js`) registered in `unit-smoke` in `test-batches.js`.
- **C-INFRA-6b Deliverables & Status:**
  - Status: `done`.
  - Extended `createI18n` with `strings(keys)` helper and `i18n-plugin.js` with server/client context exposure and `{ signal }` subscriber cleanup.
  - Re-keyed all 35 translation strings across all 7 locale files to valid identifier underscore keys (`auth_login_title`).
  - Migrated 5 container components (`auth-view-login`, `auth-view-register`, `auth-view-recovery`, `auth-view-confirm`, `messenger-boot`; `auth-gate` confirmed stringless).
  - Created plugin documentation at `packages/app/docs/plugins/README.md` and `packages/app/docs/plugins/i18n.md`.
  - Created Playwright component test `tests/component/i18n-migration.spec.js` registered under `component-i18n` batch in `test-batches.js`.
  - Recorded CF-006 in `client-coralite-feedback.md` and `client-task-ledger.md`.
- **C-INFRA-6c Deliverables & Status:**
  - Status: `done`.
  - Wrapped all 6 container components (`auth-gate`, `auth-view-login`, `auth-view-register`, `auth-view-recovery`, `auth-view-confirm`, `messenger-boot`) with `import { defineComponent } from 'coralite'` and `export default defineComponent({ ... })`.
  - Created repository-wide unit test `packages/app/tests/unit/components-defineComponent.test.js` asserting every component with a script module default export uses `defineComponent`.
  - Created Playwright component hydration test `packages/app/tests/component/hydration.spec.js` verifying DOM hydration, translated text rendering across components, and runtime locale switching.
  - Updated `packages/app/docs/plugins/i18n.md` and `packages/app/docs/plugins/README.md` with top-of-document `defineComponent` prerequisite.
  - Registered `tests/unit/components-defineComponent.test.js` in `unit-smoke` batch and `tests/component/hydration.spec.js` in `component-smoke` batch in `packages/app/test-batches.js`.

## Component Authoring Policy

Every component's `<script type="module">` block MUST `import { defineComponent } from 'coralite'` and `export default defineComponent({ ... })`. Plain object exports are silently ignored by Coralite's compiler. The enforcement test is `packages/app/tests/unit/components-defineComponent.test.js`.
