# Empirical Verification Report: Pending MLS Removes Coordination with Bot Targets and Timeout

**Task:** Phase 15 of §11 — Pending MLS Removes Coordination with Bot Targets and Timeout
**Date:** October 2026
**Status:** Step 0 Verification Completed

---

## 1. Current `pending_mls_removes` Table Schema

In `server/migrations/0001_v2_schema.sql`:

```sql
CREATE TABLE IF NOT EXISTS pending_mls_removes (
    id               TEXT PRIMARY KEY,
    room_id          TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    target_user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_client_id TEXT NOT NULL,
    queued_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    consumed_at      DATETIME
);
```

### Comparison against V3 §7.5:
- **V3 §7.5 Spec:**
  ```sql
  CREATE TABLE pending_mls_removes (
      id                  TEXT PRIMARY KEY,
      room_id             TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      target_user_id      TEXT REFERENCES users(id),
      target_bot_id       TEXT REFERENCES bot_accounts(id),
      queued_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      stale_at            DATETIME,
      consumed_at         DATETIME,
      cancelled_at        DATETIME,
      remove_confirmed_at DATETIME,
      CHECK (
          (target_user_id IS NOT NULL AND target_bot_id IS NULL)
          OR
          (target_user_id IS NULL AND target_bot_id IS NOT NULL)
      )
  );
  CREATE INDEX idx_pending_mls_removes_active
      ON pending_mls_removes(room_id, consumed_at)
      WHERE consumed_at IS NULL AND cancelled_at IS NULL;
  ```
- **Differences:**
  - `target_user_id` is NOT NULL in V2, but nullable in V3 §7.5 to support bot targets.
  - `target_bot_id` is missing in V2.
  - `target_client_id` is present in V2, but removed in V3 §7.5 (pending removes in V3 operate at target identity level, matching `pending_mls_adds` target pattern).
  - `stale_at`, `cancelled_at`, and `remove_confirmed_at` are missing in V2.
  - XOR CHECK constraint `CHECK ((target_user_id IS NOT NULL AND target_bot_id IS NULL) OR (target_user_id IS NULL AND target_bot_id IS NOT NULL))` is missing in V2.
  - Partial index `idx_pending_mls_removes_active` needs `WHERE consumed_at IS NULL AND cancelled_at IS NULL`.

---

## 2. Current Queueing Path

Currently, inline `INSERT INTO pending_mls_removes` statements exist at three sites:
1. `kick_member` in `server/src/rooms.rs`:
   ```rust
   INSERT INTO pending_mls_removes (id, room_id, target_user_id, target_client_id)
   VALUES (?, ?, ?, ?)
   ```
2. `revoke_device` in `server/src/devices.rs`:
   ```rust
   INSERT INTO pending_mls_removes (id, room_id, target_user_id, target_client_id)
   VALUES (?, ?, ?, ?)
   ```
3. `anonymise_user` in `server/src/gdpr.rs`:
   ```rust
   INSERT INTO pending_mls_removes (id, room_id, target_user_id, target_client_id)
   VALUES (?, ?, ?, ?)
   ```

Refactoring will introduce `queue_pending_mls_remove_batch(tx, room_id, target)` in `server/src/rooms.rs` and update all three call sites to insert target identity-level pending removes.

---

## 3. Current Stale Timeout Job

Currently, **no stale timeout job exists** for `pending_mls_removes`.

### Requirements per V3 §4.5 & §8.9:
- Runs on the shared hourly scheduler (`server/src/cleanup/`).
- Reads `PENDING_MLS_REMOVE_TIMEOUT_DAYS` (default 30).
- Selects rows where `stale_at IS NULL AND remove_confirmed_at IS NULL AND cancelled_at IS NULL AND queued_at < datetime('now', '-N days')`.
- In transaction, sets `stale_at = Utc::now()`.
- Post-commit, publishes `mls.remove_stale` once on `private-room-{room_id}`.
- Does not re-fire because `stale_at` is set (`stale_at IS NOT NULL` rows are skipped on subsequent runs).

---

## 4. Current `PENDING_MLS_REMOVE_TIMEOUT_DAYS` Config

Currently absent in `server/src/config.rs`. Will be added as `pending_mls_remove_timeout_days: u64` with default value `30`, read from `PENDING_MLS_REMOVE_TIMEOUT_DAYS`.

---

## 5. Current Consumed-Row Pruning

Currently, **no pruning job exists** for `pending_mls_removes`.

### Requirements per V3 §4.5:
- Prunes consumed rows where `consumed_at < datetime('now', '-30 days')`.
- Prunes cancelled rows where `cancelled_at < datetime('now', '-30 days')`.

---

## 6. Current `mls.remove_stale` Publisher

Currently absent. Will publish on `private-room-{room_id}`:

```json
{
  "room_id": "r_...",
  "target_user_id": "u_..." | null,
  "target_bot_id": "b_..." | null,
  "queued_at": "2026-...",
  "stale_since": "2026-..."
}
```

---

## 7. Current `mls.remove_confirmed` Publisher

Currently absent. Will publish:

1. **Room Channel (`private-room-{room_id}`) — Best-Effort:**
   ```json
   {
     "room_id": "r_...",
     "target_user_id": "u_..." | null,
     "target_bot_id": "b_..." | null,
     "confirmed_at": "2026-..."
   }
   ```
2. **User Channel (`private-user-{user_id}`) — Durable with `user_seq`:**
   ```json
   {
     "room_id": "r_...",
     "target_user_id": "u_..." | null,
     "target_bot_id": "b_..." | null,
     "confirmed_at": "2026-...",
     "user_seq": N
   }
   ```
   **Delivery targets decision:**
   - Confirming member's user channel `private-user-{requester_id}`.
   - Target user's user channel `private-user-{target_user_id}` (if `target_user_id` is set).
   - Bot owner's user channel `private-user-{owner_user_id}` (if `target_bot_id` is set and bot has an owner).

---

## 8. Current `stale_at` Write Path

Currently absent. Will be set by the stale timeout job.

---

## 9. Current `remove_confirmed_at` Write Path

`consume_pending_remove` in `server/src/rooms.rs` currently updates `consumed_at = CURRENT_TIMESTAMP`.

Refactor will set both `consumed_at = Utc::now()` and `remove_confirmed_at = Utc::now()`, allocate `user_seq`, and publish `mls.remove_confirmed` on room and user channels post-commit.

---

## 10. Current `cancelled_at` Write Path

Currently absent in write paths. Columns and partial index support future re-add / cancel paths.

---

## 11. Current Bot Queue Path

Currently absent. No bot-targeted pending remove exists yet. `queue_pending_mls_remove_batch` will support `MlsTarget::Bot(bot_id)`.

---

## 12. Existing Tests & Batch Assignments

- `server/tests/pending_removes.rs` — Batch: `sockudo`
- `server/tests/devices.rs` — Batch: `auth`
- `server/tests/gdpr.rs` — Batch: `identity`
- `server/tests/moderation.rs` — Batch: `messaging`
- `server/tests/migration_schema.rs` — Batch: `operations`

---

## 13. V2 Remnants

- `pending_mls_removes` schema in `0001_v2_schema.sql` has `target_client_id` (NOT NULL) and lacks `target_bot_id`, `stale_at`, `cancelled_at`, `remove_confirmed_at`, and the XOR CHECK.
- `kick_member`, `revoke_device`, and `anonymise_user` insert per-device rows with `target_client_id`.
- `list_pending_removes` and `PendingRemove` struct include `target_client_id` and do not include `target_bot_id`, `stale_at`, `cancelled_at`, `remove_confirmed_at`.
- Existing tests (`pending_removes.rs`, `devices.rs`, `moderation.rs`) assert on `target_client_id`.

---
