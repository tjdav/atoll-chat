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
                "name": "Result Room",
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

async fn create_bot_and_token(
    app: &Router,
    user_token: &str,
    room_id: &str,
    scopes: &[&str],
) -> (String, String) {
    let create_body = json!({
        "display_name": "Result Bot",
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
async fn test_bot_commands_schema_extended() {
    let pool = common::setup_test_db().await;

    // Verify columns exist on bot_commands
    let pragma_rows: Vec<(i64, String, String, i64, Option<String>, i64)> =
        sqlx::query_as("PRAGMA table_info(bot_commands)")
            .fetch_all(&pool)
            .await
            .unwrap();

    let columns: Vec<String> = pragma_rows.into_iter().map(|r| r.1).collect();
    assert!(columns.contains(&"ephemeral_result_pubkey".to_string()));
    assert!(columns.contains(&"result_at".to_string()));
    assert!(columns.contains(&"result_type".to_string()));

    // Verify inserting without ephemeral_result_pubkey fails (NOT NULL)
    let res = sqlx::query(
        r#"
        INSERT INTO bot_commands (id, bot_id, room_id, sender_user_id, sender_client_id, ciphertext)
        VALUES ('cmd_fail', 'b_1', 'r_1', 'u_1', 'c_1', X'1234')
        "#,
    )
    .execute(&pool)
    .await;

    assert!(
        res.is_err(),
        "Insertion without ephemeral_result_pubkey must fail NOT NULL constraint"
    );
}

#[tokio::test]
async fn test_post_bot_command_result_happy_path() {
    let (app, pool, mock_server) = setup_test_app_with_sockudo_mock().await;
    let (user_token, user_id) = common::create_test_user_and_session(&app, &pool).await;
    let room_id = create_test_room(&app, &user_token).await;
    let (bot_id, bot_token) = create_bot_and_token(
        &app,
        &user_token,
        &room_id,
        &["post_message", "read_commands"],
    )
    .await;

    // 1. User submits command
    let erpk = valid_pubkey();
    let post_req = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/bot-commands", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "bot_id": bot_id,
                "ciphertext": URL_SAFE_NO_PAD.encode(b"hello_bot"),
                "ephemeral_result_pubkey": erpk,
                "request_id": "req_cmd_1"
            })
            .to_string(),
        ))
        .unwrap();

    let res = app.clone().oneshot(post_req).await.unwrap();
    assert_eq!(res.status(), StatusCode::ACCEPTED);
    let bytes = axum::body::to_bytes(res.into_body(), usize::MAX)
        .await
        .unwrap();
    let post_json: Value = serde_json::from_slice(&bytes).unwrap();
    let command_id = post_json["command_id"].as_str().unwrap();

    // 2. Bot acks command
    let ack_req = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/bots/me/commands/{}/ack", command_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", bot_token))
        .body(Body::empty())
        .unwrap();

    let ack_res = app.clone().oneshot(ack_req).await.unwrap();
    assert_eq!(ack_res.status(), StatusCode::NO_CONTENT);

    // Get user's next_seq before result delivery to verify user_seq is NOT allocated
    let seq_before: i64 = sqlx::query_scalar("SELECT next_seq FROM user_seq WHERE user_id = ?")
        .bind(&user_id)
        .fetch_optional(&pool)
        .await
        .unwrap()
        .unwrap_or(1);

    // 3. Bot delivers result with target: "invoker"
    let result_ct = URL_SAFE_NO_PAD.encode(b"result_ciphertext_payload");
    let bot_res_pk = valid_pubkey();

    let result_req = Request::builder()
        .method("POST")
        .uri("/api/v1/bots/me/messages")
        .header(header::AUTHORIZATION, format!("Bearer {}", bot_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "target": "invoker",
                "target_user_id": user_id,
                "command_id": command_id,
                "result_type": "local_message",
                "ciphertext": result_ct,
                "bot_result_pubkey": bot_res_pk,
                "request_id": "req_res_1"
            })
            .to_string(),
        ))
        .unwrap();

    let res = app.clone().oneshot(result_req).await.unwrap();
    assert_eq!(res.status(), StatusCode::NO_CONTENT);
    assert_eq!(
        res.headers().get(header::CACHE_CONTROL).unwrap(),
        "no-store"
    );

    // Verify result_at and result_type in DB
    let (res_at, res_type): (Option<String>, Option<String>) = sqlx::query_as(
        "SELECT CAST(result_at AS TEXT), result_type FROM bot_commands WHERE id = ?",
    )
    .bind(command_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    assert!(res_at.is_some());
    assert_eq!(res_type.unwrap(), "local_message");

    // Verify user_seq was NOT incremented
    let seq_after: i64 = sqlx::query_scalar("SELECT next_seq FROM user_seq WHERE user_id = ?")
        .bind(&user_id)
        .fetch_optional(&pool)
        .await
        .unwrap()
        .unwrap_or(1);
    assert_eq!(
        seq_before, seq_after,
        "bot.command_result must not allocate user_seq"
    );

    // Verify event published on private-user-{user_id}
    let requests = mock_server.received_requests().await.unwrap();
    let result_events: Vec<&wiremock::Request> = requests
        .iter()
        .filter(|r| {
            let body_str = String::from_utf8_lossy(&r.body);
            body_str.contains("bot.command_result")
        })
        .collect();

    assert_eq!(result_events.len(), 1);
    let event_json: Value = serde_json::from_slice(&result_events[0].body).unwrap();
    assert_eq!(event_json["channel"], format!("private-user-{}", user_id));

    let inner_data: Value = serde_json::from_str(event_json["data"].as_str().unwrap()).unwrap();
    assert_eq!(inner_data["command_id"], command_id);
    assert_eq!(inner_data["bot_id"], bot_id);
    assert_eq!(inner_data["room_id"], room_id);
    assert_eq!(inner_data["result_type"], "local_message");
    assert_eq!(inner_data["ciphertext"], result_ct);
    assert_eq!(inner_data["bot_result_pubkey"], bot_res_pk);
}

#[tokio::test]
async fn test_post_bot_command_result_type_none() {
    let (app, pool, _mock_server) = setup_test_app_with_sockudo_mock().await;
    let (user_token, user_id) = common::create_test_user_and_session(&app, &pool).await;
    let room_id = create_test_room(&app, &user_token).await;
    let (bot_id, bot_token) = create_bot_and_token(
        &app,
        &user_token,
        &room_id,
        &["post_message", "read_commands"],
    )
    .await;

    // Submit command & ack
    let post_req = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/bot-commands", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "bot_id": bot_id,
                "ciphertext": URL_SAFE_NO_PAD.encode(b"cmd_none"),
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

    // Deliver result_type = "none" (no ciphertext or bot_result_pubkey required)
    let result_req = Request::builder()
        .method("POST")
        .uri("/api/v1/bots/me/messages")
        .header(header::AUTHORIZATION, format!("Bearer {}", bot_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "target": "invoker",
                "target_user_id": user_id,
                "command_id": command_id,
                "result_type": "none"
            })
            .to_string(),
        ))
        .unwrap();

    let res = app.clone().oneshot(result_req).await.unwrap();
    assert_eq!(res.status(), StatusCode::NO_CONTENT);

    // Verify DB updated with result_type = "none" and result_at set
    let (res_at, res_type): (Option<String>, Option<String>) = sqlx::query_as(
        "SELECT CAST(result_at AS TEXT), result_type FROM bot_commands WHERE id = ?",
    )
    .bind(command_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    assert!(res_at.is_some());
    assert_eq!(res_type.unwrap(), "none");
}

#[tokio::test]
async fn test_post_bot_command_result_errors() {
    let (app, pool, _mock) = setup_test_app_with_sockudo_mock().await;
    let (user_token, user_id) = common::create_test_user_and_session(&app, &pool).await;
    let (user_token_2, user2_id) = common::create_test_user_and_session(&app, &pool).await;
    let room_id = create_test_room(&app, &user_token).await;

    // Grant user2 to room
    let member_req = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/members", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "user_id": user2_id }).to_string()))
        .unwrap();
    let _ = app.clone().oneshot(member_req).await.unwrap();

    let (bot1_id, bot1_token) = create_bot_and_token(
        &app,
        &user_token,
        &room_id,
        &["post_message", "read_commands"],
    )
    .await;
    let (_bot2_id, bot2_token) = create_bot_and_token(
        &app,
        &user_token,
        &room_id,
        &["post_message", "read_commands"],
    )
    .await;

    // 1. target: "owner" -> 400 unsupported_target
    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/bots/me/messages")
        .header(header::AUTHORIZATION, format!("Bearer {}", bot1_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({ "target": "owner", "result_type": "toast" }).to_string(),
        ))
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);

    // 2. User session token -> 401
    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/bots/me/messages")
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({ "target": "invoker", "result_type": "toast" }).to_string(),
        ))
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);

    // Submit command 1 as user1 to bot1 (NOT acked)
    let post_req = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/bot-commands", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "bot_id": bot1_id,
                "ciphertext": URL_SAFE_NO_PAD.encode(b"cmd1"),
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
    let cmd1_id = post_json["command_id"].as_str().unwrap();

    // 3. Result delivered when command NOT acked -> 409 command_not_acked
    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/bots/me/messages")
        .header(header::AUTHORIZATION, format!("Bearer {}", bot1_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "target": "invoker",
                "target_user_id": user_id,
                "command_id": cmd1_id,
                "result_type": "toast",
                "ciphertext": URL_SAFE_NO_PAD.encode(b"ct"),
                "bot_result_pubkey": valid_pubkey()
            })
            .to_string(),
        ))
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::CONFLICT);

    // Ack cmd1
    let ack_req = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/bots/me/commands/{}/ack", cmd1_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", bot1_token))
        .body(Body::empty())
        .unwrap();
    let _ = app.clone().oneshot(ack_req).await.unwrap();

    // 4. Mismatched target_user_id -> 400 target_mismatch
    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/bots/me/messages")
        .header(header::AUTHORIZATION, format!("Bearer {}", bot1_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "target": "invoker",
                "target_user_id": user2_id,
                "command_id": cmd1_id,
                "result_type": "toast",
                "ciphertext": URL_SAFE_NO_PAD.encode(b"ct"),
                "bot_result_pubkey": valid_pubkey()
            })
            .to_string(),
        ))
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);

    // 5. Command belonging to Bot 2 delivered by Bot 1 -> 403 forbidden
    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/bots/me/messages")
        .header(header::AUTHORIZATION, format!("Bearer {}", bot2_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "target": "invoker",
                "target_user_id": user_id,
                "command_id": cmd1_id,
                "result_type": "toast",
                "ciphertext": URL_SAFE_NO_PAD.encode(b"ct"),
                "bot_result_pubkey": valid_pubkey()
            })
            .to_string(),
        ))
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::FORBIDDEN);

    // 6. Non-existent command_id -> 404 command_not_found
    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/bots/me/messages")
        .header(header::AUTHORIZATION, format!("Bearer {}", bot1_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "target": "invoker",
                "target_user_id": user_id,
                "command_id": "cmd_nonexistent",
                "result_type": "toast",
                "ciphertext": URL_SAFE_NO_PAD.encode(b"ct"),
                "bot_result_pubkey": valid_pubkey()
            })
            .to_string(),
        ))
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::NOT_FOUND);

    // 7. Invalid result_type -> 400 invalid_result_type
    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/bots/me/messages")
        .header(header::AUTHORIZATION, format!("Bearer {}", bot1_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "target": "invoker",
                "target_user_id": user_id,
                "command_id": cmd1_id,
                "result_type": "invalid_type",
                "ciphertext": URL_SAFE_NO_PAD.encode(b"ct"),
                "bot_result_pubkey": valid_pubkey()
            })
            .to_string(),
        ))
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);

    // 8. Missing ciphertext when result_type != "none" -> 400
    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/bots/me/messages")
        .header(header::AUTHORIZATION, format!("Bearer {}", bot1_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "target": "invoker",
                "target_user_id": user_id,
                "command_id": cmd1_id,
                "result_type": "toast",
                "bot_result_pubkey": valid_pubkey()
            })
            .to_string(),
        ))
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);

    // 9. Oversized ciphertext (>64 KiB) -> 413
    let oversized = URL_SAFE_NO_PAD.encode(vec![0u8; 65537]);
    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/bots/me/messages")
        .header(header::AUTHORIZATION, format!("Bearer {}", bot1_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "target": "invoker",
                "target_user_id": user_id,
                "command_id": cmd1_id,
                "result_type": "toast",
                "ciphertext": oversized,
                "bot_result_pubkey": valid_pubkey()
            })
            .to_string(),
        ))
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::PAYLOAD_TOO_LARGE);

    // 10. Invalid bot_result_pubkey (non-32-byte) -> 400
    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/bots/me/messages")
        .header(header::AUTHORIZATION, format!("Bearer {}", bot1_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "target": "invoker",
                "target_user_id": user_id,
                "command_id": cmd1_id,
                "result_type": "toast",
                "ciphertext": URL_SAFE_NO_PAD.encode(b"ct"),
                "bot_result_pubkey": URL_SAFE_NO_PAD.encode([1u8; 16])
            })
            .to_string(),
        ))
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);

    // Deliver valid result for cmd1
    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/bots/me/messages")
        .header(header::AUTHORIZATION, format!("Bearer {}", bot1_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "target": "invoker",
                "target_user_id": user_id,
                "command_id": cmd1_id,
                "result_type": "toast",
                "ciphertext": URL_SAFE_NO_PAD.encode(b"ct"),
                "bot_result_pubkey": valid_pubkey()
            })
            .to_string(),
        ))
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::NO_CONTENT);

    // 11. Already delivered command -> 409 command_result_already_delivered
    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/bots/me/messages")
        .header(header::AUTHORIZATION, format!("Bearer {}", bot1_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "target": "invoker",
                "target_user_id": user_id,
                "command_id": cmd1_id,
                "result_type": "toast",
                "ciphertext": URL_SAFE_NO_PAD.encode(b"ct"),
                "bot_result_pubkey": valid_pubkey()
            })
            .to_string(),
        ))
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::CONFLICT);

    let _ = user_token_2;
}

#[tokio::test]
async fn test_post_bot_command_result_idempotency_and_rate_limit() {
    let (app, pool, _mock) = setup_test_app_with_sockudo_mock().await;
    let (user_token, user_id) = common::create_test_user_and_session(&app, &pool).await;
    let room_id = create_test_room(&app, &user_token).await;
    let (bot_id, bot_token) = create_bot_and_token(
        &app,
        &user_token,
        &room_id,
        &["post_message", "read_commands"],
    )
    .await;

    // Submit command & ack
    let post_req = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/bot-commands", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "bot_id": bot_id,
                "ciphertext": URL_SAFE_NO_PAD.encode(b"cmd_idemp"),
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

    // 1. Valid result delivery with request_id = "res_req_1"
    let req1 = Request::builder()
        .method("POST")
        .uri("/api/v1/bots/me/messages")
        .header(header::AUTHORIZATION, format!("Bearer {}", bot_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "target": "invoker",
                "target_user_id": user_id,
                "command_id": command_id,
                "result_type": "toast",
                "ciphertext": URL_SAFE_NO_PAD.encode(b"res1"),
                "bot_result_pubkey": valid_pubkey(),
                "request_id": "res_req_1"
            })
            .to_string(),
        ))
        .unwrap();
    let res1 = app.clone().oneshot(req1).await.unwrap();
    assert_eq!(res1.status(), StatusCode::NO_CONTENT);

    // 2. Re-send with same request_id -> 204 with idempotent marker payload
    let req2 = Request::builder()
        .method("POST")
        .uri("/api/v1/bots/me/messages")
        .header(header::AUTHORIZATION, format!("Bearer {}", bot_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "target": "invoker",
                "target_user_id": user_id,
                "command_id": command_id,
                "result_type": "toast",
                "ciphertext": URL_SAFE_NO_PAD.encode(b"res1"),
                "bot_result_pubkey": valid_pubkey(),
                "request_id": "res_req_1"
            })
            .to_string(),
        ))
        .unwrap();
    let res2 = app.clone().oneshot(req2).await.unwrap();
    assert_eq!(res2.status(), StatusCode::NO_CONTENT);

    let bytes = axum::body::to_bytes(res2.into_body(), usize::MAX)
        .await
        .unwrap();
    let body_json: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(body_json["idempotent"], true);

    // 3. Cross-endpoint request_id conflict (use res_req_1 on bot-messages)
    let req_cross = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/bot-messages", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", bot_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "epoch": 0,
                "ciphertext": URL_SAFE_NO_PAD.encode(b"msg"),
                "content_type": "bot",
                "signature": URL_SAFE_NO_PAD.encode([0u8; 64]),
                "request_id": "res_req_1"
            })
            .to_string(),
        ))
        .unwrap();
    let res_cross = app.clone().oneshot(req_cross).await.unwrap();
    assert_eq!(res_cross.status(), StatusCode::CONFLICT);
}

#[tokio::test]
async fn test_post_bot_command_result_opacity() {
    let (app, pool, _mock) = setup_test_app_with_sockudo_mock().await;
    let (user_token, user_id) = common::create_test_user_and_session(&app, &pool).await;
    let room_id = create_test_room(&app, &user_token).await;
    let (bot_id, bot_token) = create_bot_and_token(
        &app,
        &user_token,
        &room_id,
        &["post_message", "read_commands"],
    )
    .await;

    // Submit command & ack
    let post_req = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/bot-commands", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
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

    // Send arbitrary junk bytes as ciphertext and arbitrary 32-byte pubkey -> server accepts opaquely
    let junk_ct = URL_SAFE_NO_PAD.encode(b"GARBAGE_NON_JSON_CIPHERTEXT_XYZ_12345");
    let junk_pk = URL_SAFE_NO_PAD.encode([255u8; 32]);

    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/bots/me/messages")
        .header(header::AUTHORIZATION, format!("Bearer {}", bot_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "target": "invoker",
                "target_user_id": user_id,
                "command_id": command_id,
                "result_type": "toast",
                "ciphertext": junk_ct,
                "bot_result_pubkey": junk_pk
            })
            .to_string(),
        ))
        .unwrap();

    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::NO_CONTENT);
}
