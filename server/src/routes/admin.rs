use crate::audit::{self, AuditEntry, AuditFilter};
use crate::auth::AuthUser;
use crate::config_ops::{self, ConfigOpsError, InstanceConfig, EXPOSED_KEYS};
use crate::error::ApiError;
use crate::limits::{self, InstanceLimits, LimitsError, ServerHardMax};
use crate::permission_check::{ConfigEdit, RequirePermission};
use crate::AppState;
use axum::{
    extract::{rejection::JsonRejection, Query, State},
    Json,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Serialize)]
pub struct LimitsResponse {
    #[serde(flatten)]
    pub limits: InstanceLimits,
    pub server_hard_max: ServerHardMax,
}

#[derive(Debug, Deserialize)]
pub struct AuditQuery {
    pub actor_id: Option<String>,
    pub action: Option<String>,
    pub target_type: Option<String>,
    pub target_id: Option<String>,
    pub before: Option<DateTime<Utc>>,
    pub after: Option<DateTime<Utc>>,
    pub per_page: Option<u32>,
}

#[derive(Serialize)]
pub struct AuditListResponse {
    pub entries: Vec<AuditEntry>,
    pub next_before: Option<DateTime<Utc>>,
}

pub async fn get_config_handler(
    State(state): State<AppState>,
    auth: AuthUser,
    _: RequirePermission<ConfigEdit>,
) -> Result<Json<InstanceConfig>, ApiError> {
    let _ = auth;
    let config = config_ops::get_config(&state.pool)
        .await
        .map_err(|e| ApiError::Internal(e.into()))?;

    Ok(Json(config))
}

pub async fn patch_config_handler(
    State(state): State<AppState>,
    auth: AuthUser,
    _: RequirePermission<ConfigEdit>,
    payload: Result<Json<Value>, JsonRejection>,
) -> Result<Json<InstanceConfig>, ApiError> {
    let Json(body) =
        payload.map_err(|_| ApiError::BadRequest("invalid request body".to_string()))?;
    let obj = body
        .as_object()
        .ok_or_else(|| ApiError::BadRequest("invalid request body".to_string()))?;

    // Check for non-exposed / secret keys
    for key in obj.keys() {
        if !EXPOSED_KEYS.contains(&key.as_str()) {
            return Err(ApiError::BadRequest("invalid_config_key".to_string()));
        }
    }

    for (key, val) in obj {
        let str_val = match val {
            Value::String(s) => s.clone(),
            Value::Bool(b) => b.to_string(),
            _ => return Err(ApiError::BadRequest("invalid_config_value".to_string())),
        };

        if let Err(e) =
            config_ops::set_config(&state.pool, key, &str_val, Some(&auth.user_id)).await
        {
            match e {
                ConfigOpsError::UnknownKey(_) => {
                    return Err(ApiError::BadRequest("invalid_config_key".to_string()))
                }
                ConfigOpsError::InvalidValue { .. } => {
                    return Err(ApiError::BadRequest("invalid_config_value".to_string()))
                }
                ConfigOpsError::Database(err) => return Err(ApiError::Internal(err.into())),
            }
        }
    }

    let updated = config_ops::get_config(&state.pool)
        .await
        .map_err(|e| ApiError::Internal(e.into()))?;

    Ok(Json(updated))
}

pub async fn get_limits_handler(
    State(state): State<AppState>,
    auth: AuthUser,
    _: RequirePermission<ConfigEdit>,
) -> Result<Json<LimitsResponse>, ApiError> {
    let _ = auth;
    let limits = limits::get_limits(&state.pool, &state.server_hard_max)
        .await
        .map_err(|e| ApiError::Internal(e.into()))?;

    Ok(Json(LimitsResponse {
        limits,
        server_hard_max: (*state.server_hard_max).clone(),
    }))
}

pub async fn patch_limits_handler(
    State(state): State<AppState>,
    auth: AuthUser,
    _: RequirePermission<ConfigEdit>,
    payload: Result<Json<InstanceLimits>, JsonRejection>,
) -> Result<Json<LimitsResponse>, ApiError> {
    let Json(body) =
        payload.map_err(|_| ApiError::BadRequest("invalid request body".to_string()))?;
    if let Err(e) =
        limits::set_limits(&state.pool, &auth.user_id, &body, &state.server_hard_max).await
    {
        match e {
            LimitsError::ExceedsServerMax { .. } => {
                return Err(ApiError::BadRequest("exceeds_server_max".to_string()))
            }
            LimitsError::BelowMinimum { .. } => {
                return Err(ApiError::BadRequest("below_minimum".to_string()))
            }
            LimitsError::Database(err) => return Err(ApiError::Internal(err.into())),
        }
    }

    let updated = limits::get_limits(&state.pool, &state.server_hard_max)
        .await
        .map_err(|e| ApiError::Internal(e.into()))?;

    Ok(Json(LimitsResponse {
        limits: updated,
        server_hard_max: (*state.server_hard_max).clone(),
    }))
}

pub async fn get_audit_handler(
    State(state): State<AppState>,
    auth: AuthUser,
    _: RequirePermission<ConfigEdit>,
    Query(query): Query<AuditQuery>,
) -> Result<Json<AuditListResponse>, ApiError> {
    let _ = auth;
    let per_page = query.per_page.unwrap_or(50).clamp(1, 100);

    let filter = AuditFilter {
        actor_id: query.actor_id,
        action: query.action,
        target_type: query.target_type,
        target_id: query.target_id,
        before: query.before,
        after: query.after,
    };

    let entries = audit::list(&state.pool, filter, 1, per_page)
        .await
        .map_err(|e| ApiError::Internal(e.into()))?;

    let next_before = if entries.len() as u32 == per_page {
        entries.last().map(|e| e.created_at)
    } else {
        None
    };

    Ok(Json(AuditListResponse {
        entries,
        next_before,
    }))
}
