use super::{CleanupContext, CleanupError, CleanupJob, CleanupReport};
use async_trait::async_trait;

pub struct BotCommandsTtlJob;

#[async_trait]
impl CleanupJob for BotCommandsTtlJob {
    fn name(&self) -> &'static str {
        "bot_commands_ttl"
    }

    async fn run(&self, ctx: &CleanupContext<'_>) -> Result<CleanupReport, CleanupError> {
        let ttl_hours = ctx.config.bot_command_ttl_hours;
        let modifier = format!("-{} hours", ttl_hours);

        let res = sqlx::query(
            r#"
            UPDATE bot_commands
            SET expired_at = CURRENT_TIMESTAMP
            WHERE acked_at IS NULL AND expired_at IS NULL AND created_at < datetime('now', ?)
            "#,
        )
        .bind(&modifier)
        .execute(ctx.pool)
        .await?;

        Ok(CleanupReport {
            rows_deleted: res.rows_affected(),
            notes: Vec::new(),
        })
    }
}
