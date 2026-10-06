# Nicknames Storage Contract

## 1. Purpose

The `nicknames` table persists user-scoped aliases for participants in a room. Nicknames are visible only to the local user who defined them and override member display names across chat threads, member lists, reply previews, mention autocompletes, and profile views.

## 2. Schema

Defined in `packages/app/src/db/migrations/0008-room-preferences-nicknames.sql`:

```sql
CREATE TABLE IF NOT EXISTS nicknames (
  room_id     TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  nickname    TEXT NOT NULL,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (room_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_nicknames_user ON nicknames(user_id);
```

### Column Semantics

- `room_id`: The room where the nickname applies.
- `user_id`: The target user being nicknamed.
- `nickname`: The custom alias string.
- `updated_at`: Monotonic timestamp (milliseconds since epoch).

## 3. Repository API

Factory: `createNicknamesRepository({ db })` in `packages/app/src/lib/db/repositories/nicknames.js`.

- `get(roomId, userId)`: Returns the nickname string or `null` if not set.
- `getMany(roomId, userIds)`: Returns a map of `user_id` to nickname for specified users.
- `set(roomId, userId, nickname)`: Upserts a nickname. Empty or whitespace text deletes the entry.
- `remove(roomId, userId)`: Deletes a nickname entry.
- `listInRoom(roomId)`: Returns all nickname records in a room ordered by `user_id ASC`.
- `listRoomsForUser(userId)`: Returns sorted array of `room_id`s where the user has a nickname set.
- `removeAllInRoom(roomId)`: Deletes all nicknames in a room (called on room leave).
- `countInRoom(roomId)`: Returns nickname count in a room.
- `clearAll()`: Clears all rows from `nicknames`.

## 4. Fallback Behavior

When `get(roomId, userId)` returns `null` or `getMany` omits a `user_id`, callers fall back to displaying the member's cached display name from the `users` repository.

## 5. User-Scoped Semantics

Nicknames are entirely local and private to the local user. They are never published to other room members or included in room message payloads.

## 6. Empty Text Auto-Delete

Calling `set(roomId, userId, nickname)` with an empty string or whitespace-only text automatically invokes `remove(roomId, userId)` to delete the row, restoring the display name fallback.

## 7. Efficient Parameterized Lookups

`getMany` builds placeholders (`?, ?`) dynamically based on array length. User IDs are bound exclusively via parameter arrays, preventing SQL syntax injection.

## 8. Sync Boundary

Nicknames sync under the user preferences key `nicknames:{room_id}`. Local storage operates offline-first; sync serialization is handled in follow-on sync tasks.

## 9. Room Cleanup

When a room is removed or left, `removeAllInRoom(roomId)` cleans up all stored nicknames for that room.

## 10. Single-Account Device Assumption

The primary key is `(room_id, user_id)`. If multi-account device support is added in a future release, a migration will extend the primary key to include `owner_user_id`.
