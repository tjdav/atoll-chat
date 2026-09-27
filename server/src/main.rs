use axum::{
    routing::{delete, get, post},
    Router,
};
use server::altcha::AltchaConfig;
use server::config::Config;
use server::db;
use server::login::LoginStore;
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
    let config = Arc::new(Config::from_env()?);

    // 4. Log startup banner
    info!(
        "Starting {} in {} mode. Bind: {}, DB: {}",
        config.app_name, config.app_env, config.server_bind, config.db_path
    );

    // 5. Initialize SQLite pool
    let pool = db::init_pool(&config).await?;

    // Initialize OPAQUE server setup, stores, and ALTCHA config
    let opaque_server = Arc::new(OpaqueServer::load_or_generate(Path::new(
        &config.opaque_oprf_key_path,
    ))?);
    let registration_store = Arc::new(RegistrationStore::new());
    let login_store = Arc::new(LoginStore::new());
    let altcha_config = Arc::new(AltchaConfig::from_env(&config, &pool).await?);
    let server_hard_max = Arc::new(server::ServerHardMax {
        file_size_bytes: config.max_file_size_bytes as i64,
        room_size: 1000,
        rooms_per_user: 500,
        devices_per_user: config.server_max_devices_per_user as i64,
        keypackages_per_device: 50,
        message_size_bytes: 65536,
        attachment_retention_days: 365,
        call_max_participants: 50,
    });

    let state = AppState {
        pool: pool.clone(),
        opaque_server,
        registration_store: registration_store.clone(),
        login_store: login_store.clone(),
        altcha_config,
        config: config.clone(),
        server_hard_max,
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
        .route("/ready", get(routes::ready::handler))
        .route(
            "/api/v1/admin/config",
            get(routes::admin::get_config_handler).patch(routes::admin::patch_config_handler),
        )
        .route(
            "/api/v1/admin/limits",
            get(routes::admin::get_limits_handler).patch(routes::admin::patch_limits_handler),
        )
        .route("/api/v1/admin/audit", get(routes::admin::get_audit_handler))
        .route("/api/v1/capabilities", get(routes::capabilities::handler))
        .route("/api/v1/roles", get(routes::roles::handler))
        .route(
            "/api/v1/auth/register/challenge",
            get(routes::register::register_challenge),
        )
        .route(
            "/api/v1/auth/register/start",
            post(routes::register::register_start),
        )
        .route(
            "/api/v1/auth/register/finish",
            post(routes::register::register_finish),
        )
        .route("/api/v1/auth/login/start", post(routes::login::login_start))
        .route(
            "/api/v1/auth/login/finish",
            post(routes::login::login_finish),
        )
        .route(
            "/api/v1/users/me",
            get(routes::users::get_me).patch(routes::users::patch_me),
        )
        .route("/api/v1/users/me/sessions", get(routes::sessions::list))
        .route(
            "/api/v1/users/me/sessions/{id}",
            delete(routes::sessions::revoke),
        )
        .route("/api/v1/users/me/devices", get(routes::devices::list))
        .route(
            "/api/v1/users/me/devices/{id}",
            delete(routes::devices::revoke),
        )
        .route("/api/v1/auth/logout", post(routes::sessions::logout))
        .route(
            "/api/v1/admin/invites",
            post(routes::invites::create_invite_handler).get(routes::invites::list_invites_handler),
        )
        .route(
            "/api/v1/admin/invites/{id}",
            delete(routes::invites::revoke_invite_handler),
        )
        .route(
            "/api/v1/invites/{code}",
            get(routes::invites::validate_invite_public_handler),
        )
        .layer(TraceLayer::new_for_http())
        .layer(cors)
        .with_state(state);

    // 8. Setup Cleanup Scheduler
    let (shutdown_tx, shutdown_rx) = tokio::sync::watch::channel(false);

    if config.cleanup_enabled {
        let mut scheduler = server::cleanup::Scheduler::new(std::time::Duration::from_secs(
            config.cleanup_interval_minutes * 60,
        ));
        scheduler.register(Box::new(server::cleanup::sessions::SessionsJob));
        scheduler.register(Box::new(server::cleanup::rate_limits::RateLimitsJob));
        scheduler.register(Box::new(server::cleanup::audit::AuditJob));
        scheduler.register(Box::new(server::cleanup::welcomes::WelcomesJob));
        scheduler.register(Box::new(server::cleanup::memory::MemoryStoresJob));

        let ctx = server::cleanup::CleanupContextOwned {
            pool: pool.clone(),
            config: config.clone(),
            registration_store: registration_store.clone(),
            login_store: login_store.clone(),
        };
        let scheduler_shutdown = shutdown_rx.clone();

        tokio::spawn(async move {
            scheduler.run(ctx, scheduler_shutdown).await;
        });
    } else {
        info!("cleanup: scheduler disabled");
    }

    // 9. Bind to address
    let listener = tokio::net::TcpListener::bind(&config.server_bind).await?;

    // 10. Serve with graceful shutdown
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal(shutdown_tx))
        .await?;

    Ok(())
}

async fn shutdown_signal(shutdown_tx: tokio::sync::watch::Sender<bool>) {
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

    let _ = shutdown_tx.send(true);
}
