mod common;

use axum::http::StatusCode;
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use serde_json::{json, Value};
use tower::ServiceExt;

use sqlx::SqlitePool;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

async fn setup_test_app_with_sockudo_mock() -> (axum::Router, SqlitePool, MockServer) {
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

    let opaque_server = std::sync::Arc::new(
        server::OpaqueServer::load_or_generate(std::path::Path::new(
            "./data/test_oprf_rxn_evt.key",
        ))
        .unwrap(),
    );
    let registration_store = std::sync::Arc::new(server::RegistrationStore::new());
    let login_store = std::sync::Arc::new(server::LoginStore::new());
    let altcha_config = std::sync::Arc::new(
        server::AltchaConfig::from_env(&config, &pool)
            .await
            .unwrap(),
    );
    let server_hard_max = std::sync::Arc::new(server::ServerHardMax {
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
    let publisher = std::sync::Arc::new(server::Publisher::new(sockudo_cfg));

    let oprf_keys = server::oprf::OprfKeys::load(&opaque_server.setup).unwrap();
    let oprf = std::sync::Arc::new(server::oprf::OprfEvaluator::new(&oprf_keys));
    let oprf_audit = std::sync::Arc::new(server::oprf::OprfAuditCounter::new());

    let session_types_state = server::sessions::init_session_types_state(
        config.sessions_enabled,
        &config.session_types_config_path,
        config.server_max_session_participants,
        config.server_max_sessions_per_room,
    );
    let session_types = std::sync::Arc::new(server::sessions::SessionTypesStore::new(
        session_types_state,
    ));

    let state = server::AppState {
        pool: pool.clone(),
        opaque_server,
        registration_store,
        login_store,
        recovery_store: std::sync::Arc::new(server::RecoveryStore::new()),
        altcha_config,
        config: std::sync::Arc::new(config),
        server_hard_max,
        publisher,
        storage,
        backup_lock: std::sync::Arc::new(tokio::sync::Mutex::new(())),
        oprf_rotation_lock: std::sync::Arc::new(tokio::sync::Mutex::new(())),
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
async fn test_reaction_events_and_audit() {
    let (app, pool, mock_sockudo) = setup_test_app_with_sockudo_mock().await;

    let user_id = common::register_user(&app, "react_evt_user", "Password123!", None).await;
    let client_id = "evt_client_123456789";
    let (status, login_res) =
        common::login_user(&app, "react_evt_user", "Password123!", client_id, None).await;
    assert_eq!(status, StatusCode::OK);
    let user_token = login_res["session_token"].as_str().unwrap().to_string();

    // Create room
    let req = axum::http::Request::builder()
        .method("POST")
        .uri("/api/v1/rooms")
        .header("Authorization", format!("Bearer {}", user_token))
        .header("Content-Type", "application/json")
        .body(axum::body::Body::from(json!({}).to_string()))
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    let body_bytes = axum::body::to_bytes(res.into_body(), usize::MAX)
        .await
        .unwrap();
    let room_body: Value = serde_json::from_slice(&body_bytes).unwrap();
    let room_id = room_body["id"].as_str().unwrap();

    // Submit message
    let ct = BASE64.encode(b"message for reaction events");
    let req = axum::http::Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/messages", room_id))
        .header("Authorization", format!("Bearer {}", user_token))
        .header("Content-Type", "application/json")
        .body(axum::body::Body::from(
            json!({
                "sender_client_id": client_id,
                "epoch": 0,
                "content_type": "application",
                "ciphertext": ct,
            })
            .to_string(),
        ))
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    let body_bytes = axum::body::to_bytes(res.into_body(), usize::MAX)
        .await
        .unwrap();
    let msg_body: Value = serde_json::from_slice(&body_bytes).unwrap();
    let msg_id = msg_body["message_id"].as_str().unwrap();

    // 1. Add reaction -> 201 Created
    let req = axum::http::Request::builder()
        .method("POST")
        .uri(format!(
            "/api/v1/rooms/{}/messages/{}/reactions",
            room_id, msg_id
        ))
        .header("Authorization", format!("Bearer {}", user_token))
        .header("Content-Type", "application/json")
        .body(axum::body::Body::from(
            json!({
                "reaction": "🎉",
                "sender_client_id": client_id
            })
            .to_string(),
        ))
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::CREATED);
    let body_bytes = axum::body::to_bytes(res.into_body(), usize::MAX)
        .await
        .unwrap();
    let rxn_body: Value = serde_json::from_slice(&body_bytes).unwrap();
    let rxn_id = rxn_body["id"].as_str().unwrap().to_string();

    // Verify reaction.create audit log
    let audit_rows = sqlx::query(
        "SELECT action, target_type, metadata FROM audit_log WHERE action = 'reaction.create'",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(audit_rows.len(), 1);

    // Verify reaction.added event payload matching §8.9 strictly
    let requests = mock_sockudo.received_requests().await.unwrap();
    let added_req = requests
        .iter()
        .find(|r| {
            let body_json: Value = serde_json::from_slice(&r.body).unwrap_or_default();
            body_json["name"] == "reaction.added"
        })
        .expect("reaction.added event should be published");

    let added_body: Value = serde_json::from_slice(&added_req.body).unwrap();
    assert_eq!(
        added_body["channels"].as_array().unwrap()[0],
        format!("private-room-{}", room_id)
    );

    let data_json: Value = serde_json::from_str(added_body["data"].as_str().unwrap()).unwrap();
    assert_eq!(data_json["id"], rxn_id);
    assert_eq!(data_json["room_id"], room_id);
    assert_eq!(data_json["message_id"], msg_id);
    assert_eq!(data_json["sender_user_id"], user_id);
    assert_eq!(data_json["reaction"], "🎉");
    assert!(data_json.get("created_at").is_some());

    // Assert absence of deprecated/extra fields
    assert!(
        data_json.get("reaction_id").is_none(),
        "reaction_id must be absent from reaction.added payload"
    );
    assert!(
        data_json.get("user_id").is_none(),
        "user_id must be absent from reaction.added payload"
    );
    assert!(
        data_json.get("client_id").is_none(),
        "client_id must be absent from reaction.added payload"
    );

    let count_after_first_add = mock_sockudo.received_requests().await.unwrap().len();

    // Repeat add of active reaction -> returns 200 OK, does NOT publish reaction.added
    let req = axum::http::Request::builder()
        .method("POST")
        .uri(format!(
            "/api/v1/rooms/{}/messages/{}/reactions",
            room_id, msg_id
        ))
        .header("Authorization", format!("Bearer {}", user_token))
        .header("Content-Type", "application/json")
        .body(axum::body::Body::from(
            json!({
                "reaction": "🎉",
                "sender_client_id": client_id
            })
            .to_string(),
        ))
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);

    let count_after_repeat_add = mock_sockudo.received_requests().await.unwrap().len();
    assert_eq!(
        count_after_repeat_add, count_after_first_add,
        "Repeat add of active reaction must NOT publish reaction.added event"
    );

    // 2. Remove reaction by rxn_id -> 204 No Content
    let req = axum::http::Request::builder()
        .method("DELETE")
        .uri(format!(
            "/api/v1/rooms/{}/messages/{}/reactions/{}",
            room_id, msg_id, rxn_id
        ))
        .header("Authorization", format!("Bearer {}", user_token))
        .body(axum::body::Body::empty())
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::NO_CONTENT);

    // Verify reaction.delete audit log
    let audit_del_rows = sqlx::query(
        "SELECT action, target_type, metadata FROM audit_log WHERE action = 'reaction.delete'",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(audit_del_rows.len(), 1);

    // Verify reaction.removed event payload matching §8.9 strictly
    let all_requests = mock_sockudo.received_requests().await.unwrap();
    let removed_req = all_requests
        .iter()
        .find(|r| {
            let body_json: Value = serde_json::from_slice(&r.body).unwrap_or_default();
            body_json["name"] == "reaction.removed"
        })
        .expect("reaction.removed event should be published");

    let removed_body: Value = serde_json::from_slice(&removed_req.body).unwrap();
    assert_eq!(
        removed_body["channels"].as_array().unwrap()[0],
        format!("private-room-{}", room_id)
    );

    let rem_data: Value = serde_json::from_str(removed_body["data"].as_str().unwrap()).unwrap();
    assert_eq!(rem_data["id"], rxn_id);
    assert_eq!(rem_data["room_id"], room_id);
    assert_eq!(rem_data["message_id"], msg_id);

    // Assert absence of extra fields
    assert!(
        rem_data.get("reaction_id").is_none(),
        "reaction_id must be absent from reaction.removed payload"
    );
    assert!(
        rem_data.get("user_id").is_none(),
        "user_id must be absent from reaction.removed payload"
    );
    assert!(
        rem_data.get("client_id").is_none(),
        "client_id must be absent from reaction.removed payload"
    );
    assert!(
        rem_data.get("reaction").is_none(),
        "reaction must be absent from reaction.removed payload"
    );

    // Assert no reaction event was published on private-user-{user_id}
    let user_channel = format!("private-user-{}", user_id);
    for req in &all_requests {
        let body: Value = serde_json::from_slice(&req.body).unwrap_or_default();
        let event_name = body["name"].as_str().unwrap_or_default();
        if event_name == "reaction.added" || event_name == "reaction.removed" {
            if let Some(channels) = body["channels"].as_array() {
                for ch in channels {
                    assert_ne!(
                        ch.as_str().unwrap_or_default(),
                        user_channel,
                        "Reaction events must NOT be published on private-user channel"
                    );
                }
            }
        }
    }
}
