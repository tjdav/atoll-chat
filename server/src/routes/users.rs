use crate::auth::AuthUser;
use crate::error::ApiError;
use crate::roles;
use crate::AppState;
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

    let effective_limit = match user_max_file_size {
        Some(limit) if limit > 0 => std::cmp::min(limit as u64, state.config.max_file_size_bytes),
        _ => state.config.max_file_size_bytes,
    };

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
