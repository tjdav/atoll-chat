use axum::{extract::State, Json};
use serde::{Deserialize, Serialize};

use utoipa::ToSchema;

use crate::{auth::AuthUser, error::ApiError, error::ErrorResponse, rate_limit, rooms, AppState};

#[derive(Debug, Deserialize, ToSchema)]
pub struct AuthRequest {
    pub socket_id: String,
    pub channel_name: String,
}

#[derive(Debug, Serialize, ToSchema)]
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

#[utoipa::path(
    post,
    path = "/ws/auth",
    tag = "Public",
    summary = "WebSocket channel authentication",
    description = "Authenticate WebSocket channel subscription (Server Spec v3.0.4 §8.1.6). Mounted at reverse-proxy root outside /api/v1/ (default /ws/auth, configurable via WEBSOCKET_AUTH_PATH). Accepts both user session tokens and bot tokens.",
    request_body = AuthRequest,
    responses(
        (status = 200, description = "Channel authentication signature generated", body = AuthResponse),
        (status = 400, description = "Invalid socket ID or channel name", body = ErrorResponse),
        (status = 401, description = "Authentication required", body = ErrorResponse),
        (status = 403, description = "Forbidden: user or bot not authorized for channel", body = ErrorResponse)
    ),
    security(
        ("bearer_auth" = [])
    )
)]
pub async fn auth_handler(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(payload): Json<AuthRequest>,
) -> Result<Json<AuthResponse>, ApiError> {
    let rate_decision = rate_limit::check(
        &state.pool,
        &state.config.rate_limits,
        rate_limit::RateLimitKey::WebSocketAuth {
            identity: auth.user_id.clone(),
        },
    )
    .await?;

    if !rate_decision.allowed {
        return Err(ApiError::TooManyRequests {
            message: "rate_limit_exceeded".to_string(),
            reset_at: rate_decision.reset_at,
        });
    }

    if !is_valid_socket_id(&payload.socket_id) {
        return Err(ApiError::BadRequest("invalid_socket_id".to_string()));
    }

    if let Some(room_id) = payload.channel_name.strip_prefix("private-room-") {
        if room_id.is_empty() {
            return Err(ApiError::BadRequest("invalid_channel_name".to_string()));
        }

        let room = rooms::get_room_for_user(&state.pool, room_id, &auth.user_id).await?;
        if room.is_none() {
            return Err(ApiError::Forbidden("forbidden".to_string()));
        }
    } else if let Some(target_user_id) = payload.channel_name.strip_prefix("private-user-") {
        if target_user_id.is_empty() {
            return Err(ApiError::BadRequest("invalid_channel_name".to_string()));
        }

        if target_user_id != auth.user_id {
            return Err(ApiError::Forbidden("forbidden".to_string()));
        }
    } else {
        return Err(ApiError::BadRequest("invalid_channel_name".to_string()));
    }

    let auth_str = state
        .publisher
        .sign_channel_auth(&payload.socket_id, &payload.channel_name);

    Ok(Json(AuthResponse { auth: auth_str }))
}
