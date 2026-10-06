# Drafts Domain Storage Contract

## 1. Overview

The `drafts` table stores unsent text entered into the message composer per room. It feeds the conversation list's "Draft" indicator (§13.9) and repopulates the composer when the user re-enters a room thread.

## 2. Schema

```sql
CREATE TABLE IF NOT EXISTS drafts (
  room_id     TEXT PRIMARY KEY,
  text        TEXT NOT NULL,
  updated_at  INTEGER NOT NULL
);
```

### Column Semantics

- **`room_id`**: Room identifier. Primary key (at most one draft per room).
- **`text`**: Unsent draft text string. Non-empty.
- **`updated_at`**: Milliseconds since epoch when the draft was updated.

## 3. Repository API

The repository factory is exported from `@atoll/app/lib/db/repositories/drafts.js`:

```javascript
import { createDraftsRepository } from './drafts.js'

const drafts = createDraftsRepository({ db })
```

### Methods

- **`get(roomId)`**: Returns the draft row object or `undefined` if missing.
- **`getText(roomId)`**: Convenience method returning the draft `text` string or `null`.
- **`set(roomId, text)`**: Inserts or replaces the draft row. Empty or whitespace-only text automatically deletes the draft row.
- **`remove(roomId)`**: Deletes the draft row for the specified room.
- **`list()`**: Returns all draft rows ordered by `updated_at DESC`.
- **`count()`**: Returns the total number of drafts.
- **`clearAll()`**: Deletes all draft rows.

## 4. Local-Only & Lifecycle Semantics

- **Local Only**: Drafts are stored locally and are never synced to the server.
- **Empty Draft Deletion**: Calling `set(roomId, text)` with empty string or whitespace-only text deletes the row via `remove(roomId)`.
- **Room Deletion Cleanup**: When a room is removed, the calling manager triggers `remove(roomId)` to prevent orphan rows.
