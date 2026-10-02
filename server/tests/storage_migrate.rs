use async_trait::async_trait;
use sha2::{Digest, Sha256};
use sqlx::sqlite::SqlitePoolOptions;
use sqlx::SqlitePool;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use tempfile::tempdir;

use server::config::Config;
use server::storage::{
    migrate_storage, migrate_storage_with_backends, FsStorage, MigrationOptions, Storage,
    StorageError,
};

async fn setup_test_db() -> SqlitePool {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .unwrap();
    sqlx::migrate!("./migrations").run(&pool).await.unwrap();
    pool
}

async fn insert_test_attachment(
    pool: &SqlitePool,
    storage: &dyn Storage,
    backend_name: &str,
    data: &[u8],
) -> String {
    let hash = hex::encode(Sha256::digest(data));
    let key = format!("attachments/{}/{}/{}", &hash[0..2], &hash[2..4], &hash);

    sqlx::query(
        "INSERT OR IGNORE INTO users (id, username_token, opaque_registration, identity_pubkey) VALUES ('user_1', 'token_1', 'reg_1', 'pubkey_1')"
    )
    .execute(pool)
    .await
    .unwrap();

    sqlx::query("INSERT OR IGNORE INTO rooms (id, owner_id) VALUES ('room_1', 'user_1')")
        .execute(pool)
        .await
        .unwrap();

    storage.write(&key, data).await.unwrap();

    sqlx::query(
        r#"
        INSERT INTO attachments (
            id, room_id, uploader_id, storage_backend, storage_key,
            padded_size, plaintext_size, encrypted_size,
            chunk_size, chunk_count, nonce_prefix, base_counter, content_type
        ) VALUES (?, 'room_1', 'user_1', ?, ?, ?, ?, ?, 16384, 1, 'nonce12', 0, 'application/octet-stream')
        "#,
    )
    .bind(&hash)
    .bind(backend_name)
    .bind(&key)
    .bind(data.len() as i64)
    .bind(data.len() as i64)
    .bind(data.len() as i64)
    .execute(pool)
    .await
    .unwrap();

    hash
}

struct FailingWriteStorage {
    inner: FsStorage,
}

#[async_trait]
impl Storage for FailingWriteStorage {
    async fn write(&self, _key: &str, _data: &[u8]) -> Result<(), StorageError> {
        Err(StorageError::S3("Simulated write error".to_string()))
    }
    async fn read(&self, key: &str) -> Result<Vec<u8>, StorageError> {
        self.inner.read(key).await
    }
    async fn read_range(&self, key: &str, s: u64, e: u64) -> Result<Vec<u8>, StorageError> {
        self.inner.read_range(key, s, e).await
    }
    async fn delete(&self, key: &str) -> Result<(), StorageError> {
        self.inner.delete(key).await
    }
    async fn exists(&self, key: &str) -> Result<bool, StorageError> {
        self.inner.exists(key).await
    }
    fn backend_name(&self) -> &'static str {
        "failing_write"
    }
}

struct BadReadStorage {
    inner: FsStorage,
}

#[async_trait]
impl Storage for BadReadStorage {
    async fn write(&self, key: &str, data: &[u8]) -> Result<(), StorageError> {
        self.inner.write(key, data).await
    }
    async fn read(&self, _key: &str) -> Result<Vec<u8>, StorageError> {
        Ok(b"corrupted data".to_vec())
    }
    async fn read_range(&self, key: &str, s: u64, e: u64) -> Result<Vec<u8>, StorageError> {
        self.inner.read_range(key, s, e).await
    }
    async fn delete(&self, key: &str) -> Result<(), StorageError> {
        self.inner.delete(key).await
    }
    async fn exists(&self, key: &str) -> Result<bool, StorageError> {
        self.inner.exists(key).await
    }
    fn backend_name(&self) -> &'static str {
        "bad_read"
    }
}

struct PartialFailStorage {
    inner: FsStorage,
    fail_after: usize,
    call_count: AtomicUsize,
    should_fail: AtomicBool,
}

#[async_trait]
impl Storage for PartialFailStorage {
    async fn write(&self, key: &str, data: &[u8]) -> Result<(), StorageError> {
        if self.should_fail.load(Ordering::SeqCst) {
            let count = self.call_count.fetch_add(1, Ordering::SeqCst);
            if count >= self.fail_after {
                return Err(StorageError::S3("Simulated network drop".to_string()));
            }
        }
        self.inner.write(key, data).await
    }
    async fn read(&self, key: &str) -> Result<Vec<u8>, StorageError> {
        self.inner.read(key).await
    }
    async fn read_range(&self, key: &str, s: u64, e: u64) -> Result<Vec<u8>, StorageError> {
        self.inner.read_range(key, s, e).await
    }
    async fn delete(&self, key: &str) -> Result<(), StorageError> {
        self.inner.delete(key).await
    }
    async fn exists(&self, key: &str) -> Result<bool, StorageError> {
        self.inner.exists(key).await
    }
    fn backend_name(&self) -> &'static str {
        "partial_fail"
    }
}

#[tokio::test]
async fn test_migrate_single_blob_fs_to_s3() {
    let pool = setup_test_db().await;
    let dir_a = tempdir().unwrap();
    let dir_b = tempdir().unwrap();

    let storage_a = Arc::new(FsStorage::new(dir_a.path().to_path_buf()).unwrap());
    let storage_b = Arc::new(FsStorage::new(dir_b.path().to_path_buf()).unwrap());

    let data = b"sample attachment payload data";
    let id = insert_test_attachment(&pool, storage_a.as_ref(), "fs", data).await;

    let options = MigrationOptions {
        from: "fs".to_string(),
        to: "s3".to_string(),
        batch_size: 100,
        concurrency: 4,
        delete_source: false,
        dry_run: false,
    };

    let report =
        migrate_storage_with_backends(&pool, storage_a.clone(), storage_b.clone(), options)
            .await
            .unwrap();

    assert_eq!(report.progress.total, 1);
    assert_eq!(report.progress.migrated, 1);
    assert_eq!(report.progress.failed, 0);

    let key = format!("attachments/{}/{}/{}", &id[0..2], &id[2..4], &id);

    // Verify row points to destination
    let row_backend: String =
        sqlx::query_scalar("SELECT storage_backend FROM attachments WHERE id = ?")
            .bind(&id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(row_backend, "s3");

    // Blob exists on destination
    assert!(storage_b.exists(&key).await.unwrap());
    let read_data = storage_b.read(&key).await.unwrap();
    assert_eq!(read_data, data);

    // Source blob preserved by default
    assert!(storage_a.exists(&key).await.unwrap());
}

#[tokio::test]
async fn test_migrate_delete_source() {
    let pool = setup_test_db().await;
    let dir_a = tempdir().unwrap();
    let dir_b = tempdir().unwrap();

    let storage_a = Arc::new(FsStorage::new(dir_a.path().to_path_buf()).unwrap());
    let storage_b = Arc::new(FsStorage::new(dir_b.path().to_path_buf()).unwrap());

    let data = b"payload to migrate and delete from source";
    let id = insert_test_attachment(&pool, storage_a.as_ref(), "fs", data).await;

    let options = MigrationOptions {
        from: "fs".to_string(),
        to: "s3".to_string(),
        batch_size: 100,
        concurrency: 4,
        delete_source: true,
        dry_run: false,
    };

    let report =
        migrate_storage_with_backends(&pool, storage_a.clone(), storage_b.clone(), options)
            .await
            .unwrap();

    assert_eq!(report.progress.migrated, 1);

    let key = format!("attachments/{}/{}/{}", &id[0..2], &id[2..4], &id);

    // Source blob removed
    assert!(!storage_a.exists(&key).await.unwrap());
    // Destination blob exists
    assert!(storage_b.exists(&key).await.unwrap());
}

#[tokio::test]
async fn test_migrate_multiple_blobs() {
    let pool = setup_test_db().await;
    let dir_a = tempdir().unwrap();
    let dir_b = tempdir().unwrap();

    let storage_a = Arc::new(FsStorage::new(dir_a.path().to_path_buf()).unwrap());
    let storage_b = Arc::new(FsStorage::new(dir_b.path().to_path_buf()).unwrap());

    let mut ids = Vec::new();
    for i in 0..10 {
        let payload = format!("blob payload number {}", i);
        let id = insert_test_attachment(&pool, storage_a.as_ref(), "fs", payload.as_bytes()).await;
        ids.push(id);
    }

    let options = MigrationOptions {
        from: "fs".to_string(),
        to: "s3".to_string(),
        batch_size: 100,
        concurrency: 4,
        delete_source: false,
        dry_run: false,
    };

    let report = migrate_storage_with_backends(&pool, storage_a, storage_b, options)
        .await
        .unwrap();

    assert_eq!(report.progress.total, 10);
    assert_eq!(report.progress.migrated, 10);
    assert_eq!(report.progress.failed, 0);

    let count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM attachments WHERE storage_backend = 's3'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(count, 10);
}

#[tokio::test]
async fn test_migrate_skip_already_migrated() {
    let pool = setup_test_db().await;
    let dir_a = tempdir().unwrap();
    let dir_b = tempdir().unwrap();

    let storage_a = Arc::new(FsStorage::new(dir_a.path().to_path_buf()).unwrap());
    let storage_b = Arc::new(FsStorage::new(dir_b.path().to_path_buf()).unwrap());

    let data = b"idempotency test payload";
    let _id = insert_test_attachment(&pool, storage_a.as_ref(), "fs", data).await;

    let options1 = MigrationOptions {
        from: "fs".to_string(),
        to: "s3".to_string(),
        batch_size: 100,
        concurrency: 4,
        delete_source: false,
        dry_run: false,
    };

    let report1 =
        migrate_storage_with_backends(&pool, storage_a.clone(), storage_b.clone(), options1)
            .await
            .unwrap();
    assert_eq!(report1.progress.migrated, 1);

    // Second migration from 'fs' to 's3' sees 0 pending rows
    let options2 = MigrationOptions {
        from: "fs".to_string(),
        to: "s3".to_string(),
        batch_size: 100,
        concurrency: 4,
        delete_source: false,
        dry_run: false,
    };

    let report2 = migrate_storage_with_backends(&pool, storage_a, storage_b, options2)
        .await
        .unwrap();
    assert_eq!(report2.progress.total, 0);
    assert_eq!(report2.progress.migrated, 0);
}

#[tokio::test]
async fn test_source_read_failure_aborts_row() {
    let pool = setup_test_db().await;
    let dir_a = tempdir().unwrap();
    let dir_b = tempdir().unwrap();

    let storage_a = Arc::new(FsStorage::new(dir_a.path().to_path_buf()).unwrap());
    let storage_b = Arc::new(FsStorage::new(dir_b.path().to_path_buf()).unwrap());

    let data = b"missing source file test";
    let id = insert_test_attachment(&pool, storage_a.as_ref(), "fs", data).await;

    // Delete source blob file manually
    let key = format!("attachments/{}/{}/{}", &id[0..2], &id[2..4], &id);
    storage_a.delete(&key).await.unwrap();

    let options = MigrationOptions {
        from: "fs".to_string(),
        to: "s3".to_string(),
        batch_size: 100,
        concurrency: 4,
        delete_source: false,
        dry_run: false,
    };

    let report = migrate_storage_with_backends(&pool, storage_a, storage_b, options)
        .await
        .unwrap();

    assert_eq!(report.progress.total, 1);
    assert_eq!(report.progress.migrated, 0);
    assert_eq!(report.progress.failed, 1);
    assert_eq!(report.failures.len(), 1);
    assert!(report.failures[0].reason.contains("source read failed"));

    // DB row remains pointing at 'fs'
    let row_backend: String =
        sqlx::query_scalar("SELECT storage_backend FROM attachments WHERE id = ?")
            .bind(&id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(row_backend, "fs");
}

#[tokio::test]
async fn test_source_hash_mismatch_aborts_row() {
    let pool = setup_test_db().await;
    let dir_a = tempdir().unwrap();
    let dir_b = tempdir().unwrap();

    let storage_a = Arc::new(FsStorage::new(dir_a.path().to_path_buf()).unwrap());
    let storage_b = Arc::new(FsStorage::new(dir_b.path().to_path_buf()).unwrap());

    let data = b"uncorrupted source data";
    let id = insert_test_attachment(&pool, storage_a.as_ref(), "fs", data).await;

    // Corrupt file on source
    let key = format!("attachments/{}/{}/{}", &id[0..2], &id[2..4], &id);
    storage_a
        .write(&key, b"corrupted byte content")
        .await
        .unwrap();

    let options = MigrationOptions {
        from: "fs".to_string(),
        to: "s3".to_string(),
        batch_size: 100,
        concurrency: 4,
        delete_source: false,
        dry_run: false,
    };

    let report = migrate_storage_with_backends(&pool, storage_a, storage_b, options)
        .await
        .unwrap();

    assert_eq!(report.progress.failed, 1);
    assert_eq!(report.failures[0].reason, "source hash mismatch");

    // DB row remains pointing at 'fs'
    let row_backend: String =
        sqlx::query_scalar("SELECT storage_backend FROM attachments WHERE id = ?")
            .bind(&id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(row_backend, "fs");
}

#[tokio::test]
async fn test_destination_write_failure_aborts_row() {
    let pool = setup_test_db().await;
    let dir_a = tempdir().unwrap();
    let dir_b = tempdir().unwrap();

    let storage_a = Arc::new(FsStorage::new(dir_a.path().to_path_buf()).unwrap());
    let storage_b_failing = Arc::new(FailingWriteStorage {
        inner: FsStorage::new(dir_b.path().to_path_buf()).unwrap(),
    });

    let data = b"destination write error test";
    let id = insert_test_attachment(&pool, storage_a.as_ref(), "fs", data).await;

    let options = MigrationOptions {
        from: "fs".to_string(),
        to: "s3".to_string(),
        batch_size: 100,
        concurrency: 4,
        delete_source: false,
        dry_run: false,
    };

    let report = migrate_storage_with_backends(&pool, storage_a, storage_b_failing, options)
        .await
        .unwrap();

    assert_eq!(report.progress.failed, 1);
    assert!(report.failures[0]
        .reason
        .contains("destination write failed"));

    let row_backend: String =
        sqlx::query_scalar("SELECT storage_backend FROM attachments WHERE id = ?")
            .bind(&id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(row_backend, "fs");
}

#[tokio::test]
async fn test_destination_hash_mismatch_aborts_row() {
    let pool = setup_test_db().await;
    let dir_a = tempdir().unwrap();
    let dir_b = tempdir().unwrap();

    let storage_a = Arc::new(FsStorage::new(dir_a.path().to_path_buf()).unwrap());
    let storage_b_bad = Arc::new(BadReadStorage {
        inner: FsStorage::new(dir_b.path().to_path_buf()).unwrap(),
    });

    let data = b"dest verification mismatch test";
    let id = insert_test_attachment(&pool, storage_a.as_ref(), "fs", data).await;

    let options = MigrationOptions {
        from: "fs".to_string(),
        to: "s3".to_string(),
        batch_size: 100,
        concurrency: 4,
        delete_source: false,
        dry_run: false,
    };

    let report = migrate_storage_with_backends(&pool, storage_a, storage_b_bad, options)
        .await
        .unwrap();

    assert_eq!(report.progress.failed, 1);
    assert_eq!(report.failures[0].reason, "destination hash mismatch");

    let row_backend: String =
        sqlx::query_scalar("SELECT storage_backend FROM attachments WHERE id = ?")
            .bind(&id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(row_backend, "fs");
}

#[tokio::test]
async fn test_interrupt_and_resume() {
    let pool = setup_test_db().await;
    let dir_a = tempdir().unwrap();
    let dir_b = tempdir().unwrap();

    let storage_a = Arc::new(FsStorage::new(dir_a.path().to_path_buf()).unwrap());

    let inner_b = FsStorage::new(dir_b.path().to_path_buf()).unwrap();
    let partial_b = Arc::new(PartialFailStorage {
        inner: inner_b,
        fail_after: 5,
        call_count: AtomicUsize::new(0),
        should_fail: AtomicBool::new(true),
    });

    for i in 0..10 {
        let payload = format!("resume test payload {}", i);
        insert_test_attachment(&pool, storage_a.as_ref(), "fs", payload.as_bytes()).await;
    }

    let options1 = MigrationOptions {
        from: "fs".to_string(),
        to: "s3".to_string(),
        batch_size: 100,
        concurrency: 1, // serial processing so first 5 succeed and next 5 fail
        delete_source: false,
        dry_run: false,
    };

    let report1 =
        migrate_storage_with_backends(&pool, storage_a.clone(), partial_b.clone(), options1)
            .await
            .unwrap();

    assert_eq!(report1.progress.migrated, 5);
    assert_eq!(report1.progress.failed, 5);

    // Turn off failure injection
    partial_b.should_fail.store(false, Ordering::SeqCst);

    let options2 = MigrationOptions {
        from: "fs".to_string(),
        to: "s3".to_string(),
        batch_size: 100,
        concurrency: 4,
        delete_source: false,
        dry_run: false,
    };

    let report2 = migrate_storage_with_backends(&pool, storage_a, partial_b, options2)
        .await
        .unwrap();

    assert_eq!(report2.progress.total, 5); // 5 remaining rows
    assert_eq!(report2.progress.migrated, 5);
    assert_eq!(report2.progress.failed, 0);

    let total_migrated: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM attachments WHERE storage_backend = 's3'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(total_migrated, 10);
}

#[tokio::test]
async fn test_dry_run_makes_no_changes() {
    let pool = setup_test_db().await;
    let dir_a = tempdir().unwrap();
    let dir_b = tempdir().unwrap();

    let storage_a = Arc::new(FsStorage::new(dir_a.path().to_path_buf()).unwrap());
    let storage_b = Arc::new(FsStorage::new(dir_b.path().to_path_buf()).unwrap());

    for i in 0..5 {
        let payload = format!("dry run payload {}", i);
        insert_test_attachment(&pool, storage_a.as_ref(), "fs", payload.as_bytes()).await;
    }

    let options = MigrationOptions {
        from: "fs".to_string(),
        to: "s3".to_string(),
        batch_size: 100,
        concurrency: 4,
        delete_source: false,
        dry_run: true,
    };

    let report = migrate_storage_with_backends(&pool, storage_a, storage_b.clone(), options)
        .await
        .unwrap();

    assert_eq!(report.progress.total, 5);
    assert_eq!(report.progress.migrated, 5);

    // No rows updated in DB
    let fs_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM attachments WHERE storage_backend = 'fs'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(fs_count, 5);
}

#[tokio::test]
async fn test_dry_run_multi_batch_terminates() {
    let pool = setup_test_db().await;
    let dir_a = tempdir().unwrap();
    let dir_b = tempdir().unwrap();

    let storage_a = Arc::new(FsStorage::new(dir_a.path().to_path_buf()).unwrap());
    let storage_b = Arc::new(FsStorage::new(dir_b.path().to_path_buf()).unwrap());

    for i in 0..12 {
        let payload = format!("multi batch dry run payload {}", i);
        insert_test_attachment(&pool, storage_a.as_ref(), "fs", payload.as_bytes()).await;
    }

    let options = MigrationOptions {
        from: "fs".to_string(),
        to: "s3".to_string(),
        batch_size: 5, // smaller than 12 total items to test multiple batches
        concurrency: 2,
        delete_source: false,
        dry_run: true,
    };

    let report = migrate_storage_with_backends(&pool, storage_a, storage_b, options)
        .await
        .unwrap();

    assert_eq!(report.progress.total, 12);
    assert_eq!(report.progress.processed, 12);
    assert_eq!(report.progress.migrated, 12);
}

#[tokio::test]
async fn test_failure_multi_batch_terminates() {
    let pool = setup_test_db().await;
    let dir_a = tempdir().unwrap();
    let dir_b = tempdir().unwrap();

    let storage_a = Arc::new(FsStorage::new(dir_a.path().to_path_buf()).unwrap());
    let storage_b_failing = Arc::new(FailingWriteStorage {
        inner: FsStorage::new(dir_b.path().to_path_buf()).unwrap(),
    });

    for i in 0..12 {
        let payload = format!("multi batch failing payload {}", i);
        insert_test_attachment(&pool, storage_a.as_ref(), "fs", payload.as_bytes()).await;
    }

    let options = MigrationOptions {
        from: "fs".to_string(),
        to: "s3".to_string(),
        batch_size: 5,
        concurrency: 2,
        delete_source: false,
        dry_run: false,
    };

    let report = migrate_storage_with_backends(&pool, storage_a, storage_b_failing, options)
        .await
        .unwrap();

    assert_eq!(report.progress.total, 12);
    assert_eq!(report.progress.processed, 12);
    assert_eq!(report.progress.failed, 12);
}

#[tokio::test]
async fn test_same_source_and_destination_no_op() {
    let pool = setup_test_db().await;
    let dir_a = tempdir().unwrap();
    let storage_a = Arc::new(FsStorage::new(dir_a.path().to_path_buf()).unwrap());

    insert_test_attachment(&pool, storage_a.as_ref(), "fs", b"data1").await;
    insert_test_attachment(&pool, storage_a.as_ref(), "fs", b"data2").await;

    let options = MigrationOptions {
        from: "fs".to_string(),
        to: "fs".to_string(),
        batch_size: 100,
        concurrency: 4,
        delete_source: false,
        dry_run: false,
    };

    let report = migrate_storage_with_backends(&pool, storage_a.clone(), storage_a, options)
        .await
        .unwrap();

    assert_eq!(report.progress.total, 2);
    assert_eq!(report.progress.skipped, 2);
    assert_eq!(report.progress.migrated, 0);
    assert_eq!(report.progress.failed, 0);
}

#[tokio::test]
async fn test_migrate_storage_unsupported_backend() {
    let pool = setup_test_db().await;
    let mut config = Config::test_default();
    config.storage_backend = "fs".to_string();

    let options = MigrationOptions {
        from: "invalid_backend".to_string(),
        to: "s3".to_string(),
        batch_size: 100,
        concurrency: 4,
        delete_source: false,
        dry_run: false,
    };

    let res = migrate_storage(&pool, &config, options).await;
    assert!(matches!(res.unwrap_err(), StorageError::Config(_)));
}
