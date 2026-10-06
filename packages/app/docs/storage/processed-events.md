# Processed Events Storage Contract

## 1. Purpose

The `processed_events` table and repository provide deduplication for durable events received via WebSocket push or caught up via `GET /users/me/sync`.
Because WebSocket delivery is at-least-once, duplicate event notifications bearing the same event identity may arrive. Recording processed event identities allows event handlers to skip duplicate executions idempotently.

## 2. Schema

```sql
CREATE TABLE IF NOT EXISTS processed_events (
  event_key    TEXT PRIMARY KEY,
  processed_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_processed_events_at ON processed_events(processed_at);
```

### Column Descriptions

- `event_key`: Composite event identity string. Primary key.
- `processed_at`: Timestamp (milliseconds since Unix epoch) when the event key was recorded.

## 3. Key Naming Convention

Composite event keys are constructed using the module helper `makeKey(source, eventName, sequence)`:

```javascript
import { makeKey } from '@atoll/app/lib/db/repositories/processed-events'

const key = makeKey('read', 'sync', 42) // "read:sync:42"
```

- `source`: The event domain prefix (`read`, `device`, `starred_item`, `room`).
- `eventName`: The name of the event (`sync`, `name_updated`, `added`).
- `sequence`: The monotonic `user_seq` or unique event identifier.

For message events without a `user_seq`, the message ID string is used directly.

## 4. Repository Methods

Factory: `createProcessedEventsRepository({ db })`

### `has(eventKey)`

- **Parameters**: `eventKey` (`string`)
- **Returns**: `Promise<boolean>`
- Returns `true` if `eventKey` exists in `processed_events`, `false` otherwise.

### `hasKey(source, eventName, sequence)`

- **Parameters**: `source` (`string`), `eventName` (`string`), `sequence` (`string | number`)
- **Returns**: `Promise<boolean>`
- Convenience wrapper calling `has(makeKey(source, eventName, sequence))`.

### `mark(eventKey)`

- **Parameters**: `eventKey` (`string`)
- **Returns**: `Promise<{ changes: number }>`
- Idempotently inserts `eventKey` using `INSERT OR IGNORE`. Returns `{ changes: 1 }` if new, `{ changes: 0 }` if already present.

### `markKey(source, eventName, sequence)`

- **Parameters**: `source` (`string`), `eventName` (`string`), `sequence` (`string | number`)
- **Returns**: `Promise<{ changes: number }>`
- Convenience wrapper calling `mark(makeKey(source, eventName, sequence))`.

### `markBatch(keys)`

- **Parameters**: `keys` (`Array<string>`)
- **Returns**: `Promise<{ changes: number }>`
- Inserts multiple event keys in a single transaction using `INSERT OR IGNORE`. Returns aggregated change count.

### `prune(beforeMs)`

- **Parameters**: `beforeMs` (`number`)
- **Returns**: `Promise<{ changes: number }>`
- Deletes all processed event entries older than `beforeMs`.

### `count()`

- **Returns**: `Promise<number>`
- Returns total count of recorded processed events.

### `clearAll()`

- **Returns**: `Promise<{ changes: number }>`
- Deletes all records from `processed_events`.

## 5. Deduplication Flow

1. An incoming push or sync event arrives.
2. The event handler constructs `eventKey = makeKey(source, eventName, sequence)`.
3. The handler checks `await processedEvents.has(eventKey)`.
4. If `true`, the event is skipped as a duplicate.
5. If `false`, the handler processes the event payload and calls `await processedEvents.mark(eventKey)`.

## 6. Pruning and Retention Policy

The client mirrors the server retention policy (e.g., 90-day `sync_event_retention_days`). Periodic background cleanup jobs invoke `prune(Date.now() - retentionMs)` to keep the table size bounded over long runtimes.

## 7. Batch Operations

When applying delta batches during `GET /users/me/sync`, `markBatch(keys)` records all applied event keys within the same database transaction to maintain atomic deduplication guarantees.
