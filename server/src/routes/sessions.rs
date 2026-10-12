use crate::auth::AuthUser;
use crate::error::{ApiError, ErrorResponse};
use crate::session;
use crate::AppState;
use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Serialize, ToSchema)]
pub struct SessionResponseItem {
    pub id: String,
    pub device_id: Option<String>,
    #[schema(value_type = String, example = "2026-10-12T00:00:00Z")]
    pub created_at: DateTime<Utc>,
    #[schema(value_type = String, example = "2026-10-12T00:00:00Z")]
    pub expires_at: DateTime<Utc>,
    #[schema(value_type = Option<String>, example = "2026-10-12T00:00:00Z")]
    pub last_seen_at: Option<DateTime<Utc>>,
    pub is_current: bool,
}

#[derive(Serialize, ToSchema)]
pub struct SessionListResponse {
    pub sessions: Vec<SessionResponseItem>,
}

#[derive(Deserialize, Default, ToSchema)]
pub struct LogoutRequest {
    #[serde(default)]
    pub all_sessions: bool,
}

#[utoipa::path(
    get,
    path = "/api/v1/users/me/sessions",
    tag = "User",
    summary = "List active user sessions",
    description = "Lists all active session tokens for the current user (Server Spec v3.0.4 §8.2).",
    security(
        ("bearer_auth" = [])
    ),
    responses(
        (status = 200, description = "Sessions listed successfully", body = SessionListResponse),
        (status = 401, description = "Unauthorized", body = ErrorResponse)
    )
)]
pub async fn list(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<SessionListResponse>, ApiError> {
    let sessions = session::list_sessions(&state.pool, &auth.user_id).await?;

    let items = sessions
        .into_iter()
        .map(|s| SessionResponseItem {
            is_current: s.id == auth.session_id,
            id: s.id,
            device_id: s.device_id,
            created_at: s.created_at,
            expires_at: s.expires_at,
            last_seen_at: s.last_seen_at,
        })
        .collect();

    Ok(Json(SessionListResponse { sessions: items }))
}

#[utoipa::path(
    delete,
    path = "/api/v1/users/me/sessions/{id}",
    tag = "User",
    summary = "Revoke session",
    description = "Revokes a specific session token for the current user (Server Spec v3.0.4 §8.2).",
    security(
        ("bearer_auth" = [])
    ),
    params(
        ("id" = String, Path, description = "Session ID to revoke")
    ),
    responses(
        (status = 204, description = "Session revoked successfully"),
        (status = 400, description = "Cannot revoke current session", body = ErrorResponse),
        (status = 401, description = "Unauthorized", body = ErrorResponse),
        (status = 404, description = "Session not found", body = ErrorResponse)
    )
)]
pub async fn revoke(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(target_session_id): Path<String>,
) -> Result<StatusCode, ApiError> {
    if target_session_id == auth.session_id {
        return Err(ApiError::BadRequest(
            "cannot_revoke_current_session".to_string(),
        ));
    }

    let revoked = session::revoke_session(&state.pool, &auth.user_id, &target_session_id).await?;

    if !revoked {
        return Err(ApiError::NotFound("session_not_found".to_string()));
    }

    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(
    post,
    path = "/api/v1/auth/logout",
    tag = "User",
    summary = "Logout session",
    description = "Revokes current session (or all sessions if all_sessions is true) (Server Spec v3.0.4 §8.2).",
    security(
        ("bearer_auth" = [])
    ),
    request_body(
        content = Option<LogoutRequest>,
        description = "Logout options"
    ),
    responses(
        (status = 204, description = "Logged out successfully"),
        (status = 401, description = "Unauthorized", body = ErrorResponse)
    )
)]
pub async fn logout(
    State(state): State<AppState>,
    auth: AuthUser,
    body: Option<Json<LogoutRequest>>,
) -> Result<StatusCode, ApiError> {
    let all_sessions = body.map(|b| b.all_sessions).unwrap_or(false);

    if all_sessions {
        session::revoke_all_sessions(&state.pool, &auth.user_id, Some(&auth.session_id)).await?;
        session::revoke_session(&state.pool, &auth.user_id, &auth.session_id).await?;
    } else {
        session::revoke_session(&state.pool, &auth.user_id, &auth.session_id).await?;
    }

    Ok(StatusCode::NO_CONTENT)
}
