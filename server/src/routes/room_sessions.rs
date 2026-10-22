use crate::auth::AuthUser;
use crate::error::ApiError;
use crate::permission_check::{ConfigEdit, RequirePermission};
use crate::rate_limit::{self, RateLimitKey, Window};
use crate::sessions::{
    self, CreateRoomSessionRequest, JoinResponse, ListRoomSessionsQuery, PatchRoomSessionRequest,
    RoomSessionView, RosterResponse, SignalRequest, SignalResponse,
};
use crate::AppState;
use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};

use utoipa::ToSchema;

use crate::error::ErrorResponse;

#[derive(Debug, Serialize, ToSchema)]
pub struct SessionListResponse {
    pub sessions: Vec<RoomSessionView>,
}

/// GET /api/v1/admin/rooms/{id}/sessions
#[utoipa::path(
    get,
    path = "/api/v1/admin/rooms/{id}/sessions",
    tag = "Admin",
    summary = "Read-only room session list",
    description = "Fetches the list of active sessions for a room. Read-only variant for admin visibility. See §8.3.",
    security(
        ("bearer_auth" = [])
    ),
    params(
        ("id" = String, Path, description = "Target room ID")
    ),
    responses(
        (status = 200, description = "Room session list retrieved successfully", body = SessionListResponse),
        (status = 401, description = "Unauthorized", body = ErrorResponse),
        (status = 403, description = "Forbidden (Admin permission required)", body = ErrorResponse),
        (status = 404, description = "Room not found", body = ErrorResponse)
    )
)]
pub async fn list_admin(
    State(state): State<AppState>,
    auth: AuthUser,
    _: RequirePermission<ConfigEdit>,
    Path(room_id): Path<String>,
    Query(query): Query<ListRoomSessionsQuery>,
) -> Result<Json<SessionListResponse>, ApiError> {
    let _ = auth;
    let sessions =
        sessions::list_room_sessions_admin(&state.pool, &state.occupancy, &room_id, query).await?;

    Ok(Json(SessionListResponse { sessions }))
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct JoinSessionRequest {
    pub client_id: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct LeaveSessionRequest {
    pub client_id: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct HeartbeatSessionRequest {
    pub client_id: String,
}

#[utoipa::path(
    get,
    path = "/api/v1/rooms/{id}/sessions",
    tag = "Messaging",
    summary = "List active room sessions",
    description = "Fetches the list of active sessions for a room (Server Spec v3.0.4 §8.7.12, §5.26).",
    security(
        ("bearer_auth" = [])
    ),
    params(
        ("id" = String, Path, description = "Target room ID"),
        ListRoomSessionsQuery
    ),
    responses(
        (status = 200, description = "Room session list retrieved successfully", body = SessionListResponse),
        (status = 400, description = "Bad request / invalid session type", body = ErrorResponse),
        (status = 401, description = "Unauthorized", body = ErrorResponse),
        (status = 404, description = "Room not found", body = ErrorResponse)
    )
)]
pub async fn list(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(room_id): Path<String>,
    Query(query): Query<ListRoomSessionsQuery>,
) -> Result<Json<SessionListResponse>, ApiError> {
    let sessions = sessions::list_room_sessions(
        &state.pool,
        &state.occupancy,
        &room_id,
        &auth.user_id,
        query,
    )
    .await?;

    Ok(Json(SessionListResponse { sessions }))
}

#[utoipa::path(
    post,
    path = "/api/v1/rooms/{id}/sessions",
    tag = "Messaging",
    summary = "Create room session",
    description = "Creates a new session in a room (Server Spec v3.0.4 §8.7).",
    security(
        ("bearer_auth" = [])
    ),
    params(
        ("id" = String, Path, description = "Target room ID")
    ),
    request_body = CreateRoomSessionRequest,
    responses(
        (status = 201, description = "Room session created successfully", body = RoomSessionView),
        (status = 400, description = "Bad request", body = ErrorResponse),
        (status = 401, description = "Unauthorized", body = ErrorResponse),
        (status = 403, description = "Forbidden (Moderator/Discord mode restrictions)", body = ErrorResponse),
        (status = 409, description = "Conflict (session limit reached)", body = ErrorResponse),
        (status = 429, description = "Too many requests", body = ErrorResponse),
        (status = 501, description = "Sessions disabled", body = ErrorResponse)
    )
)]
pub async fn create(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(room_id): Path<String>,
    Json(req): Json<CreateRoomSessionRequest>,
) -> Result<(StatusCode, Json<RoomSessionView>), ApiError> {
    let hour_key = RateLimitKey::SessionCreate {
        user_id: auth.user_id.clone(),
        window: Window::Hour,
    };
    let hour_dec = rate_limit::check(&state.pool, &state.config.rate_limits, hour_key).await?;
    if !hour_dec.allowed {
        return Err(ApiError::TooManyRequests {
            message: "rate_limited".to_string(),
            reset_at: hour_dec.reset_at,
        });
    }

    let day_key = RateLimitKey::SessionCreate {
        user_id: auth.user_id.clone(),
        window: Window::Day,
    };
    let day_dec = rate_limit::check(&state.pool, &state.config.rate_limits, day_key).await?;
    if !day_dec.allowed {
        return Err(ApiError::TooManyRequests {
            message: "rate_limited".to_string(),
            reset_at: day_dec.reset_at,
        });
    }

    let view = sessions::create_room_session(
        &state.pool,
        &state.publisher,
        &state.session_types,
        &state.config,
        &room_id,
        &auth.user_id,
        req,
    )
    .await?;

    Ok((StatusCode::CREATED, Json(view)))
}

#[utoipa::path(
    patch,
    path = "/api/v1/rooms/{id}/sessions/{session_id}",
    tag = "Messaging",
    summary = "Update room session metadata/position",
    description = "Updates metadata or position of an active room session (Server Spec v3.0.4 §8.7).",
    security(
        ("bearer_auth" = [])
    ),
    params(
        ("id" = String, Path, description = "Target room ID"),
        ("session_id" = String, Path, description = "Target session ID")
    ),
    request_body = PatchRoomSessionRequest,
    responses(
        (status = 200, description = "Room session updated successfully", body = RoomSessionView),
        (status = 400, description = "Bad request / no changes or invalid metadata", body = ErrorResponse),
        (status = 401, description = "Unauthorized", body = ErrorResponse),
        (status = 403, description = "Forbidden", body = ErrorResponse),
        (status = 404, description = "Session not found", body = ErrorResponse)
    )
)]
pub async fn patch(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((room_id, session_id)): Path<(String, String)>,
    Json(req): Json<PatchRoomSessionRequest>,
) -> Result<Json<RoomSessionView>, ApiError> {
    let view = sessions::patch_room_session(
        &state.pool,
        &state.publisher,
        &state.config,
        &room_id,
        &session_id,
        &auth.user_id,
        req,
    )
    .await?;

    Ok(Json(view))
}

#[utoipa::path(
    delete,
    path = "/api/v1/rooms/{id}/sessions/{session_id}",
    tag = "Messaging",
    summary = "Delete room session",
    description = "Deletes a room session and tears down its occupancy (Server Spec v3.0.4 §8.7).",
    security(
        ("bearer_auth" = [])
    ),
    params(
        ("id" = String, Path, description = "Target room ID"),
        ("session_id" = String, Path, description = "Target session ID")
    ),
    responses(
        (status = 204, description = "Room session deleted successfully"),
        (status = 401, description = "Unauthorized", body = ErrorResponse),
        (status = 403, description = "Forbidden", body = ErrorResponse),
        (status = 404, description = "Session not found", body = ErrorResponse)
    )
)]
pub async fn delete(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((room_id, session_id)): Path<(String, String)>,
) -> Result<StatusCode, ApiError> {
    sessions::delete_room_session(
        &state.pool,
        &state.publisher,
        &state.occupancy,
        &state.config,
        &room_id,
        &session_id,
        &auth.user_id,
    )
    .await?;

    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(
    post,
    path = "/api/v1/rooms/{id}/sessions/{session_id}/join",
    tag = "Messaging",
    summary = "Join room session",
    description = "Joins an active room session and returns current roster and media configuration (Server Spec v3.0.4 §8.7.13).",
    security(
        ("bearer_auth" = [])
    ),
    params(
        ("id" = String, Path, description = "Target room ID"),
        ("session_id" = String, Path, description = "Target session ID")
    ),
    request_body = JoinSessionRequest,
    responses(
        (status = 200, description = "Joined room session successfully", body = JoinResponse),
        (status = 400, description = "Bad request / invalid client ID", body = ErrorResponse),
        (status = 401, description = "Unauthorized", body = ErrorResponse),
        (status = 404, description = "Room or session not found", body = ErrorResponse),
        (status = 409, description = "Session full", body = ErrorResponse),
        (status = 429, description = "Too many requests", body = ErrorResponse),
        (status = 501, description = "Sessions disabled", body = ErrorResponse)
    )
)]
pub async fn join(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((room_id, session_id)): Path<(String, String)>,
    Json(req): Json<JoinSessionRequest>,
) -> Result<Json<JoinResponse>, ApiError> {
    if !state.session_types.is_effective_enabled() {
        return Err(ApiError::NotImplemented("sessions_disabled".to_string()));
    }

    let join_key = RateLimitKey::SessionJoin {
        user_id: auth.user_id.clone(),
    };
    let join_dec = rate_limit::check(&state.pool, &state.config.rate_limits, join_key).await?;
    if !join_dec.allowed {
        return Err(ApiError::TooManyRequests {
            message: "rate_limited".to_string(),
            reset_at: join_dec.reset_at,
        });
    }

    let is_member: Option<(i32,)> =
        sqlx::query_as("SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?")
            .bind(&room_id)
            .bind(&auth.user_id)
            .fetch_optional(&state.pool)
            .await?;
    if is_member.is_none() {
        return Err(ApiError::NotFound("room_not_found".to_string()));
    }

    let session_row: Option<(String,)> =
        sqlx::query_as("SELECT session_type FROM room_sessions WHERE id = ? AND room_id = ?")
            .bind(&session_id)
            .bind(&room_id)
            .fetch_optional(&state.pool)
            .await?;

    let session_type = match session_row {
        Some((st,)) => st,
        None => return Err(ApiError::NotFound("session_not_found".to_string())),
    };

    let max_participants = state
        .session_types
        .max_participants_for(&session_type)
        .unwrap_or(state.config.server_max_session_participants);

    let resp = state
        .occupancy
        .join(
            &state.pool,
            &state.publisher,
            &state.config,
            &room_id,
            &session_id,
            &auth.user_id,
            &req.client_id,
            max_participants,
        )
        .await?;

    Ok(Json(resp))
}

#[utoipa::path(
    post,
    path = "/api/v1/rooms/{id}/sessions/{session_id}/signal",
    tag = "Messaging",
    summary = "Send session signal",
    description = "Relays an end-to-end encrypted session signaling envelope to a target participant or broadcast (Server Spec v3.0.4 §8.7.11, §6.26.1).",
    security(
        ("bearer_auth" = [])
    ),
    params(
        ("id" = String, Path, description = "Target room ID"),
        ("session_id" = String, Path, description = "Target session ID")
    ),
    request_body = SignalRequest,
    responses(
        (status = 200, description = "Unicast signal delivered successfully", body = SignalResponse),
        (status = 202, description = "Broadcast signal queued/delivered successfully", body = SignalResponse),
        (status = 400, description = "Bad request / invalid envelope or client ID", body = ErrorResponse),
        (status = 401, description = "Unauthorized", body = ErrorResponse),
        (status = 403, description = "Forbidden / not a participant", body = ErrorResponse),
        (status = 404, description = "Session or target client not found", body = ErrorResponse),
        (status = 429, description = "Rate limit exceeded", body = ErrorResponse),
        (status = 501, description = "Sessions disabled", body = ErrorResponse)
    )
)]
pub async fn signal(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((room_id, session_id)): Path<(String, String)>,
    Json(req): Json<SignalRequest>,
) -> Result<(StatusCode, Json<SignalResponse>), ApiError> {
    if !state.session_types.is_effective_enabled() {
        return Err(ApiError::NotImplemented("sessions_disabled".to_string()));
    }

    let signal_key = RateLimitKey::SessionSignal {
        user_id: auth.user_id.clone(),
        session_id: session_id.clone(),
    };
    let signal_dec = rate_limit::check(&state.pool, &state.config.rate_limits, signal_key).await?;
    if !signal_dec.allowed {
        return Err(ApiError::TooManyRequests {
            message: "rate_limited".to_string(),
            reset_at: signal_dec.reset_at,
        });
    }

    let is_unicast = req.target_client_id.is_some();
    let resp = sessions::send_session_signal(
        &state.pool,
        &state.publisher,
        &state.occupancy,
        state.session_types.is_effective_enabled(),
        &room_id,
        &session_id,
        &auth.user_id,
        req,
    )
    .await?;

    let status = if is_unicast {
        StatusCode::OK
    } else {
        StatusCode::ACCEPTED
    };

    Ok((status, Json(resp)))
}

#[utoipa::path(
    post,
    path = "/api/v1/rooms/{id}/sessions/{session_id}/leave",
    tag = "Messaging",
    summary = "Leave room session",
    description = "Leaves an active room session (Server Spec v3.0.4 §8.7.13).",
    security(
        ("bearer_auth" = [])
    ),
    params(
        ("id" = String, Path, description = "Target room ID"),
        ("session_id" = String, Path, description = "Target session ID")
    ),
    request_body = LeaveSessionRequest,
    responses(
        (status = 204, description = "Left room session successfully"),
        (status = 400, description = "Bad request / invalid client ID", body = ErrorResponse),
        (status = 401, description = "Unauthorized", body = ErrorResponse),
        (status = 404, description = "Room or session not found", body = ErrorResponse),
        (status = 501, description = "Sessions disabled", body = ErrorResponse)
    )
)]
pub async fn leave(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((room_id, session_id)): Path<(String, String)>,
    Json(req): Json<LeaveSessionRequest>,
) -> Result<StatusCode, ApiError> {
    if !state.session_types.is_effective_enabled() {
        return Err(ApiError::NotImplemented("sessions_disabled".to_string()));
    }

    let is_member: Option<(i32,)> =
        sqlx::query_as("SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?")
            .bind(&room_id)
            .bind(&auth.user_id)
            .fetch_optional(&state.pool)
            .await?;
    if is_member.is_none() {
        return Err(ApiError::NotFound("room_not_found".to_string()));
    }

    let exists: Option<(i32,)> =
        sqlx::query_as("SELECT 1 FROM room_sessions WHERE id = ? AND room_id = ?")
            .bind(&session_id)
            .bind(&room_id)
            .fetch_optional(&state.pool)
            .await?;
    if exists.is_none() {
        return Err(ApiError::NotFound("session_not_found".to_string()));
    }

    state
        .occupancy
        .leave(
            &state.pool,
            &state.publisher,
            &state.config,
            &session_id,
            &auth.user_id,
            &req.client_id,
        )
        .await?;

    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(
    post,
    path = "/api/v1/rooms/{id}/sessions/{session_id}/heartbeat",
    tag = "Messaging",
    summary = "Send session heartbeat",
    description = "Refreshes active participant heartbeat in a room session (Server Spec v3.0.4 §8.7.13).",
    security(
        ("bearer_auth" = [])
    ),
    params(
        ("id" = String, Path, description = "Target room ID"),
        ("session_id" = String, Path, description = "Target session ID")
    ),
    request_body = HeartbeatSessionRequest,
    responses(
        (status = 204, description = "Session heartbeat updated successfully"),
        (status = 400, description = "Bad request / invalid client ID", body = ErrorResponse),
        (status = 401, description = "Unauthorized", body = ErrorResponse),
        (status = 404, description = "Not a participant or session not found", body = ErrorResponse),
        (status = 429, description = "Rate limit exceeded", body = ErrorResponse),
        (status = 501, description = "Sessions disabled", body = ErrorResponse)
    )
)]
pub async fn heartbeat(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((room_id, session_id)): Path<(String, String)>,
    Json(req): Json<HeartbeatSessionRequest>,
) -> Result<StatusCode, ApiError> {
    if !state.session_types.is_effective_enabled() {
        return Err(ApiError::NotImplemented("sessions_disabled".to_string()));
    }

    let hb_key = RateLimitKey::SessionHeartbeat {
        user_id: auth.user_id.clone(),
        session_id: session_id.clone(),
    };
    let hb_dec = rate_limit::check(&state.pool, &state.config.rate_limits, hb_key).await?;
    if !hb_dec.allowed {
        return Err(ApiError::TooManyRequests {
            message: "rate_limited".to_string(),
            reset_at: hb_dec.reset_at,
        });
    }

    let is_member: Option<(i32,)> =
        sqlx::query_as("SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?")
            .bind(&room_id)
            .bind(&auth.user_id)
            .fetch_optional(&state.pool)
            .await?;
    if is_member.is_none() {
        return Err(ApiError::NotFound("room_not_found".to_string()));
    }

    let exists: Option<(i32,)> =
        sqlx::query_as("SELECT 1 FROM room_sessions WHERE id = ? AND room_id = ?")
            .bind(&session_id)
            .bind(&room_id)
            .fetch_optional(&state.pool)
            .await?;
    if exists.is_none() {
        return Err(ApiError::NotFound("session_not_found".to_string()));
    }

    state
        .occupancy
        .heartbeat(&state.pool, &session_id, &auth.user_id, &req.client_id)
        .await?;

    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(
    get,
    path = "/api/v1/rooms/{id}/sessions/{session_id}/roster",
    tag = "Messaging",
    summary = "Get room session roster",
    description = "Fetches the current participant roster for an active room session (Server Spec v3.0.4 §8.7.13).",
    security(
        ("bearer_auth" = [])
    ),
    params(
        ("id" = String, Path, description = "Target room ID"),
        ("session_id" = String, Path, description = "Target session ID")
    ),
    responses(
        (status = 200, description = "Roster retrieved successfully", body = RosterResponse),
        (status = 401, description = "Unauthorized", body = ErrorResponse),
        (status = 403, description = "Forbidden / not a participant", body = ErrorResponse),
        (status = 404, description = "Session not found", body = ErrorResponse),
        (status = 501, description = "Sessions disabled", body = ErrorResponse)
    )
)]
pub async fn roster(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((room_id, session_id)): Path<(String, String)>,
) -> Result<Json<RosterResponse>, ApiError> {
    if !state.session_types.is_effective_enabled() {
        return Err(ApiError::Forbidden("not_a_participant".to_string()));
    }

    let is_member: Option<(i32,)> =
        sqlx::query_as("SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?")
            .bind(&room_id)
            .bind(&auth.user_id)
            .fetch_optional(&state.pool)
            .await?;
    if is_member.is_none() {
        return Err(ApiError::NotFound("room_not_found".to_string()));
    }

    let exists: Option<(i32,)> =
        sqlx::query_as("SELECT 1 FROM room_sessions WHERE id = ? AND room_id = ?")
            .bind(&session_id)
            .bind(&room_id)
            .fetch_optional(&state.pool)
            .await?;
    if exists.is_none() {
        return Err(ApiError::NotFound("session_not_found".to_string()));
    }

    let resp = state
        .occupancy
        .get_roster(&session_id, &auth.user_id)
        .await?;

    Ok(Json(resp))
}
