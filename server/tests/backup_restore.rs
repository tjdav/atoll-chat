use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use serde_json::{json, Value};
use std::sync::Arc;
use tempfile::tempdir;
use tower::ServiceExt;

use server::backup::{restore_backup, BackupJob, RestoreOptions};
use server::Config;

mod common;
use common::{login_user, register_user};

#[tokio::test]
async fn test_end_to_end_backup_and_restore() {
    let tmp = tempdir().unwrap();
    let db_path = tmp.path().join("app.db");
    let oprf_path = tmp.path().join("oprf.key");
    let backups_dir = tmp.path().join("backups");
    let attachments_dir = tmp.path().join("attachments");

    let opaque_server =
        Arc::new(server::OpaqueServer::load_or_generate(&oprf_path).expect("OpaqueServer"));

    let pool = sqlx::sqlite::SqlitePoolOptions::new()
        .max_connections(1)
        .connect(&format!("sqlite:{}?mode=rwc", db_path.display()))
        .await
        .unwrap();

    sqlx::migrate!("./migrations").run(&pool).await.unwrap();

    let config = Config {
        db_path: db_path.to_string_lossy().to_string(),
        opaque_oprf_key_path: oprf_path.to_string_lossy().to_string(),
        backup_path: backups_dir.clone(),
        storage_fs_path: attachments_dir.clone(),
        altcha_enabled: true,
        altcha_hmac_secret: "auto".to_string(),
        altcha_cost: 100,
        ..Config::test_default()
    };

    let registration_store = Arc::new(server::RegistrationStore::new());
    let login_store = Arc::new(server::LoginStore::new());
    let altcha_config = Arc::new(
        server::AltchaConfig::from_env(&config, &pool)
            .await
            .unwrap(),
    );
    let server_hard_max = Arc::new(server::ServerHardMax::default());
    let sockudo_cfg = server::SockudoConfig {
        http_base: "http://localhost:6001".to_string(),
        app_id: "chat".to_string(),
        app_key: "test-key".to_string(),
        app_secret: "test-secret".to_string(),
        enable_client_events: false,
    };
    let config_arc = Arc::new(config.clone());
    let storage = server::build_storage(&config_arc).expect("Failed to build storage");
    let publisher = Arc::new(server::Publisher::new(sockudo_cfg));
    let backup_lock = Arc::new(tokio::sync::Mutex::new(()));

    let state = server::AppState {
        pool: pool.clone(),
        opaque_server: opaque_server.clone(),
        registration_store,
        login_store,
        altcha_config,
        config: config_arc.clone(),
        server_hard_max,
        publisher,
        storage,
        backup_lock,
        vapid_keys: None,
    };

    let app = server::build_app(state);

    // 1. Register user
    let user_id = register_user(&app, "alice", "password123", None).await;
    let (status, login_res) =
        login_user(&app, "alice", "password123", "client_alice_123", None).await;
    assert_eq!(status, StatusCode::OK);
    let token = login_res["session_token"].as_str().unwrap().to_string();

    // 2. Create room
    let create_room_req = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({}).to_string()))
        .unwrap();

    let create_room_resp = app.clone().oneshot(create_room_req).await.unwrap();
    assert_eq!(create_room_resp.status(), StatusCode::CREATED);
    let room_body: Value = serde_json::from_slice(
        &axum::body::to_bytes(create_room_resp.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    let room_id = room_body["id"].as_str().unwrap().to_string();

    // 3. Submit message
    let ct_b64 = BASE64.encode(b"secret message ciphertext");
    let msg_req = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{room_id}/messages"))
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "sender_client_id": "client_alice_123",
                "epoch": 0,
                "content_type": "application",
                "ciphertext": ct_b64,
            })
            .to_string(),
        ))
        .unwrap();

    let msg_resp = app.clone().oneshot(msg_req).await.unwrap();
    assert_eq!(msg_resp.status(), StatusCode::CREATED);

    // 4. Trigger backup via BackupJob
    let job = BackupJob::new(config_arc.clone());
    let backup_res = job.run_once(&pool).await.unwrap();

    // Close pool
    pool.close().await;

    // 5. Mutate the DB on disk by adding a bogus row directly in a new connection
    {
        let mutate_pool = sqlx::sqlite::SqlitePoolOptions::new()
            .connect(&format!("sqlite:{}", db_path.display()))
            .await
            .unwrap();

        sqlx::query("UPDATE users SET display_name = 'corrupted' WHERE id = ?")
            .bind(&user_id)
            .execute(&mutate_pool)
            .await
            .unwrap();

        mutate_pool.close().await;
    }

    // 6. Restore from backup
    restore_backup(
        &config,
        RestoreOptions {
            from: backup_res.path,
            confirm: true,
        },
    )
    .await
    .unwrap();

    // 7. Verify DB state restored
    let verify_pool = sqlx::sqlite::SqlitePoolOptions::new()
        .connect(&format!("sqlite:{}", db_path.display()))
        .await
        .unwrap();

    let display_name: Option<String> =
        sqlx::query_scalar("SELECT display_name FROM users WHERE id = ?")
            .bind(&user_id)
            .fetch_one(&verify_pool)
            .await
            .unwrap();
    assert_eq!(display_name, None);

    let alice_exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM users WHERE id = ?)")
        .bind(&user_id)
        .fetch_one(&verify_pool)
        .await
        .unwrap();
    assert!(alice_exists);

    let msg_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM room_messages WHERE room_id = ?")
        .bind(&room_id)
        .fetch_one(&verify_pool)
        .await
        .unwrap();
    assert_eq!(msg_count, 1);
}
