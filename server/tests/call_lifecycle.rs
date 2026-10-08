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

// Helper to seed a call session row directly in DB (simulating Phase 19 join)
async fn seed_call_session(pool: &SqlitePool, call_id: &str, room_id: &str, initiator_id: &str) {
    sqlx::query(
        "INSERT INTO call_sessions (id, room_id, initiator_id, started_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)",
    )
    .bind(call_id)
    .bind(room_id)
    .bind(initiator_id)
    .execute(pool)
    .await
    .unwrap();
}

// -----------------------------------------------------------------------------
// Join Endpoint Tests
// -----------------------------------------------------------------------------

#[tokio::test]
async fn test_join_call_first_join_creates_session_publishes_event_and_logs_audit() {
    let (app, pool, mock_sockudo, call_occupancy) = setup_test_app(true).await;
    let (alice_id, alice_token) =
        create_test_user(&app, &pool, "alice_join", "client_alice_join_101").await;
    let room_id = create_room(&app, &alice_token).await;

    let call_id = format!("c_join_{}", ulid::Ulid::new());

    let req_join = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/calls/{}/join", room_id, call_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", alice_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({ "client_id": "client_alice_join_101" }).to_string(),
        ))
        .unwrap();

    let resp_join = app.clone().oneshot(req_join).await.unwrap();
    assert_eq!(resp_join.status(), StatusCode::OK);

    // Verify Cache-Control header
    let cache_control = resp_join.headers().get(header::CACHE_CONTROL).unwrap();
    assert_eq!(cache_control, "no-store");

    let body_bytes = axum::body::to_bytes(resp_join.into_body(), usize::MAX)
        .await
        .unwrap();
    let join_json: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert!(join_json["ice_servers"].is_array());
    assert_eq!(join_json["ice_servers"].as_array().unwrap().len(), 0);

    // Verify call_sessions row created in DB
    let (db_initiator, ended_at): (String, Option<String>) = sqlx::query_as(
        "SELECT initiator_id, ended_at FROM call_sessions WHERE id = ? AND room_id = ?",
    )
    .bind(&call_id)
    .bind(&room_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(db_initiator, alice_id);
    assert!(ended_at.is_none());

    // Verify in-memory occupancy
    assert!(call_occupancy.is_participant(&call_id, &alice_id).await);

    // Verify call.started event published on room channel
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
    assert!(data_json["started_at"].is_string());

    // Verify call.start audit entry
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
async fn test_join_call_idempotent_rejoin_same_and_different_user() {
    let (app, pool, mock_sockudo, call_occupancy) = setup_test_app(true).await;
    let (alice_id, alice_token) =
        create_test_user(&app, &pool, "alice_rejoin", "client_alice_rj_101").await;
    let (bob_id, bob_token) =
        create_test_user(&app, &pool, "bob_rejoin", "client_bob_rj_101").await;

    let room_id = create_room(&app, &alice_token).await;
    add_room_member(&app, &alice_token, &room_id, &bob_id).await;

    let call_id = format!("c_rejoin_{}", ulid::Ulid::new());

    // 1. Alice joins first time
    let req_alice1 = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/calls/{}/join", room_id, call_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", alice_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({ "client_id": "client_alice_rj_101" }).to_string(),
        ))
        .unwrap();

    let resp_alice1 = app.clone().oneshot(req_alice1).await.unwrap();
    assert_eq!(resp_alice1.status(), StatusCode::OK);

    let req_count_after_alice1 = mock_sockudo.received_requests().await.unwrap().len();

    // 2. Alice rejoins with same client_id
    let req_alice2 = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/calls/{}/join", room_id, call_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", alice_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({ "client_id": "client_alice_rj_101" }).to_string(),
        ))
        .unwrap();

    let resp_alice2 = app.clone().oneshot(req_alice2).await.unwrap();
    assert_eq!(resp_alice2.status(), StatusCode::OK);

    // Assert no second call.started event or audit row
    let req_count_after_alice2 = mock_sockudo.received_requests().await.unwrap().len();
    assert_eq!(req_count_after_alice1, req_count_after_alice2);

    // 3. Bob joins same call
    let req_bob = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/calls/{}/join", room_id, call_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", bob_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({ "client_id": "client_bob_rj_101" }).to_string(),
        ))
        .unwrap();

    let resp_bob = app.clone().oneshot(req_bob).await.unwrap();
    assert_eq!(resp_bob.status(), StatusCode::OK);

    // Assert no new call.started event
    let req_count_after_bob = mock_sockudo.received_requests().await.unwrap().len();
    assert_eq!(req_count_after_alice1, req_count_after_bob);

    // Both users are in occupancy
    assert!(call_occupancy.is_participant(&call_id, &alice_id).await);
    assert!(call_occupancy.is_participant(&call_id, &bob_id).await);
    assert_eq!(call_occupancy.participant_count(&call_id).await, 2);
}

#[tokio::test]
async fn test_join_call_error_cases() {
    let (app, pool, _mock, call_occupancy) = setup_test_app(true).await;
    let (alice_id, alice_token) =
        create_test_user(&app, &pool, "alice_jerr", "client_alice_err_101").await;
    let (_bob_id, bob_token) =
        create_test_user(&app, &pool, "bob_jerr", "client_bob_err_101").await;

    let room_id = create_room(&app, &alice_token).await;

    let call_id = format!("c_err_{}", ulid::Ulid::new());

    // 1. Non-member joins -> 404 room_not_found
    let req_non_member = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/calls/{}/join", room_id, call_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", bob_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({ "client_id": "client_bob_err_101" }).to_string(),
        ))
        .unwrap();

    let resp_non_member = app.clone().oneshot(req_non_member).await.unwrap();
    assert_eq!(resp_non_member.status(), StatusCode::NOT_FOUND);

    // 2. Unowned client_id -> 403 client_not_owned
    let req_unowned_client = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/calls/{}/join", room_id, call_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", alice_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({ "client_id": "client_impostor_client_101" }).to_string(),
        ))
        .unwrap();

    let resp_unowned_client = app.clone().oneshot(req_unowned_client).await.unwrap();
    assert_eq!(resp_unowned_client.status(), StatusCode::FORBIDDEN);

    // 3. Join ended call -> 409 call_ended
    seed_call_session(&pool, &call_id, &room_id, &alice_id).await;
    sqlx::query("UPDATE call_sessions SET ended_at = CURRENT_TIMESTAMP WHERE id = ?")
        .bind(&call_id)
        .execute(&pool)
        .await
        .unwrap();

    let req_ended = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/calls/{}/join", room_id, call_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", alice_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({ "client_id": "client_alice_err_101" }).to_string(),
        ))
        .unwrap();

    let resp_ended = app.clone().oneshot(req_ended).await.unwrap();
    assert_eq!(resp_ended.status(), StatusCode::CONFLICT);
    assert!(!call_occupancy.is_participant(&call_id, &alice_id).await);
}

#[tokio::test]
async fn test_join_call_max_participants_cap_enforcement() {
    let (app, pool, _mock, call_occupancy) = setup_test_app(true).await;
    let (alice_id, alice_token) =
        create_test_user(&app, &pool, "alice_cap", "client_alice_cap_101").await;
    let (bob_id, bob_token) = create_test_user(&app, &pool, "bob_cap", "client_bob_cap_101").await;
    let (charlie_id, charlie_token) =
        create_test_user(&app, &pool, "charlie_cap", "client_charlie_cap_101").await;

    let room_id = create_room(&app, &alice_token).await;
    add_room_member(&app, &alice_token, &room_id, &bob_id).await;
    add_room_member(&app, &alice_token, &room_id, &charlie_id).await;

    // Set instance_limits call_max_participants to 2
    sqlx::query(
        "INSERT INTO instance_limits (key, value, updated_at, updated_by) VALUES ('call_max_participants', '2', CURRENT_TIMESTAMP, ?)",
    )
    .bind(&alice_id)
    .execute(&pool)
    .await
    .unwrap();

    let call_id = format!("c_cap_{}", ulid::Ulid::new());

    // 1. Alice joins (1/2) -> OK
    let req_a = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/calls/{}/join", room_id, call_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", alice_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({ "client_id": "client_alice_cap_101" }).to_string(),
        ))
        .unwrap();
    let resp_a = app.clone().oneshot(req_a).await.unwrap();
    assert_eq!(resp_a.status(), StatusCode::OK);

    // 2. Bob joins (2/2) -> OK
    let req_b = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/calls/{}/join", room_id, call_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", bob_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({ "client_id": "client_bob_cap_101" }).to_string(),
        ))
        .unwrap();
    let resp_b = app.clone().oneshot(req_b).await.unwrap();
    assert_eq!(resp_b.status(), StatusCode::OK);

    // 3. Charlie attempts to join (3/2) -> 409 call_full
    let req_c = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/calls/{}/join", room_id, call_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", charlie_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({ "client_id": "client_charlie_cap_101" }).to_string(),
        ))
        .unwrap();
    let resp_c = app.clone().oneshot(req_c).await.unwrap();
    assert_eq!(resp_c.status(), StatusCode::CONFLICT);

    // Verify Charlie is not in occupancy
    assert!(!call_occupancy.is_participant(&call_id, &charlie_id).await);
    assert_eq!(call_occupancy.participant_count(&call_id).await, 2);
}

// -----------------------------------------------------------------------------
// Leave Endpoint Tests
// -----------------------------------------------------------------------------

#[tokio::test]
async fn test_leave_call_happy_path_and_last_participant() {
    let (app, pool, _mock, call_occupancy) = setup_test_app(true).await;
    let (alice_id, alice_token) =
        create_test_user(&app, &pool, "alice_leave", "client_alice_lv_101").await;
    let (bob_id, bob_token) = create_test_user(&app, &pool, "bob_leave", "client_bob_lv_101").await;

    let room_id = create_room(&app, &alice_token).await;
    add_room_member(&app, &alice_token, &room_id, &bob_id).await;

    let call_id = format!("c_leave_{}", ulid::Ulid::new());

    // Alice and Bob join
    call_occupancy
        .add_client(&call_id, &alice_id, "client_alice_lv_101")
        .await;
    call_occupancy
        .add_client(&call_id, &bob_id, "client_bob_lv_101")
        .await;
    seed_call_session(&pool, &call_id, &room_id, &alice_id).await;

    // 1. Alice leaves
    let req_a_leave = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/calls/{}/leave", room_id, call_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", alice_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({ "client_id": "client_alice_lv_101" }).to_string(),
        ))
        .unwrap();

    let resp_a_leave = app.clone().oneshot(req_a_leave).await.unwrap();
    assert_eq!(resp_a_leave.status(), StatusCode::NO_CONTENT);

    let cache_control = resp_a_leave.headers().get(header::CACHE_CONTROL).unwrap();
    assert_eq!(cache_control, "no-store");

    assert!(!call_occupancy.is_participant(&call_id, &alice_id).await);
    assert!(call_occupancy.is_participant(&call_id, &bob_id).await);

    // 2. Bob leaves (last participant)
    let req_b_leave = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/calls/{}/leave", room_id, call_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", bob_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({ "client_id": "client_bob_lv_101" }).to_string(),
        ))
        .unwrap();

    let resp_b_leave = app.clone().oneshot(req_b_leave).await.unwrap();
    assert_eq!(resp_b_leave.status(), StatusCode::NO_CONTENT);

    // Occupancy cleared, but call_sessions.ended_at remains NULL
    assert_eq!(call_occupancy.participant_count(&call_id).await, 0);

    let (ended_at,): (Option<String>,) =
        sqlx::query_as("SELECT ended_at FROM call_sessions WHERE id = ?")
            .bind(&call_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(ended_at.is_none());
}

#[tokio::test]
async fn test_leave_call_cross_device_and_idempotency() {
    let (app, pool, _mock, call_occupancy) = setup_test_app(true).await;
    let (alice_id, alice_token) =
        create_test_user(&app, &pool, "alice_multi_dev", "client_alice_dev_A").await;

    // Login Alice on second device
    let (_status, login_res) = login_user(
        &app,
        "alice_multi_dev",
        "Password123!",
        "client_alice_dev_B",
        None,
    )
    .await;
    let alice_token_b = login_res["session_token"].as_str().unwrap().to_string();

    let room_id = create_room(&app, &alice_token).await;
    let call_id = format!("c_multidev_{}", ulid::Ulid::new());

    // Alice joins from both devices
    call_occupancy
        .add_client(&call_id, &alice_id, "client_alice_dev_A")
        .await;
    call_occupancy
        .add_client(&call_id, &alice_id, "client_alice_dev_B")
        .await;

    // Alice leaves client_A using token B (any client of authenticated user may be specified)
    let req_leave_a = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/calls/{}/leave", room_id, call_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", alice_token_b))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({ "client_id": "client_alice_dev_A" }).to_string(),
        ))
        .unwrap();

    let resp_leave_a = app.clone().oneshot(req_leave_a).await.unwrap();
    assert_eq!(resp_leave_a.status(), StatusCode::NO_CONTENT);

    // Alice is still participant via client_alice_dev_B
    assert!(call_occupancy.is_participant(&call_id, &alice_id).await);
    assert!(
        call_occupancy
            .is_client_owner(&call_id, &alice_id, "client_alice_dev_B")
            .await
    );
    assert!(
        !call_occupancy
            .is_client_owner(&call_id, &alice_id, "client_alice_dev_A")
            .await
    );

    // Leaving again is idempotent (204 No Content)
    let req_leave_a_again = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/calls/{}/leave", room_id, call_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", alice_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({ "client_id": "client_alice_dev_A" }).to_string(),
        ))
        .unwrap();

    let resp_leave_a_again = app.clone().oneshot(req_leave_a_again).await.unwrap();
    assert_eq!(resp_leave_a_again.status(), StatusCode::NO_CONTENT);
}

// -----------------------------------------------------------------------------
// End Endpoint Tests
// -----------------------------------------------------------------------------

#[tokio::test]
async fn test_end_call_initiator_happy_path_and_idempotency() {
    let (app, pool, mock_sockudo, call_occupancy) = setup_test_app(true).await;
    let (alice_id, alice_token) =
        create_test_user(&app, &pool, "alice_end", "client_alice_123456").await;
    let room_id = create_room(&app, &alice_token).await;

    let call_id = ulid::Ulid::new().to_string();

    // Seed call session and occupancy
    seed_call_session(&pool, &call_id, &room_id, &alice_id).await;
    call_occupancy
        .add_client(&call_id, &alice_id, "client_alice_123456")
        .await;

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

    // Verify occupancy cleared
    assert!(!call_occupancy.is_participant(&call_id, &alice_id).await);

    // Verify call.ended room event published with duration_seconds
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
    assert!(data_json["duration_seconds"].is_number());

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
    let (app, pool, _mock, call_occupancy) = setup_test_app(true).await;
    let (_alice_id, alice_token) =
        create_test_user(&app, &pool, "alice_own", "client_alice_123456").await;
    let (bob_id, _bob_token) =
        create_test_user(&app, &pool, "bob_own", "client_bob_123456789").await;

    let room_id = create_room(&app, &alice_token).await;
    add_room_member(&app, &alice_token, &room_id, &bob_id).await;

    let call_id = ulid::Ulid::new().to_string();

    seed_call_session(&pool, &call_id, &room_id, &bob_id).await;
    call_occupancy
        .add_client(&call_id, &bob_id, "client_bob_123456789")
        .await;

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
    let (app, pool, _mock, call_occupancy) = setup_test_app(true).await;
    let (_alice_id, alice_token) =
        create_test_user(&app, &pool, "alice_perm", "client_alice_123456").await;
    let (bob_id, _bob_token) =
        create_test_user(&app, &pool, "bob_perm", "client_bob_123456789").await;
    let (charlie_id, charlie_token) =
        create_test_user(&app, &pool, "charlie_perm", "client_charlie_12345").await;

    let room_id = create_room(&app, &alice_token).await;
    add_room_member(&app, &alice_token, &room_id, &bob_id).await;
    add_room_member(&app, &alice_token, &room_id, &charlie_id).await;

    let call_id = ulid::Ulid::new().to_string();

    seed_call_session(&pool, &call_id, &room_id, &bob_id).await;
    call_occupancy
        .add_client(&call_id, &bob_id, "client_bob_123456789")
        .await;

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
    let (app, pool, _mock, call_occupancy) = setup_test_app(true).await;
    let (alice_id, alice_token) =
        create_test_user(&app, &pool, "alice_nm", "client_alice_123456").await;
    let (_bob_id, bob_token) =
        create_test_user(&app, &pool, "bob_nm", "client_bob_123456789").await;

    let room_id = create_room(&app, &alice_token).await;

    let call_id = ulid::Ulid::new().to_string();

    seed_call_session(&pool, &call_id, &room_id, &alice_id).await;
    call_occupancy
        .add_client(&call_id, &alice_id, "client_alice_123456")
        .await;

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
    let (app, pool, _mock, _call_occupancy) = setup_test_app(true).await;
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
    let (app, pool, _mock, _call_occupancy) = setup_test_app(true).await;
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
    let (app, pool, _mock, _call_occupancy) = setup_test_app(false).await;
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
