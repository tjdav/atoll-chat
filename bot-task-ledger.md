# Atoll Bot SDK Task Ledger

Track progress across Bot SDK implementation tasks.

---

## Summary

- **Total Tasks:** 32
- **Done:** 13
- **In Progress:** 0
- **Todo:** 19

---

## Tasks

| Task ID | Component | Status | Spec Ref | Description |
|---|---|---|---|---|
| B-001 | Scaffolding | done | §2 | Workspace structure and package configuration |
| B-002 | Types | done | §3 | JSDoc type declarations for public type surface |
| B-003 | Errors | done | §12 | Code-bearing BotError hierarchy |
| B-004 | Declarations | done | §4 | Settings, command, triggers identity helpers |
| B-004a | Types/JSDoc | done | Amendment | TS module resolution & JSDoc description standard |
| B-005 | Factory | done | §4.5 | `defineBot` factory and config validation collector |
| B-006 | Canaries | done | Amendment | Type canary tests for settings and command args |
| B-007 | Testing | done | Amendment | Batch manifest and batched test enforcement runner |
| B-008 | Keystore | done | §14.9 | Encrypted keystore core, crypto, and schema |
| B-008a | Keystore | done | §14.9 | OS keychain resolvers (macOS, Linux, Windows) |
| B-008b | Keystore | done | §14.9 | Interactive prompt resolver and keychain write helper |
| B-009 | Storage | done | §9, §14.1 | Encrypted storage backend and atomic whole-file writes |
| B-010 | Logging | done | §14.11 | Structured redacting logger for runtime and author output |
| B-011 | Idempotency | done | §10.3 | Idempotency store for trigger deduplication |
| B-012 | Config | done | §14.2, §14.3 | Config loader with TOML parsing and env var precedence (Deliverable split from config.js to config/index.js plus config/toml.js) |
| B-013 | Rate Limits | todo | §10.4 | Client-side rate limiter and bucket manager |
| B-014 | State | todo | §10.2 | Runtime state machine and lifecycle manager |
| B-015 | REST Client | todo | §14.2 | Server REST API client wrapper |
| B-016 | WebSocket | todo | §14.3 | WebSocket connection manager with backoff reconnect |
| B-017 | Context | todo | §8 | Runtime `ctx` assembly and scoping |
| B-018 | Settings | todo | §8.1 | Settings accessor with cache and server sync |
| B-019 | Commands | todo | §8.2 | Command registration, argument parser, and handler routing |
| B-020 | Messages | todo | §8.3 | Message listener subscription and event routing |
| B-021 | Storage Wrapper | todo | §8.4 | Author-facing `ctx.storage` with reserved prefix enforcement |
| B-022 | Media | todo | §8.5 | Media upload/download helper |
| B-023 | Rooms | todo | §8.6 | Room state query and management helpers |
| B-024 | Users | todo | §8.7 | User lookup and key transparency query helper |
| B-025 | Audit | todo | §8.8 | Bot audit log submission helper |
| B-026 | CLI Core | todo | §15 | CLI entrypoint, argument parser, and subcommands |
| B-027 | Webhooks | todo | §10.3 | HTTP webhook server and payload validator |
| B-028 | Cron | todo | §10.3 | Cron schedule parser and timer engine |
| B-029 | Integration | todo | §10.1 | Full runtime wiring and entrypoint export |
