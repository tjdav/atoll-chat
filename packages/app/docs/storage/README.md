# Storage

The storage layer persists client-side data in SQLite (WASM+OPFS on web,
native on Tauri/Capacitor). This directory documents the schema, the migration
workflow, and the repository layer.

## Guides

| Guide | Purpose |
|---|---|
| [repositories.md](./repositories.md) | Repository convention: factory shape, async contract, file layout. |
| [users.md](./users.md) | The users table and its repository. |

## Related

- `packages/app/docs/plugins/storage.md` — the storage plugin's `ctx.storage` surface.
- `packages/app/src/db/migrations/` — the migration files.
