use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use futures::stream::{self, StreamExt};
use sqlx::SqlitePool;
use tracing::{info, warn};

use crate::config::Config;
use crate::push::payload::build_message_payload;
use crate::push::sender::{PushSender, SendError, WebPushSender};
use crate::push::subscriptions::PushSubscription;
use crate::push::suppression::should_suppress;
use crate::push::vapid::{PushError, VapidKeys};

pub struct DeliveryCoordinator {
    pool: SqlitePool,
    senders: HashMap<&'static str, Arc<dyn PushSender>>,
    suppression_window_secs: u64,
    timeout_secs: u64,
    max_concurrent: usize,
}

impl DeliveryCoordinator {
    pub fn new(
        pool: SqlitePool,
        config: &Config,
        vapid_keys: Arc<VapidKeys>,
    ) -> Result<Self, PushError> {
        let mut senders: HashMap<&'static str, Arc<dyn PushSender>> = HashMap::new();

        let web_sender = WebPushSender::new(config, vapid_keys)?;
        senders.insert("web", Arc::new(web_sender));

        Ok(Self {
            pool,
            senders,
            suppression_window_secs: config.push_suppression_window_secs,
            timeout_secs: config.push_delivery_timeout_secs,
            max_concurrent: config.push_max_concurrent_deliveries,
        })
    }

    /// Dispatches notifications to all eligible subscribers in a room.
    /// Returns when all dispatch attempts have completed or timed out.
    pub async fn dispatch_message_notification(&self, room_id: &str, sender_user_id: &str) {
        let members: Vec<String> = match sqlx::query_scalar(
            "SELECT user_id FROM room_members WHERE room_id = ? AND user_id != ?",
        )
        .bind(room_id)
        .bind(sender_user_id)
        .fetch_all(&self.pool)
        .await
        {
            Ok(m) => m,
            Err(e) => {
                warn!(error = %e, room_id = %room_id, "push: failed to fetch room members");
                return;
            }
        };

        if members.is_empty() {
            info!(
                room_id = %room_id,
                members = 0,
                eligible = 0,
                delivered = 0,
                suppressed = 0,
                gone = 0,
                failed = 0,
                "push dispatch"
            );
            return;
        }

        // Fetch subscriptions for members in chunks of 500
        let mut all_subscriptions: Vec<PushSubscription> = Vec::new();
        for chunk in members.chunks(500) {
            let mut query_builder = sqlx::QueryBuilder::new(
                r#"
                SELECT ps.id, ps.user_id, ps.device_id, ps.platform, ps.browser_id,
                       ps.endpoint, ps.p256dh, ps.auth, ps.push_token, ps.user_agent,
                       ps.created_at, ps.last_used_at, ps.revoked_at
                FROM push_subscriptions ps
                WHERE ps.revoked_at IS NULL AND ps.user_id IN (
                "#,
            );

            let mut separated = query_builder.separated(", ");
            for uid in chunk {
                separated.push_bind(uid);
            }
            separated.push_unseparated(")");

            let query = query_builder.build_query_as::<PushSubscription>();
            match query.fetch_all(&self.pool).await {
                Ok(mut subs) => all_subscriptions.append(&mut subs),
                Err(e) => {
                    warn!(error = %e, room_id = %room_id, "push: failed to fetch subscriptions");
                }
            }
        }

        let payload = build_message_payload(room_id, sender_user_id);

        let mut eligible_subscriptions: Vec<PushSubscription> = Vec::new();
        let mut suppressed = 0usize;

        for sub in all_subscriptions {
            if !self.senders.contains_key(sub.platform.as_str()) {
                continue;
            }

            match should_suppress(
                &self.pool,
                &sub.user_id,
                sub.device_id.as_deref(),
                self.suppression_window_secs,
            )
            .await
            {
                Ok(true) => suppressed += 1,
                Ok(false) => eligible_subscriptions.push(sub),
                Err(e) => {
                    warn!(error = %e, user_id = %sub.user_id, "push: suppression check failed");
                    eligible_subscriptions.push(sub);
                }
            }
        }

        let num_members = members.len();
        let num_eligible = eligible_subscriptions.len();

        let mut delivered = 0usize;
        let mut gone = 0usize;
        let mut failed = 0usize;

        let timeout_duration = Duration::from_secs(self.timeout_secs);

        let stream = stream::iter(eligible_subscriptions).map(|sub| {
            let payload_ref = payload.clone();
            async move {
                let sender = self.senders.get(sub.platform.as_str()).cloned();
                let res = if let Some(sender) = sender {
                    tokio::time::timeout(timeout_duration, sender.send(&sub, &payload_ref)).await
                } else {
                    Ok(Err(SendError::Permanent("sender not found".to_string())))
                };
                (sub, res)
            }
        });

        let mut buffered = stream.buffer_unordered(self.max_concurrent);

        while let Some((sub, outcome)) = buffered.next().await {
            match outcome {
                Ok(Ok(())) => {
                    delivered += 1;
                    let _ = sqlx::query(
                        "UPDATE push_subscriptions SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?",
                    )
                    .bind(&sub.id)
                    .execute(&self.pool)
                    .await;
                }
                Ok(Err(SendError::Gone(reason))) => {
                    gone += 1;
                    info!(
                        id = %sub.id,
                        platform = %sub.platform,
                        reason = %reason,
                        "push: removed expired subscription"
                    );
                    let _ = sqlx::query("DELETE FROM push_subscriptions WHERE id = ?")
                        .bind(&sub.id)
                        .execute(&self.pool)
                        .await;
                }
                Ok(Err(SendError::Transient(reason))) => {
                    failed += 1;
                    warn!(
                        id = %sub.id,
                        platform = %sub.platform,
                        reason = %reason,
                        "push: transient delivery failure"
                    );
                }
                Ok(Err(SendError::Permanent(reason))) => {
                    failed += 1;
                    warn!(
                        id = %sub.id,
                        platform = %sub.platform,
                        reason = %reason,
                        "push: permanent delivery failure"
                    );
                }
                Err(_timeout) => {
                    failed += 1;
                    warn!(
                        id = %sub.id,
                        platform = %sub.platform,
                        "push: delivery timed out"
                    );
                }
            }
        }

        info!(
            room_id = %room_id,
            members = num_members,
            eligible = num_eligible,
            delivered = delivered,
            suppressed = suppressed,
            gone = gone,
            failed = failed,
            "push dispatch"
        );
    }
}
