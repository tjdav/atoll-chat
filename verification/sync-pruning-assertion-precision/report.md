# Step 0 Report — Sync Pruning Database-State Test Assertions Precision

## 1. `test_13` All-Anomalous Block
In `server/tests/cleanup.rs`, the current post-run-1 assertion for `starred_items` owned by `u_anom` is:
```rust
    let star_item_ids: Vec<String> = sqlx::query_scalar(
        "SELECT item_id FROM starred_items WHERE user_id = 'u_anom' ORDER BY item_id ASC",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(
        star_item_ids,
        vec!["item_anom1".to_string(), "item_anom2".to_string()],
        "All-anomalous table must retain all N rows and no other rows for that user_id"
    );
```
It returns the list of `item_id`s for `u_anom` ordered by `item_id ASC` and asserts equality to `["item_anom1", "item_anom2"]`.
To make it fully rigorous per Deliverable 1, we will also explicitly assert that no rows exist in `starred_items` for `u_anom` with an `item_id` outside `{"item_anom1", "item_anom2"}` using a `NOT IN ('item_anom1', 'item_anom2')` count check equal to 0.

## 2. `test_13` Double-Run Block
In `server/tests/cleanup.rs`, after the second run of `SyncPruningJob`, `test_13` currently asserts:
```rust
    let read_state_rows2: Vec<String> =
        sqlx::query_scalar("SELECT room_id FROM read_state WHERE user_id = 'u_mixed'")
            .fetch_all(&pool)
            .await
            .unwrap();
    assert_eq!(
        read_state_rows2,
        vec!["r_mixed2".to_string()],
        "read_state must contain exactly the anomalous row after both runs"
    );

    let star_items2: Vec<String> = sqlx::query_scalar(
        "SELECT item_id FROM starred_items WHERE user_id = 'u_anom' ORDER BY item_id ASC",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(
        star_items2, star_item_ids,
        "starred_items contents must be identical after second run"
    );

    let noseq_exists2: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM device_names WHERE user_id = 'u_no_seq' AND device_id = 'd_noseq')",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(
        noseq_exists2,
        "device_names contents must be identical after second run"
    );
```
While `starred_items` and `device_names` existence are checked, the `deleted_at` timestamp for the anomalous `read_state` row (`r_mixed2`) is not captured before run 1 and compared after run 2.
Per Deliverable 2, we will capture `deleted_at` for `r_mixed2` before run 1, and compare it after run 2 to assert that the job did not mutate `deleted_at`.

## 3. `test_13` Mixed Block
In `server/tests/cleanup.rs`, the setup for `u_mixed` in `read_state` is:
- Valid tombstone: `user_id = 'u_mixed'`, `room_id = 'r_mixed1'`, `user_seq = 5` ($\le 9$).
- Anomalous tombstone: `user_id = 'u_mixed'`, `room_id = 'r_mixed2'`, `user_seq = 99` ($> 9$).

This confirms `u_mixed` in `test_13` exercises 1 valid + 1 anomalous tombstone in `read_state`, not 2 valid + 1 anomalous.

## 4. Existing Helpers
No shared helper exists in `server/tests/cleanup.rs` for reading back a tombstone's `deleted_at` and `user_seq`. Inline SQL queries are used directly throughout the test file:
```rust
let (anom_rowid, anom_deleted_at_pre, anom_user_seq_pre): (i64, String, i64) = sqlx::query_as(
    "SELECT rowid, CAST(deleted_at AS TEXT), user_seq FROM read_state WHERE room_id = 'r_anom'",
)
.fetch_one(&pool)
.await
.unwrap();
```

## 5. Batch
`server/tests/cleanup.rs` is registered in `server/tests/batch-manifest.toml` under the `operations` batch:
```toml
[[batch]]
name = "operations"
description = "CLI subcommands, rotation, cleanup, migrations"
files = [
    "admin_rotate",
    "cleanup",
    "cli_migrate",
    "cli_models",
    "cli_rotate",
    "migration_schema",
]
timeout_seconds = 60
```
It can be run via `make test-operations` or `cargo test --test cleanup --batch operations`.

## 6. Log-Capture Pattern
`test_13` uses an in-memory thread-safe `LogWriter` with `tracing_subscriber`:
```rust
#[derive(Clone, Default)]
struct LogWriter(StdArc<StdMutex<Vec<u8>>>);
impl std::io::Write for LogWriter {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        self.0.lock().unwrap().extend_from_slice(buf);
        Ok(buf.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

let logs = LogWriter::default();
let logs_clone = logs.clone();

let subscriber = tracing_subscriber::fmt()
    .with_max_level(tracing::Level::TRACE)
    .with_ansi(false)
    .with_writer(move || logs_clone.clone())
    .finish();

let _guard = tracing::subscriber::set_default(subscriber);
```
Combined with `#[tokio::test(flavor = "current_thread")]`, `set_default` isolates subscriber logging to the current test thread. This pattern is fully reusable for `test_14`.

## 7. V2 Remnants
All existing tests in `cleanup.rs` (01–13) verify deleted/retained records using specific primary keys or specific string IDs (e.g., `id = 's_old'`, `key = 'k1'`, `room_id = 'r_sync'`). `test_13`'s `starred_items` check evaluates `star_item_ids` as `vec!["item_anom1", "item_anom2"]`. Adding a check for 0 unexpected `item_id`s completes the assertion precision.
