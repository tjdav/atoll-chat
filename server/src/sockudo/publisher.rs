use hmac::{Hmac, Mac};
use md5::{Digest, Md5};
use sha2::Sha256;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tracing::warn;

use crate::sockudo::{auth::compute_channel_auth, SockudoConfig, SockudoError};

type HmacSha256 = Hmac<Sha256>;

pub struct Publisher {
    config: SockudoConfig,
    client: reqwest::Client,
}

impl Publisher {
    pub fn new(config: SockudoConfig) -> Self {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(5))
            .build()
            .unwrap_or_default();

        Self { config, client }
    }

    pub fn config(&self) -> &SockudoConfig {
        &self.config
    }

    pub async fn publish(
        &self,
        channel: &str,
        event: &str,
        data: serde_json::Value,
    ) -> Result<(), SockudoError> {
        let data_str =
            serde_json::to_string(&data).map_err(|e| SockudoError::PublishFailed(e.to_string()))?;

        let body_json = serde_json::json!({
            "name": event,
            "channels": [channel],
            "data": data_str,
        });

        let body_bytes = serde_json::to_vec(&body_json)
            .map_err(|e| SockudoError::PublishFailed(e.to_string()))?;

        let body_md5 = hex::encode(Md5::digest(&body_bytes));

        let auth_timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        let path = format!("/apps/{}/events", self.config.app_id);

        let query_string = format!(
            "auth_key={}&auth_timestamp={}&auth_version=1.0&body_md5={}",
            self.config.app_key, auth_timestamp, body_md5
        );

        let string_to_sign = format!("POST\n{}\n{}", path, query_string);

        let mut mac = HmacSha256::new_from_slice(self.config.app_secret.as_bytes())
            .expect("HMAC can take key of any size");
        mac.update(string_to_sign.as_bytes());
        let auth_signature = hex::encode(mac.finalize().into_bytes());

        let request_url = format!(
            "{}{}?{}&auth_signature={}",
            self.config.http_base, path, query_string, auth_signature
        );

        let res = self
            .client
            .post(&request_url)
            .header("Content-Type", "application/json")
            .body(body_bytes)
            .send()
            .await;

        match res {
            Ok(resp) if resp.status().is_success() => Ok(()),
            Ok(resp) => {
                let status = resp.status();
                let err_msg = format!("HTTP {}", status);
                warn!("Sockudo publish failed on channel {}: {}", channel, err_msg);
                Err(SockudoError::PublishFailed(err_msg))
            }
            Err(e) => {
                let err_msg = e.to_string();
                warn!(
                    "Sockudo publish request error on channel {}: {}",
                    channel, err_msg
                );
                Err(SockudoError::PublishFailed(err_msg))
            }
        }
    }

    pub fn sign_channel_auth(&self, socket_id: &str, channel: &str) -> String {
        compute_channel_auth(
            &self.config.app_key,
            &self.config.app_secret,
            socket_id,
            channel,
        )
    }
}
