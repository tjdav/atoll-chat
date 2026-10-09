mod common;

use axum::{
    body::Body,
    http::{header, Request, StatusCode},
};
use server::altcha::AltchaConfig;
use server::config::Config;
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
        opaque_oprf_key_path: key_path.to_str().unwrap().to_string(),
        cleanup_enabled: true,
        cleanup_startup_delay_secs: 30,
        trust_proxy,
        hsts_max_age,
        hsts_include_subdomains,
        ..Config::test_default()
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
        reactions_per_message: 50,
        room_metadata_bytes: config_arc.server_max_room_metadata_bytes,
        edit_window_seconds: config_arc.server_max_edit_window_seconds,
    });

    let sockudo_config = server::SockudoConfig {
        http_base: "http://localhost:6001".to_string(),
        app_id: "chat".to_string(),
        app_key: "test-key".to_string(),
        app_secret: "test-secret".to_string(),
        enable_client_events: true,
    };
    let storage = server::build_storage(&config_arc).expect("Failed to build storage");
    let publisher = Arc::new(server::Publisher::new(sockudo_config));

    let oprf_keys = server::oprf::OprfKeys::load(&opaque_server.setup).unwrap();
    let oprf = Arc::new(server::oprf::OprfEvaluator::new(&oprf_keys));
    let oprf_audit = Arc::new(server::oprf::OprfAuditCounter::new());

    let session_types_state = server::sessions::init_session_types_state(
        config_arc.sessions_enabled,
        &config_arc.session_types_config_path,
        config_arc.server_max_session_participants,
        config_arc.server_max_sessions_per_room,
    );
    let session_types = Arc::new(server::sessions::SessionTypesStore::new(
        session_types_state,
    ));

    let state = AppState {
        pool,
        opaque_server,
        registration_store,
        login_store,
        recovery_store: Arc::new(server::RecoveryStore::new()),
        altcha_config,
        config: config_arc,
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
        bot_connection_state: server::bots::BotConnectionState::new(),
        call_occupancy: server::calls::CallOccupancyStore::new(),
        extension_proxy_blocklist: std::sync::Arc::new(
            server::extensions_proxy::blocklist::DomainBlocklistStore::new(Default::default()),
        ),
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
    std::env::set_var("MODEL_HOSTING_ENABLED", "false");
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
