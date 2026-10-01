use axum::{
    extract::{Path, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    Json,
};

use crate::{
    auth::AuthUser,
    error::ApiError,
    rate_limit::{self, RateLimitKey},
    sync::preferences::{
        self, validate_key_syntax, DeleteOutcome, PreferenceRow, PreferencesError, WriteRequest,
    },
    AppState,
};

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

    let value = match body_obj.get("value") {
        Some(v) => v.clone(),
        None => {
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
        value,
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
            PreferencesError::ValueTooLarge(limit, size) => ApiError::InternalWithDetails(
                StatusCode::PAYLOAD_TOO_LARGE,
                "value_too_large".to_string(),
                serde_json::json!({ "limit": limit, "size": size }),
            ),
            PreferencesError::Serialization(msg) => ApiError::BadRequest(msg),
            PreferencesError::Database(err) => ApiError::Internal(err.into()),
        })?;

    let mut headers = HeaderMap::new();
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));

    Ok((headers, Json(row)))
}

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
                PreferencesError::ValueTooLarge(..) | PreferencesError::Serialization(..) => {
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
