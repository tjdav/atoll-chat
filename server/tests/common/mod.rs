use sqlx::{sqlite::SqlitePoolOptions, SqlitePool};

pub async fn setup_test_db() -> SqlitePool {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .expect("Failed to connect to in-memory DB");

    sqlx::migrate!()
        .run(&pool)
        .await
        .expect("Failed to run migrations on test DB");

    pool
}
