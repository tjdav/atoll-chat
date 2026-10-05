# Storage Plugin & Migration Runner (`storage`)

The `storage` plugin provides SQLite persistence, the in-memory fallback backend abstraction, the forward-only migration runner, and key-value metadata helpers (`meta`).

## Overview

Every client data model (messages, rooms, members, preferences) is persisted in SQLite per spec §4.5 and §23.1. The `storage` plugin establishes the database factory, backend resolver, migration runner, and meta table subsystem without imposing domain schema assumptions.

## The `ctx.storage` Contract

The `storage` plugin name **is** the namespace. The context resolver returns methods directly on `ctx.storage` without an inner wrapper key (`ctx.storage.open()`, NOT `ctx.storage.storage.open()`).

| Method / Property | Signature | Description |
|---|---|---|
| `open()` | `() => Promise<{ applied: string[], skipped: string[] }>` | Opens backend and applies pending migrations. Idempotent. |
| `close()` | `() => Promise<void>` | Closes backend connection. |
| `query(sql, params)` | `(sql: string, params?: any[]) => Array<Record<string, any>>` | Executes read query and returns matching rows. |
| `queryOne(sql, params)` | `(sql: string, params?: any[]) => Record<string, any> \| undefined` | Executes read query and returns first row or `undefined`. |
| `execute(sql, params)` | `(sql: string, params?: any[]) => { changes: number, lastInsertId: number \| null }` | Executes write statement. |
| `transaction(fn)` | `<T>(fn: () => Promise<T> \| T) => Promise<T>` | Executes callback inside `BEGIN`/`COMMIT` block with `ROLLBACK` on error. |
| `meta.get(key)` | `(key: string) => any` | Reads `_meta` key and parses `value_json`. Returns `undefined` if missing. |
| `meta.set(key, value)` | `(key: string, value: any) => { changes: number }` | Upserts `_meta` row with `JSON.stringify(value)` and current timestamp. |
| `meta.delete(key)` | `(key: string) => { changes: number }` | Deletes `_meta` row. |

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
ctx.storage.meta.set('last_user_seq', 1042)
const seq = ctx.storage.meta.get('last_user_seq') // 1042
```

## The Current Backend

Today the only supported backend is `'memory'` (`createMemoryBackend()`).

- **Why**: Allows unit testing, component tests, and degradation mode without native binaries or WASM setup.
- **WASM Backend**: A follow-on task introduces SQLite WASM with OPFS persistence for web browser environments.
- **Native Backend**: Tauri/Capacitor native SQLite implementations follow the same `resolveBackend()` abstraction.

## Failure Modes

1. **SSR Usage**: Calling `open()`, `query()`, `queryOne()`, `execute()`, or `transaction()` during server-side rendering throws a descriptive `Error` ("The database is client-only").
2. **Unsupported SQL**: The memory backend parses a narrow set of SQL statements (`CREATE TABLE`, `INSERT`, `SELECT`, `UPDATE`, `DELETE`). Complex or unhandled SQL throws naming the unsupported statement.
3. **Migration Failure**: A migration error mid-execution triggers `ROLLBACK` and throws naming the failing migration file.

## What Is Not Implemented

- Domain tables (`rooms`, `messages`, `members`, etc.) — delivered in follow-on domain tasks.
- Domain repositories — delivered alongside domain tables.
- WASM+OPFS persistence backend — delivered in a follow-on storage backend task.
- Native SQLite backends — delivered in platform binding tasks.
