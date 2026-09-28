mod common;

use axum::{
    body::Body,
    http::{header, Request, StatusCode},
};
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use common::{login_user, register_user, setup_test_app, setup_test_db};
use serde_json::{json, Value};
use server::{sockudo::Publisher, sockudo::SockudoConfig, Config};
use tower::ServiceExt;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

#[tokio::test]
async fn test_01_first_startup_generates_app_credentials() {
    let pool = setup_test_db().await;
    let mut config = Config::from_env().unwrap_or_else(|_| Config {
        app_env: "development".to_string(),
        app_url: None,
        app_name: "Test".to_string(),
        log_level: "info".to_string(),
        server_bind: "127.0.0.1:0".to_string(),
        db_path: ":memory:".to_string(),
        db_busy_timeout_ms: 5000,
        opaque_oprf_key_path: "./data/oprf.key".to_string(),
        altcha_enabled: false,
        altcha_hmac_secret: "auto".to_string(),
        altcha_algorithm: "PBKDF2/SHA-256".to_string(),
        altcha_cost: 100,
        session_expiry_days: 30,
        session_sliding: true,
        max_file_size_bytes: 104_857_600,
        server_max_devices_per_user: 20,
        invite_default_uses: 1,
        invite_expiry_days: 0,
        invite_code_length: 8,
        invite_limited_max_uses: 10,
        invite_limited_max_open: 50,
        room_invite_default_uses: 1,
        room_invite_code_length: 8,
        rate_limits: server::config::RateLimitConfig {
            invite_create_hourly: 50,
            invite_create_daily: 200,
            invite_redeem_per_min: 10,
            kp_claim_per_min: 30,
            kp_claim_hourly: 200,
            login_per_min: 10,
            login_lockout_min: 15,
            export_rate_limit_hours: 24,
        },
        cleanup_enabled: true,
        cleanup_interval_minutes: 60,
        cleanup_startup_delay_secs: 30,
        audit_retention_days: 90,
        data_retention_days: 0,
        export_rate_limit_hours: 24,
        trust_proxy: false,
        hsts_max_age: 31536000,
        hsts_include_subdomains: true,
        client_static_dir: None,
        sockudo_url: "http://localhost:6001".to_string(),
        sockudo_app_id: "chat".to_string(),
        sockudo_app_key: "auto".to_string(),
        sockudo_app_secret: "auto".to_string(),
        sockudo_public_url: None,
        storage_backend: "fs".to_string(),
        storage_fs_path: std::path::PathBuf::from("./data/attachments"),
        s3_endpoint: None,
        s3_region: "us-east-1".to_string(),
        s3_bucket: None,
        s3_access_key_id: None,
        s3_secret_access_key: None,
        s3_path_style: false,
        s3_presign_ttl_seconds: 600,
        attachment_chunk_size: 65536,
        attachment_bucket_sizes: vec![65536, 524288, 4194304, 33554432],
    });

    config.sockudo_app_key = "auto".to_string();
    config.sockudo_app_secret = "auto".to_string();

    let sock_cfg = SockudoConfig::load_or_initialize(&pool, &config)
        .await
        .unwrap();

    assert!(!sock_cfg.app_key.is_empty());
    assert!(!sock_cfg.app_secret.is_empty());
    assert_ne!(sock_cfg.app_key, "auto");
    assert_ne!(sock_cfg.app_secret, "auto");

    let db_key: String =
        sqlx::query_scalar("SELECT value FROM instance_config WHERE key = 'sockudo_app_key'")
            .fetch_one(&pool)
            .await
            .unwrap();

    let db_secret: String =
        sqlx::query_scalar("SELECT value FROM instance_config WHERE key = 'sockudo_app_secret'")
            .fetch_one(&pool)
            .await
            .unwrap();

    assert_eq!(db_key, sock_cfg.app_key);
    assert_eq!(db_secret, sock_cfg.app_secret);
}

#[tokio::test]
async fn test_02_subsequent_startup_loads_existing_credentials() {
    let pool = setup_test_db().await;
    let mut config = Config::from_env().unwrap_or_else(|_| Config {
        app_env: "development".to_string(),
        app_url: None,
        app_name: "Test".to_string(),
        log_level: "info".to_string(),
        server_bind: "127.0.0.1:0".to_string(),
        db_path: ":memory:".to_string(),
        db_busy_timeout_ms: 5000,
        opaque_oprf_key_path: "./data/oprf.key".to_string(),
        altcha_enabled: false,
        altcha_hmac_secret: "auto".to_string(),
        altcha_algorithm: "PBKDF2/SHA-256".to_string(),
        altcha_cost: 100,
        session_expiry_days: 30,
        session_sliding: true,
        max_file_size_bytes: 104_857_600,
        server_max_devices_per_user: 20,
        invite_default_uses: 1,
        invite_expiry_days: 0,
        invite_code_length: 8,
        invite_limited_max_uses: 10,
        invite_limited_max_open: 50,
        room_invite_default_uses: 1,
        room_invite_code_length: 8,
        rate_limits: server::config::RateLimitConfig {
            invite_create_hourly: 50,
            invite_create_daily: 200,
            invite_redeem_per_min: 10,
            kp_claim_per_min: 30,
            kp_claim_hourly: 200,
            login_per_min: 10,
            login_lockout_min: 15,
            export_rate_limit_hours: 24,
        },
        cleanup_enabled: true,
        cleanup_interval_minutes: 60,
        cleanup_startup_delay_secs: 30,
        audit_retention_days: 90,
        data_retention_days: 0,
        export_rate_limit_hours: 24,
        trust_proxy: false,
        hsts_max_age: 31536000,
        hsts_include_subdomains: true,
        client_static_dir: None,
        sockudo_url: "http://localhost:6001".to_string(),
        sockudo_app_id: "chat".to_string(),
        sockudo_app_key: "auto".to_string(),
        sockudo_app_secret: "auto".to_string(),
        sockudo_public_url: None,
        storage_backend: "fs".to_string(),
        storage_fs_path: std::path::PathBuf::from("./data/attachments"),
        s3_endpoint: None,
        s3_region: "us-east-1".to_string(),
        s3_bucket: None,
        s3_access_key_id: None,
        s3_secret_access_key: None,
        s3_path_style: false,
        s3_presign_ttl_seconds: 600,
        attachment_chunk_size: 65536,
        attachment_bucket_sizes: vec![65536, 524288, 4194304, 33554432],
    });

    config.sockudo_app_key = "auto".to_string();
    config.sockudo_app_secret = "auto".to_string();

    let sock_cfg1 = SockudoConfig::load_or_initialize(&pool, &config)
        .await
        .unwrap();

    let sock_cfg2 = SockudoConfig::load_or_initialize(&pool, &config)
        .await
        .unwrap();

    assert_eq!(sock_cfg1.app_key, sock_cfg2.app_key);
    assert_eq!(sock_cfg1.app_secret, sock_cfg2.app_secret);
}

#[tokio::test]
async fn test_03_externally_configured_credentials_are_used_as_is() {
    let pool = setup_test_db().await;
    let mut config = Config::from_env().unwrap_or_else(|_| Config {
        app_env: "development".to_string(),
        app_url: None,
        app_name: "Test".to_string(),
        log_level: "info".to_string(),
        server_bind: "127.0.0.1:0".to_string(),
        db_path: ":memory:".to_string(),
        db_busy_timeout_ms: 5000,
        opaque_oprf_key_path: "./data/oprf.key".to_string(),
        altcha_enabled: false,
        altcha_hmac_secret: "auto".to_string(),
        altcha_algorithm: "PBKDF2/SHA-256".to_string(),
        altcha_cost: 100,
        session_expiry_days: 30,
        session_sliding: true,
        max_file_size_bytes: 104_857_600,
        server_max_devices_per_user: 20,
        invite_default_uses: 1,
        invite_expiry_days: 0,
        invite_code_length: 8,
        invite_limited_max_uses: 10,
        invite_limited_max_open: 50,
        room_invite_default_uses: 1,
        room_invite_code_length: 8,
        rate_limits: server::config::RateLimitConfig {
            invite_create_hourly: 50,
            invite_create_daily: 200,
            invite_redeem_per_min: 10,
            kp_claim_per_min: 30,
            kp_claim_hourly: 200,
            login_per_min: 10,
            login_lockout_min: 15,
            export_rate_limit_hours: 24,
        },
        cleanup_enabled: true,
        cleanup_interval_minutes: 60,
        cleanup_startup_delay_secs: 30,
        audit_retention_days: 90,
        data_retention_days: 0,
        export_rate_limit_hours: 24,
        trust_proxy: false,
        hsts_max_age: 31536000,
        hsts_include_subdomains: true,
        client_static_dir: None,
        sockudo_url: "http://localhost:6001".to_string(),
        sockudo_app_id: "chat".to_string(),
        sockudo_app_key: "fixed-key".to_string(),
        sockudo_app_secret: "fixed-secret".to_string(),
        sockudo_public_url: None,
        storage_backend: "fs".to_string(),
        storage_fs_path: std::path::PathBuf::from("./data/attachments"),
        s3_endpoint: None,
        s3_region: "us-east-1".to_string(),
        s3_bucket: None,
        s3_access_key_id: None,
        s3_secret_access_key: None,
        s3_path_style: false,
        s3_presign_ttl_seconds: 600,
        attachment_chunk_size: 65536,
        attachment_bucket_sizes: vec![65536, 524288, 4194304, 33554432],
    });

    config.sockudo_app_key = "fixed-key".to_string();
    config.sockudo_app_secret = "fixed-secret".to_string();

    let sock_cfg = SockudoConfig::load_or_initialize(&pool, &config)
        .await
        .unwrap();

    assert_eq!(sock_cfg.app_key, "fixed-key");
    assert_eq!(sock_cfg.app_secret, "fixed-secret");

    let count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM instance_config WHERE key LIKE 'sockudo_%'")
            .fetch_one(&pool)
            .await
            .unwrap();

    assert_eq!(count, 0);
}

#[tokio::test]
async fn test_04_publish_sends_signed_pusher_request() {
    let mock_server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/apps/chat/events"))
        .respond_with(ResponseTemplate::new(200))
        .expect(1)
        .mount(&mock_server)
        .await;

    let sock_cfg = SockudoConfig {
        http_base: mock_server.uri(),
        app_id: "chat".to_string(),
        app_key: "my-key".to_string(),
        app_secret: "my-secret".to_string(),
    };

    let publisher = Publisher::new(sock_cfg);
    let res = publisher
        .publish("private-room-123", "message", json!({"hello": "world"}))
        .await;

    assert!(res.is_ok());

    let requests = mock_server.received_requests().await.unwrap();
    assert_eq!(requests.len(), 1);

    let req = &requests[0];
    let uri = req.url.to_string();
    assert!(uri.contains("auth_key=my-key"));
    assert!(uri.contains("auth_signature="));
    assert!(uri.contains("body_md5="));
}

#[tokio::test]
async fn test_05_publish_body_matches_pusher_spec() {
    let mock_server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/apps/chat/events"))
        .respond_with(ResponseTemplate::new(200))
        .expect(1)
        .mount(&mock_server)
        .await;

    let sock_cfg = SockudoConfig {
        http_base: mock_server.uri(),
        app_id: "chat".to_string(),
        app_key: "my-key".to_string(),
        app_secret: "my-secret".to_string(),
    };

    let publisher = Publisher::new(sock_cfg);
    publisher
        .publish(
            "private-room-abc",
            "message",
            json!({"type": "application"}),
        )
        .await
        .unwrap();

    let requests = mock_server.received_requests().await.unwrap();
    let req_body_json: Value = serde_json::from_slice(&requests[0].body).unwrap();

    assert_eq!(req_body_json["name"], "message");
    assert_eq!(req_body_json["channels"], json!(["private-room-abc"]));
    assert!(req_body_json["data"].is_string());

    let inner_data: Value = serde_json::from_str(req_body_json["data"].as_str().unwrap()).unwrap();
    assert_eq!(inner_data["type"], "application");
}

#[tokio::test]
async fn test_06_publish_failure_does_not_propagate() {
    let (app, _pool) = setup_test_app().await;

    let _user_id = register_user(&app, "alice", "password123", None).await;
    let (_, login_body) =
        login_user(&app, "alice", "password123", "client_a_123456789", None).await;
    let token = login_body["session_token"].as_str().unwrap();

    let req_create = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from("{}"))
        .unwrap();

    let resp_create = app.clone().oneshot(req_create).await.unwrap();
    assert_eq!(resp_create.status(), StatusCode::CREATED);
    let body_bytes = axum::body::to_bytes(resp_create.into_body(), usize::MAX)
        .await
        .unwrap();
    let room_json: Value = serde_json::from_slice(&body_bytes).unwrap();
    let room_id = room_json["id"].as_str().unwrap();

    let ct_b64 = BASE64.encode(b"ciphertext");

    let req_msg = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/messages", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "sender_client_id": "client_a_123456789",
                "epoch": 0,
                "content_type": "application",
                "ciphertext": ct_b64
            })
            .to_string(),
        ))
        .unwrap();

    let resp_msg = app.clone().oneshot(req_msg).await.unwrap();
    assert_eq!(resp_msg.status(), StatusCode::CREATED);
}

#[tokio::test]
async fn test_07_channel_auth_signs_correctly() {
    let (app, _pool) = setup_test_app().await;

    let _user_id = register_user(&app, "alice", "password123", None).await;
    let (_, login_body) =
        login_user(&app, "alice", "password123", "client_a_123456789", None).await;
    let token = login_body["session_token"].as_str().unwrap();

    let req_create = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from("{}"))
        .unwrap();

    let resp_create = app.clone().oneshot(req_create).await.unwrap();
    let body_bytes = axum::body::to_bytes(resp_create.into_body(), usize::MAX)
        .await
        .unwrap();
    let room_json: Value = serde_json::from_slice(&body_bytes).unwrap();
    let room_id = room_json["id"].as_str().unwrap();

    let req_auth = Request::builder()
        .method("POST")
        .uri("/api/v1/sockudo/auth")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "socket_id": "1234.5678",
                "channel_name": format!("private-room-{}", room_id)
            })
            .to_string(),
        ))
        .unwrap();

    let resp_auth = app.clone().oneshot(req_auth).await.unwrap();
    assert_eq!(resp_auth.status(), StatusCode::OK);

    let auth_bytes = axum::body::to_bytes(resp_auth.into_body(), usize::MAX)
        .await
        .unwrap();
    let auth_json: Value = serde_json::from_slice(&auth_bytes).unwrap();
    let auth_str = auth_json["auth"].as_str().unwrap();

    assert!(auth_str.starts_with("test-app-key:"));
    assert_eq!(auth_str.split(':').count(), 2);
}

#[tokio::test]
async fn test_08_channel_auth_rejects_non_members() {
    let (app, pool) = setup_test_app().await;

    register_user(&app, "alice", "password123", None).await;
    let (_, login_a) = login_user(&app, "alice", "password123", "client_a_123456789", None).await;
    let token_a = login_a["session_token"].as_str().unwrap();

    sqlx::query(
        "INSERT INTO server_invites (id, code, max_uses, current_uses) VALUES ('inv_1', 'INVITE123', 1, 0)",
    )
    .execute(&pool)
    .await
    .unwrap();

    register_user(&app, "bob", "password123", Some("INVITE123")).await;
    let (_, login_b) = login_user(&app, "bob", "password123", "client_b_123456789", None).await;
    let token_b = login_b["session_token"].as_str().unwrap();

    // Alice creates room
    let req_create = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from("{}"))
        .unwrap();

    let resp_create = app.clone().oneshot(req_create).await.unwrap();
    let body_bytes = axum::body::to_bytes(resp_create.into_body(), usize::MAX)
        .await
        .unwrap();
    let room_json: Value = serde_json::from_slice(&body_bytes).unwrap();
    let room_id = room_json["id"].as_str().unwrap();

    // Bob tries channel auth for Alice's room
    let req_auth = Request::builder()
        .method("POST")
        .uri("/api/v1/sockudo/auth")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_b))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "socket_id": "1234.5678",
                "channel_name": format!("private-room-{}", room_id)
            })
            .to_string(),
        ))
        .unwrap();

    let resp_auth = app.clone().oneshot(req_auth).await.unwrap();
    assert_eq!(resp_auth.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn test_09_channel_auth_rejects_malformed_socket_id() {
    let (app, _pool) = setup_test_app().await;

    register_user(&app, "alice", "password123", None).await;
    let (_, login_a) = login_user(&app, "alice", "password123", "client_a_123456789", None).await;
    let token_a = login_a["session_token"].as_str().unwrap();

    let req_auth = Request::builder()
        .method("POST")
        .uri("/api/v1/sockudo/auth")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "socket_id": "abc",
                "channel_name": "private-room-123"
            })
            .to_string(),
        ))
        .unwrap();

    let resp_auth = app.clone().oneshot(req_auth).await.unwrap();
    assert_eq!(resp_auth.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn test_10_channel_auth_rejects_malformed_channel_name() {
    let (app, _pool) = setup_test_app().await;

    register_user(&app, "alice", "password123", None).await;
    let (_, login_a) = login_user(&app, "alice", "password123", "client_a_123456789", None).await;
    let token_a = login_a["session_token"].as_str().unwrap();

    let req_auth = Request::builder()
        .method("POST")
        .uri("/api/v1/sockudo/auth")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "socket_id": "1234.5678",
                "channel_name": "room-123"
            })
            .to_string(),
        ))
        .unwrap();

    let resp_auth = app.clone().oneshot(req_auth).await.unwrap();
    assert_eq!(resp_auth.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn test_11_capabilities_includes_websocket_url() {
    let (app, _pool) = setup_test_app().await;

    let req = Request::builder()
        .method("GET")
        .uri("/api/v1/capabilities")
        .body(Body::empty())
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_body: Value = serde_json::from_slice(&body_bytes).unwrap();

    assert!(json_body["websocket_url"].is_string());
    assert_eq!(json_body["sockudo_app_key"], "test-app-key");
    assert_eq!(json_body["sockudo_channel_prefix"], "private-room-");
}
