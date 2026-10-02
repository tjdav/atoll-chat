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
| Pending | 14 |
| Done | 4 |
| Blocked | 0 |

## Client Tasks

| Task | Deliverable | Status | Depends On | Batch |
|---|---|---|---|---|
| C-V-A | Verify repo state and toolchain | done | — | — |
| C-INFRA-0 | Establish client tracking files | done | C-V-A | — |
| C-CORALITE-FEEDBACK | Establish Coralite Upstream Feedback Policy | done | C-INFRA-0 | — |
| C-INFRA-1 | Monorepo setup | done | C-INFRA-0 | — |
| C-INFRA-2 | Coralite & Plugin Configuration | pending | C-INFRA-1 | — |
| C-INFRA-3 | SQLite & Database Storage Architecture | pending | C-INFRA-1 | — |
| C-INFRA-4 | CoreCrypto WASM Integration & Keystore | pending | C-INFRA-1 | — |
| C-INFRA-5 | Design System Tokens & Base CSS | pending | C-INFRA-1 | — |
| C-AUTH-1 | Auth Gate Shell & Routing | pending | C-INFRA-2, C-INFRA-5 | — |
| C-AUTH-2 | OPRF Blinding Client & API Client | pending | C-INFRA-2 | — |
| C-AUTH-3 | OPAQUE Login & Registration Flows | pending | C-AUTH-1, C-AUTH-2, C-INFRA-4 | — |
| C-AUTH-4 | Session Persistence & Boot Sequence | pending | C-AUTH-3, C-INFRA-3 | — |
| C-AUTH-5 | Recovery Code Flow & Account Recovery | pending | C-AUTH-3 | — |
| C-CHAT-1 | Messenger Shell & Three-Panel Layout | pending | C-INFRA-2, C-INFRA-5 | — |
| C-CHAT-2 | Extension SDK (@atoll/extend) Core Implementation | pending | C-INFRA-1 | — |
| C-CHAT-3 | Extension System Validation & Vocabulary Command | pending | C-CHAT-2 | — |
| C-CHAT-4 | First-Party Core Extensions Skeleton | pending | C-CHAT-2, C-CHAT-3 | — |
| C-CHAT-5 | Conversation List & Room Creation UI | pending | C-CHAT-1, C-CHAT-4, C-INFRA-3 | — |

## Blockers

- **Node.js version:** Installed `v22.22.1` is below the spec's `≥ 22.22.2`.
  Resolve in the runtime environment before any build task.

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
