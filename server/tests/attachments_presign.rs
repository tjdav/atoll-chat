mod common;

use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use axum::Router;
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use chrono::Utc;
use common::{login_user, register_user, setup_test_app, setup_test_db};
use serde_json::{json, Value};
use server::altcha::AltchaConfig;
use server::config::{Config, RateLimitConfig};
use server::login::LoginStore;
use server::opaque::OpaqueServer;
use server::registration::RegistrationStore;
use server::storage::{Storage, StorageError};
use server::AppState;
use sha2::{Digest, Sha256};
use sqlx::SqlitePool;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tower::ServiceExt;

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
            "https://s3.example.com/test-bucket/{}?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Expires={}&X-Amz-Signature=fake_sig_1234567890",
            key, ttl_seconds
        )))
    }
}

async fn setup_test_s3_app(presign_limit: u32, presign_ttl: u64) -> (Router, SqlitePool) {
    let pool = setup_test_db().await;

    let temp_dir = tempfile::tempdir().expect("Failed to create tempdir");
    let key_path = temp_dir.path().join("oprf.key");
    let opaque_server =
        Arc::new(OpaqueServer::load_or_generate(&key_path).expect("Failed to create OpaqueServer"));
    let registration_store = Arc::new(RegistrationStore::new());
    let login_store = Arc::new(LoginStore::new());

    let rate_limits = RateLimitConfig {
        invite_create_hourly: 50,
        invite_create_daily: 200,
        invite_redeem_per_min: 10,
        kp_claim_per_min: 30,
        kp_claim_hourly: 200,
        login_per_min: 10,
        login_lockout_min: 15,
        export_rate_limit_hours: 24,
        presign_per_min: presign_limit,
    };

    let config = Config {
        app_env: "development".to_string(),
        app_url: None,
        app_name: "Test".to_string(),
        log_level: "info".to_string(),
        server_bind: "127.0.0.1:0".to_string(),
        db_path: ":memory:".to_string(),
        db_busy_timeout_ms: 5000,
        opaque_oprf_key_path: key_path.to_str().unwrap().to_string(),
        altcha_enabled: true,
        altcha_hmac_secret: "auto".to_string(),
        altcha_algorithm: "PBKDF2/SHA-256".to_string(),
        altcha_cost: 100,
        session_expiry_days: 30,
        session_sliding: true,
        max_file_size_bytes: 104_857_600,
        server_max_devices_per_user: 20,
        invite_default_uses: 1,
        invite_expiry_days: 0,
        invite_code_length: 8,
        invite_limited_max_uses: 10,
        invite_limited_max_open: 50,
        room_invite_default_uses: 1,
        room_invite_code_length: 8,
        rate_limits,
        cleanup_enabled: true,
        cleanup_interval_minutes: 60,
        cleanup_startup_delay_secs: 30,
        audit_retention_days: 90,
        data_retention_days: 0,
        export_rate_limit_hours: 24,
        trust_proxy: false,
        hsts_max_age: 31536000,
        hsts_include_subdomains: true,
        client_static_dir: None,
        sockudo_url: "http://localhost:6001".to_string(),
        sockudo_app_id: "chat".to_string(),
        sockudo_app_key: "auto".to_string(),
        sockudo_app_secret: "auto".to_string(),
        sockudo_public_url: None,
        storage_backend: "s3".to_string(),
        storage_fs_path: temp_dir.path().join("attachments"),
        s3_endpoint: Some("http://localhost:9000".to_string()),
        s3_region: "us-east-1".to_string(),
        s3_bucket: Some("test-bucket".to_string()),
        s3_access_key_id: Some("minioadmin".to_string()),
        s3_secret_access_key: Some("minioadmin".to_string()),
        s3_path_style: true,
        s3_presign_ttl_seconds: presign_ttl,
        attachment_chunk_size: 65536,
        attachment_bucket_sizes: vec![65536, 524288, 4194304, 33554432],
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
    });

    let sockudo_config = Arc::new(server::SockudoConfig {
        http_base: "http://localhost:6001".to_string(),
        app_id: "chat".to_string(),
        app_key: "test-app-key".to_string(),
        app_secret: "test-app-secret".to_string(),
    });
    let sockudo_publisher = Arc::new(server::Publisher::new((*sockudo_config).clone()));

    let state = AppState {
        pool: pool.clone(),
        opaque_server,
        registration_store,
        login_store,
        altcha_config,
        config: config_arc,
        server_hard_max,
        sockudo_config,
        sockudo_publisher,
        storage,
    };

    let app = server::build_app(state);
    (app, pool)
}

async fn create_room_and_upload(app: &Router, token: &str) -> (String, String) {
    let req_create = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from("{}"))
        .unwrap();

    let resp_create = app.clone().oneshot(req_create).await.unwrap();
    let body_bytes = axum::body::to_bytes(resp_create.into_body(), usize::MAX)
        .await
        .unwrap();
    let room_json: Value = serde_json::from_slice(&body_bytes).unwrap();
    let room_id = room_json["id"].as_str().unwrap().to_string();

    let blob = vec![0x42u8; 65536];
    let mut hasher = Sha256::new();
    hasher.update(&blob);
    let blob_id = hex::encode(hasher.finalize());

    let nonce_prefix = BASE64.encode([1, 2, 3, 4, 5, 6, 7]);

    let req_upload = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/attachments", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header("X-Claimed-Id", &blob_id)
        .header("X-Plaintext-Size", "60000")
        .header("X-Encrypted-Size", "60016")
        .header("X-Chunk-Size", "65536")
        .header("X-Chunk-Count", "1")
        .header("X-Nonce-Prefix", &nonce_prefix)
        .header("X-Base-Counter", "0")
        .header(header::CONTENT_TYPE, "application/octet-stream")
        .body(Body::from(blob))
        .unwrap();

    let resp_upload = app.clone().oneshot(req_upload).await.unwrap();
    assert_eq!(resp_upload.status(), StatusCode::CREATED);
    let body_bytes = axum::body::to_bytes(resp_upload.into_body(), usize::MAX)
        .await
        .unwrap();
    let up_json: Value = serde_json::from_slice(&body_bytes).unwrap();
    let uploaded_id = up_json["id"].as_str().unwrap().to_string();

    (room_id, uploaded_id)
}

#[tokio::test]
async fn test_01_presign_returns_501_on_filesystem_backend() {
    let (app, _pool) = setup_test_app().await;

    let _user_a = register_user(&app, "alice", "password123", None).await;
    let (_, login_a) = login_user(&app, "alice", "password123", "client_a_123456789", None).await;
    let token_a = login_a["session_token"].as_str().unwrap();

    let (_room_id, blob_id) = create_room_and_upload(&app, token_a).await;

    let req_presign = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/attachments/{}/presign", blob_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from("{}"))
        .unwrap();

    let resp = app.clone().oneshot(req_presign).await.unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_IMPLEMENTED); // 501

    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(json["error"], "presign_not_supported");
}

#[tokio::test]
async fn test_02_presign_returns_url_on_s3_backend() {
    let (app, _pool) = setup_test_s3_app(60, 600).await;

    let _user_a = register_user(&app, "alice", "password123", None).await;
    let (_, login_a) = login_user(&app, "alice", "password123", "client_a_123456789", None).await;
    let token_a = login_a["session_token"].as_str().unwrap();

    let (_room_id, blob_id) = create_room_and_upload(&app, token_a).await;

    let req_presign = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/attachments/{}/presign", blob_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from("{}"))
        .unwrap();

    let resp = app.clone().oneshot(req_presign).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert!(json["url"].is_string());
    assert!(json["expires_at"].is_string());
}

#[tokio::test]
async fn test_03_presign_url_contains_signature() {
    let (app, _pool) = setup_test_s3_app(60, 600).await;

    let _user_a = register_user(&app, "alice", "password123", None).await;
    let (_, login_a) = login_user(&app, "alice", "password123", "client_a_123456789", None).await;
    let token_a = login_a["session_token"].as_str().unwrap();

    let (_room_id, blob_id) = create_room_and_upload(&app, token_a).await;

    let req_presign = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/attachments/{}/presign", blob_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from("{}"))
        .unwrap();

    let resp = app.clone().oneshot(req_presign).await.unwrap();
    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body_bytes).unwrap();
    let url = json["url"].as_str().unwrap();

    assert!(
        url.contains("X-Amz-Signature") || url.contains("Signature="),
        "Presigned URL should contain AWS signature query param: {}",
        url
    );
}

#[tokio::test]
async fn test_04_presign_respects_ttl() {
    let (app, _pool) = setup_test_s3_app(60, 600).await;

    let _user_a = register_user(&app, "alice", "password123", None).await;
    let (_, login_a) = login_user(&app, "alice", "password123", "client_a_123456789", None).await;
    let token_a = login_a["session_token"].as_str().unwrap();

    let (_room_id, blob_id) = create_room_and_upload(&app, token_a).await;

    let now = Utc::now();
    let req_presign = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/attachments/{}/presign", blob_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({"expires_in_seconds": 300}).to_string()))
        .unwrap();

    let resp = app.clone().oneshot(req_presign).await.unwrap();
    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body_bytes).unwrap();

    let expires_at_str = json["expires_at"].as_str().unwrap();
    let expires_at: chrono::DateTime<Utc> = expires_at_str.parse().unwrap();

    let diff = (expires_at - now).num_seconds();
    assert!(
        (290..=310).contains(&diff),
        "Expected TTL around 300s, got {}",
        diff
    );
}

#[tokio::test]
async fn test_05_presign_ttl_clamped_to_max() {
    let (app, _pool) = setup_test_s3_app(60, 600).await;

    let _user_a = register_user(&app, "alice", "password123", None).await;
    let (_, login_a) = login_user(&app, "alice", "password123", "client_a_123456789", None).await;
    let token_a = login_a["session_token"].as_str().unwrap();

    let (_room_id, blob_id) = create_room_and_upload(&app, token_a).await;

    let now = Utc::now();
    let req_presign = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/attachments/{}/presign", blob_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({"expires_in_seconds": 999999}).to_string(),
        ))
        .unwrap();

    let resp = app.clone().oneshot(req_presign).await.unwrap();
    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body_bytes).unwrap();

    let expires_at_str = json["expires_at"].as_str().unwrap();
    let expires_at: chrono::DateTime<Utc> = expires_at_str.parse().unwrap();

    let diff = (expires_at - now).num_seconds();
    // Max TTL is 2 * 600 = 1200 seconds
    assert!(
        (1190..=1210).contains(&diff),
        "Expected max clamped TTL around 1200s, got {}",
        diff
    );
}

#[tokio::test]
async fn test_06_presign_ttl_minimum_enforced() {
    let (app, _pool) = setup_test_s3_app(60, 600).await;

    let _user_a = register_user(&app, "alice", "password123", None).await;
    let (_, login_a) = login_user(&app, "alice", "password123", "client_a_123456789", None).await;
    let token_a = login_a["session_token"].as_str().unwrap();

    let (_room_id, blob_id) = create_room_and_upload(&app, token_a).await;

    let now = Utc::now();
    let req_presign = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/attachments/{}/presign", blob_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({"expires_in_seconds": 5}).to_string()))
        .unwrap();

    let resp = app.clone().oneshot(req_presign).await.unwrap();
    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body_bytes).unwrap();

    let expires_at_str = json["expires_at"].as_str().unwrap();
    let expires_at: chrono::DateTime<Utc> = expires_at_str.parse().unwrap();

    let diff = (expires_at - now).num_seconds();
    // Minimum TTL is 30 seconds
    assert!(
        (25..=35).contains(&diff),
        "Expected min clamped TTL around 30s, got {}",
        diff
    );
}

#[tokio::test]
async fn test_07_presign_rejects_invalid_ttl() {
    let (app, _pool) = setup_test_s3_app(60, 600).await;

    let _user_a = register_user(&app, "alice", "password123", None).await;
    let (_, login_a) = login_user(&app, "alice", "password123", "client_a_123456789", None).await;
    let token_a = login_a["session_token"].as_str().unwrap();

    let (_room_id, blob_id) = create_room_and_upload(&app, token_a).await;

    let req_presign = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/attachments/{}/presign", blob_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from("{\"expires_in_seconds\": -1}"))
        .unwrap();

    let resp = app.clone().oneshot(req_presign).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);

    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(json["error"], "invalid_expires_in");
}

#[tokio::test]
async fn test_08_presign_by_non_member_returns_404() {
    let (app, pool) = setup_test_s3_app(60, 600).await;

    let _user_a = register_user(&app, "alice", "password123", None).await;
    let (_, login_a) = login_user(&app, "alice", "password123", "client_a_123456789", None).await;
    let token_a = login_a["session_token"].as_str().unwrap();

    let (_room_id, blob_id) = create_room_and_upload(&app, token_a).await;

    // Register Bob (non-member)
    sqlx::query(
        "INSERT INTO server_invites (id, code, max_uses, current_uses) VALUES ('inv_1', 'INVITE123', 1, 0)",
    )
    .execute(&pool)
    .await
    .unwrap();

    let _user_b = register_user(&app, "bob", "password123", Some("INVITE123")).await;
    let (_, login_b) = login_user(&app, "bob", "password123", "client_b_123456789", None).await;
    let token_b = login_b["session_token"].as_str().unwrap();

    let req_presign = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/attachments/{}/presign", blob_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_b))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from("{}"))
        .unwrap();

    let resp = app.clone().oneshot(req_presign).await.unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn test_09_presign_rate_limit_is_enforced() {
    let (app, _pool) = setup_test_s3_app(2, 600).await; // Rate limit = 2 per min

    let _user_a = register_user(&app, "alice", "password123", None).await;
    let (_, login_a) = login_user(&app, "alice", "password123", "client_a_123456789", None).await;
    let token_a = login_a["session_token"].as_str().unwrap();

    let (_room_id, blob_id) = create_room_and_upload(&app, token_a).await;

    for _ in 0..2 {
        let req_presign = Request::builder()
            .method("POST")
            .uri(format!("/api/v1/attachments/{}/presign", blob_id))
            .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from("{}"))
            .unwrap();

        let resp = app.clone().oneshot(req_presign).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
    }

    // Third request exceeds limit
    let req_presign_3 = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/attachments/{}/presign", blob_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from("{}"))
        .unwrap();

    let resp_3 = app.clone().oneshot(req_presign_3).await.unwrap();
    assert_eq!(resp_3.status(), StatusCode::TOO_MANY_REQUESTS);

    let body_bytes = axum::body::to_bytes(resp_3.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(json["error"], "rate_limited");
    assert!(json["details"]["reset_at"].is_string());
}

#[tokio::test]
async fn test_10_presign_rate_limit_is_per_user() {
    let (app, pool) = setup_test_s3_app(1, 600).await; // Rate limit = 1 per min per user

    let _user_a = register_user(&app, "alice", "password123", None).await;
    let (_, login_a) = login_user(&app, "alice", "password123", "client_a_123456789", None).await;
    let token_a = login_a["session_token"].as_str().unwrap();

    // Register Bob and add to room
    sqlx::query(
        "INSERT INTO server_invites (id, code, max_uses, current_uses) VALUES ('inv_1', 'INVITE123', 1, 0)",
    )
    .execute(&pool)
    .await
    .unwrap();

    let user_b = register_user(&app, "bob", "password123", Some("INVITE123")).await;
    let (_, login_b) = login_user(&app, "bob", "password123", "client_b_123456789", None).await;
    let token_b = login_b["session_token"].as_str().unwrap();

    let (room_id, blob_id) = create_room_and_upload(&app, token_a).await;

    let req_add = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/members", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(format!("{{\"user_id\":\"{}\"}}", user_b)))
        .unwrap();

    let resp_add = app.clone().oneshot(req_add).await.unwrap();
    assert_eq!(resp_add.status(), StatusCode::CREATED);

    // User A presigns once (reaches limit of 1)
    let req_presign_a = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/attachments/{}/presign", blob_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from("{}"))
        .unwrap();

    let resp_a = app.clone().oneshot(req_presign_a).await.unwrap();
    assert_eq!(resp_a.status(), StatusCode::OK);

    // User A second request -> 429
    let req_presign_a2 = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/attachments/{}/presign", blob_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from("{}"))
        .unwrap();

    let resp_a2 = app.clone().oneshot(req_presign_a2).await.unwrap();
    assert_eq!(resp_a2.status(), StatusCode::TOO_MANY_REQUESTS);

    // User B presigns -> succeeds (200 OK)
    let req_presign_b = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/attachments/{}/presign", blob_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_b))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from("{}"))
        .unwrap();

    let resp_b = app.clone().oneshot(req_presign_b).await.unwrap();
    assert_eq!(resp_b.status(), StatusCode::OK);
}
