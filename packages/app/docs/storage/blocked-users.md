# Blocked Users Domain Storage Contract

## 1. Overview

The `blocked_users` table maintains the local block list. It feeds the blocked users settings screen (§17.2) and allows message rendering components to suppress or collapse messages sent by blocked users.

## 2. Schema

```sql
CREATE TABLE IF NOT EXISTS blocked_users (
  user_id     TEXT PRIMARY KEY,
  blocked_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_blocked_users_blocked_at ON blocked_users(blocked_at);
```

### Column Semantics

- **`user_id`**: User identifier of the blocked user. Primary key.
- **`blocked_at`**: Milliseconds since epoch when the user was blocked.

## 3. Repository API

The repository factory is exported from `@atoll/app/lib/db/repositories/blocked-users.js`:

```javascript
import { createBlockedUsersRepository } from './blocked-users.js'

const blockedUsers = createBlockedUsersRepository({ db })
```

### Methods

- **`isBlocked(userId)`**: Returns `true` if the user is in the block list, `false` otherwise.
- **`list()`**: Returns all blocked user rows ordered by `blocked_at DESC`.
- **`add(userId)`**: Adds a user to the block list using `INSERT OR REPLACE`. Re-blocking an existing user updates `blocked_at`.
- **`remove(userId)`**: Removes a user from the block list.
- **`count()`**: Returns the total number of blocked users.
- **`clearAll()`**: Deletes all blocked user rows.

## 4. Local Storage & Message Filtering

- **Local Storage**: The block list is maintained locally in SQLite.
- **Message Filtering**: UI thread components query `isBlocked(userId)` to suppress or collapse incoming messages and notifications from blocked senders.
