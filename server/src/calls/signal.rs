use crate::calls::occupancy::CallOccupancyStore;
use crate::error::ApiError;
use crate::rate_limit::{self, RateLimitKey};
use crate::rooms;
use crate::sockudo::Publisher;
use base64::Engine;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

#[derive(Debug, Deserialize)]
pub struct SignalRequest {
    pub sender_client_id: String,
    pub target_user_id: String,
    pub target_client_id: String,
    pub envelope: String,
}

#[derive(Debug, Serialize)]
pub struct SignalResponse {
    pub delivered_to: usize,
}

#[allow(clippy::too_many_arguments)]
pub async fn send_signal(
    pool: &SqlitePool,
    publisher: &Publisher,
    call_occupancy: &CallOccupancyStore,
    rate_limit_config: &crate::config::RateLimitConfig,
    calling_enabled: bool,
    room_id: &str,
    call_id: &str,
    caller_id: &str,
    req: SignalRequest,
) -> Result<SignalResponse, ApiError> {
    // 1. If CALLING_ENABLED=false, return 501 calling_disabled
    if !calling_enabled {
        return Err(ApiError::NotImplemented("calling_disabled".to_string()));
    }

    // 2. Verify caller is a member of the room
    let member_opt = rooms::get_room_for_user(pool, room_id, caller_id)
        .await
        .map_err(|e| ApiError::Internal(e.into()))?;

    if member_opt.is_none() {
        return Err(ApiError::NotFound("room_not_found".to_string()));
    }

    // 3. Verify caller is a participant in (room_id, call_id)
    if !call_occupancy.is_participant(call_id, caller_id).await {
        return Err(ApiError::Forbidden("not_a_participant".to_string()));
    }

    // 4. Verify sender_client_id belongs to the caller in this call
    if !call_occupancy
        .is_client_owner(call_id, caller_id, &req.sender_client_id)
        .await
    {
        return Err(ApiError::Forbidden("sender_client_not_owned".to_string()));
    }

    // 5. Verify target_client_id is a current participant in the call
    let target_user = match call_occupancy
        .find_user_for_client(call_id, &req.target_client_id)
        .await
    {
        Some(u) => u,
        None => return Err(ApiError::NotFound("target_not_found".to_string())),
    };

    // 6. Verify target_user_id matches the user found for target_client_id
    if target_user != req.target_user_id {
        return Err(ApiError::BadRequest("target_user_mismatch".to_string()));
    }

    // 7. Verify envelope is valid base64url
    let is_valid_b64 = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(&req.envelope)
        .or_else(|_| base64::engine::general_purpose::URL_SAFE.decode(&req.envelope))
        .is_ok();

    if !is_valid_b64 {
        return Err(ApiError::BadRequest("invalid_envelope".to_string()));
    }

    // 8. Enforce RATE_CALL_SIGNAL_PER_MIN per user per call
    let rate_key = RateLimitKey::CallSignal {
        user_id: caller_id.to_string(),
        call_id: call_id.to_string(),
    };
    let decision = rate_limit::check(pool, rate_limit_config, rate_key)
        .await
        .map_err(|e| ApiError::Internal(e.into()))?;

    if !decision.allowed {
        return Err(ApiError::TooManyRequests {
            message: "rate_limited".to_string(),
            reset_at: decision.reset_at,
        });
    }

    // 9. Publish call.signal on private-user-{target_user_id}
    let channel = format!("private-user-{}", req.target_user_id);
    let event_payload = serde_json::json!({
        "call_id": call_id,
        "sender_user_id": caller_id,
        "sender_client_id": req.sender_client_id,
        "target_client_id": req.target_client_id,
        "envelope": req.envelope,
    });

    if let Err(e) = publisher
        .publish(&channel, "call.signal", event_payload)
        .await
    {
        tracing::warn!(
            error = %e,
            "Failed to deliver call.signal event"
        );
    }

    // 10. Return 200 OK with { "delivered_to": 1 }
    Ok(SignalResponse { delivered_to: 1 })
}
