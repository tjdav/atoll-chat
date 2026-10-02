use server::db::init_pool;
use server::recovery_code::{generate, persist_for_user, verify_for_user};
use server::Config;

#[tokio::test]
async fn test_recovery_code_persistence_and_verification() {
    let config = Config::test_default();
    let pool = init_pool(&config).await.expect("failed to init db pool");

    // Insert dummy user matching users schema
    let user_id = "user_test_recovery_1";
    let username_token = "token_test_recovery_1";
    sqlx::query(
        "INSERT INTO users (id, username_token, opaque_registration, identity_pubkey) VALUES (?, ?, ?, ?)",
    )
    .bind(user_id)
    .bind(username_token)
    .bind(vec![0u8; 32])
    .bind("pubkey_test")
    .execute(&pool)
    .await
    .expect("failed to insert test user");

    // Persist a recovery code for the user
    let code = persist_for_user(&pool, user_id)
        .await
        .expect("persist_for_user failed");

    // Check DB row exists with consumed_at IS NULL
    let row: (i64, Option<String>) = sqlx::query_as(
        "SELECT COUNT(*), consumed_at FROM recovery_codes WHERE user_id = ? AND consumed_at IS NULL",
    )
    .bind(user_id)
    .fetch_one(&pool)
    .await
    .expect("failed to query recovery_codes");

    assert_eq!(row.0, 1);
    assert!(row.1.is_none());

    // Verify plaintext code against DB
    let matched_id = verify_for_user(&pool, user_id, &code)
        .await
        .expect("verify_for_user failed");
    assert!(matched_id.is_some());

    // Verify a wrong code fails
    let wrong_code = generate();
    let failed_match = verify_for_user(&pool, user_id, &wrong_code)
        .await
        .expect("verify_for_user failed");
    assert!(failed_match.is_none());

    // Verify user with no recovery codes returns None
    let no_code_match = verify_for_user(&pool, "nonexistent_user", &code)
        .await
        .expect("verify_for_user failed");
    assert!(no_code_match.is_none());

    // Mark row consumed and check verify_for_user ignores consumed code
    let row_id = matched_id.unwrap();
    sqlx::query("UPDATE recovery_codes SET consumed_at = CURRENT_TIMESTAMP WHERE id = ?")
        .bind(&row_id)
        .execute(&pool)
        .await
        .expect("failed to consume recovery code");

    let consumed_match = verify_for_user(&pool, user_id, &code)
        .await
        .expect("verify_for_user failed");
    assert!(consumed_match.is_none());
}
