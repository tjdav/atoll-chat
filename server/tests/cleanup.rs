mod common;

use async_trait::async_trait;
use common::setup_test_db;
use server::cleanup::{
    audit::AuditJob, memory::MemoryStoresJob, rate_limits::RateLimitsJob, sessions::SessionsJob,
    sync::SyncPruningJob, welcomes::WelcomesJob, CleanupContextOwned, CleanupError, CleanupJob,
    CleanupReport, Scheduler,
};
use server::config::Config;
use server::login::{LoginStore, PendingLogin};
use server::opaque::DefaultCipherSuite;
use server::registration::{PendingRegistration, RegistrationStore};
use sqlx::SqlitePool;
use std::sync::Arc;
use std::time::{Duration, Instant};

const DUMMY_TOKEN: &str = "token_alice_1234567890123456789012345678901234567890123456789012345678901234567890123456789012";

fn test_config(audit_retention_days: u64) -> Config {
    Config {
        audit_retention_days,
        cleanup_enabled: true,
        ..Config::test_default()
    }
}

fn build_ctx(pool: SqlitePool, config: Config) -> CleanupContextOwned {
    let config_arc = Arc::new(config);
    let storage = server::build_storage(&config_arc).unwrap();
    let server_max = Arc::new(server::ServerHardMax {
        file_size_bytes: config_arc.max_file_size_bytes as i64,
        room_size: 1000,
        rooms_per_user: 500,
        devices_per_user: config_arc.server_max_devices_per_user as i64,
        keypackages_per_device: 50,
        message_size_bytes: 65536,
        attachment_retention_days: 365,
        call_max_participants: 50,
        reactions_per_message: 50,
        room_metadata_bytes: 65536,
    });

    CleanupContextOwned {
        pool,
        config: config_arc,
        registration_store: Arc::new(RegistrationStore::new()),
        login_store: Arc::new(LoginStore::new()),
        recovery_store: Arc::new(server::RecoveryStore::new()),
        storage,
        server_max,
    }
}

#[tokio::test]
async fn test_01_session_cleanup_removes_old_expired_sessions() {
    let pool = setup_test_db().await;
    let ctx = build_ctx(pool.clone(), test_config(90));

    sqlx::query("INSERT INTO users (id, username_token, opaque_registration, identity_pubkey) VALUES ('u1', ?, 'reg', 'pub')")
        .bind(DUMMY_TOKEN)
        .execute(&pool)
        .await
        .unwrap();

    // Expired 40 days ago
    sqlx::query("INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at) VALUES ('s_old', 'u1', 'th_old', datetime('now', '-45 days'), datetime('now', '-40 days'))")
        .execute(&pool)
        .await
        .unwrap();

    // Active
    sqlx::query("INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at) VALUES ('s_active', 'u1', 'th_active', datetime('now'), datetime('now', '+1 day'))")
        .execute(&pool)
        .await
        .unwrap();

    let job = SessionsJob;
    let report = job.run(&ctx.as_ctx()).await.unwrap();
    assert_eq!(report.rows_deleted, 1);

    let old_exists: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM sessions WHERE id = 's_old')")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(!old_exists);

    let active_exists: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM sessions WHERE id = 's_active')")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(active_exists);
}

#[tokio::test]
async fn test_02_session_cleanup_preserves_recently_expired_sessions() {
    let pool = setup_test_db().await;
    let ctx = build_ctx(pool.clone(), test_config(90));

    sqlx::query("INSERT INTO users (id, username_token, opaque_registration, identity_pubkey) VALUES ('u1', ?, 'reg', 'pub')")
        .bind(DUMMY_TOKEN)
        .execute(&pool)
        .await
        .unwrap();

    // Expired 5 days ago (within 30-day grace)
    sqlx::query("INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at) VALUES ('s_recent_exp', 'u1', 'th_recent', datetime('now', '-35 days'), datetime('now', '-5 days'))")
        .execute(&pool)
        .await
        .unwrap();

    let job = SessionsJob;
    let report = job.run(&ctx.as_ctx()).await.unwrap();
    assert_eq!(report.rows_deleted, 0);

    let exists: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM sessions WHERE id = 's_recent_exp')")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(exists);
}

#[tokio::test]
async fn test_03_session_cleanup_removes_revoked_sessions_after_30_days() {
    let pool = setup_test_db().await;
    let ctx = build_ctx(pool.clone(), test_config(90));

    sqlx::query("INSERT INTO users (id, username_token, opaque_registration, identity_pubkey) VALUES ('u1', ?, 'reg', 'pub')")
        .bind(DUMMY_TOKEN)
        .execute(&pool)
        .await
        .unwrap();

    // Revoked 5 days ago
    sqlx::query("INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at, revoked_at) VALUES ('s_rev_5d', 'u1', 'th_rev5', datetime('now', '-10 days'), datetime('now', '+20 days'), datetime('now', '-5 days'))")
        .execute(&pool)
        .await
        .unwrap();

    // Revoked 40 days ago
    sqlx::query("INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at, revoked_at) VALUES ('s_rev_40d', 'u1', 'th_rev40', datetime('now', '-50 days'), datetime('now', '+20 days'), datetime('now', '-40 days'))")
        .execute(&pool)
        .await
        .unwrap();

    let job = SessionsJob;
    let report = job.run(&ctx.as_ctx()).await.unwrap();
    assert_eq!(report.rows_deleted, 1);

    let rev5_exists: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM sessions WHERE id = 's_rev_5d')")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(rev5_exists);

    let rev40_exists: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM sessions WHERE id = 's_rev_40d')")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(!rev40_exists);
}

#[tokio::test]
async fn test_04_rate_limit_pruning_removes_old_windows() {
    let pool = setup_test_db().await;
    let ctx = build_ctx(pool.clone(), test_config(90));

    // 48 hours ago
    sqlx::query("INSERT INTO rate_limits (key, window_start, count) VALUES ('k1', datetime('now', '-48 hours'), 5)")
        .execute(&pool)
        .await
        .unwrap();

    // 1 hour ago
    sqlx::query("INSERT INTO rate_limits (key, window_start, count) VALUES ('k2', datetime('now', '-1 hour'), 2)")
        .execute(&pool)
        .await
        .unwrap();

    let job = RateLimitsJob;
    let report = job.run(&ctx.as_ctx()).await.unwrap();
    assert_eq!(report.rows_deleted, 1);

    let k1_exists: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM rate_limits WHERE key = 'k1')")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(!k1_exists);

    let k2_exists: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM rate_limits WHERE key = 'k2')")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(k2_exists);
}

#[tokio::test]
async fn test_05_audit_pruning_respects_retention() {
    let pool = setup_test_db().await;
    let ctx = build_ctx(pool.clone(), test_config(90));

    // 100 days ago
    sqlx::query("INSERT INTO audit_log (id, action, created_at) VALUES ('a100', 'test', datetime('now', '-100 days'))")
        .execute(&pool)
        .await
        .unwrap();

    // 50 days ago
    sqlx::query("INSERT INTO audit_log (id, action, created_at) VALUES ('a50', 'test', datetime('now', '-50 days'))")
        .execute(&pool)
        .await
        .unwrap();

    // 1 day ago
    sqlx::query("INSERT INTO audit_log (id, action, created_at) VALUES ('a1', 'test', datetime('now', '-1 day'))")
        .execute(&pool)
        .await
        .unwrap();

    let job = AuditJob;
    let report = job.run(&ctx.as_ctx()).await.unwrap();
    assert_eq!(report.rows_deleted, 1);

    let a100_exists: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM audit_log WHERE id = 'a100')")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(!a100_exists);

    let a50_exists: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM audit_log WHERE id = 'a50')")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(a50_exists);

    let a1_exists: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM audit_log WHERE id = 'a1')")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(a1_exists);
}

#[tokio::test]
async fn test_06_audit_pruning_skips_when_retention_is_zero() {
    let pool = setup_test_db().await;
    let ctx = build_ctx(pool.clone(), test_config(0));

    sqlx::query("INSERT INTO audit_log (id, action, created_at) VALUES ('a100', 'test', datetime('now', '-100 days'))")
        .execute(&pool)
        .await
        .unwrap();

    let job = AuditJob;
    let report = job.run(&ctx.as_ctx()).await.unwrap();
    assert_eq!(report.rows_deleted, 0);
    assert!(report.notes.iter().any(|n| n.contains("skipped")));

    let a100_exists: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM audit_log WHERE id = 'a100')")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(a100_exists);
}

#[tokio::test]
async fn test_07_welcome_expiry_removes_stale_welcomes() {
    let pool = setup_test_db().await;
    let ctx = build_ctx(pool.clone(), test_config(90));

    sqlx::query("INSERT INTO users (id, username_token, opaque_registration, identity_pubkey) VALUES ('u1', ?, 'reg', 'pub')")
        .bind(DUMMY_TOKEN)
        .execute(&pool)
        .await
        .unwrap();

    sqlx::query("INSERT INTO rooms (id, owner_id) VALUES ('r1', 'u1')")
        .execute(&pool)
        .await
        .unwrap();

    // 10 days ago
    sqlx::query("INSERT INTO welcomes (id, room_id, recipient_user_id, recipient_client_id, welcome_data, created_at) VALUES ('w10', 'r1', 'u1', 'c1', 'data', datetime('now', '-10 days'))")
        .execute(&pool)
        .await
        .unwrap();

    // 1 day ago
    sqlx::query("INSERT INTO welcomes (id, room_id, recipient_user_id, recipient_client_id, welcome_data, created_at) VALUES ('w1', 'r1', 'u1', 'c1', 'data', datetime('now', '-1 day'))")
        .execute(&pool)
        .await
        .unwrap();

    let job = WelcomesJob;
    let report = job.run(&ctx.as_ctx()).await.unwrap();
    assert_eq!(report.rows_deleted, 1);

    let w10_exists: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM welcomes WHERE id = 'w10')")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(!w10_exists);

    let w1_exists: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM welcomes WHERE id = 'w1')")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(w1_exists);
}

#[tokio::test]
async fn test_08_memory_store_purge_removes_expired_entries() {
    let pool = setup_test_db().await;
    let ctx = build_ctx(pool, test_config(90));

    let expired_time = Instant::now() - Duration::from_secs(400);

    ctx.registration_store.insert(
        "reg1".to_string(),
        PendingRegistration {
            username_token: DUMMY_TOKEN.to_string(),
            credential_id: [0u8; 64],
            created_at: expired_time,
        },
    );

    let mut rng = rand::rngs::OsRng;
    let client_login =
        opaque_ke::ClientLogin::<DefaultCipherSuite>::start(&mut rng, b"password").unwrap();
    let setup = opaque_ke::ServerSetup::<DefaultCipherSuite>::new(&mut rng);
    let server_login = opaque_ke::ServerLogin::<DefaultCipherSuite>::start(
        &mut rng,
        &setup,
        None,
        client_login.message,
        b"alice",
        opaque_ke::ServerLoginParameters::default(),
    )
    .unwrap();

    ctx.login_store.insert(
        "log1".to_string(),
        PendingLogin {
            user_id: "u1".to_string(),
            username_token: DUMMY_TOKEN.to_string(),
            encrypted_display: None,
            client_id: "c1".to_string(),
            platform: "web".to_string(),
            server_login_state: server_login.state,
            created_at: expired_time,
        },
    );

    let job = MemoryStoresJob;
    let report = job.run(&ctx.as_ctx()).await.unwrap();
    assert_eq!(report.rows_deleted, 2);
}

struct FailingJob;

#[async_trait]
impl CleanupJob for FailingJob {
    fn name(&self) -> &'static str {
        "failing"
    }

    async fn run(
        &self,
        _ctx: &server::cleanup::CleanupContext<'_>,
    ) -> Result<CleanupReport, CleanupError> {
        Err(CleanupError::JobFailed("test error".into()))
    }
}

#[tokio::test]
async fn test_09_job_failure_is_isolated() {
    let pool = setup_test_db().await;
    let ctx = build_ctx(pool, test_config(90));

    let mut scheduler = Scheduler::new(Duration::from_secs(60));
    scheduler.register(Box::new(FailingJob));
    scheduler.register(Box::new(MemoryStoresJob));

    let (shutdown_tx, shutdown_rx) = tokio::sync::watch::channel(false);

    let handle = tokio::spawn(async move {
        scheduler.run(ctx, shutdown_rx).await;
    });

    tokio::time::sleep(Duration::from_millis(100)).await;
    shutdown_tx.send(true).unwrap();

    let res = tokio::time::timeout(Duration::from_secs(2), handle).await;
    assert!(res.is_ok());
}

#[tokio::test]
async fn test_10_scheduler_respects_shutdown_signal() {
    let pool = setup_test_db().await;
    let ctx = build_ctx(pool, test_config(90));

    let mut scheduler = Scheduler::new(Duration::from_secs(1));
    scheduler.register(Box::new(MemoryStoresJob));

    let (shutdown_tx, shutdown_rx) = tokio::sync::watch::channel(false);

    let handle = tokio::spawn(async move {
        scheduler.run(ctx, shutdown_rx).await;
    });

    tokio::time::sleep(Duration::from_millis(100)).await;
    shutdown_tx.send(true).unwrap();

    let res = tokio::time::timeout(Duration::from_secs(3), handle).await;
    assert!(
        res.is_ok(),
        "Scheduler task should exit promptly on shutdown signal"
    );
}

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
        "INSERT INTO devices (id, user_id, client_id, platform) VALUES ('d_sync', 'u_sync', 'c_sync', 'web')",
    )
    .execute(&pool)
    .await
    .unwrap();

    sqlx::query("INSERT INTO devices (id, user_id, client_id, platform) VALUES ('d_sync_recent', 'u_sync', 'c_sync_recent', 'web')")
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

#[tokio::test(flavor = "current_thread")]
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
        "INSERT INTO devices (id, user_id, client_id, platform) VALUES ('d_noseq', 'u_no_seq', 'c_noseq', 'web')",
    )
    .execute(&pool)
    .await
    .unwrap();

    sqlx::query("INSERT INTO device_names (user_id, device_id, encrypted_device_name, user_seq, updated_at, deleted_at) VALUES ('u_no_seq', 'd_noseq', 'enc', 1, datetime('now', '-100 days'), datetime('now', '-100 days'))")
        .execute(&pool)
        .await
        .unwrap();

    let (r2_deleted_at_pre, r2_user_seq_pre): (String, i64) = sqlx::query_as(
        "SELECT CAST(deleted_at AS TEXT), user_seq FROM read_state WHERE user_id = 'u_mixed' AND room_id = 'r_mixed2'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();

    let job = SyncPruningJob;

    // First Run
    let report1 = job.run(&ctx.as_ctx()).await.unwrap();
    assert_eq!(report1.rows_deleted, 1); // Only r_mixed1 in read_state deleted

    // Database assertions after First Run
    // 1. All-anomalous table (starred_items for u_anom): N=2 tombstones remain in DB
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

    let star_other_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM starred_items WHERE user_id = 'u_anom' AND item_id NOT IN ('item_anom1', 'item_anom2')",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        star_other_count, 0,
        "No other rows must exist in starred_items for u_anom"
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

    // Database assertions after Second Run: table contents identical to run 1 snapshot
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

    // Tables without deleted_at column log debug message
    assert!(captured2.contains("skipping sync table pruning (table absent or missing deleted_at column) table=\"user_preferences\""));
    assert!(captured2.contains("skipping sync table pruning (table absent or missing deleted_at column) table=\"user_room_order\""));
    assert!(captured2.contains("skipping sync table pruning (table absent or missing deleted_at column) table=\"bot_settings\""));
}

#[tokio::test(flavor = "current_thread")]
async fn test_14_sync_pruning_rowid_scoped_deletion() {
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

    // Setup user u_rowid with next_seq = 10 (max_seq = 9)
    sqlx::query("INSERT INTO users (id, username_token, opaque_registration, identity_pubkey) VALUES ('u_rowid', ?, 'reg', 'pub')")
        .bind(DUMMY_TOKEN)
        .execute(&pool)
        .await
        .unwrap();

    sqlx::query("INSERT INTO user_seq (user_id, next_seq) VALUES ('u_rowid', 10)")
        .execute(&pool)
        .await
        .unwrap();

    sqlx::query("INSERT INTO rooms (id, owner_id) VALUES ('r_valid1', 'u_rowid')")
        .execute(&pool)
        .await
        .unwrap();

    sqlx::query("INSERT INTO rooms (id, owner_id) VALUES ('r_valid2', 'u_rowid')")
        .execute(&pool)
        .await
        .unwrap();

    sqlx::query("INSERT INTO rooms (id, owner_id) VALUES ('r_anom', 'u_rowid')")
        .execute(&pool)
        .await
        .unwrap();

    // 2 valid tombstones + 1 anomalous tombstone in read_state
    // Valid 1: user_seq = 3 <= 9
    sqlx::query("INSERT INTO read_state (user_id, room_id, last_read_message_id, user_seq, updated_at, deleted_at) VALUES ('u_rowid', 'r_valid1', NULL, 3, datetime('now', '-100 days'), datetime('now', '-100 days'))")
        .execute(&pool)
        .await
        .unwrap();

    // Valid 2: user_seq = 7 <= 9
    sqlx::query("INSERT INTO read_state (user_id, room_id, last_read_message_id, user_seq, updated_at, deleted_at) VALUES ('u_rowid', 'r_valid2', NULL, 7, datetime('now', '-100 days'), datetime('now', '-100 days'))")
        .execute(&pool)
        .await
        .unwrap();

    // Anomalous: user_seq = 99 > 9
    sqlx::query("INSERT INTO read_state (user_id, room_id, last_read_message_id, user_seq, updated_at, deleted_at) VALUES ('u_rowid', 'r_anom', NULL, 99, datetime('now', '-100 days'), datetime('now', '-100 days'))")
        .execute(&pool)
        .await
        .unwrap();

    // Capture rowids and initial state of r_anom before running the job
    let valid1_rowid: i64 =
        sqlx::query_scalar("SELECT rowid FROM read_state WHERE room_id = 'r_valid1'")
            .fetch_one(&pool)
            .await
            .unwrap();

    let valid2_rowid: i64 =
        sqlx::query_scalar("SELECT rowid FROM read_state WHERE room_id = 'r_valid2'")
            .fetch_one(&pool)
            .await
            .unwrap();

    let (anom_rowid, anom_deleted_at_pre, anom_user_seq_pre): (i64, String, i64) = sqlx::query_as(
        "SELECT rowid, CAST(deleted_at AS TEXT), user_seq FROM read_state WHERE room_id = 'r_anom'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();

    let job = SyncPruningJob;
    let report = job.run(&ctx.as_ctx()).await.unwrap();

    // Exactly 2 valid tombstones deleted
    assert_eq!(report.rows_deleted, 2);

    // Verify info and warn logs
    let captured = String::from_utf8(logs.0.lock().unwrap().clone()).unwrap();

    assert!(captured.contains("pruned tombstones for sync table"));
    assert!(captured.contains("table=\"read_state\""));
    assert!(captured.contains("deleted=2"));
    assert!(captured.contains("skipped=1"));

    assert!(captured.contains("skipped tombstone violating user_seq invariant"));
    assert!(captured.contains("user_id=u_rowid"));
    assert!(!captured.contains("user_seq="));

    // Verify rowid-scoped deletion: valid rowids are gone
    let valid1_exists: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM read_state WHERE rowid = ?)")
            .bind(valid1_rowid)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(!valid1_exists, "First valid rowid must be deleted");

    let valid2_exists: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM read_state WHERE rowid = ?)")
            .bind(valid2_rowid)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(!valid2_exists, "Second valid rowid must be deleted");

    // Verify anomalous rowid remains in DB with unmutated deleted_at and user_seq
    let (anom_rowid_post, anom_deleted_at_post, anom_user_seq_post): (i64, String, i64) = sqlx::query_as(
        "SELECT rowid, CAST(deleted_at AS TEXT), user_seq FROM read_state WHERE room_id = 'r_anom'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(
        anom_rowid_post, anom_rowid,
        "Anomalous rowid must remain unchanged"
    );
    assert_eq!(
        anom_deleted_at_post, anom_deleted_at_pre,
        "Anomalous row deleted_at must not be mutated"
    );
    assert_eq!(
        anom_user_seq_post, anom_user_seq_pre,
        "Anomalous row user_seq must not be mutated"
    );

    // Clear logs and run second time
    logs.0.lock().unwrap().clear();

    let report2 = job.run(&ctx.as_ctx()).await.unwrap();
    assert_eq!(report2.rows_deleted, 0);

    let captured2 = String::from_utf8(logs.0.lock().unwrap().clone()).unwrap();

    assert!(captured2.contains("table=\"read_state\""));
    assert!(captured2.contains("deleted=0"));
    assert!(captured2.contains("skipped=1"));

    let read_state_rows2: Vec<String> =
        sqlx::query_scalar("SELECT room_id FROM read_state WHERE user_id = 'u_rowid'")
            .fetch_all(&pool)
            .await
            .unwrap();
    assert_eq!(
        read_state_rows2,
        vec!["r_anom".to_string()],
        "read_state must contain exactly r_anom after second run"
    );

    let (anom_rowid_run2, anom_deleted_at_run2, anom_user_seq_run2): (i64, String, i64) = sqlx::query_as(
        "SELECT rowid, CAST(deleted_at AS TEXT), user_seq FROM read_state WHERE room_id = 'r_anom'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(anom_rowid_run2, anom_rowid);
    assert_eq!(anom_deleted_at_run2, anom_deleted_at_pre);
    assert_eq!(anom_user_seq_run2, anom_user_seq_pre);
}
