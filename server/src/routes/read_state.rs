use axum::{
    extract::State,
    http::{header, HeaderMap, HeaderValue},
    Json,
};
use serde::Deserialize;

use crate::{
    auth::AuthUser,
    error::ApiError,
    rate_limit::{self, RateLimitKey},
    sync::read_state::{self, ReadStateError, ReadStateRow, WriteRequest},
    AppState,
};

#[derive(Debug, Deserialize)]
pub struct WriteReadStateRequest {
    pub room_id: Option<String>,
    pub last_read_message_id: Option<String>,
}

pub async fn write(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(payload): Json<WriteReadStateRequest>,
) -> Result<(HeaderMap, Json<ReadStateRow>), ApiError> {
    // 1. Rate limiting
    let rl_decision = rate_limit::check(
        &state.pool,
        &state.config.rate_limits,
        RateLimitKey::ReadState {
            user_id: auth.user_id.clone(),
        },
    )
    .await?;

    if !rl_decision.allowed {
        return Err(ApiError::TooManyRequests {
            message: "rate limit exceeded".to_string(),
            reset_at: rl_decision.reset_at,
        });
    }

    // 2. Validate room_id
    let room_id = match payload.room_id {
        Some(ref id) if !id.trim().is_empty() => id.trim().to_string(),
        _ => {
            return Err(ApiError::InternalWithDetails(
                axum::http::StatusCode::BAD_REQUEST,
                "missing_field".to_string(),
                serde_json::json!({ "field": "room_id" }),
            ))
        }
    };

    // 3. Validate last_read_message_id
    let last_read_message_id = match payload.last_read_message_id {
        Some(ref id) => {
            let trimmed = id.trim();
            if trimmed.is_empty() {
                return Err(ApiError::BadRequest("invalid_message_id".to_string()));
            }
            Some(trimmed.to_string())
        }
        None => None,
    };

    // 4. Write read state
    let write_req = WriteRequest {
        user_id: auth.user_id,
        room_id,
        last_read_message_id,
    };

    let row = read_state::write_read_state(&state.pool, &state.publisher, write_req)
        .await
        .map_err(|e| match e {
            ReadStateError::NotAMember(_) => ApiError::NotFound("room_not_found".to_string()),
            ReadStateError::MessageNotFound => ApiError::NotFound("message_not_found".to_string()),
            ReadStateError::Database(err) => ApiError::Internal(err.into()),
        })?;

    // 5. Build response headers with Cache-Control: no-store
    let mut headers = HeaderMap::new();
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));

    Ok((headers, Json(row)))
}
