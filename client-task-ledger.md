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
| Pending | 8 |
| Done | 12 |
| Blocked | 0 |

## Client Tasks

| Task | Deliverable | Status | Depends On | Batch |
|---|---|---|---|---|
| C-V-A | Verify repo state and toolchain | done | — | — |
| C-V-B | Verify Client Testing Stack and Coralite Test Tooling | done | C-INFRA-2 | — |
| C-V-C | Verify Client-Side OPRF Library Availability | done | C-AUTH-1 | — |
| C-INFRA-0 | Establish client tracking files | done | C-V-A | — |
| C-CORALITE-FEEDBACK | Establish Coralite Upstream Feedback Policy | done | C-INFRA-0 | — |
| C-INFRA-1 | Monorepo setup | done | C-INFRA-0 | — |
| C-INFRA-2 | Coralite & Plugin Configuration | done | C-INFRA-1 | — |
| C-INFRA-2b | Unblock Coralite Build Pipeline | done | C-INFRA-2 | — |
| C-INFRA-3 | Establish Client Test Infrastructure and Batch Model | done | C-INFRA-1 | unit-smoke |
| C-INFRA-4 | Playwright Browser Testing Setup | done | C-INFRA-2, C-INFRA-3 | component-smoke |
| C-INFRA-5 | Design System Tokens & Base CSS | done | C-INFRA-1 | component-smoke |
| C-AUTH-1 | Auth Gate Shell & Routing | done | C-INFRA-2, C-INFRA-5 | component-smoke |
| C-AUTH-2 | OPRF Blinding Client & API Client | pending | C-INFRA-2, C-V-C | — |
| C-AUTH-3 | OPAQUE Login & Registration Flows | pending | C-AUTH-1, C-AUTH-2, C-INFRA-4 | — |
| C-AUTH-4 | Session Persistence & Boot Sequence | pending | C-AUTH-3, C-INFRA-3 | — |
| C-AUTH-5 | Recovery Code Flow & Account Recovery | pending | C-AUTH-3 | — |
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

## Coralite Feedback IDs

| ID | Task | Type | Tier | Status |
|---|---|---|---|---|
| CF-001 | C-INFRA-2 | Bug (missing `src/components` directory causes `CoraliteError` crash) | T1 | filed-upstream; client-mitigated-by-input |
| CF-002 | C-INFRA-2 | Bug (missing `public` directory causes `ENOENT` `copyDirectory` crash) | T1 | filed-upstream; client-mitigated-by-input |
| CF-003 | C-AUTH-1 | Missing feature (`coralite-scripts test` dev server omits client JS script bundle links) | T2 | filed-upstream; client-mitigated-by-architecture |

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
