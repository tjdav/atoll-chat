use super::{CleanupContext, CleanupError, CleanupJob, CleanupReport};
use async_trait::async_trait;

pub struct RateLimitsJob;

#[async_trait]
impl CleanupJob for RateLimitsJob {
    fn name(&self) -> &'static str {
        "rate_limits"
    }

    async fn run(&self, ctx: &CleanupContext<'_>) -> Result<CleanupReport, CleanupError> {
        let res = sqlx::query(
            r#"
            DELETE FROM rate_limits
            WHERE window_start < datetime('now', '-24 hours')
            "#,
        )
        .execute(ctx.pool)
        .await?;

        Ok(CleanupReport {
            rows_deleted: res.rows_affected(),
            notes: Vec::new(),
        })
    }
}
