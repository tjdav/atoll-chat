mod common;

use common::setup_test_app;
use sqlx::Row;

#[tokio::test]
async fn test_schema_columns() {
    let (_app, pool) = setup_test_app().await;

    let columns: Vec<String> = sqlx::query("PRAGMA table_info(users)")
        .fetch_all(&pool)
        .await
        .unwrap()
        .into_iter()
        .map(|r| r.get::<String, _>("name"))
        .collect();

    assert!(!columns.contains(&"username".to_string()));
    assert!(!columns.contains(&"username_hash".to_string()));
    assert!(!columns.contains(&"display_name".to_string()));

    assert!(columns.contains(&"username_token".to_string()));
    assert!(columns.contains(&"encrypted_display".to_string()));

    let index_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = 'idx_users_username_token'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(index_count, 1);
}

#[tokio::test]
async fn test_foreign_key_references() {
    let (_app, pool) = setup_test_app().await;

    sqlx::query(
        "INSERT INTO users (id, username_token, opaque_registration, identity_pubkey) VALUES ('user_1', 'token_1234567890123456789012345678901234567890123456789012345678901234567890123456789012', x'00', '')"
    )
    .execute(&pool)
    .await
    .unwrap();

    sqlx::query(
        "INSERT INTO devices (id, user_id, client_id, platform) VALUES ('dev_1', 'user_1', 'client_1', 'web')",
    )
    .execute(&pool)
    .await
    .unwrap();

    sqlx::query("INSERT INTO sessions (id, token_hash, user_id, device_id, expires_at) VALUES ('sess_1', 'hash1', 'user_1', 'dev_1', CURRENT_TIMESTAMP)")
        .execute(&pool)
        .await
        .unwrap();

    let session_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM sessions WHERE user_id = 'user_1'")
            .fetch_one(&pool)
            .await
            .unwrap();

    assert_eq!(session_count, 1);
}
