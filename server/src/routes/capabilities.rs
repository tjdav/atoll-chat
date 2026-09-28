use axum::{extract::State, response::IntoResponse, Json};
use serde::Serialize;
use std::env;

use crate::AppState;

#[derive(Serialize)]
pub struct CapabilitiesResponse {
    pub version: String,
    pub calling: bool,
    pub push_vapid_public_key: Option<String>,
    pub safety_number_mode: String,
    pub moderation_mode: String,
    pub websocket_url: String,
    pub sockudo_app_key: String,
    pub sockudo_channel_prefix: String,
    pub sockudo_client_events: bool,
}

pub async fn handler(State(state): State<AppState>) -> impl IntoResponse {
    let safety_number_mode = env::var("SAFETY_NUMBER_MODE").unwrap_or_else(|_| "warn".to_string());
    let moderation_mode = env::var("MODERATION_MODE").unwrap_or_else(|_| "messenger".to_string());

    let websocket_url = if state.config.app_env == "production" {
        let app_url = state
            .config
            .app_url
            .as_deref()
            .unwrap_or("https://localhost");
        let base_ws = if app_url.starts_with("https://") {
            app_url.replacen("https://", "wss://", 1)
        } else if app_url.starts_with("http://") {
            app_url.replacen("http://", "ws://", 1)
        } else {
            format!("wss://{}", app_url)
        };
        format!("{}/realtime", base_ws.trim_end_matches('/'))
    } else {
        let sockudo_url = &state.publisher.config().http_base;
        let base_ws = if sockudo_url.starts_with("https://") {
            sockudo_url.replacen("https://", "wss://", 1)
        } else if sockudo_url.starts_with("http://") {
            sockudo_url.replacen("http://", "ws://", 1)
        } else {
            format!("ws://{}", sockudo_url)
        };
        format!(
            "{}/app/{}",
            base_ws.trim_end_matches('/'),
            state.publisher.app_key()
        )
    };

    Json(CapabilitiesResponse {
        version: env!("CARGO_PKG_VERSION").to_string(),
        calling: false,
        push_vapid_public_key: None,
        safety_number_mode,
        moderation_mode,
        websocket_url,
        sockudo_app_key: state.publisher.app_key().to_string(),
        sockudo_channel_prefix: "private-room-".to_string(),
        sockudo_client_events: state.publisher.enable_client_events(),
    })
}
