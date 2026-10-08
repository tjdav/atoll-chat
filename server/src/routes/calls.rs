use crate::auth::AuthUser;
use crate::calls::{
    end_call, generate_turn_credentials, join_call, leave_call, send_signal, EndCallResponse,
    JoinCallRequest, JoinCallResponse, LeaveCallRequest, SignalRequest, SignalResponse,
    TurnCredentialsResponse,
};
use crate::error::ApiError;
use crate::rate_limit::{check, RateLimitKey};
use crate::AppState;
use axum::{
    extract::{Path, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
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

pub async fn join_handler(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((room_id, call_id)): Path<(String, String)>,
    Json(req): Json<JoinCallRequest>,
) -> Result<(HeaderMap, Json<JoinCallResponse>), ApiError> {
    let res = join_call(
        &state.pool,
        &state.publisher,
        &state.call_occupancy,
        &state.server_hard_max,
        &state.config,
        &room_id,
        &call_id,
        &auth.user_id,
        req,
    )
    .await?;

    let mut headers = HeaderMap::new();
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));

    Ok((headers, Json(res)))
}

pub async fn leave_handler(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((room_id, call_id)): Path<(String, String)>,
    Json(req): Json<LeaveCallRequest>,
) -> Result<(HeaderMap, StatusCode), ApiError> {
    leave_call(
        &state.pool,
        &state.call_occupancy,
        state.config.calling_enabled,
        &room_id,
        &call_id,
        &auth.user_id,
        req,
    )
    .await?;

    let mut headers = HeaderMap::new();
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));

    Ok((headers, StatusCode::NO_CONTENT))
}

pub async fn signal_handler(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((room_id, call_id)): Path<(String, String)>,
    Json(req): Json<SignalRequest>,
) -> Result<(HeaderMap, Json<SignalResponse>), ApiError> {
    let res = send_signal(
        &state.pool,
        &state.publisher,
        &state.call_occupancy,
        &state.config.rate_limits,
        state.config.calling_enabled,
        &room_id,
        &call_id,
        &auth.user_id,
        req,
    )
    .await?;

    let mut headers = HeaderMap::new();
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));

    Ok((headers, Json(res)))
}

pub async fn end_handler(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((room_id, call_id)): Path<(String, String)>,
) -> Result<(HeaderMap, Json<EndCallResponse>), ApiError> {
    let res = end_call(
        &state.pool,
        &state.publisher,
        &state.call_occupancy,
        state.config.calling_enabled,
        &room_id,
        &call_id,
        &auth.user_id,
    )
    .await?;

    let mut headers = HeaderMap::new();
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));

    Ok((headers, Json(res)))
}
