use crate::auth::AuthUser;
use crate::devices;
use crate::error::ApiError;
use crate::AppState;
use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use chrono::{DateTime, Utc};
use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct DeviceResponse {
    pub id: String,
    pub client_id: String,
    pub name: Option<String>,
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
                name: d.name,
                created_at: d.created_at,
                last_seen: d.last_seen,
                is_current,
            }
        })
        .collect();

    Ok(Json(ListDevicesResponse { devices: items }))
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
