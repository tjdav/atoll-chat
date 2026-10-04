use crate::auth::AuthUser;
use crate::error::ApiError;
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

#[derive(Debug, Serialize)]
pub struct SessionListResponse {
    pub sessions: Vec<RoomSessionView>,
}

#[derive(Debug, Deserialize)]
pub struct JoinSessionRequest {
    pub client_id: String,
}

#[derive(Debug, Deserialize)]
pub struct LeaveSessionRequest {
    pub client_id: String,
}

#[derive(Debug, Deserialize)]
pub struct HeartbeatSessionRequest {
    pub client_id: String,
}

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
