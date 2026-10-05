# Atoll Bot SDK Task Ledger

Track progress across Bot SDK implementation tasks.

---

## Summary

- **Total Tasks:** 32
- **Done:** 17
- **In Progress:** 0
- **Todo:** 15

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
| B-013 | Signing | done | §6.1, §10.1 | Ed25519 signing primitives and length-prefixed payload encoders |
| B-014 | Publisher Key Cache | done | §6.1, §14.10, §14.11 | Publisher key cache and signature verification |
| B-015 | Command Result Encrypt | done | §6.3, §6.4 | Command result encryption using ephemeral X25519 ECDH, HKDF-Expand, and AES-256-GCM |
| B-016 | Settings Decrypt | done | §6.3, §7.2 | Settings payload decryption using X25519, HKDF-Expand, and AES-256-GCM |
| B-017 | HTTP Client | todo | §14.2 | REST API client for bot SDK runtime |
| B-018 | WebSocket | todo | §14.3 | WebSocket connection manager with backoff reconnect |
| B-019 | Context | todo | §8 | Runtime `ctx` assembly and scoping |
| B-020 | Post Helper | todo | §8.3 | `ctx.post` implementation with publisher key lookup and encryption |
| B-021 | Storage Wrapper | todo | §8.4 | Author-facing `ctx.storage` with reserved prefix enforcement |
| B-022 | Media | todo | §8.5 | Media upload/download helper |
| B-023 | Rooms | todo | §8.6 | Room state query and management helpers |
| B-024 | Users | todo | §8.7 | User lookup and key transparency query helper |
| B-025 | Audit | todo | §8.8 | Bot audit log submission helper |
| B-026 | CLI Core | todo | §15 | CLI entrypoint, argument parser, and subcommands |
| B-027 | Webhooks | todo | §10.3 | HTTP webhook server and payload validator |
| B-028 | Cron | todo | §10.3 | Cron schedule parser and timer engine |
| B-029 | Integration | todo | §10.1 | Full runtime wiring and entrypoint export |
