use crate::config::Config;
use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use base64::Engine;
use chrono::Utc;
use hmac::{Hmac, Mac};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha1::Sha1;

type HmacSha1 = Hmac<Sha1>;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TurnCredentialsResponse {
    pub urls: Vec<String>,
    pub username: String,
    pub credential: String,
    pub ttl: u64,
}

pub fn generate_turn_credentials(
    config: &Config,
) -> Result<TurnCredentialsResponse, anyhow::Error> {
    let now = Utc::now().timestamp();
    let expiry = now + config.turn_ttl_seconds as i64;

    let mut random_bytes = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut random_bytes);
    let opaque = URL_SAFE_NO_PAD.encode(random_bytes);

    let username = format!("{}:{}", expiry, opaque);

    let mut mac = HmacSha1::new_from_slice(config.turn_shared_secret.as_bytes())
        .map_err(|e| anyhow::anyhow!("HMAC initialization failed: {e}"))?;
    mac.update(username.as_bytes());
    let mac_result = mac.finalize().into_bytes();
    let credential = STANDARD.encode(mac_result);

    let urls: Vec<String> = config
        .turn_url
        .split(',')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();

    Ok(TurnCredentialsResponse {
        urls,
        username,
        credential,
        ttl: config.turn_ttl_seconds,
    })
}
