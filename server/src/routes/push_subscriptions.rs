use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use utoipa::ToSchema;

use crate::{
    auth::AuthUser,
    push::{self, PushError, PushSubscriptionView, RegisterRequest},
    AppState,
};

#[derive(Debug, Serialize, ToSchema)]
pub struct PushSubscriptionListResponse {
    pub subscriptions: Vec<PushSubscriptionView>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct RegisterSubscriptionBody {
    #[schema(example = "web")]
    pub platform: String,
    pub endpoint: Option<String>,
    pub p256dh: Option<String>,
    pub auth: Option<String>,
    pub push_token: Option<String>,
    pub browser_id: Option<String>,
    pub user_agent: Option<String>,
    pub device_id: Option<String>,
}

use crate::error::ErrorResponse;

#[utoipa::path(
    post,
    path = "/api/v1/users/me/push-subscriptions",
    tag = "User",
    summary = "Register push subscription",
    description = "Registers or updates a push notification subscription for the user (Server Spec v3.0.4 §8.2).",
    security(
        ("bearer_auth" = [])
    ),
    request_body(
        content = RegisterSubscriptionBody,
        description = "Push subscription parameters"
    ),
    responses(
        (status = 201, description = "Push subscription registered", body = PushSubscriptionView),
        (status = 400, description = "Invalid platform or missing field", body = ErrorResponse),
        (status = 401, description = "Unauthorized", body = ErrorResponse),
        (status = 501, description = "Push notifications disabled", body = ErrorResponse)
    )
)]
pub async fn register(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Json(body): Json<RegisterSubscriptionBody>,
) -> Result<(StatusCode, Json<PushSubscriptionView>), (StatusCode, Json<serde_json::Value>)> {
    if !state.config.push_enabled {
        return Err((
            StatusCode::NOT_IMPLEMENTED,
            Json(json!({ "error": "push_disabled" })),
        ));
    }

    let req = RegisterRequest {
        user_id: auth_user.user_id,
        platform: body.platform,
        device_id: body.device_id,
        endpoint: body.endpoint,
        p256dh: body.p256dh,
        auth: body.auth,
        push_token: body.push_token,
        browser_id: body.browser_id,
        user_agent: body.user_agent,
    };

    match push::register_subscription(&state.pool, req).await {
        Ok(view) => Ok((StatusCode::CREATED, Json(view))),
        Err(PushError::InvalidPlatform(received)) => Err((
            StatusCode::BAD_REQUEST,
            Json(json!({
                "error": "invalid_platform",
                "details": {
                    "received": received,
                    "allowed": ["web", "ios", "android", "desktop"]
                }
            })),
        )),
        Err(PushError::MissingField(field)) => Err((
            StatusCode::BAD_REQUEST,
            Json(json!({
                "error": "missing_field",
                "details": {
                    "field": field
                }
            })),
        )),
        Err(_) => Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "internal" })),
        )),
    }
}

#[utoipa::path(
    get,
    path = "/api/v1/users/me/push-subscriptions",
    tag = "User",
    summary = "List push subscriptions",
    description = "Lists all active push subscriptions for the current user (Server Spec v3.0.4 §8.2).",
    security(
        ("bearer_auth" = [])
    ),
    responses(
        (status = 200, description = "Push subscriptions listed", body = PushSubscriptionListResponse),
        (status = 401, description = "Unauthorized", body = ErrorResponse),
        (status = 501, description = "Push notifications disabled", body = ErrorResponse)
    )
)]
pub async fn list(
    State(state): State<AppState>,
    auth_user: AuthUser,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    if !state.config.push_enabled {
        return Err((
            StatusCode::NOT_IMPLEMENTED,
            Json(json!({ "error": "push_disabled" })),
        ));
    }

    match push::list_subscriptions(&state.pool, &auth_user.user_id).await {
        Ok(subscriptions) => Ok(Json(json!({ "subscriptions": subscriptions }))),
        Err(_) => Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "internal" })),
        )),
    }
}

#[utoipa::path(
    delete,
    path = "/api/v1/users/me/push-subscriptions/{id}",
    tag = "User",
    summary = "Revoke push subscription",
    description = "Revokes a specific push subscription for the current user (Server Spec v3.0.4 §8.2).",
    security(
        ("bearer_auth" = [])
    ),
    params(
        ("id" = String, Path, description = "Push subscription ID to revoke")
    ),
    responses(
        (status = 204, description = "Push subscription revoked successfully"),
        (status = 401, description = "Unauthorized", body = ErrorResponse),
        (status = 404, description = "Subscription not found", body = ErrorResponse),
        (status = 501, description = "Push notifications disabled", body = ErrorResponse)
    )
)]
pub async fn revoke(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(id): Path<String>,
) -> Result<StatusCode, (StatusCode, Json<serde_json::Value>)> {
    if !state.config.push_enabled {
        return Err((
            StatusCode::NOT_IMPLEMENTED,
            Json(json!({ "error": "push_disabled" })),
        ));
    }

    match push::revoke_subscription(&state.pool, &auth_user.user_id, &id).await {
        Ok(()) => Ok(StatusCode::NO_CONTENT),
        Err(PushError::NotFound) => Err((
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "subscription_not_found" })),
        )),
        Err(_) => Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "internal" })),
        )),
    }
}
