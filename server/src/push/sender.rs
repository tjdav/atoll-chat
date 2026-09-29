use std::sync::Arc;
use web_push::*;

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
    client: IsahcWebPushClient,
    vapid_keys: Arc<VapidKeys>,
    vapid_subject: String,
}

impl WebPushSender {
    pub fn new(config: &Config, vapid_keys: Arc<VapidKeys>) -> Result<Self, PushError> {
        let client =
            IsahcWebPushClient::new().map_err(|e| PushError::InvalidConfig(e.to_string()))?;

        let vapid_subject = if let Some(ref subj) = config.push_vapid_subject {
            subj.clone()
        } else if let Some(ref url) = config.app_url {
            if url.starts_with("https://") {
                url.clone()
            } else {
                "mailto:admin@example.invalid".to_string()
            }
        } else {
            "mailto:admin@example.invalid".to_string()
        };

        Ok(Self {
            client,
            vapid_keys,
            vapid_subject,
        })
    }
}

#[async_trait::async_trait]
impl PushSender for WebPushSender {
    fn platform(&self) -> &'static str {
        "web"
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
            .ok_or_else(|| SendError::Permanent("missing p256dh key".to_string()))?;
        let auth = subscription
            .auth
            .as_deref()
            .ok_or_else(|| SendError::Permanent("missing auth key".to_string()))?;

        let sub_info = SubscriptionInfo {
            endpoint: endpoint.to_string(),
            keys: SubscriptionKeys {
                p256dh: p256dh.to_string(),
                auth: auth.to_string(),
            },
        };

        let mut sig_builder = VapidSignatureBuilder::from_base64(
            &self.vapid_keys.private_key,
            URL_SAFE_NO_PAD,
            &sub_info,
        )
        .map_err(|e| SendError::Permanent(format!("VAPID builder error: {e}")))?;

        sig_builder.add_claim("sub", self.vapid_subject.as_str());

        let signature = sig_builder
            .build()
            .map_err(|e| SendError::Permanent(format!("VAPID signature error: {e}")))?;

        let payload_json = serde_json::to_string(payload)
            .map_err(|e| SendError::Permanent(format!("payload serialization error: {e}")))?;

        let mut builder = WebPushMessageBuilder::new(&sub_info);
        builder.set_payload(ContentEncoding::Aes128Gcm, payload_json.as_bytes());
        builder.set_ttl(3600);
        builder.set_urgency(Urgency::High);
        builder.set_vapid_signature(signature);

        let message = builder
            .build()
            .map_err(|e| SendError::Permanent(format!("failed to build message: {e}")))?;

        match self.client.send(message).await {
            Ok(()) => Ok(()),
            Err(WebPushError::EndpointNotFound) => {
                Err(SendError::Gone("404 Endpoint Not Found".to_string()))
            }
            Err(WebPushError::EndpointNotValid) => {
                Err(SendError::Gone("410 Endpoint Not Valid".to_string()))
            }
            Err(WebPushError::Unauthorized) => {
                Err(SendError::Permanent("Unauthorized VAPID".to_string()))
            }
            Err(WebPushError::Other(ref msg)) if msg.contains("410") || msg.contains("404") => {
                Err(SendError::Gone(msg.clone()))
            }
            Err(e) => Err(SendError::Transient(e.to_string())),
        }
    }
}
