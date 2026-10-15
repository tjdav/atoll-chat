use super::{CleanupContext, CleanupError, CleanupJob, CleanupReport};
use crate::bots::prepare_durable_bot_event;
use async_trait::async_trait;
use sqlx::Row;

pub const OPERATOR_QUEUE_RETENTION_DAYS: i64 = 7;

pub struct OperatorQueueTimeoutJob;

#[async_trait]
impl CleanupJob for OperatorQueueTimeoutJob {
    fn name(&self) -> &'static str {
        "operator_queue_timeout"
    }

    async fn run(&self, ctx: &CleanupContext<'_>) -> Result<CleanupReport, CleanupError> {
        let expired_rows = sqlx::query(
            r#"
            SELECT id, bot_id, room_id, audience, on_timeout, canned_response
            FROM bot_operator_queue
            WHERE status = 'pending'
              AND timeout_at IS NOT NULL
              AND timeout_at < CURRENT_TIMESTAMP
            "#,
        )
        .fetch_all(ctx.pool)
        .await?;

        let mut rows_expired: u64 = 0;
        let mut rows_published: u64 = 0;

        for row in expired_rows {
            let id: String = row.get("id");
            let bot_id: String = row.get("bot_id");
            let room_id: Option<String> = row.get("room_id");
            let audience: String = row.get("audience");
            let on_timeout: String = row.get("on_timeout");
            let canned_response: Option<String> = row.get("canned_response");

            let mut tx = ctx.pool.begin().await?;

            let res = sqlx::query(
                r#"
                UPDATE bot_operator_queue
                SET status = 'expired',
                    answered_at = CURRENT_TIMESTAMP
                WHERE id = ? AND status = 'pending'
                "#,
            )
            .bind(&id)
            .execute(&mut *tx)
            .await?;

            if res.rows_affected() == 0 {
                let _ = tx.rollback().await;
                continue;
            }

            rows_expired += 1;

            if on_timeout == "canned" {
                match canned_response {
                    Some(canned) => {
                        let answered_at: String = sqlx::query_scalar(
                            "SELECT CAST(answered_at AS TEXT) FROM bot_operator_queue WHERE id = ?",
                        )
                        .bind(&id)
                        .fetch_one(&mut *tx)
                        .await?;

                        let event_payload = serde_json::json!({
                            "request_id": id,
                            "response": canned,
                            "routing": audience,
                            "room_id": room_id,
                            "responded_by": serde_json::Value::Null,
                            "responded_at": answered_at,
                        });

                        let (_seq, pub_payload) = prepare_durable_bot_event(
                            &mut tx,
                            &bot_id,
                            "bot.operator_response",
                            event_payload,
                        )
                        .await?;

                        tx.commit().await?;

                        let channel = format!("private-bot-{}", bot_id);
                        let _ = ctx
                            .publisher
                            .publish(&channel, "bot.operator_response", pub_payload)
                            .await;

                        rows_published += 1;
                    }
                    None => {
                        tracing::warn!(
                            "canned_response is NULL for expired operator queue entry id={} bot_id={}",
                            id,
                            bot_id
                        );
                        tx.commit().await?;
                    }
                }
            } else {
                tx.commit().await?;
            }
        }

        tracing::info!(
            rows_expired = rows_expired,
            rows_published = rows_published,
            "operator queue timeout completed"
        );

        Ok(CleanupReport {
            rows_deleted: rows_expired,
            notes: vec![format!(
                "rows_expired={} rows_published={}",
                rows_expired, rows_published
            )],
        })
    }
}

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

        let pruned = res.rows_affected();
        tracing::info!(
            rows_pruned = pruned,
            "operator queue retention pruning completed"
        );

        Ok(CleanupReport {
            rows_deleted: pruned,
            notes: Vec::new(),
        })
    }
}
