use crate::error::ApiError;
use crate::session;
use crate::AppState;
use axum::{
    extract::{FromRef, FromRequestParts},
    http::{header, request::Parts, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use chrono::{DateTime, NaiveDateTime, Utc};
use serde_json::json;
use sqlx::Row;
use tracing::{error, warn};

#[derive(Clone, Debug)]
pub struct AuthUser {
    pub user_id: String,
    pub session_id: String,
    pub device_id: Option<String>,
    pub username: String,
    pub display_name: Option<String>,
    pub expires_at: DateTime<Utc>,
}

pub enum AuthError {
    Unauthorized,
    AccountDisabled,
    Internal(anyhow::Error),
}

impl IntoResponse for AuthError {
    fn into_response(self) -> Response {
        match self {
            AuthError::Unauthorized => (
                StatusCode::UNAUTHORIZED,
                Json(json!({ "error": "unauthorized" })),
            )
                .into_response(),
            AuthError::AccountDisabled => (
                StatusCode::UNAUTHORIZED,
                Json(json!({ "error": "account_disabled" })),
            )
                .into_response(),
            AuthError::Internal(err) => {
                error!("Internal auth error: {:#}", err);
                ApiError::Internal(err).into_response()
            }
        }
    }
}

impl<S> FromRequestParts<S> for AuthUser
where
    S: Send + Sync,
    AppState: FromRef<S>,
{
    type Rejection = Response;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let state = AppState::from_ref(state);

        // 1. Read Authorization header
        let auth_header = match parts.headers.get(header::AUTHORIZATION) {
            Some(val) => match val.to_str() {
                Ok(s) => s,
                Err(_) => return Err(AuthError::Unauthorized.into_response()),
            },
            None => return Err(AuthError::Unauthorized.into_response()),
        };

        // 2. Extract Bearer token
        let raw_token = if let Some(token) = auth_header.strip_prefix("Bearer ") {
            let trimmed = token.trim();
            if trimmed.is_empty() {
                return Err(AuthError::Unauthorized.into_response());
            }
            trimmed
        } else {
            return Err(AuthError::Unauthorized.into_response());
        };

        // 3. Validate session
        let session_ctx = match session::validate_session(&state.pool, raw_token).await {
            Ok(Some(ctx)) => ctx,
            Ok(None) => return Err(AuthError::Unauthorized.into_response()),
            Err(e) => return Err(AuthError::Internal(e.into()).into_response()),
        };

        // 4. Query user from DB
        let user_row =
            match sqlx::query("SELECT username, display_name, disabled_at FROM users WHERE id = ?")
                .bind(&session_ctx.user_id)
                .fetch_optional(&state.pool)
                .await
            {
                Ok(Some(row)) => row,
                Ok(None) => {
                    // User missing: revoke session best-effort and return 401 unauthorized
                    if let Err(e) = session::revoke_session(
                        &state.pool,
                        &session_ctx.user_id,
                        &session_ctx.session_id,
                    )
                    .await
                    {
                        warn!(
                            "failed to revoke session for missing user {}: {}",
                            session_ctx.user_id, e
                        );
                    }
                    return Err(AuthError::Unauthorized.into_response());
                }
                Err(e) => return Err(AuthError::Internal(e.into()).into_response()),
            };

        let disabled_at: Option<DateTime<Utc>> = user_row.get("disabled_at");
        if disabled_at.is_some() {
            // Disabled user: revoke session best-effort and return 401 account_disabled
            if let Err(e) =
                session::revoke_session(&state.pool, &session_ctx.user_id, &session_ctx.session_id)
                    .await
            {
                warn!(
                    "failed to revoke session for disabled user {}: {}",
                    session_ctx.user_id, e
                );
            }
            return Err(AuthError::AccountDisabled.into_response());
        }

        let username: String = user_row.get("username");
        let display_name: Option<String> = user_row.get("display_name");

        let expires_at_dt = parse_datetime(&session_ctx.expires_at).unwrap_or_else(Utc::now);

        Ok(AuthUser {
            user_id: session_ctx.user_id,
            session_id: session_ctx.session_id,
            device_id: session_ctx.device_id,
            username,
            display_name,
            expires_at: expires_at_dt,
        })
    }
}

fn parse_datetime(s: &str) -> Option<DateTime<Utc>> {
    if let Ok(dt) = DateTime::parse_from_rfc3339(s) {
        return Some(dt.with_timezone(&Utc));
    }
    if let Ok(ndt) = NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S") {
        return Some(DateTime::from_naive_utc_and_offset(ndt, Utc));
    }
    None
}
