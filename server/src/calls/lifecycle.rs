use crate::audit;
use crate::calls::occupancy::CallOccupancyStore;
use crate::calls::CallError;
use crate::devices;
use crate::limits::{self, ServerHardMax};
use crate::rooms;
use crate::sockudo::Publisher;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

#[derive(Debug, Deserialize)]
pub struct JoinCallRequest {
    pub client_id: String,
}

#[derive(Debug, Serialize)]
pub struct JoinCallResponse {
    pub ice_servers: Vec<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
pub struct LeaveCallRequest {
    pub client_id: String,
}

#[derive(Debug, Serialize)]
pub struct EndCallResponse {
    pub call_id: String,
    pub room_id: String,
    pub initiator_id: String,
    pub started_at: DateTime<Utc>,
    pub ended_at: DateTime<Utc>,
}

type CallSessionRow = (String, DateTime<Utc>, Option<DateTime<Utc>>, String);

#[allow(clippy::too_many_arguments)]
pub async fn join_call(
    pool: &SqlitePool,
    publisher: &Publisher,
    call_occupancy: &CallOccupancyStore,
    server_hard_max: &ServerHardMax,
    calling_enabled: bool,
    room_id: &str,
    call_id: &str,
    caller_id: &str,
    req: JoinCallRequest,
) -> Result<JoinCallResponse, CallError> {
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

    // 2. Verify client_id belongs to caller
    if devices::find_by_client_id(pool, caller_id, &req.client_id)
        .await?
        .is_none()
    {
        return Err(CallError::ClientNotOwned);
    }

    // 3. Transactional session lookup or creation
    let mut tx = pool.begin().await?;

    let existing_session: Option<CallSessionRow> = sqlx::query_as(
        "SELECT room_id, started_at, ended_at, initiator_id FROM call_sessions WHERE id = ?",
    )
    .bind(call_id)
    .fetch_optional(&mut *tx)
    .await?;

    let (first_join, started_at, initiator_id) = match existing_session {
        Some((existing_room_id, started_at, ended_at, init_id)) => {
            if existing_room_id != room_id {
                return Err(CallError::CallIdConflict);
            }
            if ended_at.is_some() {
                return Err(CallError::CallEnded);
            }
            (false, started_at, init_id)
        }
        None => {
            let (started_at,): (DateTime<Utc>,) = sqlx::query_as(
                "INSERT INTO call_sessions (id, room_id, initiator_id, started_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP) RETURNING started_at",
            )
            .bind(call_id)
            .bind(room_id)
            .bind(caller_id)
            .fetch_one(&mut *tx)
            .await?;

            (true, started_at, caller_id.to_string())
        }
    };

    tx.commit().await?;

    // 4. Add client to occupancy store
    call_occupancy
        .add_client(call_id, caller_id, &req.client_id)
        .await;

    // 5. Enforce call_max_participants
    let instance_limits = limits::get_limits(pool, server_hard_max).await?;
    let effective_max_participants = instance_limits.call_max_participants as usize;

    if call_occupancy.participant_count(call_id).await > effective_max_participants {
        call_occupancy
            .remove_client(call_id, caller_id, &req.client_id)
            .await;
        return Err(CallError::CallFull);
    }

    // 6. If first join, publish call.started and write audit log
    if first_join {
        let channel = format!("private-room-{}", room_id);
        let event_payload = serde_json::json!({
            "call_id": call_id,
            "room_id": room_id,
            "initiator_id": initiator_id,
            "started_at": started_at,
        });

        if let Err(e) = publisher
            .publish(&channel, "call.started", event_payload)
            .await
        {
            tracing::warn!(
                error = %e,
                call_id = %call_id,
                room_id = %room_id,
                "Failed to publish call.started event"
            );
        }

        let _ = audit::log(
            pool,
            Some(caller_id),
            audit::action::CALL_START,
            Some("call"),
            Some(call_id),
            Some(serde_json::json!({
                "call_id": call_id,
                "room_id": room_id,
            })),
        )
        .await;
    }

    Ok(JoinCallResponse {
        ice_servers: vec![],
    })
}

pub async fn leave_call(
    pool: &SqlitePool,
    call_occupancy: &CallOccupancyStore,
    calling_enabled: bool,
    room_id: &str,
    call_id: &str,
    caller_id: &str,
    req: LeaveCallRequest,
) -> Result<(), CallError> {
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

    // 2. Verify client_id belongs to caller
    if devices::find_by_client_id(pool, caller_id, &req.client_id)
        .await?
        .is_none()
    {
        return Err(CallError::ClientNotOwned);
    }

    // 3. Remove client from occupancy
    call_occupancy
        .remove_client(call_id, caller_id, &req.client_id)
        .await;

    // 4. If call is empty, clear call
    if call_occupancy.participant_count(call_id).await == 0 {
        call_occupancy.clear_call(call_id).await;
    }

    Ok(())
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

    // 5. Atomic database transaction to update ended_at
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

    let duration_seconds = (ended_at - started_at).num_seconds();

    // 6. Post-commit: publish call.ended room event and log audit entry
    let channel = format!("private-room-{}", room_id);
    let event_payload = serde_json::json!({
        "call_id": call_id,
        "room_id": room_id,
        "ended_at": ended_at,
        "duration_seconds": duration_seconds,
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
