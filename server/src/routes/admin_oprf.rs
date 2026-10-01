use crate::audit;
use crate::auth::AuthUser;
use crate::error::ApiError;
use crate::oprf::rotation::{rotate_oprf_key, RotationError};
use crate::permission_check::{ConfigEdit, RequirePermission};
use crate::rate_limit::{self, RateLimitKey};
use crate::AppState;
use axum::{
    extract::{rejection::JsonRejection, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::IntoResponse,
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::json;

#[derive(Debug, Deserialize)]
pub struct RotateOprfRequest {
    pub confirm: Option<bool>,
}

#[derive(Debug, Serialize)]
pub struct RotateOprfResponse {
    pub backup_path: String,
    pub users_flagged: u64,
    pub rotated_at: String,
    pub restart_required: bool,
}

pub async fn rotate(
    State(state): State<AppState>,
    auth: AuthUser,
    _: RequirePermission<ConfigEdit>,
    payload: Result<Json<RotateOprfRequest>, JsonRejection>,
) -> Result<impl IntoResponse, ApiError> {
    // 1. Validate confirm == true
    let req = payload.map_err(|_| ApiError::BadRequest("invalid request body".to_string()))?;
    if req.confirm != Some(true) {
        return Err(ApiError::BadRequest("confirmation_required".to_string()));
    }

    // 2. Apply rate limit: 1 per hour
    let decision = rate_limit::check(
        &state.pool,
        &state.config.rate_limits,
        RateLimitKey::AdminOprfRotate {
            user_id: auth.user_id.clone(),
        },
    )
    .await?;

    if !decision.allowed {
        return Err(ApiError::TooManyRequests {
            message: "rate limit exceeded".to_string(),
            reset_at: decision.reset_at,
        });
    }

    // 3. Acquire process-wide oprf_rotation_lock
    let lock = state.oprf_rotation_lock.try_lock();
    if lock.is_err() {
        return Err(ApiError::Conflict("rotation_in_progress".to_string()));
    }

    // 4. Perform rotation
    let outcome = rotate_oprf_key(&state.pool, &state.config)
        .await
        .map_err(|e| match e {
            RotationError::KeyFileNotFound(_) => ApiError::InternalCustom(
                StatusCode::INTERNAL_SERVER_ERROR,
                "key_file_not_found".to_string(),
            ),
            RotationError::BackupFailed(_) => ApiError::InternalCustom(
                StatusCode::INTERNAL_SERVER_ERROR,
                "backup_failed".to_string(),
            ),
            RotationError::Database(err) => ApiError::Internal(err.into()),
            RotationError::Io(err) => ApiError::Internal(err.into()),
            RotationError::Serialization(err) => ApiError::InternalCustom(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("serialization error: {}", err),
            ),
        })?;

    // 5. Write best-effort audit entry
    let _ = audit::log(
        &state.pool,
        Some(&auth.user_id),
        audit::action::OPRF_ROTATE,
        Some("server_setup"),
        None,
        Some(json!({
            "users_flagged": outcome.users_flagged,
            "backup_path": outcome.backup_path.display().to_string(),
        })),
    )
    .await;

    // 6. Build response headers with Cache-Control: no-store
    let mut headers = HeaderMap::new();
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));

    let body = RotateOprfResponse {
        backup_path: outcome.backup_path.display().to_string(),
        users_flagged: outcome.users_flagged,
        rotated_at: outcome.rotated_at.to_rfc3339(),
        restart_required: true,
    };

    Ok((headers, Json(body)))
}
