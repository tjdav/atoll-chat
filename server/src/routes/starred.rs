use crate::auth::AuthUser;
use crate::error::{ApiError, ErrorResponse};
use crate::rate_limit::{self, RateLimitKey};
use crate::starred::list::{
    list_starred_items, ListStarError, ListStarQuery, ListStarredItemsResponse,
};
use crate::starred::write::{star_item, unstar_item, StarError, StarRequest};
use crate::starred::StarredItemView;
use crate::AppState;
use axum::extract::{Path, Query, State};
use axum::http::HeaderMap;
use axum::response::IntoResponse;
use axum::Json;
use serde::Deserialize;
use utoipa::IntoParams;

#[derive(Debug, Deserialize, IntoParams)]
pub struct UnstarQuery {
    pub item_type: Option<String>,
}

#[utoipa::path(
    post,
    path = "/api/v1/users/me/starred-items",
    tag = "User",
    summary = "Star an item",
    description = "Stars a message, attachment, or link item (Server Spec v3.0.4 §8.2, §8.2.9).",
    security(
        ("bearer_auth" = [])
    ),
    request_body(
        content = StarRequest,
        description = "Star request parameters"
    ),
    responses(
        (status = 200, description = "Item already starred", body = StarredItemView),
        (status = 201, description = "Item starred successfully", body = StarredItemView),
        (status = 400, description = "Invalid item type", body = ErrorResponse),
        (status = 401, description = "Unauthorized", body = ErrorResponse),
        (status = 404, description = "Room or starred item not found", body = ErrorResponse),
        (status = 409, description = "Starred items limit reached", body = ErrorResponse),
        (status = 429, description = "Rate limit exceeded", body = ErrorResponse)
    )
)]
pub async fn post_star(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(req): Json<StarRequest>,
) -> Result<impl IntoResponse, ApiError> {
    let rate_key = RateLimitKey::Edit {
        user_id: auth.user_id.clone(),
    };
    let decision = rate_limit::check(&state.pool, &state.config.rate_limits, rate_key).await?;

    if !decision.allowed {
        return Err(ApiError::TooManyRequests {
            message: "rate limited".to_string(),
            reset_at: decision.reset_at,
        });
    }

    let (row, is_created) = star_item(
        &state.pool,
        &state.publisher,
        &auth.user_id,
        req,
        state.config.max_starred_items_per_user,
    )
    .await
    .map_err(|e| match e {
        StarError::InvalidItemType => ApiError::BadRequest("invalid_item_type".to_string()),
        StarError::RoomNotFound => ApiError::NotFound("room_not_found".to_string()),
        StarError::LimitReached => ApiError::Conflict("starred_items_limit_reached".to_string()),
        StarError::StarredItemNotFound => ApiError::NotFound("starred_item_not_found".to_string()),
        StarError::Database(err) => ApiError::Internal(err.into()),
    })?;

    let view = StarredItemView::from(row);
    let status = if is_created {
        axum::http::StatusCode::CREATED
    } else {
        axum::http::StatusCode::OK
    };

    let mut headers = HeaderMap::new();
    headers.insert("Cache-Control", "no-store".parse().unwrap());

    Ok((status, headers, Json(view)))
}

#[utoipa::path(
    delete,
    path = "/api/v1/users/me/starred-items/{item_id}",
    tag = "User",
    summary = "Unstar an item",
    description = "Removes a star from an item (Server Spec v3.0.4 §8.2, §8.2.9).",
    security(
        ("bearer_auth" = [])
    ),
    params(
        ("item_id" = String, Path, description = "Target item ID to unstar"),
        UnstarQuery
    ),
    responses(
        (status = 204, description = "Item unstarred successfully"),
        (status = 400, description = "Invalid item type", body = ErrorResponse),
        (status = 401, description = "Unauthorized", body = ErrorResponse),
        (status = 404, description = "Starred item not found", body = ErrorResponse),
        (status = 429, description = "Rate limit exceeded", body = ErrorResponse)
    )
)]
pub async fn delete_star(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(item_id): Path<String>,
    Query(query): Query<UnstarQuery>,
) -> Result<impl IntoResponse, ApiError> {
    let item_type = match query.item_type {
        Some(t) if !t.is_empty() => t,
        _ => return Err(ApiError::BadRequest("invalid_item_type".to_string())),
    };

    let rate_key = RateLimitKey::Edit {
        user_id: auth.user_id.clone(),
    };
    let decision = rate_limit::check(&state.pool, &state.config.rate_limits, rate_key).await?;

    if !decision.allowed {
        return Err(ApiError::TooManyRequests {
            message: "rate limited".to_string(),
            reset_at: decision.reset_at,
        });
    }

    unstar_item(
        &state.pool,
        &state.publisher,
        &auth.user_id,
        &item_id,
        &item_type,
    )
    .await
    .map_err(|e| match e {
        StarError::InvalidItemType => ApiError::BadRequest("invalid_item_type".to_string()),
        StarError::StarredItemNotFound => ApiError::NotFound("starred_item_not_found".to_string()),
        StarError::RoomNotFound => ApiError::NotFound("room_not_found".to_string()),
        StarError::LimitReached => ApiError::Conflict("starred_items_limit_reached".to_string()),
        StarError::Database(err) => ApiError::Internal(err.into()),
    })?;

    let mut headers = HeaderMap::new();
    headers.insert("Cache-Control", "no-store".parse().unwrap());

    Ok((axum::http::StatusCode::NO_CONTENT, headers))
}

#[utoipa::path(
    get,
    path = "/api/v1/users/me/starred-items",
    tag = "User",
    summary = "List starred items",
    description = "Lists starred items with optional type, room, limit, and cursor filtering (Server Spec v3.0.4 §8.2, §8.2.9).",
    security(
        ("bearer_auth" = [])
    ),
    params(
        ListStarQuery
    ),
    responses(
        (status = 200, description = "Starred items listed successfully", body = ListStarredItemsResponse),
        (status = 400, description = "Invalid item type or invalid cursor", body = ErrorResponse),
        (status = 401, description = "Unauthorized", body = ErrorResponse)
    )
)]
pub async fn get_starred_items(
    State(state): State<AppState>,
    auth: AuthUser,
    Query(query): Query<ListStarQuery>,
) -> Result<impl IntoResponse, ApiError> {
    let res = list_starred_items(&state.pool, &auth.user_id, query)
        .await
        .map_err(|e| match e {
            ListStarError::InvalidItemType => ApiError::BadRequest("invalid_item_type".to_string()),
            ListStarError::InvalidCursor => ApiError::BadRequest("invalid_cursor".to_string()),
            ListStarError::Database(err) => ApiError::Internal(err.into()),
        })?;

    let mut headers = HeaderMap::new();
    headers.insert("Cache-Control", "no-store".parse().unwrap());

    Ok((axum::http::StatusCode::OK, headers, Json(res)))
}
