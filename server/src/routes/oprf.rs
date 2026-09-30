use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    Json,
};
use serde::{Deserialize, Serialize};

use crate::{
    error::ApiError,
    rate_limit::{self, RateLimitKey, Window},
    AppState,
};

#[derive(Debug, Deserialize)]
pub struct OprfBlindRequest {
    pub blinded: Option<serde_json::Value>,
}

#[derive(Debug, Serialize)]
pub struct OprfBlindResponse {
    pub evaluated: String,
}

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
