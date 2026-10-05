# Step 0 Report — Sync Pruning Inspection and Logging Gaps

## 1. Current candidate query
In `server/src/cleanup/sync.rs`, the current candidate query is:
```sql
SELECT {table}.user_id, {table}.user_seq, (SELECT next_seq - 1 FROM user_seq WHERE user_id = {table}.user_id) AS max_user_seq
FROM {table}
WHERE {table}.deleted_at IS NOT NULL
  AND {table}.deleted_at < datetime('now', ?)
```
This selects all tombstones outside the retention window (both valid tombstones where `user_seq <= max_seq` and anomalous tombstones). However, it does not select `rowid`, and deletion currently runs a separate `DELETE FROM ...` statement rather than deleting strictly by valid candidate `rowid`s (`DELETE FROM {table} WHERE rowid IN (...)`).

## 2. Current per-table logging
The current `tracing` calls in `server/src/cleanup/sync.rs` are:
- Anomalous row warning:
  ```rust
  tracing::warn!(
      table = table,
      user_id = %user_id,
      "skipped tombstone violating user_seq invariant"
  );
  ```
- Per-table info log:
  ```rust
  tracing::info!(
      table = table,
      deleted = rows_deleted,
      skipped = skipped_count,
      "pruned tombstones for sync table"
  );
  ```
- Skipped table debug log:
  ```rust
  tracing::debug!(
      table = table,
      "skipping sync table pruning (table absent or missing deleted_at column)"
  );
  ```

## 3. Current test file
- File: `server/tests/cleanup.rs`
- Relevant test functions: `test_11_sync_pruning_job_full_coverage_and_invariants`, `test_12_sync_pruning_handles_missing_tables_gracefully`
- Test batch: `operations` (registered in `server/tests/batch-manifest.toml`)

## 4. Current `user_id` availability in the row
Confirmed across all 6 sync tables in `server/migrations/0001_v2_schema.sql` (and future table specs):
- `read_state`: `user_id` present
- `user_preferences`: `user_id` present
- `user_room_order`: `user_id` present
- `device_names`: `user_id` present
- `starred_items`: `user_id` present
- `bot_settings`: `user_id` present

Every sync table has a `user_id` column without exception.

## 5. Current `user_seq` availability
Confirmed across all 6 sync tables in `server/migrations/0001_v2_schema.sql` (and future table specs):
- `read_state`: `user_seq` present
- `user_preferences`: `user_seq` present
- `user_room_order`: `user_seq` present
- `device_names`: `user_seq` present
- `starred_items`: `user_seq` present
- `bot_settings`: `user_seq` present

Every sync table has a `user_seq` column without exception.

## 6. V2 remnants
- In `server/src/cleanup/sync.rs`: The pre-inspection candidate query currently does not select `rowid`. The deletion executes a broad SQL query with `WHERE deleted_at ... AND user_seq <= ...` rather than deleting explicitly by candidate `rowid`s (`DELETE FROM {table} WHERE rowid IN (...)`).
- In `server/tests/cleanup.rs`: Tests do not yet assert the full set of requirements from Deliverable 6 (e.g. testing `deleted = 0, skipped = N`, missing `user_seq` row treated as anomalous, double-run logging `deleted = 0, skipped = 0` / idempotency verification, or detailed logging checks).
