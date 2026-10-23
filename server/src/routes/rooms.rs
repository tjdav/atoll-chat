use axum::{
    extract::{Path, Query, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::IntoResponse,
    Json,
};
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::json;
use utoipa::{IntoParams, ToSchema};

use crate::{
    auth::AuthUser,
    config_ops,
    error::{ApiError, ErrorResponse},
    limits,
    rate_limit::{self, RateLimitKey},
    rooms::{
        self, CreateRoomOptions, LeaveOutcome, ListMembersQuery, MemberCursor,
        RetentionPreviewResult, RoomError, RoomMember, RoomMemberItem, RoomMetadataResult,
        RoomWithRole,
    },
    AppState,
};

#[derive(Debug, Deserialize, ToSchema)]
pub struct CreateRoomRequest {
    pub retention_days: Option<i64>,
    pub max_file_size_bytes: Option<i64>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct UpdateMetadataRequest {
    pub metadata: Option<Option<String>>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct RoomListResponse {
    pub rooms: Vec<RoomWithRole>,
}

#[derive(Debug, Deserialize, IntoParams, ToSchema)]
#[into_params(parameter_in = Query)]
pub struct ListMembersQueryParams {
    pub limit: Option<String>,
    pub cursor: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct MemberListResponse {
    pub members: Vec<RoomMemberItem>,
    pub next_cursor: Option<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct AddMemberRequest {
    pub user_id: String,
    pub welcome_data: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct LeaveResponse {
    pub outcome: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub new_owner_id: Option<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct RetentionPreviewRequest {
    #[schema(minimum = 0, maximum = 365)]
    pub retention_days: i64,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct TransferOwnershipRequest {
    pub user_id: String,
}

#[utoipa::path(
    post,
    path = "/api/v1/rooms",
    tag = "Rooms",
    request_body = CreateRoomRequest,
    responses(
        (status = 201, description = "Room created successfully", body = RoomWithRole),
        (status = 400, description = "Invalid request payload", body = ErrorResponse),
        (status = 401, description = "Unauthorized", body = ErrorResponse),
        (status = 403, description = "Room creation limit reached", body = ErrorResponse),
    ),
    security(("bearer_auth" = []))
)]
pub async fn create(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(payload): Json<CreateRoomRequest>,
) -> Result<(StatusCode, Json<RoomWithRole>), ApiError> {
    let effective_limits = limits::get_limits(&state.pool, &state.server_hard_max).await?;

    let options = CreateRoomOptions {
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

    // Message retention uses the same instance limit as attachments in V1.
    // The spec (§4.4) does not define a separate `message_retention_days` instance limit —
    // messages and attachments share the retention policy until a future revision introduces a separate key.
    let effective_max_file_size_bytes = rooms::effective_file_size_limit(
        room.max_file_size_bytes,
        effective_limits.file_size_bytes,
        state.server_hard_max.file_size_bytes,
    );
    let effective_message_retention_days = rooms::effective_message_retention_days(
        room.retention_days,
        effective_limits.attachment_retention_days,
        state.server_hard_max.attachment_retention_days,
    );

    let room_with_role = RoomWithRole {
        room,
        current_user_role: "owner".to_string(),
        member_count: 1,
        effective_max_file_size_bytes,
        effective_message_retention_days,
    };

    Ok((StatusCode::CREATED, Json(room_with_role)))
}

#[utoipa::path(
    get,
    path = "/api/v1/rooms",
    tag = "Rooms",
    responses(
        (status = 200, description = "List of user rooms", body = RoomListResponse),
        (status = 401, description = "Unauthorized", body = ErrorResponse),
    ),
    security(("bearer_auth" = []))
)]
pub async fn list(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<RoomListResponse>, ApiError> {
    let limits = limits::get_limits(&state.pool, &state.server_hard_max).await?;
    let mut user_rooms = rooms::list_rooms_for_user(&state.pool, &auth.user_id).await?;

    for room_with_role in &mut user_rooms {
        // Message retention uses the same instance limit as attachments in V1.
        room_with_role.effective_max_file_size_bytes = rooms::effective_file_size_limit(
            room_with_role.room.max_file_size_bytes,
            limits.file_size_bytes,
            state.server_hard_max.file_size_bytes,
        );
        room_with_role.effective_message_retention_days = rooms::effective_message_retention_days(
            room_with_role.room.retention_days,
            limits.attachment_retention_days,
            state.server_hard_max.attachment_retention_days,
        );
    }

    Ok(Json(RoomListResponse { rooms: user_rooms }))
}

#[utoipa::path(
    get,
    path = "/api/v1/rooms/{id}",
    tag = "Rooms",
    params(
        ("id" = String, Path, description = "Room ID")
    ),
    responses(
        (status = 200, description = "Room details with user role", body = RoomWithRole),
        (status = 401, description = "Unauthorized", body = ErrorResponse),
        (status = 404, description = "Room not found", body = ErrorResponse),
    ),
    security(("bearer_auth" = []))
)]
pub async fn get(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
) -> Result<Json<RoomWithRole>, ApiError> {
    let room_opt = rooms::get_room_for_user(&state.pool, &id, &auth.user_id).await?;
    match room_opt {
        Some(mut room_with_role) => {
            let limits = limits::get_limits(&state.pool, &state.server_hard_max).await?;
            // Message retention uses the same instance limit as attachments in V1.
            room_with_role.effective_max_file_size_bytes = rooms::effective_file_size_limit(
                room_with_role.room.max_file_size_bytes,
                limits.file_size_bytes,
                state.server_hard_max.file_size_bytes,
            );
            room_with_role.effective_message_retention_days =
                rooms::effective_message_retention_days(
                    room_with_role.room.retention_days,
                    limits.attachment_retention_days,
                    state.server_hard_max.attachment_retention_days,
                );
            Ok(Json(room_with_role))
        }
        None => Err(ApiError::NotFound("room_not_found".to_string())),
    }
}

#[utoipa::path(
    delete,
    path = "/api/v1/rooms/{id}",
    tag = "Rooms",
    params(
        ("id" = String, Path, description = "Room ID")
    ),
    responses(
        (status = 204, description = "Room deleted successfully"),
        (status = 401, description = "Unauthorized", body = ErrorResponse),
        (status = 403, description = "Forbidden (non-owner)", body = ErrorResponse),
        (status = 404, description = "Room not found", body = ErrorResponse),
    ),
    security(("bearer_auth" = []))
)]
pub async fn delete(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
) -> Result<StatusCode, ApiError> {
    rooms::delete_room(
        &state.pool,
        &state.publisher,
        &state.occupancy,
        &id,
        &auth.user_id,
    )
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(
    post,
    path = "/api/v1/rooms/{id}/leave",
    tag = "Rooms",
    params(
        ("id" = String, Path, description = "Room ID")
    ),
    responses(
        (status = 200, description = "Left room successfully", body = LeaveResponse),
        (status = 400, description = "Not a room member", body = ErrorResponse),
        (status = 401, description = "Unauthorized", body = ErrorResponse),
        (status = 404, description = "Room not found", body = ErrorResponse),
    ),
    security(("bearer_auth" = []))
)]
pub async fn leave(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
) -> Result<Json<LeaveResponse>, ApiError> {
    let outcome = rooms::leave_room(
        &state.pool,
        &state.publisher,
        &state.occupancy,
        &id,
        &auth.user_id,
    )
    .await
    .map_err(|e| match e {
        RoomError::NotAMember => ApiError::BadRequest("not_a_member".to_string()),
        RoomError::RoomNotFound => ApiError::NotFound("room_not_found".to_string()),
        other => other.into(),
    })?;

    let channel = format!("private-room-{}", id);
    let payload = json!({
        "room_id": id,
        "user_id": auth.user_id,
    });
    if let Err(e) = state
        .publisher
        .publish(&channel, "room.member_removed", payload)
        .await
    {
        tracing::warn!(error = %e, channel = %channel, "sockudo publish failed");
    }

    match outcome {
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
    }
}

#[utoipa::path(
    get,
    path = "/api/v1/rooms/{id}/members",
    tag = "Rooms",
    params(
        ("id" = String, Path, description = "Room ID"),
        ListMembersQueryParams
    ),
    responses(
        (status = 200, description = "List of room members (users and bots)", body = MemberListResponse),
        (status = 400, description = "Invalid limit or cursor", body = ErrorResponse),
        (status = 401, description = "Unauthorized", body = ErrorResponse),
        (status = 404, description = "Room not found", body = ErrorResponse),
        (status = 429, description = "Rate limit exceeded", body = ErrorResponse),
    ),
    security(("bearer_auth" = []))
)]
pub async fn list_members(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
    Query(query): Query<ListMembersQueryParams>,
) -> Result<impl IntoResponse, ApiError> {
    // 1. Rate limit check
    let decision = rate_limit::check(
        &state.pool,
        &state.config.rate_limits,
        RateLimitKey::MemberList {
            user_id: auth.user_id.clone(),
        },
    )
    .await?;

    if !decision.allowed {
        return Err(ApiError::TooManyRequests {
            message: "rate limit exceeded for member list".to_string(),
            reset_at: decision.reset_at,
        });
    }

    // 2. Parse and validate limit
    let limit = match query.limit {
        Some(s) => {
            let parsed: i64 = s
                .parse()
                .map_err(|_| ApiError::BadRequest("invalid_limit".to_string()))?;
            if parsed <= 0 {
                return Err(ApiError::BadRequest("invalid_limit".to_string()));
            }
            (parsed as usize).min(200)
        }
        None => 50,
    };

    // 3. Parse and validate cursor
    let cursor = match query.cursor {
        Some(c_str) => {
            let decoded = MemberCursor::decode(&c_str)
                .ok_or_else(|| ApiError::BadRequest("invalid_cursor".to_string()))?;
            if decoded.room_id != id {
                return Err(ApiError::BadRequest("invalid_cursor".to_string()));
            }
            Some(decoded)
        }
        None => None,
    };

    let list_query = ListMembersQuery {
        room_id: id,
        requester_id: auth.user_id,
        limit,
        cursor,
    };

    let result = rooms::list_members(&state.pool, list_query).await?;

    let mut headers = HeaderMap::new();
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));

    Ok((
        headers,
        Json(MemberListResponse {
            members: result.members,
            next_cursor: result.next_cursor,
        }),
    ))
}

#[derive(Debug, Serialize, ToSchema)]
pub struct PendingAddsResponse {
    pub pending_adds: Vec<rooms::PendingAddView>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ConsumePendingAddResponse {
    pub id: String,
    pub consumed_at: String,
}

#[utoipa::path(
    get,
    path = "/api/v1/rooms/{id}/pending-adds",
    tag = "Rooms",
    params(
        ("id" = String, Path, description = "Room ID")
    ),
    responses(
        (status = 200, description = "List of pending MLS adds", body = PendingAddsResponse),
        (status = 401, description = "Unauthorized", body = ErrorResponse),
        (status = 404, description = "Room not found or not a member", body = ErrorResponse),
    ),
    security(("bearer_auth" = []))
)]
pub async fn list_pending_adds(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    let pending_adds = rooms::list_pending_adds(&state.pool, &id, &auth.user_id)
        .await
        .map_err(|e| match e {
            RoomError::NotAMember => ApiError::NotFound("room_not_found".to_string()),
            RoomError::RoomNotFound => ApiError::NotFound("room_not_found".to_string()),
            other => other.into(),
        })?;

    let mut headers = HeaderMap::new();
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));

    Ok((headers, Json(PendingAddsResponse { pending_adds })))
}

#[utoipa::path(
    post,
    path = "/api/v1/rooms/{id}/pending-adds/{add_id}/consume",
    tag = "Rooms",
    params(
        ("id" = String, Path, description = "Room ID"),
        ("add_id" = String, Path, description = "Pending add ID")
    ),
    responses(
        (status = 200, description = "Pending add consumed successfully", body = ConsumePendingAddResponse),
        (status = 401, description = "Unauthorized", body = ErrorResponse),
        (status = 404, description = "Room not found, add not found, or not a member", body = ErrorResponse),
    ),
    security(("bearer_auth" = []))
)]
pub async fn consume_pending_add(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((id, add_id)): Path<(String, String)>,
) -> Result<impl IntoResponse, ApiError> {
    let consumed_at = rooms::consume_pending_add(&state.pool, &id, &add_id, &auth.user_id)
        .await
        .map_err(|e| match e {
            RoomError::NotAMember => ApiError::NotFound("room_not_found".to_string()),
            RoomError::RoomNotFound => ApiError::NotFound("room_not_found".to_string()),
            other => other.into(),
        })?;

    let mut headers = HeaderMap::new();
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));

    Ok((
        headers,
        Json(ConsumePendingAddResponse {
            id: add_id,
            consumed_at: consumed_at.to_rfc3339(),
        }),
    ))
}

#[utoipa::path(
    post,
    path = "/api/v1/rooms/{id}/members",
    tag = "Rooms",
    params(
        ("id" = String, Path, description = "Room ID")
    ),
    request_body = AddMemberRequest,
    responses(
        (status = 201, description = "Member added successfully", body = RoomMember),
        (status = 400, description = "Invalid welcome data", body = ErrorResponse),
        (status = 401, description = "Unauthorized", body = ErrorResponse),
        (status = 403, description = "Forbidden or room member limit reached", body = ErrorResponse),
        (status = 404, description = "Room not found", body = ErrorResponse),
        (status = 409, description = "Already a room member", body = ErrorResponse),
    ),
    security(("bearer_auth" = []))
)]
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

    let outcome = rooms::add_member(
        &state.pool,
        &id,
        &auth.user_id,
        &payload.user_id,
        welcome_bytes,
        &effective_limits,
        &state.server_hard_max,
    )
    .await?;

    let channel = format!("private-room-{}", id);
    let event_payload = json!({
        "room_id": id,
        "user_id": outcome.member.user_id,
        "role": outcome.member.role,
        "joined_at": outcome.member.joined_at.to_rfc3339(),
    });
    if let Err(e) = state
        .publisher
        .publish(&channel, "room.member_added", event_payload)
        .await
    {
        tracing::warn!(error = %e, channel = %channel, "sockudo publish failed");
    }

    if !outcome.added_client_ids.is_empty() {
        let mls_add_payload = json!({
            "room_id": id,
            "target_user_id": payload.user_id,
            "target_bot_id": serde_json::Value::Null,
            "client_ids": outcome.added_client_ids,
        });
        if let Err(e) = state
            .publisher
            .publish(&channel, "mls.add_pending", mls_add_payload)
            .await
        {
            tracing::warn!(error = %e, channel = %channel, "sockudo publish failed for mls.add_pending");
        }
    }

    Ok((StatusCode::CREATED, Json(outcome.member)))
}

#[utoipa::path(
    delete,
    path = "/api/v1/rooms/{id}/members/{uid}",
    tag = "Rooms",
    params(
        ("id" = String, Path, description = "Room ID"),
        ("uid" = String, Path, description = "User ID to kick")
    ),
    responses(
        (status = 204, description = "Member kicked successfully"),
        (status = 401, description = "Unauthorized", body = ErrorResponse),
        (status = 403, description = "Forbidden (non-moderator)", body = ErrorResponse),
        (status = 404, description = "Room or member not found", body = ErrorResponse),
    ),
    security(("bearer_auth" = []))
)]
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

    let channel = format!("private-room-{}", id);
    let payload = json!({
        "room_id": id,
        "user_id": uid,
    });
    if let Err(e) = state
        .publisher
        .publish(&channel, "room.member_removed", payload)
        .await
    {
        tracing::warn!(error = %e, channel = %channel, "sockudo publish failed");
    }

    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(
    post,
    path = "/api/v1/rooms/{id}/members/{uid}/promote",
    tag = "Rooms",
    params(
        ("id" = String, Path, description = "Room ID"),
        ("uid" = String, Path, description = "User ID to promote")
    ),
    responses(
        (status = 204, description = "Member promoted successfully"),
        (status = 401, description = "Unauthorized", body = ErrorResponse),
        (status = 403, description = "Forbidden (non-owner)", body = ErrorResponse),
        (status = 404, description = "Room or member not found", body = ErrorResponse),
    ),
    security(("bearer_auth" = []))
)]
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

#[utoipa::path(
    post,
    path = "/api/v1/rooms/{id}/members/{uid}/demote",
    tag = "Rooms",
    params(
        ("id" = String, Path, description = "Room ID"),
        ("uid" = String, Path, description = "User ID to demote")
    ),
    responses(
        (status = 204, description = "Member demoted successfully"),
        (status = 401, description = "Unauthorized", body = ErrorResponse),
        (status = 403, description = "Forbidden (non-owner)", body = ErrorResponse),
        (status = 404, description = "Room or member not found", body = ErrorResponse),
    ),
    security(("bearer_auth" = []))
)]
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

#[utoipa::path(
    patch,
    path = "/api/v1/rooms/{id}",
    tag = "Rooms",
    params(
        ("id" = String, Path, description = "Room ID")
    ),
    request_body = UpdateMetadataRequest,
    responses(
        (status = 200, description = "Room metadata updated", body = RoomMetadataResult),
        (status = 400, description = "Invalid request payload or metadata length", body = ErrorResponse),
        (status = 401, description = "Unauthorized", body = ErrorResponse),
        (status = 403, description = "Forbidden (non-moderator)", body = ErrorResponse),
        (status = 404, description = "Room not found", body = ErrorResponse),
        (status = 429, description = "Rate limit exceeded", body = ErrorResponse),
    ),
    security(("bearer_auth" = []))
)]
pub async fn update_metadata(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
    body: String,
) -> Result<impl IntoResponse, ApiError> {
    // Check rate limit
    let rl_decision = rate_limit::check(
        &state.pool,
        &state.config.rate_limits,
        RateLimitKey::RoomMetadata {
            user_id: auth.user_id.clone(),
        },
    )
    .await?;

    if !rl_decision.allowed {
        return Err(ApiError::TooManyRequests {
            message: "rate limit exceeded".to_string(),
            reset_at: rl_decision.reset_at,
        });
    }

    let payload: serde_json::Value = serde_json::from_str(&body)
        .map_err(|_| ApiError::BadRequest("invalid_json".to_string()))?;

    let obj = payload
        .as_object()
        .ok_or_else(|| ApiError::BadRequest("invalid_body".to_string()))?;

    if !obj.contains_key("metadata") {
        return Err(ApiError::InternalWithDetails(
            StatusCode::BAD_REQUEST,
            "missing_field".to_string(),
            json!({ "field": "metadata" }),
        ));
    }

    let metadata_val = &obj["metadata"];
    let metadata_str = match metadata_val {
        serde_json::Value::Null => None,
        serde_json::Value::String(s) => Some(s.as_str()),
        _ => return Err(ApiError::BadRequest("invalid_metadata".to_string())),
    };

    let limits = limits::get_limits(&state.pool, &state.server_hard_max).await?;
    let effective_max_metadata_bytes = limits.room_metadata_bytes as usize;

    let config = config_ops::get_config(&state.pool).await?;

    let result = rooms::update_room_metadata(
        &state.pool,
        &state.publisher,
        &id,
        &auth.user_id,
        metadata_str,
        effective_max_metadata_bytes,
        &config.moderation_mode,
    )
    .await?;

    let mut headers = HeaderMap::new();
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));

    Ok((headers, Json(result)))
}

#[utoipa::path(
    post,
    path = "/api/v1/rooms/{id}/retention/preview",
    tag = "Rooms",
    params(
        ("id" = String, Path, description = "Room ID")
    ),
    request_body = RetentionPreviewRequest,
    responses(
        (status = 200, description = "Retention preview result", body = RetentionPreviewResult),
        (status = 400, description = "Invalid retention days (must be 0..=365)", body = ErrorResponse),
        (status = 401, description = "Unauthorized", body = ErrorResponse),
        (status = 403, description = "Forbidden (non-owner)", body = ErrorResponse),
        (status = 404, description = "Room not found", body = ErrorResponse),
    ),
    security(("bearer_auth" = []))
)]
pub async fn retention_preview(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
    body: String,
) -> Result<impl IntoResponse, ApiError> {
    let payload: serde_json::Value = serde_json::from_str(&body)
        .map_err(|_| ApiError::BadRequest("invalid_retention_days".to_string()))?;

    let obj = payload
        .as_object()
        .ok_or_else(|| ApiError::BadRequest("invalid_retention_days".to_string()))?;

    let retention_val = obj
        .get("retention_days")
        .ok_or_else(|| ApiError::BadRequest("invalid_retention_days".to_string()))?;

    let retention_days = retention_val
        .as_i64()
        .ok_or_else(|| ApiError::BadRequest("invalid_retention_days".to_string()))?;

    if !(0..=365).contains(&retention_days) {
        return Err(ApiError::BadRequest("invalid_retention_days".to_string()));
    }

    let room_with_role = rooms::get_room_for_user(&state.pool, &id, &auth.user_id)
        .await?
        .ok_or_else(|| ApiError::NotFound("room_not_found".to_string()))?;

    if room_with_role.current_user_role != "owner" {
        return Err(ApiError::Forbidden("forbidden".to_string()));
    }

    let effective_limits = limits::get_limits(&state.pool, &state.server_hard_max).await?;

    let result = rooms::preview_retention_change(
        &state.pool,
        &id,
        retention_days,
        &effective_limits,
        &state.server_hard_max,
    )
    .await?;

    let mut headers = HeaderMap::new();
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));

    Ok((headers, Json(result)))
}

#[utoipa::path(
    post,
    path = "/api/v1/rooms/{id}/transfer",
    tag = "Rooms",
    description = "Transfers ownership of a room immediately to another member. Note: V3 §3.5 specifies a three-step transfer flow (initiate/accept/cancel); this single-step endpoint is an implementation variation.",
    params(
        ("id" = String, Path, description = "Room ID")
    ),
    request_body = TransferOwnershipRequest,
    responses(
        (status = 204, description = "Room ownership transferred successfully"),
        (status = 401, description = "Unauthorized", body = ErrorResponse),
        (status = 403, description = "Forbidden (non-owner)", body = ErrorResponse),
        (status = 404, description = "Room not found or target user not a member", body = ErrorResponse),
    ),
    security(("bearer_auth" = []))
)]
pub async fn transfer_ownership(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
    Json(payload): Json<TransferOwnershipRequest>,
) -> Result<StatusCode, ApiError> {
    rooms::transfer_ownership(&state.pool, &id, &auth.user_id, &payload.user_id).await?;
    Ok(StatusCode::NO_CONTENT)
}
