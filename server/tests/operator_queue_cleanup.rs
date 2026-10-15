use axum::http::{header, Request, StatusCode};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use serde_json::{json, Value};
use server::cleanup::operator_queue::{OperatorQueueRetentionJob, OperatorQueueTimeoutJob};
use server::cleanup::{CleanupJob, CleanupReport};
use std::sync::Arc;
use tower::ServiceExt;

mod common;

fn sample_pubkey() -> String {
    URL_SAFE_NO_PAD.encode([12u8; 32])
}

async fn create_test_bot(app: &axum::Router, user_token: &str, name: &str) -> (String, String) {
    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/bots")
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(axum::body::Body::from(
            json!({
                "display_name": name,
                "bot_identity_pubkey": sample_pubkey(),
                "bot_command_pubkey": sample_pubkey(),
                "identity_pubkey": sample_pubkey(),
                "declared_scopes": ["post_message"]
            })
            .to_string(),
        ))
        .unwrap();

    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::CREATED);
    let bytes = axum::body::to_bytes(res.into_body(), usize::MAX)
        .await
        .unwrap();
    let body: Value = serde_json::from_slice(&bytes).unwrap();
    let bot_id = body["bot_id"].as_str().unwrap().to_string();
    let bot_token = body["bot_token"].as_str().unwrap().to_string();
    (bot_id, bot_token)
}

fn build_cleanup_ctx(
    pool: sqlx::SqlitePool,
    config: server::Config,
) -> server::cleanup::CleanupContextOwned {
    let config_arc = Arc::new(config);
    let storage = server::build_storage(&config_arc).unwrap();
    let server_max = Arc::new(server::ServerHardMax::default());

    let sockudo_config = server::sockudo::SockudoConfig {
        http_base: "http://localhost:6001".to_string(),
        app_id: "chat".to_string(),
        app_key: "test-key".to_string(),
        app_secret: "test-secret".to_string(),
        enable_client_events: true,
    };
    let publisher = Arc::new(server::Publisher::new(sockudo_config));

    server::cleanup::CleanupContextOwned {
        pool,
        config: config_arc,
        registration_store: Arc::new(server::registration::RegistrationStore::new()),
        login_store: Arc::new(server::login::LoginStore::new()),
        recovery_store: Arc::new(server::RecoveryStore::new()),
        storage,
        server_max,
        publisher,
    }
}

#[tokio::test]
async fn test_operator_queue_timeout_job_scenarios() {
    let (app, pool) = common::setup_test_app().await;
    let (owner_token, _owner_id) = common::create_test_user_and_session(&app, &pool).await;
    let (bot_id, _bot_token) = create_test_bot(&app, &owner_token, "Timeout Bot").await;

    // 1. Past timeout, on_timeout = 'ignore' -> status = 'expired', answered_at set, no event logged
    sqlx::query(
        r#"
        INSERT INTO bot_operator_queue (id, bot_id, audience, payload, payload_preview, status, timeout_at, on_timeout)
        VALUES ('q_exp_ignore', ?, 'private', '{}', '[req]', 'pending', datetime('now', '-1 hour'), 'ignore')
        "#,
    )
    .bind(&bot_id)
    .execute(&pool)
    .await
    .unwrap();

    // 2. Past timeout, on_timeout = 'canned' with canned_response -> status = 'expired', answered_at set, event in bot_event_log
    sqlx::query(
        r#"
        INSERT INTO bot_operator_queue (id, bot_id, audience, payload, payload_preview, status, timeout_at, on_timeout, canned_response)
        VALUES ('q_exp_canned', ?, 'private', '{}', '[req]', 'pending', datetime('now', '-1 hour'), 'canned', 'Automated fallback response')
        "#,
    )
    .bind(&bot_id)
    .execute(&pool)
    .await
    .unwrap();

    // 3. Future timeout -> status remains 'pending'
    sqlx::query(
        r#"
        INSERT INTO bot_operator_queue (id, bot_id, audience, payload, payload_preview, status, timeout_at, on_timeout)
        VALUES ('q_future', ?, 'private', '{}', '[req]', 'pending', datetime('now', '+1 hour'), 'canned')
        "#,
    )
    .bind(&bot_id)
    .execute(&pool)
    .await
    .unwrap();

    // 4. NULL timeout_at -> status remains 'pending'
    sqlx::query(
        r#"
        INSERT INTO bot_operator_queue (id, bot_id, audience, payload, payload_preview, status, timeout_at, on_timeout)
        VALUES ('q_null_timeout', ?, 'private', '{}', '[req]', 'pending', NULL, 'canned')
        "#,
    )
    .bind(&bot_id)
    .execute(&pool)
    .await
    .unwrap();

    // 5. Already answered -> untouched by timeout job
    sqlx::query(
        r#"
        INSERT INTO bot_operator_queue (id, bot_id, audience, payload, payload_preview, status, timeout_at, answered_at, response)
        VALUES ('q_answered', ?, 'private', '{}', '[req]', 'answered', datetime('now', '-1 hour'), datetime('now', '-30 minutes'), 'Human response')
        "#,
    )
    .bind(&bot_id)
    .execute(&pool)
    .await
    .unwrap();

    // 6. Canned with NULL canned_response -> status = 'expired', warn logged, no event published
    sqlx::query(
        r#"
        INSERT INTO bot_operator_queue (id, bot_id, audience, payload, payload_preview, status, timeout_at, on_timeout, canned_response)
        VALUES ('q_canned_null', ?, 'private', '{}', '[req]', 'pending', datetime('now', '-1 hour'), 'canned', NULL)
        "#,
    )
    .bind(&bot_id)
    .execute(&pool)
    .await
    .unwrap();

    let config = server::Config::test_default();
    let ctx_owned = build_cleanup_ctx(pool.clone(), config);
    let job = OperatorQueueTimeoutJob;

    let report: CleanupReport = job.run(&ctx_owned.as_ctx()).await.unwrap();
    assert_eq!(report.rows_deleted, 3); // q_exp_ignore, q_exp_canned, q_canned_null

    // Verify q_exp_ignore
    let status_ignore: String =
        sqlx::query_scalar("SELECT status FROM bot_operator_queue WHERE id = 'q_exp_ignore'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(status_ignore, "expired");

    // Verify q_exp_canned
    let status_canned: String =
        sqlx::query_scalar("SELECT status FROM bot_operator_queue WHERE id = 'q_exp_canned'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(status_canned, "expired");

    // Verify bot_event_log for q_exp_canned
    let event_row: (i64, String, String) = sqlx::query_as(
        "SELECT bot_seq, event_type, payload FROM bot_event_log WHERE bot_id = ? AND event_type = 'bot.operator_response'",
    )
    .bind(&bot_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(event_row.0, 1);
    assert_eq!(event_row.1, "bot.operator_response");
    let payload_json: Value = serde_json::from_str(&event_row.2).unwrap();
    assert_eq!(payload_json["request_id"], "q_exp_canned");
    assert_eq!(payload_json["response"], "Automated fallback response");
    assert_eq!(payload_json["routing"], "private");
    assert!(payload_json["responded_by"].is_null());
    assert!(payload_json["bot_seq"].is_number());

    // Verify q_future remains pending
    let status_future: String =
        sqlx::query_scalar("SELECT status FROM bot_operator_queue WHERE id = 'q_future'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(status_future, "pending");

    // Verify q_null_timeout remains pending
    let status_null: String =
        sqlx::query_scalar("SELECT status FROM bot_operator_queue WHERE id = 'q_null_timeout'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(status_null, "pending");

    // Verify q_canned_null is expired
    let status_canned_null: String =
        sqlx::query_scalar("SELECT status FROM bot_operator_queue WHERE id = 'q_canned_null'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(status_canned_null, "expired");

    // Idempotency check on subsequent run
    let report_second = job.run(&ctx_owned.as_ctx()).await.unwrap();
    assert_eq!(report_second.rows_deleted, 0);
}

#[tokio::test]
async fn test_operator_queue_retention_job_scenarios() {
    let (app, pool) = common::setup_test_app().await;
    let (owner_token, _owner_id) = common::create_test_user_and_session(&app, &pool).await;
    let (bot_id, _bot_token) = create_test_bot(&app, &owner_token, "Prune Bot").await;

    // 1. Answered row older than 7 days -> pruned
    sqlx::query(
        r#"
        INSERT INTO bot_operator_queue (id, bot_id, audience, payload, payload_preview, status, answered_at)
        VALUES ('q_old_answered', ?, 'private', '{}', '[req]', 'answered', datetime('now', '-8 days'))
        "#,
    )
    .bind(&bot_id)
    .execute(&pool)
    .await
    .unwrap();

    // 2. Expired row older than 7 days -> pruned
    sqlx::query(
        r#"
        INSERT INTO bot_operator_queue (id, bot_id, audience, payload, payload_preview, status, answered_at)
        VALUES ('q_old_expired', ?, 'private', '{}', '[req]', 'expired', datetime('now', '-8 days'))
        "#,
    )
    .bind(&bot_id)
    .execute(&pool)
    .await
    .unwrap();

    // 3. Pending row older than 7 days -> retained
    sqlx::query(
        r#"
        INSERT INTO bot_operator_queue (id, bot_id, audience, payload, payload_preview, status, queued_at)
        VALUES ('q_old_pending', ?, 'private', '{}', '[req]', 'pending', datetime('now', '-8 days'))
        "#,
    )
    .bind(&bot_id)
    .execute(&pool)
    .await
    .unwrap();

    // 4. Answered row within 7 days -> retained
    sqlx::query(
        r#"
        INSERT INTO bot_operator_queue (id, bot_id, audience, payload, payload_preview, status, answered_at)
        VALUES ('q_recent_answered', ?, 'private', '{}', '[req]', 'answered', datetime('now', '-3 days'))
        "#,
    )
    .bind(&bot_id)
    .execute(&pool)
    .await
    .unwrap();

    let config = server::Config::test_default();
    let ctx_owned = build_cleanup_ctx(pool.clone(), config);
    let job = OperatorQueueRetentionJob;

    let report = job.run(&ctx_owned.as_ctx()).await.unwrap();
    assert_eq!(report.rows_deleted, 2); // q_old_answered and q_old_expired

    let cnt_old_answered: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM bot_operator_queue WHERE id = 'q_old_answered'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(cnt_old_answered, 0);

    let cnt_old_expired: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM bot_operator_queue WHERE id = 'q_old_expired'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(cnt_old_expired, 0);

    let cnt_old_pending: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM bot_operator_queue WHERE id = 'q_old_pending'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(cnt_old_pending, 1);

    let cnt_recent: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM bot_operator_queue WHERE id = 'q_recent_answered'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(cnt_recent, 1);

    // Idempotent on second run
    let report_second = job.run(&ctx_owned.as_ctx()).await.unwrap();
    assert_eq!(report_second.rows_deleted, 0);
}

#[tokio::test]
async fn test_operator_queue_rate_limits_and_buckets() {
    let (app, pool) = common::setup_test_app().await;
    let (owner_token, owner_id) = common::create_test_user_and_session(&app, &pool).await;
    let (op2_token, op2_id) = common::create_test_user_and_session(&app, &pool).await;

    let room_id = format!("r_{}", ulid::Ulid::new());
    sqlx::query("INSERT INTO rooms (id, owner_id) VALUES (?, ?)")
        .bind(&room_id)
        .bind(&owner_id)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO room_members (room_id, user_id, role) VALUES (?, ?, 'owner')")
        .bind(&room_id)
        .bind(&owner_id)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO room_members (room_id, user_id, role) VALUES (?, ?, 'member')")
        .bind(&room_id)
        .bind(&op2_id)
        .execute(&pool)
        .await
        .unwrap();

    let (bot_id_1, _) = create_test_bot(&app, &owner_token, "Bot 1").await;
    let (bot_id_2, _) = create_test_bot(&app, &owner_token, "Bot 2").await;

    // Grant bot_id_1 with op2_id as additional operator
    let req_grant = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/bots", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", owner_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(axum::body::Body::from(
            json!({
                "bot_id": bot_id_1,
                "scopes": ["post_message"],
                "operators": [op2_id]
            })
            .to_string(),
        ))
        .unwrap();
    let res_grant = app.clone().oneshot(req_grant).await.unwrap();
    assert_eq!(res_grant.status(), StatusCode::CREATED);

    // 1. List endpoint rate limit (default 60/min)
    for i in 1..=60 {
        let req = Request::builder()
            .method("GET")
            .uri(format!("/api/v1/bots/{}/operator-queue", bot_id_1))
            .header(header::AUTHORIZATION, format!("Bearer {}", owner_token))
            .body(axum::body::Body::empty())
            .unwrap();

        let res = app.clone().oneshot(req).await.unwrap();
        assert_eq!(res.status(), StatusCode::OK, "Request {} failed", i);
    }

    // 61st list request from owner on bot_id_1 breaches rate limit -> 429
    let req_breach = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/bots/{}/operator-queue", bot_id_1))
        .header(header::AUTHORIZATION, format!("Bearer {}", owner_token))
        .body(axum::body::Body::empty())
        .unwrap();

    let res_breach = app.clone().oneshot(req_breach).await.unwrap();
    assert_eq!(res_breach.status(), StatusCode::TOO_MANY_REQUESTS);
    assert!(res_breach.headers().get(header::RETRY_AFTER).is_some());

    // Bucket Isolation A: op2 on bot_id_1 is NOT rate-limited
    let req_op2 = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/bots/{}/operator-queue", bot_id_1))
        .header(header::AUTHORIZATION, format!("Bearer {}", op2_token))
        .body(axum::body::Body::empty())
        .unwrap();

    let res_op2 = app.clone().oneshot(req_op2).await.unwrap();
    assert_eq!(res_op2.status(), StatusCode::OK);

    // Bucket Isolation B: owner on bot_id_2 is NOT rate-limited
    let req_bot2 = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/bots/{}/operator-queue", bot_id_2))
        .header(header::AUTHORIZATION, format!("Bearer {}", owner_token))
        .body(axum::body::Body::empty())
        .unwrap();

    let res_bot2 = app.clone().oneshot(req_bot2).await.unwrap();
    assert_eq!(res_bot2.status(), StatusCode::OK);

    // 2. Detail endpoint is UNTHROTTLED: fire 70 requests, all return 404 (entry_not_found) or 200, no 429
    for _ in 0..70 {
        let req_detail = Request::builder()
            .method("GET")
            .uri(format!(
                "/api/v1/bots/{}/operator-queue/nonexistent_id",
                bot_id_1
            ))
            .header(header::AUTHORIZATION, format!("Bearer {}", owner_token))
            .body(axum::body::Body::empty())
            .unwrap();

        let res_detail = app.clone().oneshot(req_detail).await.unwrap();
        assert_ne!(res_detail.status(), StatusCode::TOO_MANY_REQUESTS);
    }

    // 3. Respond endpoint rate limit (default 30/min)
    // Seed pending rows
    for i in 1..=35 {
        sqlx::query(
            "INSERT INTO bot_operator_queue (id, bot_id, audience, payload, payload_preview, status) VALUES (?, ?, 'private', '{}', '[req]', 'pending')",
        )
        .bind(format!("q_resp_{}", i))
        .bind(&bot_id_1)
        .execute(&pool)
        .await
        .unwrap();
    }

    for i in 1..=30 {
        let req_resp = Request::builder()
            .method("POST")
            .uri(format!(
                "/api/v1/bots/{}/operator-queue/q_resp_{}/respond",
                bot_id_1, i
            ))
            .header(header::AUTHORIZATION, format!("Bearer {}", owner_token))
            .header(header::CONTENT_TYPE, "application/json")
            .body(axum::body::Body::from(
                json!({ "response": "Accepted" }).to_string(),
            ))
            .unwrap();

        let res_resp = app.clone().oneshot(req_resp).await.unwrap();
        assert_eq!(
            res_resp.status(),
            StatusCode::OK,
            "Respond request {} failed",
            i
        );
    }

    // 31st respond request breaches limit -> 429
    let req_resp_breach = Request::builder()
        .method("POST")
        .uri(format!(
            "/api/v1/bots/{}/operator-queue/q_resp_31/respond",
            bot_id_1
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", owner_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(axum::body::Body::from(
            json!({ "response": "Accepted" }).to_string(),
        ))
        .unwrap();

    let res_resp_breach = app.clone().oneshot(req_resp_breach).await.unwrap();
    assert_eq!(res_resp_breach.status(), StatusCode::TOO_MANY_REQUESTS);
    assert!(res_resp_breach.headers().get(header::RETRY_AFTER).is_some());

    // Verify rate-limited request did not mutate state (q_resp_31 is still pending)
    let status_31: String =
        sqlx::query_scalar("SELECT status FROM bot_operator_queue WHERE id = 'q_resp_31'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(status_31, "pending");
}

#[tokio::test]
async fn test_operator_queue_regressions_and_sync() {
    let (app, pool) = common::setup_test_app().await;
    let (owner_token, owner_id) = common::create_test_user_and_session(&app, &pool).await;
    let (bot_id, bot_token) = create_test_bot(&app, &owner_token, "Sync Bot").await;

    // Seed past canned row
    sqlx::query(
        r#"
        INSERT INTO bot_operator_queue (id, bot_id, audience, payload, payload_preview, status, timeout_at, on_timeout, canned_response)
        VALUES ('q_sync_test', ?, 'private', '{}', '[req]', 'pending', datetime('now', '-1 hour'), 'canned', 'Sync fallback')
        "#,
    )
    .bind(&bot_id)
    .execute(&pool)
    .await
    .unwrap();

    let config = server::Config::test_default();
    let ctx_owned = build_cleanup_ctx(pool.clone(), config);
    let timeout_job = OperatorQueueTimeoutJob;

    timeout_job.run(&ctx_owned.as_ctx()).await.unwrap();

    // Verify Task A sync endpoint GET /api/v1/bots/me/sync receives bot.operator_response
    let req_sync = Request::builder()
        .method("GET")
        .uri("/api/v1/bots/me/sync?since_bot_seq=0")
        .header(header::AUTHORIZATION, format!("Bearer {}", bot_token))
        .body(axum::body::Body::empty())
        .unwrap();

    let res_sync = app.clone().oneshot(req_sync).await.unwrap();
    assert_eq!(res_sync.status(), StatusCode::OK);

    let bytes_sync = axum::body::to_bytes(res_sync.into_body(), usize::MAX)
        .await
        .unwrap();
    let sync_body: Value = serde_json::from_slice(&bytes_sync).unwrap();

    let events = sync_body["events"].as_array().unwrap();
    assert_eq!(events.len(), 1);
    assert_eq!(events[0]["event_type"], "bot.operator_response");
    assert_eq!(events[0]["payload"]["request_id"], "q_sync_test");
    assert_eq!(events[0]["payload"]["response"], "Sync fallback");

    // Verify Task B operators array still visible on GET /bots/:id
    let req_bot = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/bots/{}", bot_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", owner_token))
        .body(axum::body::Body::empty())
        .unwrap();

    let res_bot = app.clone().oneshot(req_bot).await.unwrap();
    assert_eq!(res_bot.status(), StatusCode::OK);
    let bytes_bot = axum::body::to_bytes(res_bot.into_body(), usize::MAX)
        .await
        .unwrap();
    let bot_body: Value = serde_json::from_slice(&bytes_bot).unwrap();
    let ops = bot_body["operators"].as_array().unwrap();
    assert_eq!(ops.len(), 1);
    assert_eq!(ops[0]["user_id"], owner_id);
}
