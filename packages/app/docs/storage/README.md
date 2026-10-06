# Storage

The storage layer persists client-side data in SQLite (WASM+OPFS on web,
native on Tauri/Capacitor). This directory documents the schema, the migration
workflow, and the repository layer.

## Guides

| Guide | Purpose |
|---|---|
| [repositories.md](./repositories.md) | Repository convention: factory shape, async contract, file layout. |
| [users.md](./users.md) | The users table and its repository. |
| [rooms.md](./rooms.md) | The rooms, room members, and room order tables and their repositories. |
| [messages.md](./messages.md) | The messages and message_versions tables and their repository. |
| [attachments.md](./attachments.md) | The attachments table and its repository. |
| [reactions.md](./reactions.md) | The reactions table and its repository. |
| [read-state.md](./read-state.md) | The read_state table and its repository. |
| [drafts.md](./drafts.md) | The drafts table and its repository. |
| [blocked-users.md](./blocked-users.md) | The blocked_users table and its repository. |
| [outbox.md](./outbox.md) | The outbox queue for outgoing messages. |
| [room-preferences.md](./room-preferences.md) | The room_preferences table and its repository. |
| [nicknames.md](./nicknames.md) | The nicknames table and its repository. |
| [device-names.md](./device-names.md) | The device_names table and its repository. |
| [starred-items.md](./starred-items.md) | The starred_items table and its repository. |

## Related

- `packages/app/docs/plugins/storage.md` — the storage plugin's `ctx.storage` surface.
- `packages/app/src/db/migrations/` — the migration files.
