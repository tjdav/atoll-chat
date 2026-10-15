use super::{CleanupContext, CleanupError, CleanupJob, CleanupReport};
use async_trait::async_trait;
use chrono::Utc;
use serde_json::json;

pub struct OperatorQueueTimeoutJob;

#[derive(sqlx::FromRow)]
struct PendingExpiredRow {
    id: String,
    bot_id: String,
    room_id: Option<String>,
    audience: String,
    on_timeout: String,
    canned_response: Option<String>,
}

#[async_trait]
impl CleanupJob for OperatorQueueTimeoutJob {
    fn name(&self) -> &'static str {
        "operator_queue_timeout"
    }

    async fn run(&self, ctx: &CleanupContext<'_>) -> Result<CleanupReport, CleanupError> {
        let pending_expired_rows: Vec<PendingExpiredRow> = sqlx::query_as(
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

        let mut rows_expired = 0u64;
        let mut rows_published = 0u64;

        for row in pending_expired_rows {
            let mut tx = match ctx.pool.begin().await {
                Ok(t) => t,
                Err(e) => return Err(CleanupError::Database(e)),
            };

            let res = sqlx::query(
                r#"
                UPDATE bot_operator_queue
                SET status = 'expired',
                    answered_at = CURRENT_TIMESTAMP
                WHERE id = ? AND status = 'pending'
                "#,
            )
            .bind(&row.id)
            .execute(&mut *tx)
            .await?;

            if res.rows_affected() == 0 {
                // Concurrent respond won the race; skip and do not publish
                let _ = tx.rollback().await;
                continue;
            }

            rows_expired += 1;

            let publish_payload = if row.on_timeout == "canned" {
                match &row.canned_response {
                    Some(canned) => {
                        let answered_at =
                            Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
                        let event_body = json!({
                            "request_id": row.id,
                            "response": canned,
                            "routing": row.audience,
                            "room_id": row.room_id,
                            "responded_by": null,
                            "responded_at": answered_at,
                        });

                        match crate::bots::prepare_durable_bot_event(
                            &mut tx,
                            &row.bot_id,
                            "bot.operator_response",
                            event_body,
                        )
                        .await
                        {
                            Ok((_seq, final_payload)) => Some(final_payload),
                            Err(e) => return Err(CleanupError::Database(e)),
                        }
                    }
                    None => {
                        tracing::warn!(
                            "operator queue entry on_timeout='canned' has NULL canned_response id={} bot_id={}",
                            row.id,
                            row.bot_id
                        );
                        None
                    }
                }
            } else {
                None
            };

            if let Err(e) = tx.commit().await {
                return Err(CleanupError::Database(e));
            }

            if let Some(payload) = publish_payload {
                let _ = ctx
                    .publisher
                    .publish(
                        &format!("private-bot-{}", row.bot_id),
                        "bot.operator_response",
                        payload,
                    )
                    .await;
                rows_published += 1;
            }
        }

        tracing::info!(
            "operator queue timeout job finished rows_expired={} rows_published={}",
            rows_expired,
            rows_published
        );

        Ok(CleanupReport {
            rows_deleted: rows_expired,
            notes: vec![format!("rows_published={}", rows_published)],
        })
    }
}
