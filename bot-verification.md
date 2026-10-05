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
