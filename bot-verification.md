# Bot SDK Verification Log (@atoll/bot)

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
  - Windows write path passes password on stdin to `powershell.exe -NoProfile -NonInteractive -EncodedCommand <base64-utf16le>` with P/Invoke to `CredWrite` (`CRED_TYPE_GENERIC`, `CRED_PERSIST_LOCAL_MACHINE`). Password is never passed in command args.
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
