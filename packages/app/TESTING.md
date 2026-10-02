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

## Timeouts

Every batch runs in under 60 seconds. If a batch exceeds that, split it
into two batches.

## No `pnpm test:all`

There is no target that runs every batch. The full suite will exceed
tool execution timeouts. Run only the batch containing your change.
