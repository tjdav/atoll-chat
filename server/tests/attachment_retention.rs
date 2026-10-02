mod common;

use common::setup_test_db;
use server::attachments;
use server::cleanup::attachments::AttachmentsJob;
use server::cleanup::{CleanupContextOwned, CleanupJob, Scheduler};
use server::config::Config;
use server::limits::{InstanceLimits, ServerHardMax};
use server::login::LoginStore;
use server::registration::RegistrationStore;
use server::storage::{Storage, StorageError};
use sha2::{Digest, Sha256};
use sqlx::SqlitePool;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

fn test_server_max() -> ServerHardMax {
    ServerHardMax {
        file_size_bytes: 104_857_600,
        room_size: 1000,
        rooms_per_user: 500,
        devices_per_user: 20,
        keypackages_per_device: 50,
        message_size_bytes: 65536,
        attachment_retention_days: 365,
        call_max_participants: 50,
        reactions_per_message: 50,
    }
}

fn test_instance_limits() -> InstanceLimits {
    InstanceLimits {
        file_size_bytes: 52_428_800,
        room_size: 100,
        rooms_per_user: 50,
        devices_per_user: 10,
        keypackages_per_device: 20,
        message_size_bytes: 16384,
        attachment_retention_days: 30,
        call_max_participants: 8,
        reactions_per_message: 50,
    }
}

fn create_test_blob_with_seed(size: usize, seed: u8) -> (Vec<u8>, String) {
    let blob = vec![seed; size];
    let mut hasher = Sha256::new();
    hasher.update(&blob);
    let id = hex::encode(hasher.finalize());
    (blob, id)
}

#[allow(dead_code)]
fn create_test_blob(size: usize) -> (Vec<u8>, String) {
    create_test_blob_with_seed(size, 0x42)
}

async fn insert_attachment_with_seed(
    pool: &SqlitePool,
    storage: &dyn Storage,
    room_id: &str,
    uploader_id: &str,
    created_offset: &str,
    seed: u8,
) -> (String, String) {
    let (blob, id) = create_test_blob_with_seed(65536, seed);
    let key = format!("attachments/{}/{}/{}", &id[0..2], &id[2..4], &id);
    storage.write(&key, &blob).await.unwrap();

    sqlx::query(
        r#"
        INSERT INTO attachments (
            id, room_id, uploader_id, uploader_client_id,
            storage_backend, storage_key,
            padded_size, plaintext_size, encrypted_size,
            chunk_size, chunk_count, nonce_prefix, base_counter,
            content_type, created_at
        ) VALUES (?, ?, ?, 'c1', 'fs', ?, 65536, 60000, 60016, 16384, 1, 'AQIDBAUGBwg=', 0, 'image/jpeg', datetime('now', ?))
        "#,
    )
    .bind(&id)
    .bind(room_id)
    .bind(uploader_id)
    .bind(&key)
    .bind(created_offset)
    .execute(pool)
    .await
    .unwrap();

    (id, key)
}

async fn insert_attachment(
    pool: &SqlitePool,
    storage: &dyn Storage,
    room_id: &str,
    uploader_id: &str,
    created_offset: &str,
) -> (String, String) {
    insert_attachment_with_seed(pool, storage, room_id, uploader_id, created_offset, 0x42).await
}

async fn setup_user_and_room(
    pool: &SqlitePool,
    user_id: &str,
    room_id: &str,
    retention_days: Option<i64>,
) {
    let dummy_token = format!("token_{}_1234567890123456789012345678901234567890123456789012345678901234567890123456789012", user_id);
    sqlx::query(
        "INSERT INTO users (id, username_token, opaque_registration, identity_pubkey) VALUES (?, ?, 'reg', 'pub') ON CONFLICT DO NOTHING",
    )
    .bind(user_id)
    .bind(&dummy_token)
    .execute(pool)
    .await
    .unwrap();

    sqlx::query("INSERT INTO rooms (id, owner_id, retention_days) VALUES (?, ?, ?)")
        .bind(room_id)
        .bind(user_id)
        .bind(retention_days)
        .execute(pool)
        .await
        .unwrap();
}

#[tokio::test]
async fn test_01_basic_pruning_expired_deleted_fresh_preserved() {
    let pool = setup_test_db().await;
    let temp_dir = tempfile::tempdir().unwrap();
    let config = Arc::new(Config {
        storage_fs_path: temp_dir.path().to_path_buf(),
        ..Config::test_default()
    });
    let storage = server::build_storage(&config).unwrap();
    let limits = test_instance_limits();
    let server_max = test_server_max();

    setup_user_and_room(&pool, "u1", "r1", Some(1)).await;

    let (exp_id, exp_key) =
        insert_attachment_with_seed(&pool, storage.as_ref(), "r1", "u1", "-2 days", 0x01).await;
    let (fresh_id, fresh_key) =
        insert_attachment_with_seed(&pool, storage.as_ref(), "r1", "u1", "+1 day", 0x02).await;

    let report = attachments::prune_expired(&pool, storage.as_ref(), &limits, &server_max)
        .await
        .unwrap();

    assert_eq!(report.rooms_scanned, 1);
    assert_eq!(report.attachments_deleted, 1);
    assert_eq!(report.blobs_deleted, 1);
    assert_eq!(report.blob_errors, 0);

    let exp_exists: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM attachments WHERE id = ?)")
            .bind(&exp_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(!exp_exists);
    assert!(!storage.exists(&exp_key).await.unwrap());

    let fresh_exists: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM attachments WHERE id = ?)")
            .bind(&fresh_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(fresh_exists);
    assert!(storage.exists(&fresh_key).await.unwrap());
}

#[tokio::test]
async fn test_02_boundary_cutoff_comparison() {
    let pool = setup_test_db().await;
    let temp_dir = tempfile::tempdir().unwrap();
    let config = Arc::new(Config {
        storage_fs_path: temp_dir.path().to_path_buf(),
        ..Config::test_default()
    });
    let storage = server::build_storage(&config).unwrap();
    let limits = test_instance_limits();
    let server_max = test_server_max();

    setup_user_and_room(&pool, "u1", "r1", Some(7)).await;

    // Exactly 7 days ago (should be preserved due to strict '<')
    let (exact_id, exact_key) =
        insert_attachment_with_seed(&pool, storage.as_ref(), "r1", "u1", "-7 days", 0x01).await;

    let report1 = attachments::prune_expired(&pool, storage.as_ref(), &limits, &server_max)
        .await
        .unwrap();
    assert_eq!(report1.attachments_deleted, 0);

    let exact_exists: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM attachments WHERE id = ?)")
            .bind(&exact_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(exact_exists);
    assert!(storage.exists(&exact_key).await.unwrap());

    // 7 days and 1 second ago
    let (past_id, past_key) =
        insert_attachment_with_seed(&pool, storage.as_ref(), "r1", "u1", "-604801 seconds", 0x02)
            .await;

    let report2 = attachments::prune_expired(&pool, storage.as_ref(), &limits, &server_max)
        .await
        .unwrap();
    assert_eq!(report2.attachments_deleted, 1);

    let past_exists: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM attachments WHERE id = ?)")
            .bind(&past_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(!past_exists);
    assert!(!storage.exists(&past_key).await.unwrap());
}

#[tokio::test]
async fn test_03_three_tier_room_tighter_than_instance() {
    let pool = setup_test_db().await;
    let temp_dir = tempfile::tempdir().unwrap();
    let config = Arc::new(Config {
        storage_fs_path: temp_dir.path().to_path_buf(),
        ..Config::test_default()
    });
    let storage = server::build_storage(&config).unwrap();
    let limits = InstanceLimits {
        attachment_retention_days: 30,
        ..test_instance_limits()
    };
    let server_max = ServerHardMax {
        attachment_retention_days: 365,
        ..test_server_max()
    };

    setup_user_and_room(&pool, "u1", "r1", Some(10)).await;

    let (id, _key) = insert_attachment(&pool, storage.as_ref(), "r1", "u1", "-15 days").await;

    let report = attachments::prune_expired(&pool, storage.as_ref(), &limits, &server_max)
        .await
        .unwrap();
    assert_eq!(report.attachments_deleted, 1);

    let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM attachments WHERE id = ?)")
        .bind(&id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert!(!exists);
}

#[tokio::test]
async fn test_04_three_tier_instance_tighter_than_room() {
    let pool = setup_test_db().await;
    let temp_dir = tempfile::tempdir().unwrap();
    let config = Arc::new(Config {
        storage_fs_path: temp_dir.path().to_path_buf(),
        ..Config::test_default()
    });
    let storage = server::build_storage(&config).unwrap();
    let limits = InstanceLimits {
        attachment_retention_days: 30,
        ..test_instance_limits()
    };
    let server_max = ServerHardMax {
        attachment_retention_days: 365,
        ..test_server_max()
    };

    setup_user_and_room(&pool, "u1", "r1", Some(90)).await;

    let (id, _key) = insert_attachment(&pool, storage.as_ref(), "r1", "u1", "-45 days").await;

    let report = attachments::prune_expired(&pool, storage.as_ref(), &limits, &server_max)
        .await
        .unwrap();
    assert_eq!(report.attachments_deleted, 1);

    let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM attachments WHERE id = ?)")
        .bind(&id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert!(!exists);
}

#[tokio::test]
async fn test_05_three_tier_server_max_ceiling_on_instance() {
    let pool = setup_test_db().await;
    let temp_dir = tempfile::tempdir().unwrap();
    let config = Arc::new(Config {
        storage_fs_path: temp_dir.path().to_path_buf(),
        ..Config::test_default()
    });
    let storage = server::build_storage(&config).unwrap();
    let limits = InstanceLimits {
        attachment_retention_days: 90,
        ..test_instance_limits()
    };
    let server_max = ServerHardMax {
        attachment_retention_days: 30,
        ..test_server_max()
    };

    setup_user_and_room(&pool, "u1", "r1", None).await;

    let (id, _key) = insert_attachment(&pool, storage.as_ref(), "r1", "u1", "-45 days").await;

    let report = attachments::prune_expired(&pool, storage.as_ref(), &limits, &server_max)
        .await
        .unwrap();
    assert_eq!(report.attachments_deleted, 1);

    let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM attachments WHERE id = ?)")
        .bind(&id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert!(!exists);
}

#[tokio::test]
async fn test_06_zero_retention_means_forever_across_tiers() {
    let pool = setup_test_db().await;
    let temp_dir = tempfile::tempdir().unwrap();
    let config = Arc::new(Config {
        storage_fs_path: temp_dir.path().to_path_buf(),
        ..Config::test_default()
    });
    let storage = server::build_storage(&config).unwrap();

    // 1. Zero instance limit
    let limits_zero = InstanceLimits {
        attachment_retention_days: 0,
        ..test_instance_limits()
    };
    let server_max = test_server_max();

    setup_user_and_room(&pool, "u1", "r1", Some(30)).await;
    let (id1, _key1) =
        insert_attachment_with_seed(&pool, storage.as_ref(), "r1", "u1", "-365 days", 0x11).await;

    let report1 = attachments::prune_expired(&pool, storage.as_ref(), &limits_zero, &server_max)
        .await
        .unwrap();
    assert_eq!(report1.attachments_deleted, 0);

    let exists1: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM attachments WHERE id = ?)")
        .bind(&id1)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert!(exists1);

    // Delete room r1 attachments to clean up before testing case 2
    sqlx::query("DELETE FROM attachments WHERE room_id = 'r1'")
        .execute(&pool)
        .await
        .unwrap();

    // 2. Zero room retention
    let limits_normal = test_instance_limits();
    setup_user_and_room(&pool, "u2", "r2", Some(0)).await;
    let (id2, _key2) =
        insert_attachment_with_seed(&pool, storage.as_ref(), "r2", "u2", "-365 days", 0x12).await;

    let report2 = attachments::prune_expired(&pool, storage.as_ref(), &limits_normal, &server_max)
        .await
        .unwrap();
    assert_eq!(report2.attachments_deleted, 0);

    let exists2: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM attachments WHERE id = ?)")
        .bind(&id2)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert!(exists2);

    // 3. Zero server max
    let server_max_zero = ServerHardMax {
        attachment_retention_days: 0,
        ..test_server_max()
    };
    setup_user_and_room(&pool, "u3", "r3", Some(30)).await;
    let (id3, _key3) =
        insert_attachment_with_seed(&pool, storage.as_ref(), "r3", "u3", "-365 days", 0x13).await;

    let report3 =
        attachments::prune_expired(&pool, storage.as_ref(), &limits_normal, &server_max_zero)
            .await
            .unwrap();
    assert_eq!(report3.attachments_deleted, 0);

    let exists3: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM attachments WHERE id = ?)")
        .bind(&id3)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert!(exists3);
}

#[tokio::test]
async fn test_07_null_room_retention_uses_instance() {
    let pool = setup_test_db().await;
    let temp_dir = tempfile::tempdir().unwrap();
    let config = Arc::new(Config {
        storage_fs_path: temp_dir.path().to_path_buf(),
        ..Config::test_default()
    });
    let storage = server::build_storage(&config).unwrap();
    let limits = InstanceLimits {
        attachment_retention_days: 30,
        ..test_instance_limits()
    };
    let server_max = test_server_max();

    setup_user_and_room(&pool, "u1", "r1", None).await;

    let (id, _key) = insert_attachment(&pool, storage.as_ref(), "r1", "u1", "-45 days").await;

    let report = attachments::prune_expired(&pool, storage.as_ref(), &limits, &server_max)
        .await
        .unwrap();
    assert_eq!(report.attachments_deleted, 1);

    let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM attachments WHERE id = ?)")
        .bind(&id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert!(!exists);
}

#[tokio::test]
async fn test_08_multiple_rooms_processed_independently() {
    let pool = setup_test_db().await;
    let temp_dir = tempfile::tempdir().unwrap();
    let config = Arc::new(Config {
        storage_fs_path: temp_dir.path().to_path_buf(),
        ..Config::test_default()
    });
    let storage = server::build_storage(&config).unwrap();
    let limits = test_instance_limits();
    let server_max = test_server_max();

    setup_user_and_room(&pool, "u1", "r_short", Some(1)).await;
    setup_user_and_room(&pool, "u2", "r_long", Some(365)).await;

    let (id1, _key1) =
        insert_attachment_with_seed(&pool, storage.as_ref(), "r_short", "u1", "-10 days", 0x21)
            .await;
    let (id2, _key2) =
        insert_attachment_with_seed(&pool, storage.as_ref(), "r_long", "u2", "-10 days", 0x22)
            .await;

    let report = attachments::prune_expired(&pool, storage.as_ref(), &limits, &server_max)
        .await
        .unwrap();
    assert_eq!(report.rooms_scanned, 2);
    assert_eq!(report.attachments_deleted, 1);

    let exists1: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM attachments WHERE id = ?)")
        .bind(&id1)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert!(!exists1);

    let exists2: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM attachments WHERE id = ?)")
        .bind(&id2)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert!(exists2);
}

struct FailingStorage {
    inner: Arc<dyn Storage>,
    fail: AtomicBool,
}

#[async_trait::async_trait]
impl Storage for FailingStorage {
    fn backend_name(&self) -> &'static str {
        "failing"
    }
    async fn write(&self, key: &str, data: &[u8]) -> Result<(), StorageError> {
        self.inner.write(key, data).await
    }
    async fn read(&self, key: &str) -> Result<Vec<u8>, StorageError> {
        self.inner.read(key).await
    }
    async fn read_range(&self, key: &str, start: u64, end: u64) -> Result<Vec<u8>, StorageError> {
        self.inner.read_range(key, start, end).await
    }
    async fn delete(&self, key: &str) -> Result<(), StorageError> {
        if self.fail.load(Ordering::SeqCst) {
            Err(StorageError::Io(std::io::Error::other(
                "simulated storage delete failure",
            )))
        } else {
            self.inner.delete(key).await
        }
    }
    async fn exists(&self, key: &str) -> Result<bool, StorageError> {
        self.inner.exists(key).await
    }
}

#[tokio::test]
async fn test_09_blob_deletion_is_best_effort() {
    let pool = setup_test_db().await;
    let temp_dir = tempfile::tempdir().unwrap();
    let config = Arc::new(Config {
        storage_fs_path: temp_dir.path().to_path_buf(),
        ..Config::test_default()
    });
    let base_storage = server::build_storage(&config).unwrap();
    let failing_storage = Arc::new(FailingStorage {
        inner: base_storage,
        fail: AtomicBool::new(false),
    });

    let limits = test_instance_limits();
    let server_max = test_server_max();

    setup_user_and_room(&pool, "u1", "r1", Some(1)).await;

    let (id, _key) =
        insert_attachment(&pool, failing_storage.as_ref(), "r1", "u1", "-2 days").await;

    // Enable storage delete failures
    failing_storage.fail.store(true, Ordering::SeqCst);

    let report = attachments::prune_expired(&pool, failing_storage.as_ref(), &limits, &server_max)
        .await
        .unwrap();

    assert_eq!(report.attachments_deleted, 1);
    assert_eq!(report.blobs_deleted, 0);
    assert_eq!(report.blob_errors, 1);

    let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM attachments WHERE id = ?)")
        .bind(&id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert!(
        !exists,
        "DB row should be deleted despite blob delete failure"
    );
}

#[tokio::test]
async fn test_10_batch_deletion_exceeds_500_items() {
    let pool = setup_test_db().await;
    let temp_dir = tempfile::tempdir().unwrap();
    let config = Arc::new(Config {
        storage_fs_path: temp_dir.path().to_path_buf(),
        ..Config::test_default()
    });
    let storage = server::build_storage(&config).unwrap();
    let limits = test_instance_limits();
    let server_max = test_server_max();

    setup_user_and_room(&pool, "u1", "r1", Some(1)).await;

    let total = 510;
    for i in 0..total {
        let seed = (i % 250) as u8;
        let (blob, _id) = create_test_blob_with_seed(65536, seed);
        // Ensure id is 64 hex chars
        let full_id = format!("{:0>64x}", i);
        let key = format!(
            "attachments/{}/{}/{}",
            &full_id[0..2],
            &full_id[2..4],
            &full_id
        );
        storage.write(&key, &blob).await.unwrap();

        sqlx::query(
            r#"
            INSERT INTO attachments (
                id, room_id, uploader_id, uploader_client_id,
                storage_backend, storage_key,
                padded_size, plaintext_size, encrypted_size,
                chunk_size, chunk_count, nonce_prefix, base_counter,
                content_type, created_at
            ) VALUES (?, 'r1', 'u1', 'c1', 'fs', ?, 65536, 60000, 60016, 16384, 1, 'AQIDBAUGBwg=', 0, 'image/jpeg', datetime('now', '-2 days'))
            "#,
        )
        .bind(&full_id)
        .bind(&key)
        .execute(&pool)
        .await
        .unwrap();
    }

    let report = attachments::prune_expired(&pool, storage.as_ref(), &limits, &server_max)
        .await
        .unwrap();

    assert_eq!(report.attachments_deleted, total as u64);
    assert_eq!(report.blobs_deleted, total as u64);

    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM attachments WHERE room_id = 'r1'")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 0);
}

#[tokio::test]
async fn test_11_attachments_job_runs_and_reports_notes_on_blob_error() {
    let pool = setup_test_db().await;

    sqlx::query("INSERT INTO instance_limits (key, value) VALUES ('attachment_retention_days', '30') ON CONFLICT(key) DO UPDATE SET value = '30'")
        .execute(&pool)
        .await
        .unwrap();

    let temp_dir = tempfile::tempdir().unwrap();
    let config = Arc::new(Config {
        storage_fs_path: temp_dir.path().to_path_buf(),
        ..Config::test_default()
    });
    let base_storage = server::build_storage(&config).unwrap();
    let failing_storage = Arc::new(FailingStorage {
        inner: base_storage,
        fail: AtomicBool::new(false),
    });

    let server_max = Arc::new(test_server_max());

    let ctx = CleanupContextOwned {
        pool: pool.clone(),
        config: config.clone(),
        registration_store: Arc::new(RegistrationStore::new()),
        login_store: Arc::new(LoginStore::new()),
        storage: failing_storage.clone(),
        server_max,
    };

    setup_user_and_room(&pool, "u1", "r1", Some(1)).await;
    insert_attachment(&pool, failing_storage.as_ref(), "r1", "u1", "-2 days").await;

    // Fail storage delete
    failing_storage.fail.store(true, Ordering::SeqCst);

    let job = AttachmentsJob;
    assert_eq!(job.name(), "attachments");

    let report = job.run(&ctx.as_ctx()).await.unwrap();
    assert_eq!(report.rows_deleted, 1);
    assert!(report
        .notes
        .iter()
        .any(|n| n.contains("blob deletion errors")));
}

#[tokio::test]
async fn test_12_scheduler_registers_attachments_job() {
    let pool = setup_test_db().await;
    let temp_dir = tempfile::tempdir().unwrap();
    let config = Arc::new(Config {
        storage_fs_path: temp_dir.path().to_path_buf(),
        ..Config::test_default()
    });
    let storage = server::build_storage(&config).unwrap();
    let server_max = Arc::new(test_server_max());

    let ctx = CleanupContextOwned {
        pool,
        config,
        registration_store: Arc::new(RegistrationStore::new()),
        login_store: Arc::new(LoginStore::new()),
        storage,
        server_max,
    };

    let mut scheduler = Scheduler::new(Duration::from_secs(60));
    scheduler.register(Box::new(AttachmentsJob));

    let (shutdown_tx, shutdown_rx) = tokio::sync::watch::channel(false);

    let handle = tokio::spawn(async move {
        scheduler.run(ctx, shutdown_rx).await;
    });

    tokio::time::sleep(Duration::from_millis(100)).await;
    shutdown_tx.send(true).unwrap();

    let res = tokio::time::timeout(Duration::from_secs(2), handle).await;
    assert!(res.is_ok());
}
