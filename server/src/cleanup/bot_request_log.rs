use super::{CleanupContext, CleanupError, CleanupJob, CleanupReport};
use async_trait::async_trait;

pub const BOT_REQUEST_LOG_TTL_HOURS: i64 = 24;

pub struct BotRequestLogTtlJob;

#[async_trait]
impl CleanupJob for BotRequestLogTtlJob {
    fn name(&self) -> &'static str {
        "bot_request_log_ttl"
    }

    async fn run(&self, ctx: &CleanupContext<'_>) -> Result<CleanupReport, CleanupError> {
        let modifier = format!("-{} hours", BOT_REQUEST_LOG_TTL_HOURS);

        let res = sqlx::query("DELETE FROM bot_request_log WHERE created_at < datetime('now', ?)")
            .bind(&modifier)
            .execute(ctx.pool)
            .await?;

        Ok(CleanupReport {
            rows_deleted: res.rows_affected(),
            notes: Vec::new(),
        })
    }
}
