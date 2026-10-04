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
use crate::extensions_proxy::limits::{
    check_and_record_bandwidth, check_rate_limits, ProxyLimitError,
};
use crate::extensions_proxy::relay::{execute_outbound_fetch, OutboundFetchOptions};
use crate::extensions_proxy::validate::{
    validate_request, ExtensionErrorPlaintext, ExtensionRequestPlaintext,
    ExtensionResponsePlaintext, ValidationError,
};
use crate::proxy_common::content_key::{
    decode_base64_flexible, decrypt_payload, derive_content_key, encrypt_payload, RequestEnvelope,
    ResponseEnvelope,
};
use crate::proxy_common::ssrf::SsrfError;
use crate::AppState;

pub async fn proxy_handler(
    State(state): State<AppState>,
    auth: AuthUser,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    if !state.config.extension_proxy_enabled {
        return (
            StatusCode::NOT_IMPLEMENTED,
            Json(json!({ "error": "proxy_disabled" })),
        )
            .into_response();
    }

    if body.len() as u64 > state.config.extension_proxy_max_request_bytes {
        return (
            StatusCode::PAYLOAD_TOO_LARGE,
            Json(json!({ "error": "request_too_large" })),
        )
            .into_response();
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

    let content_key = match derive_content_key(
        &keys.secret_key,
        &ephemeral_bytes,
        b"extension-proxy-content-key-v1",
    ) {
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

    let req_plain: ExtensionRequestPlaintext = match serde_json::from_slice(&plaintext_bytes) {
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

    if let Err(val_err) = validate_request(&req_plain, &state.config.app_env) {
        let (status_code, err_code, msg) = match val_err {
            ValidationError::UrlBlocked => (StatusCode::BAD_REQUEST, "url_blocked", "URL blocked"),
            ValidationError::UrlTooLong => {
                (StatusCode::BAD_REQUEST, "url_too_long", "URL too long")
            }
            ValidationError::MethodNotAllowed => (
                StatusCode::BAD_REQUEST,
                "method_not_allowed",
                "Method not allowed",
            ),
            ValidationError::HeaderNotAllowed => (
                StatusCode::BAD_REQUEST,
                "header_not_allowed",
                "Header not allowed",
            ),
            ValidationError::BodyTooLarge => (
                StatusCode::BAD_REQUEST,
                "body_too_large",
                "Request body exceeds maximum size",
            ),
            ValidationError::InvalidRequest => (
                StatusCode::BAD_REQUEST,
                "invalid_request",
                "Invalid request format",
            ),
        };

        return build_encrypted_error(
            status_code,
            err_code,
            msg,
            None,
            None,
            Some(request_id),
            &content_key,
        );
    }

    if let Err(limit_err) = check_rate_limits(
        &state.pool,
        &state.config,
        &auth.user_id,
        &req_plain.extension_id,
    )
    .await
    {
        return match limit_err {
            ProxyLimitError::RateLimited { retry_after } => build_encrypted_error(
                StatusCode::TOO_MANY_REQUESTS,
                "rate_limited",
                "Rate limit exceeded",
                Some(json!({ "retry_after": retry_after })),
                Some(retry_after),
                Some(request_id),
                &content_key,
            ),
            ProxyLimitError::BandwidthLimited { retry_after } => build_encrypted_error(
                StatusCode::TOO_MANY_REQUESTS,
                "bandwidth_limited",
                "Bandwidth limit exceeded",
                Some(json!({ "retry_after": retry_after })),
                Some(retry_after),
                Some(request_id),
                &content_key,
            ),
            ProxyLimitError::Database(err) => {
                warn!("Database error checking proxy rate limits: {}", err);
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({ "error": "internal_error" })),
                )
                    .into_response()
            }
        };
    }

    let allow_local_for_test = headers
        .get("x-link-preview-allow-local")
        .or_else(|| headers.get("x-extension-proxy-allow-local"))
        .and_then(|h| h.to_str().ok())
        .map(|v| v == "true" || v == "1")
        .unwrap_or(false);

    let fetch_opts = OutboundFetchOptions {
        app_env: &state.config.app_env,
        connect_timeout_seconds: state.config.extension_proxy_timeout_connect_seconds,
        read_timeout_seconds: state.config.extension_proxy_timeout_read_seconds,
        max_response_bytes: state.config.extension_proxy_max_response_bytes,
        user_agent: &state.config.extension_proxy_user_agent,
        allow_local_for_test,
    };

    let fetch_res = execute_outbound_fetch(&req_plain, fetch_opts).await;

    match fetch_res {
        Ok(res) => {
            let request_body_bytes = req_plain.body.as_ref().map(|b| b.len()).unwrap_or(0) as u64;
            let response_body_bytes = res.body_bytes.len() as u64;
            let total_consumed = request_body_bytes + response_body_bytes;

            if let Err(limit_err) = check_and_record_bandwidth(
                &state.pool,
                &state.config,
                &auth.user_id,
                &req_plain.extension_id,
                total_consumed,
            )
            .await
            {
                return match limit_err {
                    ProxyLimitError::RateLimited { retry_after } => build_encrypted_error(
                        StatusCode::TOO_MANY_REQUESTS,
                        "rate_limited",
                        "Rate limit exceeded",
                        Some(json!({ "retry_after": retry_after })),
                        Some(retry_after),
                        Some(request_id),
                        &content_key,
                    ),
                    ProxyLimitError::BandwidthLimited { retry_after } => build_encrypted_error(
                        StatusCode::TOO_MANY_REQUESTS,
                        "bandwidth_limited",
                        "Bandwidth limit exceeded",
                        Some(json!({ "retry_after": retry_after })),
                        Some(retry_after),
                        Some(request_id),
                        &content_key,
                    ),
                    ProxyLimitError::Database(err) => {
                        warn!("Database error checking proxy bandwidth limits: {}", err);
                        (
                            StatusCode::INTERNAL_SERVER_ERROR,
                            Json(json!({ "error": "internal_error" })),
                        )
                            .into_response()
                    }
                };
            }

            let resp_plain = ExtensionResponsePlaintext {
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
            let (status_code, err_code, msg) = match err {
                SsrfError::UrlTooLong => (StatusCode::BAD_REQUEST, "url_too_long", "URL too long"),
                SsrfError::UrlBlocked => (StatusCode::BAD_REQUEST, "url_blocked", "URL blocked"),
                SsrfError::FetchFailed => (
                    StatusCode::BAD_GATEWAY,
                    "fetch_failed",
                    "Outbound fetch failed or timed out",
                ),
                SsrfError::UpstreamResponseTooLarge => (
                    StatusCode::BAD_GATEWAY,
                    "upstream_response_too_large",
                    "Upstream response exceeded size limit",
                ),
            };

            warn!("Extension proxy request failed: {}", err_code);

            build_encrypted_error(
                status_code,
                err_code,
                msg,
                None,
                None,
                Some(request_id),
                &content_key,
            )
        }
    }
}

fn build_encrypted_error(
    status_code: StatusCode,
    err_code: &str,
    msg: &str,
    details: Option<serde_json::Value>,
    retry_after: Option<u64>,
    request_id: Option<String>,
    content_key: &[u8; 32],
) -> Response {
    let err_plain = ExtensionErrorPlaintext {
        error: err_code.to_string(),
        message: msg.to_string(),
        details,
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

    let resp_ciphertext = match encrypt_payload(content_key, &resp_nonce, &err_plain_bytes) {
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

    let mut header_map = HeaderMap::new();
    header_map.insert(
        header::CONTENT_TYPE,
        "application/octet-stream".parse().unwrap(),
    );
    if let Some(sec) = retry_after {
        if let Ok(val) = sec.to_string().parse() {
            header_map.insert(header::RETRY_AFTER, val);
        }
    }

    (status_code, header_map, resp_bytes).into_response()
}
