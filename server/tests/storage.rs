use server::config::Config;
use server::storage::{build_storage, FsStorage, Storage, StorageError};
use tempfile::tempdir;

fn test_config_fs(root: std::path::PathBuf) -> Config {
    let mut cfg = Config::from_env().unwrap_or_else(|_| Config {
        app_env: "development".to_string(),
        app_url: None,
        app_name: "Test".to_string(),
        log_level: "info".to_string(),
        server_bind: "127.0.0.1:0".to_string(),
        db_path: ":memory:".to_string(),
        db_busy_timeout_ms: 5000,
        opaque_oprf_key_path: "./data/oprf.key".to_string(),
        altcha_enabled: false,
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
        rate_limits: server::config::RateLimitConfig {
            invite_create_hourly: 50,
            invite_create_daily: 200,
            invite_redeem_per_min: 10,
            kp_claim_per_min: 30,
            kp_claim_hourly: 200,
            login_per_min: 10,
            login_lockout_min: 15,
            export_rate_limit_hours: 24,
        },
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
        storage_backend: "fs".to_string(),
        storage_fs_path: root.clone(),
        s3_endpoint: None,
        s3_region: "us-east-1".to_string(),
        s3_bucket: None,
        s3_access_key_id: None,
        s3_secret_access_key: None,
        s3_path_style: false,
        s3_presign_ttl_seconds: 600,
        attachment_chunk_size: 65536,
        attachment_bucket_sizes: vec![65536, 524288, 4194304, 33554432],
    });

    cfg.storage_backend = "fs".to_string();
    cfg.storage_fs_path = root;
    cfg
}

#[tokio::test]
async fn test_fs_storage_basic_ops() {
    let dir = tempdir().unwrap();
    let storage = FsStorage::new(dir.path().to_path_buf()).unwrap();

    let id = "a1b2c3d4e5f60718293a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e";
    let key = format!("attachments/{}/{}/{}", &id[0..2], &id[2..4], id);

    assert_eq!(storage.backend_name(), "fs");

    // Initially does not exist
    assert!(!storage.exists(&key).await.unwrap());

    // Write data
    let data = b"hello worldattachment content";
    storage.write(&key, data).await.unwrap();

    // Now exists
    assert!(storage.exists(&key).await.unwrap());

    // Read full file
    let read_back = storage.read(&key).await.unwrap();
    assert_eq!(read_back, data);

    // Read range
    let range = storage.read_range(&key, 0, 4).await.unwrap();
    assert_eq!(range, b"hello");

    // Delete
    storage.delete(&key).await.unwrap();
    assert!(!storage.exists(&key).await.unwrap());

    // Idempotent delete
    storage.delete(&key).await.unwrap();
}

#[tokio::test]
async fn test_fs_storage_not_found() {
    let dir = tempdir().unwrap();
    let storage = FsStorage::new(dir.path().to_path_buf()).unwrap();

    let id = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";
    let key = format!("attachments/{}/{}/{}", &id[0..2], &id[2..4], id);

    let err = storage.read(&key).await.unwrap_err();
    assert!(matches!(err, StorageError::NotFound(_)));
}

#[tokio::test]
async fn test_fs_storage_read_range_bounds() {
    let dir = tempdir().unwrap();
    let storage = FsStorage::new(dir.path().to_path_buf()).unwrap();

    let id = "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
    let key = format!("attachments/{}/{}/{}", &id[0..2], &id[2..4], id);

    storage.write(&key, b"12345").await.unwrap();

    // Out of bounds end >= size (size is 5)
    let err = storage.read_range(&key, 0, 5).await.unwrap_err();
    assert!(matches!(err, StorageError::Io(_)));

    // start > end
    let err2 = storage.read_range(&key, 3, 2).await.unwrap_err();
    assert!(matches!(err2, StorageError::Io(_)));
}

#[tokio::test]
async fn test_key_validation() {
    let dir = tempdir().unwrap();
    let storage = FsStorage::new(dir.path().to_path_buf()).unwrap();

    let invalid_key1 = "attachments/a1/b2/c3";
    let invalid_key2 =
        "other/a1/b2/a1b2c3d4e5f60718293a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e";
    let invalid_key3 =
        "attachments/A1/b2/a1b2c3d4e5f60718293a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e";

    assert!(matches!(
        storage.read(invalid_key1).await.unwrap_err(),
        StorageError::InvalidKey(_)
    ));
    assert!(matches!(
        storage.read(invalid_key2).await.unwrap_err(),
        StorageError::InvalidKey(_)
    ));
    assert!(matches!(
        storage.read(invalid_key3).await.unwrap_err(),
        StorageError::InvalidKey(_)
    ));
}

#[tokio::test]
async fn test_build_storage_factory() {
    let dir = tempdir().unwrap();
    let cfg = test_config_fs(dir.path().to_path_buf());

    let storage = build_storage(&cfg).unwrap();
    assert_eq!(storage.backend_name(), "fs");

    let mut s3_cfg = cfg.clone();
    s3_cfg.storage_backend = "s3".to_string();
    s3_cfg.s3_endpoint = Some("http://localhost:9000".to_string());
    s3_cfg.s3_bucket = Some("test-bucket".to_string());
    s3_cfg.s3_access_key_id = Some("minio".to_string());
    s3_cfg.s3_secret_access_key = Some("minio123".to_string());

    let s3_storage = build_storage(&s3_cfg).unwrap();
    assert_eq!(s3_storage.backend_name(), "s3");
}
