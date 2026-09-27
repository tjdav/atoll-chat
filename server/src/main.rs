use axum::{
    routing::{get, post},
    Router,
};
use server::config::Config;
use server::db;
use server::opaque::OpaqueServer;
use server::registration::RegistrationStore;
use server::roles;
use server::routes;
use server::AppState;
use std::path::Path;
use std::str::FromStr;
use std::sync::Arc;
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;
use tracing::{info, Level};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // 1. Load .env via dotenvy (ignore errors if file missing)
    let _ = dotenvy::dotenv();

    // 2. Initialize tracing
    let log_level_str = std::env::var("LOG_LEVEL").unwrap_or_else(|_| "info".to_string());
    let log_level = Level::from_str(&log_level_str).unwrap_or(Level::INFO);
    tracing_subscriber::fmt()
        .with_env_filter(format!(
            "{},tower_http={}",
            log_level.as_str().to_lowercase(),
            log_level.as_str().to_lowercase()
        ))
        .init();

    // 3. Load Config
    let config = Config::from_env()?;

    // 4. Log startup banner
    info!(
        "Starting {} in {} mode. Bind: {}, DB: {}",
        config.app_name, config.app_env, config.server_bind, config.db_path
    );

    // 5. Initialize SQLite pool
    let pool = db::init_pool(&config).await?;

    // Initialize OPAQUE server setup
    let opaque_server = Arc::new(OpaqueServer::load_or_generate(Path::new(
        &config.opaque_oprf_key_path,
    ))?);
    let registration_store = Arc::new(RegistrationStore::new());

    let state = AppState {
        pool: pool.clone(),
        opaque_server,
        registration_store,
    };

    // CORS configuration
    let cors = if config.app_env == "development" {
        info!("CORS mode: permissive (development)");
        CorsLayer::permissive()
    } else {
        if let Some(app_url) = &config.app_url {
            info!("CORS mode: restricted to {}", app_url);
            CorsLayer::new().allow_origin(
                app_url
                    .parse::<axum::http::HeaderValue>()
                    .expect("Invalid APP_URL for CORS"),
            )
        } else {
            info!("CORS mode: no origin allowed (APP_URL missing)");
            CorsLayer::new()
        }
    };

    // 6. Check bootstrap state
    if roles::has_any_users(&pool).await? {
        info!("bootstrap: users exist — owner role already assigned");
    } else {
        info!("bootstrap: no users exist — first registration will become owner");
    }

    // 7. Build Router
    let app = Router::new()
        .route("/health", get(routes::health::handler))
        .route("/api/v1/capabilities", get(routes::capabilities::handler))
        .route("/api/v1/roles", get(routes::roles::handler))
        .route(
            "/api/v1/auth/register/start",
            post(routes::register::register_start),
        )
        .route(
            "/api/v1/auth/register/finish",
            post(routes::register::register_finish),
        )
        .layer(TraceLayer::new_for_http())
        .layer(cors)
        .with_state(state);

    // 8. Bind to address
    let listener = tokio::net::TcpListener::bind(&config.server_bind).await?;

    // 9. Serve with graceful shutdown
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;

    Ok(())
}

async fn shutdown_signal() {
    let ctrl_c = async {
        tokio::signal::ctrl_c()
            .await
            .expect("failed to install Ctrl+C handler");
    };

    #[cfg(unix)]
    let terminate = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("failed to install signal handler")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {
            info!("Received Ctrl+C, starting graceful shutdown");
        },
        _ = terminate => {
            info!("Received SIGTERM, starting graceful shutdown");
        },
    }
}
