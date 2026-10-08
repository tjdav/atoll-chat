use crate::audit;
use crate::calls::occupancy::CallOccupancyStore;
use crate::calls::CallError;
use crate::rooms;
use crate::sockudo::Publisher;
use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::SqlitePool;

#[derive(Debug, Serialize)]
pub struct EndCallResponse {
    pub call_id: String,
    pub room_id: String,
    pub initiator_id: String,
    pub started_at: DateTime<Utc>,
    pub ended_at: DateTime<Utc>,
}

pub async fn end_call(
    pool: &SqlitePool,
    publisher: &Publisher,
    call_occupancy: &CallOccupancyStore,
    calling_enabled: bool,
    room_id: &str,
    call_id: &str,
    caller_id: &str,
) -> Result<EndCallResponse, CallError> {
    if !calling_enabled {
        return Err(CallError::CallingDisabled);
    }

    // 1. Verify caller is a member of the room
    if rooms::get_room_for_user(pool, room_id, caller_id)
        .await
        .map_err(|_| CallError::RoomNotFound)?
        .is_none()
    {
        return Err(CallError::RoomNotFound);
    }

    // 2. Fetch call session
    let session_opt: Option<(String, DateTime<Utc>, Option<DateTime<Utc>>)> = sqlx::query_as(
        "SELECT initiator_id, started_at, ended_at FROM call_sessions WHERE id = ? AND room_id = ?",
    )
    .bind(call_id)
    .bind(room_id)
    .fetch_optional(pool)
    .await?;

    let (initiator_id, started_at, existing_ended_at) = match session_opt {
        Some(s) => s,
        None => return Err(CallError::CallNotFound),
    };

    // 3. Authorization check: caller must be initiator or room owner
    let owner_id: String = sqlx::query_scalar("SELECT owner_id FROM rooms WHERE id = ?")
        .bind(room_id)
        .fetch_one(pool)
        .await?;

    if caller_id != initiator_id && caller_id != owner_id {
        return Err(CallError::Forbidden);
    }

    // 4. Idempotency check
    if let Some(ended_at) = existing_ended_at {
        return Ok(EndCallResponse {
            call_id: call_id.to_string(),
            room_id: room_id.to_string(),
            initiator_id,
            started_at,
            ended_at,
        });
    }

    // 5. Atomic database transaction to update ended_at and left_at
    let mut tx = pool.begin().await?;

    let (ended_at,): (DateTime<Utc>,) = sqlx::query_as(
        "UPDATE call_sessions SET ended_at = CURRENT_TIMESTAMP WHERE id = ? AND room_id = ? RETURNING ended_at",
    )
    .bind(call_id)
    .bind(room_id)
    .fetch_one(&mut *tx)
    .await?;

    tx.commit().await?;

    call_occupancy.clear_call(call_id).await;

    // 6. Post-commit: publish call.ended room event and log audit entry
    let channel = format!("private-room-{}", room_id);
    let event_payload = serde_json::json!({
        "call_id": call_id,
        "room_id": room_id,
        "ended_at": ended_at,
    });

    if let Err(e) = publisher
        .publish(&channel, "call.ended", event_payload)
        .await
    {
        tracing::warn!(
            error = %e,
            call_id = %call_id,
            room_id = %room_id,
            "Failed to publish call.ended event"
        );
    }

    let _ = audit::log(
        pool,
        Some(caller_id),
        audit::action::CALL_END,
        Some("call"),
        Some(call_id),
        Some(serde_json::json!({
            "call_id": call_id,
            "room_id": room_id,
        })),
    )
    .await;

    Ok(EndCallResponse {
        call_id: call_id.to_string(),
        room_id: room_id.to_string(),
        initiator_id,
        started_at,
        ended_at,
    })
}
