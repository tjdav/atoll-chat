mod common;

use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use axum::Router;
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use chrono::Utc;
use common::{login_user, register_user};
use hmac::{Hmac, Mac};
use serde_json::{json, Value};
use sha1::Sha1;
use sqlx::SqlitePool;
use std::path::Path;
use std::sync::Arc;
use tower::ServiceExt;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

type HmacSha1 = Hmac<Sha1>;

async fn setup_test_app(
    calling_enabled: bool,
    turn_url: &str,
    turn_shared_secret: &str,
    rate_turn_credentials_per_min: u32,
) -> (Router, SqlitePool, MockServer) {
    let mock_server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/apps/chat/events"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"ok": true})))
        .mount(&mock_server)
        .await;

    std::env::set_var("APP_ENV", "development");

    let pool = common::setup_test_db().await;

    let rate_limits = server::RateLimitConfig {
        rate_turn_credentials_per_min,
        ..server::Config::test_default().rate_limits
    };

    let config = server::Config {
        opaque_oprf_key_path: "./data/oprf.key".to_string(),
        altcha_enabled: true,
        altcha_hmac_secret: "auto".to_string(),
        altcha_cost: 100,
        cleanup_startup_delay_secs: 30,
        calling_enabled,
        turn_url: turn_url.to_string(),
        turn_shared_secret: turn_shared_secret.to_string(),
        turn_ttl_seconds: 600,
        rate_limits,
        sockudo_url: mock_server.uri(),
        sockudo_app_key: "test-app-key".to_string(),
        sockudo_app_secret: "test-app-secret".to_string(),
        ..server::Config::test_default()
    };

    let opaque_server = Arc::new(
        server::OpaqueServer::load_or_generate(Path::new("./data/test_oprf_turn.key")).unwrap(),
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
        call_occupancy: server::calls::CallOccupancyStore::new(),
        extension_proxy_blocklist: std::sync::Arc::new(
            server::extensions_proxy::blocklist::DomainBlocklistStore::new(Default::default()),
        ),
    };

    let app = server::build_app(state);
    (app, pool, mock_server)
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

#[tokio::test]
async fn test_turn_credentials_success() {
    let (app, pool, _mock) = setup_test_app(
        true,
        "turn:turn.example.com:3478,turns:turn.example.com:5349",
        "secret-key",
        10,
    )
    .await;
    let (user_id, token) = create_test_user(&app, &pool, "turn_u1", "client_turn_123456").await;

    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/calls/turn-credentials")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({}).to_string()))
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let body: Value = serde_json::from_slice(&body_bytes).unwrap();

    let urls = body["urls"].as_array().expect("urls array");
    assert_eq!(urls.len(), 2);
    assert_eq!(urls[0].as_str().unwrap(), "turn:turn.example.com:3478");
    assert_eq!(urls[1].as_str().unwrap(), "turns:turn.example.com:5349");

    let username = body["username"].as_str().expect("username string");
    let credential = body["credential"].as_str().expect("credential string");
    let ttl = body["ttl"].as_u64().expect("ttl number");

    assert_eq!(ttl, 600);

    let parts: Vec<&str> = username.split(':').collect();
    assert_eq!(parts.len(), 2, "username must have <expiry>:<opaque>");
    let expiry_ts: i64 = parts[0].parse().expect("expiry timestamp integer");
    let now = Utc::now().timestamp();
    assert!(
        expiry_ts >= now + 595 && expiry_ts <= now + 605,
        "expiry_ts {} expected near {}",
        expiry_ts,
        now + 600
    );

    assert!(
        !username.contains(&user_id),
        "username should not contain user_id"
    );

    let mut mac = HmacSha1::new_from_slice(b"secret-key").unwrap();
    mac.update(username.as_bytes());
    let expected_mac = STANDARD.encode(mac.finalize().into_bytes());
    assert_eq!(credential, expected_mac);
}

#[tokio::test]
async fn test_turn_credentials_calling_disabled() {
    let (app, pool, _mock) =
        setup_test_app(false, "turn:turn.example.com:3478", "secret-key", 10).await;
    let (_user_id, token) = create_test_user(&app, &pool, "turn_u2", "client_turn_123456").await;

    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/calls/turn-credentials")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({}).to_string()))
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_IMPLEMENTED);

    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let body: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(body["error"], "calling_disabled");
}

#[tokio::test]
async fn test_turn_credentials_not_configured() {
    let (app, pool, _mock) = setup_test_app(true, "", "", 10).await;
    let (_user_id, token) = create_test_user(&app, &pool, "turn_u3", "client_turn_123456").await;

    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/calls/turn-credentials")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({}).to_string()))
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_IMPLEMENTED);

    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let body: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(body["error"], "turn_not_configured");
}

#[tokio::test]
async fn test_turn_credentials_unauthenticated() {
    let (app, _pool, _mock) =
        setup_test_app(true, "turn:turn.example.com:3478", "secret-key", 10).await;

    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/calls/turn-credentials")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({}).to_string()))
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn test_turn_credentials_rate_limit() {
    let (app, pool, _mock) =
        setup_test_app(true, "turn:turn.example.com:3478", "secret-key", 10).await;
    let (_user_id, token) = create_test_user(&app, &pool, "turn_u4", "client_turn_123456").await;

    for _ in 0..10 {
        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/calls/turn-credentials")
            .header(header::AUTHORIZATION, format!("Bearer {}", token))
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(json!({}).to_string()))
            .unwrap();

        let resp = app.clone().oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
    }

    let req_limited = Request::builder()
        .method("POST")
        .uri("/api/v1/calls/turn-credentials")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({}).to_string()))
        .unwrap();

    let resp_limited = app.oneshot(req_limited).await.unwrap();
    assert_eq!(resp_limited.status(), StatusCode::TOO_MANY_REQUESTS);
    assert!(resp_limited.headers().contains_key("retry-after"));
}

#[tokio::test]
async fn test_startup_validation_turn_url_without_secret() {
    std::env::set_var("APP_ENV", "development");
    std::env::set_var("TURN_URL", "turn:turn.example.com:3478");
    std::env::set_var("TURN_SHARED_SECRET", "");

    let res = server::Config::from_env();
    assert!(res.is_err());
    let err_msg = res.unwrap_err().to_string();
    assert!(
        err_msg.contains("TURN_URL is set but TURN_SHARED_SECRET is empty"),
        "Unexpected error: {}",
        err_msg
    );

    std::env::remove_var("TURN_URL");
    std::env::remove_var("TURN_SHARED_SECRET");
}

#[tokio::test]
async fn test_turn_credentials_no_audit_or_events() {
    let (app, pool, mock_server) =
        setup_test_app(true, "turn:turn.example.com:3478", "secret-key", 10).await;
    let (_user_id, token) = create_test_user(&app, &pool, "turn_u5", "client_turn_123456").await;

    let req_count_before = mock_server.received_requests().await.unwrap().len();

    let audit_before: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM audit_log")
        .fetch_one(&pool)
        .await
        .unwrap();

    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/calls/turn-credentials")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({}).to_string()))
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let audit_after: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM audit_log")
        .fetch_one(&pool)
        .await
        .unwrap();

    let req_count_after = mock_server.received_requests().await.unwrap().len();

    assert_eq!(audit_before, audit_after, "Audit log must be unchanged");
    assert_eq!(
        req_count_before, req_count_after,
        "No Sockudo events should be published"
    );
}

#[tokio::test]
async fn test_join_call_turn_credentials_wired() {
    let (app, pool, _mock) = setup_test_app(
        true,
        "turn:turn.example.com:3478,turns:turn.example.com:5349",
        "secret-key",
        10,
    )
    .await;
    let (_user_id, token) =
        create_test_user(&app, &pool, "turn_join_u1", "client_turn_join_101").await;
    let room_id = create_room(&app, &token).await;
    let call_id = format!("c_turn_{}", ulid::Ulid::new());

    let req = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/calls/{}/join", room_id, call_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({ "client_id": "client_turn_join_101" }).to_string(),
        ))
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    // Verify Cache-Control header
    let cache_control = resp.headers().get(header::CACHE_CONTROL).unwrap();
    assert_eq!(cache_control, "no-store");

    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let body: Value = serde_json::from_slice(&body_bytes).unwrap();

    let ice_servers = body["ice_servers"].as_array().expect("ice_servers array");
    assert_eq!(ice_servers.len(), 1);

    let server_obj = &ice_servers[0];
    let urls = server_obj["urls"].as_array().expect("urls array");
    assert_eq!(urls.len(), 2);
    assert_eq!(urls[0].as_str().unwrap(), "turn:turn.example.com:3478");
    assert_eq!(urls[1].as_str().unwrap(), "turns:turn.example.com:5349");

    let username = server_obj["username"].as_str().expect("username string");
    let credential = server_obj["credential"]
        .as_str()
        .expect("credential string");

    // ttl should NOT be in the join response ICE server object per §8.7.5
    assert!(server_obj.get("ttl").is_none());

    // Validate username format: <expiry>:<opaque>
    let parts: Vec<&str> = username.split(':').collect();
    assert_eq!(parts.len(), 2, "username must have <expiry>:<opaque>");
    let expiry_ts: i64 = parts[0].parse().expect("expiry timestamp integer");
    let now = Utc::now().timestamp();
    assert!(
        expiry_ts >= now + 595 && expiry_ts <= now + 605,
        "expiry_ts {} expected near {}",
        expiry_ts,
        now + 600
    );

    // Validate credential HMAC-SHA1 signature and length (20 bytes decoded)
    let cred_bytes = STANDARD
        .decode(credential)
        .expect("valid base64 credential");
    assert_eq!(cred_bytes.len(), 20, "HMAC-SHA1 produces 20 bytes");

    let mut mac = HmacSha1::new_from_slice(b"secret-key").unwrap();
    mac.update(username.as_bytes());
    let expected_mac = STANDARD.encode(mac.finalize().into_bytes());
    assert_eq!(credential, expected_mac);
}

#[tokio::test]
async fn test_join_call_fresh_credentials_no_caching() {
    let (app, pool, _mock) =
        setup_test_app(true, "turn:turn.example.com:3478", "secret-key", 10).await;
    let (_user_id, token) =
        create_test_user(&app, &pool, "turn_join_u2", "client_turn_join_102").await;
    let room_id = create_room(&app, &token).await;

    let call_id1 = format!("c_turn_fresh_1_{}", ulid::Ulid::new());
    let call_id2 = format!("c_turn_fresh_2_{}", ulid::Ulid::new());

    let req1 = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/calls/{}/join", room_id, call_id1))
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({ "client_id": "client_turn_join_102" }).to_string(),
        ))
        .unwrap();

    let resp1 = app.clone().oneshot(req1).await.unwrap();
    let body1: Value = serde_json::from_slice(
        &axum::body::to_bytes(resp1.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    let username1 = body1["ice_servers"][0]["username"]
        .as_str()
        .unwrap()
        .to_string();

    let req2 = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/calls/{}/join", room_id, call_id2))
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({ "client_id": "client_turn_join_102" }).to_string(),
        ))
        .unwrap();

    let resp2 = app.oneshot(req2).await.unwrap();
    let body2: Value = serde_json::from_slice(
        &axum::body::to_bytes(resp2.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    let username2 = body2["ice_servers"][0]["username"]
        .as_str()
        .unwrap()
        .to_string();

    assert_ne!(
        username1, username2,
        "Consecutive joins must generate distinct usernames (fresh random opaque)"
    );
}

#[tokio::test]
async fn test_join_call_turn_unset_returns_empty_ice_servers() {
    let (app, pool, _mock) = setup_test_app(true, "", "", 10).await;
    let (_user_id, token) =
        create_test_user(&app, &pool, "turn_join_u3", "client_turn_join_103").await;
    let room_id = create_room(&app, &token).await;
    let call_id = format!("c_turn_unset_{}", ulid::Ulid::new());

    let req = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/calls/{}/join", room_id, call_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({ "client_id": "client_turn_join_103" }).to_string(),
        ))
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let body: Value = serde_json::from_slice(
        &axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    let ice_servers = body["ice_servers"].as_array().expect("ice_servers array");
    assert_eq!(
        ice_servers.len(),
        0,
        "Unset TURN_URL should return empty ice_servers array"
    );
}

#[tokio::test]
async fn test_join_call_calling_disabled_returns_501() {
    let (app, pool, _mock) =
        setup_test_app(false, "turn:turn.example.com:3478", "secret-key", 10).await;
    let (_user_id, token) =
        create_test_user(&app, &pool, "turn_join_u4", "client_turn_join_104").await;
    let room_id = create_room(&app, &token).await;
    let call_id = format!("c_turn_dis_{}", ulid::Ulid::new());

    let req = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/calls/{}/join", room_id, call_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({ "client_id": "client_turn_join_104" }).to_string(),
        ))
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_IMPLEMENTED);
}

#[tokio::test]
async fn test_join_call_not_rate_limited_by_turn_credentials_limit() {
    // RATE_TURN_CREDENTIALS_PER_MIN is 10, but join requests should not be throttled by it
    let (app, pool, _mock) =
        setup_test_app(true, "turn:turn.example.com:3478", "secret-key", 10).await;
    let (_user_id, token) =
        create_test_user(&app, &pool, "turn_join_u5", "client_turn_join_105").await;
    let room_id = create_room(&app, &token).await;

    for i in 0..20 {
        let call_id = format!("c_turn_rl_{}_{}", i, ulid::Ulid::new());
        let req = Request::builder()
            .method("POST")
            .uri(format!("/api/v1/rooms/{}/calls/{}/join", room_id, call_id))
            .header(header::AUTHORIZATION, format!("Bearer {}", token))
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(
                json!({ "client_id": "client_turn_join_105" }).to_string(),
            ))
            .unwrap();

        let resp = app.clone().oneshot(req).await.unwrap();
        assert_eq!(
            resp.status(),
            StatusCode::OK,
            "Join iteration {} should succeed without rate limiting",
            i
        );
    }
}
