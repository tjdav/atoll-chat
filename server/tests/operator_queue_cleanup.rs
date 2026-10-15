mod common;

use common::setup_test_db;
use server::cleanup::{
    operator_queue_retention::OperatorQueueRetentionJob,
    operator_queue_timeout::OperatorQueueTimeoutJob, CleanupContextOwned, CleanupJob,
};
use server::config::Config;
use server::login::LoginStore;
use server::rate_limit::{self, RateLimitKey};
use server::registration::RegistrationStore;
use sqlx::SqlitePool;
use std::sync::Arc;

const DUMMY_TOKEN: &str =
    "token_alice_1234567890123456789012345678901234567890123456789012345678901234567890123456789012";

fn test_config() -> Config {
    Config {
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
        edit_window_seconds: config_arc.server_max_edit_window_seconds,
    });

    let sockudo_config = server::SockudoConfig {
        http_base: "http://localhost:8080".to_string(),
        app_id: "test_app".to_string(),
        app_key: "test_key".to_string(),
        app_secret: "test_secret".to_string(),
        enable_client_events: true,
    };
    let publisher = Arc::new(server::Publisher::new(sockudo_config));

    CleanupContextOwned {
        pool,
        config: config_arc,
        registration_store: Arc::new(RegistrationStore::new()),
        login_store: Arc::new(LoginStore::new()),
        recovery_store: Arc::new(server::RecoveryStore::new()),
        storage,
        server_max,
        publisher,
    }
}

async fn create_user_and_bot(pool: &SqlitePool, bot_id: &str, owner_id: &str) {
    sqlx::query("INSERT INTO users (id, username_token, opaque_registration, identity_pubkey) VALUES (?, ?, 'reg', 'pub') ON CONFLICT DO NOTHING")
        .bind(owner_id)
        .bind(DUMMY_TOKEN)
        .execute(pool)
        .await
        .unwrap();

    let pubkey_bytes = vec![0u8; 32];
    sqlx::query("INSERT INTO bot_accounts (id, owner_user_id, display_name, bot_identity_pubkey, bot_command_pubkey, identity_pubkey) VALUES (?, ?, 'Test Bot', ?, ?, ?)")
        .bind(bot_id)
        .bind(owner_id)
        .bind(&pubkey_bytes)
        .bind(&pubkey_bytes)
        .bind(&pubkey_bytes)
        .execute(pool)
        .await
        .unwrap();
}

#[tokio::test]
async fn test_01_timeout_job_ignore_mode() {
    let pool = setup_test_db().await;
    let ctx = build_ctx(pool.clone(), test_config());

    create_user_and_bot(&pool, "b1", "u1").await;

    // Past timeout_at, on_timeout = 'ignore'
    sqlx::query(
        r#"
        INSERT INTO bot_operator_queue (id, bot_id, audience, payload, payload_preview, status, timeout_at, on_timeout)
        VALUES ('req_exp_ignore', 'b1', 'private', '{}', 'preview', 'pending', datetime('now', '-10 minutes'), 'ignore')
        "#,
    )
    .execute(&pool)
    .await
    .unwrap();

    let job = OperatorQueueTimeoutJob;
    let report = job.run(&ctx.as_ctx()).await.unwrap();
    assert_eq!(report.rows_deleted, 1);

    let (status, answered_at): (String, Option<String>) = sqlx::query_as(
        "SELECT status, CAST(answered_at AS TEXT) FROM bot_operator_queue WHERE id = 'req_exp_ignore'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(status, "expired");
    assert!(answered_at.is_some());

    let event_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM bot_event_log WHERE bot_id = 'b1'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(event_count, 0);
}

#[tokio::test]
async fn test_02_timeout_job_canned_mode_publishes_event() {
    let pool = setup_test_db().await;
    let ctx = build_ctx(pool.clone(), test_config());

    create_user_and_bot(&pool, "b2", "u1").await;

    // Past timeout_at, on_timeout = 'canned'
    sqlx::query(
        r#"
        INSERT INTO bot_operator_queue (id, bot_id, audience, payload, payload_preview, status, timeout_at, on_timeout, canned_response)
        VALUES ('req_exp_canned', 'b2', 'private', '{}', 'preview', 'pending', datetime('now', '-10 minutes'), 'canned', 'Sorry, no operator available.')
        "#,
    )
    .execute(&pool)
    .await
    .unwrap();

    let job = OperatorQueueTimeoutJob;
    let report = job.run(&ctx.as_ctx()).await.unwrap();
    assert_eq!(report.rows_deleted, 1);

    let (status, answered_at): (String, Option<String>) = sqlx::query_as(
        "SELECT status, CAST(answered_at AS TEXT) FROM bot_operator_queue WHERE id = 'req_exp_canned'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(status, "expired");
    assert!(answered_at.is_some());

    let (bot_seq, event_type, payload_str): (i64, String, String) = sqlx::query_as(
        "SELECT bot_seq, event_type, payload FROM bot_event_log WHERE bot_id = 'b2' ORDER BY bot_seq DESC LIMIT 1",
    )
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(bot_seq, 1);
    assert_eq!(event_type, "bot.operator_response");

    let payload_val: serde_json::Value = serde_json::from_str(&payload_str).unwrap();
    assert_eq!(payload_val["request_id"], "req_exp_canned");
    assert_eq!(payload_val["response"], "Sorry, no operator available.");
    assert_eq!(payload_val["routing"], "private");
    assert!(payload_val["responded_by"].is_null());
    assert_eq!(payload_val["bot_seq"], 1);
}

#[tokio::test]
async fn test_03_timeout_job_canned_mode_null_response_warns_and_expires() {
    let pool = setup_test_db().await;
    let ctx = build_ctx(pool.clone(), test_config());

    create_user_and_bot(&pool, "b3", "u1").await;

    // Past timeout_at, on_timeout = 'canned', canned_response = NULL
    sqlx::query(
        r#"
        INSERT INTO bot_operator_queue (id, bot_id, audience, payload, payload_preview, status, timeout_at, on_timeout, canned_response)
        VALUES ('req_exp_null_canned', 'b3', 'private', '{}', 'preview', 'pending', datetime('now', '-10 minutes'), 'canned', NULL)
        "#,
    )
    .execute(&pool)
    .await
    .unwrap();

    let job = OperatorQueueTimeoutJob;
    let report = job.run(&ctx.as_ctx()).await.unwrap();
    assert_eq!(report.rows_deleted, 1);

    let status: String = sqlx::query_scalar(
        "SELECT status FROM bot_operator_queue WHERE id = 'req_exp_null_canned'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(status, "expired");

    let event_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM bot_event_log WHERE bot_id = 'b3'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(event_count, 0);
}

#[tokio::test]
async fn test_04_timeout_job_skips_future_and_null_timeouts() {
    let pool = setup_test_db().await;
    let ctx = build_ctx(pool.clone(), test_config());

    create_user_and_bot(&pool, "b4", "u1").await;

    // Future timeout
    sqlx::query(
        r#"
        INSERT INTO bot_operator_queue (id, bot_id, audience, payload, payload_preview, status, timeout_at, on_timeout)
        VALUES ('req_future', 'b4', 'private', '{}', 'preview', 'pending', datetime('now', '+1 hour'), 'canned')
        "#,
    )
    .execute(&pool)
    .await
    .unwrap();

    // NULL timeout
    sqlx::query(
        r#"
        INSERT INTO bot_operator_queue (id, bot_id, audience, payload, payload_preview, status, timeout_at, on_timeout)
        VALUES ('req_null_timeout', 'b4', 'private', '{}', 'preview', 'pending', NULL, 'canned')
        "#,
    )
    .execute(&pool)
    .await
    .unwrap();

    let job = OperatorQueueTimeoutJob;
    let report = job.run(&ctx.as_ctx()).await.unwrap();
    assert_eq!(report.rows_deleted, 0);

    let pending_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM bot_operator_queue WHERE bot_id = 'b4' AND status = 'pending'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(pending_count, 2);
}

#[tokio::test]
async fn test_05_retention_pruning_job() {
    let pool = setup_test_db().await;
    let ctx = build_ctx(pool.clone(), test_config());

    create_user_and_bot(&pool, "b5", "u1").await;

    // Answered > 7 days ago -> PRUNED
    sqlx::query(
        r#"
        INSERT INTO bot_operator_queue (id, bot_id, audience, payload, payload_preview, status, answered_at)
        VALUES ('req_ans_8d', 'b5', 'private', '{}', 'preview', 'answered', datetime('now', '-8 days'))
        "#,
    )
    .execute(&pool)
    .await
    .unwrap();

    // Expired > 7 days ago -> PRUNED
    sqlx::query(
        r#"
        INSERT INTO bot_operator_queue (id, bot_id, audience, payload, payload_preview, status, answered_at)
        VALUES ('req_exp_8d', 'b5', 'private', '{}', 'preview', 'expired', datetime('now', '-8 days'))
        "#,
    )
    .execute(&pool)
    .await
    .unwrap();

    // Answered < 7 days ago -> RETAINED
    sqlx::query(
        r#"
        INSERT INTO bot_operator_queue (id, bot_id, audience, payload, payload_preview, status, answered_at)
        VALUES ('req_ans_2d', 'b5', 'private', '{}', 'preview', 'answered', datetime('now', '-2 days'))
        "#,
    )
    .execute(&pool)
    .await
    .unwrap();

    // Pending > 7 days ago -> RETAINED (only answered and expired are pruned)
    sqlx::query(
        r#"
        INSERT INTO bot_operator_queue (id, bot_id, audience, payload, payload_preview, status, queued_at)
        VALUES ('req_pend_8d', 'b5', 'private', '{}', 'preview', 'pending', datetime('now', '-8 days'))
        "#,
    )
    .execute(&pool)
    .await
    .unwrap();

    let job = OperatorQueueRetentionJob;
    let report = job.run(&ctx.as_ctx()).await.unwrap();
    assert_eq!(report.rows_deleted, 2);

    let remaining_ids: Vec<String> =
        sqlx::query_scalar("SELECT id FROM bot_operator_queue WHERE bot_id = 'b5' ORDER BY id ASC")
            .fetch_all(&pool)
            .await
            .unwrap();

    assert_eq!(
        remaining_ids,
        vec!["req_ans_2d".to_string(), "req_pend_8d".to_string()]
    );

    // Idempotency check
    let report2 = job.run(&ctx.as_ctx()).await.unwrap();
    assert_eq!(report2.rows_deleted, 0);
}

#[tokio::test]
async fn test_06_rate_limit_key_isolation_and_exhaustion() {
    let pool = setup_test_db().await;
    let config = Config::test_default();

    // Test OperatorQueueList bucket limit
    let key_list1 = RateLimitKey::OperatorQueueList {
        bot_id: "bot_a".to_string(),
        user_id: "op_1".to_string(),
    };
    let key_list2 = RateLimitKey::OperatorQueueList {
        bot_id: "bot_a".to_string(),
        user_id: "op_2".to_string(),
    };

    for _ in 0..60 {
        let dec = rate_limit::check(&pool, &config.rate_limits, key_list1.clone())
            .await
            .unwrap();
        assert!(dec.allowed);
    }

    let breached = rate_limit::check(&pool, &config.rate_limits, key_list1.clone())
        .await
        .unwrap();
    assert!(!breached.allowed);

    // Distinct operator has full bucket
    let dec_op2 = rate_limit::check(&pool, &config.rate_limits, key_list2)
        .await
        .unwrap();
    assert!(dec_op2.allowed);

    // Test OperatorQueueRespond bucket limit
    let key_resp = RateLimitKey::OperatorQueueRespond {
        bot_id: "bot_a".to_string(),
        user_id: "op_1".to_string(),
    };

    for _ in 0..30 {
        let dec = rate_limit::check(&pool, &config.rate_limits, key_resp.clone())
            .await
            .unwrap();
        assert!(dec.allowed);
    }

    let breached_resp = rate_limit::check(&pool, &config.rate_limits, key_resp)
        .await
        .unwrap();
    assert!(!breached_resp.allowed);
}
