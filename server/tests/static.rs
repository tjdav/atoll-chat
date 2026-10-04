mod common;

use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use serde_json::Value;
use server::altcha::AltchaConfig;
use server::config::Config;
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
        opaque_oprf_key_path: key_path.to_str().unwrap().to_string(),
        cleanup_enabled: true,
        cleanup_startup_delay_secs: 30,
        client_static_dir: static_dir.map(|s| s.to_string()),
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
        extension_proxy_blocklist: std::sync::Arc::new(
            server::extensions_proxy::blocklist::DomainBlocklistStore::new(Default::default()),
        ),
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
