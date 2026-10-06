# Room Preferences Storage Contract

## 1. Purpose

The `room_preferences` table persists per-room per-user settings that define custom room presentation and user disclosure state:

- Per-room per-user theming tokens (`theme`, `wallpaper`, `bubble_style`).
- Room settings disclosure section collapse states (`collapse:members`, `collapse:notifications`, `collapse:media_storage`, `collapse:retention`).

## 2. Schema

Defined in `packages/app/src/db/migrations/0008-room-preferences-nicknames.sql`:

```sql
CREATE TABLE IF NOT EXISTS room_preferences (
  user_id     TEXT NOT NULL,
  room_id     TEXT NOT NULL,
  key         TEXT NOT NULL,
  value_json  TEXT NOT NULL,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (user_id, room_id, key)
);

CREATE INDEX IF NOT EXISTS idx_room_preferences_room ON room_preferences(user_id, room_id);
```

### Column Semantics

- `user_id`: The local user identifier who owns the preference value.
- `room_id`: The room to which the preference applies.
- `key`: Stable string identifier for the preference setting.
- `value_json`: JSON-serialized preference value.
- `updated_at`: Monotonic timestamp (milliseconds since epoch).

## 3. Generic Key-Value Shape

The `key` set is open and unconstrained by the repository. Callers are responsible for maintaining key naming consistency:

- `theme`: Theme identifier or object override.
- `wallpaper`: Image URL or preset name.
- `bubble_style`: Chat bubble layout style.
- `collapse:<section>`: Convention for section disclosure collapse boolean state.

## 4. Repository API

Factory: `createRoomPreferencesRepository({ db })` in `packages/app/src/lib/db/repositories/room-preferences.js`.

- `get(userId, roomId, key)`: Returns the deserialized value or `undefined` if missing/malformed.
- `getAll(userId, roomId)`: Returns a key-value mapping object for all preferences in the room.
- `set(userId, roomId, key, value)`: Upserts a preference value. Throws `Error` if non-serializable.
- `setMany(userId, roomId, entries)`: Upserts multiple key-value pairs within a single transaction using a single timestamp.
- `remove(userId, roomId, key)`: Deletes a single preference entry.
- `removeAllInRoom(userId, roomId)`: Deletes all preferences for a user in a room (called on room leave).
- `listKeys(userId, roomId)`: Returns sorted list of preference keys present for a room.
- `count(userId)`: Returns total preference count across all rooms for a user.
- `clearAll()`: Clears all rows from `room_preferences`.

## 5. Primary Key & Multi-Account Parity

`user_id` is included in `PRIMARY KEY (user_id, room_id, key)` for parity with the server's `user_preferences` schema and to support multi-account devices without future migrations.

## 6. Transactions & Error Handling

- `setMany` wraps entries in `db.transaction`. If serialization or database execution fails, the entire batch rolls back.
- `set` throws a plain `Error` if `JSON.stringify(value)` returns `undefined`.

## 7. Malformed JSON Handling

If `value_json` contains malformed JSON:
- `get` returns `undefined` (treated as missing) without throwing.
- `getAll` skips the malformed row.
- The raw row remains in SQLite for diagnostic inspection.

## 8. Key Conventions

- Section collapse state: `collapse:members`, `collapse:notifications`, `collapse:media_storage`, `collapse:retention`.
- Theming tokens: `theme`, `wallpaper`, `bubble_style`.

## 9. Sync Boundary

Per-room per-user preferences are synced via user preferences on the server. The local repository operates offline-first; sync integration is handled in a separate layer.

## 10. Room Cleanup

When a user leaves or deletes a room, `removeAllInRoom(userId, roomId)` purges all local preference records for that room.
