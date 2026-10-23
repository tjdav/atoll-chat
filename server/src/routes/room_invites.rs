use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};

use crate::{
    auth::AuthUser,
    error::{ApiError, ErrorResponse},
    limits,
    rate_limit::{self, RateLimitKey},
    room_invites::{self, CreateRoomInviteOptions, RedeemOutcome, RoomInviteView},
    AppState,
};

#[derive(Debug, Deserialize, ToSchema)]
pub struct CreateRoomInviteRequest {
    pub max_uses: Option<i64>,
    pub expires_in_days: Option<i64>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct CreateRoomInviteResponse {
    pub id: String,
    pub code: String,
    pub max_uses: i64,
    pub current_uses: i64,
    pub expires_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize, IntoParams, ToSchema)]
#[into_params(parameter_in = Query)]
pub struct ListRoomInvitesQuery {
    pub include_revoked: Option<bool>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ListRoomInvitesResponse {
    pub invites: Vec<RoomInviteView>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct JoinRoomRequest {
    pub code: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct JoinRoomResponse {
    pub room_id: String,
    pub member_role: String,
    pub already_member: bool,
}

#[utoipa::path(
    post,
    path = "/api/v1/rooms/{id}/invites",
    tag = "Room Invites",
    params(
        ("id" = String, Path, description = "Room ID")
    ),
    request_body = CreateRoomInviteRequest,
    responses(
        (status = 201, description = "Room invite created successfully", body = CreateRoomInviteResponse),
        (status = 400, description = "Invalid request payload", body = ErrorResponse),
        (status = 401, description = "Unauthorized", body = ErrorResponse),
        (status = 403, description = "Forbidden (non-moderator)", body = ErrorResponse),
        (status = 404, description = "Room not found", body = ErrorResponse),
    ),
    security(("bearer_auth" = []))
)]
pub async fn create(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
    Json(payload): Json<CreateRoomInviteRequest>,
) -> Result<(StatusCode, Json<CreateRoomInviteResponse>), ApiError> {
    let options = CreateRoomInviteOptions {
        max_uses: payload.max_uses,
        expires_in_days: payload.expires_in_days,
    };

    let invite =
        room_invites::create_room_invite(&state.pool, &id, &auth.user_id, options, &state.config)
            .await?;

    let response = CreateRoomInviteResponse {
        id: invite.id,
        code: invite.code,
        max_uses: invite.max_uses,
        current_uses: invite.current_uses,
        expires_at: invite.expires_at,
        created_at: invite.created_at,
    };

    Ok((StatusCode::CREATED, Json(response)))
}

#[utoipa::path(
    get,
    path = "/api/v1/rooms/{id}/invites",
    tag = "Room Invites",
    params(
        ("id" = String, Path, description = "Room ID"),
        ListRoomInvitesQuery
    ),
    responses(
        (status = 200, description = "List of room invites", body = ListRoomInvitesResponse),
        (status = 401, description = "Unauthorized", body = ErrorResponse),
        (status = 403, description = "Forbidden (non-moderator)", body = ErrorResponse),
        (status = 404, description = "Room not found", body = ErrorResponse),
    ),
    security(("bearer_auth" = []))
)]
pub async fn list(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
    Query(query): Query<ListRoomInvitesQuery>,
) -> Result<Json<ListRoomInvitesResponse>, ApiError> {
    let include_revoked = query.include_revoked.unwrap_or(false);

    let invites =
        room_invites::list_room_invites(&state.pool, &id, &auth.user_id, include_revoked).await?;

    Ok(Json(ListRoomInvitesResponse { invites }))
}

#[utoipa::path(
    delete,
    path = "/api/v1/rooms/{id}/invites/{invite_id}",
    tag = "Room Invites",
    params(
        ("id" = String, Path, description = "Room ID"),
        ("invite_id" = String, Path, description = "Invite ID to revoke")
    ),
    responses(
        (status = 204, description = "Invite revoked successfully"),
        (status = 401, description = "Unauthorized", body = ErrorResponse),
        (status = 403, description = "Forbidden (non-creator/non-owner)", body = ErrorResponse),
        (status = 404, description = "Room or invite not found", body = ErrorResponse),
    ),
    security(("bearer_auth" = []))
)]
pub async fn revoke(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((id, invite_id)): Path<(String, String)>,
) -> Result<StatusCode, ApiError> {
    room_invites::revoke_room_invite(&state.pool, &id, &invite_id, &auth.user_id).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(
    post,
    path = "/api/v1/rooms/join",
    tag = "Room Invites",
    request_body = JoinRoomRequest,
    responses(
        (status = 200, description = "Joined room successfully", body = JoinRoomResponse),
        (status = 400, description = "Invalid invite code", body = ErrorResponse),
        (status = 401, description = "Unauthorized", body = ErrorResponse),
        (status = 404, description = "Invite not found or expired", body = ErrorResponse),
        (status = 409, description = "Already a room member", body = ErrorResponse),
        (status = 429, description = "Rate limit exceeded", body = ErrorResponse),
    ),
    security(("bearer_auth" = []))
)]
pub async fn join(
    State(state): State<AppState>,
    auth: AuthUser,
    headers: HeaderMap,
    Json(payload): Json<JoinRoomRequest>,
) -> Result<Json<JoinRoomResponse>, ApiError> {
    let ip = headers
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.split(',').next())
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|| "127.0.0.1".to_string());

    let decision = rate_limit::check(
        &state.pool,
        &state.config.rate_limits,
        RateLimitKey::InviteRedeem { ip },
    )
    .await?;

    if !decision.allowed {
        return Err(ApiError::TooManyRequests {
            message: "invite redemption rate limit exceeded".into(),
            reset_at: decision.reset_at,
        });
    }

    let effective_limits = limits::get_limits(&state.pool, &state.server_hard_max).await?;

    let outcome = room_invites::redeem_room_invite(
        &state.pool,
        &payload.code,
        &auth.user_id,
        &effective_limits,
        &state.server_hard_max,
    )
    .await?;

    match outcome {
        RedeemOutcome::Joined {
            room_id,
            member_role,
        } => Ok(Json(JoinRoomResponse {
            room_id,
            member_role,
            already_member: false,
        })),
        RedeemOutcome::AlreadyMember {
            room_id,
            member_role,
        } => Ok(Json(JoinRoomResponse {
            room_id,
            member_role,
            already_member: true,
        })),
    }
}
