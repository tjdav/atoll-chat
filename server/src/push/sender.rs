use std::sync::Arc;
use web_push::WebPushClient;

pub mod platform {
    pub const WEB: &str = "web";
    pub const DESKTOP: &str = "desktop";
    pub const IOS: &str = "ios";
    pub const ANDROID: &str = "android";
}

use crate::config::Config;
use crate::push::payload::NotificationPayload;
use crate::push::subscriptions::PushSubscription;
use crate::push::vapid::{PushError, VapidKeys};

#[derive(Debug, thiserror::Error)]
pub enum SendError {
    #[error("subscription is gone (410): {0}")]
    Gone(String),
    #[error("transient failure: {0}")]
    Transient(String),
    #[error("permanent failure: {0}")]
    Permanent(String),
}

#[async_trait::async_trait]
pub trait PushSender: Send + Sync {
    /// Platform this sender handles.
    fn platform(&self) -> &'static str;

    /// Deliver a payload to a single subscription.
    async fn send(
        &self,
        subscription: &PushSubscription,
        payload: &NotificationPayload,
    ) -> Result<(), SendError>;
}

pub struct WebPushSender {
    client: web_push::IsahcWebPushClient,
    vapid_keys: Arc<VapidKeys>,
    subject: String,
}

impl WebPushSender {
    pub fn new(config: &Config, vapid_keys: Arc<VapidKeys>) -> Result<Self, PushError> {
        let client = web_push::IsahcWebPushClient::new().map_err(|e| {
            PushError::InvalidConfig(format!("failed to build web_push client: {e}"))
        })?;

        let subject = if let Some(ref s) = config.push_vapid_subject {
            s.clone()
        } else if let Some(ref app_url) = config.app_url {
            if app_url.starts_with("https://") {
                app_url.clone()
            } else {
                format!(
                    "mailto:admin@{}",
                    config.app_name.to_lowercase().replace(' ', "")
                )
            }
        } else {
            format!(
                "mailto:admin@{}",
                config.app_name.to_lowercase().replace(' ', "")
            )
        };

        Ok(Self {
            client,
            vapid_keys,
            subject,
        })
    }
}

#[async_trait::async_trait]
impl PushSender for WebPushSender {
    fn platform(&self) -> &'static str {
        platform::WEB
    }

    async fn send(
        &self,
        subscription: &PushSubscription,
        payload: &NotificationPayload,
    ) -> Result<(), SendError> {
        let endpoint = subscription
            .endpoint
            .as_deref()
            .ok_or_else(|| SendError::Permanent("missing endpoint".to_string()))?;
        let p256dh = subscription
            .p256dh
            .as_deref()
            .ok_or_else(|| SendError::Permanent("missing p256dh".to_string()))?;
        let auth = subscription
            .auth
            .as_deref()
            .ok_or_else(|| SendError::Permanent("missing auth".to_string()))?;

        let sub_info = web_push::SubscriptionInfo {
            endpoint: endpoint.to_string(),
            keys: web_push::SubscriptionKeys {
                p256dh: p256dh.to_string(),
                auth: auth.to_string(),
            },
        };

        let mut builder = web_push::VapidSignatureBuilder::from_base64_no_sub(
            &self.vapid_keys.private_key,
            web_push::URL_SAFE_NO_PAD,
        )
        .map_err(|e| SendError::Permanent(format!("invalid VAPID key: {e}")))?
        .add_sub_info(&sub_info);

        builder.add_claim("sub", self.subject.as_str());

        let sig = builder
            .build()
            .map_err(|e| SendError::Permanent(format!("failed to build VAPID signature: {e}")))?;

        let payload_json = serde_json::to_vec(payload)
            .map_err(|e| SendError::Permanent(format!("payload serialization error: {e}")))?;

        let mut msg_builder = web_push::WebPushMessageBuilder::new(&sub_info);
        msg_builder.set_payload(web_push::ContentEncoding::Aes128Gcm, &payload_json);
        msg_builder.set_vapid_signature(sig);
        msg_builder.set_ttl(3600);
        msg_builder.set_urgency(web_push::Urgency::High);

        let msg = msg_builder
            .build()
            .map_err(|e| SendError::Permanent(format!("failed to build web push message: {e}")))?;

        match self.client.send(msg).await {
            Ok(()) => Ok(()),
            Err(web_push::WebPushError::EndpointNotValid) => {
                Err(SendError::Gone("endpoint not valid (410/404)".to_string()))
            }
            Err(web_push::WebPushError::EndpointNotFound) => {
                Err(SendError::Gone("endpoint not found (410)".to_string()))
            }
            Err(web_push::WebPushError::Unauthorized) => {
                Err(SendError::Permanent("unauthorized".to_string()))
            }
            Err(e) => {
                let msg_str = format!("{}", e);
                let debug_str = format!("{:?}", e);
                if msg_str.contains("410")
                    || msg_str.contains("404")
                    || debug_str.contains("410")
                    || debug_str.contains("404")
                    || debug_str.contains("Gone")
                    || debug_str.contains("NotFound")
                    || debug_str.contains("EndpointNotFound")
                    || debug_str.contains("EndpointNotValid")
                {
                    Err(SendError::Gone(msg_str))
                } else if msg_str.contains("401")
                    || debug_str.contains("401")
                    || debug_str.contains("Unauthorized")
                {
                    Err(SendError::Permanent(msg_str))
                } else {
                    Err(SendError::Transient(msg_str))
                }
            }
        }
    }
}
