use crate::auth::AuthUser;
use crate::error::ApiError;
use crate::rate_limit::{self, RateLimitKey, Window};
use crate::sessions::{
    self, CreateRoomSessionRequest, ListRoomSessionsQuery, PatchRoomSessionRequest, RoomSessionView,
};
use crate::AppState;
use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
};
use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct SessionListResponse {
    pub sessions: Vec<RoomSessionView>,
}

pub async fn list(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(room_id): Path<String>,
    Query(query): Query<ListRoomSessionsQuery>,
) -> Result<Json<SessionListResponse>, ApiError> {
    let sessions =
        sessions::list_room_sessions(&state.pool, &room_id, &auth.user_id, query).await?;

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
        &state.config,
        &room_id,
        &session_id,
        &auth.user_id,
    )
    .await?;

    Ok(StatusCode::NO_CONTENT)
}
