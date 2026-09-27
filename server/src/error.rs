use crate::devices::DeviceError;
use crate::invites::InviteError;
use crate::limits::LimitsError;
use crate::rate_limit::RateLimitError;
use crate::rooms::RoomError;
use crate::session::SessionError;
use axum::{
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use chrono::{DateTime, Utc};
use serde_json::json;
use tracing::error;

#[allow(dead_code)]
pub enum ApiError {
    NotFound(String),
    BadRequest(String),
    Unauthorized(String),
    Forbidden(String),
    Conflict(String),
    TooManyRequests {
        message: String,
        reset_at: DateTime<Utc>,
    },
    InternalCustom(StatusCode, String),
    Internal(anyhow::Error),
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        match self {
            ApiError::TooManyRequests { message, reset_at } => {
                let now = Utc::now();
                let retry_after = (reset_at - now).num_seconds().max(1);
                let body = Json(json!({
                    "error": "rate_limited",
                    "message": message,
                    "details": {
                        "reset_at": reset_at.to_rfc3339()
                    }
                }));
                (
                    StatusCode::TOO_MANY_REQUESTS,
                    [(header::RETRY_AFTER, retry_after.to_string())],
                    body,
                )
                    .into_response()
            }
            _ => {
                let (status, err_msg) = match self {
                    ApiError::NotFound(msg) => (StatusCode::NOT_FOUND, msg),
                    ApiError::BadRequest(msg) => (StatusCode::BAD_REQUEST, msg),
                    ApiError::Unauthorized(msg) => (StatusCode::UNAUTHORIZED, msg),
                    ApiError::Forbidden(msg) => (StatusCode::FORBIDDEN, msg),
                    ApiError::Conflict(msg) => (StatusCode::CONFLICT, msg),
                    ApiError::InternalCustom(status, msg) => (status, msg),
                    ApiError::Internal(err) => {
                        error!("Internal server error: {:#}", err);
                        (
                            StatusCode::INTERNAL_SERVER_ERROR,
                            "internal server error".to_string(),
                        )
                    }
                    ApiError::TooManyRequests { .. } => unreachable!(),
                };

                let body = Json(json!({
                    "error": err_msg,
                }));

                (status, body).into_response()
            }
        }
    }
}

// Implement From<LimitsError> for ApiError
impl From<LimitsError> for ApiError {
    fn from(err: LimitsError) -> Self {
        match err {
            LimitsError::Database(e) => ApiError::Internal(e.into()),
            LimitsError::ExceedsServerMax { .. } | LimitsError::BelowMinimum { .. } => {
                ApiError::BadRequest(err.to_string())
            }
        }
    }
}

// Implement From<RoomError> for ApiError
impl From<RoomError> for ApiError {
    fn from(err: RoomError) -> Self {
        match err {
            RoomError::Database(e) => ApiError::Internal(e.into()),
            RoomError::RoomNotFound | RoomError::NotAMember => {
                ApiError::NotFound("room_not_found".to_string())
            }
            RoomError::Forbidden => ApiError::Forbidden("forbidden".to_string()),
            RoomError::RoomFull => ApiError::Conflict("room_full".to_string()),
            RoomError::UserNotFound => ApiError::NotFound("user_not_found".to_string()),
            RoomError::AlreadyMember => ApiError::Conflict("already_member".to_string()),
            RoomError::RoomLimitReached => ApiError::Conflict("room_limit_reached".to_string()),
            RoomError::InvalidRetention => ApiError::BadRequest("invalid_retention".to_string()),
            RoomError::InvalidFileSize => ApiError::BadRequest("invalid_file_size".to_string()),
        }
    }
}

// Implement From<anyhow::Error> for ApiError
impl From<anyhow::Error> for ApiError {
    fn from(err: anyhow::Error) -> Self {
        ApiError::Internal(err)
    }
}

// Implement From<sqlx::Error> for ApiError
impl From<sqlx::Error> for ApiError {
    fn from(err: sqlx::Error) -> Self {
        ApiError::Internal(err.into())
    }
}

// Implement From<SessionError> for ApiError
impl From<SessionError> for ApiError {
    fn from(err: SessionError) -> Self {
        match err {
            SessionError::Database(e) => ApiError::Internal(e.into()),
            SessionError::TokenGeneration(msg) => ApiError::Internal(anyhow::anyhow!(msg)),
        }
    }
}

// Implement From<DeviceError> for ApiError
impl From<DeviceError> for ApiError {
    fn from(err: DeviceError) -> Self {
        match err {
            DeviceError::Database(e) => ApiError::Internal(e.into()),
            DeviceError::DeviceLimitExceeded { .. } => {
                ApiError::BadRequest("device_limit_exceeded".to_string())
            }
            DeviceError::NotFound => ApiError::NotFound("device_not_found".to_string()),
        }
    }
}

// Implement From<RateLimitError> for ApiError
impl From<RateLimitError> for ApiError {
    fn from(err: RateLimitError) -> Self {
        match err {
            RateLimitError::Database(e) => ApiError::Internal(e.into()),
            RateLimitError::InvalidKey(msg) => ApiError::BadRequest(msg),
        }
    }
}

// Implement From<InviteError> for ApiError
impl From<InviteError> for ApiError {
    fn from(err: InviteError) -> Self {
        match err {
            InviteError::Database(e) => ApiError::Internal(e.into()),
            InviteError::NotFound => ApiError::NotFound("invite_not_found".to_string()),
            InviteError::Revoked => ApiError::Forbidden("invite_revoked".to_string()),
            InviteError::Expired => ApiError::Forbidden("invite_expired".to_string()),
            InviteError::Exhausted => ApiError::Forbidden("invite_exhausted".to_string()),
            InviteError::CodeGenerationFailed => {
                ApiError::Internal(anyhow::anyhow!("failed to generate invite code"))
            }
        }
    }
}
