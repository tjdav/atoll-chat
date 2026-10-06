mod common;

use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use axum::Router;
use serde_json::{json, Value};
use sqlx::SqlitePool;
use std::path::Path;
use std::sync::Arc;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

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
        extension_proxy_blocklist: std::sync::Arc::new(
            server::extensions_proxy::blocklist::DomainBlocklistStore::new(Default::default()),
        ),
    };

    let app = server::build_app(state);
    (app, pool, mock_server)
}

#[tokio::test]
async fn test_pending_adds_workflow() {
    let (app, pool, _) = common::setup_test_app_with_config(true, "auto", 100).await;

    // Register User A (owner)
    let _user_a_id = common::register_user(&app, "usera", "Password123!", None).await;
    let (status_a, login_a) =
        common::login_user(&app, "usera", "Password123!", "client_a_123456789", None).await;
    assert_eq!(status_a, StatusCode::OK);
    let token_a = login_a["session_token"].as_str().unwrap();

    // Create server invite for B
    sqlx::query(
        "INSERT INTO server_invites (id, code, max_uses, current_uses) VALUES ('inv_b', 'INVITEB1234', 1, 0)",
    )
    .execute(&pool)
    .await
    .unwrap();

    // Register User B and login on 2 devices
    let user_b_id = common::register_user(&app, "userb", "Password123!", Some("INVITEB1234")).await;
    let (status_b1, login_b1) =
        common::login_user(&app, "userb", "Password123!", "client_b_1_123456789", None).await;
    assert_eq!(status_b1, StatusCode::OK);
    let token_b1 = login_b1["session_token"].as_str().unwrap();

    let (status_b2, _login_b2) =
        common::login_user(&app, "userb", "Password123!", "client_b_2_123456789", None).await;
    assert_eq!(status_b2, StatusCode::OK);

    // Upload key package only for client_b_1_123456789
    let upload_kp_req = Request::builder()
        .method("POST")
        .uri("/api/v1/keypackages")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_b1))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "packages": [
                    {
                        "client_id": "client_b_1_123456789",
                        "cipher_suite": 1,
                        "key_package_data": "dGVzdF9rZXlfcGFja2FnZQ==",
                        "is_last_resort": false
                    }
                ]
            })
            .to_string(),
        ))
        .unwrap();

    let upload_kp_resp = tower::ServiceExt::oneshot(app.clone(), upload_kp_req)
        .await
        .unwrap();
    assert_eq!(upload_kp_resp.status(), StatusCode::CREATED);

    // User A creates Room 1
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
    let room_json: Value = serde_json::from_slice(
        &axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    let room_1_id = room_json["id"].as_str().unwrap();

    // 1. Empty pending-adds list for fresh room
    let list_req = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/rooms/{}/pending-adds", room_1_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();

    let list_resp = tower::ServiceExt::oneshot(app.clone(), list_req)
        .await
        .unwrap();
    assert_eq!(list_resp.status(), StatusCode::OK);
    let list_json: Value = serde_json::from_slice(
        &axum::body::to_bytes(list_resp.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(list_json["pending_adds"].as_array().unwrap().len(), 0);

    // 2. Non-member cannot list -> HTTP 404
    let list_req_b = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/rooms/{}/pending-adds", room_1_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_b1))
        .body(Body::empty())
        .unwrap();

    let list_resp_b = tower::ServiceExt::oneshot(app.clone(), list_req_b)
        .await
        .unwrap();
    assert_eq!(list_resp_b.status(), StatusCode::NOT_FOUND);

    // 3. User A adds User B to Room 1
    // User B has 2 devices (client_b_1_123456789 and client_b_2_123456789), but only client_b_1_123456789 has a key package.
    // Expect 1 row in pending_mls_adds (for client_b_1_123456789), skipping client_b_2_123456789 with a logged warning.
    let add_b_req = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/members", room_1_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "user_id": user_b_id }).to_string()))
        .unwrap();

    let add_b_resp = tower::ServiceExt::oneshot(app.clone(), add_b_req)
        .await
        .unwrap();
    assert_eq!(add_b_resp.status(), StatusCode::CREATED);

    // 4. List pending adds as User A
    let list_req_after = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/rooms/{}/pending-adds", room_1_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();

    let list_resp_after = tower::ServiceExt::oneshot(app.clone(), list_req_after)
        .await
        .unwrap();
    assert_eq!(list_resp_after.status(), StatusCode::OK);
    let list_json_after: Value = serde_json::from_slice(
        &axum::body::to_bytes(list_resp_after.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    let adds = list_json_after["pending_adds"].as_array().unwrap();
    assert_eq!(adds.len(), 1);
    assert_eq!(adds[0]["target_user_id"], user_b_id);
    assert_eq!(adds[0]["target_client_id"], "client_b_1_123456789");
    let add_id = adds[0]["id"].as_str().unwrap().to_string();

    // 5. Consume pending add as User B (now a member)
    let consume_req = Request::builder()
        .method("POST")
        .uri(format!(
            "/api/v1/rooms/{}/pending-adds/{}/consume",
            room_1_id, add_id
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_b1))
        .body(Body::empty())
        .unwrap();

    let consume_resp = tower::ServiceExt::oneshot(app.clone(), consume_req)
        .await
        .unwrap();
    assert_eq!(consume_resp.status(), StatusCode::OK);
    let consume_json: Value = serde_json::from_slice(
        &axum::body::to_bytes(consume_resp.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(consume_json["id"], add_id);
    assert!(consume_json["consumed_at"].as_str().is_some());

    // 6. Consuming again returns 409 already_consumed
    let consume_again_req = Request::builder()
        .method("POST")
        .uri(format!(
            "/api/v1/rooms/{}/pending-adds/{}/consume",
            room_1_id, add_id
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_b1))
        .body(Body::empty())
        .unwrap();

    let consume_again_resp = tower::ServiceExt::oneshot(app.clone(), consume_again_req)
        .await
        .unwrap();
    assert_eq!(consume_again_resp.status(), StatusCode::CONFLICT);

    // 7. Consuming non-existent pending add returns 404 pending_add_not_found
    let consume_missing_req = Request::builder()
        .method("POST")
        .uri(format!(
            "/api/v1/rooms/{}/pending-adds/dummyid123/consume",
            room_1_id
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_b1))
        .body(Body::empty())
        .unwrap();

    let consume_missing_resp = tower::ServiceExt::oneshot(app.clone(), consume_missing_req)
        .await
        .unwrap();
    assert_eq!(consume_missing_resp.status(), StatusCode::NOT_FOUND);

    // 8. List excludes consumed pending adds
    let list_req_final = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/rooms/{}/pending-adds", room_1_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();

    let list_resp_final = tower::ServiceExt::oneshot(app.clone(), list_req_final)
        .await
        .unwrap();
    assert_eq!(list_resp_final.status(), StatusCode::OK);
    let list_json_final: Value = serde_json::from_slice(
        &axum::body::to_bytes(list_resp_final.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(list_json_final["pending_adds"].as_array().unwrap().len(), 0);
}

#[tokio::test]
async fn test_mls_add_pending_event_published_with_mock() {
    let (app, pool, mock_server) = setup_test_app_with_sockudo_mock().await;

    // Register User A (owner)
    let _user_a_id = common::register_user(&app, "user_evt_a", "Password123!", None).await;
    let (status_a, login_a) = common::login_user(
        &app,
        "user_evt_a",
        "Password123!",
        "client_evt_a_12345678",
        None,
    )
    .await;
    assert_eq!(status_a, StatusCode::OK);
    let token_a = login_a["session_token"].as_str().unwrap();

    // Create server invite for B
    sqlx::query(
        "INSERT INTO server_invites (id, code, max_uses, current_uses) VALUES ('inv_evt_b', 'INVEVTB1234', 1, 0)",
    )
    .execute(&pool)
    .await
    .unwrap();

    // Register User B
    let user_b_id =
        common::register_user(&app, "user_evt_b", "Password123!", Some("INVEVTB1234")).await;
    let (status_b1, login_b1) = common::login_user(
        &app,
        "user_evt_b",
        "Password123!",
        "client_evt_b_12345678",
        None,
    )
    .await;
    assert_eq!(status_b1, StatusCode::OK);
    let token_b1 = login_b1["session_token"].as_str().unwrap();

    // Upload key package for client_evt_b_12345678
    let upload_kp_req = Request::builder()
        .method("POST")
        .uri("/api/v1/keypackages")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_b1))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "packages": [
                    {
                        "client_id": "client_evt_b_12345678",
                        "cipher_suite": 1,
                        "key_package_data": "dGVzdF9rZXlfcGFja2FnZQ==",
                        "is_last_resort": false
                    }
                ]
            })
            .to_string(),
        ))
        .unwrap();

    let upload_kp_resp = tower::ServiceExt::oneshot(app.clone(), upload_kp_req)
        .await
        .unwrap();
    assert_eq!(upload_kp_resp.status(), StatusCode::CREATED);

    // User A creates Room
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
    let room_json: Value = serde_json::from_slice(
        &axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    let room_id = room_json["id"].as_str().unwrap();

    // User A adds User B to Room
    let add_b_req = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/members", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "user_id": user_b_id }).to_string()))
        .unwrap();

    let add_b_resp = tower::ServiceExt::oneshot(app.clone(), add_b_req)
        .await
        .unwrap();
    assert_eq!(add_b_resp.status(), StatusCode::CREATED);

    // Verify events received by mock server
    let requests = mock_server.received_requests().await.unwrap();
    assert_eq!(requests.len(), 2); // 1: room.member_added, 2: mls.add_pending

    let body_1: Value = serde_json::from_slice(&requests[0].body).unwrap();
    assert_eq!(body_1["name"], "room.member_added");

    let body_2: Value = serde_json::from_slice(&requests[1].body).unwrap();
    assert_eq!(body_2["name"], "mls.add_pending");
    assert_eq!(
        body_2["channels"],
        json!([format!("private-room-{}", room_id)])
    );

    let data_str = body_2["data"].as_str().unwrap();
    let data_json: Value = serde_json::from_str(data_str).unwrap();
    assert_eq!(data_json["room_id"], room_id);
    assert_eq!(data_json["target_user_id"], user_b_id);
    assert_eq!(data_json["client_ids"], json!(["client_evt_b_12345678"]));
}

#[tokio::test]
async fn test_mls_add_pending_publish_failure_does_not_fail_member_add() {
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
        extension_proxy_blocklist: std::sync::Arc::new(
            server::extensions_proxy::blocklist::DomainBlocklistStore::new(Default::default()),
        ),
    };

    let app = server::build_app(state);

    // Register User A (owner)
    let _user_a_id = common::register_user(&app, "user_fail_a", "Password123!", None).await;
    let (status_a, login_a) = common::login_user(
        &app,
        "user_fail_a",
        "Password123!",
        "client_fail_a_12345",
        None,
    )
    .await;
    assert_eq!(status_a, StatusCode::OK);
    let token_a = login_a["session_token"].as_str().unwrap();

    // Create server invite for B
    sqlx::query(
        "INSERT INTO server_invites (id, code, max_uses, current_uses) VALUES ('inv_fail_b', 'INVFAILB1234', 1, 0)",
    )
    .execute(&pool)
    .await
    .unwrap();

    // Register User B
    let user_b_id =
        common::register_user(&app, "user_fail_b", "Password123!", Some("INVFAILB1234")).await;
    let (status_b1, login_b1) = common::login_user(
        &app,
        "user_fail_b",
        "Password123!",
        "client_fail_b_12345",
        None,
    )
    .await;
    assert_eq!(status_b1, StatusCode::OK);
    let token_b1 = login_b1["session_token"].as_str().unwrap();

    // Upload key package for client_fail_b_12345
    let upload_kp_req = Request::builder()
        .method("POST")
        .uri("/api/v1/keypackages")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_b1))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "packages": [
                    {
                        "client_id": "client_fail_b_12345",
                        "cipher_suite": 1,
                        "key_package_data": "dGVzdF9rZXlfcGFja2FnZQ==",
                        "is_last_resort": false
                    }
                ]
            })
            .to_string(),
        ))
        .unwrap();

    let upload_kp_resp = tower::ServiceExt::oneshot(app.clone(), upload_kp_req)
        .await
        .unwrap();
    assert_eq!(upload_kp_resp.status(), StatusCode::CREATED);

    // User A creates Room
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
    let room_json: Value = serde_json::from_slice(
        &axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    let room_id = room_json["id"].as_str().unwrap();

    // User A adds User B to Room — event publish fails with 500, but request still succeeds with 201 Created
    let add_b_req = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/members", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "user_id": user_b_id }).to_string()))
        .unwrap();

    let add_b_resp = tower::ServiceExt::oneshot(app.clone(), add_b_req)
        .await
        .unwrap();
    assert_eq!(add_b_resp.status(), StatusCode::CREATED);
}
