# Bot SDK Task Ledger (@atoll/bot)

This ledger tracks task completion for `@atoll/bot`.

**Specification:** https://raw.githubusercontent.com/tjdav/playground/refs/heads/bench-workspace-relay-11510657464757500912/atoll-bot-v1.md
**Server specification:** https://raw.githubusercontent.com/tjdav/playground/refs/heads/bench-workspace-relay-11510657464757500912/server-spec-v3.md (v3.0.2 text is authoritative)
**Client specification (context):** https://raw.githubusercontent.com/tjdav/playground/refs/heads/bench-workspace-relay-11510657464757500912/client-spec-v2.md
**Coralite reference:** https://coralite.dev/llms.txt

## Summary

- **Total Tasks**: 50
- **Done**: 10
- **Pending**: 40
- **Blocked**: 0

## Critical Path

The shortest chain to a working bot that can post a message and receive a command:

```

B-V-A → B-001 → B-002 → B-003 → B-004 → B-005
→ B-008 → B-013 → B-014 → B-017
→ B-020 → B-029 → B-031 → B-038 → B-044

```

Two hard gates:

- **B-006** (type canaries) must pass before any factory is considered done.
- **B-029** (handler dispatch) is the integration point where everything wires together.

## Recon

- [x] **B-V-A**: Verify repository state, toolchain, package availability
  - Depends on: —
  - Deliverable: `bot-verification/bv-a/report.md`

## Workspace and Package Skeleton

- [x] **B-001**: Create pnpm workspace and `@atoll/bot` package skeleton
  - Depends on: B-V-A
  - Deliverable: `pnpm-workspace.yaml`, `tsconfig.base.json`, `eslint.config.js`, `packages/bot/package.json`, `packages/bot/tsconfig.json`, `packages/bot/tsconfig.build.json`, `packages/bot/eslint.config.js`, `packages/bot/src/index.js`, `packages/bot/src/cli.js`
  - Deliverable amended by B-004a: `module` changed from `nodenext` to `es2022` and `moduleResolution` from `nodenext` to `bundler`. ESLint `definedTypes` populated; hyphen rule enabled.
  - Deliverable amended by B-007: package.json scripts replaced `test:unit` and `test:integration` with `check-batches`, `test:batch`, and `test:all` to enforce the batch model.
- [x] **B-002**: Author the public type surface (`src/types.js`)
  - Depends on: B-001
  - Deliverable: `packages/bot/src/types.js`
  - Deliverable amended by B-004a: every `@property` and `@template` in `src/types.js` now carries a description.
- [x] **B-003**: Author the error hierarchy (`src/errors.js`)
  - Depends on: B-001
  - Deliverable: `packages/bot/src/errors.js`

## Authoring Surface

- [x] **B-004**: Implement identity factories (`defineSettings`, `defineCommand`, `defineCommands`, `defineTrigger`)
  - Depends on: B-002, B-003
  - Deliverable: `packages/bot/src/define-settings.js`, `packages/bot/src/define-command.js`, `packages/bot/src/define-commands.js`, `packages/bot/src/define-trigger.js`
  - Deliverable amended by B-004a: every `@param` and `@returns` in the four factory files now carries a description. The `eslint-disable` comments were removed; the rules they suppressed remain enabled.
- [x] **B-004a**: Adopt the JSDoc description standard and fix module resolution
  - Depends on: B-001, B-002, B-003, B-004
  - Deliverable: `tsconfig.base.json`, `eslint.config.js`, `packages/bot/src/types.js`, `packages/bot/src/define-settings.js`, `packages/bot/src/define-command.js`, `packages/bot/src/define-commands.js`, `packages/bot/src/define-trigger.js`
- [x] **B-005**: Implement `defineBot` and `validateConfig`
  - Depends on: B-004
  - Deliverable: `packages/bot/src/define-bot.js`
- [x] **B-006**: Add type canaries (`tests/canary/settings.js`, `tests/canary/args.js`)
  - Depends on: B-005
  - Deliverable: `packages/bot/tests/canary/settings.js`, `packages/bot/tests/canary/args.js`
- [x] **B-007**: Add batch manifest and `check-batches` enforcement
  - Depends on: B-001
  - Deliverable: `packages/bot/tests/batch-manifest.toml`, `packages/bot/tests/manifest-check.js`, `package.json` script `check-batches`

## Runtime Primitives

- [x] **B-008**: Implement the keystore core (scrypt + AES-256-GCM, outer schema, env resolver, Keystore class)
  - Depends on: B-003
  - Deliverable: `packages/bot/src/runtime/keystore/`
  - Note: Split from the original B-008 scope. Keychain and prompt resolvers are B-008a and B-008b.
- [ ] **B-008a**: Implement the OS keychain resolvers (macOS `security`, Linux `secret-tool`, Windows `cmdkey`)
  - Depends on: B-008
  - Deliverable: `packages/bot/src/runtime/keystore/resolvers/keychain.js`
- [ ] **B-008b**: Implement the interactive prompt resolver (stdin with masking)
  - Depends on: B-008
  - Deliverable: `packages/bot/src/runtime/keystore/resolvers/prompt.js`
- [ ] **B-009**: Implement the encrypted storage backend (`_runtime:` namespace, `clear` semantics)
  - Depends on: B-008
  - Deliverable: `packages/bot/src/runtime/storage/`
- [ ] **B-010**: Implement structured logging with redaction
  - Depends on: B-003
  - Deliverable: `packages/bot/src/runtime/diagnostics/logger.js`
- [ ] **B-011**: Implement the idempotency store (webhook, schedule, command, message keys)
  - Depends on: B-009
  - Deliverable: `packages/bot/src/runtime/idempotency/`
- [ ] **B-012**: Implement `bot.toml` reader and environment variable precedence
  - Depends on: B-003
  - Deliverable: `packages/bot/src/runtime/config.js`

## Crypto

- [ ] **B-013**: Implement signing (Ed25519 over length-prefixed payload)
  - Depends on: B-008
  - Deliverable: `packages/bot/src/runtime/crypto/signing.js`
- [ ] **B-014**: Implement publisher key cache, verification, epoch tracking
  - Depends on: B-013
  - Deliverable: `packages/bot/src/runtime/crypto/publisher.js`
- [ ] **B-015**: Implement command result encryption (X25519 ephemeral + HKDF `bot-command-result-v1` + AES-256-GCM)
  - Depends on: B-013
  - Deliverable: `packages/bot/src/runtime/crypto/command-result.js`
- [ ] **B-016**: Implement settings decryption (X25519 ECDH to `bot_command_private`, HKDF `bot-settings-v1`)
  - Depends on: B-013
  - Deliverable: `packages/bot/src/runtime/crypto/settings.js`

## Transport

- [ ] **B-017**: Implement the HTTP client for bot-facing endpoints
  - Depends on: B-008, B-012
  - Deliverable: `packages/bot/src/runtime/transport/http.js`
- [ ] **B-018**: Implement the WebSocket transport (`private-bot-{bot_id}` subscription)
  - Depends on: B-010, B-012
  - Deliverable: `packages/bot/src/runtime/transport/websocket.js`
- [ ] **B-019**: Implement the SSE transport (observer stream, `Last-Event-ID`)
  - Depends on: B-010, B-012
  - Deliverable: `packages/bot/src/runtime/transport/sse.js`

## Context and Response Methods

- [ ] **B-020**: Implement `ctx.post` (write_only and observer paths)
  - Depends on: B-014, B-017
  - Deliverable: `packages/bot/src/runtime/context/post.js`
- [ ] **B-021**: Implement `ctx.reply`
  - Depends on: B-020
  - Deliverable: `packages/bot/src/runtime/context/reply.js`
- [ ] **B-022**: Implement `ctx.sendLocal`
  - Depends on: B-015, B-017
  - Deliverable: `packages/bot/src/runtime/context/send-local.js`
- [ ] **B-023**: Implement command result dispatch (`local_message`, `toast`, `panel`, `room_message`, `none`)
  - Depends on: B-015, B-017
  - Deliverable: `packages/bot/src/runtime/context/command-result.js`
- [ ] **B-024**: Implement `ctx.fetch` and `ctx.fetchUserUrl` with redacted logging
  - Depends on: B-010, B-012
  - Deliverable: `packages/bot/src/runtime/context/fetch.js`

## Stores

- [ ] **B-025**: Implement `SettingsStore` (get/set/delete/subscribe, room prefixing, reserved prefix)
  - Depends on: B-016, B-017
  - Deliverable: `packages/bot/src/runtime/context/settings.js`
- [ ] **B-026**: Implement `StorageStore` and `RoomsStore`
  - Depends on: B-009, B-017
  - Deliverable: `packages/bot/src/runtime/context/storage.js`, `packages/bot/src/runtime/context/rooms.js`

## Triggers

- [ ] **B-027**: Implement the webhook HTTP server and secret verification
  - Depends on: B-011, B-012
  - Deliverable: `packages/bot/src/runtime/triggers/webhook.js`
- [ ] **B-028**: Implement the cron engine with DST and `catch_up` semantics
  - Depends on: B-011, B-012
  - Deliverable: `packages/bot/src/runtime/triggers/cron.js`

## Dispatch and Lifecycle

- [ ] **B-029**: Implement handler dispatch and `BotCtx` population per mode
  - Depends on: B-018, B-020, B-021, B-022, B-023, B-024, B-025, B-026
  - Deliverable: `packages/bot/src/runtime/index.js`, `packages/bot/src/runtime/dispatch.js`
- [ ] **B-030**: Implement the pause-on-failure policy and `bot.paused` notification
  - Depends on: B-018, B-029
  - Deliverable: `packages/bot/src/runtime/pause-policy.js`
- [ ] **B-031**: Implement reconnection with exponential backoff and outbound replay
  - Depends on: B-018, B-029
  - Deliverable: `packages/bot/src/runtime/reconnect.js`
- [ ] **B-032**: Implement graceful shutdown
  - Depends on: B-027, B-028, B-031
  - Deliverable: `packages/bot/src/runtime/shutdown.js`

## Testing Entry Point

- [ ] **B-033**: Implement `createTestCtx`
  - Depends on: B-029
  - Deliverable: `packages/bot/src/testing/create-test-ctx.js`
- [ ] **B-034**: Implement the mock server with optional `validateCrypto`
  - Depends on: B-017
  - Deliverable: `packages/bot/src/testing/mock-server.js`
- [ ] **B-035**: Implement `createTestRuntime`
  - Depends on: B-029, B-033, B-034
  - Deliverable: `packages/bot/src/testing/create-test-runtime.js`, `packages/bot/src/testing/index.js`

## CLI

- [ ] **B-036**: Implement the CLI skeleton and `validate`
  - Depends on: B-005, B-012
  - Deliverable: `packages/bot/src/cli.js` (validate subcommand)
- [ ] **B-037**: Implement `register`, `login`, `logout`
  - Depends on: B-017, B-036
  - Deliverable: `packages/bot/src/cli.js` (auth subcommands)
- [ ] **B-038**: Implement `run`
  - Depends on: B-029, B-031, B-036
  - Deliverable: `packages/bot/src/cli.js` (run subcommand)
- [ ] **B-039**: Implement `rotate-keys` and `avatar`
  - Depends on: B-013, B-017, B-036
  - Deliverable: `packages/bot/src/cli.js` (rotate-keys, avatar subcommands)
- [ ] **B-040**: Implement `export-keys` and `import-keys`
  - Depends on: B-008, B-036
  - Deliverable: `packages/bot/src/cli.js` (export-keys, import-keys subcommands)
- [ ] **B-041**: Implement `dev`, `inspect`, `tail`
  - Depends on: B-010, B-036
  - Deliverable: `packages/bot/src/cli.js` (dev, inspect, tail subcommands)
- [ ] **B-042**: Implement `sandbox` commands
  - Depends on: B-036, B-038
  - Deliverable: `packages/bot/src/cli.js` (sandbox subcommands)

## Diagnostics

- [ ] **B-043**: Implement diagnostics capture and retention
  - Depends on: B-009, B-010
  - Deliverable: `packages/bot/src/runtime/diagnostics/snapshots.js`

## Integration and Documentation

- [ ] **B-044**: End-to-end smoke test against the mock server
  - Depends on: B-035, B-038
  - Deliverable: `packages/bot/tests/integration/smoke.js`
- [ ] **B-045**: Author README and an example bot
  - Depends on: B-038, B-044
  - Deliverable: `packages/bot/README.md`, `examples/echo-bot/`
- [ ] **B-046**: Validate `hostApi` negotiation and capability declaration
  - Depends on: B-005, B-038
  - Deliverable: `packages/bot/tests/integration/host-api.js`

## Blockers

_None._

## Coralite Feedback Policy

When any bot task encounters friction with Coralite — a bug, a missing feature, a pattern the framework does not support — stop and classify it against the tiers below. Do not work around it silently.

| Tier | Condition | Action |
|---|---|---|
| **T1 — Bug** | Coralite behaves incorrectly against its own docs. | File a bug upstream. If it blocks the task, mark `blocked-upstream` and stop. |
| **T2 — Missing feature, has clean alternative** | Restructure the task. Record the friction. |
| **T3 — Missing feature, no clean alternative** | File a feature request. A documented shim with `TODO(coralite): CF-NNN` may proceed. Otherwise `blocked-upstream`. |
| **T4 — Enhancement** | File a feature request. Proceed. |

Escalation: https://codeberg.org/tjdavid/coralite/issues

Feedback entries live in `bot-coralite-feedback.md` at the repo root. Every entry gets an ID (`CF-NNN`, sequential, starting after the client team's highest number).

## Coralite Feedback IDs

| ID | Task | Type | Tier | Status |
|---|---|---|---|---|
| _none yet_ | | | | |

## Standing Policies

### Verification first on doubt

When uncertain about the repository state, an external library's behavior, or any fact required to correctly scope a task, stop and produce a verification task rather than guess. Verified facts recorded in `bot-verification.md` are canonical. Do not re-litigate them.

### Test batching

Never run unfiltered tests. Every test file belongs to exactly one batch. The batch manifest is at `packages/bot/tests/batch-manifest.toml`. Each batch runs in under 60 seconds. `pnpm check-batches` enforces the manifest invariant.

### Visual verification presentation

When a task captures a screenshot or video, present the image in the chat response using this exact format:

```

I've inspected the frontend changes visually:
[Frontend verification image]

```

Also state the artifact file paths. This applies to every task that captures visual artifacts.

### Naming conventions

Do not include the words "Jules", "phase", "task", or "step" in any branch name, commit message, tag, or file name. Use descriptive names.

Good: `descriptive-name`, `Add settings encryption to bot runtime`
Bad: `phase-26`, `Jules task`, `Task 26 done`

Rule of thumb: A reader six months from now should understand the change from the branch name and subject alone.
