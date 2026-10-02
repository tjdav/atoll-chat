# Verification Report C-V-B — Client Testing Stack & Coralite Test Tooling

**Status:** Complete
**Date:** 2026-10-02
**Target:** Client Testing Stack & Coralite Tooling
**Author:** Client Engineering Team

---

## 1. Questions

1. **What does `coralite-scripts test` actually do?**
2. **What is testing mode (`mode: 'testing'`)?**
3. **What test runners are viable for the client?**
4. **What is the relationship between `coralite-scripts test` and the batch model?**
5. **What does the client spec say about testing?**
6. **Is there an existing test infrastructure anywhere in the repository?**

---

## 2. Method

The analysis was conducted by executing commands in the workspace bash session and inspecting installed package sources, package manifests, and formal specification documents:

1. **`coralite-scripts` Inspection:**
   - Ran `pnpm --filter @atoll/app exec coralite-scripts test --help`.
   - Inspected CLI command definition in `packages/app/node_modules/coralite-scripts/bin/index.js`.
   - Inspected server implementation in `packages/app/node_modules/coralite-scripts/libs/server.js`.

2. **Coralite Reference & Framework Analysis:**
   - Quoted `https://coralite.dev/llms.txt` (§10, §11, §19, §20).
   - Inspected `packages/app/node_modules/coralite/package.json` `devDependencies` and `scripts`.

3. **Client Specification Review:**
   - Examined `client-spec.md` (§1, §4.3, §11, §26.13).

4. **Workspace Test Discovery:**
   - Executed file search commands excluding `server/` and `node_modules/`:
     ```bash
     find . -path ./server -prune -o -name "*.test.*" -print 2>/dev/null
     find . -path ./server -prune -o -name "*.spec.*" -print 2>/dev/null
     find . -path ./server -prune -o -name "test-batch*" -print 2>/dev/null
     ```

---

## 3. Evidence

### Evidence for Q1 — `coralite-scripts test`

CLI Help Output:
```
Usage: coralite-scripts test [options]

Run testing server

Options:
  -v, --verbose              Enable verbose logging output
  -c, --clean                Clear the output directory before building
  -a, --assets <mapping...>  Static assets to copy during build. Format:
                             pkg:path:dest or src:dest
  --no-incremental           Disable change detection optimization and rebuild
                             all pages and components
  -h, --help                 display help for command
```

Source (`packages/app/node_modules/coralite-scripts/bin/index.js`):
```js
// test command
program
  .command('test')
  .description('Run testing server')
  .option('-v, --verbose', 'Enable verbose logging output')
  .option('-c, --clean', 'Clear the output directory before building')
  .option('-a, --assets <mapping...>', 'Static assets to copy during build. Format: pkg:path:dest or src:dest')
  .option('--no-incremental', 'Disable change detection optimization and rebuild all pages and components')
  .action(async (options, cmd) => {
    ...
    config.output = join(process.cwd(), '.coralite')
    await mkdir(config.output, { recursive: true })
    await server(config, options, 'test')
  })
```

Source (`packages/app/node_modules/coralite-scripts/libs/server.js`):
```js
async function server (config, options, runMode = 'dev') {
  ...
  coralite = await createCoralite({
    ...
    mode: runMode === 'test' ? 'testing' : 'development',
    output: currentConfig.output,
    ...
  })

  if (runMode === 'dev') {
    coralite.build().catch((error) => {
      displayError(error.message, error)
    })
  }

  if (runMode !== 'test') {
    // watch for file changes
    const watcher = chokidar.watch(watchPath, ...)
  }
}
```

### Evidence for Q2 — Testing Mode (`mode: 'testing'`)

Quoted from `https://coralite.dev/llms.txt` (§11 Automated Testing & E2E):
> - **Velocity Engine**: Coralite's testing plugin automatically suppresses animations, transitions, and smooth scrolling (`*, *::before, *::after { transition: none !important; animation: none !important; scroll-behavior: auto !important; }`) to guarantee instantaneous test execution and deterministic visual snapshots.
> - **Three-Tier Prototype Patching**: In `development` and `testing` modes, Coralite patches `Element.prototype.innerHTML`, `outerHTML`, and `document.createElement` to automatically import chunks and upgrade custom elements injected via test fixtures (`mountComponent`) or DevTools console.
> - **Settlement**: Wait on `await el.updateComplete` before assertions to ensure all reactive renders and observers have completely settled.
> - **DevTools Introspection**: Access component test context via `element[Symbol.for('coralite.testing')]` (`{ instanceId, componentId, state, getters, refs }`).

### Evidence for Q3 — Framework Test Tooling

Source (`packages/app/node_modules/coralite/package.json`):
```json
  "devDependencies": {
    "@commitlint/cli": "^19.8.1",
    "@commitlint/config-conventional": "^19.8.1",
    "@playwright/test": "^1.61.0",
    "@types/node": "^22.20.0",
    "@types/serialize-javascript": "^5.0.4",
    "esbuild-svelte": "^0.9.5",
    "happy-dom": "^20.10.6",
    "mitata": "^1.0.34",
    "react": "^19.2.8",
    "react-dom": "^19.2.8",
    "sirv": "^3.0.2",
    "sirv-cli": "^3.0.1",
    "svelte": "^5.56.10",
    "vue": "^3.5.41"
  },
  "scripts": {
    "test:unit": "node --conditions=development --experimental-vm-modules --experimental-import-meta-resolve --test --test-timeout=30000 --test-concurrency=4 --max-old-space-size=2048 \"./tests/unit/**/*.spec.js\"",
    "test:e2e": "pnpm build && pnpm clean:e2e && pnpm build:html:dev && pnpm build:html:prod && pnpm build:html:testing && playwright test"
  }
```

### Evidence for Q5 — Client Specification Mandates

From `client-spec.md`:
- §1 Product Summary: Framework `Coralite 1.0.0-rc.5`, Config loader `coralite-scripts`, Runtime `Node.js ≥ 22.22.2, ESM`.
- §11 Automated Testing & E2E: Mentions Playwright + `@axe-core/playwright` for accessibility testing.
- §26.13 Build-Time Validation: "Accessibility is not checked by the extension validator. It is checked by Coralite's component validator... and by Playwright + `@axe-core/playwright` in each extension's test suite."

### Evidence for Q6 — Repository Search Output

Execution output:
```
./packages/app/tests/unit/smoke.test.js
./packages/app/test-batches.js
```

---

## 4. Answers

### Q1: What does `coralite-scripts test` actually do?
`coralite-scripts test` initializes and launches an Express development/testing HTTP server hosting the Coralite compiler configured in `mode: 'testing'` on port 3000 (or portfinder fallback).
- **Server behavior:** Disables chokidar file-watcher re-compilation (`runMode !== 'test'`) and suppresses initial eager background compilation (`runMode === 'dev'`).
- **No Test Execution:** `coralite-scripts test` does **NOT** execute test files, discover specs, or invoke a test runner. It serves built HTML/JS/CSS pages and custom component bundles in testing mode for external test runners (e.g. Playwright) to execute against.

### Q2: What is testing mode (`mode: 'testing'`)?
Testing mode is a build and runtime configuration target in Coralite activated via `mode: 'testing'`.
- **Velocity Engine:** Injects CSS suppressing transitions, animations, and smooth scrolling for deterministic visual snapshots.
- **Prototype Patching:** Patches `innerHTML`, `outerHTML`, and `createElement` for automatic chunk importing and custom element upgrading when mounting fixtures.
- **Testing Plugin & Test IDs:** Retains static `data-testid` attributes and exposes introspection metadata via `element[Symbol.for('coralite.testing')]`.
- **Usage:** Required when serving the application for E2E or browser component tests. Unnecessary for pure Node.js unit tests testing headless JavaScript modules (`src/lib/`).

### Q3: What test runners are viable for the client?
1. **Unit Tests (`src/lib/` — crypto, OPRF, MLS wrappers, utilities):**
   - **Viable Runner:** **Node.js built-in test runner (`node --test`)** under Node 24.
   - **Justification:** Exact runner used natively by Coralite itself (`coralite/package.json`). Zero external overhead, native ESM support, fast execution under <60s budget.
2. **Component Tests (`src/components/` — Web Components, DOM, FACE integration):**
   - **Viable Runner:** **Playwright (`@playwright/test`)** or **Node.js test runner with JSDOM / HappyDOM / browser fixtures**.
   - **Justification:** Playwright against `coralite-scripts test` guarantees real Light DOM custom element upgrades, `updateComplete` reactive settlement, and native form element behavior.
3. **End-to-End (E2E) Tests (Full user flows, auth gate, messenger shell):**
   - **Viable Runner:** **Playwright (`@playwright/test`) + `@axe-core/playwright`**.
   - **Justification:** Explicitly mandated by Client Spec v1.0 §1, §11, and §26.13 for full browser testing and WCAG 2.1 AA accessibility auditing.

### Q4: What is the relationship between `coralite-scripts test` and the batch model?
`coralite-scripts test` is a server process, not a test runner, and accepts no file filtering or batching arguments (`-v`, `-c`, `-a`, `--no-incremental` only).
- **Granularity:** `coralite-scripts test` has process-level granularity (starts HTTP server).
- **Mapping:** Batch filtering must be implemented at the test runner level (`node --test <files>` or `playwright test <files>`). Batch definitions in `test-batches.js` group test files into execution batches, and a custom batch runner script (`run-batch.js`) invokes the appropriate test runner targeting only the file subset defined for that batch.

### Q5: What does the client spec say about testing?
The Client Specification v1.0 mandates:
- Playwright + `@axe-core/playwright` for automated end-to-end and accessibility testing across extensions and core components (§1, §11, §26.13).
- Use of static `data-testid` attributes preserved in test builds.
- Settlement assertions using `await element.updateComplete`.
- The spec leaves unit test runner selection and batching mechanics open to engineering infrastructure decisions.

### Q6: Is there an existing test infrastructure anywhere in the repository?
Yes. Outside of `server/` (which uses Rust `cargo test`), `packages/app/` contains the batch model infrastructure introduced in C-INFRA-3:
- Manifest: `packages/app/test-batches.js`
- Validator: `packages/app/scripts/check-batches.js`
- Batch Dispatcher: `packages/app/scripts/run-batch.js`
- Smoke Test: `packages/app/tests/unit/smoke.test.js`
- Documentation: `packages/app/TESTING.md`

No test files currently exist in `packages/extend/`.

---

## 5. Implications

1. **`pnpm test` vs. `pnpm test:batch` Distinction:**
   - `pnpm test` (pointing to `coralite-scripts test`) launches the testing-mode HTTP server and remains running. It is used as a web server dependency during Playwright runs.
   - `pnpm test:batch <batch-name>` executes a discrete batch of tests using `node --test` or `playwright test` and exits cleanly within a strict <60s tool timeout.

2. **Runner Isolation:**
   - Unit tests run under `node --test` in Node 24 without starting the HTTP server.
   - Component and E2E tests run via Playwright, connecting to `coralite-scripts test` (or launching it via Playwright's `webServer` config).

3. **Batch Enforcement:**
   - The validator `scripts/check-batches.js` ensures 100% test file assignment across `tests/` with zero orphans, phantoms, or duplicate assignments.

---

## 6. Recommendations

1. **Adopt Two Test Runners:**
   - Use Node.js built-in runner (`node --test`) for unit test batches in `tests/unit/`.
   - Use Playwright (`@playwright/test`) + `@axe-core/playwright` for component and E2E test batches in `tests/component/` and `tests/e2e/`.

2. **Maintain JS Batch Manifest:**
   - Keep `packages/app/test-batches.js` as the source of truth for batch definitions.
   - Structure batches by runner type and domain (e.g., `unit-smoke`, `unit-crypto`, `e2e-auth`, `component-primitives`).

3. **Enforcement Mechanism:**
   - Mandate `pnpm check-batches` in pre-commit steps and CI pipelines.
   - Strictly enforce the <60s execution budget per batch.

4. **Next Steps for Test-Writing Tasks:**
   - Install `@playwright/test` and `@axe-core/playwright` in C-INFRA-4 or dedicated testing setup tasks.
   - Direct future unit test tasks to place spec files in `tests/unit/` and register them in `test-batches.js`.
