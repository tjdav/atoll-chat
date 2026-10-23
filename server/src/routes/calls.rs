use crate::auth::AuthUser;
use crate::calls::{
    end_call, generate_turn_credentials, join_call, leave_call, send_signal, EndCallResponse,
    JoinCallRequest, JoinCallResponse, LeaveCallRequest, SignalRequest, SignalResponse,
    TurnCredentialsResponse,
};
use crate::error::{ApiError, ErrorResponse};
use crate::rate_limit::{check, RateLimitKey};
use crate::AppState;
use axum::{
    extract::{Path, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    Json,
};

#[utoipa::path(
    post,
    path = "/api/v1/calls/turn-credentials",
    tag = "Calls",
    summary = "Generate TURN server credentials (§8.7.3)",
    description = "Generates temporary TURN credentials for WebRTC media relay (§8.7.3).",
    security(("bearer_auth" = [])),
    responses(
        (status = 200, description = "TURN credentials generated", body = TurnCredentialsResponse),
        (status = 401, description = "Unauthorized", body = ErrorResponse),
        (status = 429, description = "Rate limit exceeded", body = ErrorResponse),
        (status = 501, description = "Calling or TURN not configured", body = ErrorResponse)
    )
)]
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

#[utoipa::path(
    post,
    path = "/api/v1/rooms/{id}/calls/{call_id}/join",
    tag = "Calls",
    summary = "Join a room call (§8.7.5)",
    description = "Joins an active call or initiates a new call in the specified room (§8.7.5).",
    security(("bearer_auth" = [])),
    params(
        ("id" = String, Path, description = "Room ID"),
        ("call_id" = String, Path, description = "Call session ID")
    ),
    request_body = JoinCallRequest,
    responses(
        (status = 200, description = "Joined call session", body = JoinCallResponse),
        (status = 400, description = "Invalid request", body = ErrorResponse),
        (status = 401, description = "Unauthorized", body = ErrorResponse),
        (status = 403, description = "Client ID not owned by caller", body = ErrorResponse),
        (status = 404, description = "Room not found or non-member", body = ErrorResponse),
        (status = 409, description = "Call ended or max participant limit reached", body = ErrorResponse),
        (status = 501, description = "Calling disabled", body = ErrorResponse)
    )
)]
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

#[utoipa::path(
    post,
    path = "/api/v1/rooms/{id}/calls/{call_id}/leave",
    tag = "Calls",
    summary = "Leave a room call (§8.7.6)",
    description = "Leaves an active room call session (§8.7.6).",
    security(("bearer_auth" = [])),
    params(
        ("id" = String, Path, description = "Room ID"),
        ("call_id" = String, Path, description = "Call session ID")
    ),
    request_body = LeaveCallRequest,
    responses(
        (status = 204, description = "Left call session"),
        (status = 400, description = "Invalid request", body = ErrorResponse),
        (status = 401, description = "Unauthorized", body = ErrorResponse),
        (status = 403, description = "Client ID not owned by caller", body = ErrorResponse),
        (status = 404, description = "Room not found or non-member", body = ErrorResponse),
        (status = 501, description = "Calling disabled", body = ErrorResponse)
    )
)]
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

#[utoipa::path(
    post,
    path = "/api/v1/rooms/{id}/calls/{call_id}/signal",
    tag = "Calls",
    summary = "Send call WebRTC signal (§8.7.7, §6.24)",
    description = "Relays an opaque WebRTC SDP/ICE signaling envelope to a target call participant (§8.7.7, §6.24).",
    security(("bearer_auth" = [])),
    params(
        ("id" = String, Path, description = "Room ID"),
        ("call_id" = String, Path, description = "Call session ID")
    ),
    request_body = SignalRequest,
    responses(
        (status = 200, description = "Signal delivered", body = SignalResponse),
        (status = 400, description = "Invalid envelope or target mismatch", body = ErrorResponse),
        (status = 401, description = "Unauthorized", body = ErrorResponse),
        (status = 403, description = "Not a participant or sender client not owned", body = ErrorResponse),
        (status = 404, description = "Room, call, or target not found", body = ErrorResponse),
        (status = 429, description = "Rate limit exceeded", body = ErrorResponse),
        (status = 501, description = "Calling disabled", body = ErrorResponse)
    )
)]
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

#[utoipa::path(
    post,
    path = "/api/v1/rooms/{id}/calls/{call_id}/end",
    tag = "Calls",
    summary = "End a room call (§8.7.8)",
    description = "Ends an active call session (§8.7.8). Allowed for call initiator or room owner.",
    security(("bearer_auth" = [])),
    params(
        ("id" = String, Path, description = "Room ID"),
        ("call_id" = String, Path, description = "Call session ID")
    ),
    responses(
        (status = 200, description = "Call session ended", body = EndCallResponse),
        (status = 401, description = "Unauthorized", body = ErrorResponse),
        (status = 403, description = "Forbidden (neither initiator nor room owner)", body = ErrorResponse),
        (status = 404, description = "Room or call session not found", body = ErrorResponse),
        (status = 501, description = "Calling disabled", body = ErrorResponse)
    )
)]
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
