use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use serde_json::Value;
use std::sync::Arc;
use tower::ServiceExt;

use server::Config;

mod common;
use common::{login_user, register_user, setup_test_app};

#[tokio::test]
async fn test_01_list_backups_empty_when_none() {
    let (app, _pool) = setup_test_app().await;

    let _owner_id = register_user(&app, "owner", "password123", None).await;
    let (_, login_res) =
        login_user(&app, "owner", "password123", "client_owner_123456", None).await;
    let token = login_res["session_token"].as_str().unwrap();

    let req = Request::builder()
        .method("GET")
        .uri("/api/v1/admin/backups")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::empty())
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let body: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(body["backups"].as_array().unwrap().len(), 0);
}

#[tokio::test]
async fn test_02_trigger_and_list_backups() {
    let (app, _pool) = setup_test_app().await;

    let _owner_id = register_user(&app, "owner", "password123", None).await;
    let (_, login_res) =
        login_user(&app, "owner", "password123", "client_owner_123456", None).await;
    let token = login_res["session_token"].as_str().unwrap();

    // Trigger manual backup
    let trigger_req = Request::builder()
        .method("POST")
        .uri("/api/v1/admin/backups")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::empty())
        .unwrap();

    let trigger_resp = app.clone().oneshot(trigger_req).await.unwrap();
    let status = trigger_resp.status();
    let trig_bytes = axum::body::to_bytes(trigger_resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let trig_body: Value = serde_json::from_slice(&trig_bytes).unwrap_or_default();
    println!("trigger status: {}, body: {:?}", status, trig_body);
    assert_eq!(status, StatusCode::CREATED);
    assert!(trig_body["filename"]
        .as_str()
        .unwrap()
        .starts_with("backup-"));
    assert!(trig_body["size_bytes"].as_u64().unwrap() > 0);

    // List backups
    let list_req = Request::builder()
        .method("GET")
        .uri("/api/v1/admin/backups")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::empty())
        .unwrap();

    let list_resp = app.clone().oneshot(list_req).await.unwrap();
    assert_eq!(list_resp.status(), StatusCode::OK);

    let list_bytes = axum::body::to_bytes(list_resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let list_body: Value = serde_json::from_slice(&list_bytes).unwrap();
    let backups = list_body["backups"].as_array().unwrap();
    assert_eq!(backups.len(), 1);
    assert_eq!(backups[0]["filename"], trig_body["filename"]);
}

#[tokio::test]
async fn test_03_non_admin_cannot_list_or_trigger() {
    let (app, pool) = setup_test_app().await;

    register_user(&app, "owner", "password123", None).await;

    sqlx::query(
        "INSERT INTO server_invites (id, code, max_uses, current_uses) VALUES ('inv1', 'CODE1234', 1, 0)",
    )
    .execute(&pool)
    .await
    .unwrap();

    let _member_id = register_user(&app, "member", "password123", Some("CODE1234")).await;

    let (_, login_res) =
        login_user(&app, "member", "password123", "client_member_123456", None).await;
    let token = login_res["session_token"].as_str().unwrap();

    // GET backups -> 403
    let get_req = Request::builder()
        .method("GET")
        .uri("/api/v1/admin/backups")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::empty())
        .unwrap();

    let get_resp = app.clone().oneshot(get_req).await.unwrap();
    assert_eq!(get_resp.status(), StatusCode::FORBIDDEN);

    // POST backups -> 403
    let post_req = Request::builder()
        .method("POST")
        .uri("/api/v1/admin/backups")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::empty())
        .unwrap();

    let post_resp = app.clone().oneshot(post_req).await.unwrap();
    assert_eq!(post_resp.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn test_04_trigger_fails_when_backup_disabled() {
    let pool = common::setup_test_db().await;

    let temp_dir = std::env::temp_dir().join(format!("test_run_{}", ulid::Ulid::new()));
    let _ = std::fs::create_dir_all(&temp_dir);
    let key_path = temp_dir.join("oprf.key");
    let opaque_server = Arc::new(server::OpaqueServer::load_or_generate(&key_path).unwrap());
    let registration_store = Arc::new(server::RegistrationStore::new());
    let login_store = Arc::new(server::LoginStore::new());

    let config = Config {
        opaque_oprf_key_path: key_path.to_str().unwrap().to_string(),
        altcha_enabled: true,
        altcha_hmac_secret: "auto".to_string(),
        altcha_cost: 100,
        backup_enabled: false,
        ..Config::test_default()
    };

    let altcha_config = Arc::new(
        server::AltchaConfig::from_env(&config, &pool)
            .await
            .unwrap(),
    );
    let config_arc = Arc::new(config);
    let server_hard_max = Arc::new(server::ServerHardMax::default());

    let sockudo_cfg = server::SockudoConfig {
        http_base: "http://localhost:6001".to_string(),
        app_id: "chat".to_string(),
        app_key: "test-key".to_string(),
        app_secret: "test-secret".to_string(),
        enable_client_events: true,
    };
    let storage = server::build_storage(&config_arc).expect("Failed to build storage");
    let publisher = Arc::new(server::Publisher::new(sockudo_cfg));
    let backup_lock = Arc::new(tokio::sync::Mutex::new(()));

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

    let state = server::AppState {
        pool: pool.clone(),
        opaque_server,
        registration_store,
        login_store,
        recovery_store: Arc::new(server::RecoveryStore::new()),
        altcha_config,
        config: config_arc,
        server_hard_max,
        publisher,
        storage,
        backup_lock,
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
    };

    let app = server::build_app(state);

    let _owner_id = register_user(&app, "owner", "password123", None).await;
    let (_, login_res) =
        login_user(&app, "owner", "password123", "client_owner_123456", None).await;
    let token = login_res["session_token"].as_str().unwrap();

    let trigger_req = Request::builder()
        .method("POST")
        .uri("/api/v1/admin/backups")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::empty())
        .unwrap();

    let trigger_resp = app.clone().oneshot(trigger_req).await.unwrap();
    assert_eq!(trigger_resp.status(), StatusCode::NOT_IMPLEMENTED);

    let bytes = axum::body::to_bytes(trigger_resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let body: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(body["error"], "backup_disabled");
}

#[tokio::test]
async fn test_05_concurrent_triggers_return_409() {
    let (app, _pool) = setup_test_app().await;

    let _owner_id = register_user(&app, "owner", "password123", None).await;
    let (_, login_res) =
        login_user(&app, "owner", "password123", "client_owner_123456", None).await;
    let token = login_res["session_token"].as_str().unwrap().to_string();

    let app1 = app.clone();
    let app2 = app.clone();
    let token1 = token.clone();
    let token2 = token.clone();

    let task1 = tokio::spawn(async move {
        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/admin/backups")
            .header(header::AUTHORIZATION, format!("Bearer {token1}"))
            .body(Body::empty())
            .unwrap();
        app1.oneshot(req).await.unwrap()
    });

    let task2 = tokio::spawn(async move {
        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/admin/backups")
            .header(header::AUTHORIZATION, format!("Bearer {token2}"))
            .body(Body::empty())
            .unwrap();
        app2.oneshot(req).await.unwrap()
    });

    let (r1, r2) = tokio::join!(task1, task2);
    let resp1 = r1.unwrap();
    let resp2 = r2.unwrap();

    let statuses = [resp1.status(), resp2.status()];
    assert!(
        statuses.contains(&StatusCode::CREATED),
        "At least one request should succeed with 201"
    );
    for status in statuses {
        assert!(
            status == StatusCode::CREATED || status == StatusCode::CONFLICT,
            "Unexpected status: {}",
            status
        );
    }
}
