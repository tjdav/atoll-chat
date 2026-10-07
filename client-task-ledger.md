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
| Pending | 0 |
| Done | 48 |
| Blocked | 0 |

## Client Tasks

| Task | Deliverable | Status | Depends On | Batch |
|---|---|---|---|---|
| C-V-A | Verify repo state and toolchain | done | — | — |
| C-INFRA-24 | Fix Migration Delivery via `client.config` and Document Plugin Config Pattern | done | C-V-H, C-INFRA-20, C-INFRA-8 | unit-smoke, component-smoke |
| C-INFRA-23 | Component Data-Attribute Audit and Component Authoring Guide | done | C-CHAT-6, C-INFRA-6b, C-INFRA-6c, C-V-E, C-V-F | unit-smoke |
| C-INFRA-22 | User-Scoped Sync Plugin | done | C-INFRA-21, C-INFRA-20, C-INFRA-19, C-INFRA-16, C-INFRA-10, C-INFRA-11 | unit-smoke, component-auth |
| C-INFRA-21 | Repository Accessor in the Storage Plugin Context | done | C-INFRA-20, C-INFRA-11, C-INFRA-9, C-INFRA-10 | unit-smoke |
| C-INFRA-20 | Sync State, Processed Events, and MLS Rooms Tables with Repositories | done | C-INFRA-19, C-INFRA-14, C-INFRA-9 | unit-smoke |
| C-INFRA-19 | Device Names and Starred Items Tables with Repositories | done | C-INFRA-18, C-INFRA-9, C-AUTH-3a, C-V-D | unit-smoke |
| C-INFRA-18 | Room Preferences and Nicknames Tables with Repositories | done | C-INFRA-17, C-INFRA-16, C-INFRA-9 | unit-smoke |
| C-INFRA-17 | Outbox Table and Repository | done | C-INFRA-16, C-INFRA-14, C-INFRA-9 | unit-smoke |
| C-INFRA-16 | User State Tables: Read State, Drafts, Blocked Users | done | C-INFRA-15 | unit-smoke |
| C-INFRA-15 | Attachments and Reactions Tables with Repositories | done | C-INFRA-14 | unit-smoke |
| C-INFRA-14 | Messages and Message Versions Tables with Repository | done | C-INFRA-13 | unit-smoke |
| C-INFRA-13 | Rooms, Room Members, and Room Order Tables with Repositories | done | C-INFRA-12 | unit-smoke |
| C-INFRA-12 | Users Table and Display Name Repository | done | C-INFRA-8, C-INFRA-9, C-INFRA-10 | unit-smoke |
| C-INFRA-11 | Plugin Context Async Import Audit and Policy Update | done | C-INFRA-10 | unit-smoke, component-smoke |
| C-INFRA-10 | Storage Boot Integration | done | C-INFRA-8, C-INFRA-9, C-AUTH-4 | unit-smoke, component-auth |
| C-INFRA-8 | Storage Plugin Skeleton & Migration Runner | done | C-INFRA-7 | unit-smoke |
| C-INFRA-9 | WASM SQLite Backend Implementation and Async DB Factory | done | C-V-G, C-INFRA-8 | unit-smoke |
| C-V-B | Verify Client Testing Stack and Coralite Test Tooling | done | C-INFRA-2 | — |
| C-V-C | Verify Client-Side OPRF Library Availability | done | C-AUTH-1 | — |
| C-V-D | Verify Client OPAQUE Library Availability and Wire Compatibility | done | C-AUTH-2, C-V-C | — |
| C-V-E | Verify Coralite rc.5 Plugin Context Delivery and c-token Reactivity | done | C-INFRA-6 | — |
| C-INFRA-0 | Establish client tracking files | done | C-INFRA-0 | — |
| C-CORALITE-FEEDBACK | Establish Coralite Upstream Feedback Policy | done | C-INFRA-0 | — |
| C-INFRA-1 | Monorepo setup | done | C-INFRA-0 | — |
| C-INFRA-2 | Coralite & Plugin Configuration | done | C-INFRA-2 | — |
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
| C-CHAT-1 | Messenger Shell & Three-Panel Layout | done | C-INFRA-2, C-INFRA-5 | unit-smoke, component-smoke |
| C-CHAT-2 | Extension SDK (@atoll/extend) Core Implementation | done | C-INFRA-1 | unit-smoke |
| C-CHAT-3 | Extension System Validation & Vocabulary Command | done | C-CHAT-2 | unit-smoke |
| C-CHAT-4 | First-Party Core Extensions Skeleton | done | C-CHAT-2, C-CHAT-3 | unit-smoke |
| C-CHAT-5 | Router Plugin & Rail Item Rendering | done | C-CHAT-1, C-CHAT-4, C-INFRA-4 | unit-smoke, component-smoke |
| C-CHAT-6 | Surface Rendering & Pass-Through Getter Cleanup | done | C-CHAT-5, C-CHAT-4, C-CHAT-1, C-INFRA-6c | unit-smoke, component-smoke |
| C-CHAT-7-icon | Icon Plugin and Rail Icon Rendering | done | C-CHAT-5, C-CHAT-4, C-INFRA-6c | unit-smoke, component-smoke |
| C-CHAT-7 | Message Thread Surface | done | C-INFRA-23, C-INFRA-22, C-INFRA-21, C-INFRA-14, C-INFRA-16, C-INFRA-12, C-CHAT-6, C-CHAT-7-icon, C-CHAT-5 | unit-smoke, component-smoke |
| C-CHAT-8 | Composer and Local Send Path | done | C-CHAT-7, C-INFRA-23, C-INFRA-21, C-INFRA-17, C-INFRA-10, C-CHAT-5 | unit-smoke, component-smoke |

## Blockers

None — all client tasks are unblocked.

## Standing Policies

### Plugin `client.context` async imports

Every plugin whose `client.context` needs a value from another module must use a Phase 1 async dynamic import:

```javascript
client: {
  context: async (pluginContext) => {
    const { X } = await import('../lib/x.js')
    return (_instanceContext) => ({ /* keys directly */ })
  }
}
```

Static top-level imports in a plugin file are available in Node but are not reliably hoisted into the serialized client bundle. The build succeeds silently; the browser throws `ReferenceError: X is not defined` at the first component that accesses `ctx.<plugin>.X`.

The context keys are returned directly. The Phase 1 arrow is `async`. The Phase 2 arrow remains synchronous.

### Playwright test cache and seeding

Before running component batches after a plugin or component change:

```bash
rm -rf packages/app/.coralite packages/app/dist
lsof -t -i :3000 | xargs -r kill
```

Coralite caches compiled scripts in `.coralite/manifest.json`. Playwright's `reuseExistingServer: true` will reuse a running dev server and may serve stale bundles. Clearing the cache and terminating any listening process guarantees fresh assets.

Tests that expect storage to be cleared after a redirect must seed state via `page.evaluate()` on an initial route, not via `page.addInitScript()`. Init scripts re-run on every navigation, including the redirect target, and will re-insert the seeded value.

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
### N. Plugin `client.context` async imports

If writing or modifying a Coralite plugin:
- Confirm `client.context` uses a Phase 1 async dynamic import (`async (pluginContext) => { const { X } = await import('...'); return (_instanceContext) => ({ ... }) }`) for any file-scope dynamic values.
- Do not rely on top-level static imports inside `client.context`.

### N+1. Cache discipline

Before running Playwright component batches:
- Clear build cache (`rm -rf packages/app/.coralite packages/app/dist`).
- Terminate stale dev servers (`lsof -t -i :3000 | xargs -r kill`).
- Seed state via `page.evaluate()` on an initial route rather than `page.addInitScript()` if testing state clearing across redirects.

### N+2. Component Authoring

New and modified components must satisfy `packages/app/docs/components.md`.
Key requirements:

- State is the source of truth. No internal `data-*` attributes except `data-testid`.
- CSS state hooks read from the host via `:host([...])` with `reflect: true`.
- `data-testid` is the only sanctioned test hook, and only when no role/name query works.
- The four-part i18n pattern applies to user-facing strings.
- `defineComponent` is required.
- No pass-through getters.
- `client()` may be `async`; no anonymous async IIFE.
- Plugin context is delivered to `server()` and `client()` only — not to getters, `style`, or `slots`.
- Module scope is stripped from the client bundle — no top-level imports or helpers in `client()`.
- No environment guards inside single-environment blocks.

### N+3. Coralite Friction

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

### N+4. Tracking File Updates

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
| CF-007 | C-INFRA-24 | Documentation bug (LLM reference omits `client.config` in plugin example) | T4 | filed-upstream; client-mitigated-by-architecture |

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
  - Determined ground truth for Coralite rc.5 plugin context delivery: `client.context` uses two-phase curried resolver `(pluginContext) => (instanceContext) => contextObject`; delivers plugin context strictly to `client()` under `ctx.<pluginName>` (e.g., `ctx.i18n.t(...)`).
  - Proved `getters` receive strictly `{ state, root, refs, slots, signal }` without plugin context.
  - Proved `server()` returns merge into server state and populate `<c-token>` placeholders during SSR without `attributes` declaration.
  - Proved `state.x = val` in `client()` triggers reactive updates without `attributes` declaration.
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
- **C-CHAT-1 Deliverables & Status:**
  - Status: `done`.
  - Created `packages/app/src/components/shell/messenger-shell.html`, `rail-host.html`, `surface-host.html` wrapped in `defineComponent`.
  - Implemented responsive layout frame: Desktop (≥1024px: 64px rail, list 320–400px, detail 1fr), Tablet (768–1023px: list + detail side-by-side, bottom nav), Mobile (<768px: detail + bottom nav).
  - Updated `packages/app/src/pages/app.html` rendering `messenger-boot` and `messenger-shell` as siblings.
  - Updated `messenger-boot.html` removing `<slot name="shell">` and adding `:host([ready]) { display: none !important; }` override.
  - Extended all seven locale files with 4 accessibility label keys (`app.shell.rail_label`, `app.shell.bottom_nav_label`, `app.shell.list_label`, `app.shell.detail_label`) with 100% key parity.
  - Created documentation at `packages/app/docs/shell.md`.
  - Added unit test `tests/unit/shell.test.js` and component test `tests/component/shell.spec.js` registered in `unit-smoke` and `component-smoke`.
- **C-CHAT-2 Deliverables & Status:**
  - Status: `done`.
  - Updated `packages/extend/package.json` with `exports` map (`.` and `./plugin`) and `coralite` peer dependency.
  - Added `"@atoll/extend": "workspace:*"` to `packages/app/package.json` dependencies and linked workspace package.
  - Implemented `@atoll/extend` SDK core modules in `packages/extend/src/`:
    - `constants.js`: `EXTENSION_API_VERSION = '1.0.0'`.
    - `normalize.js`: `normalizeExtension(ext)` applying spec defaults to extension objects, `detail`, `list`, and `rail` without input mutation.
    - `validate.js`: `validateExtensionShape(ext)` verifying required fields (`id`, `apiVersion`, `hostApi`, `detail`, `detail.route`, `detail.component`, `detail.title`), `rail.label` requirement, `core.` reserved prefix guard, array types, and lifecycle function types.
    - `define-extension.js`: `defineExtension(ext)` validating, normalizing, and attaching `_sdkApiVersion`.
    - `registry.js`: `ExtensionRegistry` class (`add`, `get`, `has`, `list`, `byRailOrder()`, `ownerOfRoute(route)`, `size`).
    - `ctx.js`: `createCtx({ extension, services, invocation })` producing fresh `ctx` object with `id`, `surface`, `scope`, `selection`, `position`, `platform`, `capabilities`, `state`, wrapped `storage`/`preferences` objects, and function accessors (`navigate`, `back`, `present`, `dismiss`, `toast`, `notify`, `openExternal`, `asset`, `hasPermission`, `fetch`, `fetchUserUrl`, `t`) that throw descriptive missing-plugin errors when unsupplied.
    - `plugin.js`: Default export Coralite plugin factory `extensionPlugin({ extensions, services })` returning plugin named `'extensions'` with two-phase `server.context` and `client.context` and `pluginContext` singleton registry caching.
    - `index.js`: Re-exporting public SDK surface.
  - Registered `extensionPlugin({ extensions: [] })` as first item in `packages/app/coralite.config.js` `plugins` array before `i18nPlugin`.
  - Created unit test suites (`extend-define-extension.test.js`, `extend-registry.test.js`, `extend-ctx.test.js`, `extend-plugin.test.js`), registered under `unit-smoke` batch in `packages/app/test-batches.js`.
  - Created documentation at `packages/app/docs/plugins/extensions.md` and `README.md`.
  - Resolved ambiguity between spec §26.2 and §4.4 in favor of config: `defineExtension(ext)` returns a normalized extension object; `extensionPlugin` is the Coralite plugin exported from `@atoll/extend/plugin`.
- **C-CHAT-3 Deliverables & Status:**
  - Status: `done`.
  - Created `packages/extend/src/constants.js` exporting `EXTENSION_API_VERSION`, reserved lists (`RESERVED_ROUTES`, `RESERVED_PREFERENCE_KEYS`, `RESERVED_PREFERENCE_PREFIXES`, `RESERVED_SLOTS`), allowlists (`PERMISSIONS`, `PLATFORMS`, `SURFACES`), and validation regex patterns.
  - Deepened Phase 1 shape validation in `packages/extend/src/validate.js` checking shape, permissions allowlist, slot target strings, component tag naming conventions (`x-<slug>-` prefix for third-party extensions), event names and non-nested schemas, listener handlers, session properties, preference keys/prefixes, and error message formatting (`<context>: <reason>. <suggestion>`).
  - Created `packages/extend/src/validate-link.js` performing Phase 2 cross-extension link validation (duplicate detail/list routes, route collisions, unresolved slot mounts, non-multiple slot overfill, unmatched listeners, event schema agreement, duplicate session types, reserved preference keys, circular slot mounts, and warnings for rail order collisions, duplicate action icons, and scope key type inconsistencies).
  - Created `packages/extend/src/vocab.js` implementing `buildVocabulary(registry, options)` to aggregate components (scanning `src/components/` recursively for template IDs), slots, events, routes, sessions, preferences, permissions, icons, platforms, surfaces, and reserved names.
  - Extended `packages/extend/src/plugin.js` running Phase 1 and Phase 2 validation eagerly during factory call and shared registry instance across contexts.
  - Extended `packages/extend/src/index.js` re-exporting `validateLink`, `buildVocabulary`, and all constants.
  - Created `packages/app/src/extensions/index.js` aggregator exporting `extensions = []`.
  - Updated `packages/app/coralite.config.js` importing `extensions` from `./src/extensions/index.js`.
  - Created `packages/app/scripts/extensions-vocab.js` testable CLI script and added `"extensions:vocab": "node scripts/extensions-vocab.js"` to `packages/app/package.json`.
  - Updated `packages/app/docs/plugins/extensions.md` with Build-Time Validation and The Vocabulary Command sections.
  - Added unit test suites (`extend-validate.test.js`, `extend-validate-link.test.js`, `extend-vocab.test.js`, `extend-vocab-cli.test.js`), registered in `unit-smoke` in `test-batches.js`.
- **C-CHAT-4 Deliverables & Status:**
  - Status: `done`.
  - Created shared placeholder component `packages/app/src/components/containers/extension-placeholder.html` wrapped in `defineComponent` with four-part i18n translation pattern and getters.
  - Created 10 first-party extension definitions under `packages/app/src/extensions/<name>/index.js`:
    - `core.chat` (rail order 10, list: `chats`, detail: `chat`)
    - `core.media` (rail order 20, list: `media`, detail: `media-viewer`)
    - `core.documents` (rail order 30, list: `documents`, detail: `document`)
    - `core.links` (rail order 40, list: `links`, detail: `link`)
    - `core.calls` (rail order 50, list: `calls`, detail: `call`)
    - `core.settings` (rail order 90, list: `settings`, detail: `settings-section`)
    - `core.hangouts` (list: `sessions`, detail: `session`, sessions: `[{ type: 'voice', maxParticipants: 12, maxPerRoom: 3, heartbeatInterval: 15, ... }]`)
    - `core.profile` (detail: `profile`)
    - `core.join` (detail: `join`)
    - `core.admin` (list: `admin`, detail: `admin-section`)
    All referencing `component: 'extension-placeholder'`.
  - Updated `FIRST_PARTY_ALLOWLIST` in `packages/extend/src/validate.js` to allow Phase 1 validation of all 10 core extensions.
  - Populated `packages/app/src/extensions/index.js` importing and exporting all ten extensions.
  - Extended all 7 locale files (`en.js`, `fr.js`, `de.js`, `ja.js`, `pt.js`, `it.js`, `es.js`) with `ext.placeholder.heading` and `ext.placeholder.body` (44 keys total across all locales with 100% key parity).
  - Updated `packages/app/docs/plugins/extensions.md` with "First-party extensions" section and table detailing status and deferred `room-settings` overlay.
  - Added unit test suite `packages/app/tests/unit/extend-first-party.test.js` registered under `unit-smoke` in `packages/app/test-batches.js` (207/207 unit tests passing).
- **C-CHAT-6 Deliverables & Status:**
  - Status: `done`.
  - Rewrote `packages/app/src/components/shell/surface-host.html` using `defineComponent` with router and extension driven list/detail panel resolution, DOM element tag reconciliation algorithm (`reconcile`), initial URL canonicalization (`router.navigate({ rail: fallback.id }, { replace: true })`), and i18n locale subscription.
  - Extended router's `navigate(params, options)` method in `packages/app/src/lib/router/index.js` and `packages/app/src/plugins/router-plugin.js` to support `options.replace` using `history.replaceState`.
  - Audited all existing component files and removed pass-through getters (`railLabel` in `rail-host.html`), updating templates to bind state keys directly. Verified all remaining getters compute derived values.
  - Updated `rail-host.html` with `getEffectiveRailId()` fallback synchronizing the highlighted rail item with fallback surface rendering.
  - Updated documentation at `packages/app/docs/plugins/i18n.md` ("When to use a getter" section) and `packages/app/docs/shell.md` (surface-host resolution, reconciliation, and canonicalization).
  - Added unit test `tests/unit/surface-reconcile.test.js` (registered in `unit-smoke`) and Playwright component test `tests/component/surface.spec.js` (registered in `component-smoke`).
  - Verified test suite (`pnpm check-batches`, `pnpm test:batch unit-smoke`, `pnpm test:batch component-smoke`, `pnpm --filter @atoll/app build`, `pnpm extensions:vocab`). Generated visual verification screenshots `test-results/surface-chat.png` and `test-results/surface-detail.png`.
- **C-CHAT-7-icon Deliverables & Status:**
  - Status: `done`.
  - Installed `@solar-icons/static@2.3.2` runtime dependency in `packages/app/package.json`.
  - Created `packages/app/src/lib/icons/index.js` and `solar-map.js` providing `CANONICAL_ICONS` (`chat-round-line`, `gallery`, `document-text`, `link`, `phone`, `settings`), `getIconModule(name)`, `listIcons()`, and `isIconName(name)`.
  - Implemented `packages/app/src/plugins/icon-plugin.js` registering `icons` plugin in `coralite.config.js` with two-phase resolvers exposing `ctx.icons`.
  - Created `<ui-icon>` primitive component (`packages/app/src/components/primitives/ui-icon.html`) using `defineComponent` and dynamic attribute observation.
  - Updated `<rail-host>` component (`packages/app/src/components/shell/rail-host.html`) replacing first-letter placeholders with `<ui-icon>` elements.
  - Authored documentation at `packages/app/docs/plugins/icons.md` and updated `docs/plugins/README.md`.
  - Added unit test `tests/unit/icons.test.js` (registered in `unit-smoke`) and Playwright component test `tests/component/ui-icon.spec.js` (registered in `component-smoke`). Updated `tests/component/rail.spec.js` and `test-batches.js`.
- **C-CHAT-7 Deliverables & Status:**
  - Status: `done`.
  - Implemented pure assembly module `packages/app/src/lib/views/view-chat-data.js` exporting `safeParsePayload`, `summarizePayload`, `groupMessages`, `insertDateSeparators`, `findNewMessagesDivider`, `formatTime`, and `formatDateLabel`.
  - Created composed component `packages/app/src/components/composed/message-bubble.html` using `defineComponent`, host-reflected boolean state attributes via `toggleAttribute` (`is-own`, `is-tombstone`, `is-pending`, `is-failed`, `is-first-in-group`, `is-last-in-group`), computed getters, and scoped CSS styles.
  - Created composed component `packages/app/src/components/composed/date-separator.html` rendering centered date pill separators.
  - Created detail surface component `packages/app/src/components/views/view-chat.html` using `defineComponent` and four-part i18n pattern, implementing message rendering, auto-scrolling to bottom, floating scroll-to-bottom button, debounced local read state advancement (`repos.readState.upsert`), and `test-storage-seeded` window event listener.
  - Updated `core.chat`'s `detail.component` in `packages/app/src/extensions/chat/index.js` to `'view-chat'`.
  - Extended all seven locale files (`en`, `fr`, `de`, `ja`, `pt`, `it`, `es`) with 13 new `chat_*` translation keys while maintaining 100% key parity (67 keys) and non-English uniqueness.
  - Authored `packages/app/docs/views/chat.md` covering all 10 required contract sections and updated `packages/app/docs/views/README.md`.
  - Created unit test suite `packages/app/tests/unit/view-chat-data.test.js` (29 cases) registered in `unit-smoke` batch and Playwright component test suite `packages/app/tests/component/chat-thread.spec.js` registered in `component-smoke` batch in `packages/app/test-batches.js`.
  - Generated visual verification artifacts `packages/app/test-results/chat-populated.png` and `packages/app/test-results/chat-empty.png`.
- **C-CHAT-8 Deliverables & Status:**
  - Status: `done`.
  - Created `packages/app/src/lib/composer/index.js` exporting `generateLocalMessageId`, `buildTextPayload`, `encodePayload`, `encodeCiphertextStub`, `isDesktopPointer`, `computeNextSeq`.
  - Created `packages/app/src/lib/views/send-message.js` exporting `sendMessage` orchestration function (`buildTextPayload` validation, `_meta.client_id` key creation/reuse, `computeNextSeq` sequence computation, `repos.messages.upsert` local message creation, `repos.outbox.enqueue`, `repos.readState.upsert` read state advance).
  - Created `<message-composer>` component (`packages/app/src/components/composed/message-composer.html`) using `defineComponent` following component authoring guide (host-reflected `hasText` and `disabled` attributes, auto-growing textarea, desktop fine-pointer Enter key handling, disabled stub action buttons, zero internal `data-*` attributes except `data-testid`).
  - Updated `<view-chat>` detail surface component (`packages/app/src/components/views/view-chat.html`) mounting `<message-composer>` in `<footer class="chat__composer">`, updating CSS grid layout (`grid-template-rows: auto 1fr auto`), passed i18n label attributes, and listening to `composer:send` to trigger `sendMessage` and thread reload.
  - Extended all seven locale files (`en`, `fr`, `de`, `ja`, `pt`, `it`, `es`) with six new `composer_*` keys (`composer_placeholder`, `composer_attach_label`, `composer_emoji_label`, `composer_readaloud_label`, `composer_input_label`, `composer_send_label`) maintaining 100% key parity (73 keys).
  - Extended `packages/app/docs/views/chat.md` with Section 9 ("Composer and local send path").
  - Created unit test suites `packages/app/tests/unit/composer.test.js` (18 cases) and `packages/app/tests/unit/send-message.test.js` (14 cases) registered in `unit-smoke` batch in `packages/app/test-batches.js`.
  - Created Playwright component test `packages/app/tests/component/composer.spec.js` registered in `component-smoke` batch in `packages/app/test-batches.js`.
  - Generated visual verification screenshot `packages/app/test-results/composer-pending.png`.

- **C-INFRA-8 Deliverables & Status:**
  - Status: `done`.
  - Created in-memory SQLite abstraction backend `packages/app/src/lib/db/backends/memory.js` supporting `CREATE TABLE IF NOT EXISTS`, `INSERT` / `INSERT OR REPLACE`, `SELECT`, `UPDATE`, `DELETE`, `begin`, `commit`, `rollback`.
  - Created backend resolver `packages/app/src/lib/db/backends/index.js` exporting `resolveBackend` and `SUPPORTED_BACKENDS = ['memory']`.
  - Created SQL statement splitter and migration runner `packages/app/src/lib/db/migrations.js` with string/comment-aware `splitStatements(sql)` and transactional `runMigrations({ backend, migrations })`.
  - Created initial migration `packages/app/src/db/migrations/0001-meta.sql` declaring `_migrations` and `_meta` meta-domain tables.
  - Created DB factory `packages/app/src/lib/db/index.js` exporting `createDb` with single-flight concurrent `open()` initialization, query, queryOne, execute, transaction, and meta helpers (`get`, `set`, `delete`).
  - Implemented Coralite storage plugin `packages/app/src/plugins/storage-plugin.js` with `name: 'storage'`, returning keys directly (`open`, `close`, `query`, `queryOne`, `execute`, `transaction`, `meta`) without an inner wrapper key.
  - Registered `storagePlugin({ dbName: 'messenger', migrations: loadMigrations() })` in `coralite.config.js` between icon plugin and router plugin.
  - Updated `.gitignore` to unignore `!packages/app/src/db/` and `!packages/app/src/lib/db/`.
  - Authored plugin documentation at `packages/app/docs/plugins/storage.md` and updated `packages/app/docs/plugins/README.md`.
  - Added unit test suites `packages/app/tests/unit/db.test.js` (27 cases) and `packages/app/tests/unit/storage-plugin.test.js` (8 cases) registered under `unit-smoke` in `packages/app/test-batches.js`.
- **C-INFRA-9 Deliverables & Status:**
  - Status: `done`.
  - Installed `@sqlite.org/sqlite-wasm@3.53.4-build2` under `dependencies` in `packages/app/package.json`.
  - Registered SQLite assets in `packages/app/coralite.config.js` copying `dist/sqlite3.wasm` -> `assets/sqlite/sqlite3.wasm` (~848 KiB) and `dist/sqlite3-opfs-async-proxy.js` -> `assets/sqlite/sqlite3-opfs-async-proxy.js` (~32 KiB).
  - Transitioned memory backend (`backends/memory.js`), migration runner (`migrations.js`), DB factory (`index.js`), and storage plugin (`storage-plugin.js`) to async method contracts returning Promises.
  - Created `packages/app/src/lib/db/backends/wasm.js` exporting `createWasmBackend` with OPFS (`sqlite3.oo1.OpfsDb`) persistence and in-memory (`sqlite3.oo1.DB`) fallback mode (`isPersistent() === false`).
  - Updated `packages/app/src/lib/db/backends/index.js` exporting `SUPPORTED_BACKENDS = ['wasm', 'memory']` and automatic browser environment selection in `resolveBackend`.
  - Updated existing unit test suites `db.test.js` and `storage-plugin.test.js` to await Promise calls.
  - Created unit test suite `packages/app/tests/unit/wasm-backend.test.js` testing WASM backend, OPFS fallback, transactions, migrations, and meta helpers in Node environment (registered under `unit-smoke` in `test-batches.js`).
  - Verified WASM backend in Playwright real-browser environment via temporary probe fixture and captured `test-results/wasm-probe.png`. Reverted temporary probe component and page mount before completion.
  - Updated documentation at `packages/app/docs/plugins/storage.md`.

- **C-INFRA-10 Deliverables & Status:**
  - Status: `done`.
  - Created global shell state module `packages/app/src/lib/state/index.js` exporting `DEFAULT_SHELL_STATE` (`storageReady: false`, `storagePersistent: true`) and `createStateStore(initialState)`.
  - Added `async isPersistent()` method returning `false` to memory database backend `packages/app/src/lib/db/backends/memory.js`.
  - Updated `packages/app/src/components/containers/messenger-boot.html` converting `client()` block to straight-line `async` with top-level `await` (removing nested async IIFE), opening `storage.open()` post-session validation, updating `$state.storageReady` / `$state.storagePersistent`, and setting root ref diagnostic attributes `data-storage-ready` / `data-storage-persistent`.
  - Created unit test suite `packages/app/tests/unit/state.test.js` and added test case 28 to `packages/app/tests/unit/db.test.js` (registered in `unit-smoke` in `test-batches.js`).
  - Extended component test suite `packages/app/tests/component/messenger-boot.spec.js` covering storage initialization, storage failure handling, non-blocking shell reveal, and screenshot generation `test-results/messenger-boot.png`.
  - Authored documentation at `packages/app/docs/plugins/state.md` and updated `packages/app/docs/plugins/storage.md`.

- **C-INFRA-11 Deliverables & Status:**
  - Status: `done`.
  - Audited all 4 application plugins (`i18n-plugin.js`, `icon-plugin.js`, `router-plugin.js`, `storage-plugin.js`). Classified `i18n`, `icons`, and `router` as already using Phase 1 async dynamic import inside `client.context`. Converted `storage-plugin.js` to Phase 1 async dynamic import pattern (`async (pluginContext) => { const { createDb } = await import('../lib/db/index.js'); ... }`).
  - Updated `packages/app/tests/unit/storage-plugin.test.js` awaiting `plugin.client.context(...)`.
  - Updated plugin documentation files (`packages/app/docs/plugins/README.md`, `i18n.md`, `icons.md`, `router.md`, `storage.md`, `extensions.md`, `state.md`) adding cross-cutting rule and per-plugin import pattern sections.
  - Recorded two new standing policies in `client-task-ledger.md` ("Plugin `client.context` async imports" and "Playwright test cache and seeding") and extended the client task template standard checklist items.
  - Extended `packages/app/TESTING.md` with "Cache discipline" and "Seeding state in Playwright tests" sections.
  - Added comprehensive `C-INFRA-11` entry to `client-verification.md`.

- **C-INFRA-12 Deliverables & Status:**
  - Status: `done`.
  - Created migration `packages/app/src/db/migrations/0002-users.sql` defining `users` table (`user_id TEXT PRIMARY KEY`, `display_name TEXT`, `identity_pubkey TEXT`, `profile_version INTEGER NOT NULL DEFAULT 1`, `cached_at INTEGER NOT NULL`) and `idx_users_cached_at` index.
  - Created users repository `packages/app/src/lib/db/repositories/users.js` exporting `createUsersRepository` with async methods `get`, `upsert` (with partial `COALESCE` update semantics), `remove`, `list` (with `cached_at` cursor pagination), `count`, and `clearAll`.
  - Created repository aggregator `packages/app/src/lib/db/repositories/index.js` exporting `createRepositories({ db })` returning `{ users }` and re-exporting `createUsersRepository`.
  - Created unit test suite `packages/app/tests/unit/repositories-users.test.js` registered under `unit-smoke` in `packages/app/test-batches.js`.
  - Authored documentation under `packages/app/docs/storage/`: `README.md` (index), `repositories.md` (conventions), and `users.md` (users contract).
  - Verified zero string interpolation in repository SQL queries, 100% key parity across all 7 locale files (45 keys), and clean `pnpm check-batches`, `unit-smoke`, `component-smoke`, build, and vocabulary runs.

- **C-INFRA-13 Deliverables & Status:**
  - Status: `done`.
  - Created migration `packages/app/src/db/migrations/0003-rooms.sql` defining `rooms` (`room_id TEXT PRIMARY KEY`, `name`, `avatar_file_id`, `description`, `disappearing_timer`, `metadata_version INTEGER DEFAULT 1`, `updated_at INTEGER`), `room_members` (`room_id`, `user_id`, `role`, `joined_at`), and `room_order` (`room_id TEXT PRIMARY KEY`, `position INTEGER`, `updated_at INTEGER`) tables and their indexes.
  - Created repositories under `packages/app/src/lib/db/repositories/`:
    - `rooms.js` (`get`, `upsert` with COALESCE, transactional `remove`, `list`, `count`, transactional `clearAll`)
    - `room-members.js` (`listInRoom`, `get`, `addMember`, `removeMember`, `removeAllInRoom`, `listRoomsForUser`, `countInRoom`, `clearAll`)
    - `room-order.js` (`list`, transactional dense `setOrder`, `moveBefore`, `getPosition`, `clearAll`)
  - Updated aggregator `packages/app/src/lib/db/repositories/index.js` exposing `rooms`, `roomMembers`, `roomOrder` and re-exporting factory functions.
  - Created unit test suites `tests/unit/repositories-rooms.test.js`, `repositories-room-members.test.js`, and `repositories-room-order.test.js` registered under `unit-smoke` in `test-batches.js`.
  - Authored `packages/app/docs/storage/rooms.md` and updated `packages/app/docs/storage/README.md`.
  - Verified zero SQL string interpolation, zero modifications to untouched directories/plugins, key parity across locale files, and clean execution of `pnpm check-batches`, `unit-smoke`, `component-smoke`, build, and extensions vocabulary.

- **C-INFRA-14 Deliverables & Status:**
  - Status: `done`.
  - Created migration `packages/app/src/db/migrations/0004-messages.sql` defining `messages` (`message_id`, `room_id`, `sender_user_id`, `sender_client_id`, `epoch`, `seq`, `content_type`, `ciphertext`, `decrypted_payload`, `reply_to`, `edited_at`, `deleted_at`, `expires_at`, `local_status`, `local_error`, `created_at`, `updated_at`) and `message_versions` (`message_id`, `edit_sequence`, `ciphertext`, `decrypted_payload`, `edited_at`, `PRIMARY KEY (message_id, edit_sequence)`) tables and their indexes.
  - Created repository `packages/app/src/lib/db/repositories/messages.js` exporting `createMessagesRepository` with 16 async methods: `get`, `upsert` (with partial `COALESCE` update semantics and local field fallbacks), `updateLocalStatus`, `markDeleted`, transactional `remove`, transactional `removeExpired`, transactional `removeAllInRoom`, `listInRoom` (ordered by `epoch DESC, seq DESC` with `{ epoch, seq }` object cursor pagination), `listApplicationsInRoom` (filtering to `content_type = 'application'`), `countInRoom`, `countApplicationsInRoom`, `upsertVersion` (`INSERT OR REPLACE`), `listVersions` (ordered by `edit_sequence ASC`), `getVersion`, `countVersions`, and transactional `clearAll`.
  - Updated aggregator `packages/app/src/lib/db/repositories/index.js` exposing `messages` and re-exporting `createMessagesRepository`.
  - Created unit test suite `packages/app/tests/unit/repositories-messages.test.js` (24 cases) registered under `unit-smoke` in `test-batches.js`.
  - Authored documentation at `packages/app/docs/storage/messages.md` and updated `packages/app/docs/storage/README.md`.
  - Verified zero SQL string interpolation, zero modifications to untouched directories/plugins, key parity across locale files, and clean execution of `pnpm check-batches`, `unit-smoke`, `component-smoke`, build, and extensions vocabulary.

- **C-INFRA-15 Deliverables & Status:**
  - Status: `done`.
  - Created migration `packages/app/src/db/migrations/0005-attachments-reactions.sql` defining `attachments` (`file_id`, `room_id`, `purpose`, `content_type`, `plaintext_size`, `encrypted_size`, `thumbnail_file_id`, `duration_ms`, `uploaded_at`, `downloaded_at`, `cached_at`) and `reactions` (`message_id`, `sender_user_id`, `sender_client_id`, `reaction`, `created_at`, `deleted_at`, `PRIMARY KEY (message_id, sender_user_id, sender_client_id, reaction)`) tables with indexes (`idx_attachments_room`, `idx_attachments_purpose`, `idx_reactions_message` WHERE `deleted_at IS NULL`, `idx_reactions_user`).
  - Created repositories under `packages/app/src/lib/db/repositories/`:
    - `attachments.js` exporting `createAttachmentsRepository` (`get`, `upsert` with `COALESCE`, `markUploaded`, `markDownloaded`, `getMany`, `listByRoom`, `listByPurpose`, `remove`, `countByRoom`, `clearAll`).
    - `reactions.js` exporting `createReactionsRepository` (`listForMessage`, `listForRoom`, `get`, `add`, `remove`, `removeByMessage`, `countForMessage`, `aggregateForMessage`, `hasReacted`, `clearAll`).
  - Updated aggregator `packages/app/src/lib/db/repositories/index.js` exposing `attachments` and `reactions` and re-exporting factory functions.
  - Created unit test suites `packages/app/tests/unit/repositories-attachments.test.js` (19 cases) and `packages/app/tests/unit/repositories-reactions.test.js` (19 cases) registered under `unit-smoke` in `test-batches.js`.
  - Authored `packages/app/docs/storage/attachments.md` and `packages/app/docs/storage/reactions.md`, and updated `packages/app/docs/storage/README.md`.
  - Verified zero SQL string interpolation, zero modifications to untouched files, key parity across locale files, and clean execution of `pnpm check-batches`, `unit-smoke`, `component-smoke`, build, and extensions vocabulary.

- **C-INFRA-16 Deliverables & Status:**
  - Status: `done`.
  - Created migration `packages/app/src/db/migrations/0006-user-state.sql` defining `read_state` (`user_id`, `room_id`, `last_read_message_id`, `last_read_at`, `marked_unread`, `updated_at`, `PRIMARY KEY (user_id, room_id)`), `drafts` (`room_id PRIMARY KEY`, `text`, `updated_at`), and `blocked_users` (`user_id PRIMARY KEY`, `blocked_at`) tables and their indexes (`idx_read_state_room`, `idx_blocked_users_blocked_at`).
  - Created repositories under `packages/app/src/lib/db/repositories/`:
    - `read-state.js` exporting `createReadStateRepository` (`get`, `getForRoom`, `upsert` preserving `marked_unread`, `setMarkedUnread`, `clearMarkedUnread`, `listForUser`, `remove`, `removeAll`, `clearAll`).
    - `drafts.js` exporting `createDraftsRepository` (`get`, `getText`, `set` deleting row on empty/whitespace text, `remove`, `list`, `count`, `clearAll`).
    - `blocked-users.js` exporting `createBlockedUsersRepository` (`isBlocked`, `list`, `add` using `INSERT OR REPLACE`, `remove`, `count`, `clearAll`).
  - Updated aggregator `packages/app/src/lib/db/repositories/index.js` exposing `readState`, `drafts`, and `blockedUsers` (10 repositories total) and re-exporting factory functions.
  - Created unit test suites `packages/app/tests/unit/repositories-read-state.test.js` (15 cases), `packages/app/tests/unit/repositories-drafts.test.js` (12 cases), and `packages/app/tests/unit/repositories-blocked-users.test.js` (9 cases) registered under `unit-smoke` in `packages/app/test-batches.js`.
  - Authored `packages/app/docs/storage/read-state.md`, `packages/app/docs/storage/drafts.md`, and `packages/app/docs/storage/blocked-users.md`, and updated `packages/app/docs/storage/README.md`.
  - Verified zero SQL string interpolation, zero modifications to untouched files, key parity across locale files, and clean execution of `pnpm check-batches`, `unit-smoke`, `component-smoke`, build, and extensions vocabulary.

- **C-INFRA-17 Deliverables & Status:**
  - Status: `done`.
  - Created migration `packages/app/src/db/migrations/0007-outbox.sql` defining `outbox` table (`message_id PRIMARY KEY`, `room_id`, `enqueued_at`, `attempts DEFAULT 0`, `next_attempt_at`, `last_attempt_at`, `last_error`) and indexes `idx_outbox_next_attempt` and `idx_outbox_room`.
  - Created outbox repository `packages/app/src/lib/db/repositories/outbox.js` exporting `createOutboxRepository` with 13 async methods: `enqueue`, `dequeue`, `peek`, `list` (with FIFO cursor pagination), `get`, `markSent`, `markFailed` (updating attempt state or deleting row on `terminal: true`), `count`, `countDue`, `listByRoom`, `removeByRoom`, `remove`, `clearAll`.
  - Updated in-memory SQLite backend `packages/app/src/lib/db/backends/memory.js` supporting `ON CONFLICT DO NOTHING`, compound `WHERE` clauses, and `COUNT(*)` alias expressions.
  - Updated repository aggregator `packages/app/src/lib/db/repositories/index.js` exposing `outbox` (11 repositories total) and re-exporting `createOutboxRepository`.
  - Created unit test suite `packages/app/tests/unit/repositories-outbox.test.js` (23 cases) registered under `unit-smoke` in `packages/app/test-batches.js`.
  - Authored `packages/app/docs/storage/outbox.md` and updated `packages/app/docs/storage/README.md`.
  - Recorded architectural decision: row deleted on terminal failure (`terminal: true`), delegating failed state representation to `messages.local_status = 'failed'` and `messages.local_error`.

- **C-INFRA-18 Deliverables & Status:**
  - Status: `done`.
  - Created migration `packages/app/src/db/migrations/0008-room-preferences-nicknames.sql` defining `room_preferences` (`user_id`, `room_id`, `key`, `value_json`, `updated_at`, `PRIMARY KEY (user_id, room_id, key)`) and `nicknames` (`room_id`, `user_id`, `nickname`, `updated_at`, `PRIMARY KEY (room_id, user_id)`), with indexes `idx_room_preferences_room` and `idx_nicknames_user`.
  - Created repositories under `packages/app/src/lib/db/repositories/`:
    - `room-preferences.js` exporting `createRoomPreferencesRepository` (`get`, `getAll`, `set`, `setMany`, `remove`, `removeAllInRoom`, `listKeys`, `count`, `clearAll`); malformed JSON returns `undefined` in `get` and skipped in `getAll`; `setMany` writes entries transactionally with a single timestamp.
    - `nicknames.js` exporting `createNicknamesRepository` (`get`, `getMany`, `set`, `remove`, `listInRoom`, `listRoomsForUser`, `removeAllInRoom`, `countInRoom`, `clearAll`); `set` with empty/whitespace string deletes the nickname; `getMany` parameterizes `IN` placeholders by array length.
  - Updated repository aggregator `packages/app/src/lib/db/repositories/index.js` exposing `roomPreferences` and `nicknames` (13 repositories total) and re-exporting factory functions.
  - Created unit test suites `tests/unit/repositories-room-preferences.test.js` (23 cases) and `tests/unit/repositories-nicknames.test.js` (18 cases) registered under `unit-smoke` in `packages/app/test-batches.js`.
  - Authored contract documentation at `packages/app/docs/storage/room-preferences.md` and `packages/app/docs/storage/nicknames.md`, and updated `packages/app/docs/storage/README.md`.

- **C-INFRA-19 Deliverables & Status:**
  - Status: `done`.
  - Created migration `packages/app/src/db/migrations/0009-device-names-starred-items.sql` defining `device_names` (`user_id`, `device_id`, `encrypted_device_name`, `user_seq`, `updated_at`, `deleted_at`, `PRIMARY KEY (user_id, device_id)`) and `starred_items` (`user_id`, `item_id`, `item_type`, `room_id`, `user_seq`, `starred_at`, `deleted_at`, `PRIMARY KEY (user_id, item_id, item_type)`), with indexes `idx_device_names_seq`, `idx_starred_items_seq`, and `idx_starred_items_room`.
  - Created repositories under `packages/app/src/lib/db/repositories/`:
    - `device-names.js` exporting `createDeviceNamesRepository` (`get`, `listForUser`, `listActiveForUser`, `applyRemote`, `applyBatch`, `getHighestSeq`, `remove`, `clearAll`); `applyRemote` skips stale/equal `user_seq` rows (`{ changes: 0 }`); `applyBatch` applies in sequence order in a single transaction.
    - `starred-items.js` exporting `createStarredItemsRepository` (`get`, `isStarred`, `listForUser`, `listForRoom`, `applyRemote`, `applyAddedEvent`, `applyRemovedEvent`, `applyBatch`, `remove`, `countForUser`, `countByType`, `getHighestSeq`, `clearAll`); `listForUser` composes optional `type`, `roomId`, and cursor filters with parameterized values; `applyRemovedEvent` writes tombstones.
  - Updated repository aggregator `packages/app/src/lib/db/repositories/index.js` exposing `deviceNames` and `starredItems` (15 repositories total) and re-exporting factory functions.
  - Created unit test suites `packages/app/tests/unit/repositories-device-names.test.js` (17 cases) and `packages/app/tests/unit/repositories-starred-items.test.js` (24 cases) registered under `unit-smoke` in `packages/app/test-batches.js`.
  - Authored contract documentation at `packages/app/docs/storage/device-names.md` and `packages/app/docs/storage/starred-items.md`, and updated `packages/app/docs/storage/README.md`.

- **C-INFRA-20 Deliverables & Status:**
  - Status: `done`.
  - Created migration `packages/app/src/db/migrations/0010-sync-state.sql` defining `sync_state` (`room_id PRIMARY KEY`, `epoch`, `seq`, `updated_at`), `processed_events` (`event_key PRIMARY KEY`, `processed_at`), and `mls_rooms` (`room_id PRIMARY KEY`, `local_client_id`, `current_epoch`, `membership_status DEFAULT 'pending'`, `confirmed_transcript_hash BLOB`, `last_error`, `joined_at`, `updated_at`), with indexes `idx_processed_events_at` and `idx_mls_rooms_status`.
  - Created repositories under `packages/app/src/lib/db/repositories/`:
    - `sync-state.js` exporting `createSyncStateRepository` (`get`, `getCursor`, `set`, `advance`, `list`, `remove`, `clearAll`).
    - `processed-events.js` exporting `createProcessedEventsRepository` (`has`, `hasKey`, `mark`, `markKey`, `markBatch`, `prune`, `count`, `clearAll`) and module-level helper `makeKey(source, eventName, sequence)`.
    - `mls-rooms.js` exporting `createMlsRoomsRepository` (`get`, `upsert` preserving existing values with `COALESCE`/`CASE WHEN`, `markJoined`, `markLeft`, `markError`, `advanceEpoch`, `listByStatus`, `listJoined`, `remove`, `clearAll`).
  - Extended repository aggregator `packages/app/src/lib/db/repositories/index.js` exposing `syncState`, `processedEvents`, `mlsRooms` (18 total repositories) and re-exporting all factories and `makeKey`.
  - Created unit test suites `packages/app/tests/unit/repositories-sync-state.test.js` (16 cases), `packages/app/tests/unit/repositories-processed-events.test.js` (13 cases), and `packages/app/tests/unit/repositories-mls-rooms.test.js` (16 cases) registered under `unit-smoke` batch in `test-batches.js`.
  - Authored contract documentation at `packages/app/docs/storage/sync-state.md`, `packages/app/docs/storage/processed-events.md`, and `packages/app/docs/storage/mls-rooms.md`, and updated `packages/app/docs/storage/README.md`.
  - Reached storage layer completion checkpoint: all 18 repositories across 10 migrations are fully implemented, tested, and documented.

- **C-INFRA-21 Deliverables & Status:**
  - Status: `done`.
  - Extended `@atoll/app` storage plugin (`packages/app/src/plugins/storage-plugin.js`) with `repos: () => repos` on client context surface and SSR throw handler.
  - Dynamically imported `createRepositories` via Phase 1 `Promise.all` in `client.context`.
  - Memoized DB under `pluginContext.__storage_client__` and aggregator under `pluginContext.__storage_repos_client__`.
  - Extended `packages/app/tests/unit/storage-plugin.test.js` with 6 new test cases (14 total passing in `unit-smoke` batch).
  - Authored "Repository accessor — repos()" contract documentation in `packages/app/docs/plugins/storage.md`.

- **C-INFRA-22 Deliverables & Status:**
  - Status: `done`.
  - Created pure sync library modules `packages/app/src/lib/sync/apply.js` (exporting `applyReadState`, `applyDeviceState`, `applyStarredItems`) and `packages/app/src/lib/sync/index.js` (exporting `runUserScopedSync(deps)`).
  - Implemented Coralite plugin `packages/app/src/plugins/sync-plugin.js` with `name: 'sync'`, exposing `ctx.sync.runUserScopedSync({ userId, api, storage, onProgress })` directly via Phase 1 async dynamic import, with in-flight concurrency guard and SSR throw handler.
  - Registered `syncPlugin()` in `packages/app/coralite.config.js` after `storagePlugin()`.
  - Updated `packages/app/src/components/containers/messenger-boot.html` destructuring `sync` in `client()`, triggering `sync.runUserScopedSync` post-`storage.open()` when `result.user?.id` is present, and setting `data-sync-ready="true"`.
  - Created unit test suites `packages/app/tests/unit/sync.test.js` (14 cases) and `packages/app/tests/unit/sync-plugin.test.js` (8 cases) registered under `unit-smoke`.
  - Created Playwright component test `packages/app/tests/component/sync.spec.js` (3 cases) registered under `component-auth`, and generated screenshot `packages/app/test-results/sync-boot.png`.
  - Authored plugin contract documentation at `packages/app/docs/plugins/sync.md` and updated `packages/app/docs/plugins/README.md`.
  - Scope decision: deferred `user_preferences` section application to a follow-on task to avoid inventing storage mappings before spec settlement.

- **C-INFRA-23 Deliverables & Status:**
  - Status: `done`.
  - Authored `packages/app/docs/components.md` containing the complete Component Authoring Guide (16 rules, 12 sections).
  - Created `packages/app/docs/README.md` index.
  - Audited all components under `packages/app/src/components/`:
    - `conversation-row.html`: reflected `isUnread` (`reflect: true`), updated CSS selector to `:host([is-unread])`, removed `data-room-id` and `data-unread`.
    - `messenger-boot.html`: reflected `ready`, `error`, `hasOprfToken`, `storageReady`, `storagePersistent`, `syncReady` (`reflect: true`), updated `client()` state mutations (removing imperative dataset writes), updated CSS to `:host([ready])`.
    - `ui-icon.html`: removed `data-icon-name`.
    - `ui-profile.html`: reflected `size` (`reflect: true`), updated CSS selectors to `:host([size="..."])`.
    - `auth-view-register.html`: added `<!-- coralite-ignore-data-attributes -->` pragma for ALTCHA.
    - `rail-host.html`: removed `dataset.extensionId` from `li`, retained `data-rail-id` on button.
  - Updated Playwright test files (`hydration.spec.js`, `messenger-boot.spec.js`, `sync.spec.js`) to target `messenger-boot` reflected host attributes.
  - Created enforcement unit test `packages/app/tests/unit/components-data-attrs.test.js` and registered it in `unit-smoke` in `packages/app/test-batches.js`.
  - Updated `packages/app/TESTING.md` with Component attribute enforcement section.
  - Extended client task template standard checklist in `client-task-ledger.md` with Component Authoring section.

- **C-INFRA-24 Deliverables & Status:**
  - Status: `done`.
  - Modified `packages/app/src/plugins/storage-plugin.js` setting `client.config = { dbName, migrations }` and reading `pluginContext.config?.dbName` / `pluginContext.config?.migrations` in `client.context`.
  - Created unit regression test `packages/app/tests/unit/storage-plugin-config.test.js` (9 cases) registered under `unit-smoke` batch in `packages/app/test-batches.js`.
  - Created build-time verification script `packages/app/scripts/check-migration-bundle.mjs` and added `"check:migration-bundle"` script to `packages/app/package.json`.
  - Authored `packages/app/docs/plugins/authoring.md` (10 sections detailing plugin authoring and `client.config` delivery pattern).
  - Updated `packages/app/docs/plugins/README.md` and `packages/app/docs/plugins/storage.md`.
  - Recorded T4 feedback entry CF-007 in `client-coralite-feedback.md` and addendum in `client-verification.md`.

## Component Authoring Policy

Every component's `<script type="module">` block MUST `import { defineComponent } from 'coralite'` and `export default defineComponent({ ... })`. Plain object exports are silently ignored by Coralite's compiler. The enforcement test is `packages/app/tests/unit/components-defineComponent.test.js`.
