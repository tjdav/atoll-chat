use axum::{
    extract::{Path, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    Json,
};
use serde::Deserialize;
use utoipa::ToSchema;

#[derive(Debug, Deserialize, ToSchema)]
pub struct WritePreferenceRequest {
    /// base64url ciphertext; see §6.29
    #[schema(value_type = String, format = Binary)]
    pub value: String,
}

use crate::{
    auth::AuthUser,
    error::{ApiError, ErrorResponse},
    rate_limit::{self, RateLimitKey},
    sync::preferences::{
        self, validate_key_syntax, DeleteOutcome, PreferenceRow, PreferencesError, WriteRequest,
    },
    AppState,
};

#[utoipa::path(
    get,
    path = "/api/v1/users/me/preferences/{key}",
    tag = "User",
    summary = "Get encrypted preference",
    description = "Retrieves an encrypted preference value by key (Server Spec v3.0.4 §8.2, §8.2.8).",
    security(
        ("bearer_auth" = [])
    ),
    params(
        ("key" = String, Path, description = "Preference key")
    ),
    responses(
        (status = 200, description = "Preference retrieved successfully", body = PreferenceRow),
        (status = 400, description = "Invalid key syntax", body = ErrorResponse),
        (status = 401, description = "Unauthorized", body = ErrorResponse),
        (status = 404, description = "Preference not found or reserved key", body = ErrorResponse),
        (status = 429, description = "Rate limit exceeded", body = ErrorResponse)
    )
)]
pub async fn get(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(key): Path<String>,
) -> Result<(HeaderMap, Json<PreferenceRow>), ApiError> {
    let rl = rate_limit::check(
        &state.pool,
        &state.config.rate_limits,
        RateLimitKey::Preference {
            user_id: auth.user_id.clone(),
        },
    )
    .await?;
    if !rl.allowed {
        return Err(ApiError::TooManyRequests {
            message: "Rate limit exceeded for preferences".to_string(),
            reset_at: rl.reset_at,
        });
    }

    if preferences::is_reserved_key(&key) {
        return Err(ApiError::NotFound("preference_not_found".to_string()));
    }

    if validate_key_syntax(&key).is_err() {
        return Err(ApiError::BadRequest("invalid_key".to_string()));
    }

    let pref = preferences::get_preference(&state.pool, &auth.user_id, &key).await?;

    let row = match pref {
        Some(r) => r,
        None => return Err(ApiError::NotFound("preference_not_found".to_string())),
    };

    let mut headers = HeaderMap::new();
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));

    Ok((headers, Json(row)))
}

#[utoipa::path(
    patch,
    path = "/api/v1/users/me/preferences/{key}",
    tag = "User",
    summary = "Set encrypted preference",
    description = "Sets or updates an encrypted preference value (Server Spec v3.0.4 §8.2, §8.2.8).",
    security(
        ("bearer_auth" = [])
    ),
    params(
        ("key" = String, Path, description = "Preference key")
    ),
    request_body(
        content = WritePreferenceRequest,
        description = "Encrypted preference value"
    ),
    responses(
        (status = 200, description = "Preference saved successfully", body = PreferenceRow),
        (status = 400, description = "Invalid key, invalid value, or reserved key", body = ErrorResponse),
        (status = 401, description = "Unauthorized", body = ErrorResponse),
        (status = 413, description = "Value exceeds byte cap limit", body = ErrorResponse),
        (status = 429, description = "Rate limit exceeded", body = ErrorResponse)
    )
)]
pub async fn write(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(key): Path<String>,
    Json(body): Json<serde_json::Value>,
) -> Result<(HeaderMap, Json<PreferenceRow>), ApiError> {
    let rl = rate_limit::check(
        &state.pool,
        &state.config.rate_limits,
        RateLimitKey::Preference {
            user_id: auth.user_id.clone(),
        },
    )
    .await?;
    if !rl.allowed {
        return Err(ApiError::TooManyRequests {
            message: "Rate limit exceeded for preferences".to_string(),
            reset_at: rl.reset_at,
        });
    }

    let body_obj = match body.as_object() {
        Some(obj) => obj,
        None => {
            return Err(ApiError::InternalWithDetails(
                StatusCode::BAD_REQUEST,
                "missing_field".to_string(),
                serde_json::json!({ "field": "value" }),
            ));
        }
    };

    let value_str = match body_obj.get("value").and_then(|v| v.as_str()) {
        Some(v) if !v.is_empty() => v.to_string(),
        _ => {
            return Err(ApiError::InternalWithDetails(
                StatusCode::BAD_REQUEST,
                "missing_field".to_string(),
                serde_json::json!({ "field": "value" }),
            ));
        }
    };

    let req = WriteRequest {
        user_id: auth.user_id,
        key: key.clone(),
        value: value_str,
        max_bytes: state.config.preferences_max_encrypted_bytes,
    };

    let row = preferences::write_preference(&state.pool, &state.publisher, req)
        .await
        .map_err(|e| match e {
            PreferencesError::ReservedKey(k) => ApiError::InternalWithDetails(
                StatusCode::BAD_REQUEST,
                "reserved_key".to_string(),
                serde_json::json!({ "key": k }),
            ),
            PreferencesError::InvalidKey(_) => ApiError::BadRequest("invalid_key".to_string()),
            PreferencesError::InvalidValue => ApiError::BadRequest("invalid_value".to_string()),
            PreferencesError::ValueTooLarge(limit, size) => ApiError::InternalWithDetails(
                StatusCode::PAYLOAD_TOO_LARGE,
                "value_too_large".to_string(),
                serde_json::json!({ "limit": limit, "size": size }),
            ),
            PreferencesError::Database(err) => ApiError::Internal(err.into()),
        })?;

    let mut headers = HeaderMap::new();
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));

    Ok((headers, Json(row)))
}

#[utoipa::path(
    delete,
    path = "/api/v1/users/me/preferences/{key}",
    tag = "User",
    summary = "Delete encrypted preference",
    description = "Deletes an encrypted preference by key (Server Spec v3.0.4 §8.2, §8.2.8).",
    security(
        ("bearer_auth" = [])
    ),
    params(
        ("key" = String, Path, description = "Preference key to delete")
    ),
    responses(
        (status = 204, description = "Preference deleted successfully"),
        (status = 400, description = "Invalid key syntax or reserved key", body = ErrorResponse),
        (status = 401, description = "Unauthorized", body = ErrorResponse),
        (status = 404, description = "Preference not found", body = ErrorResponse),
        (status = 429, description = "Rate limit exceeded", body = ErrorResponse)
    )
)]
pub async fn delete(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(key): Path<String>,
) -> Result<(HeaderMap, StatusCode), ApiError> {
    let rl = rate_limit::check(
        &state.pool,
        &state.config.rate_limits,
        RateLimitKey::Preference {
            user_id: auth.user_id.clone(),
        },
    )
    .await?;
    if !rl.allowed {
        return Err(ApiError::TooManyRequests {
            message: "Rate limit exceeded for preferences".to_string(),
            reset_at: rl.reset_at,
        });
    }

    let outcome =
        preferences::delete_preference(&state.pool, &state.publisher, &auth.user_id, &key)
            .await
            .map_err(|e| match e {
                PreferencesError::ReservedKey(k) => ApiError::InternalWithDetails(
                    StatusCode::BAD_REQUEST,
                    "reserved_key".to_string(),
                    serde_json::json!({ "key": k }),
                ),
                PreferencesError::InvalidKey(_) => ApiError::BadRequest("invalid_key".to_string()),
                PreferencesError::InvalidValue | PreferencesError::ValueTooLarge(..) => {
                    ApiError::BadRequest("invalid_request".to_string())
                }
                PreferencesError::Database(err) => ApiError::Internal(err.into()),
            })?;

    match outcome {
        DeleteOutcome::Deleted { .. } => {
            let mut headers = HeaderMap::new();
            headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
            Ok((headers, StatusCode::NO_CONTENT))
        }
        DeleteOutcome::NotPresent => Err(ApiError::NotFound("preference_not_found".to_string())),
    }
}
