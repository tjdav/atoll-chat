use super::{CleanupContext, CleanupError, CleanupJob, CleanupReport};
use async_trait::async_trait;

pub struct SessionsJob;

#[async_trait]
impl CleanupJob for SessionsJob {
    fn name(&self) -> &'static str {
        "sessions"
    }

    async fn run(&self, ctx: &CleanupContext<'_>) -> Result<CleanupReport, CleanupError> {
        let res = sqlx::query(
            r#"
            DELETE FROM sessions
            WHERE (expires_at < datetime('now', '-30 days'))
               OR (revoked_at IS NOT NULL AND revoked_at < datetime('now', '-30 days'))
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
