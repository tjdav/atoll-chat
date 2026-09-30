use tempfile::NamedTempFile;

#[tokio::test]
async fn test_cli_storage_migrate_rejects_same_backend() {
    let res_fs =
        server::cli::run_storage_migrate("fs".to_string(), "fs".to_string(), 100, 4, false, false)
            .await;
    assert!(res_fs.is_err());
    assert!(res_fs
        .unwrap_err()
        .to_string()
        .contains("source and destination backends must differ"));

    let res_s3 =
        server::cli::run_storage_migrate("s3".to_string(), "s3".to_string(), 100, 4, false, false)
            .await;
    assert!(res_s3.is_err());
    assert!(res_s3
        .unwrap_err()
        .to_string()
        .contains("source and destination backends must differ"));
}

#[tokio::test]
async fn test_cli_storage_migrate_rejects_invalid_backend() {
    let res_invalid_from =
        server::cli::run_storage_migrate("gcs".to_string(), "s3".to_string(), 100, 4, false, false)
            .await;
    assert!(res_invalid_from.is_err());
    assert!(res_invalid_from
        .unwrap_err()
        .to_string()
        .contains("invalid source backend"));

    let res_invalid_to =
        server::cli::run_storage_migrate("fs".to_string(), "gcs".to_string(), 100, 4, false, false)
            .await;
    assert!(res_invalid_to.is_err());
    assert!(res_invalid_to
        .unwrap_err()
        .to_string()
        .contains("invalid destination backend"));
}

#[tokio::test]
async fn test_cli_storage_migrate_dry_run() {
    let tmp = NamedTempFile::new().unwrap();
    let db_path = tmp.path().to_str().unwrap().to_string();

    std::env::set_var("APP_ENV", "development");
    std::env::set_var("DB_PATH", &db_path);

    // Apply DB migrations
    server::cli::run_migrate().await.unwrap();

    // Dry run fs -> s3 (s3 credentials default to localhost for test_default)
    std::env::set_var("STORAGE_BACKEND", "fs");
    std::env::set_var("S3_BUCKET", "test-bucket");
    std::env::set_var("S3_ACCESS_KEY_ID", "key");
    std::env::set_var("S3_SECRET_ACCESS_KEY", "secret");

    let res = server::cli::run_storage_migrate(
        "fs".to_string(),
        "s3".to_string(),
        100,
        4,
        false,
        true, // dry_run
    )
    .await;

    assert!(res.is_ok(), "dry_run failed: {:?}", res);
}
