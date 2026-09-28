use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use serde::Serialize;
use sqlx::SqlitePool;

use crate::{
    auth::AuthUser,
    error::ApiError,
    rooms::{self, PendingRemove, RoomError},
};

#[derive(Debug, Serialize)]
pub struct PendingRemovesResponse {
    pub removes: Vec<PendingRemove>,
}

pub async fn list(
    State(pool): State<SqlitePool>,
    auth: AuthUser,
    Path(id): Path<String>,
) -> Result<Json<PendingRemovesResponse>, ApiError> {
    let removes = rooms::list_pending_removes(&pool, &id, &auth.user_id)
        .await
        .map_err(|e| match e {
            RoomError::RoomNotFound | RoomError::NotAMember => {
                ApiError::NotFound("room_not_found".to_string())
            }
            RoomError::Database(err) => ApiError::Internal(err.into()),
            _ => ApiError::BadRequest("invalid_request".to_string()),
        })?;

    Ok(Json(PendingRemovesResponse { removes }))
}

pub async fn consume(
    State(pool): State<SqlitePool>,
    auth: AuthUser,
    Path((id, remove_id)): Path<(String, String)>,
) -> Result<StatusCode, ApiError> {
    rooms::consume_pending_remove(&pool, &id, &remove_id, &auth.user_id)
        .await
        .map_err(|e| match e {
            RoomError::RoomNotFound | RoomError::NotAMember => {
                ApiError::NotFound("room_not_found".to_string())
            }
            RoomError::RemoveNotFound => ApiError::NotFound("remove_not_found".to_string()),
            RoomError::Database(err) => ApiError::Internal(err.into()),
            _ => ApiError::BadRequest("invalid_request".to_string()),
        })?;

    Ok(StatusCode::NO_CONTENT)
}
