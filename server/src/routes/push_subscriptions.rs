use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use serde::Deserialize;
use serde_json::json;

use crate::{
    auth::AuthUser,
    push::{self, PushError, PushSubscriptionView, RegisterRequest},
    AppState,
};

#[derive(Debug, Deserialize)]
pub struct RegisterSubscriptionBody {
    pub platform: String,
    pub endpoint: Option<String>,
    pub p256dh: Option<String>,
    pub auth: Option<String>,
    pub push_token: Option<String>,
    pub browser_id: Option<String>,
    pub user_agent: Option<String>,
    pub device_id: Option<String>,
}

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
