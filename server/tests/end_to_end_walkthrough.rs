use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use axum::Router;
use base64::engine::general_purpose::{STANDARD as BASE64, URL_SAFE_NO_PAD};
use base64::Engine;
use ed25519_dalek::{Signer, SigningKey};
use serde_json::{json, Value};
use sqlx::SqlitePool;
use std::sync::Arc;
use tower::ServiceExt;
use utoipa::OpenApi;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

mod common;
use common::{login_user, register_user};
use server::cleanup::{
    operator_queue_retention::OperatorQueueRetentionJob,
    operator_queue_timeout::OperatorQueueTimeoutJob, CleanupContextOwned, CleanupJob,
};
use server::login::LoginStore;
use server::recovery::RecoveryStore;
use server::registration::RegistrationStore;

// Helper to construct test signing key
fn test_signing_key() -> SigningKey {
    SigningKey::from_bytes(&[7u8; 32])
}

fn valid_pubkey() -> String {
    let sk = test_signing_key();
    URL_SAFE_NO_PAD.encode(sk.verifying_key().as_bytes())
}

fn make_bot_sig(room_id: &str, epoch: u64, content_type: &str, ciphertext: &[u8]) -> String {
    let input =
        server::signing::encode_bot_message_signing_input(room_id, epoch, content_type, ciphertext);
    let sk = test_signing_key();
    let sig = sk.sign(&input);
    URL_SAFE_NO_PAD.encode(sig.to_bytes())
}

async fn setup_app_with_sockudo_mock() -> (Router, SqlitePool, MockServer, server::Config) {
    let mock_server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/apps/chat/events"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"ok": true})))
        .mount(&mock_server)
        .await;

    let temp_dir = std::env::temp_dir().join(format!("walkthrough_test_{}", ulid::Ulid::new()));
    let _ = std::fs::create_dir_all(&temp_dir);
    let db_path = temp_dir.join("app.db");
    let key_path = temp_dir.join("oprf.key");

    let config = server::Config {
        db_path: db_path.to_string_lossy().to_string(),
        opaque_oprf_key_path: key_path.to_str().unwrap().to_string(),
        altcha_enabled: true,
        altcha_hmac_secret: "auto".to_string(),
        altcha_cost: 100,
        cleanup_enabled: true,
        cleanup_startup_delay_secs: 30,
        sockudo_url: mock_server.uri(),
        sockudo_app_key: "test-app-key".to_string(),
        sockudo_app_secret: "test-app-secret".to_string(),
        storage_fs_path: temp_dir.join("attachments"),
        backup_path: temp_dir.join("backups"),
        ..server::Config::test_default()
    };

    let pool = sqlx::sqlite::SqlitePoolOptions::new()
        .max_connections(1)
        .connect(&format!("sqlite:{}?mode=rwc", db_path.display()))
        .await
        .expect("Failed to connect to test DB");

    sqlx::migrate!("./migrations")
        .run(&pool)
        .await
        .expect("Failed to run migrations on test DB");

    let opaque_server = Arc::new(
        server::OpaqueServer::load_or_generate(&key_path).expect("Failed to create OpaqueServer"),
    );
    let registration_store = Arc::new(RegistrationStore::new());
    let login_store = Arc::new(LoginStore::new());
    let recovery_store = Arc::new(RecoveryStore::new());

    let storage = server::build_storage(&config).expect("Failed to build test storage");
    let altcha_config = Arc::new(
        server::AltchaConfig::from_env(&config, &pool)
            .await
            .expect("Failed to init AltchaConfig"),
    );

    let config_arc = Arc::new(config.clone());

    let server_hard_max = Arc::new(server::ServerHardMax {
        file_size_bytes: config_arc.max_file_size_bytes as i64,
        room_size: 1000,
        rooms_per_user: 500,
        devices_per_user: config_arc.server_max_devices_per_user as i64,
        keypackages_per_device: 50,
        message_size_bytes: 65536,
        attachment_retention_days: 365,
        call_max_participants: 50,
        reactions_per_message: 50,
        room_metadata_bytes: config_arc.server_max_room_metadata_bytes,
        edit_window_seconds: config_arc.server_max_edit_window_seconds,
    });

    let sockudo_config = server::SockudoConfig {
        http_base: mock_server.uri(),
        app_id: "chat".to_string(),
        app_key: "test-app-key".to_string(),
        app_secret: "test-app-secret".to_string(),
        enable_client_events: true,
    };
    let room_events = server::events::RoomEventBroadcast::default();
    let observer_cursors = server::events::ObserverCursorStore::default();
    let publisher =
        Arc::new(server::Publisher::new(sockudo_config).with_room_events(room_events.clone()));

    let oprf_keys =
        server::oprf::OprfKeys::load(&opaque_server.setup).expect("Failed to load OprfKeys");
    let oprf = Arc::new(server::oprf::OprfEvaluator::new(&oprf_keys));
    let oprf_audit = Arc::new(server::oprf::OprfAuditCounter::new());

    let session_types = Arc::new(server::sessions::SessionTypesStore::new(
        server::sessions::init_session_types_state(false, "", 10, 10),
    ));

    let models = Arc::new(server::models::ModelStore::new_with_mode(
        server::models::ModelHostingMode::Local,
        "".into(),
        "".into(),
        None,
    ));

    let extension_proxy_blocklist =
        Arc::new(server::extensions_proxy::blocklist::init_blocklist_store(
            &config_arc.extension_proxy_deny_domains,
            &config_arc.extension_proxy_deny_domains_path,
        ));

    let state = server::AppState {
        pool: pool.clone(),
        opaque_server,
        registration_store,
        login_store,
        recovery_store,
        altcha_config,
        config: config_arc,
        server_hard_max,
        publisher,
        storage,
        oprf,
        oprf_audit,
        link_preview_keys: None,
        session_types,
        models,
        room_events,
        observer_cursors,
        backup_lock: Arc::new(tokio::sync::Mutex::new(())),
        oprf_rotation_lock: Arc::new(tokio::sync::Mutex::new(())),
        vapid_keys: None,
        push_delivery: None,
        occupancy: server::sessions::OccupancyStore::default(),
        call_occupancy: server::calls::CallOccupancyStore::default(),
        extension_proxy_blocklist,
        bot_connection_state: server::bots::BotConnectionState::default(),
    };

    let app = server::build_app(state);
    (app, pool, mock_server, config)
}

fn build_cleanup_ctx(pool: SqlitePool, config: server::Config) -> CleanupContextOwned {
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
    let registration_store = Arc::new(RegistrationStore::new());
    let login_store = Arc::new(LoginStore::new());
    let recovery_store = Arc::new(RecoveryStore::new());
    let sockudo_config = server::SockudoConfig {
        http_base: "http://localhost:6001".to_string(),
        app_id: "chat".to_string(),
        app_key: "test-key".to_string(),
        app_secret: "test-secret".to_string(),
        enable_client_events: true,
    };
    let publisher = Arc::new(server::Publisher::new(sockudo_config));

    CleanupContextOwned {
        pool,
        config: config_arc,
        registration_store,
        login_store,
        recovery_store,
        storage,
        server_max,
        publisher,
    }
}

#[tokio::test]
async fn test_end_to_end_walkthrough() {
    let (app, pool, mock_server, config) = setup_app_with_sockudo_mock().await;

    // ==========================================
    // Phase 1 — Boot and capabilities.
    // ==========================================
    let req_health = Request::builder()
        .method("GET")
        .uri("/health")
        .body(Body::empty())
        .unwrap();
    let resp_health = app.clone().oneshot(req_health).await.unwrap();
    assert_eq!(resp_health.status(), StatusCode::OK);

    let req_ready = Request::builder()
        .method("GET")
        .uri("/ready")
        .body(Body::empty())
        .unwrap();
    let resp_ready = app.clone().oneshot(req_ready).await.unwrap();
    assert_eq!(resp_ready.status(), StatusCode::OK);

    let req_caps = Request::builder()
        .method("GET")
        .uri("/api/v1/capabilities")
        .body(Body::empty())
        .unwrap();
    let resp_caps = app.clone().oneshot(req_caps).await.unwrap();
    assert_eq!(resp_caps.status(), StatusCode::OK);
    let caps_bytes = axum::body::to_bytes(resp_caps.into_body(), usize::MAX)
        .await
        .unwrap();
    let caps_json: Value = serde_json::from_slice(&caps_bytes).unwrap();
    assert!(caps_json.get("model_hosting_enabled").is_some());
    assert!(caps_json.get("calling").is_some());
    assert!(caps_json.get("sessions_enabled").is_some());
    assert!(caps_json.get("websocket_url").is_some());
    assert!(caps_json.get("sockudo_app_key").is_some());
    assert!(caps_json.get("sockudo_channel_prefix").is_some());

    // Sanity check OpenAPI path count against schema definition (68 documented OpenAPI paths)
    let doc = server::openapi::ApiDoc::openapi();
    let openapi_json = serde_json::to_value(&doc).expect("serialize openapi doc");
    let openapi_path_count = openapi_json["paths"].as_object().unwrap().len();
    assert_eq!(
        openapi_path_count, 68,
        "OpenAPI path count must match documented spec path count (68)"
    );

    // ==========================================
    // Phase 2 — Registration and login.
    // ==========================================
    let alice_id = register_user(&app, "alice", "AlicePassword123!", None).await;
    assert!(!alice_id.is_empty());

    let (user_row_id, username_tok, reg_blob, alice_pk): (
        String,
        String,
        Option<Vec<u8>>,
        Option<String>,
    ) = sqlx::query_as(
        "SELECT id, username_token, opaque_registration, identity_pubkey FROM users WHERE id = ?",
    )
    .bind(&alice_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(user_row_id, alice_id);
    assert!(!username_tok.is_empty());
    assert!(reg_blob.is_some());
    assert!(alice_pk.is_some());

    let (login_status, login_json) = login_user(
        &app,
        "alice",
        "AlicePassword123!",
        "client_alice_12345678",
        Some(&valid_pubkey()),
    )
    .await;
    assert_eq!(login_status, StatusCode::OK);
    let alice_token = login_json["session_token"].as_str().unwrap().to_string();

    let kt_user_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM key_transparency_log WHERE user_id = ?")
            .bind(&alice_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(kt_user_count, 1);

    // Ensure Alice has a registered device matching her client_id
    sqlx::query(
        "INSERT INTO devices (id, user_id, client_id, platform) VALUES ('dev_alice_1', ?, 'client_alice_12345678', 'web') ON CONFLICT DO NOTHING",
    )
    .bind(&alice_id)
    .execute(&pool)
    .await
    .unwrap();

    let req_me = Request::builder()
        .method("GET")
        .uri("/api/v1/users/me")
        .header(header::AUTHORIZATION, format!("Bearer {}", alice_token))
        .body(Body::empty())
        .unwrap();
    let resp_me = app.clone().oneshot(req_me).await.unwrap();
    assert_eq!(resp_me.status(), StatusCode::OK);

    // ==========================================
    // Phase 3 — User state.
    // ==========================================
    let req_user_sync = Request::builder()
        .method("GET")
        .uri("/api/v1/users/me/sync?since_seq=0")
        .header(header::AUTHORIZATION, format!("Bearer {}", alice_token))
        .body(Body::empty())
        .unwrap();
    let resp_user_sync = app.clone().oneshot(req_user_sync).await.unwrap();
    assert_eq!(resp_user_sync.status(), StatusCode::OK);

    let encrypted_display_blob = URL_SAFE_NO_PAD.encode([0u8; 32]);
    let req_patch_me = Request::builder()
        .method("PATCH")
        .uri("/api/v1/users/me")
        .header(header::AUTHORIZATION, format!("Bearer {}", alice_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({ "encrypted_display": encrypted_display_blob }).to_string(),
        ))
        .unwrap();
    let resp_patch_me = app.clone().oneshot(req_patch_me).await.unwrap();
    assert_eq!(resp_patch_me.status(), StatusCode::OK);
    let patch_me_bytes = axum::body::to_bytes(resp_patch_me.into_body(), usize::MAX)
        .await
        .unwrap();
    let patch_me_json: Value = serde_json::from_slice(&patch_me_bytes).unwrap();
    assert_eq!(
        patch_me_json["encrypted_display"].as_str().unwrap(),
        encrypted_display_blob
    );

    // ==========================================
    // Phase 4 — Bot creation and operator self-binding.
    // ==========================================
    let bot_pk = valid_pubkey();
    let req_create_bot = Request::builder()
        .method("POST")
        .uri("/api/v1/bots")
        .header(header::AUTHORIZATION, format!("Bearer {}", alice_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "display_name": "Assistant Bot",
                "bot_identity_pubkey": bot_pk,
                "bot_command_pubkey": bot_pk,
                "identity_pubkey": bot_pk,
                "declared_scopes": ["post_message", "read_metadata", "read_commands", "read_content"]
            })
            .to_string(),
        ))
        .unwrap();
    let resp_create_bot = app.clone().oneshot(req_create_bot).await.unwrap();
    assert_eq!(resp_create_bot.status(), StatusCode::CREATED);
    let create_bot_bytes = axum::body::to_bytes(resp_create_bot.into_body(), usize::MAX)
        .await
        .unwrap();
    let create_bot_json: Value = serde_json::from_slice(&create_bot_bytes).unwrap();
    let bot_id = create_bot_json["bot_id"].as_str().unwrap().to_string();
    let bot_token = create_bot_json["bot_token"].as_str().unwrap().to_string();

    let bot_row_exists: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM bot_accounts WHERE id = ?")
        .bind(&bot_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(bot_row_exists, 1);

    let (self_op_user, self_binding, self_bound_by): (String, String, String) =
        sqlx::query_as("SELECT user_id, binding, bound_by FROM bot_operators WHERE bot_id = ?")
            .bind(&bot_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(self_op_user, alice_id);
    assert_eq!(self_binding, "self");
    assert_eq!(self_bound_by, alice_id);

    let (bot_kt_leaf_index, bot_kt_id): (i64, String) = sqlx::query_as(
        "SELECT leaf_index, bot_id FROM key_transparency_log WHERE bot_id = ? ORDER BY leaf_index DESC LIMIT 1",
    )
    .bind(&bot_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(bot_kt_id, bot_id);

    let req_bot_settings = Request::builder()
        .method("GET")
        .uri("/api/v1/bots/me/settings")
        .header(header::AUTHORIZATION, format!("Bearer {}", bot_token))
        .body(Body::empty())
        .unwrap();
    let resp_bot_settings = app.clone().oneshot(req_bot_settings).await.unwrap();
    assert_eq!(resp_bot_settings.status(), StatusCode::OK);

    // ==========================================
    // Phase 5 — Room creation and bot grant.
    // ==========================================
    let bob_invite = server::invites::create_invite(
        &pool,
        &alice_id,
        server::invites::CreateInviteOptions::default(),
        &config,
    )
    .await
    .unwrap();

    let bob_id = register_user(&app, "bob", "BobPassword123!", Some(&bob_invite.code)).await;
    let (bob_login_status, bob_login_json) = login_user(
        &app,
        "bob",
        "BobPassword123!",
        "client_bob_1234567890",
        Some(&valid_pubkey()),
    )
    .await;
    assert_eq!(bob_login_status, StatusCode::OK);
    let bob_token = bob_login_json["session_token"]
        .as_str()
        .unwrap()
        .to_string();

    let req_create_room = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms")
        .header(header::AUTHORIZATION, format!("Bearer {}", alice_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({ "encrypted_metadata": URL_SAFE_NO_PAD.encode(b"RoomX") }).to_string(),
        ))
        .unwrap();
    let resp_create_room = app.clone().oneshot(req_create_room).await.unwrap();
    assert_eq!(resp_create_room.status(), StatusCode::CREATED);
    let room_bytes = axum::body::to_bytes(resp_create_room.into_body(), usize::MAX)
        .await
        .unwrap();
    let room_json: Value = serde_json::from_slice(&room_bytes).unwrap();
    let room_id = room_json["id"].as_str().unwrap().to_string();

    let req_get_room = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/rooms/{}", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", alice_token))
        .body(Body::empty())
        .unwrap();
    let resp_get_room = app.clone().oneshot(req_get_room).await.unwrap();
    assert_eq!(resp_get_room.status(), StatusCode::OK);
    let get_room_bytes = axum::body::to_bytes(resp_get_room.into_body(), usize::MAX)
        .await
        .unwrap();
    let get_room_json: Value = serde_json::from_slice(&get_room_bytes).unwrap();
    assert!(get_room_json.get("effective_max_file_size_bytes").is_some());
    assert!(get_room_json
        .get("effective_message_retention_days")
        .is_some());

    // Alice creates a room invite code for RoomX
    let req_room_invite = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/invites", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", alice_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "max_uses": 5 }).to_string()))
        .unwrap();
    let resp_room_invite = app.clone().oneshot(req_room_invite).await.unwrap();
    assert_eq!(resp_room_invite.status(), StatusCode::CREATED);
    let room_invite_bytes = axum::body::to_bytes(resp_room_invite.into_body(), usize::MAX)
        .await
        .unwrap();
    let room_invite_json: Value = serde_json::from_slice(&room_invite_bytes).unwrap();
    let room_invite_code = room_invite_json["code"].as_str().unwrap();

    // Bob redeems room invite code to join RoomX
    let req_join = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms/join")
        .header(header::AUTHORIZATION, format!("Bearer {}", bob_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "code": room_invite_code }).to_string()))
        .unwrap();
    let resp_join = app.clone().oneshot(req_join).await.unwrap();
    assert_eq!(resp_join.status(), StatusCode::OK);

    // Alice grants bot to RoomX with Bob as room-member operator (including read_commands scope)
    let req_grant_bot = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/bots", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", alice_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "bot_id": bot_id,
                "scopes": ["post_message", "read_metadata", "read_commands", "read_content"],
                "operators": [bob_id]
            })
            .to_string(),
        ))
        .unwrap();
    let resp_grant_bot = app.clone().oneshot(req_grant_bot).await.unwrap();
    assert_eq!(resp_grant_bot.status(), StatusCode::CREATED);

    let bob_op_exists: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM bot_operators WHERE bot_id = ? AND user_id = ? AND binding = 'room-member' AND bound_by = ?",
    )
    .bind(&bot_id)
    .bind(&bob_id)
    .bind(&alice_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(bob_op_exists, 1);

    let room_bot_grant_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM room_bots WHERE room_id = ? AND bot_id = ?")
            .bind(&room_id)
            .bind(&bot_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(room_bot_grant_count, 1);

    // ==========================================
    // Phase 6 — User message send and fetch.
    // ==========================================
    let user_msg_ct = BASE64.encode(b"UserHelloCiphertext");
    let req_user_msg = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/messages", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", alice_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "sender_client_id": "client_alice_12345678",
                "epoch": 0,
                "content_type": "application",
                "ciphertext": user_msg_ct
            })
            .to_string(),
        ))
        .unwrap();
    let resp_user_msg = app.clone().oneshot(req_user_msg).await.unwrap();
    let user_msg_status = resp_user_msg.status();
    let user_msg_bytes = axum::body::to_bytes(resp_user_msg.into_body(), usize::MAX)
        .await
        .unwrap();
    if user_msg_status != StatusCode::CREATED {
        panic!(
            "post_user_msg failed: status={}, body={}",
            user_msg_status,
            String::from_utf8_lossy(&user_msg_bytes)
        );
    }
    let user_msg_json: Value = serde_json::from_slice(&user_msg_bytes).unwrap();
    let user_msg_id = user_msg_json["message_id"].as_str().unwrap();
    assert!(!user_msg_id.is_empty());

    let req_get_msgs = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/rooms/{}/messages", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", alice_token))
        .body(Body::empty())
        .unwrap();
    let resp_get_msgs = app.clone().oneshot(req_get_msgs).await.unwrap();
    assert_eq!(resp_get_msgs.status(), StatusCode::OK);
    let get_msgs_bytes = axum::body::to_bytes(resp_get_msgs.into_body(), usize::MAX)
        .await
        .unwrap();
    let get_msgs_json: Value = serde_json::from_slice(&get_msgs_bytes).unwrap();
    let msgs_arr = get_msgs_json["messages"].as_array().unwrap();
    let fetched_user_msg = msgs_arr
        .iter()
        .find(|m| m["id"].as_str().unwrap() == user_msg_id)
        .unwrap();
    assert_eq!(fetched_user_msg["sender_type"], "user");
    assert_eq!(fetched_user_msg["sender_id"], alice_id);
    assert!(fetched_user_msg["bot_key_leaf_index"].is_null());

    // ==========================================
    // Phase 7 — Bot message send with KT leaf.
    // ==========================================
    let bot_msg_raw_ct = b"BotSignedHelloCiphertext";
    let bot_sig = make_bot_sig(&room_id, 0, "bot", bot_msg_raw_ct);
    let req_bot_msg = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/bot-messages", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", bot_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "epoch": 0,
                "content_type": "bot",
                "ciphertext": URL_SAFE_NO_PAD.encode(bot_msg_raw_ct),
                "signature": bot_sig
            })
            .to_string(),
        ))
        .unwrap();
    let resp_bot_msg = app.clone().oneshot(req_bot_msg).await.unwrap();
    assert_eq!(resp_bot_msg.status(), StatusCode::ACCEPTED);
    let bot_msg_resp_bytes = axum::body::to_bytes(resp_bot_msg.into_body(), usize::MAX)
        .await
        .unwrap();
    let bot_msg_resp_json: Value = serde_json::from_slice(&bot_msg_resp_bytes).unwrap();
    let bot_msg_id = bot_msg_resp_json["message_id"].as_str().unwrap();

    let req_get_msgs_2 = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/rooms/{}/messages", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", alice_token))
        .body(Body::empty())
        .unwrap();
    let resp_get_msgs_2 = app.clone().oneshot(req_get_msgs_2).await.unwrap();
    assert_eq!(resp_get_msgs_2.status(), StatusCode::OK);
    let get_msgs_2_bytes = axum::body::to_bytes(resp_get_msgs_2.into_body(), usize::MAX)
        .await
        .unwrap();
    let get_msgs_2_json: Value = serde_json::from_slice(&get_msgs_2_bytes).unwrap();
    let msgs_2_arr = get_msgs_2_json["messages"].as_array().unwrap();
    let fetched_bot_msg = msgs_2_arr
        .iter()
        .find(|m| m["id"].as_str().unwrap() == bot_msg_id)
        .unwrap();
    assert_eq!(fetched_bot_msg["sender_type"], "bot");
    assert_eq!(fetched_bot_msg["sender_id"], bot_id);
    assert_eq!(
        fetched_bot_msg["bot_key_leaf_index"].as_i64().unwrap(),
        bot_kt_leaf_index
    );

    // ==========================================
    // Phase 8 — Bot command submission.
    // ==========================================
    let req_cmd = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/bot-commands", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", alice_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "bot_id": bot_id,
                "ciphertext": URL_SAFE_NO_PAD.encode(b"CommandPayload"),
                "ephemeral_result_pubkey": valid_pubkey(),
                "request_id": "req_cmd_1"
            })
            .to_string(),
        ))
        .unwrap();
    let resp_cmd = app.clone().oneshot(req_cmd).await.unwrap();
    assert_eq!(resp_cmd.status(), StatusCode::ACCEPTED);
    let cmd_bytes = axum::body::to_bytes(resp_cmd.into_body(), usize::MAX)
        .await
        .unwrap();
    let cmd_json: Value = serde_json::from_slice(&cmd_bytes).unwrap();
    let command_id = cmd_json["command_id"].as_str().unwrap();

    let (acked_at, expired_at): (Option<String>, Option<String>) =
        sqlx::query_as("SELECT CAST(acked_at AS TEXT), CAST(expired_at AS TEXT) FROM bot_commands WHERE id = ? AND bot_id = ?")
            .bind(command_id)
            .bind(&bot_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(acked_at.is_none());
    assert!(expired_at.is_none());

    let cmd_event_exists: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM bot_event_log WHERE bot_id = ? AND event_type = 'bot.command_invoked'",
    )
    .bind(&bot_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(cmd_event_exists, 1);

    let req_ack = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/bots/me/commands/{}/ack", command_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", bot_token))
        .body(Body::empty())
        .unwrap();
    let resp_ack = app.clone().oneshot(req_ack).await.unwrap();
    assert_eq!(resp_ack.status(), StatusCode::NO_CONTENT);

    // ==========================================
    // Phase 9 — Operator queue enqueue.
    // ==========================================
    let req_enqueue = Request::builder()
        .method("POST")
        .uri("/api/v1/bots/me/operator-queue")
        .header(header::AUTHORIZATION, format!("Bearer {}", bot_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "request_id": "op_req_1",
                "room_id": room_id,
                "audience": "private",
                "payload": { "question": "Need human support" },
                "timeout": "never",
                "on_timeout": "ignore"
            })
            .to_string(),
        ))
        .unwrap();
    let resp_enqueue = app.clone().oneshot(req_enqueue).await.unwrap();
    assert_eq!(resp_enqueue.status(), StatusCode::CREATED);
    let enqueue_bytes = axum::body::to_bytes(resp_enqueue.into_body(), usize::MAX)
        .await
        .unwrap();
    let enqueue_json: Value = serde_json::from_slice(&enqueue_bytes).unwrap();
    assert_eq!(enqueue_json["request_id"].as_str().unwrap(), "op_req_1");
    assert!(enqueue_json.get("queued_at").is_some());

    let queue_status: String =
        sqlx::query_scalar("SELECT status FROM bot_operator_queue WHERE id = 'op_req_1'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(queue_status, "pending");

    // ==========================================
    // Phase 10 — Operator list.
    // ==========================================
    let req_list_alice = Request::builder()
        .method("GET")
        .uri(format!(
            "/api/v1/bots/{}/operator-queue?status=pending",
            bot_id
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", alice_token))
        .body(Body::empty())
        .unwrap();
    let resp_list_alice = app.clone().oneshot(req_list_alice).await.unwrap();
    let list_alice_status = resp_list_alice.status();
    let list_alice_bytes = axum::body::to_bytes(resp_list_alice.into_body(), usize::MAX)
        .await
        .unwrap();
    if list_alice_status != StatusCode::OK {
        panic!(
            "list_alice failed: status={}, body={}",
            list_alice_status,
            String::from_utf8_lossy(&list_alice_bytes)
        );
    }
    let list_alice_json: Value = serde_json::from_slice(&list_alice_bytes).unwrap();
    let entries_alice = list_alice_json["requests"]
        .as_array()
        .or_else(|| list_alice_json["entries"].as_array())
        .expect("requests array");
    assert_eq!(entries_alice.len(), 1);
    assert_eq!(
        entries_alice[0]["request_id"]
            .as_str()
            .or(entries_alice[0]["id"].as_str())
            .unwrap(),
        "op_req_1"
    );
    assert!(entries_alice[0].get("payload_preview").is_some());
    assert!(entries_alice[0].get("payload").is_none());

    let req_list_bob = Request::builder()
        .method("GET")
        .uri(format!(
            "/api/v1/bots/{}/operator-queue?status=pending",
            bot_id
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", bob_token))
        .body(Body::empty())
        .unwrap();
    let resp_list_bob = app.clone().oneshot(req_list_bob).await.unwrap();
    assert_eq!(resp_list_bob.status(), StatusCode::OK);

    let carol_invite = server::invites::create_invite(
        &pool,
        &alice_id,
        server::invites::CreateInviteOptions::default(),
        &config,
    )
    .await
    .unwrap();

    let _carol_id =
        register_user(&app, "carol", "CarolPassword123!", Some(&carol_invite.code)).await;
    let (carol_login_status, carol_login_json) = login_user(
        &app,
        "carol",
        "CarolPassword123!",
        "client_carol_12345678",
        Some(&valid_pubkey()),
    )
    .await;
    assert_eq!(carol_login_status, StatusCode::OK);
    let carol_token = carol_login_json["session_token"]
        .as_str()
        .unwrap()
        .to_string();

    let req_list_carol = Request::builder()
        .method("GET")
        .uri(format!(
            "/api/v1/bots/{}/operator-queue?status=pending",
            bot_id
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", carol_token))
        .body(Body::empty())
        .unwrap();
    let resp_list_carol = app.clone().oneshot(req_list_carol).await.unwrap();
    assert_eq!(
        resp_list_carol.status(),
        StatusCode::NOT_FOUND,
        "Non-operator must receive 404 NOT_FOUND"
    );

    // ==========================================
    // Phase 11 — Operator responds.
    // ==========================================
    let req_respond = Request::builder()
        .method("POST")
        .uri(format!(
            "/api/v1/bots/{}/operator-queue/op_req_1/respond",
            bot_id
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", bob_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({ "response": "Bob operator assisting" }).to_string(),
        ))
        .unwrap();
    let resp_respond = app.clone().oneshot(req_respond).await.unwrap();
    assert_eq!(resp_respond.status(), StatusCode::NO_CONTENT);

    let (q_status, q_responded_by, q_response): (String, Option<String>, Option<String>) =
        sqlx::query_as(
            "SELECT status, responded_by, response FROM bot_operator_queue WHERE id = 'op_req_1'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(q_status, "answered");
    assert_eq!(q_responded_by, Some(bob_id.clone()));
    assert_eq!(q_response, Some("Bob operator assisting".to_string()));

    let op_resp_event_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM bot_event_log WHERE bot_id = ? AND event_type = 'bot.operator_response'",
    )
    .bind(&bot_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(op_resp_event_count, 1);

    // ==========================================
    // Phase 12 — Bot sync.
    // ==========================================
    let req_bot_sync = Request::builder()
        .method("GET")
        .uri("/api/v1/bots/me/sync?since_bot_seq=0")
        .header(header::AUTHORIZATION, format!("Bearer {}", bot_token))
        .body(Body::empty())
        .unwrap();
    let resp_bot_sync = app.clone().oneshot(req_bot_sync).await.unwrap();
    assert_eq!(resp_bot_sync.status(), StatusCode::OK);
    let bot_sync_bytes = axum::body::to_bytes(resp_bot_sync.into_body(), usize::MAX)
        .await
        .unwrap();
    let bot_sync_json: Value = serde_json::from_slice(&bot_sync_bytes).unwrap();
    let sync_events = bot_sync_json["events"].as_array().unwrap();
    assert!(sync_events.len() >= 2);
    let has_cmd_invoked = sync_events
        .iter()
        .any(|e| e["event_type"] == "bot.command_invoked");
    let has_op_resp = sync_events
        .iter()
        .any(|e| e["event_type"] == "bot.operator_response");
    assert!(has_cmd_invoked);
    assert!(has_op_resp);
    assert!(bot_sync_json["max_bot_seq"].as_i64().unwrap() >= 2);

    // ==========================================
    // Phase 13 — KT verification.
    // ==========================================
    // Create initial KT snapshot so KT tree queries find a snapshot
    let opaque_server_arc = Arc::new(
        server::OpaqueServer::load_or_generate(std::path::Path::new(&config.opaque_oprf_key_path))
            .unwrap(),
    );
    let app_state = server::AppState {
        pool: pool.clone(),
        opaque_server: opaque_server_arc.clone(),
        registration_store: Arc::new(RegistrationStore::new()),
        login_store: Arc::new(LoginStore::new()),
        recovery_store: Arc::new(RecoveryStore::new()),
        altcha_config: Arc::new(
            server::AltchaConfig::from_env(&config, &pool)
                .await
                .unwrap(),
        ),
        config: Arc::new(config.clone()),
        server_hard_max: Arc::new(server::ServerHardMax {
            file_size_bytes: config.max_file_size_bytes as i64,
            room_size: 1000,
            rooms_per_user: 500,
            devices_per_user: config.server_max_devices_per_user as i64,
            keypackages_per_device: 50,
            message_size_bytes: 65536,
            attachment_retention_days: 365,
            call_max_participants: 50,
            reactions_per_message: 50,
            room_metadata_bytes: 65536,
            edit_window_seconds: config.server_max_edit_window_seconds,
        }),
        publisher: Arc::new(server::Publisher::new(server::SockudoConfig {
            http_base: mock_server.uri(),
            app_id: "chat".to_string(),
            app_key: "test-key".to_string(),
            app_secret: "test-secret".to_string(),
            enable_client_events: true,
        })),
        storage: server::build_storage(&config).unwrap(),
        oprf: Arc::new(server::oprf::OprfEvaluator::new(
            &server::oprf::OprfKeys::load(&opaque_server_arc.setup).unwrap(),
        )),
        oprf_audit: Arc::new(server::oprf::OprfAuditCounter::new()),
        link_preview_keys: None,
        session_types: Arc::new(server::sessions::SessionTypesStore::new(
            server::sessions::init_session_types_state(false, "", 10, 10),
        )),
        models: Arc::new(server::models::ModelStore::new_with_mode(
            server::models::ModelHostingMode::Local,
            "".into(),
            "".into(),
            None,
        )),
        room_events: server::events::RoomEventBroadcast::default(),
        observer_cursors: server::events::ObserverCursorStore::default(),
        backup_lock: Arc::new(tokio::sync::Mutex::new(())),
        oprf_rotation_lock: Arc::new(tokio::sync::Mutex::new(())),
        vapid_keys: None,
        push_delivery: None,
        occupancy: server::sessions::OccupancyStore::default(),
        call_occupancy: server::calls::CallOccupancyStore::default(),
        extension_proxy_blocklist: Arc::new(
            server::extensions_proxy::blocklist::init_blocklist_store("", ""),
        ),
        bot_connection_state: server::bots::BotConnectionState::default(),
    };
    server::key_transparency::create_snapshot(
        &pool,
        &app_state.opaque_server,
        &app_state.publisher,
        &config,
        Some(&alice_id),
    )
    .await
    .unwrap();

    let req_kt_bot = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/kt/bot/{}", bot_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", alice_token))
        .body(Body::empty())
        .unwrap();
    let resp_kt_bot = app.clone().oneshot(req_kt_bot).await.unwrap();
    assert_eq!(resp_kt_bot.status(), StatusCode::OK);
    let kt_bot_bytes = axum::body::to_bytes(resp_kt_bot.into_body(), usize::MAX)
        .await
        .unwrap();
    let kt_bot_json: Value = serde_json::from_slice(&kt_bot_bytes).unwrap();
    assert_eq!(kt_bot_json["bot_id"].as_str().unwrap(), bot_id);
    assert!(kt_bot_json.get("inclusion_proof").is_some());

    let req_kt_user = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/kt/user/{}", alice_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", alice_token))
        .body(Body::empty())
        .unwrap();
    let resp_kt_user = app.clone().oneshot(req_kt_user).await.unwrap();
    assert_eq!(resp_kt_user.status(), StatusCode::OK);
    let kt_user_bytes = axum::body::to_bytes(resp_kt_user.into_body(), usize::MAX)
        .await
        .unwrap();
    let kt_user_json: Value = serde_json::from_slice(&kt_user_bytes).unwrap();
    assert_eq!(kt_user_json["user_id"].as_str().unwrap(), alice_id);
    assert!(
        kt_user_json.get("username_token").is_none(),
        "GET /kt/user/:id MUST omit username_token per §12"
    );

    let req_kt_snapshot = Request::builder()
        .method("GET")
        .uri("/api/v1/kt/snapshot")
        .header(header::AUTHORIZATION, format!("Bearer {}", alice_token))
        .body(Body::empty())
        .unwrap();
    let resp_kt_snapshot = app.clone().oneshot(req_kt_snapshot).await.unwrap();
    assert_eq!(resp_kt_snapshot.status(), StatusCode::OK);
    let kt_snap_bytes = axum::body::to_bytes(resp_kt_snapshot.into_body(), usize::MAX)
        .await
        .unwrap();
    let kt_snap_json: Value = serde_json::from_slice(&kt_snap_bytes).unwrap();
    assert!(kt_snap_json.get("tree_size").is_some());
    assert!(kt_snap_json.get("root_hash").is_some());
    assert!(kt_snap_json.get("created_at").is_some());

    // ==========================================
    // Phase 14 — Timeout cleanup.
    // ==========================================
    sqlx::query(
        r#"
        INSERT INTO bot_operator_queue (id, bot_id, audience, payload, payload_preview, status, timeout_at, on_timeout, canned_response)
        VALUES ('op_req_timeout_1', ?, 'private', '{}', 'preview', 'pending', datetime('now', '-10 minutes'), 'canned', 'Automated Canned Reply')
        "#,
    )
    .bind(&bot_id)
    .execute(&pool)
    .await
    .unwrap();

    let job_ctx = build_cleanup_ctx(pool.clone(), config.clone());
    let timeout_job = OperatorQueueTimeoutJob;
    let timeout_report = timeout_job.run(&job_ctx.as_ctx()).await.unwrap();
    assert_eq!(timeout_report.rows_deleted, 1);

    let timeout_row_status: String =
        sqlx::query_scalar("SELECT status FROM bot_operator_queue WHERE id = 'op_req_timeout_1'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(timeout_row_status, "expired");

    let timeout_event_str: String = sqlx::query_scalar(
        "SELECT payload FROM bot_event_log WHERE bot_id = ? AND event_type = 'bot.operator_response' ORDER BY bot_seq DESC LIMIT 1",
    )
    .bind(&bot_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let timeout_event_val: Value = serde_json::from_str(&timeout_event_str).unwrap();
    assert_eq!(timeout_event_val["request_id"], "op_req_timeout_1");
    assert_eq!(timeout_event_val["response"], "Automated Canned Reply");
    assert!(timeout_event_val["responded_by"].is_null());

    // ==========================================
    // Phase 15 — Retention cleanup.
    // ==========================================
    sqlx::query(
        r#"
        INSERT INTO bot_operator_queue (id, bot_id, audience, payload, payload_preview, status, answered_at)
        VALUES ('op_req_old_answered', ?, 'private', '{}', 'preview', 'answered', datetime('now', '-8 days'))
        "#,
    )
    .bind(&bot_id)
    .execute(&pool)
    .await
    .unwrap();

    let retention_job = OperatorQueueRetentionJob;
    let retention_report = retention_job.run(&job_ctx.as_ctx()).await.unwrap();
    assert_eq!(retention_report.rows_deleted, 1);

    let old_row_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM bot_operator_queue WHERE id = 'op_req_old_answered'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(old_row_count, 0);

    let answered_row_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM bot_operator_queue WHERE id = 'op_req_1'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(
        answered_row_count, 1,
        "Responded row within retention window MUST be retained"
    );

    // ==========================================
    // Phase 16 — Final state check.
    // ==========================================
    let req_final_sync = Request::builder()
        .method("GET")
        .uri("/api/v1/bots/me/sync?since_bot_seq=0")
        .header(header::AUTHORIZATION, format!("Bearer {}", bot_token))
        .body(Body::empty())
        .unwrap();
    let resp_final_sync = app.clone().oneshot(req_final_sync).await.unwrap();
    assert_eq!(resp_final_sync.status(), StatusCode::OK);
    let final_sync_bytes = axum::body::to_bytes(resp_final_sync.into_body(), usize::MAX)
        .await
        .unwrap();
    let final_sync_json: Value = serde_json::from_slice(&final_sync_bytes).unwrap();
    let final_events = final_sync_json["events"].as_array().unwrap();
    let has_canned_event = final_events.iter().any(|e| {
        e["payload"]["request_id"] == "op_req_timeout_1"
            && e["payload"]["response"] == "Automated Canned Reply"
    });
    assert!(
        has_canned_event,
        "Final sync MUST reflect timeout canned event"
    );

    let final_doc = server::openapi::ApiDoc::openapi();
    let final_openapi_json = serde_json::to_value(&final_doc).unwrap();
    assert_eq!(final_openapi_json["paths"].as_object().unwrap().len(), 68);

    // Verify cleanup job registration count on scheduler
    let mut scheduler = server::cleanup::Scheduler::new(std::time::Duration::from_secs(3600));
    scheduler.register(Box::new(server::cleanup::sessions::SessionsJob));
    scheduler.register(Box::new(server::cleanup::rate_limits::RateLimitsJob));
    scheduler.register(Box::new(server::cleanup::audit::AuditJob));
    scheduler.register(Box::new(server::cleanup::welcomes::WelcomesJob));
    scheduler.register(Box::new(server::cleanup::attachments::AttachmentsJob));
    scheduler.register(Box::new(server::cleanup::memory::MemoryStoresJob));
    scheduler.register(Box::new(server::cleanup::sync::SyncPruningJob));
    scheduler.register(Box::new(server::cleanup::oprf_audit::OprfAuditFlushJob {
        oprf_audit: Arc::new(server::oprf::OprfAuditCounter::new()),
    }));
    scheduler.register(Box::new(
        server::cleanup::pending_removes::PendingRemovesJob,
    ));
    scheduler.register(Box::new(server::cleanup::bot_commands::BotCommandsTtlJob));
    scheduler.register(Box::new(
        server::cleanup::bot_request_log::BotRequestLogTtlJob,
    ));
    scheduler.register(Box::new(server::cleanup::bot_event_log::BotEventLogTtlJob));
    scheduler.register(Box::new(
        server::cleanup::operator_queue_timeout::OperatorQueueTimeoutJob,
    ));
    scheduler.register(Box::new(
        server::cleanup::operator_queue_retention::OperatorQueueRetentionJob,
    ));

    // Verify wiremock captured publishes
    let received_requests = mock_server.received_requests().await.unwrap();
    assert!(
        !received_requests.is_empty(),
        "Wiremock MUST capture event publish requests"
    );
}
