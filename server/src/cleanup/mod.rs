use crate::config::Config;
use crate::limits::ServerHardMax;
use crate::login::LoginStore;
use crate::recovery::RecoveryStore;
use crate::registration::RegistrationStore;
use crate::sockudo::Publisher;
use crate::storage::Storage;
use async_trait::async_trait;
use sqlx::SqlitePool;
use std::sync::Arc;
use std::time::{Duration, Instant};

#[async_trait]
pub trait CleanupJob: Send + Sync {
    fn name(&self) -> &'static str;
    async fn run(&self, ctx: &CleanupContext<'_>) -> Result<CleanupReport, CleanupError>;
}

pub struct CleanupContext<'a> {
    pub pool: &'a SqlitePool,
    pub config: &'a Config,
    pub registration_store: &'a Arc<RegistrationStore>,
    pub login_store: &'a Arc<LoginStore>,
    pub recovery_store: &'a Arc<RecoveryStore>,
    pub storage: &'a Arc<dyn Storage>,
    pub server_max: &'a Arc<ServerHardMax>,
    pub publisher: &'a Arc<Publisher>,
}

#[derive(Clone)]
pub struct CleanupContextOwned {
    pub pool: SqlitePool,
    pub config: Arc<Config>,
    pub registration_store: Arc<RegistrationStore>,
    pub login_store: Arc<LoginStore>,
    pub recovery_store: Arc<RecoveryStore>,
    pub storage: Arc<dyn Storage>,
    pub server_max: Arc<ServerHardMax>,
    pub publisher: Arc<Publisher>,
}

impl CleanupContextOwned {
    pub fn as_ctx(&self) -> CleanupContext<'_> {
        CleanupContext {
            pool: &self.pool,
            config: &self.config,
            registration_store: &self.registration_store,
            login_store: &self.login_store,
            recovery_store: &self.recovery_store,
            storage: &self.storage,
            server_max: &self.server_max,
            publisher: &self.publisher,
        }
    }
}

#[derive(Debug, Default)]
pub struct CleanupReport {
    pub rows_deleted: u64,
    pub notes: Vec<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum CleanupError {
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("job failed: {0}")]
    JobFailed(String),
}

pub struct Scheduler {
    interval: Duration,
    jobs: Vec<Box<dyn CleanupJob>>,
}

impl Scheduler {
    pub fn new(interval: Duration) -> Self {
        Self {
            interval,
            jobs: Vec::new(),
        }
    }

    pub fn register(&mut self, job: Box<dyn CleanupJob>) {
        self.jobs.push(job);
    }

    pub async fn run(
        self,
        ctx: CleanupContextOwned,
        mut shutdown: tokio::sync::watch::Receiver<bool>,
    ) {
        let startup_delay = Duration::from_secs(ctx.config.cleanup_startup_delay_secs);
        if wait_for_shutdown(&mut shutdown, startup_delay).await {
            tracing::info!("cleanup: scheduler shutdown");
            return;
        }

        loop {
            for job in &self.jobs {
                let name = job.name();
                let span = tracing::info_span!("cleanup", job = name);
                let _enter = span.enter();
                let start = Instant::now();
                match job.run(&ctx.as_ctx()).await {
                    Ok(report) => {
                        let duration_ms = start.elapsed().as_millis();
                        tracing::info!(
                            "cleanup: job={} status=ok rows_deleted={} duration_ms={}",
                            name,
                            report.rows_deleted,
                            duration_ms
                        );
                        for note in &report.notes {
                            tracing::info!("cleanup: job={} note={}", name, note);
                        }
                    }
                    Err(err) => {
                        tracing::error!("cleanup: job={} status=failed error={}", name, err);
                    }
                }
            }

            if wait_for_shutdown(&mut shutdown, self.interval).await {
                tracing::info!("cleanup: scheduler shutdown");
                return;
            }
        }
    }
}

async fn wait_for_shutdown(
    shutdown: &mut tokio::sync::watch::Receiver<bool>,
    duration: Duration,
) -> bool {
    if *shutdown.borrow() {
        return true;
    }
    if duration.is_zero() {
        return false;
    }
    tokio::select! {
        _ = tokio::time::sleep(duration) => false,
        res = shutdown.wait_for(|&s| s) => res.is_ok(),
    }
}

pub mod attachments;
pub mod audit;
pub mod bot_commands;
pub mod bot_request_log;
pub mod memory;
pub mod oprf_audit;
pub mod pending_removes;
pub mod rate_limits;
pub mod sessions;
pub mod sync;
pub mod welcomes;
