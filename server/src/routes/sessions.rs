use crate::auth::AuthUser;
use crate::error::ApiError;
use crate::session;
use crate::AppState;
use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Serialize)]
pub struct SessionResponseItem {
    pub id: String,
    pub device_id: Option<String>,
    pub created_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
    pub last_seen_at: Option<DateTime<Utc>>,
    pub is_current: bool,
}

#[derive(Serialize)]
pub struct SessionListResponse {
    pub sessions: Vec<SessionResponseItem>,
}

#[derive(Deserialize, Default)]
pub struct LogoutRequest {
    #[serde(default)]
    pub all_sessions: bool,
}

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
