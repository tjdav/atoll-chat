use axum::body::Body;
use axum::http::{Request, StatusCode};
use axum::Router;
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use server::altcha::AltchaConfig;
use server::config::Config;
use server::opaque::OpaqueServer;
use server::registration::RegistrationStore;
use server::routes;
use server::AppState;
use sqlx::{sqlite::SqlitePoolOptions, SqlitePool};
use std::sync::Arc;
use tower::ServiceExt;

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
    let (app, pool, _) = setup_test_app_with_config(true, "auto", 100).await;
    (app, pool)
}

#[allow(dead_code)]
pub async fn setup_test_app_with_config(
    enabled: bool,
    hmac_secret: &str,
    cost: u32,
) -> (Router, SqlitePool, Arc<AltchaConfig>) {
    let pool = setup_test_db().await;

    let temp_dir = tempfile::tempdir().expect("Failed to create tempdir");
    let key_path = temp_dir.path().join("oprf.key");
    let opaque_server =
        Arc::new(OpaqueServer::load_or_generate(&key_path).expect("Failed to create OpaqueServer"));
    let registration_store = Arc::new(RegistrationStore::new());

    let config = Config {
        app_env: "development".to_string(),
        app_url: None,
        app_name: "Test".to_string(),
        log_level: "info".to_string(),
        server_bind: "127.0.0.1:0".to_string(),
        db_path: ":memory:".to_string(),
        db_busy_timeout_ms: 5000,
        opaque_oprf_key_path: key_path.to_str().unwrap().to_string(),
        altcha_enabled: enabled,
        altcha_hmac_secret: hmac_secret.to_string(),
        altcha_algorithm: "PBKDF2/SHA-256".to_string(),
        altcha_cost: cost,
    };

    let altcha_config = Arc::new(
        AltchaConfig::from_env(&config, &pool)
            .await
            .expect("Failed to init AltchaConfig"),
    );

    let state = AppState {
        pool: pool.clone(),
        opaque_server,
        registration_store,
        altcha_config: altcha_config.clone(),
    };

    let app = Router::new()
        .route(
            "/api/v1/auth/register/challenge",
            axum::routing::get(routes::register::register_challenge),
        )
        .route(
            "/api/v1/auth/register/start",
            axum::routing::post(routes::register::register_start),
        )
        .route(
            "/api/v1/auth/register/finish",
            axum::routing::post(routes::register::register_finish),
        )
        .with_state(state);

    (app, pool, altcha_config)
}

#[allow(dead_code)]
pub fn solve_test_challenge(challenge: &altcha::Challenge) -> String {
    let solution = altcha::solve_challenge(altcha::SolveChallengeOptions::new(challenge))
        .expect("solve should not fail")
        .expect("solution should be found");
    let payload = altcha::Payload {
        challenge: challenge.clone(),
        solution,
    };
    let json = serde_json::to_string(&payload).unwrap();
    STANDARD.encode(json)
}

#[allow(dead_code)]
pub async fn fetch_and_solve_altcha(app: &Router) -> String {
    let req = Request::builder()
        .method("GET")
        .uri("/api/v1/auth/register/challenge")
        .body(Body::empty())
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let challenge: altcha::Challenge = serde_json::from_slice(&body_bytes).unwrap();
    solve_test_challenge(&challenge)
}
