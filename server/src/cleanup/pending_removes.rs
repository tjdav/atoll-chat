use crate::cleanup::{CleanupContext, CleanupError, CleanupJob, CleanupReport};
use async_trait::async_trait;
use chrono::{DateTime, Utc};

pub struct PendingRemovesJob;

#[async_trait]
impl CleanupJob for PendingRemovesJob {
    fn name(&self) -> &'static str {
        "pending_mls_removes"
    }

    async fn run(&self, ctx: &CleanupContext<'_>) -> Result<CleanupReport, CleanupError> {
        let timeout_days = ctx.config.pending_mls_remove_timeout_days;

        #[derive(sqlx::FromRow)]
        struct StaleRemoveRow {
            id: String,
            room_id: String,
            target_user_id: Option<String>,
            target_bot_id: Option<String>,
            queued_at: DateTime<Utc>,
        }

        // Step 1: Mark stale rows and publish mls.remove_stale once per row
        let rows: Vec<StaleRemoveRow> = sqlx::query_as(
            r#"
            SELECT id, room_id, target_user_id, target_bot_id, queued_at
            FROM pending_mls_removes
            WHERE stale_at IS NULL
              AND remove_confirmed_at IS NULL
              AND cancelled_at IS NULL
              AND queued_at < datetime('now', '-' || ? || ' days')
            "#,
        )
        .bind(timeout_days as i64)
        .fetch_all(ctx.pool)
        .await?;

        let mut marked_stale_count = 0u64;

        for row in rows {
            let id = row.id;
            let room_id = row.room_id;
            let target_user_id = row.target_user_id;
            let target_bot_id = row.target_bot_id;
            let queued_at = row.queued_at;
            let mut tx = ctx.pool.begin().await?;
            let now = Utc::now();

            let res = sqlx::query(
                "UPDATE pending_mls_removes SET stale_at = ? WHERE id = ? AND stale_at IS NULL",
            )
            .bind(now)
            .bind(&id)
            .execute(&mut *tx)
            .await?;

            if res.rows_affected() > 0 {
                tx.commit().await?;
                marked_stale_count += 1;

                let payload = serde_json::json!({
                    "room_id": room_id,
                    "target_user_id": target_user_id,
                    "target_bot_id": target_bot_id,
                    "queued_at": queued_at.to_rfc3339(),
                    "stale_since": now.to_rfc3339(),
                });
                let channel = format!("private-room-{}", room_id);
                if let Err(e) = ctx
                    .publisher
                    .publish(&channel, "mls.remove_stale", payload)
                    .await
                {
                    tracing::warn!(error = %e, room_id = %room_id, remove_id = %id, "mls.remove_stale publish failed");
                }
            }
        }

        // Step 2: Consumed and cancelled tombstone pruning (30 days after consumed_at or cancelled_at)
        let res_consumed = sqlx::query(
            "DELETE FROM pending_mls_removes WHERE consumed_at IS NOT NULL AND consumed_at < datetime('now', '-30 days')",
        )
        .execute(ctx.pool)
        .await?;

        let res_cancelled = sqlx::query(
            "DELETE FROM pending_mls_removes WHERE cancelled_at IS NOT NULL AND cancelled_at < datetime('now', '-30 days')",
        )
        .execute(ctx.pool)
        .await?;

        let rows_deleted = res_consumed.rows_affected() + res_cancelled.rows_affected();
        let mut notes = Vec::new();
        if marked_stale_count > 0 {
            notes.push(format!("rows_marked_stale={}", marked_stale_count));
        }

        Ok(CleanupReport {
            rows_deleted,
            notes,
        })
    }
}
