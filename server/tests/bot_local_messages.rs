use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use axum::Router;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use serde_json::{json, Value};
use sqlx::SqlitePool;
use std::path::Path;
use std::sync::Arc;
use tower::ServiceExt;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

mod common;

fn valid_pubkey() -> String {
    URL_SAFE_NO_PAD.encode([7u8; 32])
}

async fn setup_test_app_with_sockudo_mock() -> (Router, SqlitePool, MockServer) {
    let mock_server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/apps/chat/events"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"ok": true})))
        .mount(&mock_server)
        .await;

    std::env::set_var("APP_ENV", "development");

    let pool = common::setup_test_db().await;

    let config = server::Config {
        opaque_oprf_key_path: "./data/oprf.key".to_string(),
        altcha_enabled: true,
        altcha_hmac_secret: "auto".to_string(),
        altcha_cost: 100,
        cleanup_startup_delay_secs: 30,
        sockudo_url: mock_server.uri(),
        sockudo_app_key: "test-app-key".to_string(),
        sockudo_app_secret: "test-app-secret".to_string(),
        ..server::Config::test_default()
    };

    let opaque_server = Arc::new(
        server::OpaqueServer::load_or_generate(Path::new("./data/test_oprf_meta.key")).unwrap(),
    );
    let registration_store = Arc::new(server::RegistrationStore::new());
    let login_store = Arc::new(server::LoginStore::new());
    let altcha_config = Arc::new(
        server::AltchaConfig::from_env(&config, &pool)
            .await
            .unwrap(),
    );
    let server_hard_max = Arc::new(server::ServerHardMax {
        file_size_bytes: config.max_file_size_bytes as i64,
        room_size: 1000,
        rooms_per_user: 500,
        devices_per_user: config.server_max_devices_per_user as i64,
        keypackages_per_device: 50,
        message_size_bytes: 65536,
        attachment_retention_days: 365,
        call_max_participants: 50,
        reactions_per_message: 50,
        room_metadata_bytes: config.server_max_room_metadata_bytes,
        edit_window_seconds: config.server_max_edit_window_seconds,
    });

    let sockudo_cfg = server::SockudoConfig {
        http_base: mock_server.uri(),
        app_id: "chat".to_string(),
        app_key: "test-app-key".to_string(),
        app_secret: "test-app-secret".to_string(),
        enable_client_events: true,
    };
    let storage = server::build_storage(&config).expect("Failed to build storage");
    let publisher = Arc::new(server::Publisher::new(sockudo_cfg));

    let oprf_keys = server::oprf::OprfKeys::load(&opaque_server.setup).unwrap();
    let oprf = Arc::new(server::oprf::OprfEvaluator::new(&oprf_keys));
    let oprf_audit = Arc::new(server::oprf::OprfAuditCounter::new());

    let session_types_state = server::sessions::init_session_types_state(
        config.sessions_enabled,
        &config.session_types_config_path,
        config.server_max_session_participants,
        config.server_max_sessions_per_room,
    );
    let session_types = Arc::new(server::sessions::SessionTypesStore::new(
        session_types_state,
    ));

    let state = server::AppState {
        pool: pool.clone(),
        opaque_server,
        registration_store,
        login_store,
        recovery_store: Arc::new(server::RecoveryStore::new()),
        altcha_config,
        config: Arc::new(config),
        server_hard_max,
        publisher,
        storage,
        backup_lock: Arc::new(tokio::sync::Mutex::new(())),
        oprf_rotation_lock: Arc::new(tokio::sync::Mutex::new(())),
        vapid_keys: None,
        push_delivery: None,
        oprf,
        oprf_audit,
        link_preview_keys: None,
        session_types,
        models: std::sync::Arc::new(server::models::ModelStore::new(
            std::path::PathBuf::from("/tmp/stt"),
            std::path::PathBuf::from("/tmp/tts"),
        )),
        occupancy: server::sessions::OccupancyStore::new(),
        bot_connection_state: server::bots::BotConnectionState::new(),
        call_occupancy: server::calls::CallOccupancyStore::new(),
        extension_proxy_blocklist: std::sync::Arc::new(
            server::extensions_proxy::blocklist::DomainBlocklistStore::new(Default::default()),
        ),
    };

    let app = server::build_app(state);
    (app, pool, mock_server)
}

async fn create_user(app: &Router, pool: &SqlitePool, _username: &str) -> (String, String) {
    let (token, user_id) = common::create_test_user_and_session(app, pool).await;
    (user_id, token)
}

async fn create_bot(app: &Router, owner_token: &str, name: &str) -> (String, String) {
    let req_body = json!({
        "display_name": name,
        "bot_identity_pubkey": valid_pubkey(),
        "bot_command_pubkey": valid_pubkey(),
        "identity_pubkey": valid_pubkey(),
        "declared_scopes": ["post_message", "read_content"]
    });

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/bots")
                .header(header::AUTHORIZATION, format!("Bearer {}", owner_token))
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(serde_json::to_vec(&req_body).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::CREATED);
    let body_bytes = axum::body::to_bytes(response.into_body(), 65536)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body_bytes).unwrap();
    let bot_id = json["bot_id"].as_str().unwrap().to_string();
    let bot_token = json["bot_token"].as_str().unwrap().to_string();

    (bot_id, bot_token)
}

#[tokio::test]
async fn test_bot_local_message_happy_path() {
    let (app, pool, mock_server) = setup_test_app_with_sockudo_mock().await;
    let (owner_id, owner_token) = create_user(&app, &pool, "owner_hlm").await;
    let (_bot_id, bot_token) = create_bot(&app, &owner_token, "Owner Bot").await;

    // Capture initial owner user_seq
    let initial_user_seq: Option<i64> =
        sqlx::query_scalar("SELECT next_seq FROM user_seq WHERE user_id = ?")
            .bind(&owner_id)
            .fetch_optional(&pool)
            .await
            .unwrap();

    let ct = URL_SAFE_NO_PAD.encode(b"diagnostic payload");
    let pk = valid_pubkey();

    let req_body = json!({
        "target": "owner",
        "result_type": "local_message",
        "ciphertext": ct,
        "bot_result_pubkey": pk
    });

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/bots/me/messages")
                .header(header::AUTHORIZATION, format!("Bearer {}", bot_token))
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(serde_json::to_vec(&req_body).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::NO_CONTENT);
    assert_eq!(
        response.headers().get(header::CACHE_CONTROL).unwrap(),
        "no-store"
    );

    // Verify user_seq unchanged
    let post_user_seq: Option<i64> =
        sqlx::query_scalar("SELECT next_seq FROM user_seq WHERE user_id = ?")
            .bind(&owner_id)
            .fetch_optional(&pool)
            .await
            .unwrap();
    assert_eq!(initial_user_seq, post_user_seq);

    // Verify Sockudo publication received on private-user-{owner_id}
    let reqs = mock_server.received_requests().await.unwrap();
    let mut found_event = false;
    for req in reqs {
        let body_json: Value = serde_json::from_slice(&req.body).unwrap();
        if body_json["name"] == "bot.local_message" {
            assert_eq!(
                body_json["channels"][0],
                format!("private-user-{}", owner_id)
            );
            let payload: Value = serde_json::from_str(body_json["data"].as_str().unwrap()).unwrap();
            assert_eq!(payload["result_type"], "local_message");
            assert_eq!(payload["ciphertext"], ct);
            assert_eq!(payload["bot_result_pubkey"], pk);
            found_event = true;
        }
    }
    assert!(found_event);
}

#[tokio::test]
async fn test_bot_local_message_validation_errors() {
    let (app, pool, _mock) = setup_test_app_with_sockudo_mock().await;
    let (_owner_id, owner_token) = create_user(&app, &pool, "owner_val").await;
    let (_bot_id, bot_token) = create_bot(&app, &owner_token, "Val Bot").await;

    let ct = URL_SAFE_NO_PAD.encode(b"hello");
    let pk = valid_pubkey();

    // 1. result_type = "none" => 400 invalid_result_type
    let res = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/bots/me/messages")
                .header(header::AUTHORIZATION, format!("Bearer {}", bot_token))
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    serde_json::to_vec(&json!({
                        "target": "owner",
                        "result_type": "none",
                        "ciphertext": ct,
                        "bot_result_pubkey": pk
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);

    // 2. Unrecognized result_type => 400 invalid_result_type
    let res = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/bots/me/messages")
                .header(header::AUTHORIZATION, format!("Bearer {}", bot_token))
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    serde_json::to_vec(&json!({
                        "target": "owner",
                        "result_type": "invalid_type",
                        "ciphertext": ct,
                        "bot_result_pubkey": pk
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);

    // 3. Missing ciphertext => 400 invalid_ciphertext
    let res = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/bots/me/messages")
                .header(header::AUTHORIZATION, format!("Bearer {}", bot_token))
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    serde_json::to_vec(&json!({
                        "target": "owner",
                        "result_type": "toast",
                        "bot_result_pubkey": pk
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);

    // 4. Malformed base64url ciphertext => 400 invalid_ciphertext
    let res = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/bots/me/messages")
                .header(header::AUTHORIZATION, format!("Bearer {}", bot_token))
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    serde_json::to_vec(&json!({
                        "target": "owner",
                        "result_type": "toast",
                        "ciphertext": "NOT_BASE64!@#$",
                        "bot_result_pubkey": pk
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);

    // 5. Oversized ciphertext (> 64 KiB) => 413
    let oversized_ct = URL_SAFE_NO_PAD.encode(vec![0u8; 65537]);
    let res = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/bots/me/messages")
                .header(header::AUTHORIZATION, format!("Bearer {}", bot_token))
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    serde_json::to_vec(&json!({
                        "target": "owner",
                        "result_type": "toast",
                        "ciphertext": oversized_ct,
                        "bot_result_pubkey": pk
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::PAYLOAD_TOO_LARGE);

    // 6. Missing bot_result_pubkey => 400 invalid_bot_result_pubkey
    let res = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/bots/me/messages")
                .header(header::AUTHORIZATION, format!("Bearer {}", bot_token))
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    serde_json::to_vec(&json!({
                        "target": "owner",
                        "result_type": "toast",
                        "ciphertext": ct
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);

    // 7. bot_result_pubkey invalid length (31 bytes) => 400 invalid_bot_result_pubkey
    let pk_31 = URL_SAFE_NO_PAD.encode([1u8; 31]);
    let res = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/bots/me/messages")
                .header(header::AUTHORIZATION, format!("Bearer {}", bot_token))
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    serde_json::to_vec(&json!({
                        "target": "owner",
                        "result_type": "toast",
                        "ciphertext": ct,
                        "bot_result_pubkey": pk_31
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);

    // 8. User session token instead of bot token => 401
    let res = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/bots/me/messages")
                .header(header::AUTHORIZATION, format!("Bearer {}", owner_token))
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    serde_json::to_vec(&json!({
                        "target": "owner",
                        "result_type": "toast",
                        "ciphertext": ct,
                        "bot_result_pubkey": pk
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn test_bot_local_message_idempotency_and_cross_target() {
    let (app, pool, mock_server) = setup_test_app_with_sockudo_mock().await;
    let (_owner_id, owner_token) = create_user(&app, &pool, "owner_idemp").await;
    let (_bot_id_1, bot_token_1) = create_bot(&app, &owner_token, "Bot 1").await;
    let (_bot_id_2, bot_token_2) = create_bot(&app, &owner_token, "Bot 2").await;

    let ct = URL_SAFE_NO_PAD.encode(b"idempotency test");
    let pk = valid_pubkey();
    let req_id = "req_local_123";

    // 1. First request with request_id
    let res1 = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/bots/me/messages")
                .header(header::AUTHORIZATION, format!("Bearer {}", bot_token_1))
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    serde_json::to_vec(&json!({
                        "target": "owner",
                        "result_type": "panel",
                        "ciphertext": ct,
                        "bot_result_pubkey": pk,
                        "request_id": req_id
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res1.status(), StatusCode::NO_CONTENT);

    let count_events_after_first = mock_server.received_requests().await.unwrap().len();

    // 2. Second request with same request_id => returns stored 204, no second publish
    let res2 = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/bots/me/messages")
                .header(header::AUTHORIZATION, format!("Bearer {}", bot_token_1))
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    serde_json::to_vec(&json!({
                        "target": "owner",
                        "result_type": "panel",
                        "ciphertext": ct,
                        "bot_result_pubkey": pk,
                        "request_id": req_id
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res2.status(), StatusCode::NO_CONTENT);
    let count_events_after_second = mock_server.received_requests().await.unwrap().len();
    assert_eq!(count_events_after_first, count_events_after_second);

    // 3. Same request_id reused on Bot 2 does NOT conflict ((bot_id, request_id) key)
    let res3 = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/bots/me/messages")
                .header(header::AUTHORIZATION, format!("Bearer {}", bot_token_2))
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    serde_json::to_vec(&json!({
                        "target": "owner",
                        "result_type": "toast",
                        "ciphertext": ct,
                        "bot_result_pubkey": pk,
                        "request_id": req_id
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res3.status(), StatusCode::NO_CONTENT);

    // 4. Soft-deleted bot rollback verification
    let (bot_id_3, bot_token_3) = create_bot(&app, &owner_token, "Bot 3").await;
    let req_id_sd = "req_soft_delete_999";

    // Soft delete bot_id_3
    sqlx::query("UPDATE bot_accounts SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?")
        .bind(&bot_id_3)
        .execute(&pool)
        .await
        .unwrap();

    let res_sd = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/bots/me/messages")
                .header(header::AUTHORIZATION, format!("Bearer {}", bot_token_3))
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    serde_json::to_vec(&json!({
                        "target": "owner",
                        "result_type": "toast",
                        "ciphertext": ct,
                        "bot_result_pubkey": pk,
                        "request_id": req_id_sd
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    // Soft-deleted bot token fails authentication (ba.deleted_at IS NULL check in validate_bot_token)
    assert_eq!(res_sd.status(), StatusCode::UNAUTHORIZED);

    // Verify reservation was rolled back and no log row remains for req_id_sd
    let log_row: Option<(String,)> =
        sqlx::query_as("SELECT endpoint FROM bot_request_log WHERE bot_id = ? AND request_id = ?")
            .bind(&bot_id_3)
            .bind(req_id_sd)
            .fetch_optional(&pool)
            .await
            .unwrap();
    assert!(log_row.is_none());

    // Re-activate bot_id_3 and verify request succeeds
    sqlx::query("UPDATE bot_accounts SET deleted_at = NULL WHERE id = ?")
        .bind(&bot_id_3)
        .execute(&pool)
        .await
        .unwrap();

    let res_sd_retry = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/bots/me/messages")
                .header(header::AUTHORIZATION, format!("Bearer {}", bot_token_3))
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    serde_json::to_vec(&json!({
                        "target": "owner",
                        "result_type": "toast",
                        "ciphertext": ct,
                        "bot_result_pubkey": pk,
                        "request_id": req_id_sd
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res_sd_retry.status(), StatusCode::NO_CONTENT);
}

#[tokio::test]
async fn test_bot_local_message_rate_limiting() {
    let (app, pool, _mock) = setup_test_app_with_sockudo_mock().await;
    let (_owner_id, owner_token) = create_user(&app, &pool, "owner_rl").await;
    let (_bot_id_1, bot_token_1) = create_bot(&app, &owner_token, "RL Bot 1").await;
    let (_bot_id_2, bot_token_2) = create_bot(&app, &owner_token, "RL Bot 2").await;

    let ct = URL_SAFE_NO_PAD.encode(b"rate limit payload");
    let pk = valid_pubkey();

    // Exhaust 60 requests for bot 1
    for i in 0..60 {
        let req_id = format!("req_rl_{}", i);
        let res = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/bots/me/messages")
                    .header(header::AUTHORIZATION, format!("Bearer {}", bot_token_1))
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        serde_json::to_vec(&json!({
                            "target": "owner",
                            "result_type": "toast",
                            "ciphertext": ct,
                            "bot_result_pubkey": pk,
                            "request_id": req_id
                        }))
                        .unwrap(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::NO_CONTENT);
    }

    // 61st request for bot 1 returns 429
    let res61 = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/bots/me/messages")
                .header(header::AUTHORIZATION, format!("Bearer {}", bot_token_1))
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    serde_json::to_vec(&json!({
                        "target": "owner",
                        "result_type": "toast",
                        "ciphertext": ct,
                        "bot_result_pubkey": pk,
                        "request_id": "req_rl_61"
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res61.status(), StatusCode::TOO_MANY_REQUESTS);

    // Bot 2 is unblocked
    let res_b2 = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/bots/me/messages")
                .header(header::AUTHORIZATION, format!("Bearer {}", bot_token_2))
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    serde_json::to_vec(&json!({
                        "target": "owner",
                        "result_type": "toast",
                        "ciphertext": ct,
                        "bot_result_pubkey": pk
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res_b2.status(), StatusCode::NO_CONTENT);

    // Duplicate request in exhausted bucket triggers 429 because rate limit check occurs BEFORE idempotency check
    let res_dupe = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/bots/me/messages")
                .header(header::AUTHORIZATION, format!("Bearer {}", bot_token_1))
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    serde_json::to_vec(&json!({
                        "target": "owner",
                        "result_type": "toast",
                        "ciphertext": ct,
                        "bot_result_pubkey": pk,
                        "request_id": "req_rl_0"
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res_dupe.status(), StatusCode::TOO_MANY_REQUESTS);
}

#[tokio::test]
async fn test_bot_local_message_opacity_and_no_logging() {
    let (app, pool, _mock) = setup_test_app_with_sockudo_mock().await;
    let (_owner_id, owner_token) = create_user(&app, &pool, "owner_opac").await;
    let (_bot_id, bot_token) = create_bot(&app, &owner_token, "Opac Bot").await;

    // Arbitrary unparsed ciphertext bytes (e.g. non-encrypted garbage)
    let random_bytes = vec![0xDE, 0xAD, 0xBE, 0xEF, 0xCA, 0xFE, 0xBA, 0xBE];
    let ct = URL_SAFE_NO_PAD.encode(&random_bytes);
    let pk = valid_pubkey();

    let res = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/bots/me/messages")
                .header(header::AUTHORIZATION, format!("Bearer {}", bot_token))
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    serde_json::to_vec(&json!({
                        "target": "owner",
                        "result_type": "panel",
                        "ciphertext": ct,
                        "bot_result_pubkey": pk
                    }))
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(res.status(), StatusCode::NO_CONTENT);
}
