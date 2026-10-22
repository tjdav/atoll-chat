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

async fn setup_test_app() -> (Router, SqlitePool, MockServer, CallOccupancyStore) {
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
        calling_enabled: true,
        websocket_url: mock_server.uri(),
        pusher_app_key: "test-app-key".to_string(),
        pusher_app_secret: "test-app-secret".to_string(),
        ..server::Config::test_default()
    };

    let opaque_server = Arc::new(
        server::OpaqueServer::load_or_generate(Path::new("./data/test_oprf_p2p.key")).unwrap(),
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
        room_events: server::events::RoomEventBroadcast::default(),
        observer_cursors: server::events::ObserverCursorStore::default(),
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
// Happy Path & Event Verification
// -----------------------------------------------------------------------------

#[tokio::test]
async fn test_p2p_signal_happy_path() {
    let (app, pool, mock_server, _occupancy) = setup_test_app().await;
    let (alice_id, alice_token) =
        create_test_user(&app, &pool, "alice_p2p", "c_alice_dev_1000001").await;
    let (bob_id, _bob_token) = create_test_user(&app, &pool, "bob_p2p", "c_bob_dev_10000001").await;
    let room_id = create_room(&app, &alice_token).await;
    add_member(&app, &alice_token, &room_id, &bob_id).await;

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

    let envelope_b64 = "ZXhhbXBsZS1wMnAtZW52ZWxvcGU";

    let req = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/p2p/signal", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", alice_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "sender_client_id": "c_alice_dev_1000001",
                "target_user_id": bob_id,
                "target_client_id": "c_bob_dev_10000001",
                "envelope": envelope_b64
            })
            .to_string(),
        ))
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let cache_control = resp.headers().get(header::CACHE_CONTROL).unwrap();
    assert_eq!(cache_control, "no-store");

    let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let res_json: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(res_json["delivered_to"], 1);

    // Verify user_seq is unchanged for both users
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

    // Verify WireMock captured event publication
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

            if name == "p2p.signal" {
                if channels == format!("private-user-{}", bob_id) {
                    found_user_signal = true;
                    let payload: Value =
                        serde_json::from_str(body_json["data"].as_str().unwrap()).unwrap();
                    assert_eq!(payload["room_id"], room_id);
                    assert_eq!(payload["sender_user_id"], alice_id);
                    assert_eq!(payload["sender_client_id"], "c_alice_dev_1000001");
                    assert_eq!(payload["target_client_id"], "c_bob_dev_10000001");
                    assert_eq!(payload["envelope"], envelope_b64);
                } else if channels == format!("private-room-{}", room_id) {
                    found_room_signal = true;
                }
            }
        }
    }

    assert!(
        found_user_signal,
        "p2p.signal must be published on target user channel"
    );
    assert!(
        !found_room_signal,
        "p2p.signal MUST NOT be published on room channel"
    );
}

// -----------------------------------------------------------------------------
// Auth & Authorization Tests
// -----------------------------------------------------------------------------

#[tokio::test]
async fn test_p2p_signal_unauthenticated_returns_401() {
    let (app, _pool, _mock, _occupancy) = setup_test_app().await;

    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms/r_1/p2p/signal")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "sender_client_id": "c_client_10000001",
                "target_user_id": "u_bob",
                "target_client_id": "c_client_10000002",
                "envelope": "QUJDRA"
            })
            .to_string(),
        ))
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn test_p2p_signal_caller_not_in_room_returns_403() {
    let (app, pool, _mock, _occupancy) = setup_test_app().await;
    let (_alice_id, alice_token) =
        create_test_user(&app, &pool, "alice_not_in_room", "c_alice_dev_1000001").await;

    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms/r_nonexistent/p2p/signal")
        .header(header::AUTHORIZATION, format!("Bearer {}", alice_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "sender_client_id": "c_alice_dev_1000001",
                "target_user_id": "u_bob",
                "target_client_id": "c_bob_dev_10000001",
                "envelope": "QUJDRA"
            })
            .to_string(),
        ))
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn test_p2p_signal_target_not_in_room_returns_404() {
    let (app, pool, _mock, _occupancy) = setup_test_app().await;
    let (_alice_id, alice_token) =
        create_test_user(&app, &pool, "alice_target_missing", "c_alice_dev_1000001").await;
    let (bob_id, _bob_token) =
        create_test_user(&app, &pool, "bob_out_of_room", "c_bob_dev_10000001").await;
    let room_id = create_room(&app, &alice_token).await;
    // Note: bob is not added to room_id

    let req = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/p2p/signal", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", alice_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "sender_client_id": "c_alice_dev_1000001",
                "target_user_id": bob_id,
                "target_client_id": "c_bob_dev_10000001",
                "envelope": "QUJDRA"
            })
            .to_string(),
        ))
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn test_p2p_signal_sender_client_not_owned_returns_400() {
    let (app, pool, _mock, _occupancy) = setup_test_app().await;
    let (_alice_id, alice_token) =
        create_test_user(&app, &pool, "alice_unowned_dev", "c_alice_real_100001").await;
    let (bob_id, _bob_token) =
        create_test_user(&app, &pool, "bob_unowned_dev", "c_bob_dev_10000001").await;
    let room_id = create_room(&app, &alice_token).await;
    add_member(&app, &alice_token, &room_id, &bob_id).await;

    // Request specifying c_impostor_dev instead of c_alice_real_100001
    let req = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/p2p/signal", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", alice_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "sender_client_id": "c_impostor_dev_1000",
                "target_user_id": bob_id,
                "target_client_id": "c_bob_dev_10000001",
                "envelope": "QUJDRA"
            })
            .to_string(),
        ))
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn test_p2p_signal_target_client_id_belonging_to_different_user_succeeds() {
    // Note: The server does not verify if target_client_id belongs to target_user_id
    // (the sender does not have target device visibility; target client drops mismatched signals).
    let (app, pool, _mock, _occupancy) = setup_test_app().await;
    let (_alice_id, alice_token) =
        create_test_user(&app, &pool, "alice_target_diff", "c_alice_dev_1000001").await;
    let (bob_id, _bob_token) =
        create_test_user(&app, &pool, "bob_target_diff", "c_bob_dev_10000001").await;
    let room_id = create_room(&app, &alice_token).await;
    add_member(&app, &alice_token, &room_id, &bob_id).await;

    let req = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/p2p/signal", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", alice_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "sender_client_id": "c_alice_dev_1000001",
                "target_user_id": bob_id,
                "target_client_id": "c_foreign_client_id_9999",
                "envelope": "QUJDRA"
            })
            .to_string(),
        ))
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
}

// -----------------------------------------------------------------------------
// Validation Tests
// -----------------------------------------------------------------------------

#[tokio::test]
async fn test_p2p_signal_missing_fields_returns_400() {
    let (app, pool, _mock, _occupancy) = setup_test_app().await;
    let (_alice_id, alice_token) =
        create_test_user(&app, &pool, "alice_missing_f", "c_alice_dev_1000001").await;
    let (bob_id, _bob_token) =
        create_test_user(&app, &pool, "bob_missing_f", "c_bob_dev_10000001").await;
    let room_id = create_room(&app, &alice_token).await;
    add_member(&app, &alice_token, &room_id, &bob_id).await;

    // Missing sender_client_id
    let req = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/p2p/signal", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", alice_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "sender_client_id": "   ",
                "target_user_id": bob_id,
                "target_client_id": "c_bob_dev_10000001",
                "envelope": "QUJDRA"
            })
            .to_string(),
        ))
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn test_p2p_signal_malformed_envelope_returns_400() {
    let (app, pool, _mock, _occupancy) = setup_test_app().await;
    let (_alice_id, alice_token) =
        create_test_user(&app, &pool, "alice_bad_env_p2p", "c_alice_dev_1000001").await;
    let (bob_id, _bob_token) =
        create_test_user(&app, &pool, "bob_bad_env_p2p", "c_bob_dev_10000001").await;
    let room_id = create_room(&app, &alice_token).await;
    add_member(&app, &alice_token, &room_id, &bob_id).await;

    let req = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/p2p/signal", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", alice_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "sender_client_id": "c_alice_dev_1000001",
                "target_user_id": bob_id,
                "target_client_id": "c_bob_dev_10000001",
                "envelope": "!!!NOT_BASE64!!!"
            })
            .to_string(),
        ))
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn test_p2p_signal_oversized_envelope_returns_400() {
    let (app, pool, _mock, _occupancy) = setup_test_app().await;
    let (_alice_id, alice_token) =
        create_test_user(&app, &pool, "alice_large_env", "c_alice_dev_1000001").await;
    let (bob_id, _bob_token) =
        create_test_user(&app, &pool, "bob_large_env", "c_bob_dev_10000001").await;
    let room_id = create_room(&app, &alice_token).await;
    add_member(&app, &alice_token, &room_id, &bob_id).await;

    // Create a base64url envelope decoding to > 64 KiB (65,537 bytes)
    let large_bytes = vec![0u8; 65537];
    use base64::engine::general_purpose::URL_SAFE_NO_PAD;
    use base64::Engine;
    let large_b64 = URL_SAFE_NO_PAD.encode(&large_bytes);

    let req = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/p2p/signal", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", alice_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "sender_client_id": "c_alice_dev_1000001",
                "target_user_id": bob_id,
                "target_client_id": "c_bob_dev_10000001",
                "envelope": large_b64
            })
            .to_string(),
        ))
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}

// -----------------------------------------------------------------------------
// Rate Limiting Tests
// -----------------------------------------------------------------------------

#[tokio::test]
async fn test_p2p_signal_rate_limiting_per_user_per_room() {
    let (app, pool, _mock, _occupancy) = setup_test_app().await;
    let (_alice_id, alice_token) =
        create_test_user(&app, &pool, "alice_p2p_rate", "c_alice_dev_1000001").await;
    let (bob_id, _bob_token) =
        create_test_user(&app, &pool, "bob_p2p_rate", "c_bob_dev_10000001").await;
    let room1_id = create_room(&app, &alice_token).await;
    let room2_id = create_room(&app, &alice_token).await;
    add_member(&app, &alice_token, &room1_id, &bob_id).await;
    add_member(&app, &alice_token, &room2_id, &bob_id).await;

    // Send 120 signals in room1
    for _ in 0..120 {
        let req = Request::builder()
            .method("POST")
            .uri(format!("/api/v1/rooms/{}/p2p/signal", room1_id))
            .header(header::AUTHORIZATION, format!("Bearer {}", alice_token))
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(
                json!({
                    "sender_client_id": "c_alice_dev_1000001",
                    "target_user_id": bob_id,
                    "target_client_id": "c_bob_dev_10000001",
                    "envelope": "QUJDRA"
                })
                .to_string(),
            ))
            .unwrap();

        let resp = app.clone().oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
    }

    // 121st signal in room1 -> 429
    let req_121 = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/p2p/signal", room1_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", alice_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "sender_client_id": "c_alice_dev_1000001",
                "target_user_id": bob_id,
                "target_client_id": "c_bob_dev_10000001",
                "envelope": "QUJDRA"
            })
            .to_string(),
        ))
        .unwrap();

    let resp_121 = app.clone().oneshot(req_121).await.unwrap();
    assert_eq!(resp_121.status(), StatusCode::TOO_MANY_REQUESTS);
    assert!(resp_121.headers().contains_key("retry-after"));

    // Signal in room2 (same user) -> SUCCESS (separate bucket per room)
    let req_room2 = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/p2p/signal", room2_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", alice_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "sender_client_id": "c_alice_dev_1000001",
                "target_user_id": bob_id,
                "target_client_id": "c_bob_dev_10000001",
                "envelope": "QUJDRA"
            })
            .to_string(),
        ))
        .unwrap();

    let resp_room2 = app.oneshot(req_room2).await.unwrap();
    assert_eq!(resp_room2.status(), StatusCode::OK);
}

// -----------------------------------------------------------------------------
// Non-Persistence Assertion Tests
// -----------------------------------------------------------------------------

#[tokio::test]
async fn test_p2p_signal_writes_no_persistent_tables_except_rate_limits() {
    let (app, pool, _mock, _occupancy) = setup_test_app().await;
    let (_alice_id, alice_token) =
        create_test_user(&app, &pool, "alice_p2p_nopest", "c_alice_dev_1000001").await;
    let (bob_id, _bob_token) =
        create_test_user(&app, &pool, "bob_p2p_nopest", "c_bob_dev_10000001").await;
    let room_id = create_room(&app, &alice_token).await;
    add_member(&app, &alice_token, &room_id, &bob_id).await;

    // Snapshot counts of all persistent tables
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
    let count_audit_log: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM audit_log")
        .fetch_one(&pool)
        .await
        .unwrap();

    // Perform signal relay
    let req = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/p2p/signal", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", alice_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "sender_client_id": "c_alice_dev_1000001",
                "target_user_id": bob_id,
                "target_client_id": "c_bob_dev_10000001",
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
    let post_audit_log: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM audit_log")
        .fetch_one(&pool)
        .await
        .unwrap();

    assert_eq!(count_users, post_users);
    assert_eq!(count_rooms, post_rooms);
    assert_eq!(count_room_messages, post_room_messages);
    assert_eq!(count_audit_log, post_audit_log);
}
