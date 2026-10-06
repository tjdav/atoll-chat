# Storage Plugin & Migration Runner (`storage`)

### Import pattern

The `client.context` uses a Phase 1 async dynamic import to load
`../lib/db/index.js` into the browser bundle. This is required: static top-level
imports in the plugin file are not hoisted into the serialized client
bundle. See `docs/plugins/README.md` for the cross-cutting rule.

The `storage` plugin provides SQLite persistence, WASM+OPFS browser storage, in-memory fallback backend abstractions, the forward-only migration runner, and key-value metadata helpers (`meta`).

## Overview

Every client data model (messages, rooms, members, preferences) is persisted in SQLite per spec §4.5 and §23.1. The `storage` plugin establishes the database factory, backend resolver, migration runner, and meta table subsystem without imposing domain schema assumptions.

## Async Storage Contract

OPFS file access and WASM module initialization require an asynchronous lifecycle. Every database operation (`open`, `close`, `query`, `queryOne`, `execute`, `transaction`, `meta.get`, `meta.set`, `meta.delete`) returns a `Promise`. Callers across repositories and plugins **must** `await` all storage method calls.

## The `ctx.storage` Contract

The `storage` plugin name **is** the namespace. The context resolver returns methods directly on `ctx.storage` without an inner wrapper key (`await ctx.storage.open()`, NOT `await ctx.storage.storage.open()`).

| Method / Property | Signature | Description |
|---|---|---|
| `open()` | `() => Promise<{ applied: string[], skipped: string[] }>` | Opens backend and applies pending migrations. Idempotent. |
| `close()` | `() => Promise<void>` | Closes backend connection. |
| `query(sql, params)` | `(sql: string, params?: any[]) => Promise<Array<Record<string, any>>>` | Executes read query and returns matching rows. |
| `queryOne(sql, params)` | `(sql: string, params?: any[]) => Promise<Record<string, any> \| undefined>` | Executes read query and returns first row or `undefined`. |
| `execute(sql, params)` | `(sql: string, params?: any[]) => Promise<{ changes: number, lastInsertId: number \| null }>` | Executes write statement. |
| `transaction(fn)` | `<T>(fn: () => Promise<T> \| T) => Promise<T>` | Executes callback inside `BEGIN`/`COMMIT` block with `ROLLBACK` on error. |
| `meta.get(key)` | `(key: string) => Promise<any>` | Reads `_meta` key and parses `value_json`. Returns `undefined` if missing. |
| `meta.set(key, value)` | `(key: string, value: any) => Promise<{ changes: number }>` | Upserts `_meta` row with `JSON.stringify(value)` and current timestamp. |
| `meta.delete(key)` | `(key: string) => Promise<{ changes: number }>` | Deletes `_meta` row. |

### `isPersistent()`

- **Signature**: `isPersistent(): Promise<boolean> | boolean`
- **Returns**: `true` when the database backend persists data across browser reloads (WASM with OPFS). Returns `false` for the memory backend and for the WASM backend's in-memory fallback.
- **Consumers**: Consumers (such as `messenger-boot`) query `isPersistent()` after opening storage and surface the result to `$state.storagePersistent`. Future notification components observe this key to warn users about ephemeral storage when OPFS is unavailable per spec §21.6.

## Migration Workflow

1. **Location & Naming**: Migrations live in `packages/app/src/db/migrations/` as `.sql` files named `NNNN-name.sql` (e.g. `0001-meta.sql`).
2. **Forward-Only**: Migrations are applied once in ascending numeric order and are never rolled back automatically.
3. **Tracking**: Applied migrations are recorded in `_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)`.
4. **Statement Splitting**: Multi-statement SQL files are split on `;` boundaries while preserving semicolons inside single-quoted strings `'...'`, double-quoted identifiers `"..."`, and `--` line comments.
5. **Execution**: Unapplied migrations execute inside individual transaction blocks.

## The `meta` Helpers

The `_meta` table (`key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at INTEGER NOT NULL`) stores app-level opaque key-value metadata per spec §23.1.

Common keys:
- `last_user_seq`: Highest processed sequence number for sync tracking.
- `read_aloud_settings`: Voice synthesis preference state.
- `extension_origins`: Extension permission grants and installation origins.

```javascript
// Example usage in client code
await ctx.storage.meta.set('last_user_seq', 1042)
const seq = await ctx.storage.meta.get('last_user_seq') // 1042
```

## Backends & Environment Selection

The backend resolver `resolveBackend({ prefer })` selects the active backend:

- **WASM Backend (`'wasm'`)**: Uses `@sqlite.org/sqlite-wasm@3.53.4-build2`. Selected automatically in browser environments (`window` or `importScripts` defined). Attempts OPFS persistence (`new sqlite3.oo1.OpfsDb('/messenger.sqlite3')`).
- **OPFS Fallback**: When OPFS open fails or is unsupported in the current context, `createWasmBackend` falls back to an in-memory SQLite database (`new sqlite3.oo1.DB(':memory:', 'c')`) and marks `isPersistent() === false`.
- **Memory Backend (`'memory'`)**: Pure JavaScript in-memory engine used in Node environments, unit tests, or when `prefer: 'memory'` is explicitly requested.
- **Native Backend**: Tauri/Capacitor native SQLite implementations follow the same `resolveBackend()` abstraction.

## Failure Modes

1. **SSR Usage**: Calling `open()`, `query()`, `queryOne()`, `execute()`, or `transaction()` during server-side rendering throws a descriptive `Error` ("The database is client-only").
2. **Unsupported SQL**: The memory backend parses a narrow set of SQL statements (`CREATE TABLE`, `INSERT`, `SELECT`, `UPDATE`, `DELETE`). Complex or unhandled SQL throws naming the unsupported statement.
3. **OPFS Unavailability**: If OPFS fails, the WASM backend degrades gracefully to in-memory SQLite (`isPersistent() === false`).
4. **Migration Failure**: A migration error mid-execution triggers `ROLLBACK` and throws naming the failing migration file.

## What Is Not Implemented

- Domain tables (`rooms`, `messages`, `members`, etc.) — delivered in follow-on domain tasks.
- Domain repositories — delivered alongside domain tables.
- Native SQLite backends — delivered in platform binding tasks.
