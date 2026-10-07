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
    let events: Vec<&wiremock::Request> = requests
        .iter()
        .filter(|r| {
            let body: Value = serde_json::from_slice(&r.body).unwrap();
            body["name"] != "device.added"
        })
        .collect();

    assert_eq!(events.len(), 2); // 1: room.member_added, 2: mls.add_pending

    let body_1: Value = serde_json::from_slice(&events[0].body).unwrap();
    assert_eq!(body_1["name"], "room.member_added");

    let body_2: Value = serde_json::from_slice(&events[1].body).unwrap();
    assert_eq!(body_2["name"], "mls.add_pending");
    assert_eq!(
        body_2["channels"],
        json!([format!("private-room-{}", room_id)])
    );

    let data_str = body_2["data"].as_str().unwrap();
    let data_json: Value = serde_json::from_str(data_str).unwrap();
    assert_eq!(data_json["room_id"], room_id);
    assert_eq!(data_json["target_user_id"], user_b_id);
    assert!(data_json["target_bot_id"].is_null());
    assert_eq!(data_json["client_ids"], json!(["client_evt_b_12345678"]));
}

#[tokio::test]
async fn test_pending_mls_adds_xor_constraint_direct_db() {
    let pool = common::setup_test_db().await;

    // Both target_user_id AND target_bot_id set -> DB CHECK constraint failure
    let res_both = sqlx::query(
        "INSERT INTO pending_mls_adds (id, room_id, target_user_id, target_bot_id, target_client_id, key_package_id) VALUES ('p_both', 'r_1', 'u_1', 'b_1', 'c_1', 'kp_1')",
    )
    .execute(&pool)
    .await;
    assert!(
        res_both.is_err(),
        "Expected CHECK constraint failure when both target_user_id and target_bot_id are set"
    );

    // Neither target_user_id NOR target_bot_id set -> DB CHECK constraint failure
    let res_neither = sqlx::query(
        "INSERT INTO pending_mls_adds (id, room_id, target_user_id, target_bot_id, target_client_id, key_package_id) VALUES ('p_neither', 'r_1', NULL, NULL, 'c_1', 'kp_1')",
    )
    .execute(&pool)
    .await;
    assert!(
        res_neither.is_err(),
        "Expected CHECK constraint failure when neither target_user_id nor target_bot_id is set"
    );
}

#[tokio::test]
async fn test_key_packages_xor_constraint_direct_db() {
    let pool = common::setup_test_db().await;

    // Both user_id AND bot_id set -> DB CHECK constraint failure
    let res_both = sqlx::query(
        "INSERT INTO key_packages (id, user_id, bot_id, client_id, key_package) VALUES ('kp_both', 'u_1', 'b_1', 'c_1', X'1234')",
    )
    .execute(&pool)
    .await;
    assert!(
        res_both.is_err(),
        "Expected CHECK constraint failure when both user_id and bot_id are set"
    );

    // Neither user_id NOR bot_id set -> DB CHECK constraint failure
    let res_neither = sqlx::query(
        "INSERT INTO key_packages (id, user_id, bot_id, client_id, key_package) VALUES ('kp_neither', NULL, NULL, 'c_1', X'1234')",
    )
    .execute(&pool)
    .await;
    assert!(
        res_neither.is_err(),
        "Expected CHECK constraint failure when neither user_id nor bot_id is set"
    );
}

#[tokio::test]
async fn test_bot_target_pending_adds_and_consume_workflow() {
    let (app, pool, _) = common::setup_test_app_with_config(true, "auto", 100).await;

    // Create server invite for A
    sqlx::query(
        "INSERT INTO server_invites (id, code, max_uses, current_uses) VALUES ('inv_bot_a', 'INVITEBOTA12', 1, 0)",
    )
    .execute(&pool)
    .await
    .unwrap();

    // Register User A (owner)
    let user_a_id =
        common::register_user(&app, "user_bot_owner", "Password123!", Some("INVITEBOTA12")).await;
    let (status_a, login_a) = common::login_user(
        &app,
        "user_bot_owner",
        "Password123!",
        "client_owner_1_123456",
        None,
    )
    .await;
    assert_eq!(status_a, StatusCode::OK);
    let token_a = login_a["session_token"].as_str().unwrap();

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
    let room_id = room_json["id"].as_str().unwrap();

    // Create a bot account in bot_accounts table
    let bot_id = "b_test_bot_123";
    sqlx::query(
        "INSERT INTO bot_accounts (id, display_name, owner_user_id) VALUES (?, 'Test Bot', ?)",
    )
    .bind(bot_id)
    .bind(&user_a_id)
    .execute(&pool)
    .await
    .unwrap();

    // Insert an unconsumed key package for bot account
    let kp_id = "kp_bot_1";
    let bot_client_id = "client_bot_device_1";
    sqlx::query(
        "INSERT INTO key_packages (id, user_id, bot_id, client_id, key_package) VALUES (?, NULL, ?, ?, X'123456')",
    )
    .bind(kp_id)
    .bind(bot_id)
    .bind(bot_client_id)
    .execute(&pool)
    .await
    .unwrap();

    // Directly call server::rooms::queue_pending_mls_add_batch for bot_id inside a transaction
    let mut tx = pool.begin().await.unwrap();
    let added_clients = server::rooms::queue_pending_mls_add_batch(
        &mut tx,
        room_id,
        server::rooms::MlsTarget::Bot(bot_id),
        &[(bot_client_id.to_string(), kp_id.to_string())],
    )
    .await
    .unwrap();
    tx.commit().await.unwrap();
    assert_eq!(added_clients.len(), 1);
    assert_eq!(added_clients[0].target_client_id, bot_client_id);
    assert_eq!(added_clients[0].key_package_id, kp_id);

    // Also verify mock server event publishing for bot target batch
    let mock_server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/apps/chat/events"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"ok": true})))
        .mount(&mock_server)
        .await;

    let sockudo_cfg = server::SockudoConfig {
        http_base: mock_server.uri(),
        app_id: "chat".to_string(),
        app_key: "test-app-key".to_string(),
        app_secret: "test-app-secret".to_string(),
        enable_client_events: true,
    };
    let publisher = server::Publisher::new(sockudo_cfg);
    let channel = format!("private-room-{}", room_id);
    let mls_add_bot_payload = json!({
        "room_id": room_id,
        "target_user_id": serde_json::Value::Null,
        "target_bot_id": bot_id,
        "client_ids": vec![bot_client_id],
    });
    publisher
        .publish(&channel, "mls.add_pending", mls_add_bot_payload)
        .await
        .unwrap();

    let requests = mock_server.received_requests().await.unwrap();
    assert_eq!(requests.len(), 1);
    let pub_body: Value = serde_json::from_slice(&requests[0].body).unwrap();
    assert_eq!(pub_body["name"], "mls.add_pending");
    let pub_data: Value = serde_json::from_str(pub_body["data"].as_str().unwrap()).unwrap();
    assert_eq!(pub_data["room_id"], room_id);
    assert!(pub_data["target_user_id"].is_null());
    assert_eq!(pub_data["target_bot_id"], bot_id);
    assert_eq!(pub_data["client_ids"], json!([bot_client_id]));

    // GET /rooms/:id/pending-adds as User A -> response includes bot pending add
    let list_req = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/rooms/{}/pending-adds", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();

    let list_resp = tower::ServiceExt::oneshot(app.clone(), list_req)
        .await
        .unwrap();
    assert_eq!(list_resp.status(), StatusCode::OK);

    // Assert Cache-Control: no-store header
    let cache_control = list_resp
        .headers()
        .get(header::CACHE_CONTROL)
        .unwrap()
        .to_str()
        .unwrap();
    assert_eq!(cache_control, "no-store");

    let list_json: Value = serde_json::from_slice(
        &axum::body::to_bytes(list_resp.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();

    let adds = list_json["pending_adds"].as_array().unwrap();
    assert_eq!(adds.len(), 1);
    assert_eq!(adds[0]["target_bot_id"], bot_id);
    assert!(adds[0]["target_user_id"].is_null());
    assert_eq!(adds[0]["target_client_id"], bot_client_id);
    assert_eq!(adds[0]["key_package_id"], kp_id);

    let add_id = adds[0]["id"].as_str().unwrap().to_string();

    // Consume pending add as User A
    let consume_req = Request::builder()
        .method("POST")
        .uri(format!(
            "/api/v1/rooms/{}/pending-adds/{}/consume",
            room_id, add_id
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();

    let consume_resp = tower::ServiceExt::oneshot(app.clone(), consume_req)
        .await
        .unwrap();
    assert_eq!(consume_resp.status(), StatusCode::OK);

    // Assert Cache-Control: no-store header on consume
    let cache_control_consume = consume_resp
        .headers()
        .get(header::CACHE_CONTROL)
        .unwrap()
        .to_str()
        .unwrap();
    assert_eq!(cache_control_consume, "no-store");

    let consume_json: Value = serde_json::from_slice(
        &axum::body::to_bytes(consume_resp.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(consume_json["id"], add_id);
    assert!(consume_json["consumed_at"].as_str().is_some());
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

#[tokio::test]
async fn test_select_bot_key_packages_helper() {
    let pool = common::setup_test_db().await;

    // Insert user for foreign key constraint
    sqlx::query(
        "INSERT INTO users (id, username_token, identity_pubkey, opaque_registration) VALUES ('u_owner', 'tok_owner', 'pub_owner', X'1234')",
    )
    .execute(&pool)
    .await
    .unwrap();

    // Create a bot account in bot_accounts table
    let bot_id = "b_select_kp_test";
    sqlx::query(
        "INSERT INTO bot_accounts (id, display_name, owner_user_id) VALUES (?, 'KP Bot', 'u_owner')",
    )
    .bind(bot_id)
    .execute(&pool)
    .await
    .unwrap();

    // Insert 2 non-last-resort key packages and 1 last-resort key package
    sqlx::query(
        "INSERT INTO key_packages (id, user_id, bot_id, client_id, is_last_resort, key_package) VALUES ('kp_b_1', NULL, ?, 'client_1', 0, X'11'), ('kp_b_2', NULL, ?, 'client_2', 0, X'22'), ('kp_b_lr', NULL, ?, 'client_1', 1, X'33')",
    )
    .bind(bot_id)
    .bind(bot_id)
    .bind(bot_id)
    .execute(&pool)
    .await
    .unwrap();

    let mut tx = pool.begin().await.unwrap();
    let selected = server::rooms::select_bot_key_packages(&mut tx, bot_id)
        .await
        .unwrap();
    tx.commit().await.unwrap();

    assert_eq!(selected.len(), 2);
    assert_eq!(selected[0], ("client_1".to_string(), "kp_b_1".to_string()));
    assert_eq!(selected[1], ("client_2".to_string(), "kp_b_2".to_string()));

    // Verify non-last-resort packages are consumed
    let consumed_count: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM key_packages WHERE bot_id = ? AND consumed = 1")
            .bind(bot_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(consumed_count.0, 2);

    // Verify last-resort package remains unconsumed
    let lr_consumed: (i64,) =
        sqlx::query_as("SELECT consumed FROM key_packages WHERE id = 'kp_b_lr'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(lr_consumed.0, 0);

    // Call select_bot_key_packages when no active non-last-resort packages exist -> empty vec
    let mut tx2 = pool.begin().await.unwrap();
    let selected_empty = server::rooms::select_bot_key_packages(&mut tx2, bot_id)
        .await
        .unwrap();
    tx2.commit().await.unwrap();
    assert!(selected_empty.is_empty());
}
