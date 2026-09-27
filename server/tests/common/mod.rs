use axum::Router;
use server::opaque::OpaqueServer;
use server::registration::RegistrationStore;
use server::routes;
use server::AppState;
use sqlx::{sqlite::SqlitePoolOptions, SqlitePool};
use std::sync::Arc;

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

#[allow(dead_code)]
pub async fn setup_test_app() -> (Router, SqlitePool) {
    let pool = setup_test_db().await;

    let temp_dir = tempfile::tempdir().expect("Failed to create tempdir");
    let key_path = temp_dir.path().join("oprf.key");
    let opaque_server =
        Arc::new(OpaqueServer::load_or_generate(&key_path).expect("Failed to create OpaqueServer"));
    let registration_store = Arc::new(RegistrationStore::new());

    let state = AppState {
        pool: pool.clone(),
        opaque_server,
        registration_store,
    };

    let app = Router::new()
        .route(
            "/api/v1/auth/register/start",
            axum::routing::post(routes::register::register_start),
        )
        .route(
            "/api/v1/auth/register/finish",
            axum::routing::post(routes::register::register_finish),
        )
        .with_state(state);

    (app, pool)
}
