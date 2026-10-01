use crate::auth::AuthUser;
use crate::devices;
use crate::error::ApiError;
use crate::rate_limit::{self, RateLimitKey};
use crate::sync::device_names::{self, DeviceStateRow, WriteRequest};
use crate::AppState;
use axum::{
    extract::{Path, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    Json,
};
use chrono::{DateTime, Utc};
use serde::Serialize;
use serde_json::Value;

#[derive(Debug, Serialize)]
pub struct DeviceResponse {
    pub id: String,
    pub client_id: String,
    pub encrypted_device_name: Option<String>,
    pub created_at: DateTime<Utc>,
    pub last_seen: Option<DateTime<Utc>>,
    pub is_current: bool,
}

#[derive(Debug, Serialize)]
pub struct ListDevicesResponse {
    pub devices: Vec<DeviceResponse>,
}

pub async fn list(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<ListDevicesResponse>, ApiError> {
    let device_list = devices::list_devices(&state.pool, &auth.user_id).await?;

    let items = device_list
        .into_iter()
        .map(|d| {
            let is_current = auth.device_id.as_deref() == Some(&d.id);
            DeviceResponse {
                id: d.id,
                client_id: d.client_id,
                encrypted_device_name: d.encrypted_device_name,
                created_at: d.created_at,
                last_seen: d.last_seen,
                is_current,
            }
        })
        .collect();

    Ok(Json(ListDevicesResponse { devices: items }))
}

pub async fn update_name(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(target_device_id): Path<String>,
    Json(body): Json<Value>,
) -> Result<(HeaderMap, Json<DeviceStateRow>), ApiError> {
    let obj = body
        .as_object()
        .ok_or_else(|| ApiError::BadRequest("invalid request body".to_string()))?;

    // Check if legacy field device_name is present
    if obj.contains_key("device_name") {
        return Err(ApiError::InternalWithDetails(
            StatusCode::BAD_REQUEST,
            "field_renamed".to_string(),
            serde_json::json!({
                "old": "device_name",
                "new": "encrypted_device_name"
            }),
        ));
    }

    let encrypted_device_name = match obj.get("encrypted_device_name") {
        Some(val) => match val.as_str() {
            Some(s) if !s.trim().is_empty() => s.trim().to_string(),
            _ => {
                return Err(ApiError::InternalWithDetails(
                    StatusCode::BAD_REQUEST,
                    "missing_field".to_string(),
                    serde_json::json!({ "field": "encrypted_device_name" }),
                ));
            }
        },
        None => {
            return Err(ApiError::InternalWithDetails(
                StatusCode::BAD_REQUEST,
                "missing_field".to_string(),
                serde_json::json!({ "field": "encrypted_device_name" }),
            ));
        }
    };

    // Rate limiting
    let decision = rate_limit::check(
        &state.pool,
        &state.config.rate_limits,
        RateLimitKey::DeviceName {
            user_id: auth.user_id.clone(),
        },
    )
    .await
    .map_err(|e| ApiError::Internal(e.into()))?;

    if !decision.allowed {
        return Err(ApiError::TooManyRequests {
            message: "Device rename rate limit exceeded".to_string(),
            reset_at: decision.reset_at,
        });
    }

    let row = device_names::write_device_name(
        &state.pool,
        &state.publisher,
        WriteRequest {
            user_id: auth.user_id,
            device_id: target_device_id,
            encrypted_device_name,
        },
    )
    .await?;

    let mut headers = HeaderMap::new();
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));

    Ok((headers, Json(row)))
}

pub async fn revoke(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(target_device_id): Path<String>,
) -> Result<StatusCode, ApiError> {
    if let Some(ref current_device_id) = auth.device_id {
        if target_device_id == *current_device_id {
            return Err(ApiError::BadRequest(
                "cannot_revoke_current_device".to_string(),
            ));
        }
    }

    devices::revoke_device(&state.pool, &auth.user_id, &target_device_id).await?;

    let _ = crate::audit::log(
        &state.pool,
        Some(&auth.user_id),
        crate::audit::action::DEVICE_REVOKE,
        Some("device"),
        Some(&target_device_id),
        None,
    )
    .await;

    Ok(StatusCode::NO_CONTENT)
}
