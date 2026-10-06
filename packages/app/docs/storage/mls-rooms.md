# MLS Rooms Storage Contract

## 1. Purpose

The `mls_rooms` table and repository store client-visible MLS (Messaging Layer Security) group state metadata for each room.
While the WASM CoreCrypto keystore maintains all sensitive cryptographic material (group secrets, leaf keys, tree nodes, and commit state), `mls_rooms` stores the client-facing metadata read by the UI shell and sync logic (e.g. membership status, current epoch, local client ID, transcript hash).

## 2. Schema

```sql
CREATE TABLE IF NOT EXISTS mls_rooms (
  room_id                   TEXT PRIMARY KEY,
  local_client_id           TEXT,
  current_epoch             INTEGER NOT NULL DEFAULT 0,
  membership_status         TEXT NOT NULL DEFAULT 'pending',
  confirmed_transcript_hash BLOB,
  last_error                TEXT,
  joined_at                 INTEGER,
  updated_at                INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mls_rooms_status ON mls_rooms(membership_status);
```

### Column Descriptions

- `room_id`: Room identifier. Primary key.
- `local_client_id`: The client device ID within the MLS group. `NULL` prior to group join.
- `current_epoch`: Monotonic counter representing the current MLS epoch for the group as reported by CoreCrypto.
- `membership_status`: Group lifecycle status (`'pending'`, `'joined'`, `'left'`, `'error'`).
- `confirmed_transcript_hash`: Confirmed MLS transcript hash as a `BLOB`. `NULL` before initial commit.
- `last_error`: Human-readable diagnostic message when in `'error'` status; `NULL` otherwise.
- `joined_at`: Timestamp (milliseconds since Unix epoch) when state transitioned to `'joined'`.
- `updated_at`: Timestamp (milliseconds since Unix epoch) when record was last updated.

## 3. Strict Non-Cryptographic Invariant

`mls_rooms` contains **no cryptographic keys, secrets, key packages, or raw group state**. All cryptographic primitives and keys remain isolated within the WASM CoreCrypto keystore. `mls_rooms` serves strictly as a client-visible metadata cache for UI rendering and status inspection.

## 4. Repository Methods

Factory: `createMlsRoomsRepository({ db })`

### `get(roomId)`

- **Parameters**: `roomId` (`string`)
- **Returns**: `Promise<object | undefined>`
- Retrieves MLS metadata row for `roomId`, or `undefined` if not present.

### `upsert({ roomId, localClientId, currentEpoch, membershipStatus, confirmedTranscriptHash, lastError, joinedAt })`

- **Parameters**: Object with room metadata properties.
- **Returns**: `Promise<{ changes: number }>`
- Partial upsert using `ON CONFLICT ... DO UPDATE`. Unprovided fields retain existing values via `COALESCE` or `CASE WHEN`. Explicitly provided non-null `currentEpoch` or `membershipStatus` replace stored values.

### `markJoined(roomId, { localClientId, currentEpoch, confirmedTranscriptHash })`

- **Parameters**: `roomId` (`string`), optional state overrides.
- **Returns**: `Promise<{ changes: number }>`
- Transitions room `membership_status` to `'joined'`, sets `joined_at` timestamp, clears `last_error`, and updates optional parameters if provided.

### `markLeft(roomId)`

- **Parameters**: `roomId` (`string`)
- **Returns**: `Promise<{ changes: number }>`
- Updates `membership_status` to `'left'`.

### `markError(roomId, message)`

- **Parameters**: `roomId` (`string`), `message` (`string`)
- **Returns**: `Promise<{ changes: number }>`
- Updates `membership_status` to `'error'` and stores diagnostic string in `last_error`.

### `advanceEpoch(roomId, { epoch, confirmedTranscriptHash })`

- **Parameters**: `roomId` (`string`), `epoch` (`number`), optional `confirmedTranscriptHash` (`Uint8Array`)
- **Returns**: `Promise<{ changes: number }>`
- Narrow update advancing `current_epoch` and optionally updating transcript hash.

### `listByStatus(status)`

- **Parameters**: `status` (`'pending' | 'joined' | 'left' | 'error'`)
- **Returns**: `Promise<Array<object>>`
- Lists all MLS rooms matching `status`, ordered by `updated_at DESC`.

### `listJoined()`

- **Returns**: `Promise<Array<object>>`
- Convenience wrapper returning `listByStatus('joined')`.

### `remove(roomId)`

- **Parameters**: `roomId` (`string`)
- **Returns**: `Promise<{ changes: number }>`
- Removes MLS metadata row for `roomId`.

### `clearAll()`

- **Returns**: `Promise<{ changes: number }>`
- Deletes all records from `mls_rooms`.

## 5. Membership Status Transitions

- `'pending'`: Welcome message received; local MLS group initialization pending. Default on insert.
- `'joined'`: Local client successfully joined and active in MLS group.
- `'left'`: Local client left or was removed from group.
- `'error'`: Unrecoverable MLS failure (e.g. keystore corruption, missing welcome, epoch mismatch). `last_error` holds details.

## 6. Mirroring CoreCrypto Epoch

`mls_rooms.current_epoch` mirrors the epoch counter inside CoreCrypto. Every time CoreCrypto processes a commit or proposal that advances the group epoch, the MLS manager invokes `advanceEpoch` or `upsert` to keep `mls_rooms` synchronized.
