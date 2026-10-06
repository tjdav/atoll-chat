# Read State Domain Storage Contract

## 1. Overview

The `read_state` table tracks the local user's read position and manual unread flag per room. It feeds the unread badge in the conversation list, the "new messages" divider in the thread renderer, and the "mark as read / unread" user action flow.

## 2. Schema

```sql
CREATE TABLE IF NOT EXISTS read_state (
  user_id               TEXT NOT NULL,
  room_id               TEXT NOT NULL,
  last_read_message_id  TEXT,
  last_read_at          INTEGER,
  marked_unread         INTEGER NOT NULL DEFAULT 0,
  updated_at            INTEGER NOT NULL,
  PRIMARY KEY (user_id, room_id)
);

CREATE INDEX IF NOT EXISTS idx_read_state_room ON read_state(room_id);
```

### Column Semantics

- **`user_id`**: Identifier of the user whose read state is stored. In practice, this is the local authenticated user. Retained in the primary key to match the server's §7.2 schema and support multi-account parity without migrations.
- **`room_id`**: Room identifier.
- **`last_read_message_id`**: ID of the most recently read message in the room. `NULL` if the room has never been read.
- **`last_read_at`**: Local wall-clock timestamp (milliseconds since epoch) when the read position was set. Local-only; not synced. Used to position the "new messages" divider.
- **`marked_unread`**: Integer flag (`0` or `1`) indicating whether the user manually marked the room as unread.
- **`updated_at`**: Milliseconds since epoch when the row was written.

## 3. Repository API

The repository factory is exported from `@atoll/app/lib/db/repositories/read-state.js`:

```javascript
import { createReadStateRepository } from './read-state.js'

const readState = createReadStateRepository({ db })
```

### Methods

- **`get(userId, roomId)`**: Returns the read state row object or `undefined` if missing.
- **`getForRoom(roomId, userId)`**: Convenience wrapper for `get(userId, roomId)`.
- **`upsert({ userId, roomId, lastReadMessageId, lastReadAt })`**: Inserts or updates the read position (`last_read_message_id`, `last_read_at`). Preserves `marked_unread` without overwriting it.
- **`setMarkedUnread(userId, roomId, markedUnread)`**: Sets `marked_unread` to `1` or `0`. Inserts a minimal row if no read state exists.
- **`clearMarkedUnread(userId, roomId)`**: Convenience wrapper for `setMarkedUnread(userId, roomId, false)`.
- **`listForUser(userId)`**: Returns all read state records for a user ordered by `updated_at DESC`.
- **`remove(userId, roomId)`**: Deletes the read state row for a room and user pair.
- **`clearAll()` / `removeAll()`**: Deletes all read state rows.

## 4. Manual Unread Flag Policy

The `marked_unread` flag is maintained independently from `upsert`. Read position updates (`upsert`) occur automatically on scroll and thread view, preserving `marked_unread`. Setting or clearing `marked_unread` is explicitly controlled via `setMarkedUnread` and `clearMarkedUnread`.

## 5. Sync Integration & Rate Limits

Read state changes are synced to `POST /users/me/read-state` and received via `read.sync` events (§16.10).
The repository stores local rows without enforcing network rate limits. The calling sync manager enforces the spec requirement: "at most one POST per room per 30 seconds", with immediate flush on room switch or backgrounding.
