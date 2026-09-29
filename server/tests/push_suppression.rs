use chrono::{Duration, Utc};
use server::push::suppression::should_suppress;
use sqlx::sqlite::SqlitePoolOptions;
use sqlx::SqlitePool;

async fn setup_db() -> SqlitePool {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .unwrap();

    sqlx::migrate!("./migrations").run(&pool).await.unwrap();

    pool
}

async fn insert_user(pool: &SqlitePool, user_id: &str) {
    sqlx::query(
        "INSERT INTO users (id, username, username_hash, opaque_registration, identity_pubkey) VALUES (?, ?, ?, 'data', 'pubkey')",
    )
    .bind(user_id)
    .bind(user_id)
    .bind(format!("hash-{}", user_id))
    .execute(pool)
    .await
    .unwrap();
}

async fn insert_device(pool: &SqlitePool, device_id: &str, user_id: &str) {
    sqlx::query("INSERT INTO devices (id, user_id, client_id) VALUES (?, ?, ?)")
        .bind(device_id)
        .bind(user_id)
        .bind(format!("client-{}", device_id))
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
    sqlx::query(
        "INSERT INTO sessions (id, user_id, device_id, token_hash, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(session_id)
    .bind(user_id)
    .bind(device_id)
    .bind(format!("token-{}", session_id))
    .bind(Utc::now() + Duration::days(1))
    .bind(last_seen_at)
    .execute(pool)
    .await
    .unwrap();
}

#[tokio::test]
async fn test_no_device_id_no_suppression() {
    let pool = setup_db().await;
    let res = should_suppress(&pool, "user-1", None, 30).await.unwrap();
    assert!(!res);
}

#[tokio::test]
async fn test_no_session_no_suppression() {
    let pool = setup_db().await;
    insert_user(&pool, "user-1").await;
    insert_device(&pool, "dev-1", "user-1").await;

    let res = should_suppress(&pool, "user-1", Some("dev-1"), 30)
        .await
        .unwrap();
    assert!(!res);
}

#[tokio::test]
async fn test_recent_session_suppresses() {
    let pool = setup_db().await;
    insert_user(&pool, "user-1").await;
    insert_device(&pool, "dev-1", "user-1").await;
    insert_session(&pool, "s1", "user-1", "dev-1", Utc::now()).await;

    let res = should_suppress(&pool, "user-1", Some("dev-1"), 30)
        .await
        .unwrap();
    assert!(res);
}

#[tokio::test]
async fn test_stale_session_no_suppression() {
    let pool = setup_db().await;
    insert_user(&pool, "user-1").await;
    insert_device(&pool, "dev-1", "user-1").await;
    insert_session(
        &pool,
        "s1",
        "user-1",
        "dev-1",
        Utc::now() - Duration::seconds(120),
    )
    .await;

    let res = should_suppress(&pool, "user-1", Some("dev-1"), 30)
        .await
        .unwrap();
    assert!(!res);
}

#[tokio::test]
async fn test_boundary_outside_window() {
    let pool = setup_db().await;
    insert_user(&pool, "user-1").await;
    insert_device(&pool, "dev-1", "user-1").await;
    insert_session(
        &pool,
        "s1",
        "user-1",
        "dev-1",
        Utc::now() - Duration::seconds(35),
    )
    .await;

    let res = should_suppress(&pool, "user-1", Some("dev-1"), 30)
        .await
        .unwrap();
    assert!(!res);
}

#[tokio::test]
async fn test_boundary_inside_window() {
    let pool = setup_db().await;
    insert_user(&pool, "user-1").await;
    insert_device(&pool, "dev-1", "user-1").await;
    insert_session(
        &pool,
        "s1",
        "user-1",
        "dev-1",
        Utc::now() - Duration::seconds(25),
    )
    .await;

    let res = should_suppress(&pool, "user-1", Some("dev-1"), 30)
        .await
        .unwrap();
    assert!(res);
}

#[tokio::test]
async fn test_multiple_sessions_same_device() {
    let pool = setup_db().await;
    insert_user(&pool, "user-1").await;
    insert_device(&pool, "dev-1", "user-1").await;
    insert_session(
        &pool,
        "s1",
        "user-1",
        "dev-1",
        Utc::now() - Duration::seconds(300),
    )
    .await;
    insert_session(&pool, "s2", "user-1", "dev-1", Utc::now()).await;

    let res = should_suppress(&pool, "user-1", Some("dev-1"), 30)
        .await
        .unwrap();
    assert!(res);
}

#[tokio::test]
async fn test_different_device_isolation() {
    let pool = setup_db().await;
    insert_user(&pool, "user-1").await;
    insert_device(&pool, "dev-1", "user-1").await;
    insert_device(&pool, "dev-2", "user-1").await;

    // Recent session on dev-1
    insert_session(&pool, "s1", "user-1", "dev-1", Utc::now()).await;

    // Query for dev-2 -> should NOT be suppressed
    let res = should_suppress(&pool, "user-1", Some("dev-2"), 30)
        .await
        .unwrap();
    assert!(!res);
}
