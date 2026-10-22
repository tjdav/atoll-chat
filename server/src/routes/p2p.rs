use crate::auth::AuthUser;
use crate::devices;
use crate::error::ApiError;
use crate::rate_limit::{check, RateLimitKey};
use crate::rooms;
use crate::AppState;
use axum::{
    extract::{Path, State},
    http::{header, HeaderMap, HeaderValue},
    Json,
};
use base64::engine::general_purpose::{URL_SAFE, URL_SAFE_NO_PAD};
use base64::Engine;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Debug, Deserialize, ToSchema)]
pub struct P2pSignalRequest {
    pub sender_client_id: String,
    pub target_user_id: String,
    pub target_client_id: String,
    /// End-to-end encrypted P2P file transfer signaling envelope (unpadded Base64URL string, <= 64 KiB) per Server Spec v3.0.4 §6.24, §8.9, and §14.6.
    #[schema(format = Byte, value_type = String)]
    pub envelope: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct P2pSignalResponse {
    pub delivered_to: usize,
}

#[utoipa::path(
    post,
    path = "/api/v1/rooms/{id}/p2p/signal",
    tag = "Messaging",
    summary = "Relay a P2P file transfer signaling envelope.",
    description = "Relays an encrypted WebRTC signaling envelope to the specified target user on their private user channel (`private-user-{target_user_id}`) as `p2p.signal`. Refers to Server Spec v3.0.4 §6.24 (call signaling pattern), §8.9 (user channel events), and §14.6 (metadata minimization). The envelope is opaque to the server, the event is non-durable, and the server does not persist or log the payload.",
    params(
        ("id" = String, Path, description = "Room ID")
    ),
    request_body = P2pSignalRequest,
    responses(
        (status = 200, description = "Signaling envelope relayed successfully", body = P2pSignalResponse),
        (status = 400, description = "Invalid request, envelope, or sender client ID"),
        (status = 401, description = "Unauthorized - invalid or missing session token"),
        (status = 403, description = "Forbidden - caller is not a member of the room"),
        (status = 404, description = "Target user is not a member of the room"),
        (status = 429, description = "Rate limit exceeded for P2P signaling"),
        (status = 500, description = "Internal server error - publish failure")
    ),
    security(
        ("bearer_auth" = [])
    )
)]
pub async fn signal_handler(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(room_id): Path<String>,
    Json(req): Json<P2pSignalRequest>,
) -> Result<(HeaderMap, Json<P2pSignalResponse>), ApiError> {
    // 1. Validate non-empty required fields
    if req.sender_client_id.trim().is_empty()
        || req.target_user_id.trim().is_empty()
        || req.target_client_id.trim().is_empty()
        || req.envelope.trim().is_empty()
    {
        return Err(ApiError::BadRequest("invalid_request".to_string()));
    }

    // 2. Enforce rate limit before state checks to prevent abuse
    let rate_key = RateLimitKey::P2pSignal {
        user_id: auth.user_id.clone(),
        room_id: room_id.clone(),
    };
    let decision = check(&state.pool, &state.config.rate_limits, rate_key).await?;
    if !decision.allowed {
        return Err(ApiError::TooManyRequests {
            message: "rate_limited".to_string(),
            reset_at: decision.reset_at,
        });
    }

    // 3. Verify caller is a member of the room
    let caller_member = rooms::get_room_for_user(&state.pool, &room_id, &auth.user_id)
        .await
        .map_err(|e| ApiError::Internal(e.into()))?;

    if caller_member.is_none() {
        return Err(ApiError::Forbidden("not_a_member".to_string()));
    }

    // 4. Verify target_user_id is a member of room_id
    let is_target_member: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?)",
    )
    .bind(&room_id)
    .bind(&req.target_user_id)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| ApiError::Internal(e.into()))?;

    if !is_target_member {
        return Err(ApiError::NotFound("target_not_in_room".to_string()));
    }

    // 5. Verify sender_client_id belongs to the caller
    let dev = devices::find_by_client_id(&state.pool, &auth.user_id, &req.sender_client_id)
        .await
        .map_err(|e| ApiError::Internal(e.into()))?;

    if dev.is_none() {
        return Err(ApiError::BadRequest("invalid_sender_client_id".to_string()));
    }

    // 6. Validate envelope is valid base64url and <= 64 KiB (65,536 bytes)
    let decoded_res = URL_SAFE_NO_PAD
        .decode(&req.envelope)
        .or_else(|_| URL_SAFE.decode(&req.envelope));

    let decoded = match decoded_res {
        Ok(d) => d,
        Err(_) => return Err(ApiError::BadRequest("invalid_envelope".to_string())),
    };

    if decoded.is_empty() || decoded.len() > 65536 {
        return Err(ApiError::BadRequest("invalid_envelope".to_string()));
    }

    // 7. Publish p2p.signal on private-user-{target_user_id}
    let channel = format!("private-user-{}", req.target_user_id);
    let event_payload = serde_json::json!({
        "room_id": room_id,
        "sender_user_id": auth.user_id,
        "sender_client_id": req.sender_client_id,
        "target_client_id": req.target_client_id,
        "envelope": req.envelope,
    });

    if let Err(e) = state
        .publisher
        .publish(&channel, "p2p.signal", event_payload)
        .await
    {
        tracing::error!(
            error = %e,
            "Failed to deliver p2p.signal event"
        );
        return Err(ApiError::Internal(e.into()));
    }

    let mut headers = HeaderMap::new();
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));

    Ok((headers, Json(P2pSignalResponse { delivered_to: 1 })))
}
