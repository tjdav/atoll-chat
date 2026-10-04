use axum::{
    body::Body,
    extract::{Path as AxumPath, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde::Serialize;
use serde_json::json;
use tokio::fs::File;
use tokio::io::{AsyncReadExt, AsyncSeekExt, SeekFrom};
use tracing::warn;

use crate::models::manifest::is_valid_filename;
use crate::models::ModelEntry;
use crate::rate_limit::{self, RateLimitKey};
use crate::AppState;

#[derive(Serialize)]
pub struct ManifestKindView {
    pub default_model: String,
    pub base_url: String,
    pub models: Vec<ModelEntry>,
}

#[derive(Serialize)]
pub struct CombinedManifestResponse {
    pub stt: ManifestKindView,
    pub tts: ManifestKindView,
}

fn construct_base_url(app_url: Option<&str>, path_suffix: &str) -> String {
    let base = app_url
        .unwrap_or("http://localhost:8080")
        .trim_end_matches('/');
    format!("{}{}", base, path_suffix)
}

pub async fn get_manifest_handler(State(state): State<AppState>) -> impl IntoResponse {
    let stt_base_url = construct_base_url(state.config.app_url.as_deref(), "/models/stt/v1/");
    let tts_base_url = construct_base_url(state.config.app_url.as_deref(), "/models/tts/v1/");

    let (stt_models, tts_models) = if state.config.model_hosting_enabled {
        (state.models.stt_models(), state.models.tts_models())
    } else {
        (Vec::new(), Vec::new())
    };

    let resp = CombinedManifestResponse {
        stt: ManifestKindView {
            default_model: state.config.stt_default_model.clone(),
            base_url: stt_base_url,
            models: stt_models,
        },
        tts: ManifestKindView {
            default_model: state.config.tts_default_model.clone(),
            base_url: tts_base_url,
            models: tts_models,
        },
    };

    let mut headers = HeaderMap::new();
    headers.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("public, max-age=3600"),
    );
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/json"),
    );

    (headers, Json(resp))
}

pub async fn serve_stt_file_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    AxumPath((model_id, version, filename)): AxumPath<(String, u32, String)>,
) -> Response {
    serve_model_file(state, headers, "stt", &model_id, version, &filename).await
}

pub async fn serve_tts_file_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    AxumPath((model_id, version, filename)): AxumPath<(String, u32, String)>,
) -> Response {
    serve_model_file(state, headers, "tts", &model_id, version, &filename).await
}

async fn serve_model_file(
    state: AppState,
    headers: HeaderMap,
    kind: &str,
    model_id: &str,
    version: u32,
    filename: &str,
) -> Response {
    if !state.config.model_hosting_enabled {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({"error": "model_not_found"})),
        )
            .into_response();
    }

    let ip = rate_limit::extract_client_ip(&headers, &state.config);
    match rate_limit::check(
        &state.pool,
        &state.config.rate_limits,
        RateLimitKey::ModelDownload { ip },
    )
    .await
    {
        Ok(decision) => {
            if !decision.allowed {
                let retry_after = decision
                    .reset_at
                    .signed_duration_since(chrono::Utc::now())
                    .num_seconds()
                    .max(1);
                let mut resp_headers = HeaderMap::new();
                resp_headers.insert(
                    header::RETRY_AFTER,
                    HeaderValue::from_str(&retry_after.to_string())
                        .unwrap_or(HeaderValue::from_static("60")),
                );
                return (
                    StatusCode::TOO_MANY_REQUESTS,
                    resp_headers,
                    Json(json!({"error": "rate_limited"})),
                )
                    .into_response();
            }
        }
        Err(e) => {
            warn!("Rate limit error on model download: {}", e);
        }
    }

    if !is_valid_filename(filename) {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "invalid_filename"})),
        )
            .into_response();
    }

    let model_file = if kind == "stt" {
        state.models.find_stt_file(model_id, version, filename)
    } else {
        state.models.find_tts_file(model_id, version, filename)
    };

    let model_file = match model_file {
        Some(f) => f,
        None => {
            return (
                StatusCode::NOT_FOUND,
                Json(json!({"error": "model_not_found"})),
            )
                .into_response();
        }
    };

    let etag_value = format!("\"{}\"", model_file.sha256);
    if let Some(if_none_match) = headers
        .get(header::IF_NONE_MATCH)
        .and_then(|v| v.to_str().ok())
    {
        if if_none_match
            .split(',')
            .any(|tag| tag.trim() == etag_value || tag.trim() == "*")
        {
            let mut res_headers = HeaderMap::new();
            res_headers.insert(
                header::CACHE_CONTROL,
                HeaderValue::from_static("public, max-age=31536000, immutable"),
            );
            if let Ok(etag_hdr) = HeaderValue::from_str(&etag_value) {
                res_headers.insert(header::ETAG, etag_hdr);
            }
            return (StatusCode::NOT_MODIFIED, res_headers).into_response();
        }
    }

    let file_path = match state
        .models
        .ensure_model_file(kind, model_id, version, filename)
        .await
    {
        Ok(path) => path,
        Err(crate::models::ProxyFetchError::NotFound) => {
            return (
                StatusCode::NOT_FOUND,
                Json(json!({"error": "model_not_found"})),
            )
                .into_response();
        }
        Err(_) => {
            let ext_url = state.models.external_base_url().unwrap_or("unknown");
            return (
                StatusCode::BAD_GATEWAY,
                Json(json!({
                    "error": "model_fetch_failed",
                    "message": "Failed to fetch model file from upstream",
                    "details": {
                        "upstream": ext_url
                    }
                })),
            )
                .into_response();
        }
    };

    let mut file = match File::open(&file_path).await {
        Ok(f) => f,
        Err(_) => {
            return (
                StatusCode::NOT_FOUND,
                Json(json!({"error": "model_not_found"})),
            )
                .into_response();
        }
    };

    let metadata = match file.metadata().await {
        Ok(m) => m,
        Err(_) => {
            return (
                StatusCode::NOT_FOUND,
                Json(json!({"error": "model_not_found"})),
            )
                .into_response();
        }
    };

    let total_size = metadata.len();

    let mut common_headers = HeaderMap::new();
    common_headers.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("public, max-age=31536000, immutable"),
    );
    common_headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/octet-stream"),
    );
    if let Ok(etag_hdr) = HeaderValue::from_str(&etag_value) {
        common_headers.insert(header::ETAG, etag_hdr);
    }

    if let Some(range_header) = headers.get(header::RANGE).and_then(|v| v.to_str().ok()) {
        if range_header.contains(',') {
            let mut err_headers = HeaderMap::new();
            if let Ok(cr_val) = HeaderValue::from_str(&format!("bytes */{}", total_size)) {
                err_headers.insert(header::CONTENT_RANGE, cr_val);
            }
            return (
                StatusCode::RANGE_NOT_SATISFIABLE,
                err_headers,
                Json(json!({"error": "range_not_satisfiable"})),
            )
                .into_response();
        }

        if let Some(range_spec) = range_header.strip_prefix("bytes=") {
            let (start, end) = parse_range_spec(range_spec, total_size);
            match (start, end) {
                (Some(s), Some(e)) if s <= e && e < total_size => {
                    let range_length = e - s + 1;
                    if file.seek(SeekFrom::Start(s)).await.is_err() {
                        return (
                            StatusCode::INTERNAL_SERVER_ERROR,
                            Json(json!({"error": "file_seek_failed"})),
                        )
                            .into_response();
                    }

                    let limited_file = file.take(range_length);
                    let body = Body::from_stream(tokio_util::io::ReaderStream::new(limited_file));

                    let mut res_headers = common_headers;
                    res_headers.insert(header::ACCEPT_RANGES, HeaderValue::from_static("bytes"));
                    if let Ok(cr_val) =
                        HeaderValue::from_str(&format!("bytes {}-{}/{}", s, e, total_size))
                    {
                        res_headers.insert(header::CONTENT_RANGE, cr_val);
                    }
                    if let Ok(cl_val) = HeaderValue::from_str(&range_length.to_string()) {
                        res_headers.insert(header::CONTENT_LENGTH, cl_val);
                    }

                    return (StatusCode::PARTIAL_CONTENT, res_headers, body).into_response();
                }
                _ => {
                    let mut err_headers = HeaderMap::new();
                    if let Ok(cr_val) = HeaderValue::from_str(&format!("bytes */{}", total_size)) {
                        err_headers.insert(header::CONTENT_RANGE, cr_val);
                    }
                    return (
                        StatusCode::RANGE_NOT_SATISFIABLE,
                        err_headers,
                        Json(json!({"error": "range_not_satisfiable"})),
                    )
                        .into_response();
                }
            }
        }
    }

    let body = Body::from_stream(tokio_util::io::ReaderStream::new(file));
    let mut res_headers = common_headers;
    res_headers.insert(header::ACCEPT_RANGES, HeaderValue::from_static("bytes"));
    if let Ok(cl_val) = HeaderValue::from_str(&total_size.to_string()) {
        res_headers.insert(header::CONTENT_LENGTH, cl_val);
    }

    (StatusCode::OK, res_headers, body).into_response()
}

fn parse_range_spec(spec: &str, total_size: u64) -> (Option<u64>, Option<u64>) {
    let parts: Vec<&str> = spec.split('-').collect();
    if parts.len() != 2 {
        return (None, None);
    }

    if parts[0].is_empty() {
        if let Ok(suffix_len) = parts[1].parse::<u64>() {
            if suffix_len == 0 {
                return (None, None);
            }
            if suffix_len >= total_size {
                return (Some(0), Some(total_size.saturating_sub(1)));
            }
            return (
                Some(total_size.saturating_sub(suffix_len)),
                Some(total_size.saturating_sub(1)),
            );
        }
        return (None, None);
    }

    let start = parts[0].parse::<u64>().ok();
    let end = if parts[1].is_empty() {
        Some(total_size.saturating_sub(1))
    } else {
        parts[1].parse::<u64>().ok()
    };

    (start, end)
}
