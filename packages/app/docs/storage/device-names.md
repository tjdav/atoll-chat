# Device Names Storage Contract

## 1. Purpose

The `device_names` repository manages cached encrypted device names for the local user's devices.

## 2. Schema

Defined in `packages/app/src/db/migrations/0009-device-names-starred-items.sql`:

```sql
CREATE TABLE IF NOT EXISTS device_names (
  user_id               TEXT NOT NULL,
  device_id             TEXT NOT NULL,
  encrypted_device_name TEXT NOT NULL,
  user_seq              INTEGER NOT NULL,
  updated_at            INTEGER NOT NULL,
  deleted_at            INTEGER,
  PRIMARY KEY (user_id, device_id)
);

CREATE INDEX IF NOT EXISTS idx_device_names_seq ON device_names(user_id, user_seq);
```

## 3. The Repository

Factory function `createDeviceNamesRepository({ db })` in `packages/app/src/lib/db/repositories/device-names.js`.

Methods:

- `get(userId, deviceId)` -> `Promise<object | undefined>`
- `listForUser(userId)` -> `Promise<Array<object>>`
- `listActiveForUser(userId)` -> `Promise<Array<object>>`
- `applyRemote({ userId, deviceId, encryptedDeviceName, userSeq, deletedAt })` -> `Promise<{ changes: number }>`
- `applyBatch(userId, rows)` -> `Promise<{ applied: number, skipped: number }>`
- `getHighestSeq(userId)` -> `Promise<number>`
- `remove(userId, deviceId)` -> `Promise<{ changes: number }>`
- `clearAll()` -> `Promise<{ changes: number }>`

## 4. The `user_seq` Contract

Rows are applied in server sequence (`user_seq`) order. If a row exists with `user_seq >= incoming.userSeq`, the `applyRemote` call is a no-op (`{ changes: 0 }`). Old or stale sync data never overwrites newer state.

## 5. Ciphertext Storage

Device names are stored as base64url-encoded string ciphertext (`encrypted_device_name`). The repository never decrypts ciphertext. Decryption with `device_name_key` (derived via HKDF-Expand from session OPRF token) is a caller concern.

## 6. Tombstones

A revoked device is retained with a non-null `deleted_at` timestamp and an updated `user_seq`. It is excluded from `listActiveForUser` but returned by `listForUser`.

## 7. Sync Integration

The sync task receives `device_state` rows from `GET /users/me/sync` and `device.name_updated` events, applying them through `applyBatch` or `applyRemote`.

## 8. Local-Only Operations

`remove` and `clearAll` hard-delete rows and are used for testing or clearing local application state. They are not part of the standard remote sync flow.

## 9. `getHighestSeq`

`getHighestSeq(userId)` returns `MAX(user_seq)` recorded in the table for a user, or `0` if empty. It is used by sync routines to check local sequence state.
