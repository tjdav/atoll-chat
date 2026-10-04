use crate::devices;
use crate::rooms;
use crate::sockudo::Publisher;
use crate::sync::envelope::{publish_user_event, UserEventEnvelope};
use base64::engine::general_purpose::{STANDARD, STANDARD_NO_PAD, URL_SAFE, URL_SAFE_NO_PAD};
use base64::Engine;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

#[derive(Debug, Deserialize)]
pub struct SignalRequest {
    pub sender_client_id: String,
    pub target_client_id: Option<String>,
    pub signal_type: String,
    pub payload: String,
}

#[derive(Debug, Serialize)]
pub struct SignalResponse {
    pub delivered_to: usize,
}

#[derive(thiserror::Error, Debug)]
pub enum SignalError {
    #[error("Sessions disabled")]
    SessionsDisabled,
    #[error("Session not found")]
    SessionNotFound,
    #[error("Room not found")]
    RoomNotFound,
    #[error("Invalid client_id")]
    InvalidClientId,
    #[error("Invalid signal_type")]
    InvalidSignalType,
    #[error("Invalid payload")]
    InvalidPayload,
    #[error("Not a participant")]
    NotAParticipant,
    #[error("Target not found")]
    TargetNotFound,
    #[error("Database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("Device error: {0}")]
    Device(#[from] crate::devices::DeviceError),
}

fn decode_base64_flexible(s: &str) -> Result<Vec<u8>, base64::DecodeError> {
    STANDARD
        .decode(s)
        .or_else(|_| STANDARD_NO_PAD.decode(s))
        .or_else(|_| URL_SAFE.decode(s))
        .or_else(|_| URL_SAFE_NO_PAD.decode(s))
}

#[allow(clippy::too_many_arguments)]
pub async fn send_session_signal(
    pool: &SqlitePool,
    publisher: &Publisher,
    occupancy: &super::OccupancyStore,
    sessions_enabled: bool,
    room_id: &str,
    session_id: &str,
    caller_id: &str,
    req: SignalRequest,
) -> Result<SignalResponse, SignalError> {
    if !sessions_enabled {
        return Err(SignalError::SessionsDisabled);
    }

    // 1. Verify session exists in room
    let exists: Option<(i32,)> =
        sqlx::query_as("SELECT 1 FROM room_sessions WHERE id = ? AND room_id = ?")
            .bind(session_id)
            .bind(room_id)
            .fetch_optional(pool)
            .await?;
    if exists.is_none() {
        return Err(SignalError::SessionNotFound);
    }

    // 2. Verify room membership
    if rooms::get_room_for_user(pool, room_id, caller_id)
        .await
        .map_err(|_| SignalError::RoomNotFound)?
        .is_none()
    {
        return Err(SignalError::RoomNotFound);
    }

    // 3. Validate signal_type
    if req.signal_type.trim().is_empty() || req.signal_type.len() > 128 {
        return Err(SignalError::InvalidSignalType);
    }

    // 4. Validate payload: valid Base64 decoding to <= 64 KiB (65,536 bytes)
    let decoded = decode_base64_flexible(&req.payload).map_err(|_| SignalError::InvalidPayload)?;
    if decoded.len() > 65536 {
        return Err(SignalError::InvalidPayload);
    }

    // 5. Validate sender_client_id belongs to caller
    let dev = devices::find_by_client_id(pool, caller_id, &req.sender_client_id).await?;
    if dev.is_none() {
        return Err(SignalError::InvalidClientId);
    }

    // 6. Verify caller is a current participant in the session (user_id and sender_client_id)
    if !occupancy
        .is_client_of(session_id, caller_id, &req.sender_client_id)
        .await
    {
        return Err(SignalError::NotAParticipant);
    }

    // 7. Route signal per mode
    if let Some(ref target_client_id) = req.target_client_id {
        // Unicast mode
        if target_client_id.trim().is_empty() {
            return Err(SignalError::InvalidClientId);
        }

        let target_user_id = occupancy
            .find_user_for_client(session_id, target_client_id)
            .await
            .ok_or(SignalError::TargetNotFound)?;

        let event_payload = serde_json::json!({
            "room_id": room_id,
            "session_id": session_id,
            "sender_user_id": caller_id,
            "sender_client_id": req.sender_client_id,
            "target_client_id": target_client_id,
            "signal_type": req.signal_type,
            "payload": req.payload,
        });

        let envelope = UserEventEnvelope::new("session.signal", 0, event_payload);
        if let Err(e) = publish_user_event(publisher, &target_user_id, &envelope).await {
            tracing::warn!(
                error = %e,
                target_user_id = %target_user_id,
                session_id = %session_id,
                "Failed to deliver unicast session.signal event"
            );
        }

        Ok(SignalResponse { delivered_to: 1 })
    } else {
        // Broadcast mode
        let all_participants = occupancy.participant_user_ids(session_id).await;
        let targets: Vec<String> = all_participants
            .into_iter()
            .filter(|uid| uid != caller_id)
            .collect();

        let delivered_count = targets.len();

        let event_payload = serde_json::json!({
            "room_id": room_id,
            "session_id": session_id,
            "sender_user_id": caller_id,
            "sender_client_id": req.sender_client_id,
            "signal_type": req.signal_type,
            "payload": req.payload,
        });

        let envelope = UserEventEnvelope::new("session.signal", 0, event_payload);

        for target_user_id in targets {
            if let Err(e) = publish_user_event(publisher, &target_user_id, &envelope).await {
                tracing::warn!(
                    error = %e,
                    target_user_id = %target_user_id,
                    session_id = %session_id,
                    "Failed to deliver broadcast session.signal event"
                );
            }
        }

        Ok(SignalResponse {
            delivered_to: delivered_count,
        })
    }
}
