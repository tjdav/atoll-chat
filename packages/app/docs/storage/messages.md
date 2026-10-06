# Messages Domain Storage Contract

## 1. Purpose

The messages domain provides the primary data store for the application. It stores decrypted message payloads, encrypted ciphertexts for the record, the full edit history (version chain), disappearing message expirations, and local sending states for optimistic UI updates. Every message-thread surface, search indexer, curation view, starred item, and notification references a message identifier.

## 2. Schema

The messages domain consists of two tightly coupled tables defined in `packages/app/src/db/migrations/0004-messages.sql`:

### `messages` Table

| Column | Type | Constraints | Description |
| --- | --- | --- | --- |
| `message_id` | `TEXT` | `PRIMARY KEY` | Server-assigned message ID (or locally generated UUID before confirmation). |
| `room_id` | `TEXT` | `NOT NULL` | The room to which this message belongs. |
| `sender_user_id` | `TEXT` | `NOT NULL` | User ID of the sender. |
| `sender_client_id` | `TEXT` | `NOT NULL` | Client device ID of the sender. |
| `epoch` | `INTEGER` | `NOT NULL` | MLS epoch number. |
| `seq` | `INTEGER` | `NOT NULL` | MLS sequence number within the epoch. |
| `content_type` | `TEXT` | `NOT NULL` | Message type: `'application'`, `'commit'`, or `'proposal'`. |
| `ciphertext` | `BLOB` | `NOT NULL` | Raw encrypted payload as received over the wire. |
| `decrypted_payload` | `TEXT` | Nullable | Plaintext JSON string after decryption. Null if key is missing or decryption pending. |
| `reply_to` | `TEXT` | Nullable | Message ID of the referenced parent message being replied to. |
| `edited_at` | `INTEGER` | Nullable | Timestamp (ms) of the latest edit. Non-null indicates message has been edited. |
| `deleted_at` | `INTEGER` | Nullable | Timestamp (ms) of soft-deletion/tombstone. Non-null indicates deleted state. |
| `expires_at` | `INTEGER` | Nullable | Timestamp (ms) when message expires for disappearing messages timer. |
| `local_status` | `TEXT` | `NOT NULL DEFAULT 'sent'` | Sending state: `'pending'`, `'sending'`, `'sent'`, or `'failed'`. |
| `local_error` | `TEXT` | Nullable | User-facing error message if `local_status = 'failed'`. |
| `created_at` | `INTEGER` | `NOT NULL` | Server-reported creation timestamp in milliseconds. |
| `updated_at` | `INTEGER` | `NOT NULL` | Local database row updated timestamp in milliseconds. |

### Indexes

- `idx_messages_room_epoch_seq`: Composite index on `messages(room_id, epoch DESC, seq DESC)` for cursor pagination.
- `idx_messages_room_created`: Index on `messages(room_id, created_at DESC)` for time-based lookups.
- `idx_messages_expires_at`: Partial index on `messages(expires_at) WHERE expires_at IS NOT NULL` for background cleanup.
- `idx_messages_reply_to`: Partial index on `messages(reply_to) WHERE reply_to IS NOT NULL` for reply tree lookups.

### `message_versions` Table

| Column | Type | Constraints | Description |
| --- | --- | --- | --- |
| `message_id` | `TEXT` | `NOT NULL` | Base message ID. |
| `edit_sequence` | `INTEGER` | `NOT NULL` | Version sequence number (0 = original, 1 = first edit, etc.). |
| `ciphertext` | `BLOB` | `NOT NULL` | Ciphertext corresponding to this specific version. |
| `decrypted_payload` | `TEXT` | Nullable | Plaintext JSON string corresponding to this specific version. |
| `edited_at` | `INTEGER` | `NOT NULL` | Timestamp (ms) when this version was created. |

`PRIMARY KEY (message_id, edit_sequence)`

### Indexes

- `idx_message_versions_message`: Composite index on `message_versions(message_id, edit_sequence ASC)`.

## 3. Ordering

Messages possess an authoritative causal order defined by MLS `(epoch, seq)`. Wall-clock `created_at` timestamps may arrive out of order due to clock skew or network delays. All thread list queries order by `(epoch DESC, seq DESC)`. Cursors for pagination use the composite object `{ epoch, seq }`. Wall-clock `created_at` is preserved solely for UI display grouping and future cache eviction.

## 4. The Messages Repository

Factory signature: `createMessagesRepository({ db })`

### Available Methods

- `get(messageId)` — Returns single message row or `undefined`.
- `upsert(params)` — Partial upsert of base message row (`ON CONFLICT(message_id)`). Replaces `updated_at` with current timestamp.
- `updateLocalStatus(messageId, status, { error } = {})` — Fast-path update for `local_status` and `local_error`.
- `markDeleted(messageId)` — Soft-deletes a message by setting `deleted_at = Date.now()`.
- `remove(messageId)` — Permanently deletes a message and its version rows in a transaction.
- `removeExpired()` — Permanently deletes all messages (and their versions) where `expires_at <= Date.now()`.
- `removeAllInRoom(roomId)` — Permanently deletes all messages and versions in a room in a transaction.
- `listInRoom(roomId, { limit, cursor })` — Returns page of messages in room ordered by `(epoch DESC, seq DESC)`.
- `listApplicationsInRoom(roomId, { limit, cursor })` — Same as `listInRoom`, but filters to `content_type = 'application'`.
- `countInRoom(roomId)` — Total message count in a room.
- `countApplicationsInRoom(roomId)` — Total application message count in a room.
- `upsertVersion(params)` — Inserts or replaces a version row (`INSERT OR REPLACE`).
- `listVersions(messageId)` — Returns full version chain ordered by `edit_sequence ASC`.
- `getVersion(messageId, editSequence)` — Returns single version row or `undefined`.
- `countVersions(messageId)` — Version count for a message.
- `clearAll()` — Deletes all messages and versions in a transaction.

## 5. The Edit Chain

Every edit creates a new signed message on the wire with an incremental `edit_sequence`. The repository stores the version history in `message_versions`:
- `edit_sequence = 0` contains the original ciphertext and plaintext.
- `edit_sequence = N` contains the N-th edit.
- The `messages` base table stores the current visible ciphertext, plaintext, and `edited_at` timestamp for fast thread reads.
- Calling "Show original" queries `getVersion(messageId, 0)`.

## 6. Disappearing Messages Timer

Rooms with disappearing messages enabled compute `expires_at` at send time (`created_at + timer_duration`). The repository stores `expires_at` and indexes it. A periodic background task calls `removeExpired()`, which queries `expires_at IS NOT NULL AND expires_at <= now` and deletes matching rows and their version chains.

## 7. Local Sending State

Outgoing messages start in `'pending'` or `'sending'` state with `local_status`. If sending fails, `local_status` becomes `'failed'` and `local_error` holds the user-facing failure reason. When confirmed by the server, `local_status` becomes `'sent'`. `'read'` is not a local sending status—read receipts are tracked separately in the read state domain.

## 8. No Foreign Keys

Referential integrity between `messages` and `message_versions` is enforced entirely by repository methods. Write and removal methods (`remove`, `removeExpired`, `removeAllInRoom`, `clearAll`) wrap operations in transactions to guarantee atomic cleanups.

## 9. Cache Eviction & Compaction

Cache eviction is not currently active. `created_at` and `updated_at` are stored on every message row to support futureLRU cache eviction policies when storage limits are approached.

## 10. Population & Integration

The repository is exposed via `createRepositories({ db }).messages`. It is not yet wired directly into components or plugins. Future tasks integrate it with the `message.new` event handler, initial sync processing, and thread views.
