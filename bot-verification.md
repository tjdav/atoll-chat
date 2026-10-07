# Bot SDK Verification Log (@atoll/bot)

## Task B-034 Verification Fact
- **Mock Server Implementation (`packages/bot/src/testing/mock-server.js`)**:
  - The mock server double lives at `packages/bot/src/testing/mock-server.js` exporting factory `createMockServer`.
  - `createMockServer` returns a started Node `http` server on `127.0.0.1` (ephemeral port 0 by default) exposing `getUrl`, `getPort`, `requests`, `setResponse`, `setHandler`, `sseEmit`, and `close`.
  - Implements standard default handlers for eleven endpoints: `GET /capabilities`, `GET /api/v1/bots/:id`, `POST /sockudo/auth`, `GET /api/v1/bots/me/settings`, `POST /api/v1/bots/me/messages`, `POST /api/v1/bots/me/commands/:id/ack`, `POST /api/v1/bots/me/pause`, `POST /api/v1/rooms/:id/bot-messages`, `GET /api/v1/kt/user/:id`, `GET /api/v1/rooms/:id/observer-stream`, and `POST /api/v1/rooms/:id/bot-commands`.
  - Request recording records every request (including 404s) into `requests` array capturing `method`, `path`, `query`, `headers`, `body`, and parsed `json`.
  - Override precedence evaluates in order: `onRequest` callback > `setHandler` > `setResponse` > default endpoint handler.
  - `validateCrypto: true` mode verifies Ed25519 signatures on `POST /rooms/:id/bot-messages` and `POST /rooms/:id/publisher-key` using signing primitives from `crypto/signing.js` (`verify`, `encodeBotMessagePayload`, `encodePublisherKeyPayload`), performing base64url and minimum wire-length checks. Rejects invalid signatures or shapes with status 400 and error envelope `{ error: 'signature_invalid' }` or `{ error: 'invalid_request' }`.
  - Does not verify HKDF outputs, publisher key derivations, or Key Transparency inclusion proofs (out of scope for mock server double).
  - SSE stream management (`GET /observer-stream`) writes `retry: 1000` header on stream open and dispatches test-injected events via `sseEmit`. `Last-Event-ID` replay is not implemented.
  - `close()` is idempotent and destroys active SSE streams before closing the HTTP server.
  - **Spec Gap 1 (endpoint list)**: §13.3 states "implements every bot-facing endpoint" but does not enumerate them. The mock implements the eleven endpoints used by the runtime and test suite.
  - **Spec Gap 2 (validation depth)**: §13.3 specifies `validateCrypto: true` verifies signatures and parses wire formats without defining depth. The mock performs Ed25519 signature and length verification on `bot-messages` and `publisher-key`, omitting HKDF output verification, publisher key derivations, and KT inclusion proofs.
  - Registered `mock-server` batch (46 unit test cases in `packages/bot/tests/unit/mock-server.test.js`) in `packages/bot/tests/batch-manifest.toml`.

## Task B-033 Verification Fact
- **Implement `createTestCtx` and `@atoll/bot/testing` (`packages/bot/src/testing/create-test-ctx.js` & `packages/bot/src/testing/index.js`)**:
  - The testing entry point is `packages/bot/src/testing/index.js` re-exporting `createTestCtx`. Package export condition `./testing` created by B-001 was verified intact in `package.json`.
  - `createTestCtx` returns a `BotCtx` with `calls` tracking five capture arrays: `post`, `reply`, `sendLocal`, `fetch`, and `fetchUserUrl`.
  - Response methods `post` and `reply` produce `MessageRef`s with per-instance monotonic IDs in `m_test_<n>` format. `sendLocal` captures arguments and resolves `undefined`.
  - In-memory `settings` store implements the `key` or `room:{room_id}:{key}` storage-key convention from B-025 §2.
  - In-memory `storage` store accepts any key by default and rejects `_runtime:` prefixed keys with `StorageReservedPrefixError` when `strictStorage: true` is passed.
  - In-memory `rooms` store returns shallow copies of `roomsList` and matches `get(roomId)`.
  - `ctx.log` is a no-op by default; tests replace `ctx.log` with a spy after construction.
  - **Spec Gap 1 (fetch capture)**: §13.1 names only `post`, `reply`, and `sendLocal` as captured methods. `createTestCtx` adds `fetch` and `fetchUserUrl` capture arrays and a `fetchResponse` override (accepting a static `Response` or dynamic function callback).
  - **Spec Gap 2 (settings and storage shape)**: §13.1 does not describe the in-memory settings and storage shapes. Implemented using `Map<string, unknown>` and the storage-key resolution rules from B-025 §2.
  - **Spec Gap 3 (reserved-prefix behavior)**: §13.1 does not describe reserved-prefix rejection behavior for test stores. Implemented as opt-in via `strictStorage: true`.
  - Registered `create-test-ctx` batch (54 unit test cases in `packages/bot/tests/unit/create-test-ctx.test.js`) in `packages/bot/tests/batch-manifest.toml`.

## Task B-031 Verification Fact
- **Reconnect Controller & Runtime Wiring (`packages/bot/src/runtime/reconnect.js` & `packages/bot/src/runtime/index.js`)**:
  - The reconnect controller lives at `packages/bot/src/runtime/reconnect.js` exporting `computeBackoffDelay` and `createReconnectController`.
  - **Backoff & Jitter:** `computeBackoffDelay` computes exponential backoff `min(baseBackoffMs * 2^(attempt-1), maxBackoffMs)` with proportional symmetric jitter `± jitter * base` clamped to `[0, max * (1 + jitter)]`.
  - **Stability Threshold & Reconnect Loop:** A WebSocket connection lasting >= `stableConnectionMs` (default 5000ms) resets attempt counter to 0; shorter drops continue counter. Post-reconnect sequence refreshes settings (`settingsStore.refresh()`) and re-verifies publisher keys (`publisherKeys.reverifyAll()`).
  - **Per-Room SSE Streams:** SSE room stream entries persist in `subscriptions` registry across closes with `connected: false`. `onClose` calls `notifySseClosed(roomId)` on the controller, driving per-room exponential backoff and coalescing rapid close notifications.
  - **Cancellable Sleep & Stop Lifecycle:** `cancellableSleep` races sleep against a cancel Promise; `stop()` cancels pending sleeps immediately and unhooks close listeners idempotently before WebSocket teardown during runtime `stop()`.
  - **Recorded Spec Gap 1**: The outbound queue described in §14.7 step 5 is an architectural vestige. All outbound messages use B-017's HTTP client with `retry: true`; no queue exists to replay.
  - **Recorded Spec Gap 2**: §14.7 omits observer-mode SSE stream reconnection. Handled per-room with room-scoped backoff counters and `Last-Event-ID` resume.
  - **Recorded Spec Gap 3**: No bot-facing grants endpoint exists (§14.7 step 2). Refetch is skipped with a warning log.
  - Registered `reconnect` (28 unit tests in `packages/bot/tests/unit/reconnect.test.js`) and `runtime-reconnect` (10 integration tests in `packages/bot/tests/unit/runtime-reconnect.test.js`) batches in `packages/bot/tests/batch-manifest.toml`.

## Task B-030 Verification Fact
- **Pause-on-Failure Policy (`packages/bot/src/runtime/pause-policy.js`)**:
  - The pause policy module resides at `packages/bot/src/runtime/pause-policy.js` exporting `createPausePolicy`. Added `PausedError` (code `bot_paused`, name `PausedError`) to `packages/bot/src/errors.js` (Amends Spec §12).
  - **Parameters & Policy Behavior:** Reaching threshold 3 consecutive handler failures within 60,000 ms enters paused state permanently for the process lifetime. A success resets the counter; a failure occurring > 60,000 ms after the streak anchor starts a new streak.
  - **Pause Reporting & Spec Gap:** On entering paused state, `createPausePolicy` fires `reportPause({ threshold, window_ms, first_failure_at })` exactly once fire-and-forget. Runtime stubs `reportPause` to send `POST /api/v1/bots/me/pause` via HTTP client (**Spec Gap**: pause reporting server endpoint omitted from Server §8; stub request fails and is logged without interrupting pause state).
  - **Dispatch Outputs:** Dispatches are routed via `pausePolicy.guard(fn)`: command dispatches produce a `local_message` informing that the bot is paused, webhooks return HTTP 503 `bot_paused`, cron fires skip execution without updating `last_fire`, and room events skip execution with a debug log.
  - **Testing & Batches:** 20 unit test cases in `packages/bot/tests/unit/pause-policy.test.js` (`pause-policy` batch) and 10 integration test cases in `packages/bot/tests/unit/runtime-pause.test.js` (`runtime-pause` batch). Added pause cases to `ctx-command-invoked.test.js`, `webhook-server.test.js`, and `cron-engine.test.js`.
- **Verification Results**:
  - `pnpm --filter @atoll/bot check-batches` passed (status 0).
  - `node packages/bot/tests/manifest-check.js --batch pause-policy` passed (20 passing, status 0).
  - `node packages/bot/tests/manifest-check.js --batch runtime-pause` passed (10 passing, status 0).

## Task B-001 Verification Fact
- **Starting State Classification**: Case A (Workspace files `tsconfig.base.json` and `packages/bot/` absent).
- **Workspace Tooling Setup**:
  - `package.json` at root created/updated declaring `private: true`, `packageManager: "pnpm@10.30.3"`, and root `devDependencies` (`typescript`, `eslint`, `@types/node`, `@stylistic/eslint-plugin`, `eslint-plugin-html`, `eslint-plugin-import`, `eslint-plugin-jsdoc`).
  - `pnpm-workspace.yaml` declares `packages/*`.
  - `tsconfig.base.json` created verbatim per bot spec §2.1 (`strict: true`, `checkJs: true`, `allowJs: true`, `exactOptionalPropertyTypes: true`, `noUncheckedIndexedAccess: true`, `noImplicitOverride: true`, `noFallthroughCasesInSwitch: true`, `verbatimModuleSyntax: true`, `types: ["node"]`).
- **@atoll/bot Package Skeleton**:
  - `packages/bot/package.json` created matching bot spec §2 verbatim with zero `dependencies` and zero `devDependencies`.
  - `packages/bot/tsconfig.json` extends `../../tsconfig.base.json`.
  - `packages/bot/tsconfig.build.json` extends `./tsconfig.json` emitting declarations to `./dist`.
  - `packages/bot/eslint.config.js` extends `../../eslint.config.js` with `import/no-restricted-paths` and `import/enforce-node-protocol-usage`.
  - `packages/bot/src/index.js` and executable `packages/bot/src/cli.js` created as stubs.
- **Verification Results**:
  - `pnpm --filter @atoll/bot typecheck` passed (status 0).
  - `pnpm --filter @atoll/bot lint` passed (status 0).
  - `pnpm --filter @atoll/bot build` passed (status 0).

## Task B-002 Verification Fact
- **Public Type Surface (`src/types.js`)**:
  - Authored JSDoc-only script file at `packages/bot/src/types.js` containing all 35 public typedef declarations from §3 of the spec verbatim.
  - Script file contains zero imports, zero exports (`export {}`), and zero runtime code (`const`, `let`, `var`, `function`, `class`).
  - Emitted `packages/bot/dist/types.d.ts` contains the typedefs as global declarations, allowing downstream JSDoc to reference them by bare name (e.g. `Capability`, `Mode`, `BotCtx`).
- **Verification Results**:
  - `pnpm --filter @atoll/bot typecheck` passed (status 0).
  - `pnpm --filter @atoll/bot lint` passed (status 0).
  - `pnpm --filter @atoll/bot build` passed (status 0).

## Task B-003 Verification Fact
- **Bot Error Hierarchy (`src/errors.js`)**:
  - Authored ES module at `packages/bot/src/errors.js` defining `BotError` base class extending `Error` and all 20 error subclasses matching spec §12.
  - Class-field initialization order operates correctly: subclass `name` and `code` fields override base constructor values post-`super()`.
  - Standard `ErrorOptions` (e.g., `{ cause }`) pass through `super(message, options)` preserving `err.cause` chain intact.
- **Verification Results**:
  - `pnpm --filter @atoll/bot typecheck` passed (status 0).
  - `pnpm --filter @atoll/bot lint` passed (status 0).
  - Runtime verification script confirmed all 20 subclass codes, instanceof isolation, cause propagation, and zero duplicate error codes.

## Task B-004 Verification Fact
- **Identity Factories (`defineSettings`, `defineCommand`, `defineCommands`, `defineTrigger`)**:
  - Authored identity factory ES modules at `packages/bot/src/define-settings.js`, `packages/bot/src/define-command.js`, `packages/bot/src/define-commands.js`, and `packages/bot/src/define-trigger.js` containing JSDoc signatures and single named exports verbatim per spec §4.1–§4.4.
  - Confirmed the four factories are callable as identity functions from an ES module context and return their arguments unchanged (`===` identity equality).
- **Verification Results**:
  - `pnpm --filter @atoll/bot lint` passed (status 0).
  - Runtime verification script confirmed ES module exports and identity behavior (`all checks passed`).

## Task B-004a Verification Fact
- Under `tsconfig.base.json` with `"module": "es2022"` and `"moduleResolution": "bundler"`, the JSDoc typedefs declared in `src/types.js` are visible by bare name in every other file of the package. A probe file referencing `SettingDecl` by bare name typechecks without an `import` statement.
- ESLint's `jsdoc/no-undefined-types` does not use TypeScript's type resolution. It requires an explicit `definedTypes` list. The list is populated in the root ESLint config with the full set of typedef names from `src/types.js`.
- All public JSDoc carries descriptions. Every `@param`, `@returns`, and `@property` tag has a description after its type, separated by ` - ` (space, hyphen, space). The description rules remain enabled at workspace scope. `jsdoc/require-hyphen-before-param-description` is set to `'always'`.

## Task B-005 Verification Fact
- **Top-Level Factory and Configuration Validation (`src/define-bot.js`)**:
  - Authored `packages/bot/src/define-bot.js` exporting `defineBot` and runtime `HOST_API_VERSION` constant (`'1.0'`).
  - `validateConfig` is internal (not exported) and collects all configuration failures per spec §4.6 before throwing a `ValidationError` (`code === 'validation_error'`).
  - Validation failure message builds a newline-separated list with two-space indentation and `- ` prefixes.
- **Verification Results**:
  - `pnpm --filter @atoll/bot typecheck` passed (status 0).
  - `pnpm --filter @atoll/bot lint` passed (status 0).
  - `pnpm --filter @atoll/bot build` passed (status 0).
  - Node.js runtime smoke test passed (`all checks passed`).

## Task B-006 Verification Fact
- **Type Canaries (`tests/canary/settings.js`, `tests/canary/args.js`)**:
  - Authored canary files at `packages/bot/tests/canary/settings.js` and `packages/bot/tests/canary/args.js` verifying indexed-access extraction and sibling-contextual substitution.
  - The two canaries pass cleanly under `pnpm --filter @atoll/bot typecheck` (`tsc --noEmit`).
  - Performed mutation check: widening `ArgKind` to `string` in `packages/bot/src/types.js` caused `tests/canary/args.js` to fail with `Unused '@ts-expect-error' directive` on the `'banana'` annotation, confirming canary sensitivity. Reverted mutation.
  - The canary files are type-checked by `pnpm --filter @atoll/bot typecheck` and `pnpm --filter @atoll/bot lint`, and are not executed as runtime unit tests.
- **Verification Results**:
  - `pnpm --filter @atoll/bot typecheck` passed (status 0).
  - `pnpm --filter @atoll/bot lint` passed (status 0).

## Task B-007 Verification Fact
- **Batch Manifest and Enforcement Scripts**:
  - Authored `packages/bot/tests/batch-manifest.toml` containing `[meta]` (`max_batch_seconds = 60`) and initial zero active batches.
  - Authored zero-dependency inline TOML parser and enforcement script at `packages/bot/tests/manifest-check.js` validating four invariants: disk-in-batch, batch-in-disk, unique batch names (`^[a-z][a-z0-9-]*$`), and well-formed TOML.
  - Authored runner `packages/bot/tests/run-all-batches.js` executing batches sequentially with budget overrun warnings and empty-batch skipping.
  - The scripts `check-batches`, `test:batch`, and `test:all` are the supported entry points for tests. `test:unit` and `test:integration` no longer exist.
- **Verification Results**:
  - `pnpm --filter @atoll/bot check-batches` passed (status 0).
  - Runtime self-test confirmed detection of unbatched files and duplicate batch entries.
  - `pnpm --filter @atoll/bot typecheck`, `lint`, `test`, and `build` passed cleanly (status 0).

## Task B-008 Verification Fact
- **Keystore Core Architecture**:
  - Authored `packages/bot/src/runtime/keystore/crypto.js`: scrypt key derivation (N=2^17, r=8, p=1, maxmem=256 MiB) and AES-256-GCM encryption/decryption with 12-byte nonces.
  - Authored `packages/bot/src/runtime/keystore/schema.js`: `validateOuter` and `validatePlaintext` for outer and inner JSON schema validation with descriptive error reasons.
  - Authored `packages/bot/src/runtime/keystore/resolvers/index.js` and `env.js`: resolver chain execution runner and `envResolver`.
  - Authored `packages/bot/src/runtime/keystore/index.js`: `Keystore` class and `createKeystore` free function. Outer file structure includes plaintext `bot_id` per spec amendment §14.9. File mode is strictly `0o600` on write.
  - `Keystore.load` distinguishes `KeystoreLockedError` (missing secret/file or invalid secret/tag) from `KeystoreCorruptError` (invalid JSON, outer/inner schema validation failures, bot_id mismatch).
  - `Keystore.save` regenerates fresh salt and nonce on every save.
  - Registered `keystore` batch in `packages/bot/tests/batch-manifest.toml` and implemented unit tests in `packages/bot/tests/unit/keystore.test.js` covering all 14 required cases.
- **Verification Results**:
  - `pnpm --filter @atoll/bot typecheck` passed (status 0).
  - `pnpm --filter @atoll/bot lint` passed (status 0).
  - `pnpm --filter @atoll/bot check-batches` passed (status 0).
  - `pnpm --filter @atoll/bot test` passed (status 0).
  - `pnpm --filter @atoll/bot build` passed (status 0).

## Task B-028 Verification Fact
- **Cron Schedule Trigger Engine (`packages/bot/src/runtime/triggers/cron.js`)**:
  - Lives at `packages/bot/src/runtime/triggers/cron.js` exporting `createCronEngine`, `parseCron`, and `nextFireTime`.
  - The cron grammar parses five space-separated fields (`minute`, `hour`, `dayOfMonth`, `month`, `dayOfWeek`), supporting wildcards `*`, values `n`, ranges `n-m`, steps `n-m/s` and `*/s`, and lists `n,m`. Normalizes day-of-week 7 to 0. Rejects invalid field counts, malformed ranges, step 0, out-of-range values, and unknown characters with descriptive field error messages.
  - `nextFireTime` computes the next fire strictly after the baseline date in the given IANA timezone using `Intl.DateTimeFormat`. Applies standard cron OR-when-both-restricted rule for day-of-month and day-of-week. DST skipped hours advance to the next valid minute (producing no fire on transition day); DST repeated hours fire once. Exceeding a 5-year search limit throws.
  - `createCronEngine` accepts dependencies `config`, `triggers`, `makeBotCtx`, `idempotency`, `stateStore` (`get`/`set`), optional `sleep`, `now`, `logger`, `handlerTimeoutMs`.
  - Zero schedule triggers makes `start()` a no-op. Invalid triggers (expression or timezone) are skipped during `start()` with warning logs.
  - State key `_runtime:cron:<name>:last_fire` stores the ISO timestamp of the last successful dispatch.
  - Catch-up (`config.catchUp === true`) evaluates missed windows between `last_fire` and `now()`, bounded by `MAX_CATCH_UP_FIRES` (100, keeping the most recent and logging a warning on overflow).
  - Deduplication uses `idempotency.checkAndRecord('<name>:<scheduledAt>')`. Handler failures log an error and leave the idempotency key intact (at-most-once semantics).
  - `fireNow(name)` dispatches immediately, bypassing idempotency, and awaits the handler.
  - `stop()` cancels all pending sleep timers and awaits in-flight handler dispatches.
  - Registered `cron-engine` batch in `packages/bot/tests/batch-manifest.toml` and authored 56 unit test cases in `packages/bot/tests/unit/cron-engine.test.js`.
- **Verification Results**:
  - `pnpm --filter @atoll/bot typecheck` passed (status 0).
  - `pnpm --filter @atoll/bot lint` passed (status 0).
  - `pnpm --filter @atoll/bot check-batches` passed (status 0).
  - `pnpm --filter @atoll/bot test` passed (status 0).
  - `pnpm --filter @atoll/bot build` passed (status 0).

## Task B-026 Verification Fact
- **StorageStore and RoomsStore (`packages/bot/src/runtime/context/storage.js` & `rooms.js`)**:
  - `StorageStore` lives at `packages/bot/src/runtime/context/storage.js`. It wraps B-009's `Storage` and rejects `_runtime:` prefixed keys with `StorageReservedPrefixError` (`storage_reserved_prefix`). Keys are validated as non-empty strings (`TypeError`). `clear()` delegates directly to `storage.clear()` and preserves `_runtime:` keys.
  - `RoomsStore` lives at `packages/bot/src/runtime/context/rooms.js`. It takes an injected `fetchRoomList` callback and performs no caching. Every `list()` or `get(roomId)` call fetches fresh.
  - `RoomRef` mapping: `displayName` defaults to `null` when server omits `display_name`; `memberCount` defaults to `0` when server omits `member_count`.
  - Non-array responses from `fetchRoomList` log a warning (`non_array_response`) and return `[]`. Entries without valid non-empty string `id` are skipped with a warning log (`missing_room_id`).
  - **Spec Gap 1 (rooms) Recorded**: Server §8.4 provides no bot-facing room list endpoint (`GET /rooms` or `GET /bots/me/rooms`). The `fetchRoomList` callback is injected as a dependency until an endpoint is settled.
  - **Spec Gap 2 (rooms) Recorded**: `RoomRef.displayName` comes from encrypted room metadata (`rooms.metadata`), which non-member bots cannot decrypt.
  - **Spec Gap 3 (rooms) Recorded**: `RoomRef.memberCount` requires room membership (`GET /rooms/:id/members`), unavailable to write-only/observer bots.
  - Registered `ctx-storage` (13 unit tests in `packages/bot/tests/unit/ctx-storage.test.js`) and `ctx-rooms` (18 unit tests in `packages/bot/tests/unit/ctx-rooms.test.js`) batches in `packages/bot/tests/batch-manifest.toml`.
- **Verification Results**:
  - `pnpm --filter @atoll/bot typecheck` passed (status 0).
  - `pnpm --filter @atoll/bot lint` passed (status 0).
  - `pnpm --filter @atoll/bot check-batches` passed (status 0).
  - `pnpm --filter @atoll/bot test` passed (status 0).
  - `pnpm --filter @atoll/bot build` passed (status 0).

## Task B-024 Verification Fact
- **Outbound Fetch Methods (`packages/bot/src/runtime/context/fetch.js`)**:
  - The fetch methods live at `packages/bot/src/runtime/context/fetch.js` exporting `createFetchMethods` and `stripQuery`.
  - `ctx.fetch` and `ctx.fetchUserUrl` are returned as separate functions. `fetchUserUrl` log lines include `on_behalf_of: 'user'` in `meta` for diagnostic tracking.
  - `stripQuery` strips query strings and fragments via `URL` parsing, falling back to textual stripping after `?` or `#` for malformed URLs.
  - Scheme validation rejects non-`http(s)` schemes with `TypeError` (e.g., `file:`, `data:`, `ws:`). Malformed URLs or non-string URLs throw `TypeError`.
  - Non-2xx HTTP responses do not throw. Network/connection errors propagate unchanged.
  - Log lines never include headers, request bodies, or response bodies. `has_body`, `duration_ms`, and stripped `url` are logged in `meta`.
  - Callers pass `opts.signal` for cancellation; no default timeout or `ctx.signal` chaining is applied.
  - No SSRF guards, response-size caps, or redirect validations are applied.
  - **Spec Gap 1 Recorded**: `fetchUserUrl`'s distinct semantics are not specified. This task treats it as an alias of `fetch` with a diagnostic tag `on_behalf_of: 'user'`.
  - **Spec Gap 2 Recorded**: No SSRF guarding is specified or implemented for bot outbound fetch. Server extension proxy (§5.31) is client-side extension egress only, not wired for bots.
  - **Spec Gap 3 Recorded**: No default timeout is specified for outbound fetch. Callers supply their own signal.
  - Registered `ctx-fetch` batch in `packages/bot/tests/batch-manifest.toml` and authored 34 unit tests in `packages/bot/tests/unit/ctx-fetch.test.js` using real `node:http` servers.
- **Verification Results**:
  - `pnpm --filter @atoll/bot typecheck` passed (status 0).
  - `pnpm --filter @atoll/bot lint` passed (status 0).
  - `pnpm --filter @atoll/bot check-batches` passed (status 0).
  - `pnpm --filter @atoll/bot test` passed (status 0).
  - `pnpm --filter @atoll/bot build` passed (status 0).

## Task B-022 Verification Fact
- **Send Local Handler (`packages/bot/src/runtime/context/send-local.js`)**:
  - The `ctx.sendLocal` handler lives at `packages/bot/src/runtime/context/send-local.js` exporting `createSendLocalHandler`.
  - Uses info string `"bot-command-result-v1"` and wire format `nonce(12) || ct || tag(16)` from B-015 (`command-result.js`), as owner-targeted local messages travel the same channel as command results.
  - Posts request body `{ target: 'owner', result_type: 'local_message', ciphertext, bot_result_pubkey, request_id }` to `POST /bots/me/messages` with `retry: false`.
  - Added `SendLocalFailedError` (code `send_local_failed`) to `src/errors.js`, amending Spec §12.
  - Retry policy enforces `retry: false`. 429 status retries via HTTP client (B-017); 5xx and network failures surface immediately wrapped in `SendLocalFailedError`.
  - **Spec Gap 1 Recorded**: Owner pubkey transport via synthetic `__owner_local__` command (Spec §6.3) is interim and marked for removal. `createSendLocalHandler` takes injected dependency `getOwnerPubkey`; B-029 handles runtime wiring.
  - **Spec Gap 2 Recorded**: Spec §12 omitted an error class for `ctx.sendLocal` failures. Added `SendLocalFailedError` with code `send_local_failed`.
  - **Spec Gap 3 Recorded**: Spec §6.3 omits the response body shape of `POST /bots/me/messages`. The body is ignored and the handler resolves `Promise<void>`.
  - Registered `ctx-send-local` batch in `packages/bot/tests/batch-manifest.toml` and authored 25 unit tests in `packages/bot/tests/unit/ctx-send-local.test.js`.
- **Verification Results**:
  - `pnpm --filter @atoll/bot typecheck` passed (status 0).
  - `pnpm --filter @atoll/bot lint` passed (status 0).
  - `pnpm --filter @atoll/bot check-batches` passed (status 0).
  - `pnpm --filter @atoll/bot test` passed (status 0).
  - `pnpm --filter @atoll/bot build` passed (status 0).

## Task B-023 Verification Fact
- **Command Invocation & Result Dispatch (`packages/bot/src/runtime/context/command-invoked.js`)**:
  - The command invocation handler lives at `packages/bot/src/runtime/context/command-invoked.js` exporting `createCommandInvocationHandler`, `dispatchCommandResult`, and `COMMAND_INFO = 'bot-command-v1'`.
  - Wire format matches settings: `ephemeral_pub(32) || nonce(12) || ct || tag(16)` (base64url).
  - Plaintext shape matches `{ command_name, args, ephemeral_result_pubkey }` where `ephemeral_result_pubkey` is a 32-byte base64url string.
  - Argument reader validation rejects missing required arguments, wrong-type arguments, out-of-options select values, and undeclared extra arguments.
  - Handler never throws on invocation processing: decryption failures, malformed plaintext, unknown commands, argument validation errors, `makeBotCtx` failures, handler exceptions, and handler timeouts produce error logs or `local_message` responses and always issue command ack.
  - Command ack (`safeAck`) and result dispatch (`safeDispatchResult`) swallow exceptions and log warnings/errors without interrupting execution.
  - Result dispatch routes `local_message`, `toast`, and `panel` to `POST /bots/me/messages` with `target: 'invoker'`, routes `room_message` to `ctx.post`, and treats `none` as a no-op.
  - **Spec Gap 1 Recorded**: Spec §6.31 does not name the info string for command encryption. Code assumes `COMMAND_INFO = 'bot-command-v1'`.
  - **Spec Gap 2 Recorded**: Spec does not specify command ciphertext wire format. Code assumes settings format (`ephemeral_pub(32) || nonce(12) || ct || tag(16)`).
  - **Spec Gap 3 Recorded**: Spec does not specify command plaintext shape. Code assumes `{ command_name, args, ephemeral_result_pubkey }`.
  - **Spec Gap 4 Recorded**: Spec does not specify argument validation failure handling. Code returns `local_message` to invoker describing failure without invoking handler.
  - **Spec Gap 5 Recorded**: Spec does not specify command ack timing. Code acks after dispatch (or after failure path execution) to prevent redelivery of processed commands.
  - Registered `ctx-command-invoked` batch in `packages/bot/tests/batch-manifest.toml` and authored 31 unit tests in `packages/bot/tests/unit/ctx-command-invoked.test.js`.
- **Verification Results**:
  - `pnpm --filter @atoll/bot typecheck` passed (status 0).
  - `pnpm --filter @atoll/bot lint` passed (status 0).
  - `pnpm --filter @atoll/bot check-batches` passed (status 0).
  - `pnpm --filter @atoll/bot test` passed (status 0).
  - `pnpm --filter @atoll/bot build` passed (status 0).

## Task B-018 Verification Fact
- **WebSocket Transport (`packages/bot/src/runtime/transport/websocket.js`)**:
  - The WebSocket transport lives at `packages/bot/src/runtime/transport/websocket.js` exporting `createWebSocketClient`.
  - The client speaks Pusher Protocol v7 over Node 22's global `WebSocket` without added dependencies.
  - Connection URL construction is `<socketUrl>/app/<appKey>?protocol=7&client=<clientName>&version=<clientVersion>`.
  - `connect()` completes handshake (`pusher:connection_established`) and is idempotent.
  - Subscriptions are tracked by channel name and re-established on every successful connect. Multiple handlers per channel share a single subscription; `pusher:unsubscribe` is sent when the last handler for a channel unsubscribes.
  - Ping/pong liveness checks send `pusher:ping` at `pingIntervalMs` intervals; pong timeouts close the socket with code `4000` (`"pong timeout"`).
  - Auth failures emit `error` lifecycle events and do not block subscriptions to other channels.
  - `close()` sends unsubscribes for active tracked channels, closes the socket, and resolves idempotently on socket close.
  - **Server Spec Gap Recorded**: Server §5.19 configures Sockudo with `SOCKUDO_APP_KEY=auto`, but neither the public Sockudo URL nor the app key appears in Server §8.1's capabilities response or Bot §14.2 config. `socketUrl` and `appKey` are constructor parameters supplied by B-029 once server exposes them.
  - **Server Spec Gap Recorded**: Pusher Protocol v7 requires a signed `auth` field in `pusher:subscribe` for private channels, but Server §8 does not list a Sockudo auth endpoint. `authCallback` is a constructor parameter wired by B-029.
  - Registered `websocket` batch in `packages/bot/tests/batch-manifest.toml` and authored unit test suite in `packages/bot/tests/unit/websocket.test.js` covering all 30 required scenarios.
- **Verification Results**:
  - `pnpm --filter @atoll/bot typecheck` passed (status 0).
  - `pnpm --filter @atoll/bot lint` passed (status 0).
  - `pnpm --filter @atoll/bot check-batches` passed (status 0).
  - `pnpm --filter @atoll/bot test` passed (status 0).
  - `pnpm --filter @atoll/bot build` passed (status 0).

## Task B-017 Verification Fact
- **HTTP Client Transport (`packages/bot/src/runtime/transport/http.js`)**:
  - Authored `packages/bot/src/runtime/transport/http.js` exporting `createHttpClient`.
  - Authored spec amendment in `packages/bot/src/errors.js` adding `HttpRequestError` (code `http_request_failed`) carrying `status`, `url`, `method`, `body`, and `responseErrorCode`.
  - `createHttpClient` enforces factory-time validation: `serverUrl` must be a non-empty, valid absolute URL with scheme `http` or `https`; `botToken` must be a non-empty string.
  - The client forces `Authorization: Bearer <botToken>`, `User-Agent`, and `Accept: application/json` headers on all requests. Caller-supplied `Authorization` is ignored and overwritten.
  - Plain objects and arrays are JSON-stringified; `string` and `Uint8Array` bodies are sent as-is.
  - Response parsing parses JSON when `Content-Type` includes `application/json`; empty body (204 or `Content-Length: 0`) produces `null`; non-JSON is returned as a string.
  - 429 retries unconditionally and respects `Retry-After` (parsed as seconds or HTTP-date, clamped to `maxRetryAfterMs` [default 60,000ms]).
  - 5xx and network/timeout failures retry only when `retry: true` option is set.
  - Non-429 4xx errors do not retry.
  - Debug logs emit retry lines (`msg: 'http retry'`) with query strings stripped from paths.
  - Registered `http` batch in `packages/bot/tests/batch-manifest.toml` and authored 30 unit tests in `packages/bot/tests/unit/http.test.js` using local `node:http` servers.
- **Verification Results**:
  - `pnpm --filter @atoll/bot typecheck` passed (status 0).
  - `pnpm --filter @atoll/bot lint` passed (status 0).
  - `pnpm --filter @atoll/bot check-batches` passed (status 0).
  - `pnpm --filter @atoll/bot test` passed (status 0).
  - `pnpm --filter @atoll/bot build` passed (status 0).

## Task B-008a Verification Fact
- **OS Keychain Resolvers (`packages/bot/src/runtime/keystore/resolvers/keychain.js`)**:
  - The keychain entry identification convention uses service `atoll-bot` and account `<bot_id>`. The Windows target name is `atoll-bot:<bot_id>`.
  - Windows retrieval uses PowerShell with an inline P/Invoke to `CredRead` from `advapi32.dll`. The spec's reference to `cmdkey` is amended because `cmdkey` cannot retrieve passwords.
  - The runner defaults to a 10-second timeout (`timeoutMs: 10_000`).
  - Every runner failure or error defers silently by returning `null`. The resolver never throws.
  - Registered `keychain-resolver` batch in `packages/bot/tests/batch-manifest.toml` and implemented unit tests in `packages/bot/tests/unit/keychain-resolver.test.js` covering all 13 required cases using synthetic runner injection without invoking real OS binaries.
- **Verification Results**:
  - `pnpm --filter @atoll/bot typecheck` passed (status 0).
  - `pnpm --filter @atoll/bot lint` passed (status 0).
  - `pnpm --filter @atoll/bot check-batches` passed (status 0).
  - `pnpm --filter @atoll/bot test` passed (status 0).
  - `pnpm --filter @atoll/bot build` passed (status 0).

## Task B-008b Verification Fact
- **Interactive Prompt Resolver & Keychain Writer (`packages/bot/src/runtime/keystore/resolvers/prompt.js` & `keychain-write.js`)**:
  - Prompt resolver (`promptResolver`) executes only when `ctx.interactive === true`; otherwise it defers immediately (`null`).
  - Upon successful passphrase entry, the prompt resolver invokes the keychain writer best-effort (`writer(ctx.botId, secret)`), swallowing any keychain store failure so the current process run proceeds smoothly.
  - Default terminal reader (`defaultReader`) writes the prompt to `stderr` and uses `process.stdin` in raw mode with UTF-8 `StringDecoder` and per-character `*` masking. Rejects when `!process.stdin.isTTY` or on abort signals (Ctrl+C / Ctrl+D). Restores raw mode state and pauses stdin in `finally`.
  - macOS write path passes password on stdin to `/usr/bin/security add-generic-password -s atoll-bot -a <bot_id> -U -w`.
  - Linux write path passes password on stdin to `secret-tool store --label "Atoll bot <bot_id>" service atoll-bot account <bot_id>`.
  - Windows write path passes password on stdin to `powershell.exe -NoProfile -NonInteractive -EncodedCommand <base64-utf16le>` with P/Invoke to `CredRead` (`CRED_TYPE_GENERIC`, `CRED_PERSIST_LOCAL_MACHINE`). Password is never passed in command args.
  - Registered `prompt-resolver` (9 unit tests) and `keychain-write` (11 unit tests) batches in `packages/bot/tests/batch-manifest.toml`.
- **Verification Results**:
  - `pnpm --filter @atoll/bot typecheck` passed (status 0).
  - `pnpm --filter @atoll/bot lint` passed (status 0).
  - `pnpm --filter @atoll/bot check-batches` passed (status 0).
  - `pnpm --filter @atoll/bot test` passed (status 0).
  - `pnpm --filter @atoll/bot build` passed (status 0).

## Task B-009 Verification Fact
- **Encrypted Storage Backend (`packages/bot/src/runtime/storage/`)**:
  - Storage key derivation (`deriveStorageKey` in `crypto.js`) uses HKDF-SHA256 (`info: 'bot-storage-v1'`, 32 bytes output, `salt: undefined`) over the keystore's 32-byte `storage_seed`. Spec §9's reference to "MLS identity private key" is amended to `storage_seed`.
  - Storage file format is JSON `{ version: 1, bot_id, nonce, ct }` with `bot_id` serving as a plaintext pre-decryption cross-check.
  - `open()` handles missing files (`ENOENT` -> empty map), corrupt JSON, unsupported outer version, `bot_id` mismatch, invalid base64url nonce/ct, decryption failure, and non-object plaintext with distinct error messages.
  - Reads and writes operate on an in-memory flat object map. `set`, `delete`, and `clear` serialize whole-file atomic flushes through an internal promise queue (`_writeQueue`) using `.tmp` file writes with mode `0o600` and atomic `rename`. Non-serializable values (e.g., `BigInt`) throw and roll back state.
  - Exports `RUNTIME_PREFIX = '_runtime:'`. `clear()` filters and deletes non-`_runtime:` author keys while preserving keys starting with `RUNTIME_PREFIX`. Prefix validation for individual author access operations is deferred to wrapper task B-026.
  - Registered `storage` batch in `packages/bot/tests/batch-manifest.toml` and authored 18 test cases in `packages/bot/tests/unit/storage.test.js` verifying all 17 required cases in spec §9 plus schema/ct error coverage.
- **Verification Results**:
  - `pnpm --filter @atoll/bot typecheck` passed (status 0).
  - `pnpm --filter @atoll/bot lint` passed (status 0).
  - `pnpm --filter @atoll/bot check-batches` passed (status 0).
  - `pnpm --filter @atoll/bot test` passed (status 0).
  - `pnpm --filter @atoll/bot build` passed (status 0).

## Task B-010 Verification Fact
- **Structured Redacting Logger (`packages/bot/src/runtime/diagnostics/logger.js`)**:
  - The dev-mode signal is `process.env.NODE_ENV !== 'production'`.
  - The sink is injectable; production uses `process.stdout.write`.
  - The sensitive-key list is exported as `SENSITIVE_KEYS`. The key normalization lowercases and strips `-` and `_`.
  - The `_secret:` prefix check is literal and case-insensitive on the prefix; it does not strip separators. In dev mode (`dev === true`), encountering a `_secret:` key throws an Error naming the key. In production mode (`dev === false`), it replaces the value with `'[REDACTED]'`.
  - URL values under `url` keys parse with `URL` and strip query string (`url.search = ''`). Malformed URLs remain unchanged.
  - Serialization failures write a fallback log line (`msg: 'log serialization failed'`). Sink write failures are caught and swallowed. The logger never throws in production mode.
  - Registered `logger` batch in `packages/bot/tests/batch-manifest.toml` and authored 20 test cases in `packages/bot/tests/unit/logger.test.js`.
- **Verification Results**:
  - `pnpm --filter @atoll/bot typecheck` passed (status 0).
  - `pnpm --filter @atoll/bot lint` passed (status 0).
  - `pnpm --filter @atoll/bot check-batches` passed (status 0).
  - `pnpm --filter @atoll/bot test` passed (status 0).
  - `pnpm --filter @atoll/bot build` passed (status 0).

## Task B-011 Verification Fact
- **Idempotency Store (`packages/bot/src/runtime/idempotency/index.js`)**:
  - Trigger keys are hashed with SHA-256; storage key is `_runtime:idempotency:<sha256-base64url>` (43 characters). Spec §10.3 amended.
  - Storage key constant `STORAGE_PREFIX = '_runtime:idempotency:'` is exported. Raw trigger keys are never stored or logged.
  - Values stored are millisecond timestamps (`Date.now()` or injectable clock).
  - Operations (`check`, `record`, `checkAndRecord`, `remove`, `prune`, `clear`) are serialized through a single promise queue (`_enqueue`).
  - `checkAndRecord` is atomic within the queue.
  - Expiration boundary is inclusive (`now - value >= ttlMs`).
  - Opportunistic pruning runs in background after `pruneThreshold` (default 100) record operations; `pruneThreshold: 0` disables opportunistic pruning.
  - Implements remove-on-failure via `remove(key)` method.
  - Corrupt entries (non-number values) log a warning and are cleaned during pruning. Prune passes log `{ msg: 'idempotency prune', meta: { removed: count } }` when `removed > 0`.
  - Registered `idempotency` batch in `packages/bot/tests/batch-manifest.toml` and authored 25 unit test cases in `packages/bot/tests/unit/idempotency.test.js`.
- **Verification Results**:
  - `pnpm --filter @atoll/bot typecheck` passed (status 0).
  - `pnpm --filter @atoll/bot lint` passed (status 0).
  - `pnpm --filter @atoll/bot check-batches` passed (status 0).
  - `pnpm --filter @atoll/bot test` passed (status 0).
  - `pnpm --filter @atoll/bot build` passed (status 0).

## Task B-012 Verification Fact
- **bot.toml Reader & Config Loader (`packages/bot/src/runtime/config/`)**:
  - The config loader lives at `src/runtime/config/index.js` exporting async `loadConfig({ env, cwd } = {})`. The TOML parser lives at `src/runtime/config/toml.js` exporting `parseToml(source)`.
  - Precedence is strictly environment variable > TOML > built-in default. Empty environment variables (`""`) are treated as unset.
  - The TOML grammar is the strict subset documented in spec §14.3: line-based, no arrays, no inline tables, no datetimes, no dotted section names, no single-quoted or multi-line strings.
  - Unknown section headers or unknown key names in `bot.toml` throw explicit errors naming the offending line or key.
  - An explicitly set `ATOL_BOT_CONFIG` path that names a missing file throws an error; when `ATOL_BOT_CONFIG` is unset or empty, a missing `bot.toml` at default path is optional and defaults are used.
  - Path fields (`botConfigPath`, `keystorePath`) are resolved against `cwd` to absolute paths.
  - Field type, range, and enum validations are enforced post-merge.
  - The returned `Config` object and all nested section objects are recursively frozen using `Object.freeze`.
  - Registered `config-toml` (21 unit tests) and `config` (20 unit tests) batches in `packages/bot/tests/batch-manifest.toml`.
- **Verification Results**:
  - `pnpm --filter @atoll/bot typecheck` passed (status 0).
  - `pnpm --filter @atoll/bot lint` passed (status 0).
  - `pnpm --filter @atoll/bot check-batches` passed (status 0).
  - `pnpm --filter @atoll/bot test` passed (status 0).
  - `pnpm --filter @atoll/bot build` passed (status 0).

## Task B-013 Verification Fact
- **Signing Primitives & Payload Encoders (`packages/bot/src/runtime/crypto/signing.js`)**:
  - Implemented Ed25519 signing primitives and payload encoders exported as `sign`, `verify`, `keyObjectFromSeed`, `keyObjectFromPublicKey`, `lengthPrefixed`, `u64BE`, `encodeBotMessagePayload`, and `encodePublisherKeyPayload`.
  - Ed25519 32-byte seeds are wrapped into Node.js `KeyObject` instances using PKCS#8 DER prefix `30 2e 02 01 00 30 05 06 03 2b 65 70 04 22 04 20` for private keys and SPKI DER prefix `30 2a 30 05 06 03 2b 65 70 03 21 00` for public keys.
  - Length-prefixed encoding (`lengthPrefixed`) encodes 4-byte big-endian unsigned integer length prefixes followed by raw bytes.
  - 64-bit integer encoding (`u64BE`) accepts `number` (validated non-negative integer <= `Number.MAX_SAFE_INTEGER`) and `bigint` (validated non-negative <= 2^64-1), writing 8-byte big-endian output.
  - `encodeBotMessagePayload` implements Server §8.10 bot message context encoding order: `lengthPrefixed(roomId) || u64BE(epoch) || lengthPrefixed(contentType) || lengthPrefixed(ciphertext)`.
  - `encodePublisherKeyPayload` implements Server §8.10 publisher key publication context encoding order: `lengthPrefixed(roomId) || u64BE(epoch) || publisherPublicKey` (raw 32 bytes, enforcing length 32).
  - Ed25519 signatures are deterministic (RFC 8032). Signature of the all-zeros seed over `'test'` produces the pinned RFC test vector output.
  - Registered `signing` batch in `packages/bot/tests/batch-manifest.toml` and authored 26 test cases in `packages/bot/tests/unit/signing.test.js` covering all required cases.
- **Verification Results**:
  - `pnpm --filter @atoll/bot typecheck` passed (status 0).
  - `pnpm --filter @atoll/bot lint` passed (status 0).
  - `pnpm --filter @atoll/bot check-batches` passed (status 0).
  - `pnpm --filter @atoll/bot test` passed (status 0).
  - `pnpm --filter @atoll/bot build` passed (status 0).

## Task B-014 Verification Fact
- **Publisher Key Cache & Verification (`packages/bot/src/runtime/crypto/publisher.js`)**:
  - Implemented `PublisherKeyCache` class and helper `verifyPublication` exporting from `packages/bot/src/runtime/crypto/publisher.js`.
  - The cache stores publisher key publications received per room and epoch. Per-room eviction retains the current epoch and the two most recent prior epochs. LRU eviction across rooms caps cached rooms at `maxRooms` (default 100).
  - Signature verification (`verifyPublication`) verifies publications against signer identity public keys using `verify` and `encodePublisherKeyPayload` from `./signing.js`.
  - `recordPublication` stores publications even when verification fails (e.g. signer key unknown), returning `{ verified: false, reason }` and leaving `verifiedAt: null`. This allows later `reverifyAll` calls to re-verify entries when signer identity keys become available.
  - `getPublisherKey` returns defensive copies (`new Uint8Array(publisherPublicKey)`). Throws `PublisherKeyUnavailableError` when room or epoch entry is missing, and `PublisherKeyVerificationFailedError` when entry exists but signature is unverified (`verifiedAt: null`).
  - `recordEpoch` advances current epoch monotonically and ignores epoch regressions.
  - `markAllStale` sets `verifiedAt = null` across all cached entries. `reverifyAll` re-runs verification against each entry's stored signer user ID.
  - **Server Spec Gap Recorded**: Server §8.11 lists only bot Key Transparency (KT) endpoints (`GET /kt/bot/:id`, `GET /kt/bot/:id/history`, `GET /kt/snapshot`). The user KT endpoint needed for independent publisher key verification against user identity keys is absent from the server spec. The SDK dependency injection interface `lookupSignerPubkey(userId)` decouples the cache from user KT endpoint wiring (to be implemented in B-017).
  - Registered `publisher-cache` batch in `packages/bot/tests/batch-manifest.toml` and authored 24 test cases in `packages/bot/tests/unit/publisher-cache.test.js` covering all required cases in §10.
- **Verification Results**:
  - `pnpm --filter @atoll/bot typecheck` passed (status 0).
  - `pnpm --filter @atoll/bot lint` passed (status 0).
  - `pnpm --filter @atoll/bot check-batches` passed (status 0).
  - `pnpm --filter @atoll/bot test` passed (status 0).
  - `pnpm --filter @atoll/bot build` passed (status 0).

## Task B-015 Verification Fact
- **Command Result Encryption (`packages/bot/src/runtime/crypto/command-result.js`)**:
  - Implemented command result encryption primitives and wrappers exported as `generateEphemeralKeypair`, `deriveSharedSecret`, `encrypt`, `decrypt`, `encryptCommandResult`, `decryptCommandResult`, `keyObjectFromX25519Private`, and `keyObjectFromX25519Public`.
  - X25519 keys use DER prefixes PKCS#8 `30 2e 02 01 00 30 05 06 03 2b 65 6e 04 22 04 20` and SPKI `30 2a 30 05 06 03 2b 65 6e 03 21 00` (OID `1.3.101.110` / `2b 65 6e`).
  - HKDF-Expand is implemented directly (`hkdfExpand32`) using `crypto.createHmac('sha256', prk)` to derive a 32-byte key without `hkdfSync`.
  - Wire format is strictly `nonce(12) || ciphertext || tag(16)` with AES-256-GCM without AAD.
  - Low-order peer public keys producing all-zero shared secrets are detected and thrown as explicit errors.
  - `encryptCommandResult` uses fixed info string `"bot-command-result-v1"` and generates a fresh ephemeral keypair per call.
  - All returned `Uint8Array`s are fresh independent copies, preventing memory view corruption.
  - **Server Spec Gap Recorded**: Spec §6.31 describes command-invocation encryption (client -> bot) without naming an info string. By analogy with §7.2 (`"bot-settings-v1"`), the value is likely `"bot-command-v1"`, but needs confirmation. The generic `encrypt`/`decrypt` primitives are exported so follow-on tasks can supply any info string.
  - Registered `command-result` batch in `packages/bot/tests/batch-manifest.toml` and authored unit test suite in `packages/bot/tests/unit/command-result.test.js` covering all 26 required scenarios.
- **Verification Results**:
  - `pnpm --filter @atoll/bot typecheck` passed (status 0).
  - `pnpm --filter @atoll/bot lint` passed (status 0).
  - `pnpm --filter @atoll/bot check-batches` passed (status 0).
  - `pnpm --filter @atoll/bot test` passed (status 0).
  - `pnpm --filter @atoll/bot build` passed (status 0).

## Task B-019 Verification Fact
- **SSE Client Transport (`packages/bot/src/runtime/transport/sse.js`)**:
  - The SSE client transport lives at `packages/bot/src/runtime/transport/sse.js` exporting `createSseClient`.
  - The client uses `fetch` and a WHATWG-conformant line parser. Node 22's experimental `EventSource` global is not used.
  - The parser handles `\n`, `\r\n`, and `\r` line endings, multiple `data:` lines joined with `\n`, and `id:` persistence across events.
  - The client does not reconnect automatically. B-031 owns the reconnect loop.
  - `Last-Event-ID` is sent automatically from the client's tracked last ID. `initialLastEventId` seeds it for cross-process resume.
  - `retry:` values are stored and exposed via `getRetryMs()` for the reconnect loop's base delay.
  - Connect failures reject `connect()` with `HttpRequestError` (B-017). Mid-stream failures emit `onError` and `onClose`.
  - Logger integration emits `debug` lines for lifecycle and events without logging event `data` payloads.
  - Registered `sse` batch in `packages/bot/tests/batch-manifest.toml` and authored 34 unit tests in `packages/bot/tests/unit/sse.test.js` using real `node:http` servers.
- **Verification Results**:
  - `pnpm --filter @atoll/bot typecheck` passed (status 0).
  - `pnpm --filter @atoll/bot lint` passed (status 0).
  - `pnpm --filter @atoll/bot check-batches` passed (status 0).
  - `pnpm --filter @atoll/bot test` passed (status 0).
  - `pnpm --filter @atoll/bot build` passed (status 0).

## Task B-016 Verification Fact
- **Settings Decryption & Crypto (`packages/bot/src/runtime/crypto/settings.js`)**:
  - Authored `packages/bot/src/runtime/crypto/settings.js` exporting `decryptSettingsValue`, `parseSettingsWire`, and `SETTINGS_INFO = 'bot-settings-v1'`.
  - Wire format is `base64url(ephemeral_pub(32) || nonce(12) || ciphertext || tag(16))`.
  - Minimum decoded length is strictly 60 bytes (32-byte ephemeral public key, 12-byte nonce, 16-byte authentication tag). Any wire under 60 bytes throws an error naming the length constraint.
  - Base64url parsing accepts both padded and unpadded input strings for robustness; invalid base64url characters are rejected.
  - Reuses B-015's generic `decrypt` primitive imported from `./command-result.js` rather than duplicating X25519, HKDF-Expand, low-order point checks, or AES-256-GCM logic.
  - Decrypts only `value_encrypted_bot`. The bot has no access to the operator's preferences key and does not inspect `value_encrypted_client`.
  - Registered `settings-crypto` batch in `packages/bot/tests/batch-manifest.toml` and authored unit test suite in `packages/bot/tests/unit/settings-crypto.test.js` covering all 24 required scenarios.
- **Verification Results**:
  - `pnpm --filter @atoll/bot typecheck` passed (status 0).
  - `pnpm --filter @atoll/bot lint` passed (status 0).
  - `pnpm --filter @atoll/bot check-batches` passed (status 0).
  - `pnpm --filter @atoll/bot test` passed (status 0).
  - `pnpm --filter @atoll/bot build` passed (status 0).

## Task B-020 Verification Fact
- **Post Message Response Handler (`packages/bot/src/runtime/context/post.js`)**:
  - The `ctx.post` handler lives at `packages/bot/src/runtime/context/post.js` exporting `createPostHandler`, `generateRequestId`, and `PUBLISHER_MESSAGE_INFO = 'publisher-message-v1'`.
  - Encrypts plaintext JSON `{ text, attachments, reply_to }` using publisher key ECDH with HKDF info `"publisher-message-v1"`.
  - Wire format is `ephemeral_pub(32) || nonce(12) || ciphertext || tag(16)`.
  - Signs payload `encodeBotMessagePayload({ roomId, epoch, contentType: 'bot', ciphertext })` using Ed25519 identity key (`bot_identity_private`).
  - Sends request to `POST /rooms/${encodeURIComponent(roomId)}/bot-messages` with request body `{ epoch, ciphertext, content_type: 'bot', signature, request_id, reply_to? }`. Request sets `retry: true`.
  - Response parses into `MessageRef` `{ id, roomId, createdAt }`.
  - All failures wrap in `PostFailedError` (code `post_failed`), propagating inner errors via `cause`.
  - **Spec Gap 1 Recorded**: Member mode `ctx.post` requires MLS, which the Node.js runtime currently lacks. Throws `PostFailedError` with reason `member_mode_requires_mls`. Task B-020a deferred.
  - **Spec Gap 2 Recorded**: Server §8.8.8 request body example omits `reply_to` and `request_id`. Bot §6.1 includes `request_id`; `ctx.post` includes both as the natural reading.
  - **Spec Gap 3 Recorded**: Server §8.8.8 response body shape omitted. Assumes response contains `{ id, created_at }`.
  - Registered `ctx-post` batch in `packages/bot/tests/batch-manifest.toml` and authored 25 unit tests in `packages/bot/tests/unit/ctx-post.test.js` using local `node:http` servers.
- **Verification Results**:
  - `pnpm --filter @atoll/bot typecheck` passed (status 0).
  - `pnpm --filter @atoll/bot lint` passed (status 0).
  - `pnpm --filter @atoll/bot check-batches` passed (status 0).
  - `pnpm --filter @atoll/bot test` passed (status 0).
  - `pnpm --filter @atoll/bot build` passed (status 0).

## Task B-021 Verification Fact
- **Reply Handler Wrapper (`packages/bot/src/runtime/context/reply.js`)**:
  - The `ctx.reply` handler lives at `packages/bot/src/runtime/context/reply.js` exporting `createReplyHandler`.
  - Validates `opts.replyTo` as a non-empty string.
  - Missing or empty `replyTo` rejects with `ReplyRequiresReplyToError` (code `reply_requires_reply_to`).
  - When `logger` is provided, rejection emits a debug log entry with `meta: { room_id }` resolving `room_id` from `opts.roomId`, then `ctx.grant.roomId`, then `null`.
  - Valid calls delegate to `post(opts, ctx)` unchanged.
  - Errors from `post` propagate unchanged (same error instance and error code).
  - The wrapper performs no crypto, HTTP, or response parsing, and does not log message content or `replyTo`.
  - Registered `ctx-reply` batch in `packages/bot/tests/batch-manifest.toml` and authored 25 unit tests in `packages/bot/tests/unit/ctx-reply.test.js`.
- **Verification Results**:
  - `pnpm --filter @atoll/bot typecheck` passed (status 0).
  - `pnpm --filter @atoll/bot lint` passed (status 0).
  - `pnpm --filter @atoll/bot check-batches` passed (status 0).
  - `pnpm --filter @atoll/bot test` passed (status 0).
  - `pnpm --filter @atoll/bot build` passed (status 0).

## Task B-025 Verification Fact
- **Encrypted Settings Store (`packages/bot/src/runtime/context/settings.js`)**:
  - The settings store lives at `packages/bot/src/runtime/context/settings.js` exporting `createSettingsStore`.
  - Storage keys are `key` for user scope and `room:{room_id}:{key}` for room scope. The caller passes `{ room }`; the store cannot infer scope from the setting declaration.
  - Values map stores `{ value: unknown, isSecret: boolean }` decrypted via B-016 (`decryptSettingsValue`).
  - `get(key, opts)` triggers a fetch on cold cache; subsequent calls hit the in-memory cache. Concurrent cold `get`s share a single fetch.
  - `refresh()` coalesces within `coalesceMs` (default 500ms). If `refresh()` is called while a fetch is in flight, it schedules a second fetch after completion.
  - Subscriber callbacks fire synchronously on `refresh()` when structural `JSON.stringify` value diffing detects a value change, key addition, or key deletion (`value === undefined`).
  - Subscriber exceptions are caught and logged without breaking other subscribers or the refresh cycle.
  - `set` and `delete` throw `SettingsWriteFailedError` (code `settings_write_failed`) unconditionally.
  - Reserved prefix `_runtime:` on `key` throws `SettingsReservedPrefixError` (code `settings_reserved_prefix`).
  - `stop()` cancels pending coalesce timers and prevents future fetches.
  - Logging never logs setting values, plaintexts, or ciphertexts.
  - **Spec Gap 1 Recorded**: Bot settings are read-only; no bot-facing write endpoint exists. `set` and `delete` throw `SettingsWriteFailedError`.
  - **Spec Gap 2 Recorded**: Only full-list endpoint `GET /bots/me/settings` exists on server; refetch is full-list and diffed locally.
  - **Spec Gap 3 Recorded**: Subscriber scope depends on caller passing `{ room }`. The store cannot infer scope from the setting declaration.
  - Registered `settings-store` batch in `packages/bot/tests/batch-manifest.toml` and authored 32 unit tests in `packages/bot/tests/unit/settings-store.test.js` using local `node:http` servers.
- **Verification Results**:
  - `pnpm --filter @atoll/bot typecheck` passed (status 0).
  - `pnpm --filter @atoll/bot lint` passed (status 0).
  - `pnpm --filter @atoll/bot check-batches` passed (status 0).
  - `pnpm --filter @atoll/bot test` passed (status 0).
  - `pnpm --filter @atoll/bot build` passed (status 0).

## Task B-027 Verification Fact
- **Webhook Trigger Server (`packages/bot/src/runtime/triggers/webhook.js`)**:
  - Lives at `packages/bot/src/runtime/triggers/webhook.js` exporting `createWebhookServer`, `verifySignature`, and `extractHeader`.
  - Takes `config`, `triggers`, `makeBotCtx`, `idempotency`, `env`, `logger`. Returns a server object with `start`, `stop`, `getBoundPort`.
  - Zero declared triggers makes `start()` a no-op and `getBoundPort()` returns `null`.
  - Requests match on method (`trigger.method ?? 'POST'`) and full path (`basePath + trigger.path`) with query string stripping.
  - Body size limit is enforced during chunk reading with `413 request_too_large` and socket `req.destroy()`.
  - Secret verification resolves variable named by `trigger.secret` from `env`. `_SECRET` suffix verifies HMAC-SHA256 (`x-hub-signature-256` or `x-signature-256`, stripping optional `sha256=` prefix). `_TOKEN` suffix verifies Bearer token. Digests are hashed before constant-time comparison via `crypto.timingSafeEqual`.
  - Idempotency deduplicates requests after verification via `idempotency.checkAndRecord`. Handler or `makeBotCtx` failure removes the key via `idempotency.remove`.
  - **Spec Gap 1 Recorded**: HMAC header format is unspecified. The server accepts both `sha256=<hex>` and raw `<hex>`.
  - **Spec Gap 2 Recorded**: Response bodies for success are empty with 200 OK. Errors return JSON envelopes (`{ error, message }`).
  - Registered `webhook-server` batch in `packages/bot/tests/batch-manifest.toml` and authored 43 unit tests in `packages/bot/tests/unit/webhook-server.test.js` using local `node:http` servers.
- **Verification Results**:
  - `pnpm --filter @atoll/bot typecheck` passed (status 0).
  - `pnpm --filter @atoll/bot lint` passed (status 0).
  - `pnpm --filter @atoll/bot check-batches` passed (status 0).
  - `pnpm --filter @atoll/bot test` passed (status 0).
  - `pnpm --filter @atoll/bot build` passed (status 0).

## Task B-029b Verification Fact
- **Wire Room Channel Subscriptions and SSE Streams (`packages/bot/src/runtime/index.js`)**:
  - Extended `createRuntime` in `packages/bot/src/runtime/index.js` with internal room subscription registry `Map<roomId, RoomSubscription>`.
  - Handles grant transitions on `bot.grant_updated`: mode changes reconcile room subscriptions (`member` mode opens WebSocket channel `private-room-{room_id}`, `observer` mode opens SSE stream at `/api/v1/rooms/{room_id}/observer-stream`, `write_only` mode has no subscription).
  - `bot.revoked` removes room grant and tears down active subscription.
  - `onRoomEvent` constructs standard `MessageEvent` or room event payloads. Message events dispatch to `handlers.message`, room events dispatch to `handlers.room`.
  - **Spec Gap 1 (Member-Mode Message Content)**: Member-mode message events dispatch with `plaintext: null` and `attachments: []` because the bot runtime lacks MLS.
  - **Spec Gap 2 (SSE Event Naming)**: Assumes SSE `event:` field carries the event name and `data:` field contains JSON payload.
  - Extended `stop()` sequence: tears down all room subscriptions (closing SSE streams and unsubscribing WebSocket channels) before closing the WebSocket client.
  - Registered `runtime-rooms` batch in `packages/bot/tests/batch-manifest.toml` and authored 31 unit tests in `packages/bot/tests/unit/runtime-rooms.test.js`.
- **Verification Results**:
  - `pnpm --filter @atoll/bot check-batches` passed (status 0).
  - `node --test packages/bot/tests/unit/runtime-rooms.test.js` passed (31 passing, status 0).

## Task B-032 Verification Fact
- **Implement Graceful Shutdown (`packages/bot/src/runtime/shutdown.js` and `packages/bot/src/runtime/index.js`)**:
  - Shutdown module lives at `packages/bot/src/runtime/shutdown.js`, exporting `createShutdownTracker`, `installSignalHandlers`, and `runShutdownSequence`.
  - `createShutdownTracker` tracks in-flight handler promises, providing `track`, `waitForAll(timeoutMs)`, `startShutdown()`, `isShuttingDown()`, and `inFlightCount()`.
  - `installSignalHandlers` wires `SIGTERM` and `SIGINT` handlers idempotently per process, returning a cleanup function.
  - Runtime `stop({ drainMs })` accepts a drain budget (default 30000 ms, matching `ATOL_SHUTDOWN_DRAIN_MS`) and returns `{ drained, remaining }`.
  - Ordering in `stop()` sequence: `startShutdown()` → reconnect stop → `uninstall` handler → SSE room stream teardown → WebSocket room channel unsubscribes → cron engine stop → webhook server stop → WebSocket client close → settings store stop → drain in-flight operations via `shutdownTracker.waitForAll(drainMs)` → storage close (flushes write queue).
  - Dispatch sites (`command-invoked.js`, `webhook.js`, `cron.js`, and room events) check `isShuttingDown()` before processing new work (commands produce a shutdown local message, webhooks return 503 `bot_shutting_down`, cron fires and room events are skipped with debug logs) and wrap handler executions in `shutdownTracker.track(...)`.
  - `runShutdownSequence` orchestrates `runtime.stop({ drainMs })` and translates results into exit codes (0 for drained, 1 for timeout or error).
  - **Spec Gap 1 Recorded**: The drain budget source (`ATOL_SHUTDOWN_DRAIN_MS`) is managed by the CLI/caller and passed as `drainMs` parameter to `runtime.stop()` and `runShutdownSequence`.
  - **Spec Gap 2 Recorded**: Exit code translation is performed by `runShutdownSequence`, not by `runtime.stop()` or `process.exit()` within the runtime.
  - Registered `shutdown` (22 unit tests in `packages/bot/tests/unit/shutdown.test.js`) and `runtime-shutdown` (14 integration tests in `packages/bot/tests/unit/runtime-shutdown.test.js`) batches in `packages/bot/tests/batch-manifest.toml`. Added shutdown test cases to `ctx-command-invoked.test.js`, `webhook-server.test.js`, and `cron-engine.test.js`.
- **Verification Results**:
  - `pnpm --filter @atoll/bot check-batches` passed (status 0).
  - `node --test packages/bot/tests/unit/shutdown.test.js` passed (22 passing, status 0).
  - `node --test packages/bot/tests/unit/runtime-shutdown.test.js` passed (14 passing, status 0).
  - `node --test packages/bot/tests/unit/ctx-command-invoked.test.js` passed (10 passing, status 0).
  - `node --test packages/bot/tests/unit/webhook-server.test.js` passed (8 passing, status 0).
  - `node --test packages/bot/tests/unit/cron-engine.test.js` passed (59 passing, status 0).
  - `pnpm --filter @atoll/bot build` passed (status 0).
