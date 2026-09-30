use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use axum::Router;
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use serde_json::{json, Value};
use sqlx::SqlitePool;
use std::path::Path;
use std::sync::Arc;
use tower::ServiceExt;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

mod common;
use common::{login_user, register_user};

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
        server::OpaqueServer::load_or_generate(Path::new("./data/test_oprf.key")).unwrap(),
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

    let state = server::AppState {
        pool: pool.clone(),
        opaque_server,
        registration_store,
        login_store,
        altcha_config,
        config: Arc::new(config),
        server_hard_max,
        publisher,
        storage,
        backup_lock: Arc::new(tokio::sync::Mutex::new(())),
        vapid_keys: None,
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

#[allow(dead_code)]
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
async fn test_01_message_new_published_after_application_message_submission() {
    let (app, pool, mock_server) = setup_test_app_with_sockudo_mock().await;
    let (_user_a, token_a, client_id_a) = create_test_user_with_device(&app, &pool, "evt1_a").await;
    let room_id = create_room(&app, &token_a).await;

    let ct_b64 = BASE64.encode(b"hello world");
    let (status, body) = do_post(
        &app,
        &format!("/api/v1/rooms/{room_id}/messages"),
        &token_a,
        &json!({
            "sender_client_id": client_id_a,
            "epoch": 0,
            "content_type": "application",
            "ciphertext": ct_b64,
        }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);

    let requests = mock_server.received_requests().await.unwrap();
    assert_eq!(requests.len(), 1);

    let req = &requests[0];
    assert!(req.url.query().unwrap().contains("auth_signature="));

    let body_json: Value = serde_json::from_slice(&req.body).unwrap();
    assert_eq!(body_json["name"], "message.new");
    assert_eq!(
        body_json["channels"],
        json!([format!("private-room-{}", room_id)])
    );

    let data_str = body_json["data"].as_str().unwrap();
    let data_json: Value = serde_json::from_str(data_str).unwrap();
    assert_eq!(data_json["id"], body["message_id"].as_str().unwrap());
    assert_eq!(data_json["room_id"], room_id);
    assert_eq!(data_json["content_type"], "application");
}

#[tokio::test]
async fn test_02_commit_publishes_message_new_and_epoch_updated() {
    let (app, pool, mock_server) = setup_test_app_with_sockudo_mock().await;
    let (_user_a, token_a, client_id_a) = create_test_user_with_device(&app, &pool, "evt2_a").await;
    let room_id = create_room(&app, &token_a).await;

    let ct_b64 = BASE64.encode(b"commit payload");
    let th_b64 = BASE64.encode([7u8; 32]);

    let (status, _) = do_post(
        &app,
        &format!("/api/v1/rooms/{room_id}/messages"),
        &token_a,
        &json!({
            "sender_client_id": client_id_a,
            "epoch": 0,
            "content_type": "commit",
            "ciphertext": ct_b64,
            "transcript_hash": th_b64,
        }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);

    let requests = mock_server.received_requests().await.unwrap();
    assert_eq!(requests.len(), 2);

    let names: Vec<String> = requests
        .iter()
        .map(|r| {
            let body: Value = serde_json::from_slice(&r.body).unwrap();
            body["name"].as_str().unwrap().to_string()
        })
        .collect();

    assert!(names.contains(&"message.new".to_string()));
    assert!(names.contains(&"epoch.updated".to_string()));
}

#[tokio::test]
async fn test_05_message_deleted_published_after_deletion() {
    let (app, pool, mock_server) = setup_test_app_with_sockudo_mock().await;
    let (_user_a, token_a, client_id_a) = create_test_user_with_device(&app, &pool, "evt5_a").await;
    let room_id = create_room(&app, &token_a).await;

    let ct_b64 = BASE64.encode(b"hello world");
    let (_, post_body) = do_post(
        &app,
        &format!("/api/v1/rooms/{room_id}/messages"),
        &token_a,
        &json!({
            "sender_client_id": client_id_a,
            "epoch": 0,
            "content_type": "application",
            "ciphertext": ct_b64,
        }),
    )
    .await;
    let msg_id = post_body["message_id"].as_str().unwrap();

    let (del_status, _) = do_delete(
        &app,
        &format!("/api/v1/rooms/{room_id}/messages/{msg_id}"),
        &token_a,
    )
    .await;
    assert_eq!(del_status, StatusCode::NO_CONTENT);

    let requests = mock_server.received_requests().await.unwrap();
    assert_eq!(requests.len(), 2); // 1: message.new, 2: message.deleted

    let body_json: Value = serde_json::from_slice(&requests[1].body).unwrap();
    assert_eq!(body_json["name"], "message.deleted");

    let data_str = body_json["data"].as_str().unwrap();
    let data_json: Value = serde_json::from_str(data_str).unwrap();
    assert_eq!(data_json["id"], msg_id);
    assert_eq!(data_json["room_id"], room_id);
}

#[tokio::test]
async fn test_06_room_member_added_and_removed_events() {
    let (app, pool, mock_server) = setup_test_app_with_sockudo_mock().await;
    let (_user_a, token_a, _) = create_test_user_with_device(&app, &pool, "evt6_a").await;
    let (user_b, _token_b, _) = create_test_user_with_device(&app, &pool, "evt6_b").await;

    let room_id = create_room(&app, &token_a).await;

    // Add member B
    let (add_status, _) = do_post(
        &app,
        &format!("/api/v1/rooms/{room_id}/members"),
        &token_a,
        &json!({ "user_id": user_b }),
    )
    .await;
    assert_eq!(add_status, StatusCode::CREATED);

    // Kick member B
    let (kick_status, _) = do_delete(
        &app,
        &format!("/api/v1/rooms/{room_id}/members/{user_b}"),
        &token_a,
    )
    .await;
    assert_eq!(kick_status, StatusCode::NO_CONTENT);

    // Leave room
    let (leave_status, _) = do_post(
        &app,
        &format!("/api/v1/rooms/{room_id}/leave"),
        &token_a,
        &json!({}),
    )
    .await;
    assert_eq!(leave_status, StatusCode::OK);

    let requests = mock_server.received_requests().await.unwrap();
    assert_eq!(requests.len(), 3); // 1: member_added, 2: member_removed (kick), 3: member_removed (leave)

    let body_1: Value = serde_json::from_slice(&requests[0].body).unwrap();
    assert_eq!(body_1["name"], "room.member_added");

    let body_2: Value = serde_json::from_slice(&requests[1].body).unwrap();
    assert_eq!(body_2["name"], "room.member_removed");

    let body_3: Value = serde_json::from_slice(&requests[2].body).unwrap();
    assert_eq!(body_3["name"], "room.member_removed");
}

#[tokio::test]
async fn test_09_publish_failures_do_not_affect_http_response() {
    let mock_server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/apps/chat/events"))
        .respond_with(ResponseTemplate::new(500))
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
        server::OpaqueServer::load_or_generate(Path::new("./data/test_oprf2.key")).unwrap(),
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

    let state = server::AppState {
        pool: pool.clone(),
        opaque_server,
        registration_store,
        login_store,
        altcha_config,
        config: Arc::new(config),
        server_hard_max,
        publisher,
        storage,
        backup_lock: Arc::new(tokio::sync::Mutex::new(())),
        vapid_keys: None,
    };

    let app = server::build_app(state);

    let (_user_a, token_a, client_id_a) = create_test_user_with_device(&app, &pool, "evt9_a").await;
    let room_id = create_room(&app, &token_a).await;

    let ct_b64 = BASE64.encode(b"hello world");
    let (status, _) = do_post(
        &app,
        &format!("/api/v1/rooms/{room_id}/messages"),
        &token_a,
        &json!({
            "sender_client_id": client_id_a,
            "epoch": 0,
            "content_type": "application",
            "ciphertext": ct_b64,
        }),
    )
    .await;

    assert_eq!(status, StatusCode::CREATED);
}

#[tokio::test]
async fn test_10_no_publish_when_transaction_fails() {
    let (app, pool, mock_server) = setup_test_app_with_sockudo_mock().await;
    let (_user_a, token_a, client_id_a) =
        create_test_user_with_device(&app, &pool, "evt10_a").await;
    let room_id = create_room(&app, &token_a).await;

    let ct_b64 = BASE64.encode(b"hello world");
    let (status, body) = do_post(
        &app,
        &format!("/api/v1/rooms/{room_id}/messages"),
        &token_a,
        &json!({
            "sender_client_id": client_id_a,
            "epoch": 999, // Mismatched epoch
            "content_type": "application",
            "ciphertext": ct_b64,
        }),
    )
    .await;

    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(body["error"], "epoch_mismatch");

    let requests = mock_server.received_requests().await.unwrap();
    assert_eq!(requests.len(), 0);
}
