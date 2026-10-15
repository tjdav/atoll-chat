use super::{CleanupContext, CleanupError, CleanupJob, CleanupReport};
use async_trait::async_trait;

pub const OPERATOR_QUEUE_RETENTION_DAYS: u64 = 7;

pub struct OperatorQueueRetentionJob;

#[async_trait]
impl CleanupJob for OperatorQueueRetentionJob {
    fn name(&self) -> &'static str {
        "operator_queue_retention"
    }

    async fn run(&self, ctx: &CleanupContext<'_>) -> Result<CleanupReport, CleanupError> {
        let modifier = format!("-{} days", OPERATOR_QUEUE_RETENTION_DAYS);

        let res = sqlx::query(
            r#"
            DELETE FROM bot_operator_queue
            WHERE status IN ('answered', 'expired')
              AND answered_at < datetime('now', ?)
            "#,
        )
        .bind(&modifier)
        .execute(ctx.pool)
        .await?;

        let rows_pruned = res.rows_affected();

        tracing::info!(
            "operator queue retention job finished rows_pruned={}",
            rows_pruned
        );

        Ok(CleanupReport {
            rows_deleted: rows_pruned,
            notes: Vec::new(),
        })
    }
}
