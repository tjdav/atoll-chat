mod common;

use axum::{
    body::Body,
    http::{header, Request, StatusCode},
};
use common::{login_user, register_user, setup_test_app};
use serde_json::Value;
use server::altcha::AltchaConfig;
use server::config::Config;
use server::login::LoginStore;
use server::opaque::OpaqueServer;
use server::registration::RegistrationStore;
use server::routes;
use server::AppState;
use std::sync::Arc;
use tower::ServiceExt;

const CLIENT_A: &str = "client_a_123456789";
const CLIENT_B: &str = "client_b_123456789";

#[tokio::test]
async fn test_01_device_is_created_on_first_login() {
    let (app, pool) = setup_test_app().await;

    let user_id = register_user(&app, "alice", "password123", None).await;

    let (status, body) = login_user(&app, "alice", "password123", CLIENT_A, None).await;
    assert_eq!(status, StatusCode::OK);

    let device_id = body["device_id"].as_str().expect("missing device_id");
    assert!(!device_id.is_empty());

    // Assert device row exists
    let dev_row: (String, String, String) =
        sqlx::query_as("SELECT id, user_id, client_id FROM devices WHERE id = ?")
            .bind(device_id)
            .fetch_one(&pool)
            .await
            .unwrap();

    assert_eq!(dev_row.0, device_id);
    assert_eq!(dev_row.1, user_id);
    assert_eq!(dev_row.2, CLIENT_A);

    // Assert session row references device_id
    let session_dev_id: String =
        sqlx::query_scalar("SELECT device_id FROM sessions WHERE user_id = ?")
            .bind(&user_id)
            .fetch_one(&pool)
            .await
            .unwrap();

    assert_eq!(session_dev_id, device_id);
}

#[tokio::test]
async fn test_02_second_login_with_same_client_id_reuses_device() {
    let (app, pool) = setup_test_app().await;

    let user_id = register_user(&app, "alice", "password123", None).await;

    let (status1, body1) = login_user(&app, "alice", "password123", CLIENT_A, None).await;
    assert_eq!(status1, StatusCode::OK);
    let dev_id1 = body1["device_id"].as_str().unwrap().to_string();

    let (status2, body2) = login_user(&app, "alice", "password123", CLIENT_A, None).await;
    assert_eq!(status2, StatusCode::OK);
    let dev_id2 = body2["device_id"].as_str().unwrap().to_string();

    assert_eq!(dev_id1, dev_id2);

    // Assert only one device row exists
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM devices WHERE user_id = ?")
        .bind(&user_id)
        .fetch_one(&pool)
        .await
        .unwrap();

    assert_eq!(count, 1);

    // Assert both sessions reference same device_id
    let session_dev_ids: Vec<String> =
        sqlx::query_scalar("SELECT device_id FROM sessions WHERE user_id = ?")
            .bind(&user_id)
            .fetch_all(&pool)
            .await
            .unwrap();

    assert_eq!(session_dev_ids.len(), 2);
    assert_eq!(session_dev_ids[0], dev_id1);
    assert_eq!(session_dev_ids[1], dev_id1);
}

#[tokio::test]
async fn test_03_second_login_with_different_client_id_creates_new_device() {
    let (app, pool) = setup_test_app().await;

    let user_id = register_user(&app, "alice", "password123", None).await;

    let (status1, body1) = login_user(&app, "alice", "password123", CLIENT_A, None).await;
    assert_eq!(status1, StatusCode::OK);
    let dev_id1 = body1["device_id"].as_str().unwrap().to_string();

    let (status2, body2) = login_user(&app, "alice", "password123", CLIENT_B, None).await;
    assert_eq!(status2, StatusCode::OK);
    let dev_id2 = body2["device_id"].as_str().unwrap().to_string();

    assert_ne!(dev_id1, dev_id2);

    // Assert two device rows exist
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM devices WHERE user_id = ?")
        .bind(&user_id)
        .fetch_one(&pool)
        .await
        .unwrap();

    assert_eq!(count, 2);
}

#[tokio::test]
async fn test_04_device_limit_is_enforced() {
    let pool = common::setup_test_db().await;

    let temp_dir = tempfile::tempdir().expect("Failed to create tempdir");
    let key_path = temp_dir.path().join("oprf.key");
    let opaque_server =
        Arc::new(OpaqueServer::load_or_generate(&key_path).expect("Failed to create OpaqueServer"));
    let registration_store = Arc::new(RegistrationStore::new());
    let login_store = Arc::new(LoginStore::new());

    let config = Config {
        opaque_oprf_key_path: key_path.to_str().unwrap().to_string(),
        altcha_enabled: true,
        altcha_hmac_secret: "auto".to_string(),
        altcha_cost: 100,
        server_max_devices_per_user: 3,
        cleanup_enabled: true,
        cleanup_startup_delay_secs: 30,
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

    let app = axum::Router::new()
        .route(
            "/api/v1/oprf/blind",
            axum::routing::post(routes::oprf::blind),
        )
        .route(
            "/api/v1/auth/register/challenge",
            axum::routing::get(routes::register::register_challenge),
        )
        .route(
            "/api/v1/auth/register/start",
            axum::routing::post(routes::register::register_start),
        )
        .route(
            "/api/v1/auth/register/finish",
            axum::routing::post(routes::register::register_finish),
        )
        .route(
            "/api/v1/auth/login/start",
            axum::routing::post(routes::login::login_start),
        )
        .route(
            "/api/v1/auth/login/finish",
            axum::routing::post(routes::login::login_finish),
        )
        .with_state(state);

    register_user(&app, "alice", "password123", None).await;

    // Log in 3 times with different client_ids
    for i in 1..=3 {
        let cid = format!("client_id_limit_{}", i);
        let (status, _) = login_user(&app, "alice", "password123", &cid, None).await;
        assert_eq!(status, StatusCode::OK);
    }

    // 4th login attempt exceeding max devices (3)
    let (status4, body4) =
        login_user(&app, "alice", "password123", "client_id_limit_4", None).await;
    assert_eq!(status4, StatusCode::BAD_REQUEST);
    assert_eq!(body4["error"], "device_limit_exceeded");
}

#[tokio::test]
async fn test_05_get_users_me_devices_lists_all_devices() {
    let (app, _pool) = setup_test_app().await;

    register_user(&app, "alice", "password123", None).await;

    let (_, body_a) = login_user(&app, "alice", "password123", CLIENT_A, None).await;
    let dev_id_a = body_a["device_id"].as_str().unwrap();

    let (_, body_b) = login_user(&app, "alice", "password123", CLIENT_B, None).await;
    let token_b = body_b["session_token"].as_str().unwrap();
    let dev_id_b = body_b["device_id"].as_str().unwrap();

    let req = Request::builder()
        .method("GET")
        .uri("/api/v1/users/me/devices")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_b))
        .body(Body::empty())
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body_bytes).unwrap();

    let devices = json["devices"].as_array().expect("devices array");
    assert_eq!(devices.len(), 2);

    let dev_a = devices.iter().find(|d| d["id"] == dev_id_a).unwrap();
    assert_eq!(dev_a["client_id"], CLIENT_A);
    assert_eq!(dev_a["is_current"], false);

    let dev_b = devices.iter().find(|d| d["id"] == dev_id_b).unwrap();
    assert_eq!(dev_b["client_id"], CLIENT_B);
    assert_eq!(dev_b["is_current"], true);
}

#[tokio::test]
async fn test_06_delete_users_me_devices_id_removes_device() {
    let (app, _pool) = setup_test_app().await;

    register_user(&app, "alice", "password123", None).await;

    let (_, body_a) = login_user(&app, "alice", "password123", CLIENT_A, None).await;
    let token_a = body_a["session_token"].as_str().unwrap();

    let (_, body_b) = login_user(&app, "alice", "password123", CLIENT_B, None).await;
    let token_b = body_b["session_token"].as_str().unwrap();
    let dev_id_b = body_b["device_id"].as_str().unwrap();

    // Use device A's token to delete device B
    let req = Request::builder()
        .method("DELETE")
        .uri(format!("/api/v1/users/me/devices/{}", dev_id_b))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::NO_CONTENT);

    // Attempt to use device B's token -> HTTP 401
    let req_auth_b = Request::builder()
        .method("GET")
        .uri("/api/v1/users/me")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_b))
        .body(Body::empty())
        .unwrap();

    let resp_auth_b = app.clone().oneshot(req_auth_b).await.unwrap();
    assert_eq!(resp_auth_b.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn test_07_deleting_current_device_is_rejected() {
    let (app, _pool) = setup_test_app().await;

    register_user(&app, "alice", "password123", None).await;

    let (_, body_a) = login_user(&app, "alice", "password123", CLIENT_A, None).await;
    let token_a = body_a["session_token"].as_str().unwrap();
    let dev_id_a = body_a["device_id"].as_str().unwrap();

    let req = Request::builder()
        .method("DELETE")
        .uri(format!("/api/v1/users/me/devices/{}", dev_id_a))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);

    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let body: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(body["error"], "cannot_revoke_current_device");
}

#[tokio::test]
async fn test_08_cross_user_device_access_returns_404() {
    let (app, pool) = setup_test_app().await;

    let _user_a = register_user(&app, "alice", "password123", None).await;
    let (_, body_a) = login_user(&app, "alice", "password123", CLIENT_A, None).await;
    let token_a = body_a["session_token"].as_str().unwrap();

    // Create invite for second user
    sqlx::query(
        "INSERT INTO server_invites (id, code, max_uses, current_uses) VALUES ('inv_1', 'INVITE123', 1, 0)",
    )
    .execute(&pool)
    .await
    .unwrap();

    let _user_b = register_user(&app, "bob", "password123", Some("INVITE123")).await;
    let (_, body_b) = login_user(&app, "bob", "password123", CLIENT_B, None).await;
    let dev_id_b = body_b["device_id"].as_str().unwrap();

    // User A attempts to delete User B's device
    let req = Request::builder()
        .method("DELETE")
        .uri(format!("/api/v1/users/me/devices/{}", dev_id_b))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);

    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let body: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(body["error"], "device_not_found");
}

#[tokio::test]
async fn test_09_revocation_cascade_deletes_unconsumed_key_packages() {
    let (app, pool) = setup_test_app().await;

    let user_a_id = register_user(&app, "alice", "password123", None).await;

    let (_, body_a) = login_user(&app, "alice", "password123", CLIENT_A, None).await;

    // Insert 3 unconsumed key packages for (user_id, CLIENT_A)
    for i in 1..=3 {
        sqlx::query(
            "INSERT INTO key_packages (id, user_id, client_id, key_package, consumed) VALUES (?, ?, ?, ?, 0)",
        )
        .bind(format!("kp_{}", i))
        .bind(&user_a_id)
        .bind(CLIENT_A)
        .bind(&b"dummy_key_package"[..])
        .execute(&pool)
        .await
        .unwrap();
    }

    let (_, body_b) = login_user(&app, "alice", "password123", CLIENT_B, None).await;
    let token_b = body_b["session_token"].as_str().unwrap();
    let dev_id_a = body_a["device_id"].as_str().unwrap();

    // Revoke device A using device B's token
    let req = Request::builder()
        .method("DELETE")
        .uri(format!("/api/v1/users/me/devices/{}", dev_id_a))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_b))
        .body(Body::empty())
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::NO_CONTENT);

    // Assert key packages are deleted
    let kp_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM key_packages WHERE user_id = ? AND client_id = ?")
            .bind(&user_a_id)
            .bind(CLIENT_A)
            .fetch_one(&pool)
            .await
            .unwrap();

    assert_eq!(kp_count, 0);
}

#[tokio::test]
async fn test_10_revocation_cascade_queues_mls_removes() {
    let (app, pool) = setup_test_app().await;

    let user_id = register_user(&app, "alice", "password123", None).await;

    // Insert room and room_member
    let room_id = "test_room_100";
    sqlx::query("INSERT INTO rooms (id, owner_id) VALUES (?, ?)")
        .bind(room_id)
        .bind(&user_id)
        .execute(&pool)
        .await
        .unwrap();

    sqlx::query("INSERT INTO room_members (room_id, user_id) VALUES (?, ?)")
        .bind(room_id)
        .bind(&user_id)
        .execute(&pool)
        .await
        .unwrap();

    let (_, body_a) = login_user(&app, "alice", "password123", CLIENT_A, None).await;
    let dev_id_a = body_a["device_id"].as_str().unwrap();

    let (_, body_b) = login_user(&app, "alice", "password123", CLIENT_B, None).await;
    let token_b = body_b["session_token"].as_str().unwrap();

    // Revoke device A using device B's token
    let req = Request::builder()
        .method("DELETE")
        .uri(format!("/api/v1/users/me/devices/{}", dev_id_a))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_b))
        .body(Body::empty())
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::NO_CONTENT);

    // Assert a row exists in pending_mls_removes with target_user_id matching user_id
    let mls_row: (String, Option<String>, Option<String>, Option<chrono::DateTime<chrono::Utc>>) = sqlx::query_as(
        "SELECT room_id, target_user_id, target_bot_id, consumed_at FROM pending_mls_removes WHERE room_id = ?",
    )
    .bind(room_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(mls_row.0, room_id);
    assert_eq!(mls_row.1.as_deref(), Some(user_id.as_str()));
    assert_eq!(mls_row.2, None);
}

#[tokio::test]
async fn test_11_revocation_cascade_deletes_sessions() {
    let (app, pool) = setup_test_app().await;

    let user_id = register_user(&app, "alice", "password123", None).await;

    // Log in twice on device A (two sessions, same client_id)
    let (_, body_a1) = login_user(&app, "alice", "password123", CLIENT_A, None).await;
    let dev_id_a = body_a1["device_id"].as_str().unwrap();
    let (_, _body_a2) = login_user(&app, "alice", "password123", CLIENT_A, None).await;

    // Log in on device B
    let (_, body_b) = login_user(&app, "alice", "password123", CLIENT_B, None).await;
    let token_b = body_b["session_token"].as_str().unwrap();

    // Delete device A
    let req = Request::builder()
        .method("DELETE")
        .uri(format!("/api/v1/users/me/devices/{}", dev_id_a))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_b))
        .body(Body::empty())
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::NO_CONTENT);

    // Assert both sessions of device A are gone from DB
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sessions WHERE device_id = ?")
        .bind(dev_id_a)
        .fetch_one(&pool)
        .await
        .unwrap();

    assert_eq!(count, 0);

    // Assert user's total session count is 1 (only device B's session remains)
    let total_sessions: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sessions WHERE user_id = ?")
        .bind(&user_id)
        .fetch_one(&pool)
        .await
        .unwrap();

    assert_eq!(total_sessions, 1);
}

#[tokio::test]
async fn test_12_encrypted_device_name_is_stored_on_new_devices() {
    use base64::engine::general_purpose::URL_SAFE_NO_PAD;
    use base64::Engine;

    let (app, pool) = setup_test_app().await;

    let user_id = register_user(&app, "alice", "password123", None).await;
    let enc_name = URL_SAFE_NO_PAD.encode(vec![42u8; 32]);

    let (status, body) = common::login_user_with_device_name(
        &app,
        "alice",
        "password123",
        CLIENT_A,
        None,
        Some(&enc_name),
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    let dev_id = body["device_id"].as_str().unwrap();

    let stored_name: Option<String> = sqlx::query_scalar(
        "SELECT encrypted_device_name FROM device_names WHERE user_id = ? AND device_id = ?",
    )
    .bind(&user_id)
    .bind(dev_id)
    .fetch_optional(&pool)
    .await
    .unwrap();

    assert_eq!(stored_name.as_deref(), Some(enc_name.as_str()));
}

#[tokio::test]
async fn test_13_missing_encrypted_device_name_stores_null() {
    let (app, pool) = setup_test_app().await;

    let user_id = register_user(&app, "alice", "password123", None).await;

    let (status, body) = login_user(&app, "alice", "password123", CLIENT_A, None).await;

    assert_eq!(status, StatusCode::OK);
    let dev_id = body["device_id"].as_str().unwrap();

    let stored_name: Option<String> = sqlx::query_scalar(
        "SELECT encrypted_device_name FROM device_names WHERE user_id = ? AND device_id = ?",
    )
    .bind(&user_id)
    .bind(dev_id)
    .fetch_optional(&pool)
    .await
    .unwrap();

    assert_eq!(stored_name, None);
}

#[tokio::test]
async fn test_14_invalid_encrypted_device_name_is_rejected() {
    let (app, _pool) = setup_test_app().await;

    register_user(&app, "alice", "password123", None).await;

    let short_name = "invalid_short";
    let (status, body) = common::login_user_with_device_name(
        &app,
        "alice",
        "password123",
        CLIENT_A,
        None,
        Some(short_name),
    )
    .await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["error"], "invalid_encrypted_device_name");
}
use base64::Engine;

#[tokio::test]
async fn test_15_devices_schema_has_platform_and_lacks_name() {
    let (_, pool) = setup_test_app().await;

    // Verify table info for devices
    let rows: Vec<(i64, String, String, i64, Option<String>, i64)> =
        sqlx::query_as("PRAGMA table_info(devices)")
            .fetch_all(&pool)
            .await
            .unwrap();

    let col_names: Vec<String> = rows.into_iter().map(|r| r.1).collect();

    assert!(
        col_names.contains(&"platform".to_string()),
        "devices table must contain platform column"
    );
    assert!(
        !col_names.contains(&"name".to_string()),
        "devices table must NOT contain legacy name column"
    );
}

#[tokio::test]
async fn test_16_login_finish_platform_validation() {
    let (app, pool) = setup_test_app().await;

    let _user_id = register_user(&app, "user_plat", "password123", None).await;

    // Valid login with platform = "web" creates device
    let (status, login_res) = common::login_user_with_device_name(
        &app,
        "user_plat",
        "password123",
        "c_plat_1234567890",
        None,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let dev_id = login_res["device_id"].as_str().unwrap();

    // Verify platform in DB
    let stored_platform: String = sqlx::query_scalar("SELECT platform FROM devices WHERE id = ?")
        .bind(dev_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(stored_platform, "web");
}

#[tokio::test]
async fn test_17_device_revocation() {
    let (app, _) = setup_test_app().await;

    let _user_id = register_user(&app, "user_revoke_evt", "password123", None).await;

    // Login on 2 devices
    let (_, login1) = common::login_user(
        &app,
        "user_revoke_evt",
        "password123",
        "c_rev1_123456789",
        None,
    )
    .await;
    let _dev1_id = login1["device_id"].as_str().unwrap().to_string();
    let token1 = login1["session_token"].as_str().unwrap().to_string();

    let (_, login2) = common::login_user(
        &app,
        "user_revoke_evt",
        "password123",
        "c_rev2_123456789",
        None,
    )
    .await;
    let dev2_id = login2["device_id"].as_str().unwrap().to_string();

    // Delete dev2 using dev1 token
    let req = axum::http::Request::builder()
        .method("DELETE")
        .uri(format!("/api/v1/users/me/devices/{}", dev2_id))
        .header(
            axum::http::header::AUTHORIZATION,
            format!("Bearer {}", token1),
        )
        .body(axum::body::Body::empty())
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::NO_CONTENT);
}

#[tokio::test]
async fn test_18_device_name_update() {
    let (app, _) = setup_test_app().await;

    let _user_id = register_user(&app, "user_name_evt", "password123", None).await;
    let (_, login) = common::login_user(
        &app,
        "user_name_evt",
        "password123",
        "c_name_123456789",
        None,
    )
    .await;
    let dev_id = login["device_id"].as_str().unwrap().to_string();
    let token = login["session_token"].as_str().unwrap().to_string();

    let name_b64 = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode([7u8; 32]);

    let req = axum::http::Request::builder()
        .method("PATCH")
        .uri(format!("/api/v1/users/me/devices/{}", dev_id))
        .header(
            axum::http::header::AUTHORIZATION,
            format!("Bearer {}", token),
        )
        .header(axum::http::header::CONTENT_TYPE, "application/json")
        .body(axum::body::Body::from(
            serde_json::json!({ "encrypted_device_name": name_b64 }).to_string(),
        ))
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
}

#[tokio::test]
async fn test_19_device_revoked_event_payload_shape() {
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    let mock_server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/apps/chat/events"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({"ok": true})))
        .mount(&mock_server)
        .await;

    let (app, _pool, _) = common::setup_test_app_with_custom_config(|cfg| {
        cfg.sockudo_url = mock_server.uri();
        cfg.sockudo_app_key = "test-key".to_string();
        cfg.sockudo_app_secret = "test-secret".to_string();
    })
    .await;

    let user_id = register_user(&app, "user_dev_rev", "password123", None).await;

    // Login on device 1 (publishes device.added)
    let (_, login1) = login_user(
        &app,
        "user_dev_rev",
        "password123",
        "c_dev_rev1_123456",
        None,
    )
    .await;
    let token1 = login1["session_token"].as_str().unwrap();

    // Login on device 2 (publishes device.added)
    let (_, login2) = login_user(
        &app,
        "user_dev_rev",
        "password123",
        "c_dev_rev2_123456",
        None,
    )
    .await;
    let dev2_id = login2["device_id"].as_str().unwrap();

    // Delete device 2 using device 1 token
    let req = Request::builder()
        .method("DELETE")
        .uri(format!("/api/v1/users/me/devices/{}", dev2_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token1))
        .body(Body::empty())
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::NO_CONTENT);

    // Filter requests for device.revoked
    let requests = mock_server.received_requests().await.unwrap();
    let rev_req = requests
        .iter()
        .find(|r| {
            let body: Value = serde_json::from_slice(&r.body).unwrap();
            body["name"] == "device.revoked"
        })
        .expect("device.revoked request");

    let body_json: Value = serde_json::from_slice(&rev_req.body).unwrap();
    assert_eq!(
        body_json["channels"],
        serde_json::json!([format!("private-user-{}", user_id)])
    );

    let data_str = body_json["data"].as_str().expect("data string");
    let envelope: Value = serde_json::from_str(data_str).unwrap();

    assert_eq!(envelope["event_type"], "device.revoked");
    let seq = envelope["user_seq"].as_i64().expect("user_seq i64");
    assert!(seq >= 1);

    let payload = envelope["payload"]
        .as_object()
        .expect("payload must be an object");

    assert_eq!(payload.len(), 3, "Payload must contain exactly 3 fields");
    assert_eq!(payload["device_id"], dev2_id);
    assert_eq!(payload["reason"], "revoked_by_user");
    assert_eq!(payload["user_seq"], seq);
}

#[tokio::test]
async fn test_20_device_name_updated_event_payload_shape() {
    use base64::engine::general_purpose::URL_SAFE_NO_PAD;
    use base64::Engine;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    let mock_server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/apps/chat/events"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({"ok": true})))
        .mount(&mock_server)
        .await;

    let (app, _pool, _) = common::setup_test_app_with_custom_config(|cfg| {
        cfg.sockudo_url = mock_server.uri();
        cfg.sockudo_app_key = "test-key".to_string();
        cfg.sockudo_app_secret = "test-secret".to_string();
    })
    .await;

    let user_id = register_user(&app, "user_dev_name", "password123", None).await;

    let (_, login) = login_user(
        &app,
        "user_dev_name",
        "password123",
        "c_dev_name_123456",
        None,
    )
    .await;
    let dev_id = login["device_id"].as_str().unwrap();
    let token = login["session_token"].as_str().unwrap();

    let enc_name = URL_SAFE_NO_PAD.encode(vec![99u8; 32]);

    let req = Request::builder()
        .method("PATCH")
        .uri(format!("/api/v1/users/me/devices/{}", dev_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            serde_json::json!({ "encrypted_device_name": enc_name }).to_string(),
        ))
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let requests = mock_server.received_requests().await.unwrap();

    // Verify no device.sync event is published
    let sync_reqs: Vec<&wiremock::Request> = requests
        .iter()
        .filter(|r| {
            let body: Value = serde_json::from_slice(&r.body).unwrap();
            body["name"] == "device.sync"
        })
        .collect();
    assert_eq!(
        sync_reqs.len(),
        0,
        "device.sync event must NOT be published"
    );

    // Verify device.name_updated event shape
    let name_req = requests
        .iter()
        .find(|r| {
            let body: Value = serde_json::from_slice(&r.body).unwrap();
            body["name"] == "device.name_updated"
        })
        .expect("device.name_updated request");

    let body_json: Value = serde_json::from_slice(&name_req.body).unwrap();
    assert_eq!(
        body_json["channels"],
        serde_json::json!([format!("private-user-{}", user_id)])
    );

    let data_str = body_json["data"].as_str().expect("data string");
    let envelope: Value = serde_json::from_str(data_str).unwrap();

    assert_eq!(envelope["event_type"], "device.name_updated");
    let seq = envelope["user_seq"].as_i64().expect("user_seq i64");

    let payload = envelope["payload"]
        .as_object()
        .expect("payload must be an object");

    assert_eq!(payload.len(), 3, "Payload must contain exactly 3 fields");
    assert_eq!(payload["device_id"], dev_id);
    assert_eq!(payload["encrypted_device_name"], enc_name);
    assert_eq!(payload["user_seq"], seq);
}

#[tokio::test]
#[ignore = "Forcing a transaction rollback after allocate_user_seq requires a production test hook, which is out of scope for this test-only task."]
async fn test_21_rolled_back_device_revocation_does_not_consume_seq() {
    let (app, pool) = setup_test_app().await;

    let user_id = register_user(&app, "user_rollback_revoke", "password123", None).await;

    let seq_before: Option<i64> =
        sqlx::query_scalar("SELECT next_seq FROM user_seq WHERE user_id = ?")
            .bind(&user_id)
            .fetch_optional(&pool)
            .await
            .unwrap();

    // Contract: If a device revocation transaction fails or rolls back after allocate_user_seq,
    // user_seq.next_seq must remain unchanged.
    //
    // Implementation Note: In production code (server/src/devices.rs), allocate_user_seq
    // is called inside tx right before the device row deletion and tx.commit().await?. Without
    // a production test hook or failpoint to interrupt the transaction at that boundary, this
    // test cannot force a rollback after sequence allocation without modifying production code.
    let _ = app;

    let seq_after: Option<i64> =
        sqlx::query_scalar("SELECT next_seq FROM user_seq WHERE user_id = ?")
            .bind(&user_id)
            .fetch_optional(&pool)
            .await
            .unwrap();

    assert_eq!(seq_before, seq_after);
}
