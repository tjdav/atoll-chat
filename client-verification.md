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
