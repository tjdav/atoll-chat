use axum::{
    extract::{Query, State},
    http::{header, HeaderMap, HeaderValue},
    Json,
};
use serde::Deserialize;
use utoipa::IntoParams;

use crate::{
    auth::AuthUser,
    error::{ApiError, ErrorResponse},
    sync::{self, SyncQuery, SyncResponse},
    AppState,
};

#[derive(Debug, Deserialize, IntoParams)]
pub struct GetSyncQuery {
    #[param(example = 0)]
    pub since_seq: Option<i64>,
}

#[utoipa::path(
    get,
    path = "/api/v1/users/me/sync",
    tag = "User",
    summary = "Synchronize user state",
    description = "Fetches user-scoped state updates since a given sequence cursor (Server Spec v3.0.4 §8.2, §8.2.4).",
    security(
        ("bearer_auth" = [])
    ),
    params(
        GetSyncQuery
    ),
    responses(
        (status = 200, description = "State synchronized successfully", body = SyncResponse),
        (status = 400, description = "Invalid since_seq parameter", body = ErrorResponse),
        (status = 401, description = "Unauthorized", body = ErrorResponse)
    )
)]
pub async fn get_sync(
    State(state): State<AppState>,
    auth: AuthUser,
    Query(query): Query<GetSyncQuery>,
) -> Result<(HeaderMap, Json<SyncResponse>), ApiError> {
    let since_seq = match query.since_seq {
        Some(seq) if seq >= 0 => seq,
        _ => return Err(ApiError::BadRequest("invalid_since_seq".to_string())),
    };

    let sync_query = SyncQuery {
        user_id: auth.user_id,
        since_seq,
        retention_days: state.config.sync_event_retention_days,
    };

    let response = sync::execute_sync(&state.pool, sync_query)
        .await
        .map_err(|e| match e {
            sync::SyncError::InvalidCursor(msg) => ApiError::BadRequest(msg),
            sync::SyncError::Database(err) => ApiError::Internal(err.into()),
            sync::SyncError::Serialization(msg) => ApiError::Internal(anyhow::anyhow!(msg)),
            sync::SyncError::ReadState(err) => ApiError::Internal(err.into()),
            sync::SyncError::Preferences(err) => ApiError::Internal(err.into()),
            sync::SyncError::RoomOrder(err) => ApiError::Internal(err.into()),
        })?;

    let mut headers = HeaderMap::new();
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));

    Ok((headers, Json(response)))
}
