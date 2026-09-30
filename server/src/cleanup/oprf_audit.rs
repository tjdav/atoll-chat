use crate::cleanup::{CleanupContext, CleanupError, CleanupJob, CleanupReport};
use crate::oprf::audit::OprfAuditCounter;
use async_trait::async_trait;
use std::sync::Arc;

pub struct OprfAuditFlushJob {
    pub oprf_audit: Arc<OprfAuditCounter>,
}

#[async_trait]
impl CleanupJob for OprfAuditFlushJob {
    fn name(&self) -> &'static str {
        "oprf_audit"
    }

    async fn run(&self, ctx: &CleanupContext<'_>) -> Result<CleanupReport, CleanupError> {
        self.oprf_audit
            .maybe_flush(ctx.pool)
            .await
            .map_err(|e| CleanupError::JobFailed(e.to_string()))?;
        Ok(CleanupReport::default())
    }
}
