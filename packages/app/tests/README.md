# Test Authoring Guide

This document is normative for all test creation and maintenance across `@atoll/app`.

## 1. Overview

The `@atoll/app` test suite uses two complementary test runners:

- **Unit tests**: Run via Node.js built-in test runner (`node --test`). Fast, pure JS/DOM logic, repository operations, and offline state logic.
- **Component & E2E tests**: Run via Playwright in full browser environments. Test component rendering, user interaction, storage integration, and UI state reflection.

Tests are organized into batches defined in `packages/app/test-batches.js` and executed via `pnpm test:batch <batch-name>`.

## 2. Unit Tests

- **Location**: `packages/app/tests/unit/`
- **Naming convention**: `*.test.js`
- **Batch assignment**: Registered in `test-batches.js` under `unit-smoke` or specialized unit batches.
- **Execution**: Must run cleanly without needing Playwright browser binaries or live HTTP web servers.

## 3. Component Tests

- **Location**: `packages/app/tests/component/`
- **Naming convention**: `*.spec.js`
- **Batch assignment**: Registered in `test-batches.js` under `component-smoke`, `component-auth`, or `component-i18n`.
- **Execution**: Must run against the Playwright browser runner.

## 4. The Fixture Pattern

Storage-backed view tests must never invent ad-hoc database seeding routines, mock global functions, or attempt direct IndexedDB/OPFS manipulation.

Instead, every storage-backed view test uses the shared fixture pattern:

```javascript
import { test, expect } from '@playwright/test'
import { stubAuth, seedSession, loadWithFixture } from '../helpers/storage-fixture.js'

test('renders thread with messages', async ({ page }) => {
  await stubAuth(page)
  await seedSession(page)
  await loadWithFixture(page, { seed: 'chatWithMessages', path: '/app.html?rail=core.chat&detail=chat&id=r_1' })
  await expect(page.locator('message-bubble')).toHaveCount(6)
})
```

`loadWithFixture` loads `/app.html?fixture=<seedName>` (along with optional view query params), which triggers the `<test-seed>` component to populate SQLite storage via domain repositories and signal readiness.

## 5. Adding a New Seed

New test scenarios extend `packages/app/tests/fixtures/seed-data.js`.

The schema for seeds is:
- `rooms`: `{ roomId, name? }[]`
- `members`: `{ roomId, userId, role }[]`
- `users`: `{ userId, displayName, identityPubkey? }[]`
- `messages`: `{ id, from, text, offsetMs, status, deleted? }[]`
- `readStates`: `{ roomId, userId, lastReadMessageId }[]`

Relative offset timestamps (`offsetMs`) ensure timestamps remain stable relative to the execution time (`Date.now() + offsetMs`).

## 6. CSP and WASM

`@sqlite.org/sqlite-wasm` requires `'wasm-unsafe-eval'` under `script-src` in Content Security Policy (CSP) directives during WebAssembly module instantiation in browser contexts.

This is configured directly in `coralite.config.js`. Do not attempt to strip or disable CSP headers during component tests—tests run against the production-identical CSP policy.

## 7. The Fixture-Ready Contract

The `<test-seed>` component signals completion via document root attributes on `<html>`:

- Success: `data-fixture-ready="<seedName>"`
- Failure: `data-fixture-error="<errorMessage>"`

Playwright helpers wait for `html[data-fixture-ready]` before handoff to test assertions.

## 8. Cache Discipline

Per the C-INFRA-11 policy, whenever plugins, components, or static assets are modified, clean the build artifacts before running component batches:

```bash
rm -rf .coralite dist
pnpm check-batches
pnpm test:batch component-smoke
```

## 9. Playwright Environment

Browser binaries (Chromium) are automatically managed via `globalSetup: './tests/helpers/global-setup.js'` registered in `playwright.config.js`.

If browser installation fails (e.g., due to network constraints in sandboxed offline CI environments), Playwright tests fail with explicit environment errors.

## 10. Forbidden Patterns

- **`window.__seedTestStorage__` or custom globals**: Never pollute global `window` scope with ad-hoc seeding functions.
- **In-line script CSP bypasses**: Do not manipulate HTML or strip CSP meta tags using Playwright route rewrites.
- **Ad-hoc seeding logic in individual tests**: Seeding logic must strictly reside in `tests/fixtures/seed-data.js` and `<test-seed>`.
