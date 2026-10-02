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
| `coralite-scripts test` behavior | Launches testing-mode HTTP server on port 3000; does NOT execute test files or apply filters |
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
