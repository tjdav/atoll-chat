use super::{CleanupContext, CleanupError, CleanupJob, CleanupReport};
use async_trait::async_trait;

pub struct WelcomesJob;

#[async_trait]
impl CleanupJob for WelcomesJob {
    fn name(&self) -> &'static str {
        "welcomes"
    }

    async fn run(&self, ctx: &CleanupContext<'_>) -> Result<CleanupReport, CleanupError> {
        let res = sqlx::query(
            r#"
            DELETE FROM welcomes
            WHERE created_at < datetime('now', '-7 days')
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
