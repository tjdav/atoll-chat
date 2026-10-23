use axum::{
    extract::{Path, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    Json,
};
use serde::Serialize;
use utoipa::ToSchema;

use crate::{
    auth::AuthUser,
    error::{ApiError, ErrorResponse},
    rooms::{self, PendingRemove},
    AppState,
};

#[derive(Debug, Serialize, ToSchema)]
pub struct ListPendingRemovesResponse {
    pub removes: Vec<PendingRemove>,
}

#[utoipa::path(
    get,
    path = "/api/v1/rooms/{id}/pending-removes",
    tag = "Rooms",
    params(
        ("id" = String, Path, description = "Room ID")
    ),
    responses(
        (status = 200, description = "List of pending MLS removes", body = ListPendingRemovesResponse),
        (status = 401, description = "Unauthorized", body = ErrorResponse),
        (status = 404, description = "Room not found or not a member", body = ErrorResponse),
    ),
    security(("bearer_auth" = []))
)]
pub async fn list(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
) -> Result<(HeaderMap, Json<ListPendingRemovesResponse>), ApiError> {
    let removes = rooms::list_pending_removes(&state.pool, &id, &auth.user_id).await?;
    let mut headers = HeaderMap::new();
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    Ok((headers, Json(ListPendingRemovesResponse { removes })))
}

#[utoipa::path(
    post,
    path = "/api/v1/rooms/{id}/pending-removes/{remove_id}/consume",
    tag = "Rooms",
    params(
        ("id" = String, Path, description = "Room ID"),
        ("remove_id" = String, Path, description = "Pending remove ID")
    ),
    responses(
        (status = 204, description = "Pending remove consumed successfully"),
        (status = 401, description = "Unauthorized", body = ErrorResponse),
        (status = 404, description = "Room not found, remove not found, or not a member", body = ErrorResponse),
    ),
    security(("bearer_auth" = []))
)]
pub async fn consume(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((id, remove_id)): Path<(String, String)>,
) -> Result<StatusCode, ApiError> {
    rooms::consume_pending_remove(
        &state.pool,
        &state.publisher,
        &id,
        &remove_id,
        &auth.user_id,
    )
    .await?;
    Ok(StatusCode::NO_CONTENT)
}
