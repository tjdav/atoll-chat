use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use serde::{Deserialize, Serialize};

use crate::{
    auth::AuthUser,
    config_ops,
    error::ApiError,
    limits,
    rooms::{self, CreateRoomOptions, LeaveOutcome, RoomError, RoomMember, RoomWithRole},
    AppState,
};

#[derive(Debug, Deserialize)]
pub struct CreateRoomRequest {
    pub name_encrypted: Option<String>,
    pub retention_days: Option<i64>,
    pub max_file_size_bytes: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct RoomListResponse {
    pub rooms: Vec<RoomWithRole>,
}

#[derive(Debug, Serialize)]
pub struct MemberListResponse {
    pub members: Vec<RoomMember>,
}

#[derive(Debug, Deserialize)]
pub struct AddMemberRequest {
    pub user_id: String,
    pub welcome_data: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct LeaveResponse {
    pub outcome: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub new_owner_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct TransferOwnershipRequest {
    pub user_id: String,
}

pub async fn create(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(payload): Json<CreateRoomRequest>,
) -> Result<(StatusCode, Json<RoomWithRole>), ApiError> {
    let effective_limits = limits::get_limits(&state.pool, &state.server_hard_max).await?;

    let options = CreateRoomOptions {
        name_encrypted: payload.name_encrypted,
        retention_days: payload.retention_days,
        max_file_size_bytes: payload.max_file_size_bytes,
    };

    let room = rooms::create_room(
        &state.pool,
        &auth.user_id,
        options,
        &effective_limits,
        &state.server_hard_max,
    )
    .await?;

    let room_with_role = RoomWithRole {
        room,
        current_user_role: "owner".to_string(),
        member_count: 1,
    };

    Ok((StatusCode::CREATED, Json(room_with_role)))
}

pub async fn list(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<RoomListResponse>, ApiError> {
    let user_rooms = rooms::list_rooms_for_user(&state.pool, &auth.user_id).await?;
    Ok(Json(RoomListResponse { rooms: user_rooms }))
}

pub async fn get(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
) -> Result<Json<RoomWithRole>, ApiError> {
    let room_opt = rooms::get_room_for_user(&state.pool, &id, &auth.user_id).await?;
    match room_opt {
        Some(room) => Ok(Json(room)),
        None => Err(ApiError::NotFound("room_not_found".to_string())),
    }
}

pub async fn delete(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
) -> Result<StatusCode, ApiError> {
    rooms::delete_room(&state.pool, &id, &auth.user_id).await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn leave(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
) -> Result<Json<LeaveResponse>, ApiError> {
    match rooms::leave_room(&state.pool, &id, &auth.user_id).await {
        Ok(outcome) => match outcome {
            LeaveOutcome::Left => Ok(Json(LeaveResponse {
                outcome: "left".to_string(),
                new_owner_id: None,
            })),
            LeaveOutcome::TransferredOwnership { new_owner_id } => Ok(Json(LeaveResponse {
                outcome: "transferred_ownership".to_string(),
                new_owner_id: Some(new_owner_id),
            })),
            LeaveOutcome::RoomDeleted => Ok(Json(LeaveResponse {
                outcome: "room_deleted".to_string(),
                new_owner_id: None,
            })),
        },
        Err(RoomError::NotAMember) => Err(ApiError::BadRequest("not_a_member".to_string())),
        Err(RoomError::RoomNotFound) => Err(ApiError::NotFound("room_not_found".to_string())),
        Err(e) => Err(e.into()),
    }
}

pub async fn list_members(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
) -> Result<Json<MemberListResponse>, ApiError> {
    let members = rooms::list_members(&state.pool, &id, &auth.user_id).await?;
    Ok(Json(MemberListResponse { members }))
}

pub async fn add_member(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
    Json(payload): Json<AddMemberRequest>,
) -> Result<(StatusCode, Json<RoomMember>), ApiError> {
    let effective_limits = limits::get_limits(&state.pool, &state.server_hard_max).await?;

    let welcome_bytes = match payload.welcome_data {
        Some(s) if !s.trim().is_empty() => {
            let bytes = BASE64
                .decode(s.trim())
                .map_err(|_| ApiError::BadRequest("invalid_welcome_data".to_string()))?;
            Some(bytes)
        }
        _ => None,
    };

    let member = rooms::add_member(
        &state.pool,
        &id,
        &auth.user_id,
        &payload.user_id,
        welcome_bytes,
        &effective_limits,
        &state.server_hard_max,
    )
    .await?;

    Ok((StatusCode::CREATED, Json(member)))
}

pub async fn kick_member(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((id, uid)): Path<(String, String)>,
) -> Result<StatusCode, ApiError> {
    let config = config_ops::get_config(&state.pool).await?;
    rooms::kick_member(
        &state.pool,
        &id,
        &auth.user_id,
        &uid,
        &config.moderation_mode,
    )
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn promote_member(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((id, uid)): Path<(String, String)>,
) -> Result<StatusCode, ApiError> {
    let config = config_ops::get_config(&state.pool).await?;
    rooms::promote_member(
        &state.pool,
        &id,
        &auth.user_id,
        &uid,
        &config.moderation_mode,
    )
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn demote_member(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((id, uid)): Path<(String, String)>,
) -> Result<StatusCode, ApiError> {
    let config = config_ops::get_config(&state.pool).await?;
    rooms::demote_member(
        &state.pool,
        &id,
        &auth.user_id,
        &uid,
        &config.moderation_mode,
    )
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn transfer_ownership(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
    Json(payload): Json<TransferOwnershipRequest>,
) -> Result<StatusCode, ApiError> {
    rooms::transfer_ownership(&state.pool, &id, &auth.user_id, &payload.user_id).await?;
    Ok(StatusCode::NO_CONTENT)
}
