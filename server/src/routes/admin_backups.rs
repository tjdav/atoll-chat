use axum::{extract::State, http::StatusCode, Json};
use chrono::{DateTime, Utc};
use serde::Serialize;
use serde_json::json;

use crate::auth::AuthUser;
use crate::backup::{list_backups, BackupJob};
use crate::error::ApiError;
use crate::permission_check::{BackupManage, RequirePermission};
use crate::AppState;

#[derive(Serialize)]
pub struct BackupItemResponse {
    pub filename: String,
    pub size_bytes: u64,
    pub created_at: DateTime<Utc>,
}

#[derive(Serialize)]
pub struct BackupListResponse {
    pub backups: Vec<BackupItemResponse>,
}

pub async fn list(
    State(state): State<AppState>,
    _auth: AuthUser,
    _: RequirePermission<BackupManage>,
) -> Result<Json<BackupListResponse>, ApiError> {
    if !state.config.backup_enabled {
        return Err(ApiError::NotImplemented("backup_disabled".to_string()));
    }

    let items = list_backups(&state.config)
        .await
        .map_err(|e| ApiError::Internal(e.into()))?;

    let backups = items
        .into_iter()
        .map(|b| BackupItemResponse {
            filename: b.filename,
            size_bytes: b.size_bytes,
            created_at: b.created_at,
        })
        .collect();

    Ok(Json(BackupListResponse { backups }))
}

pub async fn trigger(
    State(state): State<AppState>,
    _auth: AuthUser,
    _: RequirePermission<BackupManage>,
) -> Result<(StatusCode, Json<BackupItemResponse>), ApiError> {
    if !state.config.backup_enabled {
        return Err(ApiError::NotImplemented("backup_disabled".to_string()));
    }

    let guard = match state.backup_lock.try_lock() {
        Ok(g) => g,
        Err(_) => return Err(ApiError::Conflict("backup_in_progress".to_string())),
    };

    let job = BackupJob::new(state.config.clone());
    let result = match job.run_once(&state.pool).await {
        Ok(res) => res,
        Err(e) => {
            drop(guard);
            return Err(ApiError::InternalWithDetails(
                StatusCode::INTERNAL_SERVER_ERROR,
                "backup_failed".to_string(),
                json!({ "reason": e.to_string() }),
            ));
        }
    };

    drop(guard);

    let filename = result
        .path
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();

    Ok((
        StatusCode::CREATED,
        Json(BackupItemResponse {
            filename,
            size_bytes: result.size_bytes,
            created_at: result.created_at,
        }),
    ))
}
