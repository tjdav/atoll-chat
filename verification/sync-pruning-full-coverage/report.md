# Step 0 Report — Sync Pruning Full Coverage

**Date:** 2026-10-05
**Task:** Complete Sync Pruning Table Coverage

---

## 1. Current `SyncPruningJob` Implementation

The `SyncPruningJob` struct is defined in `server/src/cleanup/sync.rs` and implements `CleanupJob` registered on the shared hourly scheduler.

- **Tables Array:** `ALLOWED_SYNC_TABLES` currently declares all 6 user-scoped sync tables:
  ```rust
  const ALLOWED_SYNC_TABLES: [&str; 6] = [
      "read_state",
      "user_preferences",
      "user_room_order",
      "device_names",
      "starred_items",
      "bot_settings",
  ];
  ```
- **Deletion Rule:**
  ```sql
  DELETE FROM {table}
  WHERE deleted_at IS NOT NULL
    AND deleted_at < datetime('now', ?)
    AND user_seq <= (SELECT next_seq - 1 FROM user_seq WHERE user_id = {table}.user_id)
  ```
  where `?` binds `"-N days"` (`N = sync_event_retention_days`).

---

## 2. Current Table Existence & Schema Checks

The job checks table and column availability via helper function `has_deleted_at_column(pool, table_name)`:
1. Queries `sqlite_master`:
   ```sql
   SELECT 1 FROM sqlite_master WHERE type='table' AND name=?
   ```
2. Queries `pragma_table_info`:
   ```sql
   SELECT 1 FROM pragma_table_info('{table}') WHERE name='deleted_at'
   ```
If either the table does not exist or the `deleted_at` column is missing, `has_deleted_at_column` returns `Ok(false)` and the table is safely skipped without throwing an error or crashing.

---

## 3. Current Logging

Currently, `SyncPruningJob` logs:
- `tracing::info!(table = table, rows_deleted = rows, "pruned tombstones for sync table");` when rows are pruned.
- `tracing::debug!(table = table, "skipping sync table pruning (table absent or missing deleted_at column)");` when skipped due to missing table/column.

It does not currently log the `deleted` and `skipped` counts per table at `info` in the required format `tracing::info!(table = table, deleted = rows_deleted, skipped = rows_skipped, "pruned tombstones for sync table")`, nor does it count or log `warn` entries for anomalous rows violating the defensive invariant.

---

## 4. Current Defensive Invariant Enforcement

The SQL `DELETE` query currently includes `user_seq <= (SELECT next_seq - 1 FROM user_seq WHERE user_id = {table}.user_id)`. However:
- Any tombstone row where `user_seq > next_seq - 1` is simply ignored by the SQL `DELETE` statement.
- The job does not pre-inspect candidate tombstones to identify anomalous rows, does not log a `warn` with `table` and `user_id`, and does not track the `skipped` count.

---

## 5. Current Test Coverage

Existing test coverage for `SyncPruningJob`:
- `server/tests/sync_contract.rs`:
  - `test_sync_response_contract_bot_settings_and_max_seq` (verifies retention cleanup and `full_resync_required` boundary advancement).
  - `test_sync_pruning_job_tombstone_active_and_idempotency` (verifies pruning tombstones older than window, preserving active rows, preserving tombstones within window, preserving high `user_seq` rows, and job idempotency).
- **Batch Assignments:**
  - `server/tests/sync_contract.rs` is assigned to the `sync` batch in `server/tests/batch-manifest.toml`.
  - `server/tests/cleanup.rs` is assigned to the `operations` batch in `server/tests/batch-manifest.toml`.

---

## 6. Current Schema Analysis

In `server/migrations/0001_v2_schema.sql`:
- `read_state`: Exists, has `deleted_at` column.
- `device_names`: Exists, has `deleted_at` column.
- `starred_items`: Exists, has `deleted_at` column.
- `user_preferences`: Exists, but does NOT have a `deleted_at` column.
- `user_room_order`: Table does NOT exist (to be added in Phase 25).
- `bot_settings`: Table does NOT exist (to be added in Phase 30).

At runtime, `has_deleted_at_column` evaluates to `true` for `read_state`, `device_names`, and `starred_items`, and `false` for `user_preferences`, `user_room_order`, and `bot_settings`.

---

## 7. V2 Remnants

- `server/src/sync/query.rs` (`is_full_resync_required`): Evaluates min retained `user_seq` across `read_state`, `user_preferences`, `device_names`, and `starred_items`.
- No code paths assume only 3 tables are pruned.

---

## Implementation Plan

1. **Refactor Candidate Inspection & Defensive Invariant Enforcement in `SyncPruningJob` (`server/src/cleanup/sync.rs`):**
   - For tables where `has_deleted_at_column` returns `true`:
     - Query candidates where `deleted_at IS NOT NULL AND deleted_at < datetime('now', '-N days')`.
     - For each candidate, compare `user_seq` against `(SELECT next_seq - 1 FROM user_seq WHERE user_id = {table}.user_id)`.
     - If `user_seq > next_seq - 1` or missing `user_seq` row: log `tracing::warn!(table = table, user_id = %user_id, "skipped tombstone violating user_seq invariant")`, increment `skipped`.
     - Execute deletion of valid tombstones (`user_seq <= max_seq`).
     - Log per-table deletion at `info`: `tracing::info!(table = table, deleted = rows_deleted, skipped = rows_skipped, "pruned tombstones for sync table")`.
2. **Add Tests in `server/tests/cleanup.rs` (`operations` batch):**
   - Test all 6 tables handled gracefully (missing tables/columns skipped).
   - Test active rows preserved (`deleted_at IS NULL`).
   - Test tombstones within window preserved.
   - Test anomalous tombstones (`user_seq > max_seq`) skipped with `warn` and counted as `skipped`.
   - Test idempotency (consecutive runs).
   - Test `full_resync_required` boundary advancement.
