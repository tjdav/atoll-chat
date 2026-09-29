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

        let web_sender = Arc::new(WebPushSender::new(config, vapid_keys)?);
        senders.insert("web", web_sender);

        Ok(Self {
            pool,
            senders,
            suppression_window_secs: config.push_suppression_window_secs,
            timeout_secs: config.push_delivery_timeout_secs,
            max_concurrent: config.push_max_concurrent_deliveries,
        })
    }

    pub fn with_senders(
        pool: SqlitePool,
        senders: HashMap<&'static str, Arc<dyn PushSender>>,
        suppression_window_secs: u64,
        timeout_secs: u64,
        max_concurrent: usize,
    ) -> Self {
        Self {
            pool,
            senders,
            suppression_window_secs,
            timeout_secs,
            max_concurrent,
        }
    }

    /// Dispatches notifications to all eligible subscribers in a room.
    /// Returns when all dispatch attempts have completed or timed out.
    pub async fn dispatch_message_notification(&self, room_id: &str, sender_user_id: &str) {
        // 1. Fetch room members excluding the sender
        let member_ids: Vec<String> = match sqlx::query_scalar(
            "SELECT user_id FROM room_members WHERE room_id = ? AND user_id != ?",
        )
        .bind(room_id)
        .bind(sender_user_id)
        .fetch_all(&self.pool)
        .await
        {
            Ok(ids) => ids,
            Err(e) => {
                warn!(error = %e, room_id = %room_id, "push: failed to fetch room members");
                return;
            }
        };

        let members_count = member_ids.len();
        if members_count == 0 {
            info!(
                "push dispatch room_id={} members=0 eligible=0 delivered=0 suppressed=0 gone=0 failed=0",
                room_id
            );
            return;
        }

        // 2. Fetch active push subscriptions for members in chunks of 500
        let mut all_subscriptions = Vec::new();
        for chunk in member_ids.chunks(500) {
            let mut query_builder = sqlx::QueryBuilder::new(
                "SELECT id, user_id, device_id, platform, browser_id, endpoint, p256dh, auth, push_token, user_agent, created_at, last_used_at, revoked_at FROM push_subscriptions WHERE revoked_at IS NULL AND user_id IN (",
            );
            let mut separated = query_builder.separated(", ");
            for id in chunk {
                separated.push_bind(id);
            }
            separated.push_unseparated(")");

            match query_builder
                .build_query_as::<PushSubscription>()
                .fetch_all(&self.pool)
                .await
            {
                Ok(subs) => all_subscriptions.extend(subs),
                Err(e) => {
                    warn!(error = %e, room_id = %room_id, "push: failed to fetch subscriptions");
                }
            }
        }

        // 3. Build payload once
        let payload = build_message_payload(room_id, sender_user_id);

        // 4. Filter subscriptions and check suppression
        let mut eligible_subscriptions = Vec::new();
        let mut suppressed_count = 0;

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
                Ok(true) => {
                    suppressed_count += 1;
                }
                Ok(false) => {
                    eligible_subscriptions.push(sub);
                }
                Err(e) => {
                    warn!(error = %e, sub_id = %sub.id, "push: suppression check error; sending notification");
                    eligible_subscriptions.push(sub);
                }
            }
        }

        let eligible_count = eligible_subscriptions.len();

        // 5. Dispatch concurrently
        let max_concurrent = if self.max_concurrent == 0 {
            1
        } else {
            self.max_concurrent
        };

        let attempts = stream::iter(eligible_subscriptions)
            .map(|sub| {
                let sender = self.senders.get(sub.platform.as_str()).cloned();
                let payload = payload.clone();
                let timeout_secs = self.timeout_secs;

                async move {
                    let sender = match sender {
                        Some(s) => s,
                        None => {
                            return (
                                sub,
                                Err(SendError::Permanent("no sender for platform".to_string())),
                            )
                        }
                    };

                    let res = tokio::time::timeout(
                        Duration::from_secs(timeout_secs),
                        sender.send(&sub, &payload),
                    )
                    .await;

                    let result = match res {
                        Ok(inner) => inner,
                        Err(_) => Err(SendError::Transient("delivery timed out".to_string())),
                    };

                    (sub, result)
                }
            })
            .buffer_unordered(max_concurrent);

        let results: Vec<(PushSubscription, Result<(), SendError>)> = attempts.collect().await;

        // 6. Process results
        let mut delivered_count = 0;
        let mut gone_count = 0;
        let mut failed_count = 0;

        for (sub, res) in results {
            match res {
                Ok(()) => {
                    let _ = sqlx::query(
                        "UPDATE push_subscriptions SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?",
                    )
                    .bind(&sub.id)
                    .execute(&self.pool)
                    .await;

                    delivered_count += 1;
                }
                Err(SendError::Gone(reason)) => {
                    let _ = sqlx::query("DELETE FROM push_subscriptions WHERE id = ?")
                        .bind(&sub.id)
                        .execute(&self.pool)
                        .await;

                    info!(
                        "push: removed expired subscription id={} platform={} reason={}",
                        sub.id, sub.platform, reason
                    );
                    gone_count += 1;
                }
                Err(SendError::Transient(reason)) => {
                    warn!(
                        "push: transient failure for subscription id={} platform={}: {}",
                        sub.id, sub.platform, reason
                    );
                    failed_count += 1;
                }
                Err(SendError::Permanent(reason)) => {
                    warn!(
                        "push: permanent failure for subscription id={} platform={}: {}",
                        sub.id, sub.platform, reason
                    );
                    failed_count += 1;
                }
            }
        }

        // 7. Emit single summary log line
        info!(
            "push dispatch room_id={} members={} eligible={} delivered={} suppressed={} gone={} failed={}",
            room_id, members_count, eligible_count, delivered_count, suppressed_count, gone_count, failed_count
        );
    }
}
