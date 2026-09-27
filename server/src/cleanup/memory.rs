use super::{CleanupContext, CleanupError, CleanupJob, CleanupReport};
use async_trait::async_trait;
use std::time::Duration;

pub struct MemoryStoresJob;

#[async_trait]
impl CleanupJob for MemoryStoresJob {
    fn name(&self) -> &'static str {
        "memory_stores"
    }

    async fn run(&self, ctx: &CleanupContext<'_>) -> Result<CleanupReport, CleanupError> {
        let reg_deleted = ctx
            .registration_store
            .purge_expired(Duration::from_secs(300));
        let login_deleted = ctx.login_store.purge_expired(Duration::from_secs(300));
        let total = (reg_deleted + login_deleted) as u64;

        Ok(CleanupReport {
            rows_deleted: total,
            notes: Vec::new(),
        })
    }
}
