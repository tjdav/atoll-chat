use crate::auth::AuthUser;
use crate::calls::{
    end_call, generate_turn_credentials, send_signal, EndCallResponse, SignalRequest,
    SignalResponse, TurnCredentialsResponse,
};
use crate::error::ApiError;
use crate::rate_limit::{check, RateLimitKey};
use crate::AppState;
use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};

pub async fn turn_credentials_handler(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<TurnCredentialsResponse>, ApiError> {
    let rate_key = RateLimitKey::TurnCredentials {
        user_id: auth.user_id.clone(),
    };
    let decision = check(&state.pool, &state.config.rate_limits, rate_key).await?;
    if !decision.allowed {
        return Err(ApiError::TooManyRequests {
            message: "rate_limited".to_string(),
            reset_at: decision.reset_at,
        });
    }

    if !state.config.calling_enabled {
        return Err(ApiError::NotImplemented("calling_disabled".to_string()));
    }

    if state.config.turn_url.is_empty() {
        return Err(ApiError::NotImplemented("turn_not_configured".to_string()));
    }

    let creds = generate_turn_credentials(&state.config)?;
    Ok(Json(creds))
}

pub async fn signal_handler(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((room_id, call_id)): Path<(String, String)>,
    Json(req): Json<SignalRequest>,
) -> Result<(StatusCode, Json<SignalResponse>), ApiError> {
    let res = send_signal(
        &state.pool,
        &state.publisher,
        state.config.calling_enabled,
        &room_id,
        &call_id,
        &auth.user_id,
        req,
    )
    .await?;

    Ok((StatusCode::ACCEPTED, Json(res)))
}

pub async fn end_handler(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((room_id, call_id)): Path<(String, String)>,
) -> Result<Json<EndCallResponse>, ApiError> {
    let res = end_call(
        &state.pool,
        &state.publisher,
        state.config.calling_enabled,
        &room_id,
        &call_id,
        &auth.user_id,
    )
    .await?;

    Ok(Json(res))
}
