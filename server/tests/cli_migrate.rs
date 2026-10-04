use tempfile::NamedTempFile;

#[tokio::test]
async fn test_cli_migrate_fresh_and_idempotent() {
    let tmp = NamedTempFile::new().unwrap();
    let db_path = tmp.path().to_str().unwrap().to_string();

    std::env::set_var("APP_ENV", "development");
    std::env::set_var("DB_PATH", &db_path);
    std::env::set_var("MODEL_HOSTING_ENABLED", "false");

    // 1. Fresh database applies all migrations
    let res = server::cli::run_migrate().await;
    assert!(res.is_ok(), "run_migrate failed: {:?}", res);

    let config = server::Config::from_env().unwrap();
    let pool = server::db::init_pool(&config).await.unwrap();

    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM _sqlx_migrations")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert!(count > 0);

    // 2. Second invocation is a no-op / succeeds cleanly
    let res_second = server::cli::run_migrate().await;
    assert!(res_second.is_ok());
}
