use chrono::{Duration, Utc};
use server::push::suppression::should_suppress;
use sqlx::SqlitePool;

mod common;

async fn setup_db_with_user_and_device(pool: &SqlitePool, user_id: &str, device_id: &str) {
    sqlx::query(
        "INSERT OR IGNORE INTO users (id, username, username_hash, opaque_registration, identity_pubkey) VALUES (?, ?, 'hash', X'00', '')",
    )
    .bind(user_id)
    .bind(user_id)
    .execute(pool)
    .await
    .unwrap();

    sqlx::query(
        "INSERT OR IGNORE INTO devices (id, user_id, client_id, name) VALUES (?, ?, ?, 'Device')",
    )
    .bind(device_id)
    .bind(user_id)
    .bind(format!("client_{}", device_id))
    .execute(pool)
    .await
    .unwrap();
}

async fn insert_session(
    pool: &SqlitePool,
    session_id: &str,
    user_id: &str,
    device_id: &str,
    last_seen_at: chrono::DateTime<Utc>,
) {
    let now = Utc::now();
    let expires = now + Duration::days(30);

    sqlx::query(
        r#"
        INSERT INTO sessions (id, token_hash, user_id, device_id, created_at, expires_at, last_seen_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        "#,
    )
    .bind(session_id)
    .bind(format!("hash_{}", session_id))
    .bind(user_id)
    .bind(device_id)
    .bind(now)
    .bind(expires)
    .bind(last_seen_at)
    .execute(pool)
    .await
    .unwrap();
}

#[tokio::test]
async fn test_no_device_id_no_suppression() {
    let pool = common::setup_test_db().await;

    let res = should_suppress(&pool, "user-1", None, 30).await.unwrap();
    assert!(!res);

    let res_empty = should_suppress(&pool, "user-1", Some("  "), 30)
        .await
        .unwrap();
    assert!(!res_empty);
}

#[tokio::test]
async fn test_no_session_no_suppression() {
    let pool = common::setup_test_db().await;
    setup_db_with_user_and_device(&pool, "user-1", "dev-1").await;

    let res = should_suppress(&pool, "user-1", Some("dev-1"), 30)
        .await
        .unwrap();
    assert!(!res);
}

#[tokio::test]
async fn test_recent_session_suppresses() {
    let pool = common::setup_test_db().await;
    setup_db_with_user_and_device(&pool, "user-1", "dev-1").await;

    insert_session(&pool, "sess-1", "user-1", "dev-1", Utc::now()).await;

    let res = should_suppress(&pool, "user-1", Some("dev-1"), 30)
        .await
        .unwrap();
    assert!(res);
}

#[tokio::test]
async fn test_stale_session_does_not_suppress() {
    let pool = common::setup_test_db().await;
    setup_db_with_user_and_device(&pool, "user-1", "dev-1").await;

    let stale = Utc::now() - Duration::seconds(120);
    insert_session(&pool, "sess-1", "user-1", "dev-1", stale).await;

    let res = should_suppress(&pool, "user-1", Some("dev-1"), 30)
        .await
        .unwrap();
    assert!(!res);
}

#[tokio::test]
async fn test_window_boundary_outside() {
    let pool = common::setup_test_db().await;
    setup_db_with_user_and_device(&pool, "user-1", "dev-1").await;

    // 35s ago (outside 30s window)
    let past = Utc::now() - Duration::seconds(35);
    insert_session(&pool, "sess-1", "user-1", "dev-1", past).await;

    let res = should_suppress(&pool, "user-1", Some("dev-1"), 30)
        .await
        .unwrap();
    assert!(!res);
}

#[tokio::test]
async fn test_window_boundary_inside() {
    let pool = common::setup_test_db().await;
    setup_db_with_user_and_device(&pool, "user-1", "dev-1").await;

    // 25s ago (inside 30s window)
    let past = Utc::now() - Duration::seconds(25);
    insert_session(&pool, "sess-1", "user-1", "dev-1", past).await;

    let res = should_suppress(&pool, "user-1", Some("dev-1"), 30)
        .await
        .unwrap();
    assert!(res);
}

#[tokio::test]
async fn test_multiple_sessions_for_same_device() {
    let pool = common::setup_test_db().await;
    setup_db_with_user_and_device(&pool, "user-1", "dev-1").await;

    let stale = Utc::now() - Duration::seconds(300);
    let recent = Utc::now() - Duration::seconds(10);

    insert_session(&pool, "sess-1", "user-1", "dev-1", stale).await;
    insert_session(&pool, "sess-2", "user-1", "dev-1", recent).await;

    let res = should_suppress(&pool, "user-1", Some("dev-1"), 30)
        .await
        .unwrap();
    assert!(res);
}

#[tokio::test]
async fn test_session_for_different_device_does_not_affect() {
    let pool = common::setup_test_db().await;
    setup_db_with_user_and_device(&pool, "user-1", "dev-1").await;
    setup_db_with_user_and_device(&pool, "user-1", "dev-2").await;

    // dev-1 has recent session, dev-2 has no session
    insert_session(&pool, "sess-1", "user-1", "dev-1", Utc::now()).await;

    let res_dev2 = should_suppress(&pool, "user-1", Some("dev-2"), 30)
        .await
        .unwrap();
    assert!(!res_dev2);

    let res_dev1 = should_suppress(&pool, "user-1", Some("dev-1"), 30)
        .await
        .unwrap();
    assert!(res_dev1);
}
