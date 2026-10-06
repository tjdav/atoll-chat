# User-Scoped Sync Plugin (`sync`)

### Import pattern

The `client.context` uses a Phase 1 async dynamic import to load `../lib/sync/index.js` into the browser bundle. This is required: static top-level imports in the plugin file are not hoisted into the serialized client bundle. See `docs/plugins/README.md` for the cross-cutting rule.

The `sync` plugin provides user-scoped synchronization against `GET /users/me/sync`, updating local database state across read positions, devices, and starred items, and maintaining the durable sequence cursor in `_meta`.

## 1. Overview

The `sync` plugin manages user-scoped data synchronisation per spec §4.7 and server spec §8.2.4. It fetches user-scoped delta changes since `last_user_seq`, applies rows to local SQLite repositories, and updates the sequence cursor.

## 2. The `ctx.sync` Contract

The `sync` plugin name **is** the namespace. The context resolver returns methods directly on `ctx.sync` without an inner wrapper key (`await ctx.sync.runUserScopedSync({ userId, api, storage })`, NOT `await ctx.sync.sync.runUserScopedSync(...)`).

```javascript
const result = await ctx.sync.runUserScopedSync({
  userId: 'u_123',
  api: ctx.api,
  storage: ctx.storage,
  onProgress: (phase, detail) => console.log(phase, detail)
})
```

### Signature & Return Shape

- **Signature**: `runUserScopedSync({ userId, api, storage, onProgress }): Promise<{ applied: { readState: number, deviceState: number, starredItems: number }, cursor: number, fullResync: boolean }>`
- **`userId`**: Required string identifying the local user.
- **`api`**: API client singleton supporting `.get(path, { query })`.
- **`storage`**: Storage plugin client context providing `storage.repos()` and `storage.meta`.
- **`onProgress`**: Optional diagnostic callback called with phase names (`'fetch'`, `'apply-read-state'`, `'apply-device-state'`, `'apply-starred'`, `'store-cursor'`).

## 3. The Cursor

The user-scoped sync sequence cursor is stored in the `_meta` table under the key `last_user_seq`.

- Before the request, the client reads `last_user_seq` (defaulting to `0` if unset).
- `GET /users/me/sync?since_seq=X` fetches all changes strictly after sequence `X`.
- After applying all response sections successfully, the client writes `max_seq` back to `_meta` under key `last_user_seq`.

## 4. The Server Response

Per server spec §8.2.4, `GET /users/me/sync` returns JSON:

```json
{
  "read_state": [],
  "user_preferences": [],
  "device_state": [],
  "starred_items": [],
  "max_seq": 1042,
  "full_resync_required": false
}
```

## 5. What Is Applied

Response sections are applied sequentially in order:

1. **`read_state`**: Applied via `repos.readState.upsert({ userId, roomId, lastReadMessageId })`. Tombstoned rows (`deleted_at !== null`) are skipped.
2. **`device_state`**: Applied in `user_seq` order via `repos.deviceNames.applyBatch(userId, rows)`.
3. **`starred_items`**: Applied in `user_seq` order via `repos.starredItems.applyBatch(userId, rows)`. ISO 8601 timestamps (`starred_at`) are parsed to millisecond epoch numbers.

## 6. What Is Deferred

The server's `user_preferences` array is deliberately **deferred** in this task. Client settings and preferences are stored across domain tables (`room_order`, `nicknames`) or `_meta` (`read_aloud_settings`). A follow-on task maps each preference key to its specific target repository or metadata key.

## 7. `full_resync_required`

When the server returns `"full_resync_required": true` (e.g. sequence window truncated):

1. The client resets `last_user_seq` in `_meta` to `0`.
2. Returns `{ applied: { readState: 0, deviceState: 0, starredItems: 0 }, cursor: 0, fullResync: true }` without looping internally.
3. The caller (e.g. boot flow) decides whether or when to execute a fresh sync starting from zero.

## 8. Concurrency

The client plugin context captures an `inFlight` promise during runtime. Concurrent calls to `ctx.sync.runUserScopedSync` within the same tick share the single active network request and return the same promise result, preventing duplicate network fetches.

## 9. Failure Modes

- **Network Failures**: Errors during `api.get` throw and propagate. The cursor `last_user_seq` is NOT updated.
- **Database Application Errors**: Failures in repository writes throw and propagate. The cursor `last_user_seq` is NOT updated (fail-closed invariant).
- **SSR Usage**: Calling `ctx.sync.runUserScopedSync` on the server throws a descriptive `Error` ("sync.runUserScopedSync is not available during SSR. The sync flow is client-only.").

## 10. What Is Not Implemented

- WebSocket live update subscription (handled by future socket plugin).
- Per-room message delta sync (`sync_state` cursor).
- Reconnect auto-retry logic.
- Boot retry loop.
