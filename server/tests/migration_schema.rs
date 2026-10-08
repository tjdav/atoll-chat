use tempfile::TempDir;

#[tokio::test]
async fn test_single_migration_file_exists() {
    let entries: Vec<_> = std::fs::read_dir("migrations")
        .expect("read_dir migrations failed")
        .filter_map(|e| e.ok())
        .collect();

    assert_eq!(
        entries.len(),
        1,
        "Expected exactly 1 migration file in server/migrations/, found {}",
        entries.len()
    );

    let filename = entries[0].file_name().into_string().unwrap();
    assert_eq!(
        filename, "0001_v2_schema.sql",
        "Expected single migration to be 0001_v2_schema.sql, got {}",
        filename
    );
}

#[tokio::test]
async fn test_clean_migration_run_and_idempotency() {
    let tmp_dir = TempDir::new().unwrap();
    let db_path = tmp_dir.path().join("app.db").to_str().unwrap().to_string();

    std::env::set_var("APP_ENV", "development");
    std::env::set_var("DB_PATH", &db_path);
    std::env::set_var("MODEL_HOSTING_ENABLED", "false");

    // 1. Clean run
    let config = server::Config::from_env().unwrap();
    let pool = server::db::init_pool(&config).await.unwrap();

    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM _sqlx_migrations")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(
        count, 1,
        "Expected exactly 1 tracking row in _sqlx_migrations"
    );

    // 2. Idempotency test
    let res = server::cli::run_migrate().await;
    assert!(res.is_ok(), "Second migration run failed: {:?}", res);
}

#[tokio::test]
async fn test_foreign_keys_enforced() {
    let tmp_dir = TempDir::new().unwrap();
    let db_path = tmp_dir.path().join("app.db").to_str().unwrap().to_string();

    std::env::set_var("APP_ENV", "development");
    std::env::set_var("DB_PATH", &db_path);
    std::env::set_var("MODEL_HOSTING_ENABLED", "false");

    let config = server::Config::from_env().unwrap();
    let pool = server::db::init_pool(&config).await.unwrap();

    let fk_enabled: i64 = sqlx::query_scalar("PRAGMA foreign_keys;")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(fk_enabled, 1, "Foreign keys PRAGMA should be ON");

    // Inserting a room for non-existent owner_id must fail under FK constraint
    let res = sqlx::query("INSERT INTO rooms (id, owner_id) VALUES ('r_test', 'u_nonexistent')")
        .execute(&pool)
        .await;
    assert!(
        res.is_err(),
        "Expected foreign key constraint failure for non-existent user_id"
    );
}

#[tokio::test]
async fn test_role_seed_integrity() {
    let tmp_dir = TempDir::new().unwrap();
    let db_path = tmp_dir.path().join("app.db").to_str().unwrap().to_string();

    std::env::set_var("APP_ENV", "development");
    std::env::set_var("DB_PATH", &db_path);
    std::env::set_var("MODEL_HOSTING_ENABLED", "false");

    let config = server::Config::from_env().unwrap();
    let pool = server::db::init_pool(&config).await.unwrap();

    let roles = server::roles::list_roles(&pool).await.unwrap();
    assert_eq!(roles.len(), 4, "Expected 4 default roles seeded");

    let role_names: Vec<String> = roles.into_iter().map(|r| r.name).collect();
    assert!(role_names.contains(&"owner".to_string()));
    assert!(role_names.contains(&"admin".to_string()));
    assert!(role_names.contains(&"inviter".to_string()));
    assert!(role_names.contains(&"member".to_string()));
}

#[tokio::test]
async fn test_target_v2_schema_structural_matches_expectation() {
    let tmp_dir = TempDir::new().unwrap();
    let db_path = tmp_dir.path().join("app.db").to_str().unwrap().to_string();

    std::env::set_var("APP_ENV", "development");
    std::env::set_var("DB_PATH", &db_path);
    std::env::set_var("MODEL_HOSTING_ENABLED", "false");

    let config = server::Config::from_env().unwrap();
    let pool = server::db::init_pool(&config).await.unwrap();

    let rows: Vec<(String, String, String, i64, Option<String>, i64)> = sqlx::query_as(
        r#"
        SELECT
            m.tbl_name,
            p.name,
            p.type,
            p."notnull",
            p.dflt_value,
            p.pk
        FROM sqlite_master m
        JOIN pragma_table_info(m.name) p
        WHERE m.type = 'table' AND m.name != '_sqlx_migrations'
        ORDER BY m.tbl_name, p.name;
        "#,
    )
    .fetch_all(&pool)
    .await
    .unwrap();

    let current_dump = rows
        .into_iter()
        .map(|(tbl, col, typ, nn, dflt, pk)| {
            format!(
                "{}|{}|{}|{}|{}|{}",
                tbl,
                col,
                typ,
                nn,
                dflt.unwrap_or_default(),
                pk
            )
        })
        .collect::<Vec<_>>()
        .join("\n");

    let target_tables = [
        "users",
        "user_seq",
        "roles",
        "user_roles",
        "devices",
        "device_names",
        "sessions",
        "server_invites",
        "rooms",
        "room_members",
        "room_invites",
        "room_epochs",
        "room_messages",
        "reactions",
        "key_packages",
        "welcomes",
        "pending_mls_removes",
        "pending_mls_adds",
        "attachments",
        "read_state",
        "user_preferences",
        "starred_items",
        "recovery_codes",
        "key_transparency_log",
        "key_transparency_snapshots",
        "call_sessions",
        "room_sessions",
        "push_subscriptions",
        "instance_config",
        "instance_limits",
        "audit_log",
        "rate_limits",
        "oprf_audit",
    ];

    for tbl in target_tables {
        assert!(
            current_dump.contains(tbl),
            "Expected table {} in target V2 schema",
            tbl
        );
    }

    // Verify key columns exist
    assert!(current_dump.contains("users|username_token|TEXT|1||0"));
    assert!(current_dump.contains("rooms|metadata|TEXT|0||0"));
    assert!(current_dump.contains("starred_items|user_seq|INTEGER|1||0"));
    assert!(current_dump.contains("user_preferences|value_encrypted|TEXT|1||0"));
    assert!(!current_dump.contains("user_preferences|value_json|"));
    assert!(current_dump.contains("room_sessions|session_type|TEXT|1||0"));
}
