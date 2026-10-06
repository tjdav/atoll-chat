# Users Repository Contract

## 1. Purpose

The `users` table caches display names, identity public keys, and profile versions for users encountered by the client. It supports Step 1 ("Cached display name") of the display-name resolution chain defined in Client Spec §13.2.

## 2. Schema

Defined in `packages/app/src/db/migrations/0002-users.sql`:

```sql
CREATE TABLE IF NOT EXISTS users (
  user_id         TEXT PRIMARY KEY,
  display_name    TEXT,
  identity_pubkey TEXT,
  profile_version INTEGER NOT NULL DEFAULT 1,
  cached_at       INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_cached_at ON users(cached_at);
```

- `user_id`: Server user identifier (primary key).
- `display_name`: Decrypted display name (nullable).
- `identity_pubkey`: User identity public key in base64url format (nullable).
- `profile_version`: Monotonic profile version (default `1`).
- `cached_at`: Timestamp (ms since epoch) when the row was last written or updated.

## 3. Repository Methods

Factory: `createUsersRepository({ db })` in `packages/app/src/lib/db/repositories/users.js`.

- `get(userId)`: Returns cached user object or `undefined`.
- `upsert({ userId, displayName, identityPubkey, profileVersion })`: Inserts or updates user metadata using partial upsert semantics. Automatically sets `cached_at = Date.now()`.
- `remove(userId)`: Deletes user record by `user_id`. Returns `{ changes }`.
- `list({ limit = 100, cursor } = {})`: Returns a page of user records sorted by `cached_at DESC`.
- `count()`: Returns total number of cached user rows.
- `clearAll()`: Deletes all records from `users`. Returns `{ changes }`.

## 4. Partial Upsert Semantics

`upsert` uses SQLite `ON CONFLICT DO UPDATE SET` with `COALESCE`:

```sql
INSERT INTO users (user_id, display_name, identity_pubkey, profile_version, cached_at)
VALUES (?, ?, ?, ?, ?)
ON CONFLICT(user_id) DO UPDATE SET
  display_name    = COALESCE(excluded.display_name, users.display_name),
  identity_pubkey = COALESCE(excluded.identity_pubkey, users.identity_pubkey),
  profile_version = excluded.profile_version,
  cached_at       = excluded.cached_at
```

Non-provided or explicit `null` arguments retain existing values in `display_name` and `identity_pubkey`.

## 5. Cache Eviction

Row eviction is not executed by this repository. The `cached_at` column is indexed and populated so follow-on cache management jobs can prune stale entries based on access age.

## 6. Population

The users repository is a domain storage primitive. Downstream message processing, member list fetching, and user lookup workflows populate and query this repository.
