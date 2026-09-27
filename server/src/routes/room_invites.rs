use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::{
    auth::AuthUser,
    error::ApiError,
    limits,
    rate_limit::{self, RateLimitKey},
    room_invites::{self, CreateRoomInviteOptions, RedeemOutcome, RoomInviteView},
    AppState,
};

#[derive(Debug, Deserialize)]
pub struct CreateRoomInviteRequest {
    pub max_uses: Option<i64>,
    pub expires_in_days: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct CreateRoomInviteResponse {
    pub id: String,
    pub code: String,
    pub max_uses: i64,
    pub current_uses: i64,
    pub expires_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct ListRoomInvitesQuery {
    pub include_revoked: Option<bool>,
}

#[derive(Debug, Serialize)]
pub struct ListRoomInvitesResponse {
    pub invites: Vec<RoomInviteView>,
}

#[derive(Debug, Deserialize)]
pub struct JoinRoomRequest {
    pub code: String,
}

#[derive(Debug, Serialize)]
pub struct JoinRoomResponse {
    pub room_id: String,
    pub member_role: String,
    pub already_member: bool,
}

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

pub async fn revoke(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((id, invite_id)): Path<(String, String)>,
) -> Result<StatusCode, ApiError> {
    room_invites::revoke_room_invite(&state.pool, &id, &invite_id, &auth.user_id).await?;
    Ok(StatusCode::NO_CONTENT)
}

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
