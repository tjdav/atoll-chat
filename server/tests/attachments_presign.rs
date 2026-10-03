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
        presign_per_min: presign_limit,
        ..Config::test_default().rate_limits
    };

    let config = Config {
        opaque_oprf_key_path: key_path.to_str().unwrap().to_string(),
        altcha_enabled: true,
        altcha_cost: 100,
        rate_limits,
        storage_backend: "s3".to_string(),
        storage_fs_path: temp_dir.path().join("attachments"),
        s3_endpoint: Some("http://localhost:9000".to_string()),
        s3_region: "us-east-1".to_string(),
        s3_bucket: Some("test-bucket".to_string()),
        s3_access_key_id: Some("minioadmin".to_string()),
        s3_secret_access_key: Some("minioadmin".to_string()),
        s3_path_style: true,
        s3_presign_ttl_seconds: presign_ttl,
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
        .header(header::CONTENT_TYPE, "application/octet-stream")
        .header("X-Claimed-Id", &blob_id)
        .header("X-Plaintext-Size", "60000")
        .header("X-Encrypted-Size", "65536")
        .header("X-Chunk-Size", "16384")
        .header("X-Chunk-Count", "4")
        .header("X-Nonce-Prefix", &nonce_prefix)
        .header("X-Base-Counter", "0")
        .header("X-Content-Type", "image/jpeg")
        .body(Body::from(blob))
        .unwrap();

    let resp_upload = app.clone().oneshot(req_upload).await.unwrap();
    assert_eq!(resp_upload.status(), StatusCode::CREATED);

    (room_id, blob_id)
}

#[tokio::test]
async fn test_01_presign_returns_501_on_fs_backend() {
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
    assert_eq!(resp.status(), StatusCode::NOT_IMPLEMENTED);

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

    let now_before = Utc::now();

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

    let url = json["url"].as_str().unwrap();
    assert!(url.contains("test-bucket"));
    assert!(url.contains(&blob_id));
    assert!(url.contains("X-Amz-Signature") || url.contains("X-Amz-Algorithm"));

    let expires_at_str = json["expires_at"].as_str().unwrap();
    let expires_at = chrono::DateTime::parse_from_rfc3339(expires_at_str)
        .unwrap()
        .with_timezone(&Utc);

    // Default TTL is 600s
    let diff = (expires_at - now_before).num_seconds();
    assert!((590..=610).contains(&diff));
}

#[tokio::test]
async fn test_03_presign_ttl_clamped_to_max() {
    let (app, _pool) = setup_test_s3_app(60, 600).await;

    let _user_a = register_user(&app, "alice", "password123", None).await;
    let (_, login_a) = login_user(&app, "alice", "password123", "client_a_123456789", None).await;
    let token_a = login_a["session_token"].as_str().unwrap();

    let (_room_id, blob_id) = create_room_and_upload(&app, token_a).await;

    let now_before = Utc::now();

    // Request 999,999 seconds; max allowed is 2 * 600 = 1200
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
    assert_eq!(resp.status(), StatusCode::OK);

    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body_bytes).unwrap();

    let expires_at_str = json["expires_at"].as_str().unwrap();
    let expires_at = chrono::DateTime::parse_from_rfc3339(expires_at_str)
        .unwrap()
        .with_timezone(&Utc);

    let diff = (expires_at - now_before).num_seconds();
    assert!((1190..=1210).contains(&diff));
}

#[tokio::test]
async fn test_04_presign_ttl_clamped_to_min() {
    let (app, _pool) = setup_test_s3_app(60, 600).await;

    let _user_a = register_user(&app, "alice", "password123", None).await;
    let (_, login_a) = login_user(&app, "alice", "password123", "client_a_123456789", None).await;
    let token_a = login_a["session_token"].as_str().unwrap();

    let (_room_id, blob_id) = create_room_and_upload(&app, token_a).await;

    let now_before = Utc::now();

    // Request 5 seconds; min allowed is 30
    let req_presign = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/attachments/{}/presign", blob_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({"expires_in_seconds": 5}).to_string()))
        .unwrap();

    let resp = app.clone().oneshot(req_presign).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body_bytes).unwrap();

    let expires_at_str = json["expires_at"].as_str().unwrap();
    let expires_at = chrono::DateTime::parse_from_rfc3339(expires_at_str)
        .unwrap()
        .with_timezone(&Utc);

    let diff = (expires_at - now_before).num_seconds();
    assert!((25..=35).contains(&diff));
}

#[tokio::test]
async fn test_07_presign_by_non_member_returns_404() {
    let (app, _pool) = setup_test_s3_app(60, 600).await;

    let _user_a = register_user(&app, "alice", "password123", None).await;
    let (_, login_a) = login_user(&app, "alice", "password123", "client_a_123456789", None).await;
    let token_a = login_a["session_token"].as_str().unwrap();

    sqlx::query(
        "INSERT INTO server_invites (id, code, max_uses, current_uses) VALUES ('inv_1', 'INVITE123', 1, 0)",
    )
    .execute(&_pool)
    .await
    .unwrap();

    let _user_b = register_user(&app, "bob", "password123", Some("INVITE123")).await;
    let (_, login_b) = login_user(&app, "bob", "password123", "client_b_123456789", None).await;
    let token_b = login_b["session_token"].as_str().unwrap();

    let (_room_id, blob_id) = create_room_and_upload(&app, token_a).await;

    // Bob is not a member of Alice's room
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
async fn test_08_presign_rate_limit_enforced() {
    let (app, _pool) = setup_test_s3_app(2, 600).await;

    let _user_a = register_user(&app, "alice", "password123", None).await;
    let (_, login_a) = login_user(&app, "alice", "password123", "client_a_123456789", None).await;
    let token_a = login_a["session_token"].as_str().unwrap();

    let (_room_id, blob_id) = create_room_and_upload(&app, token_a).await;

    // First request - ok
    let req1 = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/attachments/{}/presign", blob_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from("{}"))
        .unwrap();
    let resp1 = app.clone().oneshot(req1).await.unwrap();
    assert_eq!(resp1.status(), StatusCode::OK);

    // Second request - ok
    let req2 = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/attachments/{}/presign", blob_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from("{}"))
        .unwrap();
    let resp2 = app.clone().oneshot(req2).await.unwrap();
    assert_eq!(resp2.status(), StatusCode::OK);

    // Third request - rate limited (429)
    let req3 = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/attachments/{}/presign", blob_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from("{}"))
        .unwrap();
    let resp3 = app.clone().oneshot(req3).await.unwrap();
    assert_eq!(resp3.status(), StatusCode::TOO_MANY_REQUESTS);

    let body_bytes3 = axum::body::to_bytes(resp3.into_body(), usize::MAX)
        .await
        .unwrap();
    let json3: Value = serde_json::from_slice(&body_bytes3).unwrap();
    assert_eq!(json3["error"], "rate_limited");
    assert!(json3["details"]["reset_at"].is_string());
}

#[tokio::test]
async fn test_11_presign_unknown_id_returns_404() {
    let (app, _pool) = setup_test_s3_app(60, 600).await;

    let _user_a = register_user(&app, "alice", "password123", None).await;
    let (_, login_a) = login_user(&app, "alice", "password123", "client_a_123456789", None).await;
    let token_a = login_a["session_token"].as_str().unwrap();

    let unknown_id = "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";

    let req_presign = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/attachments/{}/presign", unknown_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from("{}"))
        .unwrap();

    let resp = app.clone().oneshot(req_presign).await.unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);
}
