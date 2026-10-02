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
| Pending | 15 |
| Done | 2 |
| Blocked | 0 |

## Client Tasks

| Task | Deliverable | Status | Depends On | Batch |
|---|---|---|---|---|
| C-V-A | Verify repo state and toolchain | done | — | — |
| C-INFRA-0 | Establish client tracking files | done | C-V-A | — |
| C-INFRA-1 | Monorepo setup | pending | C-INFRA-0 | — |
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

## Notes

- **C-INFRA-0 Deliverables:**
  - Created `client-task-ledger.md` (repo root) with task status tracking and Wave 0/1 task breakdown.
  - Created `client-verification.md` (repo root) with verified C-V-A facts and specification links.
  - Created `client-verification/cv-a/report.md` with C-V-A verification report.
