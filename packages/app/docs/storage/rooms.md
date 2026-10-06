# Rooms Domain Storage Contract

## 1. Purpose

The rooms domain manages client-side caching for room metadata, room member associations, and per-user custom display ordering. It serves as the primary storage layer underlying conversation list rendering, room header state, and room membership lookups.

## 2. Schema

Defined in `packages/app/src/db/migrations/0003-rooms.sql`.

### `rooms` Table

| Column | Type | Constraints | Description |
| --- | --- | --- | --- |
| `room_id` | `TEXT` | `PRIMARY KEY` | Unique room identifier assigned by server. |
| `name` | `TEXT` | `NULLABLE` | Decrypted room display name (derived for 1:1 rooms). |
| `avatar_file_id` | `TEXT` | `NULLABLE` | Attachment file identifier for room avatar image. |
| `description` | `TEXT` | `NULLABLE` | Decrypted room topic/description text. |
| `disappearing_timer` | `INTEGER` | `NULLABLE` | Disappearing message expiration timer in seconds (`NULL` = off). |
| `metadata_version` | `INTEGER` | `NOT NULL DEFAULT 1` | Monotonic metadata version from server updates. |
| `updated_at` | `INTEGER` | `NOT NULL` | Local update timestamp in milliseconds since epoch. |

*Index*: `idx_rooms_updated_at ON rooms(updated_at)`

### `room_members` Table

| Column | Type | Constraints | Description |
| --- | --- | --- | --- |
| `room_id` | `TEXT` | `NOT NULL` | Associated room identifier. |
| `user_id` | `TEXT` | `NOT NULL` | Associated user identifier. |
| `role` | `TEXT` | `NOT NULL` | User role in room (`'owner'`, `'moderator'`, `'member'`). |
| `joined_at` | `INTEGER` | `NOT NULL` | Server join timestamp in milliseconds since epoch. |

*Primary Key*: `(room_id, user_id)`
*Index*: `idx_room_members_user ON room_members(user_id)`

### `room_order` Table

| Column | Type | Constraints | Description |
| --- | --- | --- | --- |
| `room_id` | `TEXT` | `PRIMARY KEY` | Ordered room identifier. |
| `position` | `INTEGER` | `NOT NULL` | Dense zero-based ordering index. |
| `updated_at` | `INTEGER` | `NOT NULL` | Timestamp when order entry was saved. |

*Index*: `idx_room_order_position ON room_order(position)`

## 3. Rooms Repository

Exported via `createRoomsRepository({ db })` from `packages/app/src/lib/db/repositories/rooms.js`.

- `get(roomId)` -> `Promise<object | undefined>`: Returns room record or `undefined`.
- `upsert({ roomId, name, avatarFileId, description, disappearingTimer, metadataVersion })` -> `Promise<{ changes: number }>`: Performs partial update via `COALESCE`.
- `remove(roomId)` -> `Promise<{ changes: number }>`: Deletes room row and cascades cleanup to `room_members` and `room_order` in a single transaction.
- `list({ limit = 100, cursor })` -> `Promise<Array<object>>`: Returns rooms page ordered by `updated_at DESC`.
- `count()` -> `Promise<number>`: Returns total cached room count.
- `clearAll()` -> `Promise<{ changes: number }>`: Deletes all rows across `rooms`, `room_members`, and `room_order` in a single transaction.

## 4. Room Members Repository

Exported via `createRoomMembersRepository({ db })` from `packages/app/src/lib/db/repositories/room-members.js`.

- `listInRoom(roomId)` -> `Promise<Array<object>>`: Returns all room members ordered by `joined_at ASC`.
- `get(roomId, userId)` -> `Promise<object | undefined>`: Returns single member record or `undefined`.
- `addMember({ roomId, userId, role, joinedAt })` -> `Promise<{ changes: number }>`: Upserts membership record.
- `removeMember(roomId, userId)` -> `Promise<{ changes: number }>`: Deletes member record.
- `removeAllInRoom(roomId)` -> `Promise<{ changes: number }>`: Deletes all member records for a room.
- `listRoomsForUser(userId)` -> `Promise<Array<string>>`: Returns room identifiers joined by user ordered by `joined_at DESC`.
- `countInRoom(roomId)` -> `Promise<number>`: Returns member count for a room.
- `clearAll()` -> `Promise<{ changes: number }>`: Deletes all membership rows.

## 5. Room Order Repository

Exported via `createRoomOrderRepository({ db })` from `packages/app/src/lib/db/repositories/room-order.js`.

- `list()` -> `Promise<Array<string>>`: Returns room identifiers ordered by `position ASC`.
- `setOrder(roomIds)` -> `Promise<{ changes: number }>`: Replaces order sequence atomically in a transaction with dense zero-based indices.
- `moveBefore(roomId, beforeRoomId)` -> `Promise<{ changes: number }>`: Reorders `roomId` before `beforeRoomId` and saves via `setOrder`.
- `getPosition(roomId)` -> `Promise<number | undefined>`: Returns zero-based position index or `undefined`.
- `clearAll()` -> `Promise<{ changes: number }>`: Deletes all room order rows.

## 6. Partial Upsert Semantics

The `rooms` repository uses SQLite `COALESCE(excluded.col, rooms.col)` for `name`, `avatar_file_id`, `description`, and `disappearing_timer`.
- Omitted fields or explicit `null` arguments preserve existing cached values.
- `metadata_version` always replaces existing value with provided parameter (defaulting to `1`).
- `updated_at` always updates to current execution timestamp `Date.now()`.

## 7. Referential Integrity & Transactions

No database-level foreign key constraints are declared, maintaining backend engine compatibility. Multi-table operations (`rooms.remove`, `rooms.clearAll`, `roomOrder.setOrder`) wrap statements in `db.transaction(async () => { ... })` to guarantee atomicity.

## 8. Cache Eviction

Cache eviction policies are unmanaged by repositories. `updated_at` timestamps on room rows provide necessary indexing for LRU/TTL eviction passes in future tasks.

## 9. Population & Lifecycle

Repositories provide storage primitives and do not perform network fetches, RMK room key decryption, or event handling. Synchronizing storage with sync events (`room.*`) and UI list components is handled by higher-level plugins and application features.
