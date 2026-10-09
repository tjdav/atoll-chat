mod common;

use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use axum::Router;
use common::{login_user, register_user};
use serde_json::{json, Value};
use server::calls::CallOccupancyStore;
use sqlx::SqlitePool;
use std::path::Path;
use std::sync::Arc;
use tower::ServiceExt;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

async fn setup_test_app(
    calling_enabled: bool,
) -> (Router, SqlitePool, MockServer, CallOccupancyStore) {
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
        calling_enabled,
        sockudo_url: mock_server.uri(),
        sockudo_app_key: "test-app-key".to_string(),
        sockudo_app_secret: "test-app-secret".to_string(),
        ..server::Config::test_default()
    };

    let opaque_server = Arc::new(
        server::OpaqueServer::load_or_generate(Path::new("./data/test_oprf_call.key")).unwrap(),
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
    let call_occupancy = CallOccupancyStore::new();

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
        call_occupancy: call_occupancy.clone(),
        extension_proxy_blocklist: std::sync::Arc::new(
            server::extensions_proxy::blocklist::DomainBlocklistStore::new(Default::default()),
        ),
        bot_connection_state: server::bots::BotConnectionState::new(),
    };

    let app = server::build_app(state);
    (app, pool, mock_server, call_occupancy)
}

async fn create_test_user(
    app: &Router,
    pool: &SqlitePool,
    username: &str,
    client_id: &str,
) -> (String, String) {
    let has_users: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM users)")
        .fetch_one(pool)
        .await
        .unwrap();

    let invite_code = if has_users {
        let code = format!("INV_{}", username);
        sqlx::query(
            "INSERT INTO server_invites (id, code, max_uses, current_uses) VALUES (?, ?, 10, 0)",
        )
        .bind(format!("inv_id_{}", username))
        .bind(&code)
        .execute(pool)
        .await
        .unwrap();
        Some(code)
    } else {
        None
    };

    let user_id = register_user(app, username, "Password123!", invite_code.as_deref()).await;
    let (status, login_res) = login_user(app, username, "Password123!", client_id, None).await;
    if status != StatusCode::OK {
        panic!(
            "login_user failed for {}: status={}, res={:?}",
            username, status, login_res
        );
    }
    let token = login_res["session_token"].as_str().unwrap().to_string();

    (user_id, token)
}

async fn create_room(app: &Router, token: &str) -> String {
    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({}).to_string()))
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body).unwrap();
    json["id"].as_str().unwrap().to_string()
}

async fn add_member(app: &Router, owner_token: &str, room_id: &str, user_id: &str) {
    let req = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/members", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", owner_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "user_id": user_id }).to_string()))
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED);
}

// -----------------------------------------------------------------------------
// Occupancy Store Helper Tests
// -----------------------------------------------------------------------------

#[tokio::test]
async fn test_occupancy_store_helpers() {
    let store = CallOccupancyStore::new();
    let call_id = "c_test_occupancy";

    assert!(!store.is_participant(call_id, "u_alice").await);

    // 1. add_client
    store
        .add_client(call_id, "u_alice", "c_alice_dev_10000001")
        .await;
    store
        .add_client(call_id, "u_alice", "c_alice_dev_10000002")
        .await;
    store
        .add_client(call_id, "u_bob", "c_bob_dev_100000001")
        .await;

    assert!(store.is_participant(call_id, "u_alice").await);
    assert!(store.is_participant(call_id, "u_bob").await);
    assert!(!store.is_participant(call_id, "u_charlie").await);

    assert_eq!(
        store
            .find_user_for_client(call_id, "c_alice_dev_10000001")
            .await,
        Some("u_alice".to_string())
    );
    assert_eq!(
        store
            .find_user_for_client(call_id, "c_alice_dev_10000002")
            .await,
        Some("u_alice".to_string())
    );
    assert_eq!(
        store
            .find_user_for_client(call_id, "c_bob_dev_100000001")
            .await,
        Some("u_bob".to_string())
    );
    assert_eq!(store.find_user_for_client(call_id, "c_unknown").await, None);

    let participant_user_ids = store.participant_user_ids(call_id, "u_alice").await;
    assert_eq!(participant_user_ids, vec!["u_bob".to_string()]);

    // 2. remove_client
    store
        .remove_client(call_id, "u_alice", "c_alice_dev_10000001")
        .await;
    assert!(store.is_participant(call_id, "u_alice").await); // Still has c_alice_dev_10000002

    store
        .remove_client(call_id, "u_alice", "c_alice_dev_10000002")
        .await;
    assert!(!store.is_participant(call_id, "u_alice").await); // u_alice removed

    // 3. remove_user
    store.remove_user(call_id, "u_bob").await;
    assert!(!store.is_participant(call_id, "u_bob").await);

    // 4. clear_call
    store
        .add_client(call_id, "u_alice", "c_alice_dev_10000001")
        .await;
    store.clear_call(call_id).await;
    assert!(!store.is_participant(call_id, "u_alice").await);
}

// -----------------------------------------------------------------------------
// Signal Endpoint Tests
// -----------------------------------------------------------------------------

#[tokio::test]
async fn test_signal_unauthenticated_returns_401() {
    let (app, _pool, _mock, _occupancy) = setup_test_app(true).await;

    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms/r_1/calls/c_1/signal")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "sender_client_id": "c_alice_client_1001",
                "target_user_id": "u_bob",
                "target_client_id": "c_bob_client_10001",
                "envelope": "QUJDRA"
            })
            .to_string(),
        ))
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn test_signal_non_member_returns_404() {
    let (app, pool, _mock, _occupancy) = setup_test_app(true).await;
    let (_alice_id, alice_token) =
        create_test_user(&app, &pool, "alice_non_member", "client_alice_1000001").await;

    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms/r_nonexistent/calls/c_1/signal")
        .header(header::AUTHORIZATION, format!("Bearer {}", alice_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "sender_client_id": "client_alice_1000001",
                "target_user_id": "u_bob",
                "target_client_id": "c_bob_client_10001",
                "envelope": "QUJDRA"
            })
            .to_string(),
        ))
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn test_signal_calling_disabled_returns_501() {
    let (app, pool, _mock, _occupancy) = setup_test_app(false).await;
    let (_alice_id, alice_token) =
        create_test_user(&app, &pool, "alice_disabled", "client_alice_1000001").await;
    let room_id = create_room(&app, &alice_token).await;

    let req = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/calls/c_1/signal", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", alice_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "sender_client_id": "client_alice_1000001",
                "target_user_id": "u_bob",
                "target_client_id": "c_bob_client_10001",
                "envelope": "QUJDRA"
            })
            .to_string(),
        ))
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_IMPLEMENTED);
}

#[tokio::test]
async fn test_signal_caller_not_participant_returns_403() {
    let (app, pool, _mock, _occupancy) = setup_test_app(true).await;
    let (_alice_id, alice_token) =
        create_test_user(&app, &pool, "alice_not_part", "client_alice_1000001").await;
    let room_id = create_room(&app, &alice_token).await;

    let req = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/calls/c_1/signal", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", alice_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "sender_client_id": "client_alice_1000001",
                "target_user_id": "u_bob",
                "target_client_id": "c_bob_client_10001",
                "envelope": "QUJDRA"
            })
            .to_string(),
        ))
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn test_signal_sender_client_not_owned_returns_403() {
    let (app, pool, _mock, occupancy) = setup_test_app(true).await;
    let (alice_id, alice_token) =
        create_test_user(&app, &pool, "alice_unowned_dev", "client_alice_real101").await;
    let room_id = create_room(&app, &alice_token).await;
    let call_id = "c_1";

    // Seed alice into occupancy with client_alice_real101
    occupancy
        .add_client(call_id, &alice_id, "client_alice_real101")
        .await;

    // Request using client_alice_impostor
    let req = Request::builder()
        .method("POST")
        .uri(format!(
            "/api/v1/rooms/{}/calls/{}/signal",
            room_id, call_id
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", alice_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "sender_client_id": "client_alice_impostor",
                "target_user_id": "u_bob",
                "target_client_id": "c_bob_client_10001",
                "envelope": "QUJDRA"
            })
            .to_string(),
        ))
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn test_signal_target_not_found_returns_404() {
    let (app, pool, _mock, occupancy) = setup_test_app(true).await;
    let (alice_id, alice_token) =
        create_test_user(&app, &pool, "alice_target_missing", "client_alice_1000001").await;
    let room_id = create_room(&app, &alice_token).await;
    let call_id = "c_1";

    occupancy
        .add_client(call_id, &alice_id, "client_alice_1000001")
        .await;

    let req = Request::builder()
        .method("POST")
        .uri(format!(
            "/api/v1/rooms/{}/calls/{}/signal",
            room_id, call_id
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", alice_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "sender_client_id": "client_alice_1000001",
                "target_user_id": "u_bob",
                "target_client_id": "c_bob_missing_101",
                "envelope": "QUJDRA"
            })
            .to_string(),
        ))
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn test_signal_target_user_mismatch_returns_400() {
    let (app, pool, _mock, occupancy) = setup_test_app(true).await;
    let (alice_id, alice_token) =
        create_test_user(&app, &pool, "alice_mismatch", "client_alice_1000001").await;
    let (bob_id, _bob_token) =
        create_test_user(&app, &pool, "bob_mismatch", "client_bob_10000001").await;
    let room_id = create_room(&app, &alice_token).await;
    add_member(&app, &alice_token, &room_id, &bob_id).await;

    let call_id = "c_1";

    occupancy
        .add_client(call_id, &alice_id, "client_alice_1000001")
        .await;
    occupancy
        .add_client(call_id, &bob_id, "client_bob_10000001")
        .await;

    // Request specifying target_user_id = "u_charlie_wrong" instead of bob_id
    let req = Request::builder()
        .method("POST")
        .uri(format!(
            "/api/v1/rooms/{}/calls/{}/signal",
            room_id, call_id
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", alice_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "sender_client_id": "client_alice_1000001",
                "target_user_id": "u_charlie_wrong",
                "target_client_id": "client_bob_10000001",
                "envelope": "QUJDRA"
            })
            .to_string(),
        ))
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn test_signal_malformed_envelope_returns_400() {
    let (app, pool, _mock, occupancy) = setup_test_app(true).await;
    let (alice_id, alice_token) =
        create_test_user(&app, &pool, "alice_bad_env", "client_alice_1000001").await;
    let (bob_id, _bob_token) =
        create_test_user(&app, &pool, "bob_bad_env", "client_bob_10000001").await;
    let room_id = create_room(&app, &alice_token).await;
    add_member(&app, &alice_token, &room_id, &bob_id).await;

    let call_id = "c_1";

    occupancy
        .add_client(call_id, &alice_id, "client_alice_1000001")
        .await;
    occupancy
        .add_client(call_id, &bob_id, "client_bob_10000001")
        .await;

    // Invalid base64
    let req = Request::builder()
        .method("POST")
        .uri(format!(
            "/api/v1/rooms/{}/calls/{}/signal",
            room_id, call_id
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", alice_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "sender_client_id": "client_alice_1000001",
                "target_user_id": bob_id,
                "target_client_id": "client_bob_10000001",
                "envelope": "!!!NOT_BASE64!!!"
            })
            .to_string(),
        ))
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn test_signal_success_relay_and_no_seq_and_no_room_publish() {
    let (app, pool, mock_server, occupancy) = setup_test_app(true).await;
    let (alice_id, alice_token) =
        create_test_user(&app, &pool, "alice_success", "client_alice_1000001").await;
    let (bob_id, _bob_token) =
        create_test_user(&app, &pool, "bob_success", "client_bob_10000001").await;
    let room_id = create_room(&app, &alice_token).await;
    add_member(&app, &alice_token, &room_id, &bob_id).await;

    let call_id = "c_12345";

    occupancy
        .add_client(call_id, &alice_id, "client_alice_1000001")
        .await;
    occupancy
        .add_client(call_id, &bob_id, "client_bob_10000001")
        .await;

    // Capture initial user_seq for all users
    let initial_seq_alice: i64 =
        sqlx::query_scalar("SELECT next_seq FROM user_seq WHERE user_id = ?")
            .bind(&alice_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    let initial_seq_bob: i64 =
        sqlx::query_scalar("SELECT next_seq FROM user_seq WHERE user_id = ?")
            .bind(&bob_id)
            .fetch_one(&pool)
            .await
            .unwrap();

    let envelope_b64 = "ZXhhbXBsZS1lbmNyeXB0ZWQtZW52ZWxvcGUtY2lwaGVydGV4dA";

    let req = Request::builder()
        .method("POST")
        .uri(format!(
            "/api/v1/rooms/{}/calls/{}/signal",
            room_id, call_id
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", alice_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "sender_client_id": "client_alice_1000001",
                "target_user_id": bob_id,
                "target_client_id": "client_bob_10000001",
                "envelope": envelope_b64
            })
            .to_string(),
        ))
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    // Verify Cache-Control: no-store
    let cache_control = resp.headers().get(header::CACHE_CONTROL).unwrap();
    assert_eq!(cache_control, "no-store");

    let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let res_json: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(res_json["delivered_to"], 1);

    // Verify user_seq is unchanged
    let current_seq_alice: i64 =
        sqlx::query_scalar("SELECT next_seq FROM user_seq WHERE user_id = ?")
            .bind(&alice_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    let current_seq_bob: i64 =
        sqlx::query_scalar("SELECT next_seq FROM user_seq WHERE user_id = ?")
            .bind(&bob_id)
            .fetch_one(&pool)
            .await
            .unwrap();

    assert_eq!(initial_seq_alice, current_seq_alice);
    assert_eq!(initial_seq_bob, current_seq_bob);

    // Verify Sockudo received mock publish
    let requests = mock_server.received_requests().await.unwrap();
    assert!(!requests.is_empty());

    let mut found_user_signal = false;
    let mut found_room_signal = false;

    for r in requests {
        let path = r.url.path();
        if path.contains("/apps/chat/events") {
            let body_json: Value = serde_json::from_slice(&r.body).unwrap();
            let channels = body_json["channels"]
                .as_array()
                .and_then(|a| a.first())
                .and_then(|v| v.as_str())
                .or_else(|| body_json["channel"].as_str())
                .unwrap_or("");
            let name = body_json["name"].as_str().unwrap_or("");

            if name == "call.signal" {
                if channels == format!("private-user-{}", bob_id) {
                    found_user_signal = true;
                    let payload: Value =
                        serde_json::from_str(body_json["data"].as_str().unwrap()).unwrap();
                    assert_eq!(payload["call_id"], call_id);
                    assert_eq!(payload["sender_user_id"], alice_id);
                    assert_eq!(payload["sender_client_id"], "client_alice_1000001");
                    assert_eq!(payload["target_client_id"], "client_bob_10000001");
                    assert_eq!(payload["envelope"], envelope_b64);
                    // Assert no decrypted payload or signal_type
                    assert!(payload.get("signal_type").is_none());
                    assert!(payload.get("payload").is_none());
                } else if channels == format!("private-room-{}", room_id) {
                    found_room_signal = true;
                }
            }
        }
    }

    assert!(
        found_user_signal,
        "call.signal must be published on target user channel"
    );
    assert!(
        !found_room_signal,
        "call.signal MUST NOT be published on room channel"
    );
}

// -----------------------------------------------------------------------------
// Rate Limiting Tests
// -----------------------------------------------------------------------------

#[tokio::test]
async fn test_signal_rate_limiting_per_user_per_call() {
    let (app, pool, _mock, occupancy) = setup_test_app(true).await;
    let (alice_id, alice_token) =
        create_test_user(&app, &pool, "alice_rate", "client_alice_dev_1001").await;
    let (bob_id, _bob_token) =
        create_test_user(&app, &pool, "bob_rate", "client_bob_dev_10001").await;
    let room_id = create_room(&app, &alice_token).await;
    add_member(&app, &alice_token, &room_id, &bob_id).await;

    let call1_id = "c_call1";
    let call2_id = "c_call2";

    occupancy
        .add_client(call1_id, &alice_id, "client_alice_dev_1001")
        .await;
    occupancy
        .add_client(call1_id, &alice_id, "client_alice_dev_1002")
        .await; // Second device of alice
    occupancy
        .add_client(call1_id, &bob_id, "client_bob_dev_10001")
        .await;

    occupancy
        .add_client(call2_id, &alice_id, "client_alice_dev_1001")
        .await;
    occupancy
        .add_client(call2_id, &bob_id, "client_bob_dev_10001")
        .await;

    // Send 120 signals in call1 using device 1
    for _ in 0..120 {
        let req = Request::builder()
            .method("POST")
            .uri(format!(
                "/api/v1/rooms/{}/calls/{}/signal",
                room_id, call1_id
            ))
            .header(header::AUTHORIZATION, format!("Bearer {}", alice_token))
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(
                json!({
                    "sender_client_id": "client_alice_dev_1001",
                    "target_user_id": bob_id,
                    "target_client_id": "client_bob_dev_10001",
                    "envelope": "QUJDRA"
                })
                .to_string(),
            ))
            .unwrap();

        let resp = app.clone().oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
    }

    // 121st signal in call1 from device 1 -> 429
    let req_121_dev1 = Request::builder()
        .method("POST")
        .uri(format!(
            "/api/v1/rooms/{}/calls/{}/signal",
            room_id, call1_id
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", alice_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "sender_client_id": "client_alice_dev_1001",
                "target_user_id": bob_id,
                "target_client_id": "client_bob_dev_10001",
                "envelope": "QUJDRA"
            })
            .to_string(),
        ))
        .unwrap();

    let resp_121_dev1 = app.clone().oneshot(req_121_dev1).await.unwrap();
    assert_eq!(resp_121_dev1.status(), StatusCode::TOO_MANY_REQUESTS);
    assert!(resp_121_dev1.headers().contains_key("retry-after"));

    // Signal in call1 using device 2 (same user) -> ALSO 429 (bucket is shared across caller's devices)
    let req_dev2 = Request::builder()
        .method("POST")
        .uri(format!(
            "/api/v1/rooms/{}/calls/{}/signal",
            room_id, call1_id
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", alice_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "sender_client_id": "client_alice_dev_1002",
                "target_user_id": bob_id,
                "target_client_id": "client_bob_dev_10001",
                "envelope": "QUJDRA"
            })
            .to_string(),
        ))
        .unwrap();

    let resp_dev2 = app.clone().oneshot(req_dev2).await.unwrap();
    assert_eq!(resp_dev2.status(), StatusCode::TOO_MANY_REQUESTS);

    // Signal in call2 -> SUCCESS (bucket is per user per call)
    let req_call2 = Request::builder()
        .method("POST")
        .uri(format!(
            "/api/v1/rooms/{}/calls/{}/signal",
            room_id, call2_id
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", alice_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "sender_client_id": "client_alice_dev_1001",
                "target_user_id": bob_id,
                "target_client_id": "client_bob_dev_10001",
                "envelope": "QUJDRA"
            })
            .to_string(),
        ))
        .unwrap();

    let resp_call2 = app.oneshot(req_call2).await.unwrap();
    assert_eq!(resp_call2.status(), StatusCode::OK);
}

// -----------------------------------------------------------------------------
// Non-Persistence Assertion Tests
// -----------------------------------------------------------------------------

#[tokio::test]
async fn test_signal_relay_writes_no_persistent_tables_except_rate_limits() {
    let (app, pool, _mock, occupancy) = setup_test_app(true).await;
    let (alice_id, alice_token) =
        create_test_user(&app, &pool, "alice_nopest", "client_alice_1000001").await;
    let (bob_id, _bob_token) =
        create_test_user(&app, &pool, "bob_nopest", "client_bob_10000001").await;
    let room_id = create_room(&app, &alice_token).await;
    add_member(&app, &alice_token, &room_id, &bob_id).await;

    let call_id = "c_12345";
    occupancy
        .add_client(call_id, &alice_id, "client_alice_1000001")
        .await;
    occupancy
        .add_client(call_id, &bob_id, "client_bob_10000001")
        .await;

    // Snapshot counts of all tables except rate_limits
    let count_users: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users")
        .fetch_one(&pool)
        .await
        .unwrap();
    let count_rooms: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM rooms")
        .fetch_one(&pool)
        .await
        .unwrap();
    let count_room_messages: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM room_messages")
        .fetch_one(&pool)
        .await
        .unwrap();
    let count_call_sessions: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM call_sessions")
        .fetch_one(&pool)
        .await
        .unwrap();
    let count_audit_log: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM audit_log")
        .fetch_one(&pool)
        .await
        .unwrap();

    // Perform signal relay
    let req = Request::builder()
        .method("POST")
        .uri(format!(
            "/api/v1/rooms/{}/calls/{}/signal",
            room_id, call_id
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", alice_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "sender_client_id": "client_alice_1000001",
                "target_user_id": bob_id,
                "target_client_id": "client_bob_10000001",
                "envelope": "QUJDRA"
            })
            .to_string(),
        ))
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    // Verify all table counts remain unchanged
    let post_users: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users")
        .fetch_one(&pool)
        .await
        .unwrap();
    let post_rooms: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM rooms")
        .fetch_one(&pool)
        .await
        .unwrap();
    let post_room_messages: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM room_messages")
        .fetch_one(&pool)
        .await
        .unwrap();
    let post_call_sessions: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM call_sessions")
        .fetch_one(&pool)
        .await
        .unwrap();
    let post_audit_log: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM audit_log")
        .fetch_one(&pool)
        .await
        .unwrap();

    assert_eq!(count_users, post_users);
    assert_eq!(count_rooms, post_rooms);
    assert_eq!(count_room_messages, post_room_messages);
    assert_eq!(count_call_sessions, post_call_sessions);
    assert_eq!(count_audit_log, post_audit_log);
}

// -----------------------------------------------------------------------------
// Defensive Edge Case Tests
// -----------------------------------------------------------------------------

#[tokio::test]
async fn test_signal_mid_request_participant_removal_returns_404() {
    let (app, pool, _mock, occupancy) = setup_test_app(true).await;
    let (alice_id, alice_token) =
        create_test_user(&app, &pool, "alice_mid_rem", "client_alice_1000001").await;
    let (bob_id, _bob_token) =
        create_test_user(&app, &pool, "bob_mid_rem", "client_bob_10000001").await;
    let room_id = create_room(&app, &alice_token).await;
    add_member(&app, &alice_token, &room_id, &bob_id).await;

    let call_id = "c_mid_rem";
    occupancy
        .add_client(call_id, &alice_id, "client_alice_1000001")
        .await;
    occupancy
        .add_client(call_id, &bob_id, "client_bob_10000001")
        .await;

    // Simulate bob leaving mid-request
    occupancy.remove_user(call_id, &bob_id).await;

    let req = Request::builder()
        .method("POST")
        .uri(format!(
            "/api/v1/rooms/{}/calls/{}/signal",
            room_id, call_id
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", alice_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "sender_client_id": "client_alice_1000001",
                "target_user_id": bob_id,
                "target_client_id": "client_bob_10000001",
                "envelope": "QUJDRA"
            })
            .to_string(),
        ))
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn test_signal_sender_client_from_different_call_returns_403() {
    let (app, pool, _mock, occupancy) = setup_test_app(true).await;
    let (alice_id, alice_token) =
        create_test_user(&app, &pool, "alice_diff_call", "client_alice_dev_1001").await;
    let (bob_id, _bob_token) =
        create_test_user(&app, &pool, "bob_diff_call", "client_bob_dev_10001").await;
    let room_id = create_room(&app, &alice_token).await;
    add_member(&app, &alice_token, &room_id, &bob_id).await;

    let call1_id = "c_call_1";
    let call2_id = "c_call_2";

    // Alice is in call1 with client_alice_dev_1001, and in call2 with client_alice_dev_1002
    occupancy
        .add_client(call1_id, &alice_id, "client_alice_dev_1001")
        .await;
    occupancy
        .add_client(call1_id, &bob_id, "client_bob_dev_10001")
        .await;

    occupancy
        .add_client(call2_id, &alice_id, "client_alice_dev_1002")
        .await;

    // Alice sends signal in call1 using client_alice_dev_1002 (which is in call2, not call1)
    let req = Request::builder()
        .method("POST")
        .uri(format!(
            "/api/v1/rooms/{}/calls/{}/signal",
            room_id, call1_id
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", alice_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "sender_client_id": "client_alice_dev_1002",
                "target_user_id": bob_id,
                "target_client_id": "client_bob_dev_10001",
                "envelope": "QUJDRA"
            })
            .to_string(),
        ))
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);
}
