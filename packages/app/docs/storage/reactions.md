# Reactions Domain Contract

## 1. Purpose
The `reactions` table records active user reactions on messages. Reactions are silent per spec §11.7 (no unread badges, notifications, or read receipts).

## 2. Schema
Defined in `packages/app/src/db/migrations/0005-attachments-reactions.sql`:

```sql
CREATE TABLE IF NOT EXISTS reactions (
  message_id          TEXT NOT NULL,
  sender_user_id      TEXT NOT NULL,
  sender_client_id    TEXT NOT NULL,
  reaction            TEXT NOT NULL,
  created_at          INTEGER NOT NULL,
  deleted_at          INTEGER,
  PRIMARY KEY (message_id, sender_user_id, sender_client_id, reaction)
);

CREATE INDEX IF NOT EXISTS idx_reactions_message ON reactions(message_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_reactions_user ON reactions(sender_user_id);
```

- `message_id`: ID of the target message.
- `sender_user_id`: ID of the reacting user.
- `sender_client_id`: ID of the device/client that issued the reaction.
- `reaction`: Emoji string or sticker file ID.
- `created_at`: Epoch timestamp (ms) when reaction was added/reactivated.
- `deleted_at`: Epoch timestamp (ms) when reaction was soft-deleted, or `NULL` if active.

## 3. The Four-Tuple Key
Primary key is `(message_id, sender_user_id, sender_client_id, reaction)`. This mirrors server uniqueness, allowing multi-device reactions from a single user to be tracked accurately per device and aggregated at render time.

## 4. The Reactions Repository
Located at `packages/app/src/lib/db/repositories/reactions.js` and instantiated via `createReactionsRepository({ db })`.

### Methods
- `listForMessage(messageId)`: Returns active reactions for a message.
- `listForRoom(roomId)`: Returns active reactions for all messages in a room via INNER JOIN on `messages`.
- `get(messageId, senderUserId, senderClientId, reaction)`: Returns single reaction row or `undefined`.
- `add({ messageId, senderUserId, senderClientId, reaction })`: Inserts reaction or reactivates soft-deleted reaction (setting `deleted_at = NULL`).
- `remove({ messageId, senderUserId, senderClientId, reaction })`: Soft-deletes reaction by setting `deleted_at = Date.now()`.
- `removeByMessage(messageId)`: Hard-deletes all reactions for a deleted message.
- `countForMessage(messageId)`: Returns count of active reactions.
- `aggregateForMessage(messageId)`: Returns aggregated counts per reaction (`[{ reaction, users }]`).
- `hasReacted(messageId, userId, reaction)`: Returns boolean indicating if user has an active reaction across any device.
- `clearAll()`: Hard-deletes all reaction rows.

## 5. Aggregation
`aggregateForMessage(messageId)` uses `COUNT(DISTINCT sender_user_id)` to deduplicate multiple devices owned by the same user into a single user count for UI display.

## 6. Soft Deletes
Reactions are soft-deleted when removed by setting `deleted_at`. Re-adding an identical reaction reactivates the row and sets `deleted_at = NULL`.

## 7. Reaction Values
Reaction strings hold standard UTF-8 emoji characters (e.g. `"👍"`) or custom sticker `file_id` strings.

## 8. The Event Contract
Real-time events `reaction.added` and `reaction.removed` update local repository rows via `add()` and `remove()`.

## 9. Cache Eviction
Soft-deleted reaction tombstones can be cleaned up during future pruning passes.

## 10. Population
The repository is exported via `createRepositories({ db })` in `packages/app/src/lib/db/repositories/index.js`.
