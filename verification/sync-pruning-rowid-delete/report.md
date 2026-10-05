# Step 0 Report — Sync Pruning Rowid-Scoped Deletion and Test Coverage

## 1. Current Candidate Query
In `server/src/cleanup/sync.rs`, the candidate query is:
```sql
SELECT {table}.rowid, {table}.user_id, {table}.user_seq,
       (SELECT next_seq - 1 FROM user_seq WHERE user_id = {table}.user_id) AS max_user_seq
FROM {table}
WHERE {table}.deleted_at IS NOT NULL
  AND {table}.deleted_at < datetime('now', ?)
```
Confirmed: The candidate query selects `{table}.rowid`.

## 2. Current Deletion Statement
In `server/src/cleanup/sync.rs`, deletion runs over chunked slices (500 items max) of `valid_rowids`:
```sql
DELETE FROM {table} WHERE rowid IN (?, ?, ...)
```
Confirmed: The deletion statement uses parameterized candidate `rowid` placeholders (`rowid IN (...)`) rather than a broad SQL predicate with inlined invariants. If `valid_rowids` is empty, the deletion loop is skipped entirely and `rows_deleted = 0`.

## 3. Current Row-Classification Loop
The loop in `server/src/cleanup/sync.rs` classifies candidates as follows:
```rust
let mut skipped_count = 0u64;
let mut valid_rowids = Vec::new();

for (rowid, user_id, user_seq, max_user_seq) in candidates {
    let is_valid = match max_user_seq {
        Some(max_seq) => user_seq <= max_seq,
        None => false,
    };
    if is_valid {
        valid_rowids.push(rowid);
    } else {
        skipped_count += 1;
        tracing::warn!(
            table = table,
            user_id = %user_id,
            "skipped tombstone violating user_seq invariant"
        );
    }
}
```
Candidates passing the invariant accumulate into `valid_rowids: Vec<i64>`. Deletion executes after the classification loop using the explicit vector of valid `rowid`s.

## 4. Current Test Assertions
`server/tests/cleanup.rs` currently contains three sync pruning tests:
- `test_11_sync_pruning_job_full_coverage_and_invariants`: Verifies pruning valid tombstones across multiple sync tables and preserving active rows / recent tombstones.
- `test_12_sync_pruning_handles_missing_tables_gracefully`: Verifies graceful handling when tables are missing.
- `test_13_sync_pruning_anomalous_rows_and_logging_contract`: Captures tracing logs, verifies log fields (`deleted`, `skipped`, `table`, `user_id`), and checks double-run idempotency.

Comparison against the 6 required test cases in Deliverable 6:
1. **`deleted = 0, skipped = N` for an all-anomalous table:** `test_13` asserts log output (`deleted=0, skipped=2` for `starred_items`), but does not assert that the table still contains N rows in the database after execution.
2. **Missing `user_seq` row treated as anomalous:** `test_13` checks log output for `u_no_seq` (`deleted=0, skipped=1`), but does not assert that the row is retained in the database table.
3. **Double-run idempotency with logging:** `test_13` checks log outputs across run 1 and run 2, but does not explicitly assert that the table contains exactly the anomalous row after both runs.
4. **`warn` log field set:** `test_13` asserts `table`, `user_id`, and absence of `user_seq`.
5. **`info` log field set:** `test_13` asserts `table`, `deleted`, and `skipped`.
6. **Rowid-scoped deletion (2 valid, 1 anomalous in same table):** No current test sets up 2 valid and 1 anomalous tombstone in a single table to assert `deleted = 2, skipped = 1` and verify that exactly the 2 valid tombstones are deleted while the 1 anomalous tombstone remains in the database.

## 5. Current `warn` Log Field Set
In `server/src/cleanup/sync.rs`:
```rust
tracing::warn!(
    table = table,
    user_id = %user_id,
    "skipped tombstone violating user_seq invariant"
);
```
Confirmed: Emits `table` and `user_id` only. No other fields are present.

## 6. Current `user_seq` Lookup for Missing-Row Case
When a candidate's `user_id` has no row in `user_seq`, `(SELECT next_seq - 1 FROM user_seq WHERE user_id = {table}.user_id)` evaluates to SQL `NULL`, which maps to `Option<i64>::None` in Rust.
In the match expression:
```rust
let is_valid = match max_user_seq {
    Some(max_seq) => user_seq <= max_seq,
    None => false,
};
```
`None` yields `is_valid = false`. The loop increments `skipped_count`, logs `tracing::warn!`, and excludes the candidate's `rowid` from `valid_rowids`. Thus, candidates missing a `user_seq` row are treated as anomalous.

## 7. V2 Remnants
No other code path in `server/src/` deletes sync tombstones by a broad predicate. Sync pruning is centralized in `server/src/cleanup/sync.rs`.
