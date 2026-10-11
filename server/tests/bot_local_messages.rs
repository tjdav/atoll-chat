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

async fn create_test_room(app: &Router, user_token: &str) -> String {
    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms")
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "name": "Local Message Room",
                "moderation_mode": "messenger"
            })
            .to_string(),
        ))
        .unwrap();

    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::CREATED);
    let body: Value = serde_json::from_slice(
        &axum::body::to_bytes(res.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    body["id"].as_str().unwrap().to_string()
}

async fn create_bot_and_token(app: &Router, user_token: &str) -> (String, String) {
    let create_body = json!({
        "display_name": "Local Message Bot",
        "bot_identity_pubkey": valid_pubkey(),
        "bot_command_pubkey": valid_pubkey(),
        "identity_pubkey": valid_pubkey(),
        "declared_scopes": ["post_message", "read_commands"]
    });

    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/bots")
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(create_body.to_string()))
        .unwrap();

    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::CREATED);

    let bytes = axum::body::to_bytes(res.into_body(), usize::MAX)
        .await
        .unwrap();
    let bot_json: Value = serde_json::from_slice(&bytes).unwrap();
    let bot_id = bot_json["bot_id"].as_str().unwrap().to_string();
    let bot_token = bot_json["bot_token"].as_str().unwrap().to_string();

    (bot_id, bot_token)
}

#[tokio::test]
async fn test_owner_target_happy_path() {
    let (app, pool, mock_server) = setup_test_app_with_sockudo_mock().await;
    let (owner_token, owner_user_id) = common::create_test_user_and_session(&app, &pool).await;
    let (bot_id, bot_token) = create_bot_and_token(&app, &owner_token).await;

    let seq_before: i64 = sqlx::query_scalar("SELECT next_seq FROM user_seq WHERE user_id = ?")
        .bind(&owner_user_id)
        .fetch_optional(&pool)
        .await
        .unwrap()
        .unwrap_or(1);

    let ciphertext = URL_SAFE_NO_PAD.encode(b"owner_local_diagnostic_message");
    let bot_result_pubkey = valid_pubkey();

    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/bots/me/messages")
        .header(header::AUTHORIZATION, format!("Bearer {}", bot_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "target": "owner",
                "result_type": "local_message",
                "ciphertext": ciphertext,
                "bot_result_pubkey": bot_result_pubkey
            })
            .to_string(),
        ))
        .unwrap();

    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::NO_CONTENT);
    assert_eq!(
        res.headers().get(header::CACHE_CONTROL).unwrap(),
        "no-store"
    );

    // Verify user_seq was NOT incremented (non-durable)
    let seq_after: i64 = sqlx::query_scalar("SELECT next_seq FROM user_seq WHERE user_id = ?")
        .bind(&owner_user_id)
        .fetch_optional(&pool)
        .await
        .unwrap()
        .unwrap_or(1);
    assert_eq!(
        seq_before, seq_after,
        "bot.local_message must not allocate user_seq"
    );

    // Verify event published on private-user-{owner_user_id}
    let requests = mock_server.received_requests().await.unwrap();
    let local_msg_events: Vec<&wiremock::Request> = requests
        .iter()
        .filter(|r| {
            let body_str = String::from_utf8_lossy(&r.body);
            body_str.contains("bot.local_message")
        })
        .collect();

    assert_eq!(local_msg_events.len(), 1);
    let event_json: Value = serde_json::from_slice(&local_msg_events[0].body).unwrap();
    assert_eq!(
        event_json["channels"].as_array().unwrap()[0],
        format!("private-user-{}", owner_user_id)
    );

    let inner_data: Value = serde_json::from_str(event_json["data"].as_str().unwrap()).unwrap();
    assert_eq!(inner_data["bot_id"], bot_id);
    assert_eq!(inner_data["result_type"], "local_message");
    assert_eq!(inner_data["ciphertext"], ciphertext);
    assert_eq!(inner_data["bot_result_pubkey"], bot_result_pubkey);
}

#[tokio::test]
async fn test_owner_target_validation_matrix() {
    let (app, pool, _mock) = setup_test_app_with_sockudo_mock().await;
    let (owner_token, _owner_id) = common::create_test_user_and_session(&app, &pool).await;
    let (_bot_id, bot_token) = create_bot_and_token(&app, &owner_token).await;

    // 1. result_type = "none" -> 400 invalid_result_type
    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/bots/me/messages")
        .header(header::AUTHORIZATION, format!("Bearer {}", bot_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "target": "owner",
                "result_type": "none",
                "ciphertext": URL_SAFE_NO_PAD.encode(b"ct"),
                "bot_result_pubkey": valid_pubkey()
            })
            .to_string(),
        ))
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);

    // 2. Unrecognized result_type -> 400 invalid_result_type
    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/bots/me/messages")
        .header(header::AUTHORIZATION, format!("Bearer {}", bot_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "target": "owner",
                "result_type": "unknown_type",
                "ciphertext": URL_SAFE_NO_PAD.encode(b"ct"),
                "bot_result_pubkey": valid_pubkey()
            })
            .to_string(),
        ))
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);

    // 3. Missing ciphertext -> 400 invalid_ciphertext
    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/bots/me/messages")
        .header(header::AUTHORIZATION, format!("Bearer {}", bot_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "target": "owner",
                "result_type": "toast",
                "bot_result_pubkey": valid_pubkey()
            })
            .to_string(),
        ))
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);

    // 4. Oversized ciphertext (>64 KiB) -> 413
    let oversized = URL_SAFE_NO_PAD.encode(vec![0u8; 65537]);
    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/bots/me/messages")
        .header(header::AUTHORIZATION, format!("Bearer {}", bot_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "target": "owner",
                "result_type": "toast",
                "ciphertext": oversized,
                "bot_result_pubkey": valid_pubkey()
            })
            .to_string(),
        ))
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::PAYLOAD_TOO_LARGE);

    // 5. Invalid bot_result_pubkey (non-32B) -> 400 invalid_bot_result_pubkey
    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/bots/me/messages")
        .header(header::AUTHORIZATION, format!("Bearer {}", bot_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "target": "owner",
                "result_type": "toast",
                "ciphertext": URL_SAFE_NO_PAD.encode(b"ct"),
                "bot_result_pubkey": URL_SAFE_NO_PAD.encode([1u8; 16])
            })
            .to_string(),
        ))
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);

    // 6. User session token -> 401
    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/bots/me/messages")
        .header(header::AUTHORIZATION, format!("Bearer {}", owner_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "target": "owner",
                "result_type": "toast",
                "ciphertext": URL_SAFE_NO_PAD.encode(b"ct"),
                "bot_result_pubkey": valid_pubkey()
            })
            .to_string(),
        ))
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn test_owner_target_different_owner_channel() {
    let (app, pool, mock_server) = setup_test_app_with_sockudo_mock().await;
    let (owner1_token, owner1_user_id) = common::create_test_user_and_session(&app, &pool).await;
    let (_owner2_token, owner2_user_id) = common::create_test_user_and_session(&app, &pool).await;

    // Create Bot 1 owned by User 1
    let (bot1_id, bot1_token) = create_bot_and_token(&app, &owner1_token).await;

    // Send owner local message from Bot 1
    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/bots/me/messages")
        .header(header::AUTHORIZATION, format!("Bearer {}", bot1_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "target": "owner",
                "result_type": "toast",
                "ciphertext": URL_SAFE_NO_PAD.encode(b"diag1"),
                "bot_result_pubkey": valid_pubkey()
            })
            .to_string(),
        ))
        .unwrap();

    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::NO_CONTENT);

    // Verify event was published on private-user-{owner1_user_id}, NOT owner2
    let requests = mock_server.received_requests().await.unwrap();
    let local_msg_events: Vec<&wiremock::Request> = requests
        .iter()
        .filter(|r| {
            let body_str = String::from_utf8_lossy(&r.body);
            body_str.contains("bot.local_message")
        })
        .collect();

    assert_eq!(local_msg_events.len(), 1);
    let event_json: Value = serde_json::from_slice(&local_msg_events[0].body).unwrap();
    assert_eq!(
        event_json["channels"].as_array().unwrap()[0],
        format!("private-user-{}", owner1_user_id)
    );
    assert_ne!(
        event_json["channels"].as_array().unwrap()[0],
        format!("private-user-{}", owner2_user_id)
    );

    let inner_data: Value = serde_json::from_str(event_json["data"].as_str().unwrap()).unwrap();
    assert_eq!(inner_data["bot_id"], bot1_id);
}

#[tokio::test]
async fn test_owner_target_idempotency() {
    let (app, pool, mock_server) = setup_test_app_with_sockudo_mock().await;
    let (owner_token, owner_user_id) = common::create_test_user_and_session(&app, &pool).await;
    let (bot_id, bot_token) = create_bot_and_token(&app, &owner_token).await;

    let req_body = json!({
        "target": "owner",
        "result_type": "toast",
        "ciphertext": URL_SAFE_NO_PAD.encode(b"idemp_owner_msg"),
        "bot_result_pubkey": valid_pubkey(),
        "request_id": "req_owner_idemp_1"
    });

    // 1. First send -> 204
    let req1 = Request::builder()
        .method("POST")
        .uri("/api/v1/bots/me/messages")
        .header(header::AUTHORIZATION, format!("Bearer {}", bot_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(req_body.to_string()))
        .unwrap();
    let res1 = app.clone().oneshot(req1).await.unwrap();
    assert_eq!(res1.status(), StatusCode::NO_CONTENT);

    // 2. Re-send with same request_id -> 204 with idempotent marker payload
    let req2 = Request::builder()
        .method("POST")
        .uri("/api/v1/bots/me/messages")
        .header(header::AUTHORIZATION, format!("Bearer {}", bot_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(req_body.to_string()))
        .unwrap();
    let res2 = app.clone().oneshot(req2).await.unwrap();
    assert_eq!(res2.status(), StatusCode::NO_CONTENT);

    let bytes = axum::body::to_bytes(res2.into_body(), usize::MAX)
        .await
        .unwrap();
    let body_json: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(body_json["idempotent"], true);

    // Assert only ONE event was published
    let requests = mock_server.received_requests().await.unwrap();
    let local_msg_events: Vec<&wiremock::Request> = requests
        .iter()
        .filter(|r| {
            let body_str = String::from_utf8_lossy(&r.body);
            body_str.contains("bot.local_message")
        })
        .collect();
    assert_eq!(
        local_msg_events.len(),
        1,
        "Replay must not trigger duplicate event"
    );

    // 3. Same request_id across distinct endpoint (invoker target uses ENDPOINT_BOT_COMMAND_RESULT vs ENDPOINT_BOT_LOCAL_MESSAGE)
    // Create a command to test invoker target with same request_id
    let room_id = create_test_room(&app, &owner_token).await;

    // Grant bot to room
    let grant_body = json!({
        "bot_id": bot_id,
        "scopes": ["post_message", "read_commands"]
    });
    let grant_req = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/bots", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", owner_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(grant_body.to_string()))
        .unwrap();
    let _ = app.clone().oneshot(grant_req).await.unwrap();

    let post_req = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/bot-commands", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", owner_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "bot_id": bot_id,
                "ciphertext": URL_SAFE_NO_PAD.encode(b"cmd"),
                "ephemeral_result_pubkey": valid_pubkey()
            })
            .to_string(),
        ))
        .unwrap();
    let res = app.clone().oneshot(post_req).await.unwrap();
    let bytes = axum::body::to_bytes(res.into_body(), usize::MAX)
        .await
        .unwrap();
    let post_json: Value = serde_json::from_slice(&bytes).unwrap();
    let command_id = post_json["command_id"].as_str().unwrap();

    let ack_req = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/bots/me/commands/{}/ack", command_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", bot_token))
        .body(Body::empty())
        .unwrap();
    let _ = app.clone().oneshot(ack_req).await.unwrap();

    // Invoker target using the same request_id "req_owner_idemp_1" returns 409 conflict due to distinct endpoint
    let req_invoker = Request::builder()
        .method("POST")
        .uri("/api/v1/bots/me/messages")
        .header(header::AUTHORIZATION, format!("Bearer {}", bot_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "target": "invoker",
                "target_user_id": owner_user_id,
                "command_id": command_id,
                "result_type": "toast",
                "ciphertext": URL_SAFE_NO_PAD.encode(b"invoker_ct"),
                "bot_result_pubkey": valid_pubkey(),
                "request_id": "req_owner_idemp_1"
            })
            .to_string(),
        ))
        .unwrap();
    let res_invoker = app.clone().oneshot(req_invoker).await.unwrap();
    assert_eq!(
        res_invoker.status(),
        StatusCode::CONFLICT,
        "Cross-endpoint request_id reuse must return 409 conflict"
    );
}

#[tokio::test]
async fn test_owner_target_deleted_bot() {
    let (app, pool, _mock) = setup_test_app_with_sockudo_mock().await;
    let (owner_token, _owner_id) = common::create_test_user_and_session(&app, &pool).await;
    let (bot_id, bot_token) = create_bot_and_token(&app, &owner_token).await;

    // Delete bot
    let del_req = Request::builder()
        .method("DELETE")
        .uri(format!("/api/v1/bots/{}", bot_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", owner_token))
        .body(Body::empty())
        .unwrap();
    let del_res = app.clone().oneshot(del_req).await.unwrap();
    assert_eq!(del_res.status(), StatusCode::NO_CONTENT);

    // Attempt owner target message with soft-deleted bot (token is revoked upon bot deletion) -> 401 Unauthorized
    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/bots/me/messages")
        .header(header::AUTHORIZATION, format!("Bearer {}", bot_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "target": "owner",
                "result_type": "toast",
                "ciphertext": URL_SAFE_NO_PAD.encode(b"ct"),
                "bot_result_pubkey": valid_pubkey(),
                "request_id": "req_del_bot_1"
            })
            .to_string(),
        ))
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);

    // Assert request_id was rolled back and not recorded permanently
    let log_row: Option<i64> =
        sqlx::query_scalar("SELECT response_code FROM bot_request_log WHERE request_id = ?")
            .bind("req_del_bot_1")
            .fetch_optional(&pool)
            .await
            .unwrap();
    assert!(
        log_row.is_none(),
        "Transaction rollback on 404 must not leave reserved request_id"
    );
}

#[tokio::test]
async fn test_owner_target_rate_limit() {
    let (app, pool, _mock) = setup_test_app_with_sockudo_mock().await;
    let (owner_token, _owner_id) = common::create_test_user_and_session(&app, &pool).await;
    let (_bot_id, bot_token) = create_bot_and_token(&app, &owner_token).await;

    // Send 60 requests (the limit)
    for i in 0..60 {
        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/bots/me/messages")
            .header(header::AUTHORIZATION, format!("Bearer {}", bot_token))
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(
                json!({
                    "target": "owner",
                    "result_type": "toast",
                    "ciphertext": URL_SAFE_NO_PAD.encode(b"ct"),
                    "bot_result_pubkey": valid_pubkey(),
                    "request_id": format!("req_rate_{}", i)
                })
                .to_string(),
            ))
            .unwrap();
        let res = app.clone().oneshot(req).await.unwrap();
        assert_eq!(res.status(), StatusCode::NO_CONTENT);
    }

    // 61st request in the same minute -> 429 Too Many Requests
    let req61 = Request::builder()
        .method("POST")
        .uri("/api/v1/bots/me/messages")
        .header(header::AUTHORIZATION, format!("Bearer {}", bot_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "target": "owner",
                "result_type": "toast",
                "ciphertext": URL_SAFE_NO_PAD.encode(b"ct"),
                "bot_result_pubkey": valid_pubkey(),
                "request_id": "req_rate_61"
            })
            .to_string(),
        ))
        .unwrap();
    let res61 = app.clone().oneshot(req61).await.unwrap();
    assert_eq!(res61.status(), StatusCode::TOO_MANY_REQUESTS);
}

#[tokio::test]
async fn test_owner_target_opacity() {
    let (app, pool, _mock) = setup_test_app_with_sockudo_mock().await;
    let (owner_token, _owner_id) = common::create_test_user_and_session(&app, &pool).await;
    let (_bot_id, bot_token) = create_bot_and_token(&app, &owner_token).await;

    // Send arbitrary non-JSON garbage bytes as ciphertext and arbitrary 32-byte pubkey -> server accepts opaquely
    let junk_ct = URL_SAFE_NO_PAD.encode(b"RAW_OPAQUE_BINARY_DIAGNOSTIC_CIPHERTEXT_12345");
    let junk_pk = URL_SAFE_NO_PAD.encode([123u8; 32]);

    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/bots/me/messages")
        .header(header::AUTHORIZATION, format!("Bearer {}", bot_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "target": "owner",
                "result_type": "panel",
                "ciphertext": junk_ct,
                "bot_result_pubkey": junk_pk
            })
            .to_string(),
        ))
        .unwrap();

    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::NO_CONTENT);
}
