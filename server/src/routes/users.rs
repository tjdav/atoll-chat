use crate::audit;
use crate::auth::AuthUser;
use crate::error::ApiError;
use crate::gdpr;
use crate::identity::{validate_encrypted_display, validate_token};
use crate::limits;
use crate::rate_limit;
use crate::roles;
use crate::AppState;
use axum::response::{IntoResponse, Response};
use axum::{extract::State, Json};
use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use base64::Engine;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::Row;

#[derive(Debug, Deserialize)]
pub struct UserLookupRequest {
    pub lookup_token: Option<String>,
    pub username_token: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct UserLookupResponse {
    pub user_id: String,
    pub encrypted_display: Option<String>,
}

pub async fn lookup_user(
    State(state): State<AppState>,
    auth: AuthUser,
    body_val: Json<serde_json::Value>,
) -> Result<Json<UserLookupResponse>, ApiError> {
    let obj = body_val
        .as_object()
        .ok_or_else(|| ApiError::BadRequest("invalid request body".to_string()))?;

    // Token split: raw token field must not be sent to server
    if obj.contains_key("token") {
        return Err(ApiError::BadRequest("token_not_accepted".to_string()));
    }

    let body: UserLookupRequest = serde_json::from_value(body_val.0)
        .map_err(|e| ApiError::BadRequest(format!("invalid json body: {e}")))?;

    // 1. Validate lookup_token format
    let lookup_token = match body.lookup_token.or(body.username_token) {
        Some(ref tok) if !tok.trim().is_empty() => tok.trim().to_string(),
        _ => return Err(ApiError::BadRequest("missing_field".to_string())),
    };

    if validate_token(&lookup_token).is_err() {
        return Err(ApiError::BadRequest("invalid_username_token".to_string()));
    }

    // 2. Rate limit lookup
    let rate_key = rate_limit::RateLimitKey::Lookup {
        user_id: auth.user_id.clone(),
    };
    let decision = rate_limit::check(&state.pool, &state.config.rate_limits, rate_key)
        .await
        .map_err(|e| ApiError::Internal(e.into()))?;

    if !decision.allowed {
        return Err(ApiError::TooManyRequests {
            message: "Lookup rate limit exceeded".to_string(),
            reset_at: decision.reset_at,
        });
    }

    // 3. Query user by username_token (lookup_token)
    let row_opt = sqlx::query(
        "SELECT id, encrypted_display FROM users WHERE username_token = ? AND deleted_at IS NULL",
    )
    .bind(&lookup_token)
    .fetch_optional(&state.pool)
    .await?;

    if let Some(row) = row_opt {
        let user_id: String = row.get("id");
        let encrypted_display: Option<String> = row.get("encrypted_display");
        Ok(Json(UserLookupResponse {
            user_id,
            encrypted_display,
        }))
    } else {
        Err(ApiError::NotFound("not_found".to_string()))
    }
}

#[derive(Serialize)]
pub struct UserLimitsResponse {
    pub max_file_size_bytes: u64,
}

#[derive(Serialize)]
pub struct UserProfileResponse {
    pub id: String,
    pub username_token: String,
    pub encrypted_display: Option<String>,
    pub identity_pubkey: Option<String>,
    pub profile: Option<String>,
    pub profile_version: i64,
    pub max_file_size_bytes: Option<i64>,
    pub roles: Vec<String>,
    pub limits: UserLimitsResponse,
    pub is_owner: bool,
    pub created_at: DateTime<Utc>,
}

pub async fn get_me(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<UserProfileResponse>, ApiError> {
    let row = sqlx::query(
        "SELECT username_token, encrypted_display, profile, profile_version, identity_pubkey, max_file_size_bytes, created_at FROM users WHERE id = ?",
    )
    .bind(&auth.user_id)
    .fetch_one(&state.pool)
    .await?;

    let username_token: String = row.get("username_token");
    let encrypted_display: Option<String> = row.get("encrypted_display");
    let profile: Option<String> = row.get("profile");
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
        id: auth.user_id,
        username_token,
        encrypted_display,
        identity_pubkey,
        profile,
        profile_version,
        max_file_size_bytes: user_max_file_size,
        roles: role_names,
        limits: UserLimitsResponse {
            max_file_size_bytes: effective_limit,
        },
        is_owner,
        created_at,
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

    // Check old field names
    if obj.contains_key("display_name") {
        return Err(ApiError::InternalWithDetails(
            axum::http::StatusCode::BAD_REQUEST,
            "field_renamed".to_string(),
            serde_json::json!({
                "old": "display_name",
                "new": "encrypted_display"
            }),
        ));
    }

    if obj.contains_key("profile_blob") {
        return Err(ApiError::InternalWithDetails(
            axum::http::StatusCode::BAD_REQUEST,
            "field_renamed".to_string(),
            serde_json::json!({
                "old": "profile_blob",
                "new": "profile"
            }),
        ));
    }

    if obj.contains_key("username") || obj.contains_key("username_token") {
        return Err(ApiError::BadRequest("username_immutable".to_string()));
    }

    let current_row =
        sqlx::query("SELECT encrypted_display, profile, profile_version FROM users WHERE id = ?")
            .bind(&auth.user_id)
            .fetch_one(&state.pool)
            .await?;

    let current_encrypted_display: Option<String> = current_row.get("encrypted_display");
    let current_profile: Option<String> = current_row.get("profile");
    let current_version: i64 = current_row.get("profile_version");

    let mut new_encrypted_display = current_encrypted_display;
    let mut new_profile = current_profile;

    if let Some(val) = obj.get("encrypted_display") {
        if val.is_null() {
            new_encrypted_display = None;
        } else if let Some(s) = val.as_str() {
            let trimmed = s.trim();
            if trimmed.is_empty() {
                new_encrypted_display = None;
            } else {
                if validate_encrypted_display(trimmed).is_err() {
                    return Err(ApiError::BadRequest(
                        "invalid_encrypted_display".to_string(),
                    ));
                }
                new_encrypted_display = Some(trimmed.to_string());
            }
        } else {
            return Err(ApiError::BadRequest(
                "invalid_encrypted_display".to_string(),
            ));
        }
    }

    if let Some(val) = obj.get("profile") {
        if val.is_null() {
            new_profile = None;
        } else if let Some(s) = val.as_str() {
            let trimmed = s.trim();
            if trimmed.is_empty() {
                new_profile = None;
            } else {
                if STANDARD.decode(trimmed).is_err() && URL_SAFE_NO_PAD.decode(trimmed).is_err() {
                    return Err(ApiError::BadRequest("invalid_profile".to_string()));
                }
                new_profile = Some(trimmed.to_string());
            }
        } else {
            return Err(ApiError::BadRequest("invalid_profile".to_string()));
        }
    }

    let new_version = current_version + 1;

    sqlx::query(
        "UPDATE users SET encrypted_display = ?, profile = ?, profile_version = ? WHERE id = ?",
    )
    .bind(&new_encrypted_display)
    .bind(&new_profile)
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
        .map_err(|e| {
            eprintln!("DEBUG: build_export error for {}: {:?}", auth.user_id, e);
            ApiError::Internal(e.into())
        })?;

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
