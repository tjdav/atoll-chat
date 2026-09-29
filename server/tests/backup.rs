use chrono::Utc;
use std::path::PathBuf;
use std::sync::Arc;
use tempfile::tempdir;

use server::backup::{
    build_backup_archive, decrypt_backup, encrypt_backup, extract_backup_archive, list_backups,
    restore_backup, BackupJob, BackupKey, BackupManifest, RestoreOptions,
};
use server::Config;

mod common;

#[tokio::test]
async fn test_encryption_roundtrip() {
    let oprf_bytes = b"sample-oprf-key-bytes-1234567890";
    let key = BackupKey::derive(oprf_bytes).unwrap();

    let plaintext = b"Hello, encrypted backup world!";
    let ciphertext = encrypt_backup(&key, plaintext).unwrap();

    assert_ne!(ciphertext, plaintext);
    let decrypted = decrypt_backup(&key, &ciphertext).unwrap();
    assert_eq!(decrypted, plaintext);
}

#[tokio::test]
async fn test_decryption_wrong_key_fails() {
    let key1 = BackupKey::derive(b"key-1").unwrap();
    let key2 = BackupKey::derive(b"key-2").unwrap();

    let plaintext = b"Secret data";
    let ciphertext = encrypt_backup(&key1, plaintext).unwrap();

    let res = decrypt_backup(&key2, &ciphertext);
    assert!(res.is_err());
}

#[tokio::test]
async fn test_tampered_ciphertext_fails() {
    let key = BackupKey::derive(b"key-1").unwrap();
    let plaintext = b"Important database bytes";
    let mut ciphertext = encrypt_backup(&key, plaintext).unwrap();

    // Tamper with a byte in ciphertext (after 12-byte nonce)
    let idx = ciphertext.len() - 1;
    ciphertext[idx] ^= 0xFF;

    let res = decrypt_backup(&key, &ciphertext);
    assert!(res.is_err());
}

#[tokio::test]
async fn test_archive_roundtrip() {
    let manifest = BackupManifest {
        created_at: Utc::now(),
        server_version: "0.1.0".to_string(),
        database_path: "/data/app.db".to_string(),
        oprf_key_path: "/data/oprf.key".to_string(),
        include_attachments: false,
        storage_backend: "fs".to_string(),
        attachment_count: 0,
    };

    let db_bytes = b"sqlite format 3\0 dummy db";
    let oprf_bytes = b"oprf secret key";

    let tar_bytes = build_backup_archive(&manifest, db_bytes, oprf_bytes, None).unwrap();
    let (m, extracted_db, extracted_oprf, attachments) =
        extract_backup_archive(&tar_bytes).unwrap();

    assert_eq!(m.server_version, manifest.server_version);
    assert_eq!(extracted_db, db_bytes);
    assert_eq!(extracted_oprf, oprf_bytes);
    assert!(attachments.is_none());
}

#[tokio::test]
async fn test_archive_with_attachments() {
    let manifest = BackupManifest {
        created_at: Utc::now(),
        server_version: "0.1.0".to_string(),
        database_path: "/data/app.db".to_string(),
        oprf_key_path: "/data/oprf.key".to_string(),
        include_attachments: true,
        storage_backend: "fs".to_string(),
        attachment_count: 2,
    };

    let db_bytes = b"dummy db";
    let oprf_bytes = b"oprf key";
    let attach_files = vec![
        ("file1.bin".to_string(), b"content 1".to_vec()),
        ("sub/file2.bin".to_string(), b"content 2".to_vec()),
    ];

    let tar_bytes =
        build_backup_archive(&manifest, db_bytes, oprf_bytes, Some(&attach_files)).unwrap();
    let (_, _, _, attachments) = extract_backup_archive(&tar_bytes).unwrap();

    let extracted = attachments.expect("attachments should be present");
    assert_eq!(extracted.len(), 2);
    assert!(extracted
        .iter()
        .any(|(p, c)| p == "file1.bin" && c == b"content 1"));
    assert!(extracted
        .iter()
        .any(|(p, c)| p == "sub/file2.bin" && c == b"content 2"));
}

#[tokio::test]
async fn test_manifest_is_first_entry() {
    let manifest = BackupManifest {
        created_at: Utc::now(),
        server_version: "0.1.0".to_string(),
        database_path: "/data/app.db".to_string(),
        oprf_key_path: "/data/oprf.key".to_string(),
        include_attachments: false,
        storage_backend: "fs".to_string(),
        attachment_count: 0,
    };

    let tar_bytes = build_backup_archive(&manifest, b"db", b"key", None).unwrap();
    let mut archive = tar::Archive::new(&tar_bytes[..]);
    let mut entries = archive.entries().unwrap();

    let first = entries.next().unwrap().unwrap();
    assert_eq!(first.path().unwrap().to_str().unwrap(), "manifest.json");
}

#[tokio::test]
async fn test_run_once_creates_encrypted_backup() {
    let tmp = tempdir().unwrap();
    let db_path = tmp.path().join("app.db");
    let oprf_path = tmp.path().join("oprf.key");
    let backups_dir = tmp.path().join("backups");

    tokio::fs::write(&oprf_path, b"test-oprf-key")
        .await
        .unwrap();

    let pool = sqlx::sqlite::SqlitePoolOptions::new()
        .connect(&format!("sqlite:{}?mode=rwc", db_path.display()))
        .await
        .unwrap();

    sqlx::query("CREATE TABLE test_tbl (id INT); INSERT INTO test_tbl VALUES (1);")
        .execute(&pool)
        .await
        .unwrap();

    let mut config = Config::test_default();
    config.db_path = db_path.to_string_lossy().to_string();
    config.opaque_oprf_key_path = oprf_path.to_string_lossy().to_string();
    config.backup_path = backups_dir.clone();

    let job = BackupJob::new(Arc::new(config));
    let res = job.run_once(&pool).await.unwrap();

    assert!(tokio::fs::try_exists(&res.path).await.unwrap());
    assert!(res.size_bytes > 0);

    let enc_bytes = tokio::fs::read(&res.path).await.unwrap();
    let key = BackupKey::derive(b"test-oprf-key").unwrap();
    let tar_bytes = decrypt_backup(&key, &enc_bytes).unwrap();
    let (manifest, extracted_db, _, _) = extract_backup_archive(&tar_bytes).unwrap();

    assert_eq!(
        manifest.database_path,
        db_path.to_string_lossy().to_string()
    );
    assert!(!extracted_db.is_empty());
}

#[tokio::test]
async fn test_backup_file_naming() {
    let tmp = tempdir().unwrap();
    let db_path = tmp.path().join("app.db");
    let oprf_path = tmp.path().join("oprf.key");
    let backups_dir = tmp.path().join("backups");

    tokio::fs::write(&oprf_path, b"test-oprf-key")
        .await
        .unwrap();

    let pool = sqlx::sqlite::SqlitePoolOptions::new()
        .connect(&format!("sqlite:{}?mode=rwc", db_path.display()))
        .await
        .unwrap();

    let mut config = Config::test_default();
    config.db_path = db_path.to_string_lossy().to_string();
    config.opaque_oprf_key_path = oprf_path.to_string_lossy().to_string();
    config.backup_path = backups_dir;

    let job = BackupJob::new(Arc::new(config));
    let res = job.run_once(&pool).await.unwrap();

    let filename = res.path.file_name().unwrap().to_str().unwrap();
    assert_eq!(filename.len(), 32);
    assert!(filename.starts_with("backup-"));
    assert!(filename.ends_with(".cbak"));
    assert_eq!(&filename[11..12], "-");
    assert_eq!(&filename[14..15], "-");
    assert_eq!(&filename[17..18], "T");
    assert_eq!(&filename[20..21], "-");
    assert_eq!(&filename[23..24], "-");
    assert_eq!(&filename[26..27], "Z");
}

#[tokio::test]
async fn test_multiple_backups_produce_distinct_files() {
    let tmp = tempdir().unwrap();
    let db_path = tmp.path().join("app.db");
    let oprf_path = tmp.path().join("oprf.key");
    let backups_dir = tmp.path().join("backups");

    tokio::fs::write(&oprf_path, b"test-oprf-key")
        .await
        .unwrap();

    let pool = sqlx::sqlite::SqlitePoolOptions::new()
        .connect(&format!("sqlite:{}?mode=rwc", db_path.display()))
        .await
        .unwrap();

    let mut config = Config::test_default();
    config.db_path = db_path.to_string_lossy().to_string();
    config.opaque_oprf_key_path = oprf_path.to_string_lossy().to_string();
    config.backup_path = backups_dir.clone();

    let job = BackupJob::new(Arc::new(config.clone()));
    let res1 = job.run_once(&pool).await.unwrap();
    tokio::time::sleep(std::time::Duration::from_secs(1)).await;
    let res2 = job.run_once(&pool).await.unwrap();

    assert_ne!(res1.path, res2.path);

    let list = list_backups(&config).await.unwrap();
    assert_eq!(list.len(), 2);
}

#[tokio::test]
async fn test_pruning_removes_oldest_when_count_exceeded() {
    let tmp = tempdir().unwrap();
    let db_path = tmp.path().join("app.db");
    let oprf_path = tmp.path().join("oprf.key");
    let backups_dir = tmp.path().join("backups");

    tokio::fs::write(&oprf_path, b"test-oprf-key")
        .await
        .unwrap();

    let pool = sqlx::sqlite::SqlitePoolOptions::new()
        .connect(&format!("sqlite:{}?mode=rwc", db_path.display()))
        .await
        .unwrap();

    let mut config = Config::test_default();
    config.db_path = db_path.to_string_lossy().to_string();
    config.opaque_oprf_key_path = oprf_path.to_string_lossy().to_string();
    config.backup_path = backups_dir.clone();
    config.backup_retention_count = 2;

    let job = BackupJob::new(Arc::new(config.clone()));
    for _ in 0..3 {
        job.run_once(&pool).await.unwrap();
        tokio::time::sleep(std::time::Duration::from_secs(1)).await;
    }

    let list = list_backups(&config).await.unwrap();
    assert_eq!(list.len(), 2);
}

#[tokio::test]
async fn test_pruning_skipped_when_retention_is_zero() {
    let tmp = tempdir().unwrap();
    let db_path = tmp.path().join("app.db");
    let oprf_path = tmp.path().join("oprf.key");
    let backups_dir = tmp.path().join("backups");

    tokio::fs::write(&oprf_path, b"test-oprf-key")
        .await
        .unwrap();

    let pool = sqlx::sqlite::SqlitePoolOptions::new()
        .connect(&format!("sqlite:{}?mode=rwc", db_path.display()))
        .await
        .unwrap();

    let mut config = Config::test_default();
    config.db_path = db_path.to_string_lossy().to_string();
    config.opaque_oprf_key_path = oprf_path.to_string_lossy().to_string();
    config.backup_path = backups_dir.clone();
    config.backup_retention_count = 0;

    let job = BackupJob::new(Arc::new(config.clone()));
    for _ in 0..5 {
        job.run_once(&pool).await.unwrap();
        tokio::time::sleep(std::time::Duration::from_millis(1100)).await;
    }

    let list = list_backups(&config).await.unwrap();
    assert_eq!(list.len(), 5);
}

#[tokio::test]
async fn test_restore_reconstructs_database() {
    let tmp = tempdir().unwrap();
    let db_path = tmp.path().join("app.db");
    let oprf_path = tmp.path().join("oprf.key");
    let backups_dir = tmp.path().join("backups");

    tokio::fs::write(&oprf_path, b"test-oprf-key")
        .await
        .unwrap();

    let pool = sqlx::sqlite::SqlitePoolOptions::new()
        .connect(&format!("sqlite:{}?mode=rwc", db_path.display()))
        .await
        .unwrap();

    sqlx::query("CREATE TABLE items (id INT, val TEXT); INSERT INTO items VALUES (1, 'marker');")
        .execute(&pool)
        .await
        .unwrap();

    let mut config = Config::test_default();
    config.db_path = db_path.to_string_lossy().to_string();
    config.opaque_oprf_key_path = oprf_path.to_string_lossy().to_string();
    config.backup_path = backups_dir.clone();

    let job = BackupJob::new(Arc::new(config.clone()));
    let backup_res = job.run_once(&pool).await.unwrap();

    // Modify the DB by adding a second row
    sqlx::query("INSERT INTO items VALUES (2, 'unwanted');")
        .execute(&pool)
        .await
        .unwrap();

    let count_before: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM items")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count_before, 2);

    pool.close().await;

    // Restore from backup
    restore_backup(
        &config,
        RestoreOptions {
            from: backup_res.path,
            confirm: true,
        },
    )
    .await
    .unwrap();

    // Reopen DB and check
    let pool2 = sqlx::sqlite::SqlitePoolOptions::new()
        .connect(&format!("sqlite:{}?mode=rwc", db_path.display()))
        .await
        .unwrap();

    let count_after: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM items")
        .fetch_one(&pool2)
        .await
        .unwrap();
    assert_eq!(count_after, 1);

    let val: String = sqlx::query_scalar("SELECT val FROM items WHERE id = 1")
        .fetch_one(&pool2)
        .await
        .unwrap();
    assert_eq!(val, "marker");
}

#[tokio::test]
async fn test_restore_without_confirm_fails() {
    let config = Config::test_default();
    let res = restore_backup(
        &config,
        RestoreOptions {
            from: PathBuf::from("/tmp/nonexistent.cbak"),
            confirm: false,
        },
    )
    .await;

    assert!(res.is_err());
    let err_msg = res.unwrap_err().to_string();
    assert!(err_msg.contains("Pass --confirm to proceed"));
}

#[tokio::test]
async fn test_restore_nonexistent_file_fails() {
    let config = Config::test_default();
    let res = restore_backup(
        &config,
        RestoreOptions {
            from: PathBuf::from("/tmp/nonexistent-backup-file-999.cbak"),
            confirm: true,
        },
    )
    .await;

    assert!(res.is_err());
    let err_msg = res.unwrap_err().to_string();
    assert!(err_msg.contains("not found"));
}

#[tokio::test]
async fn test_restore_tampered_backup_fails() {
    let tmp = tempdir().unwrap();
    let db_path = tmp.path().join("app.db");
    let oprf_path = tmp.path().join("oprf.key");
    let backup_file = tmp.path().join("tampered.cbak");

    tokio::fs::write(&oprf_path, b"test-oprf-key")
        .await
        .unwrap();
    tokio::fs::write(&db_path, b"db-content").await.unwrap();

    let mut config = Config::test_default();
    config.db_path = db_path.to_string_lossy().to_string();
    config.opaque_oprf_key_path = oprf_path.to_string_lossy().to_string();

    // Write bogus encrypted bytes
    tokio::fs::write(&backup_file, vec![0u8; 100])
        .await
        .unwrap();

    let res = restore_backup(
        &config,
        RestoreOptions {
            from: backup_file,
            confirm: true,
        },
    )
    .await;

    assert!(res.is_err());
}

#[tokio::test]
async fn test_restore_requires_oprf_key_file() {
    let tmp = tempdir().unwrap();
    let oprf_path = tmp.path().join("missing-oprf.key");
    let backup_file = tmp.path().join("dummy.cbak");

    tokio::fs::write(&backup_file, b"dummy").await.unwrap();

    let mut config = Config::test_default();
    config.opaque_oprf_key_path = oprf_path.to_string_lossy().to_string();

    let res = restore_backup(
        &config,
        RestoreOptions {
            from: backup_file,
            confirm: true,
        },
    )
    .await;

    assert!(res.is_err());
    let err_msg = res.unwrap_err().to_string();
    assert!(err_msg.contains("Restore requires the OPRF key file"));
}
