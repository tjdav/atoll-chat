use crate::config::Config;
use crate::sessions::occupancy::OccupancyStore;
use crate::sockudo::Publisher;
use std::sync::Arc;
use tokio::time::{sleep, Duration};

pub async fn run_occupancy_cleanup_job(
    store: OccupancyStore,
    config: Arc<Config>,
    publisher: Arc<Publisher>,
) {
    let interval_secs = std::cmp::max(config.session_heartbeat_timeout_seconds / 3, 1);
    let interval = Duration::from_secs(interval_secs);

    loop {
        sleep(interval).await;
        store.cleanup_stale_participants(&publisher, &config).await;
    }
}
