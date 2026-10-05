use super::{CleanupContext, CleanupError, CleanupJob, CleanupReport};
use async_trait::async_trait;

pub struct SyncPruningJob;

#[async_trait]
impl CleanupJob for SyncPruningJob {
    fn name(&self) -> &'static str {
        "sync_pruning"
    }

    async fn run(&self, ctx: &CleanupContext<'_>) -> Result<CleanupReport, CleanupError> {
        let retention_days = if ctx.config.sync_event_retention_days == 0 {
            90
        } else {
            ctx.config.sync_event_retention_days
        };
        let cutoff_sql = format!("-{} days", retention_days);

        // 1. Prune tombstones in read_state
        let res_read_state = sqlx::query(
            "DELETE FROM read_state WHERE deleted_at IS NOT NULL AND deleted_at < datetime('now', ?)",
        )
        .bind(&cutoff_sql)
        .execute(ctx.pool)
        .await?;

        // 2. Prune tombstones in device_names
        let res_device_names = sqlx::query(
            "DELETE FROM device_names WHERE deleted_at IS NOT NULL AND deleted_at < datetime('now', ?)",
        )
        .bind(&cutoff_sql)
        .execute(ctx.pool)
        .await?;

        // 3. Prune tombstones in starred_items
        let res_starred_items = sqlx::query(
            "DELETE FROM starred_items WHERE deleted_at IS NOT NULL AND deleted_at < datetime('now', ?)",
        )
        .bind(&cutoff_sql)
        .execute(ctx.pool)
        .await?;

        let total_deleted = res_read_state.rows_affected()
            + res_device_names.rows_affected()
            + res_starred_items.rows_affected();

        Ok(CleanupReport {
            rows_deleted: total_deleted,
            notes: vec![format!(
                "pruned tombstones older than {} days (read_state={}, device_names={}, starred_items={})",
                retention_days,
                res_read_state.rows_affected(),
                res_device_names.rows_affected(),
                res_starred_items.rows_affected()
            )],
        })
    }
}
