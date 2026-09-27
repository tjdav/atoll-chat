use crate::audit;
use crate::auth::AuthUser;
use crate::error::ApiError;
use crate::gdpr;
use crate::limits;
use crate::rate_limit;
use crate::roles;
use crate::AppState;
use axum::response::{IntoResponse, Response};
use axum::{extract::State, Json};
use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use base64::Engine;
use chrono::{DateTime, Utc};
use serde::Serialize;
use serde_json::Value;
use sqlx::Row;

#[derive(Serialize)]
pub struct UserLimitsResponse {
    pub max_file_size_bytes: u64,
}

#[derive(Serialize)]
pub struct UserProfileResponse {
    pub user_id: String,
    pub username: String,
    pub display_name: Option<String>,
    pub profile_blob: Option<String>,
    pub profile_version: i64,
    pub identity_pubkey: Option<String>,
    pub created_at: DateTime<Utc>,
    pub is_owner: bool,
    pub roles: Vec<String>,
    pub limits: UserLimitsResponse,
}

pub async fn get_me(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<UserProfileResponse>, ApiError> {
    let row = sqlx::query(
        "SELECT display_name, profile_blob, profile_version, identity_pubkey, max_file_size_bytes, created_at FROM users WHERE id = ?",
    )
    .bind(&auth.user_id)
    .fetch_one(&state.pool)
    .await?;

    let display_name: Option<String> = row.get("display_name");
    let profile_blob: Option<String> = row.get("profile_blob");
    let profile_version: i64 = row.get("profile_version");
    let raw_identity_pubkey: String = row.get("identity_pubkey");
    let identity_pubkey = if raw_identity_pubkey.trim().is_empty() {
        None
    } else {
        Some(raw_identity_pubkey)
    };
    let user_max_file_size: Option<i64> = row.get("max_file_size_bytes");
    let created_at: DateTime<Utc> = row.get("created_at");

    let is_owner = roles::user_has_permission(&state.pool, &auth.user_id, "*")
        .await
        .unwrap_or(false);

    let user_roles = roles::get_user_roles(&state.pool, &auth.user_id)
        .await
        .map_err(|e| ApiError::Internal(anyhow::anyhow!("Failed to fetch user roles: {}", e)))?;
    let role_names: Vec<String> = user_roles.into_iter().map(|r| r.name).collect();

    let instance_limits = limits::get_limits(&state.pool, &state.server_hard_max)
        .await
        .map_err(|e| ApiError::Internal(e.into()))?;

    let effective_limit = limits::effective_file_size_limit(
        user_max_file_size,
        instance_limits.file_size_bytes,
        state.server_hard_max.file_size_bytes,
    ) as u64;

    Ok(Json(UserProfileResponse {
        user_id: auth.user_id,
        username: auth.username,
        display_name,
        profile_blob,
        profile_version,
        identity_pubkey,
        created_at,
        is_owner,
        roles: role_names,
        limits: UserLimitsResponse {
            max_file_size_bytes: effective_limit,
        },
    }))
}

pub async fn patch_me(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(body): Json<Value>,
) -> Result<Json<UserProfileResponse>, ApiError> {
    let obj = body
        .as_object()
        .ok_or_else(|| ApiError::BadRequest("invalid request body".to_string()))?;

    // Check username rejection
    if obj.contains_key("username") {
        return Err(ApiError::BadRequest("username_immutable".to_string()));
    }

    let current_row =
        sqlx::query("SELECT display_name, profile_blob, profile_version FROM users WHERE id = ?")
            .bind(&auth.user_id)
            .fetch_one(&state.pool)
            .await?;

    let current_display_name: Option<String> = current_row.get("display_name");
    let current_profile_blob: Option<String> = current_row.get("profile_blob");
    let current_version: i64 = current_row.get("profile_version");

    let mut new_display_name = current_display_name;
    let mut new_profile_blob = current_profile_blob;

    if let Some(val) = obj.get("display_name") {
        if val.is_null() {
            new_display_name = None;
        } else if let Some(s) = val.as_str() {
            let trimmed = s.trim();
            if trimmed.is_empty() {
                new_display_name = None;
            } else {
                // Check control characters (U+0000–U+001F or U+007F–U+009F)
                if trimmed
                    .chars()
                    .any(|c| (c as u32 <= 0x001F) || (c as u32 >= 0x007F && c as u32 <= 0x009F))
                {
                    return Err(ApiError::BadRequest("invalid_display_name".to_string()));
                }
                let char_count = trimmed.chars().count();
                if !(1..=64).contains(&char_count) {
                    return Err(ApiError::BadRequest("invalid_display_name".to_string()));
                }
                new_display_name = Some(trimmed.to_string());
            }
        } else {
            return Err(ApiError::BadRequest("invalid_display_name".to_string()));
        }
    }

    if let Some(val) = obj.get("profile_blob") {
        if val.is_null() {
            new_profile_blob = None;
        } else if let Some(s) = val.as_str() {
            if STANDARD.decode(s).is_err() && URL_SAFE_NO_PAD.decode(s).is_err() {
                return Err(ApiError::BadRequest("invalid_profile_blob".to_string()));
            }
            new_profile_blob = Some(s.to_string());
        } else {
            return Err(ApiError::BadRequest("invalid_profile_blob".to_string()));
        }
    }

    let new_version = current_version + 1;

    sqlx::query(
        "UPDATE users SET display_name = ?, profile_blob = ?, profile_version = ? WHERE id = ?",
    )
    .bind(&new_display_name)
    .bind(&new_profile_blob)
    .bind(new_version)
    .bind(&auth.user_id)
    .execute(&state.pool)
    .await?;

    get_me(State(state), auth).await
}

pub async fn delete_me(
    State(state): State<AppState>,
    auth: AuthUser,
    body: Option<Json<Value>>,
) -> Result<Response, ApiError> {
    // 1. Fresh session check (must be within last 5 minutes)
    if !auth.is_fresh(std::time::Duration::from_secs(300)) {
        return Ok((
            axum::http::StatusCode::FORBIDDEN,
            Json(serde_json::json!({
                "error": "fresh_session_required",
                "message": "Re-authenticate before deleting your account.",
                "details": {
                    "reauthenticate_at": "/api/v1/auth/login/start"
                }
            })),
        )
            .into_response());
    }

    // 2. Check confirmation body
    let confirm_valid = if let Some(Json(val)) = body {
        val.get("confirm")
            .and_then(|v| v.as_str())
            .map(|s| s == "DELETE")
            .unwrap_or(false)
    } else {
        false
    };

    if !confirm_valid {
        return Ok((
            axum::http::StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "error": "confirmation_required"
            })),
        )
            .into_response());
    }

    // 3. Check if user is the last owner
    let owner_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM user_roles WHERE role_id = 'role_owner'")
            .fetch_one(&state.pool)
            .await?;

    let is_this_user_owner: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM user_roles WHERE role_id = 'role_owner' AND user_id = ?",
    )
    .bind(&auth.user_id)
    .fetch_one(&state.pool)
    .await?;

    if is_this_user_owner > 0 && owner_count == 1 {
        return Ok((
            axum::http::StatusCode::CONFLICT,
            Json(serde_json::json!({
                "error": "last_owner_cannot_delete",
                "message": "Transfer the owner role to another user before deleting your account."
            })),
        )
            .into_response());
    }

    // 4. Anonymise user
    gdpr::anonymise_user(&state.pool, &auth.user_id)
        .await
        .map_err(|e| ApiError::Internal(e.into()))?;

    Ok(axum::http::StatusCode::NO_CONTENT.into_response())
}

pub async fn export_me(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Response, ApiError> {
    // 1. Rate limit check
    let rate_key = rate_limit::RateLimitKey::DataExport {
        user_id: auth.user_id.clone(),
    };
    let decision = rate_limit::check(&state.pool, &state.config.rate_limits, rate_key)
        .await
        .map_err(|e| ApiError::Internal(e.into()))?;

    if !decision.allowed {
        return Ok((
            axum::http::StatusCode::TOO_MANY_REQUESTS,
            Json(serde_json::json!({
                "error": "rate_limited",
                "message": "Data export rate limit exceeded",
                "details": {
                    "reset_at": decision.reset_at.to_rfc3339()
                }
            })),
        )
            .into_response());
    }

    // 2. Build ZIP export
    let zip_bytes = gdpr::build_export(&state.pool, &auth.user_id)
        .await
        .map_err(|e| ApiError::Internal(e.into()))?;

    // 3. Log audit entry
    let _ = audit::log(
        &state.pool,
        Some(&auth.user_id),
        audit::action::USER_EXPORT,
        Some("user"),
        Some(&auth.user_id),
        None,
    )
    .await;

    // 4. Return ZIP response
    let filename = format!(
        "export-{}-{}.zip",
        auth.user_id,
        Utc::now().format("%Y%m%d-%H%M%S")
    );

    let mut headers = axum::http::HeaderMap::new();
    headers.insert(
        axum::http::header::CONTENT_TYPE,
        axum::http::HeaderValue::from_static("application/zip"),
    );
    headers.insert(
        axum::http::header::CONTENT_DISPOSITION,
        axum::http::HeaderValue::from_str(&format!("attachment; filename=\"{}\"", filename))
            .map_err(|e| ApiError::Internal(e.into()))?,
    );
    headers.insert(
        axum::http::header::CACHE_CONTROL,
        axum::http::HeaderValue::from_static("no-store"),
    );

    Ok((axum::http::StatusCode::OK, headers, zip_bytes).into_response())
}
