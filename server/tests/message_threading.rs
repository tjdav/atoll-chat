mod common;

use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use axum::Router;
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use common::{login_user, register_user, setup_test_app_with_config};
use serde_json::{json, Value};
use sqlx::SqlitePool;
use std::path::Path;
use std::sync::Arc;
use tower::ServiceExt;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

async fn setup_test_app_with_sockudo_mock() -> (Router, SqlitePool, MockServer) {
    let mock_server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/apps/chat/events"))
        .respond_with(ResponseTemplate::new(500))
        .mount(&mock_server)
        .await;

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
        server::OpaqueServer::load_or_generate(Path::new("./data/test_oprf_mt.key")).unwrap(),
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

async fn create_test_user_with_device(
    app: &Router,
    pool: &SqlitePool,
    prefix: &str,
) -> (String, String, String) {
    let username = format!("{}_user", prefix);
    let password = "Password123!";
    let client_id = format!("{}_client_12345678", prefix);

    let has_users: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM users)")
        .fetch_one(pool)
        .await
        .unwrap();

    let invite_code = if has_users {
        let code = format!("INV_{}", prefix);
        sqlx::query(
            "INSERT INTO server_invites (id, code, max_uses, current_uses) VALUES (?, ?, 10, 0)",
        )
        .bind(format!("inv_id_{}", prefix))
        .bind(&code)
        .execute(pool)
        .await
        .unwrap();
        Some(code)
    } else {
        None
    };

    let user_id = register_user(app, &username, password, invite_code.as_deref()).await;
    let (status, login_res) = login_user(app, &username, password, &client_id, None).await;

    if status != StatusCode::OK {
        panic!(
            "login_user failed for {}: status={}, res={:?}",
            username, status, login_res
        );
    }

    let token = login_res["session_token"].as_str().unwrap().to_string();

    (user_id, token, client_id)
}

async fn do_get(app: &Router, uri: &str, token: &str) -> (StatusCode, Value) {
    let req = Request::builder()
        .method("GET")
        .uri(uri)
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::empty())
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    let status = resp.status();
    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body_bytes).unwrap_or(json!({}));
    (status, json)
}

async fn do_post(app: &Router, uri: &str, token: &str, body: &Value) -> (StatusCode, Value) {
    let req = Request::builder()
        .method("POST")
        .uri(uri)
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(body.to_string()))
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    let status = resp.status();
    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body_bytes).unwrap_or(json!({}));
    (status, json)
}

async fn do_delete(app: &Router, uri: &str, token: &str) -> (StatusCode, Value) {
    let req = Request::builder()
        .method("DELETE")
        .uri(uri)
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::empty())
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    let status = resp.status();
    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body_bytes).unwrap_or(json!({}));
    (status, json)
}

async fn create_room(app: &Router, token: &str) -> String {
    let (status, body) = do_post(app, "/api/v1/rooms", token, &json!({})).await;
    assert_eq!(status, StatusCode::CREATED);
    body["id"].as_str().unwrap().to_string()
}

#[tokio::test]
async fn test_capabilities_advertises_threading_enabled() {
    let (app, _pool, _) = setup_test_app_with_config(true, "auto", 100).await;
    let req = Request::builder()
        .method("GET")
        .uri("/api/v1/capabilities")
        .body(Body::empty())
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(json["threading_enabled"], true);
}

#[tokio::test]
async fn test_message_send_and_fetch_threading() {
    let mock_server = wiremock::MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/apps/chat/events"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({})))
        .mount(&mock_server)
        .await;

    let (app, pool, _) = setup_test_app_with_config(true, "auto", 100).await;
    let (_u1, t1, c1) = create_test_user_with_device(&app, &pool, "mt1").await;
    let room_id = create_room(&app, &t1).await;

    let ciphertext = BASE64.encode(b"hello world");

    // 1. Send message without reply_to -> reply_to is null
    let (s1, body1) = do_post(
        &app,
        &format!("/api/v1/rooms/{room_id}/messages"),
        &t1,
        &json!({
            "sender_client_id": c1,
            "epoch": 0,
            "content_type": "application",
            "ciphertext": ciphertext
        }),
    )
    .await;
    assert_eq!(s1, StatusCode::CREATED);
    let m1_id = body1["message_id"].as_str().unwrap().to_string();
    assert_eq!(body1["reply_to"], Value::Null);

    // 2. Send message with valid reply_to -> reply_to is m1_id
    let (s2, body2) = do_post(
        &app,
        &format!("/api/v1/rooms/{room_id}/messages"),
        &t1,
        &json!({
            "sender_client_id": c1,
            "epoch": 0,
            "content_type": "application",
            "ciphertext": ciphertext,
            "reply_to": m1_id
        }),
    )
    .await;
    assert_eq!(s2, StatusCode::CREATED);
    let m2_id = body2["message_id"].as_str().unwrap().to_string();
    assert_eq!(body2["reply_to"], m1_id);

    // 3. Fetch messages -> verify reply_to values
    let (sf, list_body) = do_get(&app, &format!("/api/v1/rooms/{room_id}/messages"), &t1).await;
    assert_eq!(sf, StatusCode::OK);
    let msgs = list_body["messages"].as_array().unwrap();
    assert_eq!(msgs.len(), 2);
    assert_eq!(msgs[0]["id"], m1_id);
    assert_eq!(msgs[0]["reply_to"], Value::Null);
    assert_eq!(msgs[1]["id"], m2_id);
    assert_eq!(msgs[1]["reply_to"], m1_id);
}

#[tokio::test]
async fn test_invalid_reply_targets() {
    let (app, pool, _) = setup_test_app_with_config(true, "auto", 100).await;
    let (_u1, t1, c1) = create_test_user_with_device(&app, &pool, "mt_inv1").await;
    let (_u2, t2, c2) = create_test_user_with_device(&app, &pool, "mt_inv2").await;

    let room1_id = create_room(&app, &t1).await;
    let room2_id = create_room(&app, &t2).await;

    let ciphertext = BASE64.encode(b"test ciphertext");

    // Message in room 1
    let (s1, body1) = do_post(
        &app,
        &format!("/api/v1/rooms/{room1_id}/messages"),
        &t1,
        &json!({
            "sender_client_id": c1,
            "epoch": 0,
            "content_type": "application",
            "ciphertext": ciphertext
        }),
    )
    .await;
    assert_eq!(s1, StatusCode::CREATED);
    let r1_m1_id = body1["message_id"].as_str().unwrap().to_string();

    // Message in room 2
    let (s2, body2) = do_post(
        &app,
        &format!("/api/v1/rooms/{room2_id}/messages"),
        &t2,
        &json!({
            "sender_client_id": c2,
            "epoch": 0,
            "content_type": "application",
            "ciphertext": ciphertext
        }),
    )
    .await;
    assert_eq!(s2, StatusCode::CREATED);
    let r2_m1_id = body2["message_id"].as_str().unwrap().to_string();

    // A. Cross-room reply reference -> 400 invalid_reply_target with details.reason = "not_in_room"
    let (sx_room, err_x_room) = do_post(
        &app,
        &format!("/api/v1/rooms/{room1_id}/messages"),
        &t1,
        &json!({
            "sender_client_id": c1,
            "epoch": 0,
            "content_type": "application",
            "ciphertext": ciphertext,
            "reply_to": r2_m1_id
        }),
    )
    .await;
    assert_eq!(sx_room, StatusCode::BAD_REQUEST);
    assert_eq!(err_x_room["error"], "invalid_reply_target");
    assert_eq!(err_x_room["details"]["reason"], "not_in_room");

    // B. Nonexistent target -> 400 invalid_reply_target
    let (sx_nonexist, err_x_nonexist) = do_post(
        &app,
        &format!("/api/v1/rooms/{room1_id}/messages"),
        &t1,
        &json!({
            "sender_client_id": c1,
            "epoch": 0,
            "content_type": "application",
            "ciphertext": ciphertext,
            "reply_to": "01HXXXXXXXNONEXISTENT000"
        }),
    )
    .await;
    assert_eq!(sx_nonexist, StatusCode::BAD_REQUEST);
    assert_eq!(err_x_nonexist["error"], "invalid_reply_target");

    // C. Soft-deleted target -> 400 invalid_reply_target with details.reason = "deleted"
    let (s_del, _) = do_delete(
        &app,
        &format!("/api/v1/rooms/{room1_id}/messages/{r1_m1_id}"),
        &t1,
    )
    .await;
    assert_eq!(s_del, StatusCode::NO_CONTENT);

    let (sx_del, err_x_del) = do_post(
        &app,
        &format!("/api/v1/rooms/{room1_id}/messages"),
        &t1,
        &json!({
            "sender_client_id": c1,
            "epoch": 0,
            "content_type": "application",
            "ciphertext": ciphertext,
            "reply_to": r1_m1_id
        }),
    )
    .await;
    assert_eq!(sx_del, StatusCode::BAD_REQUEST);
    assert_eq!(err_x_del["error"], "invalid_reply_target");
    assert_eq!(err_x_del["details"]["reason"], "deleted");

    // D. Commit or Proposal target -> 400 invalid_reply_target with details.reason = "not_application"
    // Insert a dummy proposal row into room1
    let proposal_id = "01HXXXXXXXPROPOSAL000000";
    sqlx::query(
        "INSERT INTO room_messages (id, room_id, sender_user_id, sender_client_id, epoch, seq, content_type, ciphertext) VALUES (?, ?, ?, ?, 0, 99, 'proposal', ?)",
    )
    .bind(proposal_id)
    .bind(&room1_id)
    .bind(&_u1)
    .bind(&c1)
    .bind(b"proposal ct".as_slice())
    .execute(&pool)
    .await
    .unwrap();

    let (sx_prop, err_x_prop) = do_post(
        &app,
        &format!("/api/v1/rooms/{room1_id}/messages"),
        &t1,
        &json!({
            "sender_client_id": c1,
            "epoch": 0,
            "content_type": "application",
            "ciphertext": ciphertext,
            "reply_to": proposal_id
        }),
    )
    .await;
    assert_eq!(sx_prop, StatusCode::BAD_REQUEST);
    assert_eq!(err_x_prop["error"], "invalid_reply_target");
    assert_eq!(err_x_prop["details"]["reason"], "not_application");
}

#[tokio::test]
async fn test_non_member_cannot_send_reply() {
    let (app, pool, _) = setup_test_app_with_config(true, "auto", 100).await;
    let (_u1, t1, _c1) = create_test_user_with_device(&app, &pool, "mt_nm1").await;
    let (_u2, t2, c2) = create_test_user_with_device(&app, &pool, "mt_nm2").await;

    let room_id = create_room(&app, &t1).await;
    let ciphertext = BASE64.encode(b"ciphertext");

    let (status, err_res) = do_post(
        &app,
        &format!("/api/v1/rooms/{room_id}/messages"),
        &t2,
        &json!({
            "sender_client_id": c2,
            "epoch": 0,
            "content_type": "application",
            "ciphertext": ciphertext,
            "reply_to": "01HXXXXXXXNONEXISTENT000"
        }),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(err_res["error"], "room_not_found");
}

#[tokio::test]
async fn test_event_payload_and_publish_failure_handling() {
    let (app, pool, mock_server) = setup_test_app_with_sockudo_mock().await;
    let (_u1, t1, c1) = create_test_user_with_device(&app, &pool, "mt_ev").await;
    let room_id = create_room(&app, &t1).await;

    let ciphertext = BASE64.encode(b"ciphertext");

    // Message 1
    let (s1, body1) = do_post(
        &app,
        &format!("/api/v1/rooms/{room_id}/messages"),
        &t1,
        &json!({
            "sender_client_id": c1,
            "epoch": 0,
            "content_type": "application",
            "ciphertext": ciphertext
        }),
    )
    .await;
    // Even if Sockudo publishing fails with 500, HTTP response is still 201 CREATED
    assert_eq!(s1, StatusCode::CREATED);
    let m1_id = body1["message_id"].as_str().unwrap().to_string();

    // Message 2 replying to Message 1
    let (s2, body2) = do_post(
        &app,
        &format!("/api/v1/rooms/{room_id}/messages"),
        &t1,
        &json!({
            "sender_client_id": c1,
            "epoch": 0,
            "content_type": "application",
            "ciphertext": ciphertext,
            "reply_to": m1_id
        }),
    )
    .await;
    assert_eq!(s2, StatusCode::CREATED);
    assert_eq!(body2["reply_to"], m1_id);

    // Verify mock server received event requests
    let requests = mock_server.received_requests().await.unwrap();
    assert!(!requests.is_empty());

    for req in requests {
        let body_json: Value = serde_json::from_slice(&req.body).unwrap();
        // Pusher payload contains data stringified
        if let Some(data_str) = body_json["data"].as_str() {
            let data_val: Value = serde_json::from_str(data_str).unwrap();
            // Verify ciphertext is NEVER present in event payloads
            assert!(data_val.get("ciphertext").is_none());
            // Verify reply_to is present
            if body_json["name"] == "message.new" {
                assert!(data_val.get("reply_to").is_some());
            }
        }
    }
}
