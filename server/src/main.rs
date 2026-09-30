use clap::Parser;
use server::altcha::AltchaConfig;
use server::cli::{Cli, Command};
use server::config::Config;
use server::db;
use server::login::LoginStore;
use server::opaque::OpaqueServer;
use server::registration::RegistrationStore;
use server::roles;
use server::AppState;
use std::path::Path;
use std::str::FromStr;
use std::sync::Arc;
use tracing::{info, warn, Level};

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

    // Parse CLI arguments
    let cli = Cli::parse();
    if let Some(Command::Restore { from, confirm }) = cli.command {
        let config = Config::from_env()?;
        let options = server::backup::RestoreOptions { from, confirm };
        if let Err(e) = server::backup::restore_backup(&config, options).await {
            eprintln!("Error: {}", e);
            std::process::exit(1);
        }
        println!("Restore completed successfully.");
        return Ok(());
    }

    // 3. Load Config
    let config = Arc::new(Config::from_env()?);

    // 4. Log startup banner
    info!(
        "Starting {} in {} mode. Bind: {}, DB: {}",
        config.app_name, config.app_env, config.server_bind, config.db_path
    );

    if config.app_env == "production" && !config.trust_proxy {
        warn!("TRUST_PROXY=false in production. Set TRUST_PROXY=true if behind a reverse proxy.");
    }

    if let Some(dir) = &config.client_static_dir {
        info!("serving SPA from {}", dir);
    } else {
        info!("SPA serving disabled (CLIENT_STATIC_DIR unset)");
    }

    // 5. Initialize Storage Backend
    let storage = server::build_storage(&config)?;
    if config.storage_backend == "s3" {
        info!(
            "storage backend: s3 (bucket={} endpoint={})",
            config.s3_bucket.as_deref().unwrap_or(""),
            config
                .s3_endpoint
                .as_deref()
                .unwrap_or("https://s3.amazonaws.com")
        );
    } else {
        info!(
            "storage backend: fs (root={})",
            config.storage_fs_path.display()
        );
    }

    // 6. Initialize SQLite pool
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

    let sockudo_config = server::SockudoConfig::load_or_initialize(&pool, &config).await?;
    let publisher = Arc::new(server::Publisher::new(sockudo_config));
    let backup_lock = Arc::new(tokio::sync::Mutex::new(()));

    let vapid_keys = server::push::vapid::VapidKeys::load_or_generate(&pool, &config).await?;
    let vapid_keys = vapid_keys.map(Arc::new);

    if let Some(ref keys) = vapid_keys {
        let prefix = if keys.public_key.len() >= 8 {
            &keys.public_key[..8]
        } else {
            &keys.public_key
        };
        info!("push: VAPID initialized (public_key={}...)", prefix);
    } else {
        info!("push: disabled");
    }

    let state = AppState {
        pool: pool.clone(),
        opaque_server,
        registration_store: registration_store.clone(),
        login_store: login_store.clone(),
        altcha_config,
        config: config.clone(),
        server_hard_max: server_hard_max.clone(),
        publisher,
        storage: storage.clone(),
        backup_lock,
        vapid_keys,
    };

    // 7. Check bootstrap state
    if roles::has_any_users(&pool).await? {
        info!("bootstrap: users exist — owner role already assigned");
    } else {
        info!("bootstrap: no users exist — first registration will become owner");
    }

    // 8. Build Router
    let app = server::build_app(state);

    // 9. Setup Cleanup Scheduler
    let (shutdown_tx, shutdown_rx) = tokio::sync::watch::channel(false);

    if config.backup_enabled {
        let backup_job = server::backup::BackupJob::new(config.clone());
        let backup_pool = pool.clone();
        let backup_shutdown = shutdown_rx.clone();
        tokio::spawn(async move {
            backup_job.run_loop(backup_pool, backup_shutdown).await;
        });
        info!(
            "backup scheduler started interval_hours={}",
            config.backup_interval_hours
        );
    } else {
        info!("backup scheduler disabled");
    }

    if config.cleanup_enabled {
        let mut scheduler = server::cleanup::Scheduler::new(std::time::Duration::from_secs(
            config.cleanup_interval_minutes * 60,
        ));
        scheduler.register(Box::new(server::cleanup::sessions::SessionsJob));
        scheduler.register(Box::new(server::cleanup::rate_limits::RateLimitsJob));
        scheduler.register(Box::new(server::cleanup::audit::AuditJob));
        scheduler.register(Box::new(server::cleanup::welcomes::WelcomesJob));
        scheduler.register(Box::new(server::cleanup::attachments::AttachmentsJob));
        scheduler.register(Box::new(server::cleanup::memory::MemoryStoresJob));

        let ctx = server::cleanup::CleanupContextOwned {
            pool: pool.clone(),
            config: config.clone(),
            registration_store: registration_store.clone(),
            login_store: login_store.clone(),
            storage: storage.clone(),
            server_max: server_hard_max.clone(),
        };
        let scheduler_shutdown = shutdown_rx.clone();

        tokio::spawn(async move {
            scheduler.run(ctx, scheduler_shutdown).await;
        });
    } else {
        info!("cleanup: scheduler disabled");
    }

    // 10. Bind to address
    let listener = tokio::net::TcpListener::bind(&config.server_bind).await?;

    // 11. Serve with graceful shutdown
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
