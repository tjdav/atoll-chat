use axum::{extract::State, Json};
use serde::{Deserialize, Serialize};

use crate::{auth::AuthUser, error::ApiError, rooms, AppState};

#[derive(Debug, Deserialize)]
pub struct AuthRequest {
    pub socket_id: String,
    pub channel_name: String,
}

#[derive(Debug, Serialize)]
pub struct AuthResponse {
    pub auth: String,
}

fn is_valid_socket_id(socket_id: &str) -> bool {
    let parts: Vec<&str> = socket_id.split('.').collect();
    if parts.len() != 2 {
        return false;
    }
    if parts[0].is_empty() || parts[1].is_empty() {
        return false;
    }
    parts[0].chars().all(|c| c.is_ascii_digit()) && parts[1].chars().all(|c| c.is_ascii_digit())
}

pub async fn auth(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(payload): Json<AuthRequest>,
) -> Result<Json<AuthResponse>, ApiError> {
    if !is_valid_socket_id(&payload.socket_id) {
        return Err(ApiError::BadRequest("invalid_socket_id".to_string()));
    }

    let room_id = match payload.channel_name.strip_prefix("private-room-") {
        Some(id) if !id.is_empty() => id,
        _ => return Err(ApiError::BadRequest("invalid_channel_name".to_string())),
    };

    let room = rooms::get_room_for_user(&state.pool, room_id, &auth.user_id).await?;
    if room.is_none() {
        return Err(ApiError::Forbidden("forbidden".to_string()));
    }

    let auth_str = state
        .publisher
        .sign_channel_auth(&payload.socket_id, &payload.channel_name);

    Ok(Json(AuthResponse { auth: auth_str }))
}
