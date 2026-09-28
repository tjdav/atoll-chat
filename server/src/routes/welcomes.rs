use axum::{
    extract::{Path, State},
    Json,
};
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use serde::Serialize;

use crate::{
    auth::AuthUser,
    error::ApiError,
    welcomes::{self, WelcomeError, WelcomeView},
    AppState,
};

#[derive(Debug, Serialize)]
pub struct WelcomesListResponse {
    pub welcomes: Vec<WelcomeView>,
}

#[derive(Debug, Serialize)]
pub struct WelcomeDetailResponse {
    pub id: String,
    pub room_id: String,
    pub recipient_user_id: String,
    pub recipient_client_id: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub consumed: bool,
    pub welcome_data: String,
}

#[derive(Debug, Serialize)]
pub struct ConsumeWelcomeResponse {
    pub id: String,
    pub room_id: String,
    pub consumed: bool,
}

pub async fn list(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<WelcomesListResponse>, ApiError> {
    let welcomes = welcomes::list_pending(&state.pool, &auth.user_id)
        .await
        .map_err(|e| match e {
            WelcomeError::Database(err) => ApiError::Internal(err.into()),
            _ => ApiError::BadRequest("invalid_request".to_string()),
        })?;

    Ok(Json(WelcomesListResponse { welcomes }))
}

pub async fn get(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
) -> Result<Json<WelcomeDetailResponse>, ApiError> {
    let (view, data_bytes) = welcomes::get_welcome_data(&state.pool, &auth.user_id, &id)
        .await
        .map_err(|e| match e {
            WelcomeError::NotFound => ApiError::NotFound("welcome_not_found".to_string()),
            WelcomeError::Database(err) => ApiError::Internal(err.into()),
            _ => ApiError::BadRequest("invalid_request".to_string()),
        })?;

    let welcome_data_b64 = BASE64.encode(data_bytes);

    Ok(Json(WelcomeDetailResponse {
        id: view.id,
        room_id: view.room_id,
        recipient_user_id: view.recipient_user_id,
        recipient_client_id: view.recipient_client_id,
        created_at: view.created_at,
        consumed: view.consumed,
        welcome_data: welcome_data_b64,
    }))
}

pub async fn consume(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
) -> Result<Json<ConsumeWelcomeResponse>, ApiError> {
    let view = welcomes::consume_welcome(&state.pool, &auth.user_id, &id)
        .await
        .map_err(|e| match e {
            WelcomeError::NotFound => ApiError::NotFound("welcome_not_found".to_string()),
            WelcomeError::AlreadyConsumed => ApiError::Conflict("already_consumed".to_string()),
            WelcomeError::Database(err) => ApiError::Internal(err.into()),
        })?;

    Ok(Json(ConsumeWelcomeResponse {
        id: view.id,
        room_id: view.room_id,
        consumed: view.consumed,
    }))
}
