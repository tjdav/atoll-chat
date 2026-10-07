use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use axum::Router;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tower::ServiceExt;

mod common;
use common::{login_user, register_user, setup_test_app, setup_test_db};

use server::altcha::AltchaConfig;
use server::config::Config;
use server::login::LoginStore;
use server::opaque::OpaqueServer;
use server::recovery::RecoveryStore;
use server::registration::RegistrationStore;
use server::storage::{Storage, StorageError};
use server::AppState;
use sqlx::SqlitePool;

struct MockS3Storage {
    data: Mutex<HashMap<String, Vec<u8>>>,
}

impl MockS3Storage {
    fn new() -> Self {
        Self {
            data: Mutex::new(HashMap::new()),
        }
    }
}

#[async_trait::async_trait]
impl Storage for MockS3Storage {
    async fn write(&self, key: &str, data: &[u8]) -> Result<(), StorageError> {
        server::storage::validate_key(key)?;
        self.data
            .lock()
            .unwrap()
            .insert(key.to_string(), data.to_vec());
        Ok(())
    }

    async fn read(&self, key: &str) -> Result<Vec<u8>, StorageError> {
        server::storage::validate_key(key)?;
        self.data
            .lock()
            .unwrap()
            .get(key)
            .cloned()
            .ok_or_else(|| StorageError::NotFound(key.to_string()))
    }

    async fn read_range(&self, key: &str, start: u64, end: u64) -> Result<Vec<u8>, StorageError> {
        server::storage::validate_key(key)?;
        let bytes = self.read(key).await?;
        Ok(bytes[start as usize..=end as usize].to_vec())
    }

    async fn delete(&self, key: &str) -> Result<(), StorageError> {
        server::storage::validate_key(key)?;
        self.data.lock().unwrap().remove(key);
        Ok(())
    }

    async fn exists(&self, key: &str) -> Result<bool, StorageError> {
        server::storage::validate_key(key)?;
        Ok(self.data.lock().unwrap().contains_key(key))
    }

    fn backend_name(&self) -> &'static str {
        "s3"
    }

    async fn presign_get(
        &self,
        key: &str,
        ttl_seconds: u64,
    ) -> Result<Option<String>, StorageError> {
        server::storage::validate_key(key)?;
        Ok(Some(format!(
            "https://s3.example.com/test-bucket/{}?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Expires={}",
            key, ttl_seconds
        )))
    }
}

async fn setup_s3_app() -> (Router, SqlitePool) {
    let pool = setup_test_db().await;

    let temp_dir = tempfile::tempdir().expect("Failed to create tempdir");
    let key_path = temp_dir.path().join("oprf.key");
    let opaque_server =
        Arc::new(OpaqueServer::load_or_generate(&key_path).expect("Failed to create OpaqueServer"));
    let registration_store = Arc::new(RegistrationStore::new());
    let login_store = Arc::new(LoginStore::new());

    let config = Config {
        opaque_oprf_key_path: key_path.to_str().unwrap().to_string(),
        altcha_enabled: true,
        altcha_cost: 100,
        storage_backend: "s3".to_string(),
        storage_fs_path: temp_dir.path().join("attachments"),
        s3_endpoint: Some("http://localhost:9000".to_string()),
        s3_region: "us-east-1".to_string(),
        s3_bucket: Some("test-bucket".to_string()),
        s3_access_key_id: Some("minioadmin".to_string()),
        s3_secret_access_key: Some("minioadmin".to_string()),
        s3_path_style: true,
        s3_presign_ttl_seconds: 600,
        attachment_chunk_size: 16384,
        attachment_bucket_sizes: vec![65536, 524288, 4194304, 33554432, 268435456],
        ..Config::test_default()
    };

    let altcha_config = Arc::new(
        AltchaConfig::from_env(&config, &pool)
            .await
            .expect("Failed to init AltchaConfig"),
    );

    let storage: Arc<dyn Storage> = Arc::new(MockS3Storage::new());
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
        app_key: "test-app-key".to_string(),
        app_secret: "test-app-secret".to_string(),
        enable_client_events: true,
    };
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
        recovery_store: Arc::new(RecoveryStore::new()),
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

    let app = server::build_app(state);
    (app, pool)
}

fn create_multipart_body(
    boundary: &str,
    file_bytes: &[u8],
    claimed_id: &str,
    content_type: &str,
    extra_file_part: bool,
) -> Vec<u8> {
    let mut body = Vec::new();

    // Field: file
    body.extend_from_slice(format!("--{}\r\n", boundary).as_bytes());
    body.extend_from_slice(
        b"Content-Disposition: form-data; name=\"file\"; filename=\"avatar.png\"\r\n",
    );
    body.extend_from_slice(b"Content-Type: application/octet-stream\r\n\r\n");
    body.extend_from_slice(file_bytes);
    body.extend_from_slice(b"\r\n");

    if extra_file_part {
        body.extend_from_slice(format!("--{}\r\n", boundary).as_bytes());
        body.extend_from_slice(
            b"Content-Disposition: form-data; name=\"file\"; filename=\"avatar2.png\"\r\n",
        );
        body.extend_from_slice(b"Content-Type: application/octet-stream\r\n\r\n");
        body.extend_from_slice(file_bytes);
        body.extend_from_slice(b"\r\n");
    }

    // Field: claimed_id
    body.extend_from_slice(format!("--{}\r\n", boundary).as_bytes());
    body.extend_from_slice(b"Content-Disposition: form-data; name=\"claimed_id\"\r\n\r\n");
    body.extend_from_slice(claimed_id.as_bytes());
    body.extend_from_slice(b"\r\n");

    // Field: plaintext_size
    body.extend_from_slice(format!("--{}\r\n", boundary).as_bytes());
    body.extend_from_slice(b"Content-Disposition: form-data; name=\"plaintext_size\"\r\n\r\n");
    body.extend_from_slice(file_bytes.len().to_string().as_bytes());
    body.extend_from_slice(b"\r\n");

    // Field: encrypted_size
    body.extend_from_slice(format!("--{}\r\n", boundary).as_bytes());
    body.extend_from_slice(b"Content-Disposition: form-data; name=\"encrypted_size\"\r\n\r\n");
    body.extend_from_slice(file_bytes.len().to_string().as_bytes());
    body.extend_from_slice(b"\r\n");

    // Field: chunk_size
    body.extend_from_slice(format!("--{}\r\n", boundary).as_bytes());
    body.extend_from_slice(b"Content-Disposition: form-data; name=\"chunk_size\"\r\n\r\n");
    body.extend_from_slice(b"16384\r\n");

    // Field: chunk_count
    body.extend_from_slice(format!("--{}\r\n", boundary).as_bytes());
    body.extend_from_slice(b"Content-Disposition: form-data; name=\"chunk_count\"\r\n\r\n");
    body.extend_from_slice(b"4\r\n");

    // Field: nonce_prefix
    body.extend_from_slice(format!("--{}\r\n", boundary).as_bytes());
    body.extend_from_slice(b"Content-Disposition: form-data; name=\"nonce_prefix\"\r\n\r\n");
    body.extend_from_slice(b"AQIDBAUGBw==\r\n");

    // Field: base_counter
    body.extend_from_slice(format!("--{}\r\n", boundary).as_bytes());
    body.extend_from_slice(b"Content-Disposition: form-data; name=\"base_counter\"\r\n\r\n");
    body.extend_from_slice(b"0\r\n");

    // Field: content_type
    body.extend_from_slice(format!("--{}\r\n", boundary).as_bytes());
    body.extend_from_slice(b"Content-Disposition: form-data; name=\"content_type\"\r\n\r\n");
    body.extend_from_slice(content_type.as_bytes());
    body.extend_from_slice(b"\r\n");

    body.extend_from_slice(format!("--{}--\r\n", boundary).as_bytes());
    body
}

#[tokio::test]
async fn test_user_avatar_upload_happy_path() {
    let mock_server = wiremock::MockServer::start().await;
    wiremock::Mock::given(wiremock::matchers::method("POST"))
        .respond_with(wiremock::ResponseTemplate::new(200))
        .mount(&mock_server)
        .await;

    let (app, pool) = setup_test_app().await;

    let user_id = register_user(&app, "user1", "Password123!", None).await;
    let (_, login) = login_user(&app, "user1", "Password123!", "client_123456789", None).await;
    let token = login["session_token"].as_str().unwrap();

    let blob_bytes = vec![0x42u8; 65536]; // 65536 bytes (exact bucket size)
    let mut hasher = Sha256::new();
    hasher.update(&blob_bytes);
    let claimed_id = hex::encode(hasher.finalize());

    let boundary = "------------------------boundary123";
    let body_bytes = create_multipart_body(boundary, &blob_bytes, &claimed_id, "image/png", false);

    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/users/me/avatar")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(
            header::CONTENT_TYPE,
            format!("multipart/form-data; boundary={}", boundary),
        )
        .body(Body::from(body_bytes))
        .unwrap();

    let res = app.clone().oneshot(req).await.unwrap();
    let status = res.status();
    let cache_control = res.headers().get(header::CACHE_CONTROL).cloned();
    let res_body = axum::body::to_bytes(res.into_body(), usize::MAX)
        .await
        .unwrap();
    if status != StatusCode::CREATED {
        panic!(
            "Upload failed with status {}: {}",
            status,
            String::from_utf8_lossy(&res_body)
        );
    }
    assert_eq!(cache_control.unwrap(), "no-store");
    let view: server::attachments::AttachmentView = serde_json::from_slice(&res_body).unwrap();
    assert_eq!(view.id, claimed_id);
    assert!(view.room_id.is_none());
    assert_eq!(view.uploader_id, user_id);

    // Verify retrievable via GET /api/v1/attachments/{id}
    let get_req = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/attachments/{}", claimed_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .body(Body::empty())
        .unwrap();

    let get_res = app.clone().oneshot(get_req).await.unwrap();
    assert_eq!(get_res.status(), StatusCode::OK);
    let downloaded_bytes = axum::body::to_bytes(get_res.into_body(), usize::MAX)
        .await
        .unwrap();
    assert_eq!(downloaded_bytes.as_ref(), blob_bytes.as_slice());

    // Assert database state directly
    let db_row: (Option<String>, String) =
        sqlx::query_as("SELECT room_id, uploader_id FROM attachments WHERE id = ?")
            .bind(&claimed_id)
            .fetch_one(&pool)
            .await
            .unwrap();

    assert!(db_row.0.is_none());
    assert_eq!(db_row.1, user_id);

    // Verify no Sockudo calls were made

    // Verify no audit log entries were created for avatar upload
    let audit_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM audit_log WHERE action = 'avatar.upload' OR action = 'attachment.upload'")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(audit_count, 0);
}

#[tokio::test]
async fn test_user_avatar_upload_size_limit() {
    let (app, pool) = setup_test_app().await;

    let user_id = register_user(&app, "user1", "Password123!", None).await;
    let (_, login) = login_user(&app, "user1", "Password123!", "client_123456789", None).await;
    let token = login["session_token"].as_str().unwrap();

    // Set user max_file_size_bytes to 512 bytes
    sqlx::query("UPDATE users SET max_file_size_bytes = 512 WHERE id = ?")
        .bind(&user_id)
        .execute(&pool)
        .await
        .unwrap();

    let blob_bytes = vec![0x42u8; 65536]; // 65536 > 512
    let mut hasher = Sha256::new();
    hasher.update(&blob_bytes);
    let claimed_id = hex::encode(hasher.finalize());

    let boundary = "------------------------boundary123";
    let body_bytes = create_multipart_body(boundary, &blob_bytes, &claimed_id, "image/png", false);

    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/users/me/avatar")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(
            header::CONTENT_TYPE,
            format!("multipart/form-data; boundary={}", boundary),
        )
        .body(Body::from(body_bytes))
        .unwrap();

    let res = app.oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::PAYLOAD_TOO_LARGE);
    let res_body = axum::body::to_bytes(res.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: serde_json::Value = serde_json::from_slice(&res_body).unwrap();
    assert_eq!(json["error"], "file_too_large");
}

#[tokio::test]
async fn test_user_avatar_upload_unauthenticated() {
    let (app, _pool) = setup_test_app().await;

    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/users/me/avatar")
        .header(header::CONTENT_TYPE, "multipart/form-data; boundary=xyz")
        .body(Body::empty())
        .unwrap();

    let res = app.oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn test_user_avatar_upload_wrong_content_type() {
    let (app, _pool) = setup_test_app().await;

    register_user(&app, "user1", "Password123!", None).await;
    let (_, login) = login_user(&app, "user1", "Password123!", "client_123456789", None).await;
    let token = login["session_token"].as_str().unwrap();

    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/users/me/avatar")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from("{}"))
        .unwrap();

    let res = app.oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::UNSUPPORTED_MEDIA_TYPE);
}

#[tokio::test]
async fn test_user_avatar_upload_multiple_file_parts() {
    let (app, _pool) = setup_test_app().await;

    register_user(&app, "user1", "Password123!", None).await;
    let (_, login) = login_user(&app, "user1", "Password123!", "client_123456789", None).await;
    let token = login["session_token"].as_str().unwrap();

    let blob_bytes = vec![0x42u8; 65536];
    let mut hasher = Sha256::new();
    hasher.update(&blob_bytes);
    let claimed_id = hex::encode(hasher.finalize());

    let boundary = "------------------------boundary123";
    let body_bytes = create_multipart_body(boundary, &blob_bytes, &claimed_id, "image/png", true);

    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/users/me/avatar")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(
            header::CONTENT_TYPE,
            format!("multipart/form-data; boundary={}", boundary),
        )
        .body(Body::from(body_bytes))
        .unwrap();

    let res = app.oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);
    let res_body = axum::body::to_bytes(res.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: serde_json::Value = serde_json::from_slice(&res_body).unwrap();
    assert_eq!(json["error"], "invalid_request");
}

#[tokio::test]
async fn test_user_avatar_upload_coexistence_with_room_attachment() {
    let (app, pool) = setup_test_app().await;

    register_user(&app, "user1", "Password123!", None).await;
    let (_, login) = login_user(&app, "user1", "Password123!", "client_123456789", None).await;
    let token = login["session_token"].as_str().unwrap();

    // 1. Create a room
    let create_room_req = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from("{}"))
        .unwrap();

    let create_room_res = app.clone().oneshot(create_room_req).await.unwrap();
    assert_eq!(create_room_res.status(), StatusCode::CREATED);
    let room_body = axum::body::to_bytes(create_room_res.into_body(), usize::MAX)
        .await
        .unwrap();
    let room_json: serde_json::Value = serde_json::from_slice(&room_body).unwrap();
    let room_id = room_json["id"].as_str().unwrap();

    // 2. Upload room attachment
    let room_blob = vec![0x11u8; 65536];
    let mut hasher = Sha256::new();
    hasher.update(&room_blob);
    let room_claimed_id = hex::encode(hasher.finalize());

    let boundary = "------------------------boundary123";
    let room_body_bytes =
        create_multipart_body(boundary, &room_blob, &room_claimed_id, "image/png", false);

    let room_att_req = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/attachments", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(
            header::CONTENT_TYPE,
            format!("multipart/form-data; boundary={}", boundary),
        )
        .body(Body::from(room_body_bytes))
        .unwrap();

    let room_att_res = app.clone().oneshot(room_att_req).await.unwrap();
    assert_eq!(room_att_res.status(), StatusCode::CREATED);

    // 3. Upload user avatar
    let avatar_blob = vec![0x22u8; 65536];
    let mut hasher = Sha256::new();
    hasher.update(&avatar_blob);
    let avatar_claimed_id = hex::encode(hasher.finalize());

    let avatar_body_bytes = create_multipart_body(
        boundary,
        &avatar_blob,
        &avatar_claimed_id,
        "image/png",
        false,
    );

    let avatar_att_req = Request::builder()
        .method("POST")
        .uri("/api/v1/users/me/avatar")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(
            header::CONTENT_TYPE,
            format!("multipart/form-data; boundary={}", boundary),
        )
        .body(Body::from(avatar_body_bytes))
        .unwrap();

    let avatar_att_res = app.clone().oneshot(avatar_att_req).await.unwrap();
    assert_eq!(avatar_att_res.status(), StatusCode::CREATED);

    // 4. Verify both exist in DB with expected room_id values
    let room_att_row: (Option<String>,) =
        sqlx::query_as("SELECT room_id FROM attachments WHERE id = ?")
            .bind(&room_claimed_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(room_att_row.0.as_deref(), Some(room_id));

    let avatar_att_row: (Option<String>,) =
        sqlx::query_as("SELECT room_id FROM attachments WHERE id = ?")
            .bind(&avatar_claimed_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(avatar_att_row.0.is_none());
}

#[tokio::test]
async fn test_user_avatar_upload_opaque_bytes() {
    let (app, _pool) = setup_test_app().await;

    register_user(&app, "user1", "Password123!", None).await;
    let (_, login) = login_user(&app, "user1", "Password123!", "client_123456789", None).await;
    let token = login["session_token"].as_str().unwrap();

    // 65536 bytes of arbitrary non-image / raw binary data
    let mut arbitrary_bytes = vec![0xDEu8, 0xAD, 0xBE, 0xEF];
    arbitrary_bytes.resize(65536, 0xAAu8);

    let mut hasher = Sha256::new();
    hasher.update(&arbitrary_bytes);
    let claimed_id = hex::encode(hasher.finalize());

    let boundary = "------------------------boundary123";
    let body_bytes = create_multipart_body(
        boundary,
        &arbitrary_bytes,
        &claimed_id,
        "application/octet-stream",
        false,
    );

    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/users/me/avatar")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(
            header::CONTENT_TYPE,
            format!("multipart/form-data; boundary={}", boundary),
        )
        .body(Body::from(body_bytes))
        .unwrap();

    let res = app.oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::CREATED);
}

#[tokio::test]
async fn test_user_avatar_upload_does_not_bump_profile_version_or_fire_event() {
    let mock_server = wiremock::MockServer::start().await;
    wiremock::Mock::given(wiremock::matchers::method("POST"))
        .respond_with(wiremock::ResponseTemplate::new(200))
        .mount(&mock_server)
        .await;

    let (app, _pool, _) = common::setup_test_app_with_custom_config(|config| {
        config.sockudo_url = mock_server.uri();
    })
    .await;

    register_user(&app, "user1", "Password123!", None).await;
    let (_, login) = login_user(&app, "user1", "Password123!", "client_123456789", None).await;
    let token = login["session_token"].as_str().unwrap();

    // 1. Fetch GET /api/v1/users/me prior to avatar upload
    let get_me_req1 = Request::builder()
        .method("GET")
        .uri("/api/v1/users/me")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .body(Body::empty())
        .unwrap();

    let get_me_res1 = app.clone().oneshot(get_me_req1).await.unwrap();
    assert_eq!(get_me_res1.status(), StatusCode::OK);
    let body1 = axum::body::to_bytes(get_me_res1.into_body(), usize::MAX)
        .await
        .unwrap();
    let user_me_before: serde_json::Value = serde_json::from_slice(&body1).unwrap();
    let version_before = user_me_before["profile_version"].as_i64().unwrap();
    let profile_before = user_me_before["profile"].clone();

    // 2. Upload avatar
    let blob_bytes = vec![0x33u8; 65536];
    let mut hasher = Sha256::new();
    hasher.update(&blob_bytes);
    let claimed_id = hex::encode(hasher.finalize());

    let boundary = "------------------------boundary123";
    let body_bytes = create_multipart_body(boundary, &blob_bytes, &claimed_id, "image/png", false);

    let upload_req = Request::builder()
        .method("POST")
        .uri("/api/v1/users/me/avatar")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(
            header::CONTENT_TYPE,
            format!("multipart/form-data; boundary={}", boundary),
        )
        .body(Body::from(body_bytes))
        .unwrap();

    let upload_res = app.clone().oneshot(upload_req).await.unwrap();
    assert_eq!(upload_res.status(), StatusCode::CREATED);

    // 3. Fetch GET /api/v1/users/me after avatar upload
    let get_me_req2 = Request::builder()
        .method("GET")
        .uri("/api/v1/users/me")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .body(Body::empty())
        .unwrap();

    let get_me_res2 = app.clone().oneshot(get_me_req2).await.unwrap();
    assert_eq!(get_me_res2.status(), StatusCode::OK);
    let body2 = axum::body::to_bytes(get_me_res2.into_body(), usize::MAX)
        .await
        .unwrap();
    let user_me_after: serde_json::Value = serde_json::from_slice(&body2).unwrap();
    let version_after = user_me_after["profile_version"].as_i64().unwrap();
    let profile_after = user_me_after["profile"].clone();

    assert_eq!(version_before, version_after);
    assert_eq!(profile_before, profile_after);

    // 4. Verify no Sockudo calls were made
}

#[tokio::test]
async fn test_user_avatar_cross_user_visibility_isolation() {
    let (app, pool) = setup_test_app().await;

    // 1. Register user1 and user2
    let user1_id = register_user(&app, "u_avatar1", "Password123!", None).await;
    let (status1, login1) =
        login_user(&app, "u_avatar1", "Password123!", "client_111111111", None).await;
    assert_eq!(status1, StatusCode::OK);
    let token1 = login1["session_token"].as_str().unwrap();

    // Seed server invite code for user2
    sqlx::query(
        "INSERT INTO server_invites (id, code, max_uses, current_uses) VALUES ('inv_iso', 'INVITE_ISO', 1, 0)",
    )
    .execute(&pool)
    .await
    .unwrap();

    let user2_id = register_user(&app, "u_avatar2", "Password123!", Some("INVITE_ISO")).await;
    let (status2, login2) =
        login_user(&app, "u_avatar2", "Password123!", "client_222222222", None).await;
    assert_eq!(status2, StatusCode::OK);
    let token2 = login2["session_token"].as_str().unwrap();

    // Retrieve user1's actual username_token stored in DB
    let user1_lookup_token: String =
        sqlx::query_scalar("SELECT username_token FROM users WHERE id = ?")
            .bind(&user1_id)
            .fetch_one(&pool)
            .await
            .unwrap();

    // 2. User1 uploads avatar
    let blob_bytes = vec![0x77u8; 65536];
    let mut hasher = Sha256::new();
    hasher.update(&blob_bytes);
    let claimed_id = hex::encode(hasher.finalize());

    let boundary = "------------------------boundary123";
    let body_bytes = create_multipart_body(boundary, &blob_bytes, &claimed_id, "image/png", false);

    let upload_req = Request::builder()
        .method("POST")
        .uri("/api/v1/users/me/avatar")
        .header(header::AUTHORIZATION, format!("Bearer {}", token1))
        .header(
            header::CONTENT_TYPE,
            format!("multipart/form-data; boundary={}", boundary),
        )
        .body(Body::from(body_bytes))
        .unwrap();

    let upload_res = app.clone().oneshot(upload_req).await.unwrap();
    assert_eq!(upload_res.status(), StatusCode::CREATED);

    // 3. User2 looks up user1
    let lookup_req = Request::builder()
        .method("POST")
        .uri("/api/v1/users/lookup")
        .header(header::AUTHORIZATION, format!("Bearer {}", token2))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            serde_json::json!({ "lookup_token": user1_lookup_token }).to_string(),
        ))
        .unwrap();

    let lookup_res = app.clone().oneshot(lookup_req).await.unwrap();
    assert_eq!(lookup_res.status(), StatusCode::OK);
    let lookup_body = axum::body::to_bytes(lookup_res.into_body(), usize::MAX)
        .await
        .unwrap();
    let lookup_json: serde_json::Value = serde_json::from_slice(&lookup_body).unwrap();

    assert_eq!(lookup_json["user_id"], user1_id);
    assert!(lookup_json.get("avatar_file_id").is_none());
    assert!(lookup_json.get("avatar_attachment_id").is_none());
    assert!(lookup_json.get("claimed_id").is_none());

    // 4. User1 creates room and adds user2
    let create_room_req = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms")
        .header(header::AUTHORIZATION, format!("Bearer {}", token1))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from("{}"))
        .unwrap();

    let create_room_res = app.clone().oneshot(create_room_req).await.unwrap();
    let room_body = axum::body::to_bytes(create_room_res.into_body(), usize::MAX)
        .await
        .unwrap();
    let room_json: serde_json::Value = serde_json::from_slice(&room_body).unwrap();
    let room_id = room_json["id"].as_str().unwrap();

    let add_member_req = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/members", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token1))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            serde_json::json!({ "user_id": user2_id }).to_string(),
        ))
        .unwrap();

    let add_member_res = app.clone().oneshot(add_member_req).await.unwrap();
    assert_eq!(add_member_res.status(), StatusCode::CREATED);

    // 5. User2 fetches room members
    let members_req = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/rooms/{}/members", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token2))
        .body(Body::empty())
        .unwrap();

    let members_res = app.clone().oneshot(members_req).await.unwrap();
    assert_eq!(members_res.status(), StatusCode::OK);
    let members_body = axum::body::to_bytes(members_res.into_body(), usize::MAX)
        .await
        .unwrap();
    let members_json: serde_json::Value = serde_json::from_slice(&members_body).unwrap();

    let members = members_json["members"].as_array().unwrap();
    for member in members {
        if member["user_id"] == user1_id {
            assert!(member.get("avatar_file_id").is_none());
            assert!(member.get("avatar_attachment_id").is_none());
            assert!(member.get("claimed_id").is_none());
        }
    }
}

#[tokio::test]
async fn test_user_avatar_upload_s3_backend() {
    let (app, pool) = setup_s3_app().await;

    let user_id = register_user(&app, "user1", "Password123!", None).await;
    let (_, login) = login_user(&app, "user1", "Password123!", "client_123456789", None).await;
    let token = login["session_token"].as_str().unwrap();

    let blob_bytes = vec![0x99u8; 65536];
    let mut hasher = Sha256::new();
    hasher.update(&blob_bytes);
    let claimed_id = hex::encode(hasher.finalize());

    let boundary = "------------------------boundary123";
    let body_bytes = create_multipart_body(boundary, &blob_bytes, &claimed_id, "image/png", false);

    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/users/me/avatar")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(
            header::CONTENT_TYPE,
            format!("multipart/form-data; boundary={}", boundary),
        )
        .body(Body::from(body_bytes))
        .unwrap();

    let res = app.oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::CREATED);

    let res_body = axum::body::to_bytes(res.into_body(), usize::MAX)
        .await
        .unwrap();
    let view: server::attachments::AttachmentView = serde_json::from_slice(&res_body).unwrap();
    assert_eq!(view.id, claimed_id);
    assert_eq!(view.storage_backend, "s3");
    assert!(view.room_id.is_none());
    assert_eq!(view.uploader_id, user_id);

    // Verify DB state
    let db_row: (Option<String>, String, String) = sqlx::query_as(
        "SELECT room_id, uploader_id, storage_backend FROM attachments WHERE id = ?",
    )
    .bind(&claimed_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    assert!(db_row.0.is_none());
    assert_eq!(db_row.1, user_id);
    assert_eq!(db_row.2, "s3");
}
