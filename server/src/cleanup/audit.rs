use super::{CleanupContext, CleanupError, CleanupJob, CleanupReport};
use async_trait::async_trait;

pub struct AuditJob;

#[async_trait]
impl CleanupJob for AuditJob {
    fn name(&self) -> &'static str {
        "audit"
    }

    async fn run(&self, ctx: &CleanupContext<'_>) -> Result<CleanupReport, CleanupError> {
        let retention = ctx.config.audit_retention_days;
        if retention == 0 {
            return Ok(CleanupReport {
                rows_deleted: 0,
                notes: vec!["skipped: retention is 0".to_string()],
            });
        }

        let modifier = format!("-{} days", retention);
        let res = sqlx::query(
            r#"
            DELETE FROM audit_log
            WHERE created_at < datetime('now', ?)
            "#,
        )
        .bind(modifier)
        .execute(ctx.pool)
        .await?;

        Ok(CleanupReport {
            rows_deleted: res.rows_affected(),
            notes: Vec::new(),
        })
    }
}
