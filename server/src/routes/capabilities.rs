use axum::{response::IntoResponse, Json};
use serde::Serialize;
use std::env;

#[derive(Serialize)]
pub struct CapabilitiesResponse {
    pub version: String,
    pub calling: bool,
    pub push_vapid_public_key: Option<String>,
    pub safety_number_mode: String,
    pub moderation_mode: String,
}

pub async fn handler() -> impl IntoResponse {
    let safety_number_mode = env::var("SAFETY_NUMBER_MODE").unwrap_or_else(|_| "warn".to_string());
    let moderation_mode = env::var("MODERATION_MODE").unwrap_or_else(|_| "messenger".to_string());

    Json(CapabilitiesResponse {
        version: env!("CARGO_PKG_VERSION").to_string(),
        calling: false,
        push_vapid_public_key: None,
        safety_number_mode,
        moderation_mode,
    })
}
