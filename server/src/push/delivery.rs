use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use futures::stream::{self, StreamExt};
use sqlx::SqlitePool;
use tracing::{info, warn};

use crate::config::Config;
use crate::identity::token::sender_ref_from_username_token;
use crate::push::apns::ApnsSender;
use crate::push::fcm::FcmSender;
use crate::push::payload::build_message_payload;
use crate::push::sender::{platform, PushSender, SendError, WebPushSender};
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
    pub async fn new(
        pool: SqlitePool,
        config: &Config,
        vapid_keys: Arc<VapidKeys>,
    ) -> Result<Self, PushError> {
        let mut senders: HashMap<&'static str, Arc<dyn PushSender>> = HashMap::new();

        let web_sender = Arc::new(WebPushSender::new(config, vapid_keys)?);
        senders.insert(platform::WEB, web_sender.clone());
        senders.insert(platform::DESKTOP, web_sender);

        // APNs
        if let Some(apns) = ApnsSender::new(config)? {
            senders.insert(platform::IOS, Arc::new(apns));
            info!("push: APNs sender registered");
        } else {
            let partial = config.push_apns_key.is_some()
                || config.push_apns_key_id.is_some()
                || config.push_apns_team_id.is_some()
                || config.push_apns_bundle_id.is_some();
            if partial {
                warn!("push: APNs sender not registered (partial configuration)");
            }
        }

        // FCM
        if let Some(fcm) = FcmSender::new(config).await? {
            senders.insert(platform::ANDROID, Arc::new(fcm));
            info!("push: FCM sender registered");
        } else if config.push_fcm_service_account_json.is_some() {
            warn!("push: FCM sender not registered (partial configuration)");
        }

        Ok(Self {
            pool,
            senders,
            suppression_window_secs: config.push_suppression_window_secs,
            timeout_secs: config.push_delivery_timeout_secs,
            max_concurrent: config.push_max_concurrent_deliveries,
        })
    }

    pub fn has_sender(&self, platform_name: &str) -> bool {
        self.senders.contains_key(platform_name)
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

        let sender_token: Option<String> =
            sqlx::query_scalar("SELECT username_token FROM users WHERE id = ?")
                .bind(sender_user_id)
                .fetch_optional(&self.pool)
                .await
                .unwrap_or(None);

        let sender_ref = match sender_token {
            Some(ref token) => match sender_ref_from_username_token(token) {
                Ok(s_ref) => s_ref,
                Err(e) => {
                    warn!(error = %e, "push: invalid sender username_token, falling back");
                    "AAAAAAAAAAAAAAAAAAAAAA".to_string()
                }
            },
            None => {
                warn!("push: sender user not found for token lookup, falling back");
                "AAAAAAAAAAAAAAAAAAAAAA".to_string()
            }
        };

        let payload = build_message_payload(room_id, &sender_ref);

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
