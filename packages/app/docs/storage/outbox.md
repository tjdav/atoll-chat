# Outbox Queue and Storage Contract

This document defines the storage contract for the `outbox` table and repository (`@atoll/app/lib/db/repositories/outbox`).

## 1. Purpose

The outbox is a FIFO queue that holds outgoing messages until the client can send them to the server. It is **not** the store for message content. The `messages` table owns message content, payload, and local status (`local_status`, `local_error`). The outbox table owns scheduling, attempts tracking, and backoff ordering.

A message exists in the `messages` table before or during its time in the outbox. When a send succeeds or terminally fails, the outbox row is deleted while the message row persists with its final `local_status` (`'sent'` or `'failed'`).

## 2. Schema

Defined in `packages/app/src/db/migrations/0007-outbox.sql`:

```sql
CREATE TABLE IF NOT EXISTS outbox (
  message_id        TEXT PRIMARY KEY,
  room_id           TEXT NOT NULL,
  enqueued_at       INTEGER NOT NULL,
  attempts          INTEGER NOT NULL DEFAULT 0,
  next_attempt_at   INTEGER NOT NULL,
  last_attempt_at   INTEGER,
  last_error        TEXT
);

CREATE INDEX IF NOT EXISTS idx_outbox_next_attempt ON outbox(next_attempt_at ASC, enqueued_at ASC);
CREATE INDEX IF NOT EXISTS idx_outbox_room ON outbox(room_id);
```

### Column Semantics

| Column | Type | Nullable | Description |
|---|---|---|---|
| `message_id` | `TEXT` | No | Primary key. References `messages.message_id`. A message is enqueued at most once. |
| `room_id` | `TEXT` | No | Room identifier. Enables room-scoped filtering/clearing without joins. |
| `enqueued_at` | `INTEGER` | No | Milliseconds since epoch when enqueued. Tie-breaker for FIFO ordering. |
| `attempts` | `INTEGER` | No | Number of failed attempts made so far (starts at 0). |
| `next_attempt_at` | `INTEGER` | No | Milliseconds since epoch for earliest next attempt eligibility. |
| `last_attempt_at` | `INTEGER` | Yes | Milliseconds since epoch when last attempt occurred (`NULL` until attempted). |
| `last_error` | `TEXT` | Yes | Last error text for diagnostic reference (`NULL` until failed attempt). |

## 3. Queue Semantics

- **FIFO Ordering:** Queue order is strictly `(next_attempt_at ASC, enqueued_at ASC)`.
- **Due Eligibility:** A row is due for attempt when `next_attempt_at <= Date.now()`.
- **Non-Destructive Dequeue:** `dequeue()` reads the next due row without removing it. The processor removes or updates the row upon attempt completion.

## 4. Repository API

Factory: `createOutboxRepository({ db })` exported from `@atoll/app/lib/db/repositories/outbox`.

- `enqueue({ messageId, roomId })`: Inserts a row with `enqueued_at = Date.now()`, `next_attempt_at = Date.now()`, `attempts = 0`. Idempotent via `ON CONFLICT DO NOTHING`.
- `dequeue()`: Returns the next due outbox row or `undefined`.
- `peek()`: Returns the first outbox row in FIFO order regardless of `next_attempt_at`.
- `list({ limit = 100, cursor } = {})`: Returns a page of outbox rows in FIFO order.
- `get(messageId)`: Returns the outbox row for `messageId` or `undefined`.
- `markSent(messageId)`: Deletes the outbox row when send succeeds.
- `markFailed(messageId, error, { attempts, nextAttemptAt, terminal = false })`: Updates `attempts`, `next_attempt_at`, `last_attempt_at`, and `last_error` when `terminal: false`; deletes row when `terminal: true`.
- `count()`: Total outbox row count.
- `countDue()`: Count of rows with `next_attempt_at <= Date.now()`.
- `listByRoom(roomId)`: Outbox rows for `roomId` in FIFO order.
- `removeByRoom(roomId)`: Deletes all outbox rows for `roomId`.
- `remove(messageId)`: Deletes single outbox row.
- `clearAll()`: Deletes all outbox rows.

## 5. Retry Policy

Client Spec §21.1 defines the message send retry policy: 3 attempts with backoffs at 2s, 5s, and 15s.

The repository does **not** hardcode or enforce this policy. The outbox processor (follow-on task) computes `nextAttemptAt` and determines `terminal: true` when attempts reach threshold.

## 6. Terminal Failure

When retries are exhausted, the processor calls `markFailed(messageId, error, { attempts: 3, terminal: true })` and updates `messages.local_status = 'failed'` with `local_error = error`.

The outbox row is deleted on terminal failure so the queue contains only active pending work.

## 7. Ordering

Queue ordering is global across rooms by default `(next_attempt_at ASC, enqueued_at ASC)`. `listByRoom` provides room-scoped inspection.

## 8. Separation from Messages

- `messages` table: Source of truth for content, payload, and `local_status` (`'pending' | 'sending' | 'sent' | 'failed'`).
- `outbox` table: Source of truth for send queue scheduling and retry attempts.

## 9. Cleanup

When a room is deleted, the caller invokes `removeByRoom(roomId)` alongside messages repository cleanup.

## 10. Population

This task delivers the schema and repository API. Wiring the repository into the storage plugin context, boot path, and outbox processor will occur in follow-on tasks.
