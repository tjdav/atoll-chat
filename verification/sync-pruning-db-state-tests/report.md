# Step 0 Report — Sync Pruning Database-State Test Assertions Verification

## 1. Current `test_13` Body
In `server/tests/cleanup.rs`, `test_13_sync_pruning_anomalous_rows_and_logging_contract`:
```rust
#[tokio::test]
async fn test_13_sync_pruning_anomalous_rows_and_logging_contract() {
    use std::sync::{Arc as StdArc, Mutex as StdMutex};

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

    let pool = setup_test_db().await;
    let ctx = build_ctx(pool.clone(), test_config(90));

    // 1. Setup user u_mixed with next_seq = 10 (max_seq = 9)
    sqlx::query("INSERT INTO users (id, username_token, opaque_registration, identity_pubkey) VALUES ('u_mixed', ?, 'reg', 'pub')")
        .bind(DUMMY_TOKEN)
        .execute(&pool)
        .await
        .unwrap();

    sqlx::query("INSERT INTO user_seq (user_id, next_seq) VALUES ('u_mixed', 10)")
        .execute(&pool)
        .await
        .unwrap();

    sqlx::query("INSERT INTO rooms (id, owner_id) VALUES ('r_mixed1', 'u_mixed')")
        .execute(&pool)
        .await
        .unwrap();

    sqlx::query("INSERT INTO rooms (id, owner_id) VALUES ('r_mixed2', 'u_mixed')")
        .execute(&pool)
        .await
        .unwrap();

    // Valid tombstone in read_state: user_seq = 5 <= 9
    sqlx::query("INSERT INTO read_state (user_id, room_id, last_read_message_id, user_seq, updated_at, deleted_at) VALUES ('u_mixed', 'r_mixed1', NULL, 5, datetime('now', '-100 days'), datetime('now', '-100 days'))")
        .execute(&pool)
        .await
        .unwrap();

    // Anomalous tombstone in read_state: user_seq = 99 > 9
    sqlx::query("INSERT INTO read_state (user_id, room_id, last_read_message_id, user_seq, updated_at, deleted_at) VALUES ('u_mixed', 'r_mixed2', NULL, 99, datetime('now', '-100 days'), datetime('now', '-100 days'))")
        .execute(&pool)
        .await
        .unwrap();

    // 2. Setup user u_anom with only anomalous tombstones (2 anomalous in starred_items)
    sqlx::query("INSERT INTO users (id, username_token, opaque_registration, identity_pubkey) VALUES ('u_anom', 'token_u_anom_1234567890123456789012345678901234567890123456789012345678901234567890123456789012', 'reg', 'pub')")
        .execute(&pool)
        .await
        .unwrap();

    sqlx::query("INSERT INTO user_seq (user_id, next_seq) VALUES ('u_anom', 5)")
        .execute(&pool)
        .await
        .unwrap();

    sqlx::query("INSERT INTO starred_items (user_id, item_id, item_type, room_id, user_seq, starred_at, deleted_at) VALUES ('u_anom', 'item_anom1', 'message', 'r_mixed1', 50, datetime('now', '-100 days'), datetime('now', '-100 days'))")
        .execute(&pool)
        .await
        .unwrap();

    sqlx::query("INSERT INTO starred_items (user_id, item_id, item_type, room_id, user_seq, starred_at, deleted_at) VALUES ('u_anom', 'item_anom2', 'message', 'r_mixed1', 60, datetime('now', '-100 days'), datetime('now', '-100 days'))")
        .execute(&pool)
        .await
        .unwrap();

    // 3. Setup user u_no_seq with tombstone but NO user_seq row
    sqlx::query("INSERT INTO users (id, username_token, opaque_registration, identity_pubkey) VALUES ('u_no_seq', 'token_u_noseq_1234567890123456789012345678901234567890123456789012345678901234567890123456789012', 'reg', 'pub')")
        .execute(&pool)
        .await
        .unwrap();

    sqlx::query(
        "INSERT INTO devices (id, user_id, client_id) VALUES ('d_noseq', 'u_no_seq', 'c_noseq')",
    )
    .execute(&pool)
    .await
    .unwrap();

    sqlx::query("INSERT INTO device_names (user_id, device_id, encrypted_device_name, user_seq, updated_at, deleted_at) VALUES ('u_no_seq', 'd_noseq', 'enc', 1, datetime('now', '-100 days'), datetime('now', '-100 days'))")
        .execute(&pool)
        .await
        .unwrap();

    let job = SyncPruningJob;

    // First Run
    let report1 = job.run(&ctx.as_ctx()).await.unwrap();
    assert_eq!(report1.rows_deleted, 1); // Only r_mixed1 in read_state deleted

    // Database assertions after First Run
    // 1. All-anomalous table (starred_items for u_anom): N=2 tombstones remain in DB
    let star_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM starred_items WHERE user_id = 'u_anom'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(
        star_count, 2,
        "All-anomalous table must retain all N rows in DB"
    );

    // 2. Missing user_seq row (u_no_seq in device_names): retained in DB
    let noseq_exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM device_names WHERE user_id = 'u_no_seq' AND device_id = 'd_noseq')",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(
        noseq_exists,
        "Missing user_seq tombstone must be retained in DB"
    );

    // 3. Mixed table (read_state for u_mixed): valid tombstone deleted, anomalous retained
    let r1_exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM read_state WHERE user_id = 'u_mixed' AND room_id = 'r_mixed1')",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(!r1_exists, "Valid tombstone must be deleted from DB");

    let r2_exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM read_state WHERE user_id = 'u_mixed' AND room_id = 'r_mixed2')",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(r2_exists, "Anomalous tombstone must be retained in DB");

    // Check captured logs
    let captured = String::from_utf8(logs.0.lock().unwrap().clone()).unwrap();

    // Verify info log format includes table, deleted, skipped and no extraneous fields
    assert!(captured.contains("pruned tombstones for sync table"));
    assert!(captured.contains("table=\"read_state\""));
    assert!(captured.contains("deleted=1"));
    assert!(captured.contains("skipped=1"));

    assert!(captured.contains("table=\"starred_items\""));
    assert!(captured.contains("deleted=0"));
    assert!(captured.contains("skipped=2"));

    assert!(captured.contains("table=\"device_names\""));
    assert!(captured.contains("deleted=0"));
    assert!(captured.contains("skipped=1"));

    // Verify warn log format includes table and user_id, but NOT user_seq
    assert!(captured.contains("skipped tombstone violating user_seq invariant"));
    assert!(captured.contains("user_id=u_mixed"));
    assert!(captured.contains("user_id=u_anom"));
    assert!(captured.contains("user_id=u_no_seq"));
    assert!(!captured.contains("user_seq="));

    // Clear captured log buffer
    logs.0.lock().unwrap().clear();

    // Second Run (Idempotency check)
    let report2 = job.run(&ctx.as_ctx()).await.unwrap();
    assert_eq!(report2.rows_deleted, 0);

    let captured2 = String::from_utf8(logs.0.lock().unwrap().clone()).unwrap();

    // Check second run logs: deleted = 0 for read_state, skipped = 1 (the remaining anomalous row)
    assert!(captured2.contains("table=\"read_state\""));
    assert!(captured2.contains("deleted=0"));
    assert!(captured2.contains("skipped=1"));

    // Database assertions after Second Run: table contains exactly the anomalous row
    let read_state_rows: Vec<String> =
        sqlx::query_scalar("SELECT room_id FROM read_state WHERE user_id = 'u_mixed'")
            .fetch_all(&pool)
            .await
            .unwrap();
    assert_eq!(
        read_state_rows,
        vec!["r_mixed2".to_string()],
        "Table must contain exactly the anomalous row after both runs"
    );

    // Tables without deleted_at column log debug message
    assert!(captured2.contains("skipping sync table pruning (table absent or missing deleted_at column) table=\"user_preferences\""));
    assert!(captured2.contains("skipping sync table pruning (table absent or missing deleted_at column) table=\"user_room_order\""));
    assert!(captured2.contains("skipping sync table pruning (table absent or missing deleted_at column) table=\"bot_settings\""));
}
```

**Analysis of assertions:**
- *All-anomalous table:* Asserts `star_count == 2` for `user_id = 'u_anom'`, but does not explicitly verify the specific item IDs (`item_anom1`, `item_anom2`) are present or assert that no other rows for `u_anom` exist.
- *Missing `user_seq` row:* Asserts `noseq_exists` is true for `('u_no_seq', 'd_noseq')`.
- *Double-run idempotency:* Asserts `read_state_rows == vec!["r_mixed2"]`, but does not verify `starred_items` and `device_names` table contents remain unchanged between run 1 and run 2.

## 2. Current `test_11` Body
```rust
#[tokio::test]
async fn test_11_sync_pruning_job_full_coverage_and_invariants() {
    let pool = setup_test_db().await;
    let ctx = build_ctx(pool.clone(), test_config(90));

    // Setup user with next_seq = 11 (max_seq = 10)
    sqlx::query("INSERT INTO users (id, username_token, opaque_registration, identity_pubkey) VALUES ('u_sync', ?, 'reg', 'pub')")
        .bind(DUMMY_TOKEN)
        .execute(&pool)
        .await
        .unwrap();

    sqlx::query("INSERT INTO user_seq (user_id, next_seq) VALUES ('u_sync', 11)")
        .execute(&pool)
        .await
        .unwrap();

    sqlx::query("INSERT INTO rooms (id, owner_id) VALUES ('r_sync', 'u_sync')")
        .execute(&pool)
        .await
        .unwrap();

    sqlx::query("INSERT INTO rooms (id, owner_id) VALUES ('r_sync_active', 'u_sync')")
        .execute(&pool)
        .await
        .unwrap();

    sqlx::query(
        "INSERT INTO devices (id, user_id, client_id) VALUES ('d_sync', 'u_sync', 'c_sync')",
    )
    .execute(&pool)
    .await
    .unwrap();

    sqlx::query("INSERT INTO devices (id, user_id, client_id) VALUES ('d_sync_recent', 'u_sync', 'c_sync_recent')")
        .execute(&pool)
        .await
        .unwrap();

    // 1. read_state tombstone > 90d, user_seq = 1 <= 10 -> PRUNED
    sqlx::query("INSERT INTO read_state (user_id, room_id, last_read_message_id, user_seq, updated_at, deleted_at) VALUES ('u_sync', 'r_sync', NULL, 1, datetime('now', '-100 days'), datetime('now', '-100 days'))")
        .execute(&pool)
        .await
        .unwrap();

    // 2. device_names tombstone > 90d, user_seq = 2 <= 10 -> PRUNED
    sqlx::query("INSERT INTO device_names (user_id, device_id, encrypted_device_name, user_seq, updated_at, deleted_at) VALUES ('u_sync', 'd_sync', 'enc_dev', 2, datetime('now', '-100 days'), datetime('now', '-100 days'))")
        .execute(&pool)
        .await
        .unwrap();

    // 3. starred_items tombstone > 90d, user_seq = 3 <= 10 -> PRUNED
    sqlx::query("INSERT INTO starred_items (user_id, item_id, item_type, room_id, user_seq, starred_at, deleted_at) VALUES ('u_sync', 'item1', 'message', 'r_sync', 3, datetime('now', '-100 days'), datetime('now', '-100 days'))")
        .execute(&pool)
        .await
        .unwrap();

    // 4. user_preferences active row > 90d, user_seq = 4 -> NOT PRUNED (no deleted_at column)
    sqlx::query("INSERT INTO user_preferences (user_id, key, value_json, user_seq, updated_at) VALUES ('u_sync', 'pref1', 'enc_val', 4, datetime('now', '-100 days'))")
        .execute(&pool)
        .await
        .unwrap();

    // 5. read_state active row > 90d (deleted_at IS NULL) -> NOT PRUNED
    sqlx::query("INSERT INTO read_state (user_id, room_id, last_read_message_id, user_seq, updated_at) VALUES ('u_sync', 'r_sync_active', NULL, 5, datetime('now', '-100 days'))")
        .execute(&pool)
        .await
        .unwrap();

    // 6. device_names tombstone < 90d (deleted_at = 10d ago) -> NOT PRUNED
    sqlx::query("INSERT INTO device_names (user_id, device_id, encrypted_device_name, user_seq, updated_at, deleted_at) VALUES ('u_sync', 'd_sync_recent', 'enc_dev2', 6, datetime('now', '-10 days'), datetime('now', '-10 days'))")
        .execute(&pool)
        .await
        .unwrap();

    // 7. starred_items tombstone > 90d, user_seq = 99 > 10 -> SKIPPED with warn (violates user_seq <= max_seq)
    sqlx::query("INSERT INTO starred_items (user_id, item_id, item_type, room_id, user_seq, starred_at, deleted_at) VALUES ('u_sync', 'item_anomalous', 'message', 'r_sync', 99, datetime('now', '-100 days'), datetime('now', '-100 days'))")
        .execute(&pool)
        .await
        .unwrap();

    let job = SyncPruningJob;

    // Run 1: exactly 3 tombstones pruned (read_state, device_names, starred_items item1)
    let report1 = job.run(&ctx.as_ctx()).await.unwrap();
    assert_eq!(report1.rows_deleted, 3);

    // Verify pruned tombstones are gone
    let rs1_exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM read_state WHERE user_id = 'u_sync' AND room_id = 'r_sync')",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(!rs1_exists);

    let dn1_exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM device_names WHERE user_id = 'u_sync' AND device_id = 'd_sync')")
        .fetch_one(&pool).await.unwrap();
    assert!(!dn1_exists);

    let star1_exists: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM starred_items WHERE item_id = 'item1')")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(!star1_exists);

    // Verify active preference preserved
    let pref_exists: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM user_preferences WHERE key = 'pref1')")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(pref_exists);

    // Verify active read state preserved
    let rs_active_exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM read_state WHERE room_id = 'r_sync_active')",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(rs_active_exists);

    // Verify recent tombstone preserved
    let dn_recent_exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM device_names WHERE device_id = 'd_sync_recent')",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(dn_recent_exists);

    // Verify anomalous tombstone preserved (user_seq 99 > max_seq 10)
    let star_anomalous_exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM starred_items WHERE item_id = 'item_anomalous')",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(star_anomalous_exists);

    // Run 2: Idempotency check -> 0 rows deleted
    let report2 = job.run(&ctx.as_ctx()).await.unwrap();
    assert_eq!(report2.rows_deleted, 0);
}
```

**Analysis:**
Uses direct `sqlx::query_scalar` checks for `EXISTS(...)`. Can be referenced as a pattern for database state queries.

## 3. Current `test_12` Body
```rust
#[tokio::test]
async fn test_12_sync_pruning_handles_missing_tables_gracefully() {
    let pool = setup_test_db().await;
    let ctx = build_ctx(pool.clone(), test_config(90));

    let job = SyncPruningJob;
    let report = job.run(&ctx.as_ctx()).await;
    assert!(report.is_ok());

    let rep = report.unwrap();
    assert_eq!(rep.rows_deleted, 0);
    assert!(!rep.notes.is_empty());
}
```
**Analysis:**
Validates graceful execution on missing tables. No table-existence helpers are defined in this test.

## 4. Test Helpers
In `server/tests/cleanup.rs`:
- `test_config(audit_retention_days: u64) -> Config`
- `build_ctx(pool: SqlitePool, config: Config) -> CleanupContextOwned`
- `LogWriter(StdArc<StdMutex<Vec<u8>>>)` (inline struct inside `test_13`)

No module-wide database query helpers exist in `cleanup.rs`. Direct `sqlx::query_scalar` calls are used inline across all tests.

## 5. Existing Database-State Assertions
In `server/tests/cleanup.rs`:
- Tests 01–07 assert database state using `SELECT EXISTS(SELECT 1 FROM <table> WHERE id = ...)` or `SELECT COUNT(*)`.
- Test 11 asserts database state using `SELECT EXISTS(...)` for `read_state`, `device_names`, `starred_items`, `user_preferences`.
- Test 13 asserts database state using `SELECT COUNT(*)`, `SELECT EXISTS(...)`, and `SELECT room_id FROM read_state WHERE user_id = ...`.

## 6. Batch Confirmation
In `server/tests/batch-manifest.toml`:
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
`cleanup.rs` is confirmed to be in the `operations` batch. Executing `make -C server test-operations` runs `cleanup.rs`.

## 7. V2 Remnants
`test_06_audit_pruning_skips_when_retention_is_zero` asserts `report.notes` and DB state. No tests in `cleanup.rs` assert log output without asserting database state for deletion jobs.
