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
use sqlx::Row;
use utoipa::ToSchema;

use crate::error::ErrorResponse;
use crate::key_transparency::SnapshotView;

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

#[derive(Serialize)]
pub struct RotateVapidResponse {
    pub public_key: String,
    pub subscriptions_revoked: u64,
}

#[derive(Serialize)]
pub struct RotateAltchaResponse {
    pub ok: bool,
}

pub async fn post_rotate_vapid_handler(
    State(state): State<AppState>,
    auth: AuthUser,
    _: RequirePermission<ConfigEdit>,
) -> Result<Json<RotateVapidResponse>, ApiError> {
    let res = crate::push::vapid::rotate_vapid_keys(&state.pool, Some(&auth.user_id))
        .await
        .map_err(|e| ApiError::Internal(e.into()))?;

    Ok(Json(RotateVapidResponse {
        public_key: res.public_key,
        subscriptions_revoked: res.subscriptions_revoked,
    }))
}

pub async fn post_rotate_altcha_handler(
    State(state): State<AppState>,
    auth: AuthUser,
    _: RequirePermission<ConfigEdit>,
) -> Result<Json<RotateAltchaResponse>, ApiError> {
    crate::altcha::rotate_hmac_secret(&state.pool, Some(&auth.user_id))
        .await
        .map_err(|e| ApiError::Internal(e.into()))?;

    Ok(Json(RotateAltchaResponse { ok: true }))
}

#[derive(Serialize, ToSchema)]
pub struct KeyTransparencyStatsResponse {
    /// True if Key Transparency logging is active.
    pub enabled: bool,
    /// Total number of leaves in Key Transparency log.
    pub tree_size: i64,
    /// Timestamp when oldest leaf was added.
    #[schema(value_type = Option<String>, example = "2026-10-12T00:00:00Z")]
    pub oldest_leaf_added_at: Option<DateTime<Utc>>,
    /// Timestamp when newest leaf was added.
    #[schema(value_type = Option<String>, example = "2026-10-12T00:00:00Z")]
    pub newest_leaf_added_at: Option<DateTime<Utc>>,
}

/// GET /api/v1/admin/key-transparency
#[utoipa::path(
    get,
    path = "/api/v1/admin/key-transparency",
    tag = "Admin",
    summary = "Key Transparency log stats",
    description = "Fetches Key Transparency log statistics including total entries and leaf timestamps. See §8.3.",
    security(
        ("bearer_auth" = [])
    ),
    responses(
        (status = 200, description = "Key Transparency stats retrieved successfully", body = KeyTransparencyStatsResponse),
        (status = 401, description = "Unauthorized", body = ErrorResponse),
        (status = 403, description = "Forbidden (Admin permission required)", body = ErrorResponse)
    )
)]
pub async fn get_key_transparency_handler(
    State(state): State<AppState>,
    auth: AuthUser,
    _: RequirePermission<ConfigEdit>,
) -> Result<Json<KeyTransparencyStatsResponse>, ApiError> {
    let _ = auth;

    let row = sqlx::query(
        r#"
        SELECT
            COUNT(*) as tree_size,
            MIN(added_at) as oldest_leaf_added_at,
            MAX(added_at) as newest_leaf_added_at
        FROM key_transparency_log
        "#,
    )
    .fetch_one(&state.pool)
    .await?;

    let tree_size: i64 = row.get("tree_size");
    let oldest_leaf_added_at: Option<DateTime<Utc>> = row.get("oldest_leaf_added_at");
    let newest_leaf_added_at: Option<DateTime<Utc>> = row.get("newest_leaf_added_at");

    Ok(Json(KeyTransparencyStatsResponse {
        enabled: state.config.key_transparency_enabled,
        tree_size,
        oldest_leaf_added_at,
        newest_leaf_added_at,
    }))
}

/// POST /api/v1/admin/key-transparency/snapshot
#[utoipa::path(
    post,
    path = "/api/v1/admin/key-transparency/snapshot",
    tag = "Admin",
    summary = "Trigger signed Key Transparency snapshot",
    description = "Triggers immediate generation and signing of a Key Transparency log Merkle tree snapshot. Reuses the same snapshot schema as public KT snapshot endpoint. See §8.3.",
    security(
        ("bearer_auth" = [])
    ),
    responses(
        (status = 200, description = "Key Transparency snapshot triggered and generated successfully", body = SnapshotView),
        (status = 401, description = "Unauthorized", body = ErrorResponse),
        (status = 403, description = "Forbidden (Admin permission required)", body = ErrorResponse),
        (status = 501, description = "Key Transparency disabled", body = ErrorResponse)
    )
)]
pub async fn post_key_transparency_snapshot_handler(
    State(state): State<AppState>,
    auth: AuthUser,
    _: RequirePermission<ConfigEdit>,
) -> Result<Json<crate::key_transparency::SnapshotView>, ApiError> {
    let snapshot = crate::key_transparency::create_snapshot(
        &state.pool,
        &state.opaque_server,
        &state.publisher,
        &state.config,
        Some(&auth.user_id),
    )
    .await
    .map_err(|e| match e {
        crate::key_transparency::SnapshotError::Disabled => {
            ApiError::NotImplemented("key_transparency_disabled".to_string())
        }
        crate::key_transparency::SnapshotError::KeyDerivation(err) => {
            ApiError::Internal(anyhow::anyhow!("key derivation error: {}", err))
        }
        crate::key_transparency::SnapshotError::Database(err) => ApiError::Internal(err.into()),
        crate::key_transparency::SnapshotError::Serialization(err) => {
            ApiError::Internal(err.into())
        }
    })?;

    Ok(Json(snapshot))
}

#[derive(Serialize, ToSchema)]
pub struct SessionTypesReloadResponse {
    /// True if reload succeeded.
    pub reloaded: bool,
    /// List of active session types post-reload.
    pub session_types: Vec<crate::sessions::SessionTypeAdminView>,
}

/// POST /api/v1/admin/session-types/reload
#[utoipa::path(
    post,
    path = "/api/v1/admin/session-types/reload",
    tag = "Admin",
    summary = "Reload session types configuration",
    description = "Reads SESSION_TYPES_CONFIG_PATH, validates, and performs an atomic swap. On validation error, previous config remains in effect and 400 is returned. See §8.3.1.",
    security(
        ("bearer_auth" = [])
    ),
    responses(
        (status = 200, description = "Session types configuration reloaded successfully", body = SessionTypesReloadResponse),
        (status = 400, description = "Validation failed or configuration file missing", body = ErrorResponse),
        (status = 401, description = "Unauthorized", body = ErrorResponse),
        (status = 403, description = "Forbidden (Admin permission required)", body = ErrorResponse)
    )
)]
pub async fn post_reload_session_types_handler(
    State(state): State<AppState>,
    auth: AuthUser,
    _: RequirePermission<ConfigEdit>,
) -> Result<Json<SessionTypesReloadResponse>, ApiError> {
    let path = std::path::Path::new(&state.config.session_types_config_path);

    let new_config = match crate::sessions::load_session_types_from_file(
        path,
        state.config.server_max_session_participants,
        state.config.server_max_sessions_per_room,
    ) {
        Ok(c) => c,
        Err(crate::sessions::SessionTypesError::ConfigMissing { path }) => {
            return Err(ApiError::CustomShape(
                axum::http::StatusCode::BAD_REQUEST,
                serde_json::json!({
                    "error": "session_types_config_missing",
                    "message": "Configuration file missing",
                    "details": { "path": path }
                }),
            ));
        }
        Err(crate::sessions::SessionTypesError::InvalidConfig { line, reason }) => {
            let mut details = serde_json::Map::new();
            if let Some(l) = line {
                details.insert("line".to_string(), serde_json::json!(l));
            }
            details.insert("reason".to_string(), serde_json::json!(reason));

            return Err(ApiError::CustomShape(
                axum::http::StatusCode::BAD_REQUEST,
                serde_json::json!({
                    "error": "invalid_session_types_config",
                    "message": "Validation failed",
                    "details": details,
                }),
            ));
        }
        Err(e) => {
            return Err(ApiError::Internal(e.into()));
        }
    };

    let new_state = crate::sessions::SessionTypesState {
        declared_enabled: state.config.sessions_enabled,
        allowlist_loaded: true,
        config: new_config,
    };

    state.session_types.swap(new_state);

    let types_count = state.session_types.admin_types().len();
    audit::log(
        &state.pool,
        Some(&auth.user_id),
        audit::action::SESSION_TYPES_RELOAD,
        Some("session_types"),
        None,
        Some(serde_json::json!({ "types_count": types_count })),
    )
    .await
    .map_err(|e| ApiError::Internal(e.into()))?;

    Ok(Json(SessionTypesReloadResponse {
        reloaded: true,
        session_types: state.session_types.admin_types(),
    }))
}

#[derive(Serialize, ToSchema)]
pub struct ModelReloadResponse {
    /// True if reload succeeded.
    pub reloaded: bool,
    /// Count of active Speech-to-Text models.
    pub stt_models: usize,
    /// Count of active Text-to-Speech models.
    pub tts_models: usize,
}

/// POST /api/v1/admin/models/reload
#[utoipa::path(
    post,
    path = "/api/v1/admin/models/reload",
    tag = "Admin",
    summary = "Reload model manifest",
    description = "Reloads model manifest with mode-dependent atomic swap semantics. On validation/fetch failure, previous models remain in effect and error is returned. See §8.3 and §5.27.",
    security(
        ("bearer_auth" = [])
    ),
    responses(
        (status = 200, description = "Model manifest reloaded successfully", body = ModelReloadResponse),
        (status = 400, description = "Invalid model manifest", body = ErrorResponse),
        (status = 401, description = "Unauthorized", body = ErrorResponse),
        (status = 403, description = "Forbidden (Admin permission required)", body = ErrorResponse),
        (status = 501, description = "Model hosting disabled", body = ErrorResponse),
        (status = 502, description = "Failed to fetch external model manifest", body = ErrorResponse)
    )
)]
pub async fn post_reload_models_handler(
    State(state): State<AppState>,
    auth: AuthUser,
    _: RequirePermission<ConfigEdit>,
) -> Result<Json<ModelReloadResponse>, ApiError> {
    if !state.config.model_hosting_enabled {
        return Err(ApiError::NotImplemented(
            "model_hosting_disabled".to_string(),
        ));
    }

    let (stt_count, tts_count) = match state.models.reload().await {
        Ok(counts) => counts,
        Err(crate::models::ModelReloadError::LocalValidation { kind, path, reason }) => {
            let mut details = serde_json::Map::new();
            details.insert("kind".to_string(), serde_json::json!(kind));
            details.insert(
                "path".to_string(),
                serde_json::json!(path.to_string_lossy()),
            );
            details.insert("reason".to_string(), serde_json::json!(reason));

            return Err(ApiError::CustomShape(
                axum::http::StatusCode::BAD_REQUEST,
                serde_json::json!({
                    "error": "invalid_model_manifest",
                    "message": "Validation failed",
                    "details": details,
                }),
            ));
        }
        Err(crate::models::ModelReloadError::ExternalValidation { url, reason }) => {
            let mut details = serde_json::Map::new();
            details.insert("url".to_string(), serde_json::json!(url));
            details.insert("reason".to_string(), serde_json::json!(reason));

            return Err(ApiError::CustomShape(
                axum::http::StatusCode::BAD_REQUEST,
                serde_json::json!({
                    "error": "invalid_model_manifest",
                    "message": "Validation failed",
                    "details": details,
                }),
            ));
        }
        Err(crate::models::ModelReloadError::ExternalNetwork { url, reason }) => {
            let mut details = serde_json::Map::new();
            details.insert("upstream".to_string(), serde_json::json!(url));
            details.insert("reason".to_string(), serde_json::json!(reason));

            return Err(ApiError::CustomShape(
                axum::http::StatusCode::BAD_GATEWAY,
                serde_json::json!({
                    "error": "model_fetch_failed",
                    "message": "Failed to fetch external model manifest",
                    "details": details,
                }),
            ));
        }
    };

    audit::log(
        &state.pool,
        Some(&auth.user_id),
        audit::action::MODEL_MANIFEST_RELOAD,
        Some("model_manifest"),
        None,
        Some(serde_json::json!({
            "mode": state.models.mode().as_str(),
            "stt_models": stt_count,
            "tts_models": tts_count,
        })),
    )
    .await
    .map_err(|e| ApiError::Internal(e.into()))?;

    Ok(Json(ModelReloadResponse {
        reloaded: true,
        stt_models: stt_count,
        tts_models: tts_count,
    }))
}

#[derive(Serialize, ToSchema)]
pub struct ExtensionProxyBlocklistReloadResponse {
    /// True if reload succeeded.
    pub reloaded: bool,
    /// Count of active domain suffixes in blocklist.
    pub suffix_count: usize,
}

/// POST /api/v1/admin/extension-proxy/reload-blocklist
#[utoipa::path(
    post,
    path = "/api/v1/admin/extension-proxy/reload-blocklist",
    tag = "Admin",
    summary = "Reload extension proxy domain blocklist",
    description = "Reads EXTENSION_PROXY_DENY_DOMAINS and EXTENSION_PROXY_DENY_DOMAINS_PATH, validates, and performs an atomic swap. On error, previous blocklist remains in effect and 400 is returned. See §8.3.2.",
    security(
        ("bearer_auth" = [])
    ),
    responses(
        (status = 200, description = "Extension proxy blocklist reloaded successfully", body = ExtensionProxyBlocklistReloadResponse),
        (status = 400, description = "Blocklist file missing or load failed", body = ErrorResponse),
        (status = 401, description = "Unauthorized", body = ErrorResponse),
        (status = 403, description = "Forbidden (Admin permission required)", body = ErrorResponse)
    )
)]
pub async fn post_reload_extension_proxy_blocklist_handler(
    State(state): State<AppState>,
    _auth: AuthUser,
    _: RequirePermission<ConfigEdit>,
) -> Result<Json<ExtensionProxyBlocklistReloadResponse>, ApiError> {
    let new_blocklist = match crate::extensions_proxy::blocklist::load_blocklist(
        &state.config.extension_proxy_deny_domains,
        &state.config.extension_proxy_deny_domains_path,
    ) {
        Ok(b) => b,
        Err(crate::extensions_proxy::blocklist::BlocklistError::FileNotFound { path }) => {
            return Err(ApiError::CustomShape(
                axum::http::StatusCode::BAD_REQUEST,
                serde_json::json!({
                    "error": "blocklist_file_not_found",
                    "message": "Blocklist file not found",
                    "details": { "path": path }
                }),
            ));
        }
        Err(crate::extensions_proxy::blocklist::BlocklistError::IoError { path, source }) => {
            return Err(ApiError::CustomShape(
                axum::http::StatusCode::BAD_REQUEST,
                serde_json::json!({
                    "error": "blocklist_load_failed",
                    "message": format!("Failed to read blocklist file: {}", source),
                    "details": { "path": path }
                }),
            ));
        }
    };

    let suffix_count = new_blocklist.len();
    state.extension_proxy_blocklist.swap(new_blocklist);

    tracing::info!(
        target: "extension_proxy",
        "Extension proxy blocklist reloaded: {} domain suffixes active",
        suffix_count
    );

    Ok(Json(ExtensionProxyBlocklistReloadResponse {
        reloaded: true,
        suffix_count,
    }))
}
