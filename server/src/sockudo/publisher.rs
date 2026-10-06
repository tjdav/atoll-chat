use crate::sockudo::{SockudoConfig, SockudoError};
use chrono::Utc;
use hmac::{Hmac, Mac};
use md5::{Digest, Md5};
use sha2::Sha256;
use std::time::Duration;
use tracing::{debug, warn};

type HmacSha256 = Hmac<Sha256>;

fn hmac_sha256_hex(secret: &str, data: &str) -> String {
    let mut mac =
        HmacSha256::new_from_slice(secret.as_bytes()).expect("HMAC can take key of any size");
    mac.update(data.as_bytes());
    hex::encode(mac.finalize().into_bytes())
}

pub struct Publisher {
    config: SockudoConfig,
    client: reqwest::Client,
}

impl Publisher {
    pub fn new(config: SockudoConfig) -> Self {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(5))
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());

        Self { config, client }
    }

    pub fn config(&self) -> &SockudoConfig {
        &self.config
    }

    pub fn app_key(&self) -> &str {
        &self.config.app_key
    }

    pub fn enable_client_events(&self) -> bool {
        self.config.enable_client_events
    }

    pub fn sign_channel_auth(&self, socket_id: &str, channel: &str) -> String {
        let string_to_sign = format!("{}:{}", socket_id, channel);
        let auth_signature = hmac_sha256_hex(&self.config.app_secret, &string_to_sign);
        format!("{}:{}", self.config.app_key, auth_signature)
    }

    pub async fn publish(
        &self,
        channel: &str,
        event: &str,
        data: serde_json::Value,
    ) -> Result<(), SockudoError> {
        let mut data = data;
        if channel.starts_with("private-room-") {
            if let Some(obj) = data.as_object_mut() {
                if let Some(val) = obj.get("target_user_ids") {
                    let is_non_null_and_non_empty = match val {
                        serde_json::Value::Null => false,
                        serde_json::Value::Array(arr) => !arr.is_empty(),
                        _ => true,
                    };
                    if is_non_null_and_non_empty {
                        warn!(
                            event_name = %event,
                            "defensive strip: removed target_user_ids from room channel payload"
                        );
                        obj.remove("target_user_ids");
                    }
                }
            }
        }

        let data_str =
            serde_json::to_string(&data).map_err(|e| SockudoError::PublishFailed(e.to_string()))?;

        let body_value = serde_json::json!({
            "name": event,
            "channels": [channel],
            "data": data_str
        });

        let body_str = serde_json::to_string(&body_value)
            .map_err(|e| SockudoError::PublishFailed(e.to_string()))?;

        let auth_timestamp = Utc::now().timestamp();
        let body_md5 = hex::encode(Md5::digest(body_str.as_bytes()));

        let query_string = format!(
            "auth_key={}&auth_timestamp={}&auth_version=1.0&body_md5={}",
            self.config.app_key, auth_timestamp, body_md5
        );

        let string_to_sign = format!(
            "POST\n/apps/{}/events\n{}",
            self.config.app_id, query_string
        );

        let auth_signature = hmac_sha256_hex(&self.config.app_secret, &string_to_sign);

        let url = format!(
            "{}/apps/{}/events?{}&auth_signature={}",
            self.config.http_base, self.config.app_id, query_string, auth_signature
        );

        let res = self
            .client
            .post(&url)
            .header("Content-Type", "application/json")
            .body(body_str)
            .send()
            .await;

        match res {
            Ok(resp) => {
                let status = resp.status();
                if status.is_success() {
                    debug!(channel = %channel, event = %event, "sockudo: event published");
                    Ok(())
                } else {
                    let err_msg = resp.text().await.unwrap_or_default();
                    warn!(
                        status = %status,
                        error = %err_msg,
                        channel = %channel,
                        event = %event,
                        "sockudo publish failed"
                    );
                    Err(SockudoError::PublishFailed(format!(
                        "status {}: {}",
                        status, err_msg
                    )))
                }
            }
            Err(e) => {
                warn!(
                    error = %e,
                    channel = %channel,
                    event = %event,
                    "sockudo publish failed"
                );
                Err(SockudoError::PublishFailed(e.to_string()))
            }
        }
    }
}
