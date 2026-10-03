use axum::body::Bytes;
use axum::extract::State;
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use serde_json::json;
use tracing::warn;

use crate::auth::AuthUser;
use crate::link_preview::content_key::{
    decode_base64_flexible, decrypt_payload, derive_content_key, encrypt_payload, ErrorPlaintext,
    RequestEnvelope, RequestPlaintext, ResponseEnvelope, ResponsePlaintext,
};
use crate::link_preview::ssrf::{fetch_url_ssrf_guarded, FetchOptions, SsrfError};
use crate::rate_limit::{self, RateLimitKey};
use crate::AppState;

pub async fn proxy_handler(
    State(state): State<AppState>,
    auth: AuthUser,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    if !state.config.link_preview_proxy_enabled {
        return (
            StatusCode::NOT_IMPLEMENTED,
            Json(json!({ "error": "proxy_disabled" })),
        )
            .into_response();
    }

    let rate_key = RateLimitKey::LinkPreview {
        user_id: auth.user_id.clone(),
    };
    match rate_limit::check(&state.pool, &state.config.rate_limits, rate_key).await {
        Ok(decision) => {
            if !decision.allowed {
                let reset_secs = (decision.reset_at - chrono::Utc::now())
                    .num_seconds()
                    .max(1);
                let mut resp_headers = HeaderMap::new();
                resp_headers.insert(header::RETRY_AFTER, header::HeaderValue::from(reset_secs));
                return (
                    StatusCode::TOO_MANY_REQUESTS,
                    resp_headers,
                    Json(json!({ "error": "rate_limited" })),
                )
                    .into_response();
            }
        }
        Err(_) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "rate_limit_error" })),
            )
                .into_response();
        }
    }

    let req_env: RequestEnvelope = match serde_json::from_slice(&body) {
        Ok(env) => env,
        Err(_) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "invalid_request" })),
            )
                .into_response();
        }
    };

    let ephemeral_bytes = match decode_base64_flexible(&req_env.ephemeral_pubkey) {
        Ok(b) if b.len() == 32 => {
            let mut array = [0u8; 32];
            array.copy_from_slice(&b);
            array
        }
        _ => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "invalid_request" })),
            )
                .into_response();
        }
    };

    let nonce_bytes = match decode_base64_flexible(&req_env.nonce) {
        Ok(b) if b.len() == 12 => {
            let mut array = [0u8; 12];
            array.copy_from_slice(&b);
            array
        }
        _ => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "invalid_request" })),
            )
                .into_response();
        }
    };

    let ciphertext_bytes = match decode_base64_flexible(&req_env.ciphertext) {
        Ok(b) => b,
        Err(_) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "invalid_request" })),
            )
                .into_response();
        }
    };

    let keys = match &state.link_preview_keys {
        Some(k) => k,
        None => {
            return (
                StatusCode::NOT_IMPLEMENTED,
                Json(json!({ "error": "proxy_disabled" })),
            )
                .into_response();
        }
    };

    let content_key = match derive_content_key(&keys.secret_key, &ephemeral_bytes) {
        Ok(k) => k,
        Err(_) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "invalid_request" })),
            )
                .into_response();
        }
    };

    let plaintext_bytes = match decrypt_payload(&content_key, &nonce_bytes, &ciphertext_bytes) {
        Ok(p) => p,
        Err(_) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "invalid_request" })),
            )
                .into_response();
        }
    };

    let req_plain: RequestPlaintext = match serde_json::from_slice(&plaintext_bytes) {
        Ok(p) => p,
        Err(_) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "invalid_request" })),
            )
                .into_response();
        }
    };

    let request_id = req_plain.request_id.clone();

    // Check optional testing header for local test servers
    let allow_local_for_test = headers
        .get("x-link-preview-allow-local")
        .and_then(|h| h.to_str().ok())
        .map(|v| v == "true" || v == "1")
        .unwrap_or(false);

    let fetch_opts = FetchOptions {
        app_env: &state.config.app_env,
        timeout_seconds: state.config.link_preview_proxy_timeout_seconds,
        max_bytes: state.config.link_preview_proxy_max_bytes,
        allow_local_for_test,
    };

    let fetch_res = fetch_url_ssrf_guarded(&req_plain.url, fetch_opts).await;

    match fetch_res {
        Ok(res) => {
            let resp_plain = ResponsePlaintext {
                status: res.status,
                headers: res.headers,
                body: BASE64.encode(&res.body_bytes),
                request_id,
            };

            let resp_plain_bytes = match serde_json::to_vec(&resp_plain) {
                Ok(b) => b,
                Err(_) => {
                    return (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        Json(json!({ "error": "internal_error" })),
                    )
                        .into_response();
                }
            };

            let mut resp_nonce = [0u8; 12];
            rand::RngCore::fill_bytes(&mut rand::thread_rng(), &mut resp_nonce);

            let resp_ciphertext =
                match encrypt_payload(&content_key, &resp_nonce, &resp_plain_bytes) {
                    Ok(c) => c,
                    Err(_) => {
                        return (
                            StatusCode::INTERNAL_SERVER_ERROR,
                            Json(json!({ "error": "internal_error" })),
                        )
                            .into_response();
                    }
                };

            let resp_env = ResponseEnvelope {
                nonce: BASE64.encode(resp_nonce),
                ciphertext: BASE64.encode(resp_ciphertext),
            };

            let resp_bytes = match serde_json::to_vec(&resp_env) {
                Ok(b) => b,
                Err(_) => {
                    return (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        Json(json!({ "error": "internal_error" })),
                    )
                        .into_response();
                }
            };

            (
                StatusCode::OK,
                [(header::CONTENT_TYPE, "application/octet-stream")],
                resp_bytes,
            )
                .into_response()
        }
        Err(err) => {
            let (status_code, err_code) = match err {
                SsrfError::UrlTooLong => (StatusCode::BAD_REQUEST, "url_too_long"),
                SsrfError::UrlBlocked => (StatusCode::BAD_REQUEST, "url_blocked"),
                SsrfError::FetchFailed => (StatusCode::BAD_GATEWAY, "fetch_failed"),
                SsrfError::UpstreamResponseTooLarge => {
                    (StatusCode::BAD_GATEWAY, "upstream_response_too_large")
                }
            };

            warn!("Link preview proxy request failed: {}", err_code);

            let err_plain = ErrorPlaintext {
                error: err_code.to_string(),
                request_id,
            };

            let err_plain_bytes = match serde_json::to_vec(&err_plain) {
                Ok(b) => b,
                Err(_) => {
                    return (status_code, Json(json!({ "error": err_code }))).into_response();
                }
            };

            let mut resp_nonce = [0u8; 12];
            rand::RngCore::fill_bytes(&mut rand::thread_rng(), &mut resp_nonce);

            let resp_ciphertext = match encrypt_payload(&content_key, &resp_nonce, &err_plain_bytes)
            {
                Ok(c) => c,
                Err(_) => {
                    return (status_code, Json(json!({ "error": err_code }))).into_response();
                }
            };

            let resp_env = ResponseEnvelope {
                nonce: BASE64.encode(resp_nonce),
                ciphertext: BASE64.encode(resp_ciphertext),
            };

            let resp_bytes = match serde_json::to_vec(&resp_env) {
                Ok(b) => b,
                Err(_) => {
                    return (status_code, Json(json!({ "error": err_code }))).into_response();
                }
            };

            (
                status_code,
                [(header::CONTENT_TYPE, "application/octet-stream")],
                resp_bytes,
            )
                .into_response()
        }
    }
}
