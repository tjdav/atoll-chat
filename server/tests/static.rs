mod common;

use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use serde_json::Value;
use server::altcha::AltchaConfig;
use server::config::{Config, RateLimitConfig};
use server::login::LoginStore;
use server::opaque::OpaqueServer;
use server::registration::RegistrationStore;
use server::AppState;
use std::sync::Arc;
use tower::ServiceExt;

async fn setup_app_with_static_dir(static_dir: Option<&str>) -> axum::Router {
    let pool = common::setup_test_db().await;

    let temp_dir = tempfile::tempdir().expect("Failed to create tempdir");
    let key_path = temp_dir.path().join("oprf.key");
    let opaque_server =
        Arc::new(OpaqueServer::load_or_generate(&key_path).expect("Failed to create OpaqueServer"));
    let registration_store = Arc::new(RegistrationStore::new());
    let login_store = Arc::new(LoginStore::new());

    let config = Config {
        app_env: "development".to_string(),
        app_url: None,
        app_name: "Test".to_string(),
        log_level: "info".to_string(),
        server_bind: "127.0.0.1:0".to_string(),
        db_path: ":memory:".to_string(),
        db_busy_timeout_ms: 5000,
        opaque_oprf_key_path: key_path.to_str().unwrap().to_string(),
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
        rate_limits: RateLimitConfig {
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
        client_static_dir: static_dir.map(|s| s.to_string()),
        sockudo_url: "http://localhost:6001".to_string(),
        sockudo_app_id: "chat".to_string(),
        sockudo_app_key: "auto".to_string(),
        sockudo_app_secret: "auto".to_string(),
        sockudo_public_url: None,
    };

    let altcha_config = Arc::new(
        AltchaConfig::from_env(&config, &pool)
            .await
            .expect("Failed to init AltchaConfig"),
    );

    let config_arc = Arc::new(config);

    let server_hard_max = Arc::new(server::ServerHardMax {
        file_size_bytes: config_arc.max_file_size_bytes as i64,
        room_size: 1000,
        rooms_per_user: 500,
        devices_per_user: config_arc.server_max_devices_per_user as i64,
        keypackages_per_device: 50,
        message_size_bytes: 65536,
        attachment_retention_days: 365,
        call_max_participants: 50,
    });

    let sockudo_config = Arc::new(server::SockudoConfig {
        http_base: "http://localhost:6001".to_string(),
        app_id: "chat".to_string(),
        app_key: "test-app-key".to_string(),
        app_secret: "test-app-secret".to_string(),
    });
    let sockudo_publisher = Arc::new(server::Publisher::new((*sockudo_config).clone()));

    let state = AppState {
        pool,
        opaque_server,
        registration_store,
        login_store,
        altcha_config,
        config: config_arc,
        server_hard_max,
        sockudo_config,
        sockudo_publisher,
    };

    server::build_app(state)
}

// 1. SPA serving is disabled when CLIENT_STATIC_DIR is unset.
#[tokio::test]
async fn test_01_spa_serving_disabled_when_client_static_dir_unset() {
    let app = setup_app_with_static_dir(None).await;

    let req = Request::builder()
        .method("GET")
        .uri("/")
        .body(Body::empty())
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);
}

// 2. Root path returns index.html.
#[tokio::test]
async fn test_02_root_path_returns_index_html() {
    let app = setup_app_with_static_dir(Some("testdata/spa")).await;

    let req = Request::builder()
        .method("GET")
        .uri("/")
        .body(Body::empty())
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let body_str = String::from_utf8(body_bytes.to_vec()).unwrap();
    assert!(body_str.contains("<title>Test SPA</title>"));
}

// 3. Static assets are served.
#[tokio::test]
async fn test_03_static_assets_are_served() {
    let app = setup_app_with_static_dir(Some("testdata/spa")).await;

    let req = Request::builder()
        .method("GET")
        .uri("/assets/app.js")
        .body(Body::empty())
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let body_str = String::from_utf8(body_bytes.to_vec()).unwrap();
    assert!(body_str.contains("console.log"));
}

// 4. Unknown paths fall back to index.html.
#[tokio::test]
async fn test_04_unknown_paths_fall_back_to_index_html() {
    let app = setup_app_with_static_dir(Some("testdata/spa")).await;

    let req = Request::builder()
        .method("GET")
        .uri("/rooms/abc123")
        .body(Body::empty())
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let body_str = String::from_utf8(body_bytes.to_vec()).unwrap();
    assert!(body_str.contains("<title>Test SPA</title>"));
}

// 5. API routes are not affected by SPA fallback.
#[tokio::test]
async fn test_05_api_routes_not_affected_by_spa_fallback() {
    let app = setup_app_with_static_dir(Some("testdata/spa")).await;

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
    let json: Value = serde_json::from_slice(&body_bytes).expect("API response should be JSON");
    assert!(json.get("version").is_some());
}

// 6. /health is not affected by SPA fallback.
#[tokio::test]
async fn test_06_health_not_affected_by_spa_fallback() {
    let app = setup_app_with_static_dir(Some("testdata/spa")).await;

    let req = Request::builder()
        .method("GET")
        .uri("/health")
        .body(Body::empty())
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body_bytes).expect("Health response should be JSON");
    assert_eq!(json["status"], "ok");
}

// 7. Static files do not require authentication.
#[tokio::test]
async fn test_07_static_files_do_not_require_authentication() {
    let app = setup_app_with_static_dir(Some("testdata/spa")).await;

    let req = Request::builder()
        .method("GET")
        .uri("/assets/app.js")
        .body(Body::empty())
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
}

// 8. Path traversal is rejected.
#[tokio::test]
async fn test_08_path_traversal_is_rejected() {
    let app = setup_app_with_static_dir(Some("testdata/spa")).await;

    let req = Request::builder()
        .method("GET")
        .uri("/../etc/passwd")
        .body(Body::empty())
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    let status = resp.status();
    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let body_str = String::from_utf8_lossy(&body_bytes);

    assert!(!body_str.contains("root:"));
    assert!(
        status == StatusCode::BAD_REQUEST
            || status == StatusCode::NOT_FOUND
            || (status == StatusCode::OK && body_str.contains("<title>Test SPA</title>"))
    );
}
