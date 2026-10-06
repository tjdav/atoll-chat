# Sync State Storage Contract

## 1. Purpose

The `sync_state` table and repository maintain per-room message sync cursors stored as `(epoch, seq)` pairs.
When a room sync runs, the client reads the stored cursor for the room, fetches new messages occurring after that cursor, and advances the cursor upon successful processing. On reconnection or app launch, reading this table prevents refetching full message histories for previously synced rooms.

## 2. Schema

```sql
CREATE TABLE IF NOT EXISTS sync_state (
  room_id     TEXT PRIMARY KEY,
  epoch       INTEGER NOT NULL DEFAULT 0,
  seq         INTEGER NOT NULL DEFAULT 0,
  updated_at  INTEGER NOT NULL
);
```

### Column Descriptions

- `room_id`: The room identifier. Primary key. One cursor record per room.
- `epoch`: The highest MLS epoch sequence up to which messages in the room have been synced.
- `seq`: The highest sequence number within the given epoch up to which messages have been synced.
- `updated_at`: Timestamp (milliseconds since Unix epoch) when the cursor was last updated or advanced.

## 3. Repository Methods

Factory: `createSyncStateRepository({ db })`

### `get(roomId)`

- **Parameters**: `roomId` (`string`)
- **Returns**: `Promise<object | undefined>`
- Retrieves the raw `sync_state` row for `roomId`, or `undefined` if no cursor exists.

### `getCursor(roomId)`

- **Parameters**: `roomId` (`string`)
- **Returns**: `Promise<{ epoch: number, seq: number } | undefined>`
- Convenience getter returning `{ epoch, seq }` for `roomId`, or `undefined` if uninitialized.

### `set(roomId, { epoch, seq })`

- **Parameters**: `roomId` (`string`), `cursor` (`{ epoch: number, seq: number }`)
- **Returns**: `Promise<{ changes: number }>`
- Unconditionally sets or overwrites the cursor for `roomId`.

### `advance(roomId, { epoch, seq })`

- **Parameters**: `roomId` (`string`), `cursor` (`{ epoch: number, seq: number }`)
- **Returns**: `Promise<{ changes: number }>`
- Monotonically advances the cursor for `roomId`. Performs an atomic check in JavaScript comparing `(epoch, seq)` against the existing row; if the proposed cursor is less than or equal to the stored cursor, returns `{ changes: 0 }` without updating. Returns `{ changes: 1 }` on successful advancement.

### `list()`

- **Returns**: `Promise<Array<object>>`
- Returns all `sync_state` rows ordered by `updated_at DESC`.

### `remove(roomId)`

- **Parameters**: `roomId` (`string`)
- **Returns**: `Promise<{ changes: number }>`
- Removes the stored cursor for `roomId`.

### `clearAll()`

- **Returns**: `Promise<{ changes: number }>`
- Deletes all records from `sync_state`.

## 4. Cursor Ordering & Monotonicity Rules

- Messages and cursors are ordered primarily by `epoch` and secondarily by `seq`.
- A cursor `(epoch_B, seq_B)` is strictly greater than `(epoch_A, seq_A)` if:
  - `epoch_B > epoch_A`, OR
  - `epoch_B == epoch_A` AND `seq_B > seq_A`.
- `advance()` enforces this ordering to guarantee that stale sync responses or out-of-order background job executions never regress the room cursor.

## 5. `set` vs `advance`

- Use `advance()` during routine message ingestion and live event stream updates where concurrent processes or out-of-order network responses may arrive.
- Use `set()` when performing explicit administrative resets or initial migration seeding.

## 6. Lifecycle

- Row created on first successful sync or message fetch in a room.
- Row updated/advanced as message batches are processed.
- Row deleted when the room is left or cleared from local storage.
