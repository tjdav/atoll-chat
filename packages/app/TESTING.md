# Testing

The client test suite is organized into batches. Each batch runs in under
60 seconds. Contributors run the batch that contains their change.

## Why batching

The full suite will exceed tool execution timeouts. Batching keeps
individual runs fast and the feedback loop tight.

## Running tests

    pnpm test:batch <name>

Example:

    pnpm test:batch unit-smoke

## `pnpm test` vs. `pnpm test:batch`

`pnpm test` starts the Coralite test server (a server launcher used by
Playwright as a web server). It does not run tests.

`pnpm test:batch <name>` runs the named batch.

## Adding a test

1. Create the test file under `tests/`.
2. Add its path to exactly one batch in `test-batches.js`.
3. Run `pnpm check-batches` to verify the manifest is complete.

## Adding a batch

1. Append an entry to `test-batches.js`.
2. Run `pnpm check-batches`.
3. If the batch exceeds 60 seconds, split it.

## Orphans and phantoms

`pnpm check-batches` walks `tests/` and compares against the manifest.
It fails on:
- **Orphans** — a test file present on disk but absent from every batch.
- **Phantoms** — a batch entry pointing to a file that does not exist.
- **Duplicates** — a test file listed in more than one batch.

## Test types

| Type | Runner | Use |
|---|---|---|
| `unit` | `node --test` | Pure logic. No DOM, no network. |
| `e2e` | Playwright | Browser-driven. Installed by C-INFRA-4. |
| `component` | Playwright + @axe-core/playwright | Component behavior + accessibility. Installed by C-INFRA-4. |

Unit tests use Node's built-in test runner. It ships with the Node 24
runtime the app targets, needs no download, and is ESM-native.

E2E and component tests use Playwright. The client specification §26.13
requires Playwright and @axe-core/playwright for extension test suites.

## What to test

Each task covers, where applicable:
- **Happy path** — the operation succeeds with valid input.
- **Validation** — invalid input is rejected with the correct error.
- **Authorization** — unauthorized callers are rejected.
- **Persistence** — state is written and read back correctly.
- **Events** — the expected event is emitted, if any.
- **Rate limits** — the limit is enforced, if any.

## Component attribute enforcement

`packages/app/tests/unit/components-data-attrs.test.js` walks every component under
`src/components/`, reads its `<template>` block, and fails if any `data-*` attribute
other than `data-testid` is present. This enforces the rules in
`packages/app/docs/components.md`.

A component may opt out by placing the comment
`<!-- coralite-ignore-data-attributes -->` inside its `<template>` block. The pragma
is for the rare case where a third-party library reads a `data-*` attribute from a
specific element. It must be documented in the component file itself with a comment
explaining why.

## Timeouts

Every batch runs in under 60 seconds. If a batch exceeds that, split it
into two batches.

## No `pnpm test:all`

There is no target that runs every batch. The full suite will exceed
tool execution timeouts. Run only the batch containing your change.

## Playwright Workflow

Component and E2E browser tests use `@playwright/test` and `@axe-core/playwright`.

### Runner Types
Batches declare a `runner` property in `test-batches.js`:
- `runner: 'node'` — executes Node.js native unit test runner (`node --test`).
- `runner: 'playwright'` — executes Playwright browser test runner (`playwright test`).

### Running Playwright Batches

    pnpm --filter @atoll/app test:batch component-smoke

### Automatic Web Server (`webServer`)
Playwright's `playwright.config.js` configures `webServer` to launch `coralite-scripts test` automatically. You do not need to start `coralite-scripts test` manually before running Playwright batches.

### Browser Constraints
For v1, tests target Chromium (`Desktop Chrome`). Firefox and WebKit are not installed or required.

### Execution Budget
Each Playwright batch is subject to the strict 60-second budget enforced by `scripts/run-batch.js`.

## Cache discipline

- Coralite caches compiled scripts in `.coralite/manifest.json`.
- Playwright's `reuseExistingServer: true` may reuse a dev server serving stale bundles.
- Before running component batches after a plugin or component change:
  ```bash
  rm -rf packages/app/.coralite packages/app/dist
  lsof -t -i :3000 | xargs -r kill
  ```
- The `pnpm test:batch component-*` command does not clear these automatically. It is the test author's responsibility.

## Test Authoring Guide

Detailed test authoring rules, the fixture pattern specification, CSP requirements, and normative guidelines are documented in [`tests/README.md`](tests/README.md).

## Content Security Policy (WASM)

`@sqlite.org/sqlite-wasm` requires `'wasm-unsafe-eval'` under `script-src` in `coralite.config.js`. This permits WebAssembly compilation in both production browser runtime and Playwright component test suites without compromising CSP isolation.

## Seeding state in Playwright tests

- Use the shared fixture helper (`loadWithFixture` from `tests/helpers/storage-fixture.js`) for storage-backed view component tests:

  ```javascript
  import { test, expect } from '@playwright/test'
  import { stubAuth, seedSession, loadWithFixture } from '../helpers/storage-fixture.js'

  test('renders thread', async ({ page }) => {
    await stubAuth(page)
    await seedSession(page)
    await loadWithFixture(page, { seed: 'chatWithMessages', path: '/app.html?rail=core.chat&detail=chat&id=r_1' })
    await expect(page.locator('message-bubble')).toHaveCount(6)
  })
  ```

- `page.addInitScript()` runs on every navigation, including redirects. A test that seeds a session token and then verifies it was cleared after a 401 redirect will see the token re-seeded on the redirect target.
- Seed state via `page.evaluate()` on an initial route before navigating to the target page (handled automatically by `seedSession(page)`). This pattern persists only the initial state and lets the application's cleanup logic run unobstructed.

## CSS Bundle Verification

- Production CSS must contain no `@import` statements. `postcss-import` inlines them at build time.
- The regression guard is `tests/unit/css-bundle.test.js`. It runs the production build and inspects the output.
- Visual verification of applied CSS is at `tests/component/css-applied.spec.js`. It captures a screenshot and a video to `packages/app/test-results/`.
- When a task changes `coralite.config.js`'s `styles` block or any file under `src/styles/`, run both tests before declaring the task done.
