# Starred Items Storage Contract

## 1. Purpose

The `starred_items` repository manages locally cached starred items (attachments, messages, links) for the user.

## 2. Schema

Defined in `packages/app/src/db/migrations/0009-device-names-starred-items.sql`:

```sql
CREATE TABLE IF NOT EXISTS starred_items (
  user_id     TEXT NOT NULL,
  item_id     TEXT NOT NULL,
  item_type   TEXT NOT NULL,
  room_id     TEXT NOT NULL,
  user_seq    INTEGER NOT NULL,
  starred_at  INTEGER NOT NULL,
  deleted_at  INTEGER,
  PRIMARY KEY (user_id, item_id, item_type)
);

CREATE INDEX IF NOT EXISTS idx_starred_items_seq ON starred_items(user_id, user_seq);
CREATE INDEX IF NOT EXISTS idx_starred_items_room ON starred_items(user_id, room_id, starred_at DESC);
```

## 3. The Repository

Factory function `createStarredItemsRepository({ db })` in `packages/app/src/lib/db/repositories/starred-items.js`.

Methods:

- `get(userId, itemId, itemType)` -> `Promise<object | undefined>`
- `isStarred(userId, itemId, itemType)` -> `Promise<boolean>`
- `listForUser(userId, { type, roomId, limit, cursor })` -> `Promise<Array<object>>`
- `listForRoom(userId, roomId)` -> `Promise<Array<object>>`
- `applyRemote({ userId, itemId, itemType, roomId, userSeq, starredAt, deletedAt })` -> `Promise<{ changes: number }>`
- `applyAddedEvent({ userId, itemId, itemType, roomId, userSeq })` -> `Promise<{ changes: number }>`
- `applyRemovedEvent({ userId, itemId, itemType, userSeq })` -> `Promise<{ changes: number }>`
- `applyBatch(userId, rows)` -> `Promise<{ applied: number, skipped: number }>`
- `remove(userId, itemId, itemType)` -> `Promise<{ changes: number }>`
- `countForUser(userId)` -> `Promise<number>`
- `countByType(userId, itemType)` -> `Promise<number>`
- `getHighestSeq(userId)` -> `Promise<number>`
- `clearAll()` -> `Promise<{ changes: number }>`

## 4. The Three Item Types

Supported item types include `'attachment'`, `'message'`, and `'link'`. There is no CHECK constraint in client SQLite schema so future item types sent by server require no client schema migration. Callers pass string values.

## 5. The `user_seq` Contract

As with other sync-backed tables, application compares `user_seq`. Rows with `user_seq <= existing.user_seq` are skipped.

## 6. Tombstones

Unstarring an item creates a tombstone (`deleted_at` set to timestamp) rather than hard deleting the row. This preserves sequence state across sync reconciliation.

## 7. Event Handlers

`applyAddedEvent` applies `starred_item.added` socket events, defaulting `starred_at` to local `Date.now()`. `applyRemovedEvent` applies `starred_item.removed` socket events, marking existing items as tombstoned.

## 8. Local-Only Operations

`remove` performs a hard delete for testing or clearing local state. Production unstar actions process tombstones via `applyRemovedEvent`.

## 9. Filtering

`listForUser` composes optional `type` and `roomId` parameters and cursor-based pagination parameters (`{ starredAt, itemId }`) into parameterized SQL WHERE clauses.

## 10. Cursor Shape

When paginating via `listForUser`, `cursor` is passed as `{ starredAt, itemId }`, matching the secondary order `ORDER BY starred_at DESC, item_id DESC`.
