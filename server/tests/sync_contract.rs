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

    // 1. User with no sync rows: max_seq = 1 (allocated on device creation during login), bot_settings = []
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
    assert_eq!(body["max_seq"], 1);
    assert_eq!(body["full_resync_required"], false);

    // 2. Add room & read state to allocate user_seq = 2
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

    // Now max_seq = 2 (next_seq - 1)
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
    assert_eq!(body["max_seq"], 2);

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
        room_metadata_bytes: config.server_max_room_metadata_bytes,
        edit_window_seconds: config.server_max_edit_window_seconds,
    });

    let sockudo_cfg = server::SockudoConfig {
        http_base: "http://localhost:8080".to_string(),
        app_id: "test_app".to_string(),
        app_key: "test_key".to_string(),
        app_secret: "test_secret".to_string(),
        enable_client_events: true,
    };
    let publisher = std::sync::Arc::new(server::Publisher::new(sockudo_cfg));

    let cleanup_ctx = server::cleanup::CleanupContext {
        pool: &pool,
        config: &config,
        registration_store: &reg_store,
        login_store: &login_store,
        recovery_store: &rec_store,
        storage: &storage,
        server_max: &hard_max,
        publisher: &publisher,
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

#[test]
fn test_bot_setting_sync_row_struct_deserialization() {
    let json_data = json!({
        "bot_id": "b_123",
        "key": "test_key",
        "is_secret": true,
        "value_encrypted_client": null,
        "user_seq": 42
    });

    let row: server::sync::BotSettingSyncRow = serde_json::from_value(json_data).unwrap();
    assert_eq!(row.bot_id, "b_123");
    assert_eq!(row.key, "test_key");
    assert!(row.is_secret);
    assert_eq!(row.value_encrypted_client, None);
    assert_eq!(row.user_seq, 42);

    let json_data_false = json!({
        "bot_id": "b_456",
        "key": "public_key",
        "is_secret": false,
        "value_encrypted_client": "enc_val",
        "user_seq": 43
    });

    let row_false: server::sync::BotSettingSyncRow =
        serde_json::from_value(json_data_false).unwrap();
    assert!(!row_false.is_secret);
    assert_eq!(
        row_false.value_encrypted_client,
        Some("enc_val".to_string())
    );
}

#[tokio::test]
async fn test_sync_pruning_job_tombstone_active_and_idempotency() {
    let pool = common::setup_test_db().await;

    // Create user and user_seq = 10 (next_seq = 11)
    sqlx::query("INSERT INTO users (id, username_token, opaque_registration, identity_pubkey) VALUES ('u_prune', 'token_prune_1234567890123456789012345678901234567890123456789012345678901234567890123456789012', 'reg', 'pub')")
        .execute(&pool)
        .await
        .unwrap();

    sqlx::query("INSERT INTO user_seq (user_id, next_seq) VALUES ('u_prune', 11)")
        .execute(&pool)
        .await
        .unwrap();

    sqlx::query("INSERT INTO rooms (id, owner_id) VALUES ('r_prune', 'u_prune')")
        .execute(&pool)
        .await
        .unwrap();

    // 1. Tombstone older than 90d with user_seq <= 10 -> MUST BE PRUNED
    sqlx::query("INSERT INTO read_state (user_id, room_id, last_read_message_id, user_seq, updated_at, deleted_at) VALUES ('u_prune', 'r_prune', NULL, 1, datetime('now', '-100 days'), datetime('now', '-100 days'))")
        .execute(&pool)
        .await
        .unwrap();

    // 2. Active row older than 90d with user_seq <= 10 (deleted_at IS NULL) -> MUST NOT BE PRUNED
    sqlx::query("INSERT INTO user_preferences (user_id, key, value_json, user_seq, updated_at) VALUES ('u_prune', 'pref1', '{}', 2, datetime('now', '-100 days'))")
        .execute(&pool)
        .await
        .unwrap();

    // 3. Tombstone within 90d window (deleted_at = 10d ago) -> MUST NOT BE PRUNED
    sqlx::query("INSERT INTO starred_items (user_id, item_id, item_type, room_id, user_seq, starred_at, deleted_at) VALUES ('u_prune', 'item1', 'message', 'r_prune', 3, datetime('now', '-10 days'), datetime('now', '-10 days'))")
        .execute(&pool)
        .await
        .unwrap();

    // Insert device for device_names FK constraint
    sqlx::query("INSERT INTO devices (id, user_id, client_id, platform) VALUES ('d999', 'u_prune', 'c999', 'web')")
        .execute(&pool)
        .await
        .unwrap();

    // 4. Tombstone older than 90d with user_seq > 10 (user_seq = 999) -> MUST NOT BE PRUNED (defensive invariant)
    sqlx::query("INSERT INTO device_names (user_id, device_id, encrypted_device_name, user_seq, updated_at, deleted_at) VALUES ('u_prune', 'd999', 'enc_dev', 999, datetime('now', '-100 days'), datetime('now', '-100 days'))")
        .execute(&pool)
        .await
        .unwrap();

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
        room_metadata_bytes: config.server_max_room_metadata_bytes,
        edit_window_seconds: config.server_max_edit_window_seconds,
    });

    let sockudo_cfg = server::SockudoConfig {
        http_base: "http://localhost:8080".to_string(),
        app_id: "test_app".to_string(),
        app_key: "test_key".to_string(),
        app_secret: "test_secret".to_string(),
        enable_client_events: true,
    };
    let publisher = std::sync::Arc::new(server::Publisher::new(sockudo_cfg));

    let cleanup_ctx = server::cleanup::CleanupContext {
        pool: &pool,
        config: &config,
        registration_store: &reg_store,
        login_store: &login_store,
        recovery_store: &rec_store,
        storage: &storage,
        server_max: &hard_max,
        publisher: &publisher,
    };

    let job = server::cleanup::sync::SyncPruningJob;

    // Run 1: exactly 1 row (read_state tombstone) pruned
    let report1 = job.run(&cleanup_ctx).await.unwrap();
    assert_eq!(report1.rows_deleted, 1);

    // Verify read_state tombstone was deleted
    let rs_exists: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM read_state WHERE user_id = 'u_prune')")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(!rs_exists);

    // Verify active preference preserved
    let pref_exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM user_preferences WHERE user_id = 'u_prune')",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(pref_exists);

    // Verify recent tombstone preserved
    let star_exists: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM starred_items WHERE user_id = 'u_prune')")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(star_exists);

    // Verify high user_seq tombstone preserved
    let dev_exists: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM device_names WHERE user_id = 'u_prune')")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(dev_exists);

    // Run 2: Idempotency check -> 0 rows deleted
    let report2 = job.run(&cleanup_ctx).await.unwrap();
    assert_eq!(report2.rows_deleted, 0);
}
