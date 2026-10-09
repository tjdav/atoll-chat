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

async fn create_test_room(app: &Router, user_token: &str, moderation_mode: &str) -> String {
    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms")
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "name": "Command Room",
                "moderation_mode": moderation_mode
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

async fn create_user_and_app() -> (
    SqlitePool,
    Router,
    String,
    String,
    String,
    String,
    MockServer,
) {
    let (app, pool, mock_server) = setup_test_app_with_sockudo_mock().await;

    // Create user 1 (owner/member)
    let (token1, user1_id) = common::create_test_user_and_session(&app, &pool).await;
    // Create user 2 (non-member)
    let (token2, _user2_id) = common::create_test_user_and_session(&app, &pool).await;

    // Create room owned by user 1
    let room_id = create_test_room(&app, &token1, "messenger").await;

    (pool, app, user1_id, token1, token2, room_id, mock_server)
}

async fn create_bot_and_token(
    app: &Router,
    user_token: &str,
    room_id: &str,
    scopes: &[&str],
) -> (String, String) {
    let create_body = json!({
        "display_name": "Command Bot",
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

    // Grant bot to room
    let grant_body = json!({
        "bot_id": bot_id,
        "scopes": scopes
    });

    let grant_req = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/bots", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(grant_body.to_string()))
        .unwrap();

    let grant_res = app.clone().oneshot(grant_req).await.unwrap();
    assert_eq!(grant_res.status(), StatusCode::CREATED);

    (bot_id, bot_token)
}

#[tokio::test]
async fn test_bot_commands_schema_and_indexes() {
    let pool = common::setup_test_db().await;

    // 1. Verify bot_commands table existence
    let table_exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'bot_commands')",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(table_exists, "bot_commands table must exist");

    // 2. Verify idx_bot_commands_pending index existence
    let index_exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_bot_commands_pending')",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(index_exists, "idx_bot_commands_pending index must exist");
}

#[tokio::test]
async fn test_post_bot_command_happy_path() {
    let (pool, app, user1_id, token1, _token2, room_id, mock_server) = create_user_and_app().await;
    let (bot_id, _bot_token) =
        create_bot_and_token(&app, &token1, &room_id, &["post_message", "read_commands"]).await;

    let payload = json!({
        "bot_id": bot_id,
        "ciphertext": URL_SAFE_NO_PAD.encode(b"command_payload_raw_bytes"),
        "request_id": "req_corr_123"
    });

    let req = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/bot-commands", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token1))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(payload.to_string()))
        .unwrap();

    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::ACCEPTED);
    assert_eq!(
        res.headers().get(header::CACHE_CONTROL).unwrap(),
        "no-store"
    );

    let bytes = axum::body::to_bytes(res.into_body(), usize::MAX)
        .await
        .unwrap();
    let body_json: Value = serde_json::from_slice(&bytes).unwrap();

    let command_id = body_json["command_id"].as_str().unwrap();
    assert!(command_id.starts_with("cmd_"));
    assert_eq!(body_json["request_id"], "req_corr_123");
    assert!(body_json["created_at"].is_string());

    // Verify row in DB
    let row: (String, String, String, Vec<u8>, Option<String>, Option<String>) = sqlx::query_as(
        r#"
        SELECT bot_id, room_id, sender_user_id, ciphertext, CAST(delivered_at AS TEXT), CAST(acked_at AS TEXT)
        FROM bot_commands WHERE id = ?
        "#,
    )
    .bind(command_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(row.0, bot_id);
    assert_eq!(row.1, room_id);
    assert_eq!(row.2, user1_id);
    assert_eq!(row.3, b"command_payload_raw_bytes");
    assert!(row.4.is_some(), "delivered_at must be set after publish");
    assert!(row.5.is_none(), "acked_at must initially be null");

    // Verify event payload received by mock server
    let requests = mock_server.received_requests().await.unwrap();
    let command_events: Vec<&wiremock::Request> = requests
        .iter()
        .filter(|r| {
            let body_str = String::from_utf8_lossy(&r.body);
            body_str.contains("bot.command_invoked")
        })
        .collect();

    assert_eq!(
        command_events.len(),
        1,
        "Exactly one bot.command_invoked event should be published"
    );
    let event_json: Value = serde_json::from_slice(&command_events[0].body).unwrap();
    let inner_data: Value = serde_json::from_str(event_json["data"].as_str().unwrap()).unwrap();

    assert_eq!(inner_data["command_id"], command_id);
    assert_eq!(inner_data["room_id"], room_id);
    assert_eq!(inner_data["sender_user_id"], user1_id);
    assert_eq!(
        inner_data["ciphertext"],
        URL_SAFE_NO_PAD.encode(b"command_payload_raw_bytes")
    );
    assert!(
        inner_data.get("command_name").is_none(),
        "command_name MUST NOT be in event payload"
    );
}

#[tokio::test]
async fn test_post_bot_command_validation_and_scopes() {
    let (pool, app, user1_id, token1, token2, room_id, _mock) = create_user_and_app().await;

    // Create Bot 1 WITH read_commands scope
    let (bot1_id, bot1_token) =
        create_bot_and_token(&app, &token1, &room_id, &["post_message", "read_commands"]).await;

    // Create Bot 2 WITHOUT read_commands scope
    let (bot2_id, _bot2_token) =
        create_bot_and_token(&app, &token1, &room_id, &["post_message"]).await;

    let valid_ciphertext = URL_SAFE_NO_PAD.encode(b"cmd");

    // 1. Bot without read_commands scope returns 403 bot_not_granted
    let req = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/bot-commands", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token1))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "bot_id": bot2_id,
                "ciphertext": valid_ciphertext,
                "request_id": "req_1"
            })
            .to_string(),
        ))
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::FORBIDDEN);

    // 2. Non-member (user2) attempting to submit command returns 404 room_not_found
    let req = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/bot-commands", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token2))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "bot_id": bot1_id,
                "ciphertext": valid_ciphertext,
                "request_id": "req_1"
            })
            .to_string(),
        ))
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::NOT_FOUND);

    // 3. Bot token attempting to submit command returns 403 forbidden
    let req = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/bot-commands", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", bot1_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "bot_id": bot1_id,
                "ciphertext": valid_ciphertext,
                "request_id": "req_1"
            })
            .to_string(),
        ))
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::FORBIDDEN);

    // 4. Invalid base64url ciphertext returns 400 invalid_ciphertext
    let req = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/bot-commands", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token1))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "bot_id": bot1_id,
                "ciphertext": "NOT_BASE64_!!!",
                "request_id": "req_1"
            })
            .to_string(),
        ))
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);

    // 5. Empty ciphertext returns 400 invalid_ciphertext
    let req = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/bot-commands", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token1))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "bot_id": bot1_id,
                "ciphertext": "",
                "request_id": "req_1"
            })
            .to_string(),
        ))
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);

    // 6. Oversized ciphertext (>64 KiB) returns 413
    let oversized = URL_SAFE_NO_PAD.encode(vec![0u8; 65537]);
    let req = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/bot-commands", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token1))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "bot_id": bot1_id,
                "ciphertext": oversized,
                "request_id": "req_1"
            })
            .to_string(),
        ))
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::PAYLOAD_TOO_LARGE);

    // 7. Invalid request_id (empty) returns 400
    let req = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/bot-commands", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token1))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "bot_id": bot1_id,
                "ciphertext": valid_ciphertext,
                "request_id": ""
            })
            .to_string(),
        ))
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);

    let _ = user1_id;
    let _ = pool;
}

#[tokio::test]
async fn test_ack_bot_command() {
    let (pool, app, _user1_id, token1, _token2, room_id, _mock) = create_user_and_app().await;

    let (bot1_id, bot1_token) =
        create_bot_and_token(&app, &token1, &room_id, &["post_message", "read_commands"]).await;
    let (_bot2_id, bot2_token) =
        create_bot_and_token(&app, &token1, &room_id, &["post_message", "read_commands"]).await;

    // Submit command to Bot 1
    let post_req = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/bot-commands", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token1))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "bot_id": bot1_id,
                "ciphertext": URL_SAFE_NO_PAD.encode(b"cmd_bytes"),
                "request_id": "req_1"
            })
            .to_string(),
        ))
        .unwrap();

    let post_res = app.clone().oneshot(post_req).await.unwrap();
    assert_eq!(post_res.status(), StatusCode::ACCEPTED);
    let bytes = axum::body::to_bytes(post_res.into_body(), usize::MAX)
        .await
        .unwrap();
    let post_json: Value = serde_json::from_slice(&bytes).unwrap();
    let command_id = post_json["command_id"].as_str().unwrap();

    // 1. User session token attempting to ack returns 403
    let req = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/bots/me/commands/{}/ack", command_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token1))
        .body(Body::empty())
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::FORBIDDEN);

    // 2. Bot 2 attempting to ack Bot 1's command returns 403 forbidden
    let req = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/bots/me/commands/{}/ack", command_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", bot2_token))
        .body(Body::empty())
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::FORBIDDEN);

    // 3. Non-existent command ID returns 404
    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/bots/me/commands/cmd_nonexistent/ack")
        .header(header::AUTHORIZATION, format!("Bearer {}", bot1_token))
        .body(Body::empty())
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::NOT_FOUND);

    // 4. Bot 1 acks its command successfully -> 204 No Content
    let req = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/bots/me/commands/{}/ack", command_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", bot1_token))
        .body(Body::empty())
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::NO_CONTENT);
    assert_eq!(
        res.headers().get(header::CACHE_CONTROL).unwrap(),
        "no-store"
    );

    let acked_at1: Option<String> =
        sqlx::query_scalar("SELECT CAST(acked_at AS TEXT) FROM bot_commands WHERE id = ?")
            .bind(command_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(acked_at1.is_some(), "acked_at must be populated after ack");

    // 5. Bot 1 re-acks idempotently -> 204 No Content without error
    let req = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/bots/me/commands/{}/ack", command_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", bot1_token))
        .body(Body::empty())
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::NO_CONTENT);

    let acked_at2: Option<String> =
        sqlx::query_scalar("SELECT CAST(acked_at AS TEXT) FROM bot_commands WHERE id = ?")
            .bind(command_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(
        acked_at1, acked_at2,
        "acked_at timestamp must not change on re-ack"
    );
}

#[tokio::test]
async fn test_bot_command_ttl_cleanup_job() {
    let pool = common::setup_test_db().await;

    // Create user and room and bot directly in DB
    sqlx::query(
        "INSERT INTO users (id, username_token, opaque_registration, identity_pubkey) VALUES ('u_ttl', 'tok_ttl', X'1234', 'pk')",
    )
    .execute(&pool)
    .await
    .unwrap();

    sqlx::query("INSERT INTO rooms (id, owner_id) VALUES ('r_ttl', 'u_ttl')")
        .execute(&pool)
        .await
        .unwrap();

    sqlx::query(
        r#"
        INSERT INTO bot_accounts (id, display_name, bot_identity_pubkey, bot_command_pubkey, identity_pubkey, owner_user_id)
        VALUES ('b_ttl', 'TTL Bot', 'pk1', 'pk2', 'pk3', 'u_ttl')
        "#,
    )
    .execute(&pool)
    .await
    .unwrap();

    // 1. Insert command older than 24h, NOT acked
    sqlx::query(
        r#"
        INSERT INTO bot_commands (id, bot_id, room_id, sender_user_id, sender_client_id, ciphertext, created_at)
        VALUES ('cmd_old_unacked', 'b_ttl', 'r_ttl', 'u_ttl', 'c_1', X'1234', datetime('now', '-25 hours'))
        "#,
    )
    .execute(&pool)
    .await
    .unwrap();

    // 2. Insert command older than 24h, ACKED
    sqlx::query(
        r#"
        INSERT INTO bot_commands (id, bot_id, room_id, sender_user_id, sender_client_id, ciphertext, created_at, acked_at)
        VALUES ('cmd_old_acked', 'b_ttl', 'r_ttl', 'u_ttl', 'c_1', X'1234', datetime('now', '-25 hours'), datetime('now', '-24 hours'))
        "#,
    )
    .execute(&pool)
    .await
    .unwrap();

    // 3. Insert command recent (<24h), NOT acked
    sqlx::query(
        r#"
        INSERT INTO bot_commands (id, bot_id, room_id, sender_user_id, sender_client_id, ciphertext, created_at)
        VALUES ('cmd_recent_unacked', 'b_ttl', 'r_ttl', 'u_ttl', 'c_1', X'1234', datetime('now', '-1 hour'))
        "#,
    )
    .execute(&pool)
    .await
    .unwrap();

    let config = server::Config::test_default();
    let reg_store = std::sync::Arc::new(server::RegistrationStore::new());
    let login_store = std::sync::Arc::new(server::LoginStore::new());
    let rec_store = std::sync::Arc::new(server::RecoveryStore::new());
    let storage = server::build_storage(&config).unwrap();
    let hard_max = std::sync::Arc::new(server::ServerHardMax::default());

    let sockudo_cfg = server::SockudoConfig {
        http_base: "http://localhost:6001".to_string(),
        app_id: "chat".to_string(),
        app_key: "test-key".to_string(),
        app_secret: "test-secret".to_string(),
        enable_client_events: true,
    };
    let publisher = std::sync::Arc::new(server::Publisher::new(sockudo_cfg));

    let ctx = server::cleanup::CleanupContext {
        pool: &pool,
        config: &config,
        registration_store: &reg_store,
        login_store: &login_store,
        recovery_store: &rec_store,
        storage: &storage,
        server_max: &hard_max,
        publisher: &publisher,
    };

    use server::cleanup::CleanupJob;
    let job = server::cleanup::bot_commands::BotCommandsTtlJob;
    let report = job.run(&ctx).await.unwrap();

    assert_eq!(report.rows_deleted, 1, "Exactly 1 row should be expired");

    // Verify cmd_old_unacked is marked expired
    let expired: Option<String> = sqlx::query_scalar(
        "SELECT CAST(expired_at AS TEXT) FROM bot_commands WHERE id = 'cmd_old_unacked'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(expired.is_some(), "cmd_old_unacked must be expired");

    // Verify cmd_old_acked is NOT marked expired
    let acked_expired: Option<String> = sqlx::query_scalar(
        "SELECT CAST(expired_at AS TEXT) FROM bot_commands WHERE id = 'cmd_old_acked'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(acked_expired.is_none(), "Acked command must not be expired");

    // Verify cmd_recent_unacked is NOT marked expired
    let recent_expired: Option<String> = sqlx::query_scalar(
        "SELECT CAST(expired_at AS TEXT) FROM bot_commands WHERE id = 'cmd_recent_unacked'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(
        recent_expired.is_none(),
        "Recent command must not be expired"
    );

    // Re-running job is idempotent (0 rows affected)
    let report2 = job.run(&ctx).await.unwrap();
    assert_eq!(report2.rows_deleted, 0, "Second run must affect 0 rows");
}

#[tokio::test]
async fn test_bot_command_rate_limit() {
    let (pool, app, _user1_id, token1, _token2, room_id, _mock) = create_user_and_app().await;

    let (bot_id, _bot_token) =
        create_bot_and_token(&app, &token1, &room_id, &["post_message", "read_commands"]).await;

    // Fill rate limit bucket (60 requests)
    let valid_ciphertext = URL_SAFE_NO_PAD.encode(b"cmd");
    for i in 0..60 {
        let req = Request::builder()
            .method("POST")
            .uri(format!("/api/v1/rooms/{}/bot-commands", room_id))
            .header(header::AUTHORIZATION, format!("Bearer {}", token1))
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(
                json!({
                    "bot_id": bot_id,
                    "ciphertext": valid_ciphertext,
                    "request_id": format!("req_{}", i)
                })
                .to_string(),
            ))
            .unwrap();

        let res = app.clone().oneshot(req).await.unwrap();
        assert_eq!(
            res.status(),
            StatusCode::ACCEPTED,
            "Request {} must succeed",
            i
        );
    }

    // 61st request in the same minute returns 429
    let req_limit = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/bot-commands", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token1))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "bot_id": bot_id,
                "ciphertext": valid_ciphertext,
                "request_id": "req_61"
            })
            .to_string(),
        ))
        .unwrap();

    let res_limit = app.clone().oneshot(req_limit).await.unwrap();
    assert_eq!(res_limit.status(), StatusCode::TOO_MANY_REQUESTS);

    let _ = pool;
}
