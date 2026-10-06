# Repository Conventions

## 1. Overview

A repository wraps one domain table (or a small set of related tables) and exposes typed async methods. It does not open the database connection; the caller provides a `db` handle created via the storage factory (`createDb`).

## 2. File Layout

Domain repositories are stored under `packages/app/src/lib/db/repositories/<domain>.js`.
The repository aggregator at `packages/app/src/lib/db/repositories/index.js` exposes `createRepositories({ db })` and re-exports individual repository factories.

## 3. Factory Signature

Each repository module exports a factory function named `create<Domain>Repository({ db })`. The factory returns an object containing async methods. Every repository method awaits its underlying database call.

```javascript
import { createUsersRepository } from './users.js'

export function createRepositories({ db }) {
  return {
    users: createUsersRepository({ db })
  }
}
```

## 4. Method Shape

- **Read methods**: Return row objects or `undefined` for single-row lookups (e.g. `get(id)`).
- **Write methods**: Return execution summaries containing `{ changes }`.
- **List methods**: Support cursor pagination accepting `{ limit, cursor }` and returning arrays sorted by monotonic timestamps.

## 5. Transactions

Repositories do not manage transactions internally. Callers wrap multi-step operations in `db.transaction(async () => { ... })`. The transaction wrapper commits automatically on success and rolls back on thrown errors.

## 6. Partial Updates

Upsert methods use `INSERT ... ON CONFLICT ... DO UPDATE SET ... COALESCE(excluded.col, table.col)` so callers providing only a subset of fields do not clear existing cached values. Passing an explicit `null` does not overwrite existing data; dedicated clear methods are added when explicitly required.

## 7. Testing

Every repository has a unit test that runs against the SQLite WASM backend. Unit test files are placed under `packages/app/tests/unit/repositories-<domain>.test.js` and registered in `test-batches.js`.

## 8. Naming

- Singular domain folder name under `lib/db/repositories/` (e.g., `users.js`).
- Factory name: `create<Domain>Repository`.
- Method names: concise verbs (`get`, `upsert`, `remove`, `list`, `count`, `clearAll`).
