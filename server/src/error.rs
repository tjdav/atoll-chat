use crate::session::SessionError;
use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;
use tracing::error;

#[allow(dead_code)]
pub enum ApiError {
    NotFound(String),
    BadRequest(String),
    Unauthorized(String),
    Forbidden(String),
    Conflict(String),
    InternalCustom(StatusCode, String),
    Internal(anyhow::Error),
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
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
        };

        let body = Json(json!({
            "error": err_msg,
        }));

        (status, body).into_response()
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
