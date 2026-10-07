use axum::{
    extract::{Path, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    Json,
};
use serde::Serialize;

use crate::{
    auth::AuthUser,
    error::ApiError,
    rooms::{self, PendingRemove},
    AppState,
};

#[derive(Debug, Serialize)]
pub struct ListPendingRemovesResponse {
    pub removes: Vec<PendingRemove>,
}

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
