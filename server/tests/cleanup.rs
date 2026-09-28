mod common;

use async_trait::async_trait;
use common::setup_test_db;
use server::cleanup::{
    audit::AuditJob, memory::MemoryStoresJob, rate_limits::RateLimitsJob, sessions::SessionsJob,
    welcomes::WelcomesJob, CleanupContextOwned, CleanupError, CleanupJob, CleanupReport, Scheduler,
};
use server::config::{Config, RateLimitConfig};
use server::login::{LoginStore, PendingLogin};
use server::opaque::DefaultCipherSuite;
use server::registration::{PendingRegistration, RegistrationStore};
use sqlx::SqlitePool;
use std::sync::Arc;
use std::time::{Duration, Instant};

fn test_config(audit_retention_days: u64) -> Config {
    Config {
        app_env: "development".to_string(),
        app_url: None,
        app_name: "Test".to_string(),
        log_level: "info".to_string(),
        server_bind: "127.0.0.1:0".to_string(),
        db_path: ":memory:".to_string(),
        db_busy_timeout_ms: 5000,
        opaque_oprf_key_path: "./data/oprf.key".to_string(),
        altcha_enabled: false,
        altcha_hmac_secret: "auto".to_string(),
        altcha_algorithm: "PBKDF2/SHA-256".to_string(),
        altcha_cost: 100,
        session_expiry_days: 30,
        session_sliding: true,
        max_file_size_bytes: 104_857_600,
        server_max_devices_per_user: 20,
        invite_default_uses: 1,
        invite_expiry_days: 0,
        invite_code_length: 8,
        invite_limited_max_uses: 10,
        invite_limited_max_open: 50,
        room_invite_default_uses: 1,
        room_invite_code_length: 8,
        rate_limits: RateLimitConfig {
            invite_create_hourly: 50,
            invite_create_daily: 200,
            invite_redeem_per_min: 10,
            kp_claim_per_min: 30,
            kp_claim_hourly: 200,
            login_per_min: 10,
            login_lockout_min: 15,
            export_rate_limit_hours: 24,
        },
        cleanup_enabled: true,
        cleanup_interval_minutes: 60,
        cleanup_startup_delay_secs: 0,
        audit_retention_days,
        data_retention_days: 0,
        export_rate_limit_hours: 24,
        trust_proxy: false,
        hsts_max_age: 31536000,
        hsts_include_subdomains: true,
        client_static_dir: None,
    }
}

fn build_ctx(pool: SqlitePool, config: Config) -> CleanupContextOwned {
    CleanupContextOwned {
        pool,
        config: Arc::new(config),
        registration_store: Arc::new(RegistrationStore::new()),
        login_store: Arc::new(LoginStore::new()),
    }
}

#[tokio::test]
async fn test_01_session_cleanup_removes_old_expired_sessions() {
    let pool = setup_test_db().await;
    let ctx = build_ctx(pool.clone(), test_config(90));

    sqlx::query("INSERT INTO users (id, username, username_hash, opaque_registration, identity_pubkey) VALUES ('u1', 'user1', 'hash1', 'reg', 'pub')")
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

    sqlx::query("INSERT INTO users (id, username, username_hash, opaque_registration, identity_pubkey) VALUES ('u1', 'user1', 'hash1', 'reg', 'pub')")
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

    sqlx::query("INSERT INTO users (id, username, username_hash, opaque_registration, identity_pubkey) VALUES ('u1', 'user1', 'hash1', 'reg', 'pub')")
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

    sqlx::query("INSERT INTO users (id, username, username_hash, opaque_registration, identity_pubkey) VALUES ('u1', 'user1', 'hash1', 'reg', 'pub')")
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
            username: "alice".to_string(),
            username_hash: "hash".to_string(),
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
            username_hash: "hash".to_string(),
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
