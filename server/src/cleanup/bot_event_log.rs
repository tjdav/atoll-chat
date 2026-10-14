use super::{CleanupContext, CleanupError, CleanupJob, CleanupReport};
use async_trait::async_trait;

pub const BOT_EVENT_LOG_RETENTION_HOURS: i64 = 24;

pub struct BotEventLogTtlJob;

#[async_trait]
impl CleanupJob for BotEventLogTtlJob {
    fn name(&self) -> &'static str {
        "bot_event_log_ttl"
    }

    async fn run(&self, ctx: &CleanupContext<'_>) -> Result<CleanupReport, CleanupError> {
        let modifier = format!("-{} hours", BOT_EVENT_LOG_RETENTION_HOURS);

        let res = sqlx::query("DELETE FROM bot_event_log WHERE created_at < datetime('now', ?)")
            .bind(&modifier)
            .execute(ctx.pool)
            .await?;

        Ok(CleanupReport {
            rows_deleted: res.rows_affected(),
            notes: Vec::new(),
        })
    }
}
