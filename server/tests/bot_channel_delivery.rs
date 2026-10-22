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

fn valid_bot_ct() -> String {
    URL_SAFE_NO_PAD.encode([42u8; 64])
}

fn valid_client_ct() -> String {
    URL_SAFE_NO_PAD.encode([1u8; 32])
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
        websocket_url: mock_server.uri(),
        pusher_app_key: "test-app-key".to_string(),
        pusher_app_secret: "test-app-secret".to_string(),
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
        models: Arc::new(server::ModelStore::new(
            std::path::PathBuf::from("/tmp/stt"),
            std::path::PathBuf::from("/tmp/tts"),
        )),
        occupancy: server::sessions::OccupancyStore::new(),
        call_occupancy: server::calls::CallOccupancyStore::new(),
        extension_proxy_blocklist: Arc::new(
            server::extensions_proxy::blocklist::DomainBlocklistStore::new(
                server::extensions_proxy::blocklist::DomainBlocklist::default(),
            ),
        ),
        bot_connection_state: server::bots::BotConnectionState::new(),
        room_events: server::RoomEventBroadcast::default(),
        observer_cursors: server::ObserverCursorStore::default(),
    };

    let app = server::build_app(state);
    (app, pool, mock_server)
}

async fn create_test_room(app: &Router, user_token: &str, moderation_override: &str) -> String {
    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms")
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({ "moderation_override": moderation_override }).to_string(),
        ))
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED);
    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let body_json: Value = serde_json::from_slice(&body_bytes).unwrap();
    body_json["id"].as_str().unwrap().to_string()
}

async fn create_bot_and_token(
    app: &Router,
    user_token: &str,
    room_id: &str,
    scopes: &[&str],
) -> (String, String) {
    let create_body = json!({
        "display_name": "Delivery Test Bot",
        "bot_identity_pubkey": valid_pubkey(),
        "bot_command_pubkey": valid_pubkey(),
        "identity_pubkey": valid_pubkey(),
        "declared_scopes": scopes,
    });

    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/bots")
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(create_body.to_string()))
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED);
    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let body_json: Value = serde_json::from_slice(&body_bytes).unwrap();
    let bot_id = body_json["bot_id"].as_str().unwrap().to_string();
    let bot_token = body_json["bot_token"].as_str().unwrap().to_string();

    let grant_body = json!({
        "bot_id": bot_id,
        "scopes": scopes,
    });

    let req2 = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/bots", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(grant_body.to_string()))
        .unwrap();

    let resp2 = app.clone().oneshot(req2).await.unwrap();
    assert_eq!(resp2.status(), StatusCode::CREATED);

    (bot_id, bot_token)
}

#[tokio::test]
async fn test_schema_and_allocator() {
    let (_app, pool, _mock_server) = setup_test_app_with_sockudo_mock().await;

    // Verify tables exist
    let tables: Vec<String> = sqlx::query_scalar(
        "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('bot_seq', 'bot_event_log')",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(tables.len(), 2);

    // Create a bot account in DB directly
    let bot_id = "b_test_alloc";
    let owner_id = "u_owner_alloc";

    sqlx::query("INSERT INTO users (id, username_token, opaque_registration, identity_pubkey) VALUES (?, ?, ?, ?)")
        .bind(owner_id)
        .bind("token_alloc")
        .bind(vec![0u8; 32])
        .bind(valid_pubkey())
        .execute(&pool)
        .await
        .unwrap();

    sqlx::query(
        "INSERT INTO bot_accounts (id, display_name, bot_identity_pubkey, bot_command_pubkey, identity_pubkey, owner_user_id) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(bot_id)
    .bind("Alloc Bot")
    .bind(valid_pubkey())
    .bind(valid_pubkey())
    .bind(valid_pubkey())
    .bind(owner_id)
    .execute(&pool)
    .await
    .unwrap();

    // Allocate seq 1, 2, 3
    let mut tx1 = pool.begin().await.unwrap();
    let seq1 = server::bots::allocate_bot_seq(&mut tx1, bot_id)
        .await
        .unwrap();
    assert_eq!(seq1, 1);
    tx1.commit().await.unwrap();

    let mut tx2 = pool.begin().await.unwrap();
    let seq2 = server::bots::allocate_bot_seq(&mut tx2, bot_id)
        .await
        .unwrap();
    assert_eq!(seq2, 2);
    tx2.commit().await.unwrap();

    // Rollback test: allocate seq 3, then rollback
    let mut tx3 = pool.begin().await.unwrap();
    let seq3 = server::bots::allocate_bot_seq(&mut tx3, bot_id)
        .await
        .unwrap();
    assert_eq!(seq3, 3);
    tx3.rollback().await.unwrap();

    // Next allocation in a new transaction should still be 3
    let mut tx4 = pool.begin().await.unwrap();
    let seq4 = server::bots::allocate_bot_seq(&mut tx4, bot_id)
        .await
        .unwrap();
    assert_eq!(seq4, 3);

    // Append event log
    let payload = json!({"test": "value"});
    server::bots::append_bot_event_log(&mut tx4, bot_id, seq4, "test.event", &payload)
        .await
        .unwrap();
    tx4.commit().await.unwrap();

    // Verify event in log
    let stored_payload: String =
        sqlx::query_scalar("SELECT payload FROM bot_event_log WHERE bot_id = ? AND bot_seq = ?")
            .bind(bot_id)
            .bind(seq4)
            .fetch_one(&pool)
            .await
            .unwrap();

    let parsed: Value = serde_json::from_str(&stored_payload).unwrap();
    assert_eq!(parsed["test"], "value");
}

#[tokio::test]
async fn test_bot_command_invoked_delivery() {
    let (app, pool, mock_server) = setup_test_app_with_sockudo_mock().await;

    let (user_token, _user_id) = common::create_test_user_and_session(&app, &pool).await;
    let room_id = create_test_room(&app, &user_token, "messenger").await;
    let (bot_id, _bot_token) =
        create_bot_and_token(&app, &user_token, &room_id, &["read_commands"]).await;

    let cmd_body = json!({
        "bot_id": bot_id,
        "ciphertext": URL_SAFE_NO_PAD.encode(b"command_payload"),
        "ephemeral_result_pubkey": valid_pubkey(),
    });

    let req = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/bot-commands", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(cmd_body.to_string()))
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::ACCEPTED);

    // Verify Sockudo live event publication
    let requests = mock_server.received_requests().await.unwrap();
    let command_events: Vec<_> = requests
        .into_iter()
        .filter(|r| {
            let body_str = String::from_utf8_lossy(&r.body);
            body_str.contains("bot.command_invoked")
        })
        .collect();

    assert_eq!(command_events.len(), 1);
    let event_body: Value = serde_json::from_slice(&command_events[0].body).unwrap();
    let data_str = event_body["data"].as_str().unwrap();
    let data_json: Value = serde_json::from_str(data_str).unwrap();

    assert_eq!(data_json["bot_seq"], 1);
    assert_eq!(data_json["room_id"], room_id);

    // Verify DB bot_event_log row
    let log_row = sqlx::query(
        "SELECT bot_seq, event_type, payload FROM bot_event_log WHERE bot_id = ? AND bot_seq = 1",
    )
    .bind(&bot_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    let logged_seq: i64 = sqlx::Row::get(&log_row, "bot_seq");
    let logged_type: String = sqlx::Row::get(&log_row, "event_type");
    let logged_payload_str: String = sqlx::Row::get(&log_row, "payload");

    assert_eq!(logged_seq, 1);
    assert_eq!(logged_type, "bot.command_invoked");

    let logged_payload: Value = serde_json::from_str(&logged_payload_str).unwrap();
    assert_eq!(logged_payload["bot_seq"], 1);
    assert_eq!(logged_payload["command_id"], data_json["command_id"]);
}

#[tokio::test]
async fn test_bot_settings_updated_delivery() {
    let (app, pool, mock_server) = setup_test_app_with_sockudo_mock().await;

    let (user_token, _user_id) = common::create_test_user_and_session(&app, &pool).await;
    let room_id = create_test_room(&app, &user_token, "messenger").await;
    let (bot_id, _bot_token) =
        create_bot_and_token(&app, &user_token, &room_id, &["read_commands"]).await;

    // PATCH /users/me/bots/:bot_id/settings/:key
    let patch_body = json!({
        "is_secret": false,
        "value_encrypted_bot": valid_bot_ct(),
        "value_encrypted_client": valid_client_ct(),
    });

    let req = Request::builder()
        .method("PATCH")
        .uri(format!(
            "/api/v1/users/me/bots/{}/settings/config_key",
            bot_id
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(patch_body.to_string()))
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    // Verify Sockudo events (both bot_settings.updated on user channel and bot.settings_updated on bot channel)
    let requests = mock_server.received_requests().await.unwrap();
    let bot_settings_events: Vec<_> = requests
        .into_iter()
        .filter(|r| {
            let body_str = String::from_utf8_lossy(&r.body);
            body_str.contains("bot.settings_updated")
        })
        .collect();

    assert_eq!(bot_settings_events.len(), 1);
    let event_body: Value = serde_json::from_slice(&bot_settings_events[0].body).unwrap();
    let data_str = event_body["data"].as_str().unwrap();
    let data_json: Value = serde_json::from_str(data_str).unwrap();

    assert_eq!(data_json["bot_seq"], 1);
    assert_eq!(data_json["bot_id"], bot_id);
    assert_eq!(data_json["keys_changed"], json!(["config_key"]));

    // Verify bot_event_log
    let log_payload_str: String = sqlx::query_scalar(
        "SELECT payload FROM bot_event_log WHERE bot_id = ? AND bot_seq = 1 AND event_type = 'bot.settings_updated'",
    )
    .bind(&bot_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    let log_payload: Value = serde_json::from_str(&log_payload_str).unwrap();
    assert_eq!(log_payload["bot_seq"], 1);
}

#[tokio::test]
async fn test_get_bot_sync_endpoint() {
    let (app, pool, _mock_server) = setup_test_app_with_sockudo_mock().await;

    let (user_token, _user_id) = common::create_test_user_and_session(&app, &pool).await;
    let room_id = create_test_room(&app, &user_token, "messenger").await;
    let (bot_id, bot_token) =
        create_bot_and_token(&app, &user_token, &room_id, &["read_commands"]).await;

    // 1. Auth check: calling GET /bots/me/sync with user_token returns 401
    let req_user = Request::builder()
        .method("GET")
        .uri("/api/v1/bots/me/sync?since_bot_seq=0")
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .body(Body::empty())
        .unwrap();

    let resp_user = app.clone().oneshot(req_user).await.unwrap();
    assert_eq!(resp_user.status(), StatusCode::UNAUTHORIZED);

    // 2. Initial sync with no events
    let req_bot_init = Request::builder()
        .method("GET")
        .uri("/api/v1/bots/me/sync?since_bot_seq=0")
        .header(header::AUTHORIZATION, format!("Bearer {}", bot_token))
        .body(Body::empty())
        .unwrap();

    let resp_bot_init = app.clone().oneshot(req_bot_init).await.unwrap();
    assert_eq!(resp_bot_init.status(), StatusCode::OK);
    assert_eq!(
        resp_bot_init.headers().get(header::CACHE_CONTROL).unwrap(),
        "no-store"
    );

    let body_bytes = axum::body::to_bytes(resp_bot_init.into_body(), usize::MAX)
        .await
        .unwrap();
    let sync_json: Value = serde_json::from_slice(&body_bytes).unwrap();

    assert_eq!(sync_json["events"].as_array().unwrap().len(), 0);
    assert_eq!(sync_json["max_bot_seq"], 0);
    assert_eq!(sync_json["full_resync_required"], false);

    // Send 2 commands to create events
    for _ in 0..2 {
        let cmd_body = json!({
            "bot_id": bot_id,
            "ciphertext": URL_SAFE_NO_PAD.encode(b"command_payload"),
            "ephemeral_result_pubkey": valid_pubkey(),
        });

        let req_cmd = Request::builder()
            .method("POST")
            .uri(format!("/api/v1/rooms/{}/bot-commands", room_id))
            .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(cmd_body.to_string()))
            .unwrap();

        let resp_cmd = app.clone().oneshot(req_cmd).await.unwrap();
        assert_eq!(resp_cmd.status(), StatusCode::ACCEPTED);
    }

    // 3. GET /bots/me/sync?since_bot_seq=0 returns 2 events
    let req_sync1 = Request::builder()
        .method("GET")
        .uri("/api/v1/bots/me/sync?since_bot_seq=0")
        .header(header::AUTHORIZATION, format!("Bearer {}", bot_token))
        .body(Body::empty())
        .unwrap();

    let resp_sync1 = app.clone().oneshot(req_sync1).await.unwrap();
    assert_eq!(resp_sync1.status(), StatusCode::OK);
    let bytes1 = axum::body::to_bytes(resp_sync1.into_body(), usize::MAX)
        .await
        .unwrap();
    let json1: Value = serde_json::from_slice(&bytes1).unwrap();

    let events1 = json1["events"].as_array().unwrap();
    assert_eq!(events1.len(), 2);
    assert_eq!(events1[0]["bot_seq"], 1);
    assert_eq!(events1[1]["bot_seq"], 2);
    assert_eq!(json1["max_bot_seq"], 2);
    assert_eq!(json1["full_resync_required"], false);

    // 4. GET /bots/me/sync?since_bot_seq=1 returns only the 2nd event
    let req_sync2 = Request::builder()
        .method("GET")
        .uri("/api/v1/bots/me/sync?since_bot_seq=1")
        .header(header::AUTHORIZATION, format!("Bearer {}", bot_token))
        .body(Body::empty())
        .unwrap();

    let resp_sync2 = app.clone().oneshot(req_sync2).await.unwrap();
    let bytes2 = axum::body::to_bytes(resp_sync2.into_body(), usize::MAX)
        .await
        .unwrap();
    let json2: Value = serde_json::from_slice(&bytes2).unwrap();

    let events2 = json2["events"].as_array().unwrap();
    assert_eq!(events2.len(), 1);
    assert_eq!(events2[0]["bot_seq"], 2);

    // 5. Defensive max_bot_seq when since_bot_seq exceeds highest allocated
    let req_sync_def = Request::builder()
        .method("GET")
        .uri("/api/v1/bots/me/sync?since_bot_seq=10")
        .header(header::AUTHORIZATION, format!("Bearer {}", bot_token))
        .body(Body::empty())
        .unwrap();

    let resp_sync_def = app.clone().oneshot(req_sync_def).await.unwrap();
    let bytes_def = axum::body::to_bytes(resp_sync_def.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_def: Value = serde_json::from_slice(&bytes_def).unwrap();

    assert_eq!(json_def["max_bot_seq"], 10);
    assert_eq!(json_def["full_resync_required"], false);

    // 6. Delete first log row so min retained sequence becomes 2, then query since_bot_seq=1
    sqlx::query("DELETE FROM bot_event_log WHERE bot_id = ? AND bot_seq = 1")
        .bind(&bot_id)
        .execute(&pool)
        .await
        .unwrap();

    let req_sync_pruned = Request::builder()
        .method("GET")
        .uri("/api/v1/bots/me/sync?since_bot_seq=1")
        .header(header::AUTHORIZATION, format!("Bearer {}", bot_token))
        .body(Body::empty())
        .unwrap();

    let resp_sync_pruned = app.clone().oneshot(req_sync_pruned).await.unwrap();
    let bytes_pruned = axum::body::to_bytes(resp_sync_pruned.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_pruned: Value = serde_json::from_slice(&bytes_pruned).unwrap();

    assert_eq!(json_pruned["full_resync_required"], true);
}

#[tokio::test]
async fn test_cleanup_job_bot_event_log() {
    let (_app, pool, _mock_server) = setup_test_app_with_sockudo_mock().await;

    let bot_id = "b_test_cleanup";
    let owner_id = "u_owner_cleanup";

    sqlx::query("INSERT INTO users (id, username_token, opaque_registration, identity_pubkey) VALUES (?, ?, ?, ?)")
        .bind(owner_id)
        .bind("token_clean")
        .bind(vec![0u8; 32])
        .bind(valid_pubkey())
        .execute(&pool)
        .await
        .unwrap();

    sqlx::query(
        "INSERT INTO bot_accounts (id, display_name, bot_identity_pubkey, bot_command_pubkey, identity_pubkey, owner_user_id) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(bot_id)
    .bind("Cleanup Bot")
    .bind(valid_pubkey())
    .bind(valid_pubkey())
    .bind(valid_pubkey())
    .bind(owner_id)
    .execute(&pool)
    .await
    .unwrap();

    // Insert an old row (> 24 hours old) and a recent row
    sqlx::query(
        "INSERT INTO bot_event_log (bot_id, bot_seq, event_type, payload, created_at) VALUES (?, 1, 'old_event', '{}', datetime('now', '-25 hours'))",
    )
    .bind(bot_id)
    .execute(&pool)
    .await
    .unwrap();

    sqlx::query(
        "INSERT INTO bot_event_log (bot_id, bot_seq, event_type, payload, created_at) VALUES (?, 2, 'recent_event', '{}', datetime('now', '-1 hour'))",
    )
    .bind(bot_id)
    .execute(&pool)
    .await
    .unwrap();

    let config = Arc::new(server::Config::test_default());
    let reg_store = Arc::new(server::RegistrationStore::new());
    let login_store = Arc::new(server::LoginStore::new());
    let rec_store = Arc::new(server::RecoveryStore::new());
    let storage = server::build_storage(&config).unwrap();
    let hard_max = Arc::new(server::ServerHardMax {
        file_size_bytes: 10000,
        room_size: 1000,
        rooms_per_user: 500,
        devices_per_user: 20,
        keypackages_per_device: 50,
        message_size_bytes: 65536,
        attachment_retention_days: 365,
        call_max_participants: 50,
        reactions_per_message: 50,
        room_metadata_bytes: 65536,
        edit_window_seconds: config.server_max_edit_window_seconds,
    });
    let sockudo_config = server::SockudoConfig {
        http_base: "http://localhost:8080".to_string(),
        app_id: "test_app".to_string(),
        app_key: "test_key".to_string(),
        app_secret: "test_secret".to_string(),
        enable_client_events: true,
    };
    let publisher = Arc::new(server::Publisher::new(sockudo_config));

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

    let job = server::cleanup::bot_event_log::BotEventLogTtlJob;
    let report = server::CleanupJob::run(&job, &ctx).await.unwrap();
    assert_eq!(report.rows_deleted, 1);

    // Verify row 1 was deleted and row 2 remains
    let remaining_seqs: Vec<i64> =
        sqlx::query_scalar("SELECT bot_seq FROM bot_event_log WHERE bot_id = ? ORDER BY bot_seq")
            .bind(bot_id)
            .fetch_all(&pool)
            .await
            .unwrap();

    assert_eq!(remaining_seqs, vec![2]);

    // Idempotency: run again, 0 rows deleted
    let report2 = server::CleanupJob::run(&job, &ctx).await.unwrap();
    assert_eq!(report2.rows_deleted, 0);
}

#[tokio::test]
async fn test_non_participating_events() {
    let (app, pool, _mock_server) = setup_test_app_with_sockudo_mock().await;

    let (user_token, _user_id) = common::create_test_user_and_session(&app, &pool).await;
    let room_id = create_test_room(&app, &user_token, "messenger").await;
    let (bot_id, _bot_token) =
        create_bot_and_token(&app, &user_token, &room_id, &["read_commands"]).await;

    // PATCH /bots/:id (triggers bot.updated)
    let patch_body = json!({
        "display_name": "Updated Bot Name",
    });

    let req_patch = Request::builder()
        .method("PATCH")
        .uri(format!("/api/v1/bots/{}", bot_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(patch_body.to_string()))
        .unwrap();

    let resp_patch = app.clone().oneshot(req_patch).await.unwrap();
    assert_eq!(resp_patch.status(), StatusCode::OK);

    // Check bot_event_log: no rows created
    let log_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM bot_event_log WHERE bot_id = ?")
        .bind(&bot_id)
        .fetch_one(&pool)
        .await
        .unwrap();

    assert_eq!(log_count, 0);

    // Check bot_seq: no seq allocated
    let highest_seq: Option<i64> =
        sqlx::query_scalar("SELECT next_seq - 1 FROM bot_seq WHERE bot_id = ?")
            .bind(&bot_id)
            .fetch_optional(&pool)
            .await
            .unwrap();

    assert_eq!(highest_seq, None);
}

#[tokio::test]
async fn test_reconnect_simulation() {
    let (app, pool, _mock_server) = setup_test_app_with_sockudo_mock().await;

    let (user_token, _user_id) = common::create_test_user_and_session(&app, &pool).await;
    let room_id = create_test_room(&app, &user_token, "messenger").await;
    let (bot_id, bot_token) =
        create_bot_and_token(&app, &user_token, &room_id, &["read_commands"]).await;

    // Publish three events while bot is conceptually offline
    for i in 1..=3 {
        let cmd_body = json!({
            "bot_id": bot_id,
            "ciphertext": URL_SAFE_NO_PAD.encode(format!("command_{}", i).as_bytes()),
            "ephemeral_result_pubkey": valid_pubkey(),
        });

        let req_cmd = Request::builder()
            .method("POST")
            .uri(format!("/api/v1/rooms/{}/bot-commands", room_id))
            .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(cmd_body.to_string()))
            .unwrap();

        let resp_cmd = app.clone().oneshot(req_cmd).await.unwrap();
        assert_eq!(resp_cmd.status(), StatusCode::ACCEPTED);
    }

    // Call sync endpoint with since_bot_seq = 0 -> all 3 events returned
    let req_sync0 = Request::builder()
        .method("GET")
        .uri("/api/v1/bots/me/sync?since_bot_seq=0")
        .header(header::AUTHORIZATION, format!("Bearer {}", bot_token))
        .body(Body::empty())
        .unwrap();

    let resp_sync0 = app.clone().oneshot(req_sync0).await.unwrap();
    let bytes0 = axum::body::to_bytes(resp_sync0.into_body(), usize::MAX)
        .await
        .unwrap();
    let json0: Value = serde_json::from_slice(&bytes0).unwrap();

    let events0 = json0["events"].as_array().unwrap();
    assert_eq!(events0.len(), 3);
    assert_eq!(events0[0]["bot_seq"], 1);
    assert_eq!(events0[1]["bot_seq"], 2);
    assert_eq!(events0[2]["bot_seq"], 3);

    // Call sync endpoint with since_bot_seq = 2 -> only 3rd event returned
    let req_sync2 = Request::builder()
        .method("GET")
        .uri("/api/v1/bots/me/sync?since_bot_seq=2")
        .header(header::AUTHORIZATION, format!("Bearer {}", bot_token))
        .body(Body::empty())
        .unwrap();

    let resp_sync2 = app.clone().oneshot(req_sync2).await.unwrap();
    let bytes2 = axum::body::to_bytes(resp_sync2.into_body(), usize::MAX)
        .await
        .unwrap();
    let json2: Value = serde_json::from_slice(&bytes2).unwrap();

    let events2 = json2["events"].as_array().unwrap();
    assert_eq!(events2.len(), 1);
    assert_eq!(events2[0]["bot_seq"], 3);
}

#[tokio::test]
async fn test_transaction_atomicity() {
    let (_app, pool, _mock_server) = setup_test_app_with_sockudo_mock().await;

    let bot_id = "b_test_atomic";
    let owner_id = "u_owner_atomic";

    sqlx::query("INSERT INTO users (id, username_token, opaque_registration, identity_pubkey) VALUES (?, ?, ?, ?)")
        .bind(owner_id)
        .bind("token_atomic")
        .bind(vec![0u8; 32])
        .bind(valid_pubkey())
        .execute(&pool)
        .await
        .unwrap();

    sqlx::query(
        "INSERT INTO bot_accounts (id, display_name, bot_identity_pubkey, bot_command_pubkey, identity_pubkey, owner_user_id) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(bot_id)
    .bind("Atomic Bot")
    .bind(valid_pubkey())
    .bind(valid_pubkey())
    .bind(valid_pubkey())
    .bind(owner_id)
    .execute(&pool)
    .await
    .unwrap();

    // Start tx, allocate bot_seq, append log, then rollback
    let mut tx = pool.begin().await.unwrap();
    let payload = json!({"cmd": "fail"});
    let (_seq, _p) =
        server::bots::prepare_durable_bot_event(&mut tx, bot_id, "bot.command_invoked", payload)
            .await
            .unwrap();

    tx.rollback().await.unwrap();

    // Assert no log rows exist and bot_seq next_seq is unconsumed
    let log_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM bot_event_log WHERE bot_id = ?")
        .bind(bot_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(log_count, 0);

    // Next sequence allocation in a new tx will start at 1
    let mut tx2 = pool.begin().await.unwrap();
    let seq2 = server::bots::allocate_bot_seq(&mut tx2, bot_id)
        .await
        .unwrap();
    assert_eq!(seq2, 1);
    tx2.commit().await.unwrap();
}
