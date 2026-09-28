use axum::{extract::State, response::IntoResponse, Json};
use serde::Serialize;
use std::env;
use std::sync::Arc;

use crate::config::Config;
use crate::sockudo::SockudoConfig;

#[derive(Serialize)]
pub struct CapabilitiesResponse {
    pub version: String,
    pub calling: bool,
    pub push_vapid_public_key: Option<String>,
    pub websocket_url: String,
    pub sockudo_app_key: String,
    pub sockudo_channel_prefix: String,
    pub safety_number_mode: String,
    pub moderation_mode: String,
    pub storage_backend: String,
    pub attachment_chunk_size: u64,
    pub attachment_bucket_sizes: Vec<u64>,
}

pub async fn handler(
    State(sockudo_config): State<Arc<SockudoConfig>>,
    State(config): State<Arc<Config>>,
) -> impl IntoResponse {
    let safety_number_mode = env::var("SAFETY_NUMBER_MODE").unwrap_or_else(|_| "warn".to_string());
    let moderation_mode = env::var("MODERATION_MODE").unwrap_or_else(|_| "messenger".to_string());
    let app_env = env::var("APP_ENV").unwrap_or_else(|_| "production".to_string());

    let websocket_url = if app_env == "production" {
        let app_url = env::var("APP_URL").unwrap_or_default();
        let base = app_url.strip_prefix("https://").unwrap_or(&app_url);
        format!("wss://{}/realtime", base.trim_end_matches('/'))
    } else if let Ok(pub_url) = env::var("SOCKUDO_PUBLIC_URL") {
        if !pub_url.trim().is_empty() {
            pub_url.trim().to_string()
        } else {
            let ws_base = sockudo_config.http_base.replace("http://", "ws://");
            format!("{}/app/{}", ws_base, sockudo_config.app_key)
        }
    } else {
        let ws_base = sockudo_config.http_base.replace("http://", "ws://");
        format!("{}/app/{}", ws_base, sockudo_config.app_key)
    };

    Json(CapabilitiesResponse {
        version: env!("CARGO_PKG_VERSION").to_string(),
        calling: false,
        push_vapid_public_key: None,
        websocket_url,
        sockudo_app_key: sockudo_config.app_key.clone(),
        sockudo_channel_prefix: "private-room-".to_string(),
        safety_number_mode,
        moderation_mode,
        storage_backend: config.storage_backend.clone(),
        attachment_chunk_size: config.attachment_chunk_size,
        attachment_bucket_sizes: config.attachment_bucket_sizes.clone(),
    })
}
