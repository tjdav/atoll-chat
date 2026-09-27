mod common;

use axum::{
    body::Body,
    http::{header, Request, StatusCode},
};
use server::altcha::AltchaConfig;
use server::config::{Config, RateLimitConfig};
use server::login::LoginStore;
use server::opaque::OpaqueServer;
use server::registration::RegistrationStore;
use server::AppState;
use std::sync::Arc;
use tower::ServiceExt;

async fn setup_app_with_custom_config(
    app_env: &str,
    app_url: Option<&str>,
    trust_proxy: bool,
    hsts_max_age: u64,
    hsts_include_subdomains: bool,
) -> axum::Router {
    let pool = common::setup_test_db().await;

    let temp_dir = tempfile::tempdir().expect("Failed to create tempdir");
    let key_path = temp_dir.path().join("oprf.key");
    let opaque_server =
        Arc::new(OpaqueServer::load_or_generate(&key_path).expect("Failed to create OpaqueServer"));
    let registration_store = Arc::new(RegistrationStore::new());
    let login_store = Arc::new(LoginStore::new());

    let config = Config {
        app_env: app_env.to_string(),
        app_url: app_url.map(|s| s.to_string()),
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
        trust_proxy,
        hsts_max_age,
        hsts_include_subdomains,
        client_static_dir: None,
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

    let state = AppState {
        pool,
        opaque_server,
        registration_store,
        login_store,
        altcha_config,
        config: config_arc,
        server_hard_max,
    };

    server::build_app(state)
}

// 1. Development mode does not redirect HTTP.
#[tokio::test]
async fn test_01_development_mode_does_not_redirect_http() {
    let app = setup_app_with_custom_config(
        "development",
        Some("http://localhost:8080"),
        false,
        31536000,
        true,
    )
    .await;

    let req = Request::builder()
        .method("GET")
        .uri("/api/v1/capabilities")
        .header("X-Forwarded-Proto", "http")
        .body(Body::empty())
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_ne!(resp.status(), StatusCode::MOVED_PERMANENTLY);
    assert_eq!(resp.status(), StatusCode::OK);
}

// 2. Development mode does not send HSTS.
#[tokio::test]
async fn test_02_development_mode_does_not_send_hsts() {
    let app = setup_app_with_custom_config(
        "development",
        Some("http://localhost:8080"),
        false,
        31536000,
        true,
    )
    .await;

    let req = Request::builder()
        .method("GET")
        .uri("/api/v1/capabilities")
        .body(Body::empty())
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert!(resp.headers().get("strict-transport-security").is_none());
}

// 3. Production with TRUST_PROXY=true redirects HTTP to HTTPS.
#[tokio::test]
async fn test_03_production_with_trust_proxy_redirects_http_to_https() {
    let app = setup_app_with_custom_config(
        "production",
        Some("https://example.com"),
        true,
        31536000,
        true,
    )
    .await;

    let req = Request::builder()
        .method("GET")
        .uri("/api/v1/capabilities")
        .header("X-Forwarded-Proto", "http")
        .body(Body::empty())
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::MOVED_PERMANENTLY);
    assert_eq!(
        resp.headers()
            .get(header::LOCATION)
            .unwrap()
            .to_str()
            .unwrap(),
        "https://example.com/api/v1/capabilities"
    );
}

// 4. Redirect preserves query string.
#[tokio::test]
async fn test_04_redirect_preserves_query_string() {
    let app = setup_app_with_custom_config(
        "production",
        Some("https://example.com"),
        true,
        31536000,
        true,
    )
    .await;

    let req = Request::builder()
        .method("GET")
        .uri("/invites?code=ABC")
        .header("X-Forwarded-Proto", "http")
        .body(Body::empty())
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::MOVED_PERMANENTLY);
    assert_eq!(
        resp.headers()
            .get(header::LOCATION)
            .unwrap()
            .to_str()
            .unwrap(),
        "https://example.com/invites?code=ABC"
    );
}

// 5. Production with TRUST_PROXY=true does not redirect HTTPS.
#[tokio::test]
async fn test_05_production_with_trust_proxy_does_not_redirect_https() {
    let app = setup_app_with_custom_config(
        "production",
        Some("https://example.com"),
        true,
        31536000,
        true,
    )
    .await;

    let req = Request::builder()
        .method("GET")
        .uri("/api/v1/capabilities")
        .header("X-Forwarded-Proto", "https")
        .body(Body::empty())
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_ne!(resp.status(), StatusCode::MOVED_PERMANENTLY);
    assert_eq!(resp.status(), StatusCode::OK);
}

// 6. Production with TRUST_PROXY=true sends HSTS.
#[tokio::test]
async fn test_06_production_with_trust_proxy_sends_hsts() {
    let app = setup_app_with_custom_config(
        "production",
        Some("https://example.com"),
        true,
        31536000,
        true,
    )
    .await;

    let req = Request::builder()
        .method("GET")
        .uri("/api/v1/capabilities")
        .header("X-Forwarded-Proto", "https")
        .body(Body::empty())
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    let hsts = resp
        .headers()
        .get("strict-transport-security")
        .expect("HSTS header should be present");
    assert_eq!(
        hsts.to_str().unwrap(),
        "max-age=31536000; includeSubDomains"
    );
}

// 7. HSTS_MAX_AGE=0 disables HSTS.
#[tokio::test]
async fn test_07_hsts_max_age_zero_disables_hsts() {
    let app =
        setup_app_with_custom_config("production", Some("https://example.com"), true, 0, true)
            .await;

    let req = Request::builder()
        .method("GET")
        .uri("/api/v1/capabilities")
        .header("X-Forwarded-Proto", "https")
        .body(Body::empty())
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert!(resp.headers().get("strict-transport-security").is_none());
}

// 8. HSTS_INCLUDE_SUBDOMAINS=false omits the directive.
#[tokio::test]
async fn test_08_hsts_include_subdomains_false_omits_directive() {
    let app = setup_app_with_custom_config(
        "production",
        Some("https://example.com"),
        true,
        31536000,
        false,
    )
    .await;

    let req = Request::builder()
        .method("GET")
        .uri("/api/v1/capabilities")
        .header("X-Forwarded-Proto", "https")
        .body(Body::empty())
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    let hsts = resp
        .headers()
        .get("strict-transport-security")
        .expect("HSTS header should be present");
    assert_eq!(hsts.to_str().unwrap(), "max-age=31536000");
}

// 9. /health is exempt from redirect.
#[tokio::test]
async fn test_09_health_is_exempt_from_redirect() {
    let app = setup_app_with_custom_config(
        "production",
        Some("https://example.com"),
        true,
        31536000,
        true,
    )
    .await;

    let req = Request::builder()
        .method("GET")
        .uri("/health")
        .header("X-Forwarded-Proto", "http")
        .body(Body::empty())
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_ne!(resp.status(), StatusCode::MOVED_PERMANENTLY);
    assert_eq!(resp.status(), StatusCode::OK);
}

// 10. /ready is exempt from redirect.
#[tokio::test]
async fn test_10_ready_is_exempt_from_redirect() {
    let app = setup_app_with_custom_config(
        "production",
        Some("https://example.com"),
        true,
        31536000,
        true,
    )
    .await;

    let req = Request::builder()
        .method("GET")
        .uri("/ready")
        .header("X-Forwarded-Proto", "http")
        .body(Body::empty())
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_ne!(resp.status(), StatusCode::MOVED_PERMANENTLY);
    assert_eq!(resp.status(), StatusCode::OK);
}

// 11. APP_URL scheme validation.
#[tokio::test]
async fn test_11_app_url_scheme_validation_production_http_fails() {
    std::env::set_var("APP_ENV", "production");
    std::env::set_var("APP_URL", "http://example.com");
    let res = Config::from_env();
    assert!(res.is_err());
    let err_str = res.err().unwrap().to_string();
    assert!(err_str.contains("FATAL: APP_URL must use https:// in production"));
}

// 12. APP_URL scheme validation permits development.
#[tokio::test]
async fn test_12_app_url_scheme_validation_permits_development() {
    std::env::set_var("APP_ENV", "development");
    std::env::set_var("APP_URL", "http://localhost:8080");
    let res = Config::from_env();
    assert!(res.is_ok());
}

// 13. Production with TRUST_PROXY=false does not redirect.
#[tokio::test]
async fn test_13_production_with_trust_proxy_false_does_not_redirect() {
    let app = setup_app_with_custom_config(
        "production",
        Some("https://example.com"),
        false,
        31536000,
        true,
    )
    .await;

    let req = Request::builder()
        .method("GET")
        .uri("/api/v1/capabilities")
        .header("X-Forwarded-Proto", "http")
        .body(Body::empty())
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_ne!(resp.status(), StatusCode::MOVED_PERMANENTLY);
    assert_eq!(resp.status(), StatusCode::OK);
}
