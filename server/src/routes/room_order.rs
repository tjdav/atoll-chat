use axum::{
    extract::State,
    http::{header, HeaderMap, HeaderValue, StatusCode},
    Json,
};
use serde::Deserialize;

use crate::{
    auth::AuthUser,
    error::ApiError,
    limits,
    sync::{self, RoomOrderError, RoomOrderSyncState},
    AppState,
};

#[derive(Debug, Deserialize)]
pub struct PatchRoomOrderRequest {
    pub room_ids: Vec<String>,
}

pub async fn patch_room_order(
    State(state): State<AppState>,
    auth: AuthUser,
    body_val: Json<serde_json::Value>,
) -> Result<(HeaderMap, Json<RoomOrderSyncState>), ApiError> {
    let body_obj = match body_val.as_object() {
        Some(obj) => obj,
        None => return Err(ApiError::BadRequest("invalid_room_ids".to_string())),
    };

    if !body_obj.contains_key("room_ids") || !body_obj["room_ids"].is_array() {
        return Err(ApiError::BadRequest("invalid_room_ids".to_string()));
    }

    let req: PatchRoomOrderRequest = serde_json::from_value(body_val.0)
        .map_err(|_| ApiError::BadRequest("invalid_room_ids".to_string()))?;

    let instance_limits = limits::get_limits(&state.pool, &state.server_hard_max)
        .await
        .map_err(|e| ApiError::Internal(e.into()))?;

    let state_res = sync::set_room_order(
        &state.pool,
        &state.publisher,
        &auth.user_id,
        req.room_ids,
        instance_limits.rooms_per_user as usize,
    )
    .await
    .map_err(|e| match e {
        RoomOrderError::DuplicateRoomIds => ApiError::BadRequest("invalid_room_ids".to_string()),
        RoomOrderError::NotAMember(room_id) => ApiError::InternalWithDetails(
            StatusCode::FORBIDDEN,
            "not_a_member".to_string(),
            serde_json::json!({ "room_id": room_id }),
        ),
        RoomOrderError::TooManyRooms(limit, count) => ApiError::InternalWithDetails(
            StatusCode::BAD_REQUEST,
            "too_many_rooms".to_string(),
            serde_json::json!({ "limit": limit, "count": count }),
        ),
        RoomOrderError::Database(err) => ApiError::Internal(err.into()),
    })?;

    let mut headers = HeaderMap::new();
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));

    Ok((headers, Json(state_res)))
}
