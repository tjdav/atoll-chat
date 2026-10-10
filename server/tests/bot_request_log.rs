use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use axum::Router;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use ed25519_dalek::{Signer, SigningKey};
use serde_json::{json, Value};
use sqlx::SqlitePool;
use std::path::Path;
use std::sync::Arc;
use tower::ServiceExt;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

mod common;

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

async fn create_user_token_and_room(app: &Router, pool: &SqlitePool) -> (String, String) {
    let (token, _user_id) = common::create_test_user_and_session(app, pool).await;

    let create_room_req = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({"name": "Test Room"}).to_string()))
        .unwrap();

    let response = app.clone().oneshot(create_room_req).await.unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);
    let body_bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    let body: Value = serde_json::from_slice(&body_bytes).unwrap();
    let room_id = body["id"].as_str().unwrap().to_string();

    (token, room_id)
}

fn valid_pubkey(seed_byte: u8) -> String {
    URL_SAFE_NO_PAD.encode([seed_byte; 32])
}

async fn create_bot_with_key_and_grant(
    app: &Router,
    owner_token: &str,
    room_id: &str,
    scopes: &[&str],
    seed_byte: u8,
) -> (String, String, SigningKey) {
    let signing_key = SigningKey::from_bytes(&[seed_byte; 32]);
    let verifying_key = signing_key.verifying_key();
    let bot_identity_pubkey = URL_SAFE_NO_PAD.encode(verifying_key.as_bytes());

    let create_req = Request::builder()
        .method("POST")
        .uri("/api/v1/bots")
        .header(header::AUTHORIZATION, format!("Bearer {}", owner_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "display_name": "Test Bot",
                "declared_scopes": scopes,
                "bot_identity_pubkey": bot_identity_pubkey,
                "bot_command_pubkey": valid_pubkey(seed_byte),
                "identity_pubkey": valid_pubkey(seed_byte),
            })
            .to_string(),
        ))
        .unwrap();

    let response = app.clone().oneshot(create_req).await.unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);
    let body: Value = serde_json::from_slice(
        &axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    let bot_id = body["bot_id"].as_str().unwrap().to_string();
    let bot_token = body["bot_token"].as_str().unwrap().to_string();

    // Grant bot to room
    let grant_req = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/bots", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", owner_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "bot_id": bot_id,
                "scopes": scopes,
            })
            .to_string(),
        ))
        .unwrap();

    let response = app.clone().oneshot(grant_req).await.unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);

    (bot_id, bot_token, signing_key)
}

#[tokio::test]
async fn test_bot_request_log_schema_and_pk_constraint() {
    let (_app, pool, _mock) = setup_test_app_with_sockudo_mock().await;

    let table_exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'bot_request_log')",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(table_exists);

    let index_exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_bot_request_log_ttl')",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(index_exists);

    sqlx::query(
        "INSERT INTO users (id, username_token, opaque_registration, identity_pubkey) VALUES ('u_owner', 'tok_owner', X'1234', 'pk_user')"
    )
    .execute(&pool)
    .await
    .unwrap();

    sqlx::query(
        "INSERT INTO bot_accounts (id, display_name, owner_user_id, bot_identity_pubkey, bot_command_pubkey, identity_pubkey) VALUES ('b_test_pk', 'PK Test', 'u_owner', 'pk1', 'pk2', 'pk3')"
    )
    .execute(&pool)
    .await
    .unwrap();

    sqlx::query(
        "INSERT INTO bot_request_log (bot_id, request_id, endpoint, response_code) VALUES ('b_test_pk', 'req_1', 'bot-messages', 202)",
    )
    .execute(&pool)
    .await
    .unwrap();

    let err = sqlx::query(
        "INSERT INTO bot_request_log (bot_id, request_id, endpoint, response_code) VALUES ('b_test_pk', 'req_1', 'bot-messages', 202)",
    )
    .execute(&pool)
    .await;

    assert!(err.is_err());
}

#[tokio::test]
async fn test_bot_message_idempotency_flow() {
    let (app, pool, _mock) = setup_test_app_with_sockudo_mock().await;
    let (user_token, room_id) = create_user_token_and_room(&app, &pool).await;

    let (bot_id, bot_token, signing_key) = create_bot_with_key_and_grant(
        &app,
        &user_token,
        &room_id,
        &["post_message", "read_content"],
        1,
    )
    .await;

    let raw_ciphertext = b"encrypted_bot_payload";
    let ciphertext_b64 = URL_SAFE_NO_PAD.encode(raw_ciphertext);

    let signing_input =
        server::signing::encode_bot_message_signing_input(&room_id, 0, "bot", raw_ciphertext);
    let signature = signing_key.sign(&signing_input);
    let signature_b64 = URL_SAFE_NO_PAD.encode(signature.to_bytes());

    // 1. Post bot message without request_id -> succeeds, no request_log row
    let req_no_id = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/bot-messages", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", bot_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "epoch": 0,
                "ciphertext": ciphertext_b64,
                "content_type": "bot",
                "signature": signature_b64,
            })
            .to_string(),
        ))
        .unwrap();

    let res = app.clone().oneshot(req_no_id).await.unwrap();
    assert_eq!(res.status(), StatusCode::ACCEPTED);

    let log_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM bot_request_log")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(log_count, 0);

    // 2. Post bot message with fresh request_id -> succeeds, writes request_log row
    let req_id_1 = "req_msg_001";
    let req_with_id = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/bot-messages", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", bot_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "epoch": 0,
                "ciphertext": ciphertext_b64,
                "content_type": "bot",
                "signature": signature_b64,
                "request_id": req_id_1,
            })
            .to_string(),
        ))
        .unwrap();

    let res = app.clone().oneshot(req_with_id).await.unwrap();
    assert_eq!(res.status(), StatusCode::ACCEPTED);

    let code: i64 = sqlx::query_scalar(
        "SELECT response_code FROM bot_request_log WHERE bot_id = ? AND request_id = ?",
    )
    .bind(&bot_id)
    .bind(req_id_1)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(code, 202);

    let msg_count_1: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM room_messages WHERE room_id = ?")
            .bind(&room_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(msg_count_1, 2);

    // 3. Repeat request with same request_id -> returns 202 Accepted with idempotent marker
    let req_repeat = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/bot-messages", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", bot_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "epoch": 0,
                "ciphertext": ciphertext_b64,
                "content_type": "bot",
                "signature": signature_b64,
                "request_id": req_id_1,
            })
            .to_string(),
        ))
        .unwrap();

    let res = app.clone().oneshot(req_repeat).await.unwrap();
    assert_eq!(res.status(), StatusCode::ACCEPTED);
    let body: Value = serde_json::from_slice(
        &axum::body::to_bytes(res.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(body["idempotent"], true);

    let msg_count_2: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM room_messages WHERE room_id = ?")
            .bind(&room_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(msg_count_2, 2);
}

#[tokio::test]
async fn test_bot_command_idempotency_flow() {
    let (app, pool, _mock) = setup_test_app_with_sockudo_mock().await;
    let (user_token, room_id) = create_user_token_and_room(&app, &pool).await;

    let (bot_id, _bot_token, _key) = create_bot_with_key_and_grant(
        &app,
        &user_token,
        &room_id,
        &["post_message", "read_commands"],
        2,
    )
    .await;

    let ciphertext_b64 = URL_SAFE_NO_PAD.encode(b"bot_command_payload");

    // 0. Post command without request_id -> succeeds, writes no request_log row
    let req_cmd_no_id = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/bot-commands", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "bot_id": bot_id,
                "ciphertext": ciphertext_b64,
            })
            .to_string(),
        ))
        .unwrap();

    let res = app.clone().oneshot(req_cmd_no_id).await.unwrap();
    assert_eq!(res.status(), StatusCode::ACCEPTED);

    let log_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM bot_request_log WHERE bot_id = ?")
            .bind(&bot_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(log_count, 0);

    let req_id_1 = "cmd_req_001";

    // 1. Post command with fresh request_id
    let req_cmd = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/bot-commands", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "bot_id": bot_id,
                "ciphertext": ciphertext_b64,
                "request_id": req_id_1,
            })
            .to_string(),
        ))
        .unwrap();

    let res = app.clone().oneshot(req_cmd).await.unwrap();
    assert_eq!(res.status(), StatusCode::ACCEPTED);

    let cmd_count_1: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM bot_commands WHERE bot_id = ?")
        .bind(&bot_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(cmd_count_1, 2);

    // 2. Repeat command with same request_id -> returns 202 Accepted with idempotent marker
    let req_cmd_repeat = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/bot-commands", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "bot_id": bot_id,
                "ciphertext": ciphertext_b64,
                "request_id": req_id_1,
            })
            .to_string(),
        ))
        .unwrap();

    let res = app.clone().oneshot(req_cmd_repeat).await.unwrap();
    assert_eq!(res.status(), StatusCode::ACCEPTED);
    let body: Value = serde_json::from_slice(
        &axum::body::to_bytes(res.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(body["idempotent"], true);

    let cmd_count_2: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM bot_commands WHERE bot_id = ?")
        .bind(&bot_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(cmd_count_2, 2);
}

#[tokio::test]
async fn test_cross_endpoint_request_id_conflict() {
    let (app, pool, _mock) = setup_test_app_with_sockudo_mock().await;
    let (user_token, room_id) = create_user_token_and_room(&app, &pool).await;

    let (bot_id, bot_token, signing_key) = create_bot_with_key_and_grant(
        &app,
        &user_token,
        &room_id,
        &["post_message", "read_commands"],
        3,
    )
    .await;

    let raw_ciphertext = b"payload_bytes";
    let ciphertext_b64 = URL_SAFE_NO_PAD.encode(raw_ciphertext);
    let signing_input =
        server::signing::encode_bot_message_signing_input(&room_id, 0, "bot", raw_ciphertext);
    let signature_b64 = URL_SAFE_NO_PAD.encode(signing_key.sign(&signing_input).to_bytes());

    let shared_req_id = "shared_req_xyz";

    // First use on bot-messages
    let req_msg = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/bot-messages", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", bot_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "epoch": 0,
                "ciphertext": ciphertext_b64,
                "content_type": "bot",
                "signature": signature_b64,
                "request_id": shared_req_id,
            })
            .to_string(),
        ))
        .unwrap();

    let res = app.clone().oneshot(req_msg).await.unwrap();
    assert_eq!(res.status(), StatusCode::ACCEPTED);

    // Re-use same request_id on bot-commands -> 409 request_id_conflict
    let req_cmd = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/bot-commands", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "bot_id": bot_id,
                "ciphertext": ciphertext_b64,
                "request_id": shared_req_id,
            })
            .to_string(),
        ))
        .unwrap();

    let res = app.clone().oneshot(req_cmd).await.unwrap();
    assert_eq!(res.status(), StatusCode::CONFLICT);
    let body: Value = serde_json::from_slice(
        &axum::body::to_bytes(res.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(body["error"], "request_id_conflict");
}

#[tokio::test]
async fn test_invalid_request_id_format() {
    let (app, pool, _mock) = setup_test_app_with_sockudo_mock().await;
    let (user_token, room_id) = create_user_token_and_room(&app, &pool).await;

    let (bot_id, _bot_token, _key) = create_bot_with_key_and_grant(
        &app,
        &user_token,
        &room_id,
        &["post_message", "read_commands"],
        4,
    )
    .await;

    let ciphertext_b64 = URL_SAFE_NO_PAD.encode(b"payload");

    // Empty or space request_id on bot-commands
    let req_empty = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/bot-commands", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "bot_id": bot_id,
                "ciphertext": ciphertext_b64,
                "request_id": "   ",
            })
            .to_string(),
        ))
        .unwrap();

    let res = app.clone().oneshot(req_empty).await.unwrap();
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);
    let body: Value = serde_json::from_slice(
        &axum::body::to_bytes(res.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(body["error"], "invalid_request_id");

    // Overly long request_id (>128 chars)
    let long_req_id = "a".repeat(129);
    let req_long = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/bot-commands", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "bot_id": bot_id,
                "ciphertext": ciphertext_b64,
                "request_id": long_req_id,
            })
            .to_string(),
        ))
        .unwrap();

    let res = app.clone().oneshot(req_long).await.unwrap();
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn test_bot_request_log_ttl_cleanup_job() {
    let (app, pool, _mock) = setup_test_app_with_sockudo_mock().await;
    let (user_token, _room_id) = common::create_test_user_and_session(&app, &pool).await;

    // Create bot using endpoint to ensure valid FK
    let create_body = json!({
        "display_name": "TTL Bot",
        "bot_identity_pubkey": valid_pubkey(5),
        "bot_command_pubkey": valid_pubkey(5),
        "identity_pubkey": valid_pubkey(5),
        "declared_scopes": ["post_message"]
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
    let body: Value = serde_json::from_slice(
        &axum::body::to_bytes(res.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    let bot_id = body["bot_id"].as_str().unwrap();

    // Insert 2 rows: one 25 hours old, one 2 hours old
    sqlx::query(
        r#"
        INSERT INTO bot_request_log (bot_id, request_id, endpoint, response_code, created_at)
        VALUES (?, 'req_old', 'bot-messages', 202, datetime('now', '-25 hours'))
        "#,
    )
    .bind(bot_id)
    .execute(&pool)
    .await
    .unwrap();

    sqlx::query(
        r#"
        INSERT INTO bot_request_log (bot_id, request_id, endpoint, response_code, created_at)
        VALUES (?, 'req_recent', 'bot-messages', 202, datetime('now', '-2 hours'))
        "#,
    )
    .bind(bot_id)
    .execute(&pool)
    .await
    .unwrap();

    let config = server::Config::test_default();
    let registration_store = Arc::new(server::RegistrationStore::new());
    let login_store = Arc::new(server::LoginStore::new());
    let recovery_store = Arc::new(server::RecoveryStore::new());
    let storage = server::build_storage(&config).expect("Failed to build storage");
    let server_max = Arc::new(server::ServerHardMax {
        file_size_bytes: 1024,
        room_size: 100,
        rooms_per_user: 10,
        devices_per_user: 5,
        keypackages_per_device: 10,
        message_size_bytes: 65536,
        attachment_retention_days: 365,
        call_max_participants: 50,
        reactions_per_message: 50,
        room_metadata_bytes: config.server_max_room_metadata_bytes,
        edit_window_seconds: config.server_max_edit_window_seconds,
    });

    let mock_server = MockServer::start().await;
    let sockudo_cfg = server::SockudoConfig {
        http_base: mock_server.uri(),
        app_id: "chat".to_string(),
        app_key: "k".to_string(),
        app_secret: "s".to_string(),
        enable_client_events: true,
    };
    let publisher = Arc::new(server::Publisher::new(sockudo_cfg));

    let ctx = server::cleanup::CleanupContextOwned {
        pool: pool.clone(),
        config: Arc::new(config),
        registration_store,
        login_store,
        recovery_store,
        storage,
        server_max,
        publisher,
    };

    let job = server::cleanup::bot_request_log::BotRequestLogTtlJob;
    use server::cleanup::CleanupJob;
    let report = job.run(&ctx.as_ctx()).await.unwrap();

    assert_eq!(report.rows_deleted, 1);

    let remaining: Vec<String> =
        sqlx::query_scalar("SELECT request_id FROM bot_request_log WHERE bot_id = ?")
            .bind(bot_id)
            .fetch_all(&pool)
            .await
            .unwrap();

    assert_eq!(remaining, vec!["req_recent"]);

    // Idempotency check on running job again
    let report2 = job.run(&ctx.as_ctx()).await.unwrap();
    assert_eq!(report2.rows_deleted, 0);
}
