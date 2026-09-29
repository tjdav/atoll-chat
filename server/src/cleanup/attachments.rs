use super::{CleanupContext, CleanupError, CleanupJob, CleanupReport};
use crate::attachments;
use crate::limits;
use async_trait::async_trait;

pub struct AttachmentsJob;

#[async_trait]
impl CleanupJob for AttachmentsJob {
    fn name(&self) -> &'static str {
        "attachments"
    }

    async fn run(&self, ctx: &CleanupContext<'_>) -> Result<CleanupReport, CleanupError> {
        let limits = limits::get_limits(ctx.pool, ctx.server_max)
            .await
            .map_err(|e| CleanupError::JobFailed(format!("get_limits: {}", e)))?;

        let report =
            attachments::prune_expired(ctx.pool, ctx.storage.as_ref(), &limits, ctx.server_max)
                .await
                .map_err(|e| CleanupError::JobFailed(format!("prune_expired: {}", e)))?;

        let mut notes = Vec::new();
        if report.blob_errors > 0 {
            notes.push(format!(
                "{} blob deletion errors (orphaned blobs)",
                report.blob_errors
            ));
        }

        Ok(CleanupReport {
            rows_deleted: report.attachments_deleted,
            notes,
        })
    }
}
