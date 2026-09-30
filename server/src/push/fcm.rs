use reqwest::Client as ReqwestClient;
use serde_json::json;
use std::fs;
use std::time::Duration;
use yup_oauth2::authenticator::DefaultAuthenticator;
use yup_oauth2::{ServiceAccountAuthenticator, ServiceAccountKey};

use crate::config::Config;
use crate::push::payload::NotificationPayload;
use crate::push::sender::{platform, PushSender, SendError};
use crate::push::subscriptions::PushSubscription;
use crate::push::vapid::PushError;

pub struct FcmSender {
    client: ReqwestClient,
    project_id: String,
    auth: DefaultAuthenticator,
    base_url: String,
}

impl FcmSender {
    pub async fn new(config: &Config) -> Result<Option<Self>, PushError> {
        let base_url = config
            .push_gateway_url
            .as_deref()
            .unwrap_or("https://fcm.googleapis.com");
        Self::new_internal(config, base_url).await
    }

    pub async fn new_with_base_url(
        config: &Config,
        base_url: &str,
    ) -> Result<Option<Self>, PushError> {
        Self::new_internal(config, base_url).await
    }

    async fn new_internal(config: &Config, base_url: &str) -> Result<Option<Self>, PushError> {
        let json_path_or_inline = match &config.push_fcm_service_account_json {
            Some(s) => s,
            None => return Ok(None),
        };

        let json_bytes = if json_path_or_inline.starts_with('{') {
            json_path_or_inline.as_bytes().to_vec()
        } else {
            fs::read(json_path_or_inline).map_err(|e| {
                PushError::InvalidConfig(format!(
                    "failed to read FCM service account file '{json_path_or_inline}': {e}"
                ))
            })?
        };

        let key: ServiceAccountKey = serde_json::from_slice(&json_bytes).map_err(|e| {
            PushError::InvalidConfig(format!("invalid FCM service account JSON: {e}"))
        })?;

        let project_id = key.project_id.clone().ok_or_else(|| {
            PushError::InvalidConfig("missing project_id in FCM service account JSON".to_string())
        })?;

        let auth = ServiceAccountAuthenticator::builder(key)
            .build()
            .await
            .map_err(|e| {
                PushError::InvalidConfig(format!("failed to create FCM authenticator: {e}"))
            })?;

        let client = ReqwestClient::builder()
            .timeout(Duration::from_secs(10))
            .build()
            .map_err(|e| {
                PushError::InvalidConfig(format!("failed to build reqwest client for FCM: {e}"))
            })?;

        Ok(Some(Self {
            client,
            project_id,
            auth,
            base_url: base_url.trim_end_matches('/').to_string(),
        }))
    }
}

#[async_trait::async_trait]
impl PushSender for FcmSender {
    fn platform(&self) -> &'static str {
        platform::ANDROID
    }

    async fn send(
        &self,
        subscription: &PushSubscription,
        payload: &NotificationPayload,
    ) -> Result<(), SendError> {
        let push_token = subscription
            .push_token
            .as_deref()
            .ok_or_else(|| SendError::Permanent("missing push token for Android".to_string()))?;

        if push_token.trim().is_empty() {
            return Err(SendError::Permanent(
                "empty push token for Android".to_string(),
            ));
        }

        let scopes = &["https://www.googleapis.com/auth/firebase.messaging"];
        let token = self.auth.token(scopes).await.map_err(|e| {
            SendError::Permanent(format!("failed to acquire OAuth token for FCM: {e}"))
        })?;

        let token_str = token.token().ok_or_else(|| {
            SendError::Permanent("FCM OAuth token response contained no token string".to_string())
        })?;

        let url = format!(
            "{}/v1/projects/{}/messages:send",
            self.base_url, self.project_id
        );

        let body = json!({
            "message": {
                "token": push_token,
                "notification": {
                    "title": "New message",
                    "body": "New message"
                },
                "data": {
                    "type": payload.notification_type,
                    "room_id": payload.room_id,
                    "sender_user_id": payload.sender_user_id,
                    "encrypted_payload": payload.encrypted_payload,
                    "notification_id": payload.notification_id,
                    "priority": payload.priority,
                    "collapse_key": payload.collapse_key,
                    "timestamp": payload.timestamp
                },
                "android": {
                    "priority": "high",
                    "collapse_key": payload.collapse_key,
                    "notification": {
                        "channel_id": "messages"
                    }
                }
            }
        });

        let response = self
            .client
            .post(&url)
            .header("Authorization", format!("Bearer {}", token_str))
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e| SendError::Transient(format!("FCM request failed: {e}")))?;

        let status = response.status();
        let status_code = status.as_u16();

        if status.is_success() {
            return Ok(());
        }

        let response_text = response
            .text()
            .await
            .unwrap_or_else(|_| "<failed to read body>".to_string());

        let is_unregistered = response_text.contains("UNREGISTERED");

        if status_code == 404 || (status_code == 400 && is_unregistered) {
            Err(SendError::Gone(format!(
                "FCM returned status {status_code}: {response_text}"
            )))
        } else if status_code == 401 {
            Err(SendError::Permanent(format!(
                "FCM unauthorized (401): {response_text}"
            )))
        } else if status_code == 429 || status_code == 503 || status.is_server_error() {
            Err(SendError::Transient(format!(
                "FCM server/rate limit error ({status_code}): {response_text}"
            )))
        } else if status.is_client_error() {
            Err(SendError::Permanent(format!(
                "FCM client error ({status_code}): {response_text}"
            )))
        } else {
            Err(SendError::Transient(format!(
                "FCM unexpected status ({status_code}): {response_text}"
            )))
        }
    }
}
