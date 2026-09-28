use axum::{extract::State, Json};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

use crate::{auth::AuthUser, error::ApiError, sockudo::Publisher};

#[derive(Debug, Deserialize)]
pub struct ChannelAuthRequest {
    pub socket_id: String,
    pub channel_name: String,
}

#[derive(Debug, Serialize)]
pub struct ChannelAuthResponse {
    pub auth: String,
}

pub async fn auth(
    State(pool): State<SqlitePool>,
    State(publisher): State<std::sync::Arc<Publisher>>,
    auth_user: AuthUser,
    Json(payload): Json<ChannelAuthRequest>,
) -> Result<Json<ChannelAuthResponse>, ApiError> {
    // 1. socket_id validation (^\d+\.\d+$)
    let socket_id = payload.socket_id.trim();
    let parts: Vec<&str> = socket_id.split('.').collect();
    if parts.len() != 2
        || parts[0].is_empty()
        || parts[1].is_empty()
        || !parts[0].chars().all(|c| c.is_ascii_digit())
        || !parts[1].chars().all(|c| c.is_ascii_digit())
    {
        return Err(ApiError::BadRequest("invalid_socket_id".to_string()));
    }

    // 2. channel_name validation (^private-room-(.+)$)
    let channel_name = payload.channel_name.trim();
    let room_id = match channel_name.strip_prefix("private-room-") {
        Some(id) if !id.is_empty() => id,
        _ => return Err(ApiError::BadRequest("invalid_channel_name".to_string())),
    };

    // 3. Verify user is a member of the room
    let is_member: Option<(i32,)> =
        sqlx::query_as("SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?")
            .bind(room_id)
            .bind(&auth_user.user_id)
            .fetch_optional(&pool)
            .await?;

    if is_member.is_none() {
        return Err(ApiError::Forbidden("forbidden".to_string()));
    }

    // 4. Sign channel auth
    let auth_str = publisher.sign_channel_auth(socket_id, channel_name);

    Ok(Json(ChannelAuthResponse { auth: auth_str }))
}
