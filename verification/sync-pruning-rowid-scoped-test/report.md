# Empirical Verification Report — Sync Pruning Rowid-Scoped Test and Deleted-At Stability

## 1. `test_13` Mixed Block Setup
In `server/tests/cleanup.rs`, lines 650–654:
```rust
sqlx::query("INSERT INTO read_state (user_id, room_id, last_read_message_id, user_seq, updated_at, deleted_at) VALUES ('u_mixed', 'r_mixed2', NULL, 99, datetime('now', '-100 days'), datetime('now', '-100 days'))")
    .execute(&pool)
    .await
    .unwrap();
```
The anomalous `read_state` row is `r_mixed2` for `u_mixed`, with `user_seq = 99` ($> \text{max\_seq} = 9$) and `deleted_at = datetime('now', '-100 days')`.

## 2. `test_13` Post-Run-2 Assertions
Before run 1 (lines 695–700):
```rust
let (r2_deleted_at_pre, r2_user_seq_pre): (String, i64) = sqlx::query_as(
    "SELECT CAST(deleted_at AS TEXT), user_seq FROM read_state WHERE user_id = 'u_mixed' AND room_id = 'r_mixed2'",
)
.fetch_one(&pool)
.await
.unwrap();
```
After run 2 (lines 812–823):
```rust
let (r2_deleted_at_post, r2_user_seq_post): (String, i64) = sqlx::query_as(
    "SELECT CAST(deleted_at AS TEXT), user_seq FROM read_state WHERE user_id = 'u_mixed' AND room_id = 'r_mixed2'",
)
.fetch_one(&pool)
.await
.unwrap();
assert_eq!(
    r2_deleted_at_post, r2_deleted_at_pre,
    "Anomalous read_state row deleted_at must remain unchanged across runs"
);
assert_eq!(
    r2_user_seq_post, r2_user_seq_pre,
    "Anomalous read_state row user_seq must remain unchanged across runs"
);
```
Both `deleted_at` and `user_seq` for `r_mixed2` are captured before run 1 and asserted to be unchanged after run 2 in `test_13`.

## 3. Log-Capture Pattern
`test_13` and `test_14` use an in-memory thread-safe `LogWriter` with `tracing_subscriber::set_default`:
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
Combined with `#[tokio::test(flavor = "current_thread")]`, `set_default` captures log output thread-locally for assertions.

## 4. `test_config` and `build_ctx` Helpers
In `server/tests/cleanup.rs`, lines 21–32:
```rust
fn test_config(audit_retention_days: u64) -> Config {
    Config {
        audit_retention_days,
        cleanup_enabled: true,
        ..Config::test_default()
    }
}

fn build_ctx(pool: SqlitePool, config: Config) -> CleanupContextOwned { ... }
```
`test_config` accepts `audit_retention_days` (and `test_default()` sets `sync_event_retention_days` to 90). `build_ctx` takes `pool` and `config`, constructing the owned `CleanupContextOwned`.

## 5. Existing `test_14`
`test_14_sync_pruning_rowid_scoped_deletion` is present at line 856 of `server/tests/cleanup.rs`.
It is the highest-numbered test currently present in `cleanup.rs` (tests 01–14).

## 6. Batch Confirmation
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
Verified via `cd server && make test-operations`.

## 7. V2 Remnants
`test_13` and `test_14` capture `deleted_at` (via `CAST(deleted_at AS TEXT)`) and `user_seq` prior to `SyncPruningJob` execution and re-query after execution to assert unmutated stability for anomalous rows. No other test in `cleanup.rs` captures `deleted_at` before running a cleanup job.
