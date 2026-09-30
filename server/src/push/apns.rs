use a2::request::payload::{APSSound, PayloadLike};
use a2::{Client, ClientConfig, Endpoint, NotificationOptions, PushType};
use serde::Serialize;
use std::collections::BTreeMap;
use std::fs;
use std::io::Cursor;

use crate::config::Config;
use crate::push::payload::NotificationPayload;
use crate::push::sender::{platform, PushSender, SendError};
use crate::push::subscriptions::PushSubscription;
use crate::push::vapid::PushError;

#[derive(Serialize, Debug)]
pub struct CustomAps<'a> {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub alert: Option<CustomAlert<'a>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub badge: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sound: Option<APSSound<'a>>,
    #[serde(rename = "mutable-content")]
    pub mutable_content: u8,
    #[serde(rename = "thread-id", skip_serializing_if = "Option::is_none")]
    pub thread_id: Option<&'a str>,
}

#[derive(Serialize, Debug)]
pub struct CustomAlert<'a> {
    pub title: &'a str,
    pub body: &'a str,
}

#[derive(Serialize, Debug)]
pub struct ApnsPayloadEnvelope<'a> {
    pub aps: CustomAps<'a>,
    #[serde(flatten)]
    pub data: BTreeMap<&'a str, serde_json::Value>,
    #[serde(skip_serializing)]
    pub options: NotificationOptions<'a>,
    #[serde(skip_serializing)]
    pub device_token: &'a str,
}

impl<'a> PayloadLike for ApnsPayloadEnvelope<'a> {
    fn get_device_token(&self) -> &'a str {
        self.device_token
    }

    fn get_options(&self) -> &NotificationOptions<'_> {
        &self.options
    }
}

pub struct ApnsSender {
    client: Client,
    topic: String,
    use_sandbox: bool,
}

impl ApnsSender {
    pub fn new(config: &Config) -> Result<Option<Self>, PushError> {
        let (key_path_or_pem, key_id, team_id, bundle_id) = match (
            &config.push_apns_key,
            &config.push_apns_key_id,
            &config.push_apns_team_id,
            &config.push_apns_bundle_id,
        ) {
            (Some(k), Some(kid), Some(tid), Some(bid)) => (k, kid, tid, bid),
            _ => return Ok(None),
        };

        let use_sandbox = config.push_apns_use_sandbox;
        let endpoint = if use_sandbox {
            Endpoint::Sandbox
        } else {
            Endpoint::Production
        };

        let key_bytes = if key_path_or_pem.starts_with("-----") {
            key_path_or_pem.as_bytes().to_vec()
        } else {
            fs::read(key_path_or_pem).map_err(|e| {
                PushError::InvalidConfig(format!(
                    "failed to read APNs key file '{key_path_or_pem}': {e}"
                ))
            })?
        };

        let client_config = ClientConfig::new(endpoint);
        let client = Client::token(Cursor::new(key_bytes), key_id, team_id, client_config)
            .map_err(|e| PushError::InvalidConfig(format!("failed to create APNs client: {e}")))?;

        Ok(Some(Self {
            client,
            topic: bundle_id.clone(),
            use_sandbox,
        }))
    }

    pub fn new_with_custom_client(client: Client, topic: String, use_sandbox: bool) -> Self {
        Self {
            client,
            topic,
            use_sandbox,
        }
    }

    pub fn use_sandbox(&self) -> bool {
        self.use_sandbox
    }
}

#[async_trait::async_trait]
impl PushSender for ApnsSender {
    fn platform(&self) -> &'static str {
        platform::IOS
    }

    async fn send(
        &self,
        subscription: &PushSubscription,
        payload: &NotificationPayload,
    ) -> Result<(), SendError> {
        let device_token = subscription
            .push_token
            .as_deref()
            .ok_or_else(|| SendError::Permanent("missing push token for iOS".to_string()))?;

        // Validate APNs device token: must be 64 hex characters
        if device_token.len() != 64 || !device_token.chars().all(|c| c.is_ascii_hexdigit()) {
            return Err(SendError::Permanent(format!(
                "invalid APNs device token: must be 64 hex characters (got len {})",
                device_token.len()
            )));
        }

        let options = NotificationOptions {
            apns_topic: Some(&self.topic),
            apns_push_type: Some(PushType::Alert),
            ..Default::default()
        };

        let mut data = BTreeMap::new();
        data.insert(
            "type",
            serde_json::to_value(&payload.notification_type).unwrap(),
        );
        data.insert("room_id", serde_json::to_value(&payload.room_id).unwrap());
        data.insert(
            "sender_user_id",
            serde_json::to_value(&payload.sender_user_id).unwrap(),
        );
        data.insert(
            "encrypted_payload",
            serde_json::to_value(&payload.encrypted_payload).unwrap(),
        );
        data.insert(
            "notification_id",
            serde_json::to_value(&payload.notification_id).unwrap(),
        );
        data.insert("priority", serde_json::to_value(&payload.priority).unwrap());
        data.insert(
            "collapse_key",
            serde_json::to_value(&payload.collapse_key).unwrap(),
        );
        data.insert(
            "timestamp",
            serde_json::to_value(&payload.timestamp).unwrap(),
        );

        let envelope = ApnsPayloadEnvelope {
            aps: CustomAps {
                alert: Some(CustomAlert {
                    title: "New message",
                    body: "New message",
                }),
                badge: Some(1),
                sound: Some(APSSound::Sound("default")),
                mutable_content: 0,
                thread_id: Some(&payload.room_id),
            },
            data,
            options,
            device_token,
        };

        match self.client.send(envelope).await {
            Ok(response) => {
                let code = response.code;
                if code == 200 {
                    Ok(())
                } else if code == 410
                    || response.error.as_ref().is_some_and(|e| {
                        let reason = format!("{:?}", e);
                        reason.contains("BadDeviceToken") || reason.contains("Unregistered")
                    })
                {
                    Err(SendError::Gone(format!(
                        "APNs endpoint returned status {code}: {:?}",
                        response.error
                    )))
                } else if code == 400 || code == 403 {
                    Err(SendError::Permanent(format!(
                        "APNs endpoint returned status {code}: {:?}",
                        response.error
                    )))
                } else {
                    Err(SendError::Transient(format!(
                        "APNs endpoint returned status {code}: {:?}",
                        response.error
                    )))
                }
            }
            Err(e) => {
                let reason = format!("{e:?}");
                if reason.contains("410")
                    || reason.contains("BadDeviceToken")
                    || reason.contains("Unregistered")
                {
                    Err(SendError::Gone(reason))
                } else if reason.contains("400") || reason.contains("403") {
                    Err(SendError::Permanent(reason))
                } else {
                    Err(SendError::Transient(reason))
                }
            }
        }
    }
}
