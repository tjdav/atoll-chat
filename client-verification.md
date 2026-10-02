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
