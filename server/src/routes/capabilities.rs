use axum::{extract::State, response::IntoResponse, Json};
use serde::Serialize;
use std::env;

use crate::models::TtsCapabilityModelView;
use crate::sessions::SessionTypeCapView;
use crate::AppState;

fn construct_base_url(app_url: Option<&str>, path_suffix: &str) -> String {
    let base = app_url
        .unwrap_or("http://localhost:8080")
        .trim_end_matches('/');
    format!("{}{}", base, path_suffix)
}

#[derive(Serialize)]
pub struct AltchaCapView {
    pub enabled: bool,
    pub algorithm: String,
    pub cost: u32,
}

#[derive(Serialize)]
pub struct CapabilitiesResponse {
    pub version: String,
    pub calling: bool,
    pub call_max_participants: u32,
    pub sessions_enabled: bool,
    pub max_sessions_per_room: u32,
    pub max_session_participants: u32,
    pub session_types: Vec<SessionTypeCapView>,
    pub model_hosting_enabled: bool,
    pub model_hosting_mode: String,
    pub stt_models_base_url: String,
    pub stt_default_model: String,
    pub tts_models_base_url: String,
    pub tts_default_model: String,
    pub tts_models: Vec<TtsCapabilityModelView>,
    pub push_vapid_public_key: Option<String>,
    pub websocket_url: String,
    pub sockudo_app_key: String,
    pub sockudo_channel_prefix: String,
    pub altcha: AltchaCapView,
    pub storage_backend: String,
    pub storage_presign_supported: bool,
    pub storage_presign_max_ttl_seconds: u64,
    pub attachment_format: String,
    pub attachment_chunk_size: u64,
    pub attachment_bucket_sizes: Vec<u64>,
    pub attachment_accept_ranges: bool,
    pub username_oprf_enabled: bool,
    pub oprf_suite: String,
    pub key_transparency_enabled: bool,
    pub link_preview_proxy_enabled: bool,
    pub safety_number_mode: String,
    pub moderation_mode: String,
    pub edit_window_seconds: i64,
    pub reactions_per_message: i64,
    pub sync_event_retention_days: u64,
    pub threading_enabled: bool,
    pub starred_items_per_user: u32,
    pub preferences_max_encrypted_bytes: usize,
    pub extension_proxy_enabled: bool,
    pub extension_proxy_max_request_bytes: u64,
    pub extension_proxy_max_response_bytes: u64,
    pub extension_proxy_supports_streaming: bool,
    pub extension_proxy_key: Option<String>,
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

    let is_s3 = state.config.storage_backend == "s3";
    let storage_presign_supported = is_s3;
    let storage_presign_max_ttl_seconds = if is_s3 {
        state.config.s3_presign_ttl_seconds.saturating_mul(2)
    } else {
        0
    };

    let push_vapid_public_key = if state.config.push_enabled {
        state.vapid_keys.as_ref().map(|k| k.public_key.clone())
    } else {
        None
    };

    let extension_proxy_key =
        if state.config.extension_proxy_enabled || state.config.link_preview_proxy_enabled {
            state
                .link_preview_keys
                .as_ref()
                .map(|k| k.public_key_base64.clone())
        } else {
            None
        };

    let (stt_models_base_url, tts_models_base_url, tts_models) =
        if state.config.model_hosting_mode == "external" {
            if state.config.model_hosting_enabled {
                if let Some(cache) = state.models.external_cache() {
                    if cache.get_cached().is_none() {
                        let _ = cache.fetch_manifest(false).await;
                    }
                }
            }
            let ext_base = state
                .config
                .model_external_base_url
                .as_deref()
                .unwrap_or("https://localhost")
                .trim_end_matches('/');
            (
                format!("{}/stt/v1/", ext_base),
                format!("{}/tts/v1/", ext_base),
                if state.config.model_hosting_enabled {
                    state.models.tts_capability_models()
                } else {
                    Vec::new()
                },
            )
        } else {
            (
                construct_base_url(state.config.app_url.as_deref(), "/models/stt/v1/"),
                construct_base_url(state.config.app_url.as_deref(), "/models/tts/v1/"),
                if state.config.model_hosting_enabled {
                    state.models.tts_capability_models()
                } else {
                    Vec::new()
                },
            )
        };

    let sessions_enabled = state.session_types.is_effective_enabled();
    let session_types = if sessions_enabled {
        state.session_types.capabilities_types()
    } else {
        Vec::new()
    };

    let reactions_per_message =
        match crate::limits::get_limits(&state.pool, &state.server_hard_max).await {
            Ok(limits) => limits.reactions_per_message,
            Err(_) => state.server_hard_max.reactions_per_message,
        };

    let altcha = AltchaCapView {
        enabled: state.altcha_config.enabled,
        algorithm: state.altcha_config.algorithm.clone(),
        cost: state.altcha_config.cost,
    };

    Json(CapabilitiesResponse {
        version: env!("CARGO_PKG_VERSION").to_string(),
        calling: state.config.calling_enabled,
        call_max_participants: state.config.call_max_participants,
        sessions_enabled,
        max_sessions_per_room: state.config.server_max_sessions_per_room,
        max_session_participants: state.config.server_max_session_participants,
        session_types,
        model_hosting_enabled: state.config.model_hosting_enabled,
        model_hosting_mode: state.config.model_hosting_mode.clone(),
        stt_models_base_url,
        stt_default_model: state.config.stt_default_model.clone(),
        tts_models_base_url,
        tts_default_model: state.config.tts_default_model.clone(),
        tts_models,
        push_vapid_public_key,
        websocket_url,
        sockudo_app_key: state.publisher.app_key().to_string(),
        sockudo_channel_prefix: "private-room-".to_string(),
        altcha,
        storage_backend: state.config.storage_backend.clone(),
        storage_presign_supported,
        storage_presign_max_ttl_seconds,
        attachment_format: "c2sp-chunked-aes256gcm-v1".to_string(),
        attachment_chunk_size: state.config.attachment_chunk_size,
        attachment_bucket_sizes: state.config.attachment_bucket_sizes.clone(),
        attachment_accept_ranges: true,
        username_oprf_enabled: state.config.username_oprf_enabled,
        oprf_suite: "ristretto255-sha512".to_string(),
        key_transparency_enabled: state.config.key_transparency_enabled,
        link_preview_proxy_enabled: state.config.link_preview_proxy_enabled,
        safety_number_mode,
        moderation_mode,
        edit_window_seconds: state.config.edit_window_seconds,
        reactions_per_message,
        sync_event_retention_days: state.config.sync_event_retention_days,
        threading_enabled: true,
        starred_items_per_user: state.config.max_starred_items_per_user,
        preferences_max_encrypted_bytes: state.config.preferences_max_encrypted_bytes,
        extension_proxy_enabled: state.config.extension_proxy_enabled,
        extension_proxy_max_request_bytes: state.config.extension_proxy_max_request_bytes,
        extension_proxy_max_response_bytes: state.config.extension_proxy_max_response_bytes,
        extension_proxy_supports_streaming: false,
        extension_proxy_key,
    })
}
