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
