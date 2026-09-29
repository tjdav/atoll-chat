mod common;

use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use hmac::{Hmac, Mac};
use serde_json::{json, Value};
use server::config::Config;
use server::sockudo::{Publisher, SockudoConfig, SockudoError};
use sha2::Sha256;

use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

type HmacSha256 = Hmac<Sha256>;

fn hmac_sha256_hex(secret: &str, data: &str) -> String {
    let mut mac =
        HmacSha256::new_from_slice(secret.as_bytes()).expect("HMAC can take key of any size");
    mac.update(data.as_bytes());
    hex::encode(mac.finalize().into_bytes())
}

fn create_test_config(key: &str, secret: &str) -> Config {
    Config {
        opaque_oprf_key_path: "./data/oprf.key".to_string(),
        cleanup_startup_delay_secs: 30,
        sockudo_app_key: key.to_string(),
        sockudo_app_secret: secret.to_string(),
        ..Config::test_default()
    }
}

#[tokio::test]
async fn test_first_startup_generates_app_credentials() {
    let pool = common::setup_test_db().await;
    let config = create_test_config("auto", "auto");

    let sockudo_cfg = SockudoConfig::load_or_initialize(&pool, &config)
        .await
        .unwrap();

    assert!(!sockudo_cfg.app_key.is_empty());
    assert!(!sockudo_cfg.app_secret.is_empty());

    let db_key: (String,) =
        sqlx::query_as("SELECT value FROM instance_config WHERE key = 'sockudo_app_key'")
            .fetch_one(&pool)
            .await
            .unwrap();
    let db_secret: (String,) =
        sqlx::query_as("SELECT value FROM instance_config WHERE key = 'sockudo_app_secret'")
            .fetch_one(&pool)
            .await
            .unwrap();

    assert_eq!(db_key.0, sockudo_cfg.app_key);
    assert_eq!(db_secret.0, sockudo_cfg.app_secret);
}

#[tokio::test]
async fn test_subsequent_startup_loads_existing_credentials() {
    let pool = common::setup_test_db().await;
    let config = create_test_config("auto", "auto");

    let first = SockudoConfig::load_or_initialize(&pool, &config)
        .await
        .unwrap();
    let second = SockudoConfig::load_or_initialize(&pool, &config)
        .await
        .unwrap();

    assert_eq!(first.app_key, second.app_key);
    assert_eq!(first.app_secret, second.app_secret);
}

#[tokio::test]
async fn test_externally_configured_credentials_used_as_is() {
    let pool = common::setup_test_db().await;
    let config = create_test_config("fixed-key", "fixed-secret");

    let sockudo_cfg = SockudoConfig::load_or_initialize(&pool, &config)
        .await
        .unwrap();

    assert_eq!(sockudo_cfg.app_key, "fixed-key");
    assert_eq!(sockudo_cfg.app_secret, "fixed-secret");

    let db_rows: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM instance_config WHERE key LIKE 'sockudo_%'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(db_rows.0, 0);
}

#[tokio::test]
async fn test_mixed_auto_explicit_credentials_fail() {
    let pool = common::setup_test_db().await;
    let config = create_test_config("auto", "fixed-secret");

    let res = SockudoConfig::load_or_initialize(&pool, &config).await;
    assert!(matches!(res, Err(SockudoError::InvalidConfig(_))));
}

#[tokio::test]
async fn test_channel_auth_endpoints() {
    let (app, pool, _) = common::setup_test_app_with_config(true, "auto", 100).await;

    // Register user A and login
    let _user_a_id = common::register_user(&app, "usera", "Password123!", None).await;
    let (status, login_res_a) =
        common::login_user(&app, "usera", "Password123!", "client_a_123456789", None).await;
    assert_eq!(status, StatusCode::OK);
    let token_a = login_res_a["session_token"].as_str().unwrap();

    // Create invite for User B
    sqlx::query(
        "INSERT INTO server_invites (id, code, max_uses, current_uses) VALUES ('inv_b', 'INVITEB1234', 1, 0)",
    )
    .execute(&pool)
    .await
    .unwrap();

    // Register user B and login
    let _user_b_id =
        common::register_user(&app, "userb", "Password123!", Some("INVITEB1234")).await;
    let (status, login_res_b) =
        common::login_user(&app, "userb", "Password123!", "client_b_123456789", None).await;
    assert_eq!(status, StatusCode::OK);
    let token_b = login_res_b["session_token"].as_str().unwrap();

    // User A creates a room
    let create_room_req = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({}).to_string()))
        .unwrap();

    let resp = tower::ServiceExt::oneshot(app.clone(), create_room_req)
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED);
    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let room_json: Value = serde_json::from_slice(&body_bytes).unwrap();
    let room_id = room_json["id"].as_str().unwrap();

    // 5. Channel auth returns valid signature for owner (User A)
    let socket_id = "1234.5678";
    let channel_name = format!("private-room-{}", room_id);

    let auth_req = Request::builder()
        .method("POST")
        .uri("/api/v1/sockudo/auth")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "socket_id": socket_id,
                "channel_name": channel_name,
            })
            .to_string(),
        ))
        .unwrap();

    let auth_resp = tower::ServiceExt::oneshot(app.clone(), auth_req)
        .await
        .unwrap();
    assert_eq!(auth_resp.status(), StatusCode::OK);
    let auth_body_bytes = axum::body::to_bytes(auth_resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let auth_json: Value = serde_json::from_slice(&auth_body_bytes).unwrap();
    let auth_str = auth_json["auth"].as_str().unwrap();

    // Verify expected auth signature format and calculation
    let string_to_sign = format!("{}:{}", socket_id, channel_name);
    let expected_sig = hmac_sha256_hex("test-secret", &string_to_sign);
    let expected_auth = format!("test-key:{}", expected_sig);
    assert_eq!(auth_str, expected_auth);

    // 6. Channel auth rejects non-members (User B) with 403
    let auth_req_b = Request::builder()
        .method("POST")
        .uri("/api/v1/sockudo/auth")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_b))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "socket_id": socket_id,
                "channel_name": channel_name,
            })
            .to_string(),
        ))
        .unwrap();

    let auth_resp_b = tower::ServiceExt::oneshot(app.clone(), auth_req_b)
        .await
        .unwrap();
    assert_eq!(auth_resp_b.status(), StatusCode::FORBIDDEN);

    // 7. Channel auth rejects unknown rooms with 403
    let auth_req_unknown = Request::builder()
        .method("POST")
        .uri("/api/v1/sockudo/auth")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "socket_id": socket_id,
                "channel_name": "private-room-nonexistentroomid",
            })
            .to_string(),
        ))
        .unwrap();

    let auth_resp_unknown = tower::ServiceExt::oneshot(app.clone(), auth_req_unknown)
        .await
        .unwrap();
    assert_eq!(auth_resp_unknown.status(), StatusCode::FORBIDDEN);

    // 8. Channel auth rejects malformed socket_id with 400
    let auth_req_bad_socket = Request::builder()
        .method("POST")
        .uri("/api/v1/sockudo/auth")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "socket_id": "abc",
                "channel_name": channel_name,
            })
            .to_string(),
        ))
        .unwrap();

    let auth_resp_bad_socket = tower::ServiceExt::oneshot(app.clone(), auth_req_bad_socket)
        .await
        .unwrap();
    assert_eq!(auth_resp_bad_socket.status(), StatusCode::BAD_REQUEST);

    // 9. Channel auth rejects malformed channel_name with 400
    let auth_req_bad_channel = Request::builder()
        .method("POST")
        .uri("/api/v1/sockudo/auth")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "socket_id": socket_id,
                "channel_name": "room-123",
            })
            .to_string(),
        ))
        .unwrap();

    let auth_resp_bad_channel = tower::ServiceExt::oneshot(app.clone(), auth_req_bad_channel)
        .await
        .unwrap();
    assert_eq!(auth_resp_bad_channel.status(), StatusCode::BAD_REQUEST);

    // 10-12. Capabilities assertions
    let cap_req = Request::builder()
        .method("GET")
        .uri("/api/v1/capabilities")
        .body(Body::empty())
        .unwrap();

    let cap_resp = tower::ServiceExt::oneshot(app.clone(), cap_req)
        .await
        .unwrap();
    assert_eq!(cap_resp.status(), StatusCode::OK);
    let cap_body_bytes = axum::body::to_bytes(cap_resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let cap_json: Value = serde_json::from_slice(&cap_body_bytes).unwrap();

    assert!(cap_json["websocket_url"]
        .as_str()
        .unwrap()
        .starts_with("ws://"));
    assert_eq!(cap_json["sockudo_app_key"].as_str().unwrap(), "test-key");
    assert_eq!(
        cap_json["sockudo_channel_prefix"].as_str().unwrap(),
        "private-room-"
    );
    assert!(cap_json["sockudo_client_events"].as_bool().unwrap());

    let _ = pool;
}

#[tokio::test]
async fn test_publisher_publish_mock() {
    let mock_server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/apps/chat/events"))
        .respond_with(ResponseTemplate::new(200))
        .mount(&mock_server)
        .await;

    let config = SockudoConfig {
        http_base: mock_server.uri(),
        app_id: "chat".to_string(),
        app_key: "test-app-key".to_string(),
        app_secret: "test-app-secret".to_string(),
        enable_client_events: true,
    };

    let publisher = Publisher::new(config);

    // Test 13. publish sends a correctly signed request
    let res = publisher
        .publish("private-room-abc", "message.new", json!({"content": "hi"}))
        .await;
    assert!(res.is_ok());

    let requests = mock_server.received_requests().await.unwrap();
    assert_eq!(requests.len(), 1);

    let req = &requests[0];
    assert!(req.url.query().unwrap().contains("auth_signature="));

    let body_json: Value = serde_json::from_slice(&req.body).unwrap();
    assert_eq!(body_json["name"], "message.new");
    assert_eq!(body_json["channels"], json!(["private-room-abc"]));
    assert!(body_json["data"].is_string());
}

#[tokio::test]
async fn test_publisher_failure_handling() {
    let mock_server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/apps/chat/events"))
        .respond_with(ResponseTemplate::new(500))
        .mount(&mock_server)
        .await;

    let config = SockudoConfig {
        http_base: mock_server.uri(),
        app_id: "chat".to_string(),
        app_key: "test-app-key".to_string(),
        app_secret: "test-app-secret".to_string(),
        enable_client_events: true,
    };

    let publisher = Publisher::new(config);

    // Test 14. publish failure does not panic
    let res = publisher
        .publish("private-room-abc", "message.new", json!({"content": "hi"}))
        .await;
    assert!(matches!(res, Err(SockudoError::PublishFailed(_))));
}
