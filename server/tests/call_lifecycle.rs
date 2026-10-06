mod common;

use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use axum::Router;
use common::{login_user, register_user};
use serde_json::{json, Value};
use sqlx::SqlitePool;
use std::path::Path;
use std::sync::Arc;
use tower::ServiceExt;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

async fn setup_test_app(calling_enabled: bool) -> (Router, SqlitePool, MockServer) {
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
        server::OpaqueServer::load_or_generate(Path::new("./data/test_oprf_call_lc.key")).unwrap(),
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
        extension_proxy_blocklist: std::sync::Arc::new(
            server::extensions_proxy::blocklist::DomainBlocklistStore::new(Default::default()),
        ),
    };

    let app = server::build_app(state);
    (app, pool, mock_server)
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

async fn add_room_member(app: &Router, owner_token: &str, room_id: &str, user_id: &str) {
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

#[tokio::test]
async fn test_lazy_creation_publishes_call_started_and_audit_once() {
    let (app, pool, mock_sockudo) = setup_test_app(true).await;
    let (alice_id, alice_token) =
        create_test_user(&app, &pool, "alice_lc", "client_alice_123456").await;
    let room_id = create_room(&app, &alice_token).await;

    let call_id = ulid::Ulid::new().to_string();

    // Signal 1 -> triggers lazy creation, call.started event, call.start audit
    let req1 = Request::builder()
        .method("POST")
        .uri(format!(
            "/api/v1/rooms/{}/calls/{}/signal",
            room_id, call_id
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", alice_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "signal_type": "offer",
                "payload": "ZmFrZS1zZHA="
            })
            .to_string(),
        ))
        .unwrap();

    let resp1 = app.clone().oneshot(req1).await.unwrap();
    assert_eq!(resp1.status(), StatusCode::ACCEPTED);

    // Verify call.started event was published to room channel
    let requests = mock_sockudo.received_requests().await.unwrap();
    let start_event_req = requests
        .iter()
        .find(|r| {
            let body_json: Value = serde_json::from_slice(&r.body).unwrap_or_default();
            body_json["name"] == "call.started"
        })
        .expect("call.started event should be published");

    let body_json: Value = serde_json::from_slice(&start_event_req.body).unwrap();
    assert_eq!(body_json["name"], "call.started");
    assert_eq!(
        body_json["channels"].as_array().unwrap()[0],
        format!("private-room-{}", room_id)
    );

    let data_str = body_json["data"].as_str().unwrap();
    let data_json: Value = serde_json::from_str(data_str).unwrap();
    assert_eq!(data_json["call_id"], call_id);
    assert_eq!(data_json["room_id"], room_id);
    assert_eq!(data_json["initiator_id"], alice_id);
    assert!(data_json.get("started_at").is_some());
    assert!(data_json.get("signal_type").is_none());
    assert!(data_json.get("payload").is_none());

    // Verify call.start audit entry
    let audit_entry: Option<(String, Option<String>)> = sqlx::query_as(
        "SELECT action, metadata FROM audit_log WHERE action = 'call.start' AND target_id = ?",
    )
    .bind(&call_id)
    .fetch_optional(&pool)
    .await
    .unwrap();

    let (act, meta_opt) = audit_entry.expect("call.start audit log entry should exist");
    assert_eq!(act, "call.start");
    let meta: Value = serde_json::from_str(&meta_opt.unwrap()).unwrap();
    assert_eq!(meta["call_id"], call_id);
    assert_eq!(meta["room_id"], room_id);
    assert!(meta.get("signal_type").is_none());
    assert!(meta.get("payload").is_none());

    let req_count_before = mock_sockudo.received_requests().await.unwrap().len();

    // Signal 2 -> does NOT re-publish call.started or re-write call.start audit
    let req2 = Request::builder()
        .method("POST")
        .uri(format!(
            "/api/v1/rooms/{}/calls/{}/signal",
            room_id, call_id
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", alice_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "signal_type": "candidate",
                "payload": "Y2FuZGlkYXRl"
            })
            .to_string(),
        ))
        .unwrap();

    let resp2 = app.clone().oneshot(req2).await.unwrap();
    assert_eq!(resp2.status(), StatusCode::ACCEPTED);

    // Verify no new call.started event
    let req_count_after = mock_sockudo.received_requests().await.unwrap().len();
    assert_eq!(req_count_before, req_count_after);

    // Verify audit log count remains 1
    let audit_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM audit_log WHERE action = 'call.start' AND target_id = ?",
    )
    .bind(&call_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(audit_count, 1);
}

#[tokio::test]
async fn test_end_call_initiator_happy_path_and_idempotency() {
    let (app, pool, mock_sockudo) = setup_test_app(true).await;
    let (alice_id, alice_token) =
        create_test_user(&app, &pool, "alice_end", "client_alice_123456").await;
    let room_id = create_room(&app, &alice_token).await;

    let call_id = ulid::Ulid::new().to_string();

    // Signal first
    let req_sig = Request::builder()
        .method("POST")
        .uri(format!(
            "/api/v1/rooms/{}/calls/{}/signal",
            room_id, call_id
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", alice_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "signal_type": "offer",
                "payload": "ZmFrZS1zZHA="
            })
            .to_string(),
        ))
        .unwrap();
    let resp_sig = app.clone().oneshot(req_sig).await.unwrap();
    assert_eq!(resp_sig.status(), StatusCode::ACCEPTED);

    // End call
    let req_end = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/calls/{}/end", room_id, call_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", alice_token))
        .body(Body::empty())
        .unwrap();

    let resp_end = app.clone().oneshot(req_end).await.unwrap();
    assert_eq!(resp_end.status(), StatusCode::OK);

    let body_bytes = axum::body::to_bytes(resp_end.into_body(), usize::MAX)
        .await
        .unwrap();
    let end_json: Value = serde_json::from_slice(&body_bytes).unwrap();

    assert_eq!(end_json["call_id"], call_id);
    assert_eq!(end_json["room_id"], room_id);
    assert_eq!(end_json["initiator_id"], alice_id);
    assert!(end_json["started_at"].is_string());
    assert!(end_json["ended_at"].is_string());

    // Verify DB state
    let (ended_at,): (Option<String>,) =
        sqlx::query_as("SELECT ended_at FROM call_sessions WHERE id = ?")
            .bind(&call_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(ended_at.is_some());

    let (left_at,): (Option<String>,) =
        sqlx::query_as("SELECT left_at FROM call_participants WHERE call_id = ? AND user_id = ?")
            .bind(&call_id)
            .bind(&alice_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(left_at.is_some());

    // Verify call.ended room event published
    let requests = mock_sockudo.received_requests().await.unwrap();
    let end_event_req = requests
        .iter()
        .find(|r| {
            let body_json: Value = serde_json::from_slice(&r.body).unwrap_or_default();
            body_json["name"] == "call.ended"
        })
        .expect("call.ended event should be published");

    let body_json: Value = serde_json::from_slice(&end_event_req.body).unwrap();
    assert_eq!(body_json["name"], "call.ended");
    assert_eq!(
        body_json["channels"].as_array().unwrap()[0],
        format!("private-room-{}", room_id)
    );

    let data_str = body_json["data"].as_str().unwrap();
    let data_json: Value = serde_json::from_str(data_str).unwrap();
    assert_eq!(data_json["call_id"], call_id);
    assert_eq!(data_json["room_id"], room_id);
    assert!(data_json.get("ended_at").is_some());

    // Verify call.end audit entry
    let audit_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM audit_log WHERE action = 'call.end' AND target_id = ?",
    )
    .bind(&call_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(audit_count, 1);

    let req_count_before = mock_sockudo.received_requests().await.unwrap().len();

    // Idempotent second /end call
    let req_end2 = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/calls/{}/end", room_id, call_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", alice_token))
        .body(Body::empty())
        .unwrap();

    let resp_end2 = app.clone().oneshot(req_end2).await.unwrap();
    assert_eq!(resp_end2.status(), StatusCode::OK);

    let body2_bytes = axum::body::to_bytes(resp_end2.into_body(), usize::MAX)
        .await
        .unwrap();
    let end2_json: Value = serde_json::from_slice(&body2_bytes).unwrap();
    assert_eq!(end2_json["ended_at"], end_json["ended_at"]);

    // Verify no second event or audit log
    let req_count_after = mock_sockudo.received_requests().await.unwrap().len();
    assert_eq!(req_count_before, req_count_after);

    let audit_count2: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM audit_log WHERE action = 'call.end' AND target_id = ?",
    )
    .bind(&call_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(audit_count2, 1);
}

#[tokio::test]
async fn test_end_call_room_owner_can_end() {
    let (app, pool, _mock) = setup_test_app(true).await;
    let (_alice_id, alice_token) =
        create_test_user(&app, &pool, "alice_own", "client_alice_123456").await;
    let (bob_id, bob_token) =
        create_test_user(&app, &pool, "bob_own", "client_bob_123456789").await;

    let room_id = create_room(&app, &alice_token).await;
    add_room_member(&app, &alice_token, &room_id, &bob_id).await;

    let call_id = ulid::Ulid::new().to_string();

    // Bob (non-owner member) initiates call via signal
    let req_sig = Request::builder()
        .method("POST")
        .uri(format!(
            "/api/v1/rooms/{}/calls/{}/signal",
            room_id, call_id
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", bob_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "signal_type": "offer",
                "payload": "ZmFrZS1zZHA="
            })
            .to_string(),
        ))
        .unwrap();
    let resp_sig = app.clone().oneshot(req_sig).await.unwrap();
    assert_eq!(resp_sig.status(), StatusCode::ACCEPTED);

    // Alice (room owner) ends Bob's call -> succeeds
    let req_end = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/calls/{}/end", room_id, call_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", alice_token))
        .body(Body::empty())
        .unwrap();

    let resp_end = app.oneshot(req_end).await.unwrap();
    assert_eq!(resp_end.status(), StatusCode::OK);
}

#[tokio::test]
async fn test_end_call_non_initiator_non_owner_returns_forbidden() {
    let (app, pool, _mock) = setup_test_app(true).await;
    let (_alice_id, alice_token) =
        create_test_user(&app, &pool, "alice_perm", "client_alice_123456").await;
    let (bob_id, bob_token) =
        create_test_user(&app, &pool, "bob_perm", "client_bob_123456789").await;
    let (charlie_id, charlie_token) =
        create_test_user(&app, &pool, "charlie_perm", "client_charlie_12345").await;

    let room_id = create_room(&app, &alice_token).await;
    add_room_member(&app, &alice_token, &room_id, &bob_id).await;
    add_room_member(&app, &alice_token, &room_id, &charlie_id).await;

    let call_id = ulid::Ulid::new().to_string();

    // Bob initiates call
    let req_sig = Request::builder()
        .method("POST")
        .uri(format!(
            "/api/v1/rooms/{}/calls/{}/signal",
            room_id, call_id
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", bob_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "signal_type": "offer",
                "payload": "ZmFrZS1zZHA="
            })
            .to_string(),
        ))
        .unwrap();
    let resp_sig = app.clone().oneshot(req_sig).await.unwrap();
    assert_eq!(resp_sig.status(), StatusCode::ACCEPTED);

    // Charlie (non-initiator, non-owner member) attempts to end call -> 403 Forbidden
    let req_end = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/calls/{}/end", room_id, call_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", charlie_token))
        .body(Body::empty())
        .unwrap();

    let resp_end = app.oneshot(req_end).await.unwrap();
    assert_eq!(resp_end.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn test_end_call_non_member_returns_room_not_found() {
    let (app, pool, _mock) = setup_test_app(true).await;
    let (_alice_id, alice_token) =
        create_test_user(&app, &pool, "alice_nm", "client_alice_123456").await;
    let (_bob_id, bob_token) =
        create_test_user(&app, &pool, "bob_nm", "client_bob_123456789").await;

    let room_id = create_room(&app, &alice_token).await;

    let call_id = ulid::Ulid::new().to_string();

    // Alice initiates call
    let req_sig = Request::builder()
        .method("POST")
        .uri(format!(
            "/api/v1/rooms/{}/calls/{}/signal",
            room_id, call_id
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", alice_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "signal_type": "offer",
                "payload": "ZmFrZS1zZHA="
            })
            .to_string(),
        ))
        .unwrap();
    let resp_sig = app.clone().oneshot(req_sig).await.unwrap();
    assert_eq!(resp_sig.status(), StatusCode::ACCEPTED);

    // Bob (not a member of room) attempts to end call -> 404 room_not_found
    let req_end = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/calls/{}/end", room_id, call_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", bob_token))
        .body(Body::empty())
        .unwrap();

    let resp_end = app.oneshot(req_end).await.unwrap();
    assert_eq!(resp_end.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn test_end_call_unknown_call_id_returns_call_not_found() {
    let (app, pool, _mock) = setup_test_app(true).await;
    let (_alice_id, alice_token) =
        create_test_user(&app, &pool, "alice_unk", "client_alice_123456").await;
    let room_id = create_room(&app, &alice_token).await;

    let req_end = Request::builder()
        .method("POST")
        .uri(format!(
            "/api/v1/rooms/{}/calls/unknown_call_id/end",
            room_id
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", alice_token))
        .body(Body::empty())
        .unwrap();

    let resp_end = app.oneshot(req_end).await.unwrap();
    assert_eq!(resp_end.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn test_end_call_unauthenticated_returns_401() {
    let (app, pool, _mock) = setup_test_app(true).await;
    let (_alice_id, alice_token) =
        create_test_user(&app, &pool, "alice_unauth", "client_alice_123456").await;
    let room_id = create_room(&app, &alice_token).await;

    let req_end = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/calls/call123/end", room_id))
        .body(Body::empty())
        .unwrap();

    let resp_end = app.oneshot(req_end).await.unwrap();
    assert_eq!(resp_end.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn test_end_call_calling_disabled() {
    let (app, pool, _mock) = setup_test_app(false).await;
    let (_alice_id, alice_token) =
        create_test_user(&app, &pool, "alice_dis_end", "client_alice_123456").await;
    let room_id = create_room(&app, &alice_token).await;

    let req_end = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/calls/call123/end", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", alice_token))
        .body(Body::empty())
        .unwrap();

    let resp_end = app.oneshot(req_end).await.unwrap();
    assert_eq!(resp_end.status(), StatusCode::NOT_IMPLEMENTED);
}
