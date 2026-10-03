use crate::calls::CallError;
use crate::rooms;
use crate::sockudo::Publisher;
use crate::sync::envelope::{publish_user_event, UserEventEnvelope};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

#[derive(Debug, Deserialize)]
pub struct SignalRequest {
    pub signal_type: String,
    pub payload: String,
}

#[derive(Debug, Serialize)]
pub struct SignalResponse {
    pub delivered_to: usize,
}

pub async fn send_signal(
    pool: &SqlitePool,
    publisher: &Publisher,
    calling_enabled: bool,
    room_id: &str,
    call_id: &str,
    caller_id: &str,
    req: SignalRequest,
) -> Result<SignalResponse, CallError> {
    if !calling_enabled {
        return Err(CallError::CallingDisabled);
    }

    // Verify caller is a member of the room
    if rooms::get_room_for_user(pool, room_id, caller_id)
        .await
        .map_err(|_| CallError::RoomNotFound)?
        .is_none()
    {
        return Err(CallError::RoomNotFound);
    }

    // Option A lazy creation in a transaction
    let mut tx = pool.begin().await?;

    let existing_session: Option<(String,)> = sqlx::query_as(
        "SELECT room_id FROM call_sessions WHERE id = ?",
    )
    .bind(call_id)
    .fetch_optional(&mut *tx)
    .await?;

    if let Some((existing_room_id,)) = existing_session {
        if existing_room_id != room_id {
            return Err(CallError::CallIdConflict);
        }
    } else {
        sqlx::query(
            "INSERT INTO call_sessions (id, room_id, initiator_id, started_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)",
        )
        .bind(call_id)
        .bind(room_id)
        .bind(caller_id)
        .execute(&mut *tx)
        .await?;
    }

    // Upsert participant row for caller
    sqlx::query(
        "INSERT INTO call_participants (call_id, user_id, joined_at, left_at)
         VALUES (?, ?, CURRENT_TIMESTAMP, NULL)
         ON CONFLICT(call_id, user_id) DO UPDATE SET left_at = NULL",
    )
    .bind(call_id)
    .bind(caller_id)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;

    // Query all other active participants
    let other_participants: Vec<(String,)> = sqlx::query_as(
        "SELECT user_id FROM call_participants WHERE call_id = ? AND user_id != ? AND left_at IS NULL",
    )
    .bind(call_id)
    .bind(caller_id)
    .fetch_all(pool)
    .await?;

    let delivered_count = other_participants.len();

    // Broadcast call.signal user event to each other participant
    let envelope = UserEventEnvelope::new(
        "call.signal",
        0,
        serde_json::json!({
            "call_id": call_id,
            "sender_user_id": caller_id,
            "signal_type": req.signal_type,
            "payload": req.payload,
        }),
    );

    for (target_user_id,) in other_participants {
        if let Err(e) = publish_user_event(publisher, &target_user_id, &envelope).await {
            tracing::warn!(
                error = %e,
                target_user_id = %target_user_id,
                call_id = %call_id,
                "Failed to deliver call.signal event"
            );
        }
    }

    Ok(SignalResponse {
        delivered_to: delivered_count,
    })
}
