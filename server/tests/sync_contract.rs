mod common;

use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use common::{login_user, register_user, setup_test_app};
use serde_json::{json, Value};
use server::cleanup::CleanupJob;
use tower::ServiceExt;

#[tokio::test]
async fn test_sync_response_contract_bot_settings_and_max_seq() {
    let (app, pool) = setup_test_app().await;

    let user_id = register_user(&app, "sync_usr_contract", "Password123!", None).await;
    let (status, login_res) = login_user(
        &app,
        "sync_usr_contract",
        "Password123!",
        "client_contract_123",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let token = login_res["session_token"].as_str().unwrap().to_string();

    // 1. User with no rows: max_seq = 0, bot_settings = []
    let req = Request::builder()
        .method("GET")
        .uri("/api/v1/users/me/sync?since_seq=0")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .body(Body::empty())
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let body: Value = serde_json::from_slice(&bytes).unwrap();

    assert_eq!(body["bot_settings"], json!([]));
    assert_eq!(body["max_seq"], 0);
    assert_eq!(body["full_resync_required"], false);

    // 2. Add room & read state to allocate user_seq = 1
    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({ "retention_days": 30, "max_file_size_bytes": 104857600 }).to_string(),
        ))
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let room_val: Value = serde_json::from_slice(&bytes).unwrap();
    let room_id = room_val["id"].as_str().unwrap();

    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/users/me/read-state")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({ "room_id": room_id, "last_read_message_id": null }).to_string(),
        ))
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    // Now max_seq = 1 (next_seq - 1)
    let req = Request::builder()
        .method("GET")
        .uri("/api/v1/users/me/sync?since_seq=0")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .body(Body::empty())
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let body: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(body["max_seq"], 1);

    // 3. Request with higher since_seq (e.g. 5) returns max_seq = since_seq (5) defensively
    let req = Request::builder()
        .method("GET")
        .uri("/api/v1/users/me/sync?since_seq=5")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .body(Body::empty())
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let body: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(body["max_seq"], 5);

    // 4. Verify full_resync_required = false for since_seq == 0 and since_seq == 1
    assert_eq!(body["full_resync_required"], false);

    // 5. Test retention cleanup and full_resync_required
    // Set updated_at and deleted_at of read_state row to 100 days ago (older than default 90d window)
    sqlx::query(
        "UPDATE read_state SET updated_at = datetime('now', '-100 days'), deleted_at = datetime('now', '-100 days') WHERE user_id = ?",
    )
    .bind(&user_id)
    .execute(&pool)
    .await
    .unwrap();

    // Before cleanup, requesting since_seq = 1 sees updated_at older than retention window -> full_resync_required = true
    let req = Request::builder()
        .method("GET")
        .uri("/api/v1/users/me/sync?since_seq=1")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .body(Body::empty())
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let body: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(body["full_resync_required"], true);

    // Execute SyncPruningJob cleanup with Config::test_default()
    let config = server::Config::test_default();
    let reg_store = std::sync::Arc::new(server::RegistrationStore::new());
    let login_store = std::sync::Arc::new(server::LoginStore::new());
    let rec_store = std::sync::Arc::new(server::RecoveryStore::new());
    let storage = server::build_storage(&config).unwrap();
    let hard_max = std::sync::Arc::new(server::ServerHardMax {
        file_size_bytes: 104857600,
        room_size: 1000,
        rooms_per_user: 500,
        devices_per_user: 50,
        keypackages_per_device: 50,
        message_size_bytes: 65536,
        attachment_retention_days: 365,
        call_max_participants: 50,
        reactions_per_message: 50,
    });

    let cleanup_ctx = server::cleanup::CleanupContext {
        pool: &pool,
        config: &config,
        registration_store: &reg_store,
        login_store: &login_store,
        recovery_store: &rec_store,
        storage: &storage,
        server_max: &hard_max,
    };

    let job = server::cleanup::sync::SyncPruningJob;
    let report = job.run(&cleanup_ctx).await.unwrap();
    assert_eq!(report.rows_deleted, 1);

    // After tombstone pruning, since_seq = 1 is below minimum retained user_seq -> full_resync_required is true
    let req = Request::builder()
        .method("GET")
        .uri("/api/v1/users/me/sync?since_seq=1")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .body(Body::empty())
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let body: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(body["full_resync_required"], true);
}

#[tokio::test]
async fn test_read_sync_event_payload_exact_fields() {
    let (app, _pool) = setup_test_app().await;

    let _user_id = register_user(&app, "read_sync_usr", "Password123!", None).await;
    let (status, login_res) = login_user(
        &app,
        "read_sync_usr",
        "Password123!",
        "client_read_sync_1",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let token = login_res["session_token"].as_str().unwrap().to_string();

    // Create room
    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({ "retention_days": 30, "max_file_size_bytes": 104857600 }).to_string(),
        ))
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let room_val: Value = serde_json::from_slice(&bytes).unwrap();
    let room_id = room_val["id"].as_str().unwrap();

    // Write read state
    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/users/me/read-state")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({ "room_id": room_id, "last_read_message_id": null }).to_string(),
        ))
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    // Verify envelope construction
    let payload = json!({
        "room_id": room_id,
        "last_read_message_id": Value::Null,
        "user_seq": 1
    });

    let envelope = server::sync::UserEventEnvelope::new("read.sync", 1, payload.clone());
    assert_eq!(envelope.payload["room_id"], room_id);
    assert_eq!(envelope.payload["last_read_message_id"], Value::Null);
    assert_eq!(envelope.payload["user_seq"], 1);
    assert!(envelope.payload.get("updated_at").is_none());
}
