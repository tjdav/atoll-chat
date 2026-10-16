use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    Json,
};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::{
    error::ApiError,
    error::ErrorResponse,
    rate_limit::{self, RateLimitKey, Window},
    AppState,
};

#[derive(Debug, Deserialize, ToSchema)]
pub struct OprfBlindRequest {
    /// Blinded element string, base64url encoded (Server Spec v3.0.4 §8.1.1)
    #[schema(value_type = String, format = Byte)]
    pub blinded: Option<serde_json::Value>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct OprfBlindResponse {
    /// Evaluated element string, base64url encoded (Server Spec v3.0.4 §8.1.1)
    #[schema(value_type = String, format = Byte)]
    pub evaluated: String,
}

#[utoipa::path(
    post,
    path = "/api/v1/oprf/blind",
    tag = "Public",
    summary = "OPRF evaluation",
    description = "Evaluate blinded element using the server OPRF key (Server Spec v3.0.4 §8.1.1).",
    request_body = OprfBlindRequest,
    responses(
        (status = 200, description = "Evaluated element returned successfully", body = OprfBlindResponse),
        (status = 400, description = "Missing or invalid blinded payload", body = ErrorResponse),
        (status = 429, description = "Rate limit exceeded", body = ErrorResponse),
        (status = 501, description = "OPRF evaluation disabled", body = ErrorResponse)
    )
)]
pub async fn blind(
    State(state): State<AppState>,
    headers: HeaderMap,
    body_res: Result<Json<OprfBlindRequest>, axum::extract::rejection::JsonRejection>,
) -> Result<Json<OprfBlindResponse>, ApiError> {
    if !state.config.username_oprf_enabled {
        return Err(ApiError::InternalCustom(
            StatusCode::NOT_IMPLEMENTED,
            "oprf_disabled".to_string(),
        ));
    }
    if !state.config.oprf_blind_enabled {
        return Err(ApiError::InternalCustom(
            StatusCode::NOT_IMPLEMENTED,
            "blind_disabled".to_string(),
        ));
    }

    let ip = rate_limit::extract_client_ip(&headers, &state.config);

    let decision_min = rate_limit::check(
        &state.pool,
        &state.config.rate_limits,
        RateLimitKey::OprfBlind {
            ip: ip.clone(),
            window: Window::Minute,
        },
    )
    .await?;

    if !decision_min.allowed {
        return Err(ApiError::TooManyRequests {
            message: "oprf blind rate limit exceeded".into(),
            reset_at: decision_min.reset_at,
        });
    }

    let decision_hour = rate_limit::check(
        &state.pool,
        &state.config.rate_limits,
        RateLimitKey::OprfBlind {
            ip,
            window: Window::Hour,
        },
    )
    .await?;

    if !decision_hour.allowed {
        return Err(ApiError::TooManyRequests {
            message: "oprf blind rate limit exceeded".into(),
            reset_at: decision_hour.reset_at,
        });
    }

    let Json(payload) = match body_res {
        Ok(p) => p,
        Err(_) => {
            return Err(ApiError::InternalWithDetails(
                StatusCode::BAD_REQUEST,
                "missing_field".to_string(),
                serde_json::json!({ "field": "blinded" }),
            ));
        }
    };

    let blinded_val = match payload.blinded {
        Some(val) => val,
        None => {
            return Err(ApiError::InternalWithDetails(
                StatusCode::BAD_REQUEST,
                "missing_field".to_string(),
                serde_json::json!({ "field": "blinded" }),
            ));
        }
    };

    let blinded_str = match blinded_val.as_str() {
        Some(s) => s,
        None => {
            return Err(ApiError::InternalWithDetails(
                StatusCode::BAD_REQUEST,
                "missing_field".to_string(),
                serde_json::json!({ "field": "blinded" }),
            ));
        }
    };

    let evaluated = state.oprf.evaluate_blinded(blinded_str).map_err(|e| {
        tracing::debug!("oprf blind evaluation failed: {}", e);
        ApiError::BadRequest("invalid_blinded".to_string())
    })?;

    state.oprf_audit.record();

    Ok(Json(OprfBlindResponse { evaluated }))
}
