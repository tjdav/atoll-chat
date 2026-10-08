# Atoll Bot SDK Task Ledger

Track progress across Bot SDK implementation tasks.

---

## Summary

- **Total Tasks:** 37
- **Done:** 36
- **In Progress:** 0
- **Todo:** 1

---

## Tasks

| Task ID | Component | Status | Spec Ref | Description |
|---|---|---|---|---|
| B-034 | Testing | done | §8.8, §13.3 | Implement the mock server double (`packages/bot/src/testing/mock-server.js`) with optional crypto validation |
| B-033 | Testing | done | §3.5, §13.1 | Implement `createTestCtx` helper, in-memory stores, and `@atoll/bot/testing` entry point |
| B-001 | Scaffolding | done | §2 | Workspace structure and package configuration |
| B-002 | Types | done | §3 | JSDoc type declarations for public type surface |
| B-003 | Errors | done | §12 | Code-bearing BotError hierarchy (Amended by B-017, B-022, B-030) |
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
| B-017 | HTTP Client | done | §14.2 | REST API client for bot SDK runtime (Amends §12 with HttpRequestError) |
| B-018 | WebSocket | done | §14.3 | WebSocket connection manager with backoff reconnect |
| B-019 | SSE Client | done | §6.1, §8.8.9 | SSE transport for observer stream |
| B-020 | Post Helper | done | §6.1, §8.3 | `ctx.post` implementation with publisher key lookup and encryption |
| B-020a | Post Member | todo | §6.1 | Member-mode `ctx.post` via MLS (`src/runtime/context/post-member.js`) |
| B-021 | Context | done | §6.2, §8 | `ctx.reply` wrapper over `ctx.post` with `replyTo` non-empty string validation |
| B-022 | Context | done | §6.3 | `ctx.sendLocal` handler for owner-targeted local messages (Amends §12 with SendLocalFailedError) |
| B-023 | Context | done | §3.3, §6.4, §8.8.10 | Command invocation handler, arg validation, handler execution, and result dispatch |
| B-024 | Context | done | §3.5, §14.6 | `ctx.fetch` and `ctx.fetchUserUrl` outbound fetch utilities with scheme validation and query stripping |
| B-025 | Context | done | §3.5, §7, §12 | Encrypted settings store caching, subscriber notifications, coalesced refresh, and read-only throws |
| B-026 | Stores | done | §3.5, §7.4, §9 | Author-facing `StorageStore` reserved-prefix wrapper and `RoomsStore` room list store |
| B-027 | Webhooks | done | §3.4, §3.6, §10.1, §10.3, §14.4 | Webhook trigger server, signature verification, idempotency deduplication, and dispatch |
| B-028 | Cron | done | §3.4, §3.6, §10.2, §10.3, §14.5 | Cron schedule trigger engine, five-field parser, nextFireTime calculation, DST/timezone handling, catch-up, state persistence, and idempotency deduplication |
| B-029 | Integration | done | §10.1 | Full runtime wiring and entrypoint export |
| B-029a | Triggers Wiring | done | §10.1, §10.2, §10.3 | Wiring trigger servers (webhooks & cron) into runtime startup/shutdown lifecycle |
| B-029b | Subscriptions Wiring | done | §3.6, §4.7, §6.1, §14.4-14.5 | Wire room channel subscriptions (WebSocket for member mode, SSE stream for observer mode) and event dispatching |
| B-030 | Pause Policy | done | §11, §12 | Implement pause-on-failure policy, consecutive failure tracking, reportPause callback, guard wrapper across dispatches, and PausedError addition |
| B-031 | Reconnection | done | §4.7, §14.2, §14.7 | Implement WebSocket and observer SSE reconnection loop with exponential backoff and proportional jitter |
| B-032 | Shutdown | done | §14.8 | Implement shutdown tracker, signal handlers, graceful runtime.stop({ drainMs }), and shutdown sequence orchestrator |
| B-036 | CLI Skeleton | done | §14.1, §14.2, §4.6 | CLI entry point (`src/cli.js`), dispatcher (`src/cli/index.js`), argument parser (`src/cli/args.js`), and `validate` subcommand (`src/cli/validate.js`) |
