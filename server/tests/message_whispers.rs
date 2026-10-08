mod common;

use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use axum::Router;
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use common::{login_user, register_user};
use serde_json::{json, Value};
use sqlx::SqlitePool;
use std::path::Path;
use std::sync::Arc;
use tower::ServiceExt;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

async fn setup_test_app_with_sockudo_mock() -> (Router, SqlitePool, MockServer) {
    let mock_server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/apps/chat/events"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"ok": true})))
        .mount(&mock_server)
        .await;

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
        server::OpaqueServer::load_or_generate(Path::new("./data/test_oprf_wh.key")).unwrap(),
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

async fn create_test_user_with_device(
    app: &Router,
    pool: &SqlitePool,
    prefix: &str,
) -> (String, String, String) {
    let username = format!("{}_user", prefix);
    let password = "Password123!";
    let client_id = format!("{}_client_12345678", prefix);

    let has_users: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM users)")
        .fetch_one(pool)
        .await
        .unwrap();

    let invite_code = if has_users {
        let code = format!("INV_{}", prefix);
        sqlx::query(
            "INSERT INTO server_invites (id, code, max_uses, current_uses) VALUES (?, ?, 10, 0)",
        )
        .bind(format!("inv_id_{}", prefix))
        .bind(&code)
        .execute(pool)
        .await
        .unwrap();
        Some(code)
    } else {
        None
    };

    let user_id = register_user(app, &username, password, invite_code.as_deref()).await;
    let (status, login_res) = login_user(app, &username, password, &client_id, None).await;

    if status != StatusCode::OK {
        panic!(
            "login_user failed for {}: status={}, res={:?}",
            username, status, login_res
        );
    }

    let token = login_res["session_token"].as_str().unwrap().to_string();

    (user_id, token, client_id)
}

async fn do_get(app: &Router, uri: &str, token: &str) -> (StatusCode, Value) {
    let req = Request::builder()
        .method("GET")
        .uri(uri)
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::empty())
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    let status = resp.status();
    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body_bytes).unwrap_or(json!({}));
    (status, json)
}

async fn do_post(app: &Router, uri: &str, token: &str, body: &Value) -> (StatusCode, Value) {
    let req = Request::builder()
        .method("POST")
        .uri(uri)
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(body.to_string()))
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    let status = resp.status();
    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body_bytes).unwrap_or(json!({}));
    (status, json)
}

async fn do_patch(app: &Router, uri: &str, token: &str, body: &Value) -> (StatusCode, Value) {
    let req = Request::builder()
        .method("PATCH")
        .uri(uri)
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(body.to_string()))
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    let status = resp.status();
    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body_bytes).unwrap_or(json!({}));
    (status, json)
}

async fn do_delete(app: &Router, uri: &str, token: &str) -> (StatusCode, Value) {
    let req = Request::builder()
        .method("DELETE")
        .uri(uri)
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::empty())
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    let status = resp.status();
    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body_bytes).unwrap_or(json!({}));
    (status, json)
}

async fn create_room(app: &Router, token: &str) -> String {
    let (status, body) = do_post(app, "/api/v1/rooms", token, &json!({})).await;
    assert_eq!(status, StatusCode::CREATED);
    body["id"].as_str().unwrap().to_string()
}

async fn add_member_to_room(app: &Router, room_id: &str, owner_token: &str, target_user_id: &str) {
    let (status, _) = do_post(
        app,
        &format!("/api/v1/rooms/{room_id}/members"),
        owner_token,
        &json!({ "user_id": target_user_id }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
}

#[tokio::test]
async fn test_public_message_event_routing() {
    let (app, pool, mock_server) = setup_test_app_with_sockudo_mock().await;
    let (_u1, t1, c1) = create_test_user_with_device(&app, &pool, "pub1").await;
    let room_id = create_room(&app, &t1).await;

    let ciphertext = BASE64.encode(b"public message");

    let (status, body) = do_post(
        &app,
        &format!("/api/v1/rooms/{room_id}/messages"),
        &t1,
        &json!({
            "sender_client_id": c1,
            "epoch": 0,
            "content_type": "application",
            "ciphertext": ciphertext
        }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);

    let requests = mock_server.received_requests().await.unwrap();
    let room_events: Vec<Value> = requests
        .iter()
        .map(|r| serde_json::from_slice::<Value>(&r.body).unwrap())
        .filter(|b| b["channels"][0] == format!("private-room-{room_id}"))
        .collect();

    assert!(!room_events.is_empty());
    let new_msg_event = room_events
        .iter()
        .find(|b| b["name"] == "message.new")
        .unwrap();
    let data_val: Value = serde_json::from_str(new_msg_event["data"].as_str().unwrap()).unwrap();
    assert_eq!(data_val["id"], body["message_id"]);
    assert!(data_val.get("target_user_ids").is_none() || data_val["target_user_ids"].is_null());
}

#[tokio::test]
async fn test_whisper_message_event_routing_and_room_exclusion() {
    let (app, pool, mock_server) = setup_test_app_with_sockudo_mock().await;
    let (u1, t1, c1) = create_test_user_with_device(&app, &pool, "wh_r1").await;
    let (u2, _t2, _c2) = create_test_user_with_device(&app, &pool, "wh_r2").await;
    let room_id = create_room(&app, &t1).await;
    add_member_to_room(&app, &room_id, &t1, &u2).await;

    let ciphertext = BASE64.encode(b"secret whisper");

    let (status, body) = do_post(
        &app,
        &format!("/api/v1/rooms/{room_id}/messages"),
        &t1,
        &json!({
            "sender_client_id": c1,
            "epoch": 0,
            "content_type": "application",
            "ciphertext": ciphertext,
            "target_user_ids": [u2]
        }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);

    let requests = mock_server.received_requests().await.unwrap();

    // Verify NO room channel event for whisper message.new
    let room_events: Vec<Value> = requests
        .iter()
        .map(|r| serde_json::from_slice::<Value>(&r.body).unwrap())
        .filter(|b| b["channels"][0] == format!("private-room-{room_id}"))
        .collect();
    assert!(
        room_events.iter().all(|b| b["name"] != "message.new"),
        "Whisper message.new MUST NOT be published on room channel"
    );

    // Verify user channel events for u2 (recipient) and u1 (sender)
    let u1_channel = format!("private-user-{u1}");
    let u2_channel = format!("private-user-{u2}");

    let u1_events: Vec<Value> = requests
        .iter()
        .map(|r| serde_json::from_slice::<Value>(&r.body).unwrap())
        .filter(|b| b["channels"][0] == u1_channel && b["name"] == "message.new")
        .collect();

    let u2_events: Vec<Value> = requests
        .iter()
        .map(|r| serde_json::from_slice::<Value>(&r.body).unwrap())
        .filter(|b| b["channels"][0] == u2_channel && b["name"] == "message.new")
        .collect();

    assert_eq!(
        u1_events.len(),
        1,
        "Sender must receive whisper event on user channel"
    );
    assert_eq!(
        u2_events.len(),
        1,
        "Recipient must receive whisper event on user channel"
    );

    let u2_data: Value = serde_json::from_str(u2_events[0]["data"].as_str().unwrap()).unwrap();
    assert_eq!(u2_data["id"], body["message_id"]);
    assert_eq!(u2_data["target_user_ids"], json!([u2]));
    assert_eq!(u2_data["sender_id"], u1);
    assert_eq!(u2_data["sender_type"], "user");
}

#[tokio::test]
async fn test_whisper_fetch_filtering_and_sync_absence() {
    let (app, pool, _) = setup_test_app_with_sockudo_mock().await;
    let (_u1, t1, c1) = create_test_user_with_device(&app, &pool, "wh_f1").await;
    let (u2, t2, _c2) = create_test_user_with_device(&app, &pool, "wh_f2").await;
    let (u3, t3, _c3) = create_test_user_with_device(&app, &pool, "wh_f3").await;

    let room_id = create_room(&app, &t1).await;
    add_member_to_room(&app, &room_id, &t1, &u2).await;
    add_member_to_room(&app, &room_id, &t1, &u3).await;

    let ct_pub = BASE64.encode(b"public content");
    let ct_wh = BASE64.encode(b"whisper content");

    // Send 1 public message
    do_post(
        &app,
        &format!("/api/v1/rooms/{room_id}/messages"),
        &t1,
        &json!({
            "sender_client_id": c1,
            "epoch": 0,
            "content_type": "application",
            "ciphertext": ct_pub
        }),
    )
    .await;

    // Send 1 whisper message to u2
    let (_, wh_body) = do_post(
        &app,
        &format!("/api/v1/rooms/{room_id}/messages"),
        &t1,
        &json!({
            "sender_client_id": c1,
            "epoch": 0,
            "content_type": "application",
            "ciphertext": ct_wh,
            "target_user_ids": [u2]
        }),
    )
    .await;
    let wh_id = wh_body["message_id"].as_str().unwrap();

    // Sender u1 fetches room messages -> sees both public and whisper row
    let (s1, list1) = do_get(&app, &format!("/api/v1/rooms/{room_id}/messages"), &t1).await;
    assert_eq!(s1, StatusCode::OK);
    let msgs1 = list1["messages"].as_array().unwrap();
    assert_eq!(msgs1.len(), 2);
    let wh_in_1 = msgs1.iter().find(|m| m["id"] == wh_id).unwrap();
    assert_eq!(wh_in_1["target_user_ids"], json!([u2]));

    // Recipient u2 fetches room messages -> sees both public and whisper row
    let (s2, list2) = do_get(&app, &format!("/api/v1/rooms/{room_id}/messages"), &t2).await;
    assert_eq!(s2, StatusCode::OK);
    let msgs2 = list2["messages"].as_array().unwrap();
    assert_eq!(msgs2.len(), 2);
    let wh_in_2 = msgs2.iter().find(|m| m["id"] == wh_id).unwrap();
    assert_eq!(wh_in_2["target_user_ids"], json!([u2]));

    // Non-recipient member u3 fetches room messages -> sees ONLY public message
    let (s3, list3) = do_get(&app, &format!("/api/v1/rooms/{room_id}/messages"), &t3).await;
    assert_eq!(s3, StatusCode::OK);
    let msgs3 = list3["messages"].as_array().unwrap();
    assert_eq!(msgs3.len(), 1);
    assert!(msgs3.iter().all(|m| m["id"] != wh_id));

    // Non-recipient u3 full sync -> whisper does not appear
    let (s_sync, sync_body) = do_get(&app, "/api/v1/users/me/sync?since_seq=0", &t3).await;
    assert_eq!(s_sync, StatusCode::OK);
    let sync_str = sync_body.to_string();
    assert!(!sync_str.contains(wh_id));
}

#[tokio::test]
async fn test_whisper_edit_and_delete_events() {
    let (app, pool, mock_server) = setup_test_app_with_sockudo_mock().await;
    let (_u1, t1, c1) = create_test_user_with_device(&app, &pool, "wh_ed1").await;
    let (u2, _t2, _c2) = create_test_user_with_device(&app, &pool, "wh_ed2").await;

    let room_id = create_room(&app, &t1).await;
    add_member_to_room(&app, &room_id, &t1, &u2).await;

    let ct1 = BASE64.encode(b"whisper orig");
    let ct2 = BASE64.encode(b"whisper edit");

    // Create whisper
    let (_, wh_body) = do_post(
        &app,
        &format!("/api/v1/rooms/{room_id}/messages"),
        &t1,
        &json!({
            "sender_client_id": c1,
            "epoch": 0,
            "content_type": "application",
            "ciphertext": ct1,
            "target_user_ids": [u2]
        }),
    )
    .await;
    let wh_id = wh_body["message_id"].as_str().unwrap();

    // Edit whisper
    let (s_edit, edit_resp) = do_patch(
        &app,
        &format!("/api/v1/rooms/{room_id}/messages/{wh_id}"),
        &t1,
        &json!({ "ciphertext": ct2 }),
    )
    .await;
    assert_eq!(s_edit, StatusCode::CREATED);
    assert_eq!(edit_resp["target_user_ids"], json!([u2]));

    let requests = mock_server.received_requests().await.unwrap();

    // Assert message.edited was NOT sent on room channel
    let room_edits: Vec<Value> = requests
        .iter()
        .map(|r| serde_json::from_slice::<Value>(&r.body).unwrap())
        .filter(|b| {
            b["channels"][0] == format!("private-room-{room_id}") && b["name"] == "message.edited"
        })
        .collect();
    assert!(
        room_edits.is_empty(),
        "Whisper edit MUST NOT be published on room channel"
    );

    // Assert message.edited was sent on user channels for u1 and u2
    let u2_edits: Vec<Value> = requests
        .iter()
        .map(|r| serde_json::from_slice::<Value>(&r.body).unwrap())
        .filter(|b| {
            b["channels"][0] == format!("private-user-{u2}") && b["name"] == "message.edited"
        })
        .collect();
    assert_eq!(u2_edits.len(), 1);
    let u2_edit_data: Value = serde_json::from_str(u2_edits[0]["data"].as_str().unwrap()).unwrap();
    assert_eq!(u2_edit_data["target_user_ids"], json!([u2]));

    // Delete whisper
    let (s_del, _) = do_delete(
        &app,
        &format!("/api/v1/rooms/{room_id}/messages/{wh_id}"),
        &t1,
    )
    .await;
    assert_eq!(s_del, StatusCode::NO_CONTENT);

    let requests2 = mock_server.received_requests().await.unwrap();

    // Assert message.deleted was NOT sent on room channel
    let room_deletes: Vec<Value> = requests2
        .iter()
        .map(|r| serde_json::from_slice::<Value>(&r.body).unwrap())
        .filter(|b| {
            b["channels"][0] == format!("private-room-{room_id}") && b["name"] == "message.deleted"
        })
        .collect();
    assert!(
        room_deletes.is_empty(),
        "Whisper delete MUST NOT be published on room channel"
    );

    // Assert message.deleted was sent on user channels
    let u2_deletes: Vec<Value> = requests2
        .iter()
        .map(|r| serde_json::from_slice::<Value>(&r.body).unwrap())
        .filter(|b| {
            b["channels"][0] == format!("private-user-{u2}") && b["name"] == "message.deleted"
        })
        .collect();
    assert_eq!(u2_deletes.len(), 1);
    let u2_del_data: Value = serde_json::from_str(u2_deletes[0]["data"].as_str().unwrap()).unwrap();
    assert_eq!(u2_del_data["target_user_ids"], json!([u2]));
}

#[tokio::test]
async fn test_whisper_reaction_events() {
    let (app, pool, mock_server) = setup_test_app_with_sockudo_mock().await;
    let (u1, t1, c1) = create_test_user_with_device(&app, &pool, "wh_rx1").await;
    let (u2, t2, c2) = create_test_user_with_device(&app, &pool, "wh_rx2").await;

    let room_id = create_room(&app, &t1).await;
    add_member_to_room(&app, &room_id, &t1, &u2).await;

    let ct = BASE64.encode(b"whisper for reaction");

    // Create whisper
    let (_, wh_body) = do_post(
        &app,
        &format!("/api/v1/rooms/{room_id}/messages"),
        &t1,
        &json!({
            "sender_client_id": c1,
            "epoch": 0,
            "content_type": "application",
            "ciphertext": ct,
            "target_user_ids": [u2]
        }),
    )
    .await;
    let wh_id = wh_body["message_id"].as_str().unwrap();

    // Recipient u2 adds reaction to whisper
    let (s_react, react_resp) = do_post(
        &app,
        &format!("/api/v1/rooms/{room_id}/messages/{wh_id}/reactions"),
        &t2,
        &json!({
            "reaction": "👍",
            "sender_client_id": c2
        }),
    )
    .await;
    assert_eq!(s_react, StatusCode::CREATED);
    let rx_id = react_resp["id"].as_str().unwrap();

    let requests = mock_server.received_requests().await.unwrap();

    // Assert reaction.added was NOT sent on room channel
    let room_rx_adds: Vec<Value> = requests
        .iter()
        .map(|r| serde_json::from_slice::<Value>(&r.body).unwrap())
        .filter(|b| {
            b["channels"][0] == format!("private-room-{room_id}") && b["name"] == "reaction.added"
        })
        .collect();
    assert!(
        room_rx_adds.is_empty(),
        "Whisper reaction.added MUST NOT be published on room channel"
    );

    // Assert reaction.added was sent on user channels
    let u1_rx_adds: Vec<Value> = requests
        .iter()
        .map(|r| serde_json::from_slice::<Value>(&r.body).unwrap())
        .filter(|b| {
            b["channels"][0] == format!("private-user-{u1}") && b["name"] == "reaction.added"
        })
        .collect();
    assert_eq!(u1_rx_adds.len(), 1);
    let u1_rx_data: Value = serde_json::from_str(u1_rx_adds[0]["data"].as_str().unwrap()).unwrap();
    assert_eq!(u1_rx_data["target_user_ids"], json!([u2]));

    // Recipient u2 removes reaction
    let (s_unreact, _) = do_delete(
        &app,
        &format!("/api/v1/rooms/{room_id}/messages/{wh_id}/reactions/{rx_id}"),
        &t2,
    )
    .await;
    assert_eq!(s_unreact, StatusCode::NO_CONTENT);

    let requests2 = mock_server.received_requests().await.unwrap();

    // Assert reaction.removed was NOT sent on room channel
    let room_rx_rems: Vec<Value> = requests2
        .iter()
        .map(|r| serde_json::from_slice::<Value>(&r.body).unwrap())
        .filter(|b| {
            b["channels"][0] == format!("private-room-{room_id}") && b["name"] == "reaction.removed"
        })
        .collect();
    assert!(
        room_rx_rems.is_empty(),
        "Whisper reaction.removed MUST NOT be published on room channel"
    );

    // Assert reaction.removed was sent on user channels
    let u1_rx_rems: Vec<Value> = requests2
        .iter()
        .map(|r| serde_json::from_slice::<Value>(&r.body).unwrap())
        .filter(|b| {
            b["channels"][0] == format!("private-user-{u1}") && b["name"] == "reaction.removed"
        })
        .collect();
    assert_eq!(u1_rx_rems.len(), 1);
}

#[tokio::test]
async fn test_target_user_ids_validation_errors() {
    let (app, pool, _) = setup_test_app_with_sockudo_mock().await;
    let (_u1, t1, c1) = create_test_user_with_device(&app, &pool, "wh_val1").await;
    let room_id = create_room(&app, &t1).await;

    let ct = BASE64.encode(b"ciphertext");

    // 1. Empty target_user_ids array -> 400 invalid_target_user_ids
    let (s_empty, err_empty) = do_post(
        &app,
        &format!("/api/v1/rooms/{room_id}/messages"),
        &t1,
        &json!({
            "sender_client_id": c1,
            "epoch": 0,
            "content_type": "application",
            "ciphertext": ct,
            "target_user_ids": []
        }),
    )
    .await;
    assert_eq!(s_empty, StatusCode::BAD_REQUEST);
    assert_eq!(err_empty["error"], "invalid_target_user_ids");

    // 2. Non-member target -> 400 target_not_in_room
    let (s_nonmem, err_nonmem) = do_post(
        &app,
        &format!("/api/v1/rooms/{room_id}/messages"),
        &t1,
        &json!({
            "sender_client_id": c1,
            "epoch": 0,
            "content_type": "application",
            "ciphertext": ct,
            "target_user_ids": ["u_nonexistent_target_123"]
        }),
    )
    .await;
    assert_eq!(s_nonmem, StatusCode::BAD_REQUEST);
    assert_eq!(err_nonmem["error"], "target_not_in_room");

    // 3. Over cap target list -> 400 target_user_ids_too_large
    let (u2, _, _) = create_test_user_with_device(&app, &pool, "wh_val2").await;
    let (u3, _, _) = create_test_user_with_device(&app, &pool, "wh_val3").await;
    let (u4, _, _) = create_test_user_with_device(&app, &pool, "wh_val4").await;

    add_member_to_room(&app, &room_id, &t1, &u2).await;
    add_member_to_room(&app, &room_id, &t1, &u3).await;
    add_member_to_room(&app, &room_id, &t1, &u4).await;

    // Set instance room_size limit to 2 AFTER adding members
    sqlx::query("INSERT OR REPLACE INTO instance_limits (key, value) VALUES ('room_size', '2')")
        .execute(&pool)
        .await
        .unwrap();

    let (s_cap, err_cap) = do_post(
        &app,
        &format!("/api/v1/rooms/{room_id}/messages"),
        &t1,
        &json!({
            "sender_client_id": c1,
            "epoch": 0,
            "content_type": "application",
            "ciphertext": ct,
            "target_user_ids": [u2, u3, u4]
        }),
    )
    .await;
    assert_eq!(s_cap, StatusCode::BAD_REQUEST);
    assert_eq!(err_cap["error"], "target_user_ids_too_large");
}

#[tokio::test]
async fn test_room_channel_defensive_strip() {
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

    // Manually pass a payload containing target_user_ids to a room channel
    let leaky_payload = json!({
        "id": "m_123",
        "room_id": "r_123",
        "target_user_ids": ["u_target1", "u_target2"]
    });

    let res = publisher
        .publish("private-room-r_123", "message.new", leaky_payload)
        .await;
    assert!(res.is_ok());

    let requests = mock_server.received_requests().await.unwrap();
    assert_eq!(requests.len(), 1);

    let body_json: Value = serde_json::from_slice(&requests[0].body).unwrap();
    let data_str = body_json["data"].as_str().unwrap();
    let data_val: Value = serde_json::from_str(data_str).unwrap();

    // Assert target_user_ids was stripped defensively
    assert!(
        data_val.get("target_user_ids").is_none(),
        "Publisher MUST defensively strip target_user_ids on private-room-* channel"
    );
    assert_eq!(data_val["id"], "m_123");
}

#[tokio::test]
async fn test_whisper_non_durability_and_seq_unchanged() {
    let (app, pool, _) = setup_test_app_with_sockudo_mock().await;
    let (u1, t1, c1) = create_test_user_with_device(&app, &pool, "wh_dur1").await;
    let (u2, _t2, _c2) = create_test_user_with_device(&app, &pool, "wh_dur2").await;

    let room_id = create_room(&app, &t1).await;
    add_member_to_room(&app, &room_id, &t1, &u2).await;

    let seq_before: Option<i64> =
        sqlx::query_scalar("SELECT next_seq FROM user_seq WHERE user_id = ?")
            .bind(&u1)
            .fetch_optional(&pool)
            .await
            .unwrap();

    let ct = BASE64.encode(b"whisper non durable");

    let (status, _) = do_post(
        &app,
        &format!("/api/v1/rooms/{room_id}/messages"),
        &t1,
        &json!({
            "sender_client_id": c1,
            "epoch": 0,
            "content_type": "application",
            "ciphertext": ct,
            "target_user_ids": [u2]
        }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);

    let seq_after: Option<i64> =
        sqlx::query_scalar("SELECT next_seq FROM user_seq WHERE user_id = ?")
            .bind(&u1)
            .fetch_optional(&pool)
            .await
            .unwrap();

    assert_eq!(
        seq_before, seq_after,
        "Whisper message MUST NOT allocate a user_seq"
    );
}

#[tokio::test]
async fn test_whisper_to_self_single_delivery() {
    let (app, pool, mock_server) = setup_test_app_with_sockudo_mock().await;
    let (u1, t1, c1) = create_test_user_with_device(&app, &pool, "wh_self1").await;
    let room_id = create_room(&app, &t1).await;

    let ct = BASE64.encode(b"whisper to self");

    // u1 sends whisper where target_user_ids includes u1
    let (status, body) = do_post(
        &app,
        &format!("/api/v1/rooms/{room_id}/messages"),
        &t1,
        &json!({
            "sender_client_id": c1,
            "epoch": 0,
            "content_type": "application",
            "ciphertext": ct,
            "target_user_ids": [u1]
        }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);

    let requests = mock_server.received_requests().await.unwrap();
    let u1_channel = format!("private-user-{u1}");

    let u1_events: Vec<Value> = requests
        .iter()
        .map(|r| serde_json::from_slice::<Value>(&r.body).unwrap())
        .filter(|b| b["channels"][0] == u1_channel && b["name"] == "message.new")
        .collect();

    assert_eq!(
        u1_events.len(),
        1,
        "Whisper to self must be delivered on sender's user channel exactly once, not twice"
    );

    let event_data: Value = serde_json::from_str(u1_events[0]["data"].as_str().unwrap()).unwrap();
    assert_eq!(event_data["id"], body["message_id"]);
    assert_eq!(event_data["target_user_ids"], json!([u1]));
}

#[tokio::test]
async fn test_target_user_ids_deduplication_on_storage() {
    let (app, pool, _) = setup_test_app_with_sockudo_mock().await;
    let (_u1, t1, c1) = create_test_user_with_device(&app, &pool, "wh_dedup1").await;
    let (u2, _, _) = create_test_user_with_device(&app, &pool, "wh_dedup2").await;

    let room_id = create_room(&app, &t1).await;
    add_member_to_room(&app, &room_id, &t1, &u2).await;

    let ct = BASE64.encode(b"whisper with dup targets");

    // Send target_user_ids with duplicates: [u2, u2]
    let (status, body) = do_post(
        &app,
        &format!("/api/v1/rooms/{room_id}/messages"),
        &t1,
        &json!({
            "sender_client_id": c1,
            "epoch": 0,
            "content_type": "application",
            "ciphertext": ct,
            "target_user_ids": [u2, u2]
        }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let msg_id = body["message_id"].as_str().unwrap();

    // Query DB raw target_user_ids column
    let raw_db_targets: String =
        sqlx::query_scalar("SELECT target_user_ids FROM room_messages WHERE id = ?")
            .bind(msg_id)
            .fetch_one(&pool)
            .await
            .unwrap();

    assert_eq!(raw_db_targets, json!([u2]).to_string());
}

#[tokio::test]
async fn test_whisper_reply_propagation() {
    let (app, pool, _) = setup_test_app_with_sockudo_mock().await;
    let (_u1, t1, c1) = create_test_user_with_device(&app, &pool, "wh_rep1").await;
    let (u2, t2, c2) = create_test_user_with_device(&app, &pool, "wh_rep2").await;

    let room_id = create_room(&app, &t1).await;
    add_member_to_room(&app, &room_id, &t1, &u2).await;

    let ct1 = BASE64.encode(b"parent whisper");
    let ct2 = BASE64.encode(b"reply whisper");

    // u1 sends parent whisper to u2
    let (_, p_body) = do_post(
        &app,
        &format!("/api/v1/rooms/{room_id}/messages"),
        &t1,
        &json!({
            "sender_client_id": c1,
            "epoch": 0,
            "content_type": "application",
            "ciphertext": ct1,
            "target_user_ids": [u2]
        }),
    )
    .await;
    let parent_id = p_body["message_id"].as_str().unwrap();

    // u2 sends reply whisper targeting u1
    let (status, r_body) = do_post(
        &app,
        &format!("/api/v1/rooms/{room_id}/messages"),
        &t2,
        &json!({
            "sender_client_id": c2,
            "epoch": 0,
            "content_type": "application",
            "ciphertext": ct2,
            "reply_to": parent_id,
            "target_user_ids": [_u1]
        }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(r_body["reply_to"], parent_id);

    let reply_id = r_body["message_id"].as_str().unwrap();

    // Fetch messages as u1 and assert reply_to propagates
    let (_, list1) = do_get(&app, &format!("/api/v1/rooms/{room_id}/messages"), &t1).await;
    let msgs = list1["messages"].as_array().unwrap();
    let reply_msg = msgs.iter().find(|m| m["id"] == reply_id).unwrap();
    assert_eq!(reply_msg["reply_to"], parent_id);
    assert_eq!(reply_msg["target_user_ids"], json!([_u1]));
}

#[tokio::test]
async fn test_public_reaction_events_publish_on_room_channel() {
    let (app, pool, mock_server) = setup_test_app_with_sockudo_mock().await;
    let (_u1, t1, c1) = create_test_user_with_device(&app, &pool, "pub_rx1").await;

    let room_id = create_room(&app, &t1).await;

    let ct = BASE64.encode(b"public for reaction");

    // Create public message
    let (_, msg_body) = do_post(
        &app,
        &format!("/api/v1/rooms/{room_id}/messages"),
        &t1,
        &json!({
            "sender_client_id": c1,
            "epoch": 0,
            "content_type": "application",
            "ciphertext": ct
        }),
    )
    .await;
    let msg_id = msg_body["message_id"].as_str().unwrap();

    // Add reaction to public message
    let (s_react, react_resp) = do_post(
        &app,
        &format!("/api/v1/rooms/{room_id}/messages/{msg_id}/reactions"),
        &t1,
        &json!({
            "reaction": "❤️",
            "sender_client_id": c1
        }),
    )
    .await;
    assert_eq!(s_react, StatusCode::CREATED);
    let rx_id = react_resp["id"].as_str().unwrap();

    let requests = mock_server.received_requests().await.unwrap();

    // Assert reaction.added WAS sent on room channel
    let room_rx_adds: Vec<Value> = requests
        .iter()
        .map(|r| serde_json::from_slice::<Value>(&r.body).unwrap())
        .filter(|b| {
            b["channels"][0] == format!("private-room-{room_id}") && b["name"] == "reaction.added"
        })
        .collect();
    assert_eq!(room_rx_adds.len(), 1);

    // Remove reaction
    let (s_unreact, _) = do_delete(
        &app,
        &format!("/api/v1/rooms/{room_id}/messages/{msg_id}/reactions/{rx_id}"),
        &t1,
    )
    .await;
    assert_eq!(s_unreact, StatusCode::NO_CONTENT);

    let requests2 = mock_server.received_requests().await.unwrap();

    // Assert reaction.removed WAS sent on room channel
    let room_rx_rems: Vec<Value> = requests2
        .iter()
        .map(|r| serde_json::from_slice::<Value>(&r.body).unwrap())
        .filter(|b| {
            b["channels"][0] == format!("private-room-{room_id}") && b["name"] == "reaction.removed"
        })
        .collect();
    assert_eq!(room_rx_rems.len(), 1);
}
