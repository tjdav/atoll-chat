use serde::{Deserialize, Serialize};
use sqlx::{Row, SqlitePool};
use std::collections::HashSet;

use crate::sockudo::Publisher;
use crate::sync::{self, publish_user_event, UserEventEnvelope};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RoomOrderSyncState {
    pub room_ids: Vec<String>,
    pub user_seq: i64,
}

#[derive(Debug, thiserror::Error)]
pub enum RoomOrderError {
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("invalid room ids: duplicate room_id found")]
    DuplicateRoomIds,
    #[error("not a member of room: {0}")]
    NotAMember(String),
    #[error("too many rooms: max is {0}, got {1}")]
    TooManyRooms(usize, usize),
}

pub async fn get_room_order(
    pool: &SqlitePool,
    user_id: &str,
) -> Result<Option<RoomOrderSyncState>, RoomOrderError> {
    let rows = sqlx::query(
        r#"
        SELECT room_id, user_seq
        FROM user_room_order
        WHERE user_id = ?
        ORDER BY position ASC
        "#,
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?;

    if rows.is_empty() {
        return Ok(None);
    }

    let mut room_ids = Vec::with_capacity(rows.len());
    let mut max_seq = 0i64;

    for row in rows {
        let r_id: String = row.get("room_id");
        let seq: i64 = row.get("user_seq");
        room_ids.push(r_id);
        if seq > max_seq {
            max_seq = seq;
        }
    }

    Ok(Some(RoomOrderSyncState {
        room_ids,
        user_seq: max_seq,
    }))
}

pub async fn set_room_order(
    pool: &SqlitePool,
    publisher: &Publisher,
    user_id: &str,
    room_ids: Vec<String>,
    rooms_per_user_limit: usize,
) -> Result<RoomOrderSyncState, RoomOrderError> {
    // 1. Validate length cap
    if room_ids.len() > rooms_per_user_limit {
        return Err(RoomOrderError::TooManyRooms(
            rooms_per_user_limit,
            room_ids.len(),
        ));
    }

    // 2. Validate duplicate room_ids
    let mut seen = HashSet::with_capacity(room_ids.len());
    for room_id in &room_ids {
        if !seen.insert(room_id) {
            return Err(RoomOrderError::DuplicateRoomIds);
        }
    }

    // 3. Validate room membership for every room_id
    for room_id in &room_ids {
        let is_member: Option<i64> =
            sqlx::query_scalar("SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?")
                .bind(room_id)
                .bind(user_id)
                .fetch_optional(pool)
                .await?;

        if is_member.is_none() {
            return Err(RoomOrderError::NotAMember(room_id.clone()));
        }
    }

    // 4. Check no-op guard against current state
    let current = get_room_order(pool, user_id).await?;
    let current_room_ids = current
        .as_ref()
        .map(|c| c.room_ids.clone())
        .unwrap_or_default();

    if current_room_ids == room_ids {
        let existing_seq = current.map(|c| c.user_seq).unwrap_or(0);
        return Ok(RoomOrderSyncState {
            room_ids,
            user_seq: existing_seq,
        });
    }

    // 5. Execute replacement transaction
    let mut tx = pool.begin().await?;

    let seq = sync::seq::allocate_user_seq(&mut tx, user_id)
        .await
        .map_err(|e| match e {
            sync::SyncError::Database(err) => RoomOrderError::Database(err),
            other => RoomOrderError::Database(sqlx::Error::Protocol(other.to_string())),
        })?;

    sqlx::query("DELETE FROM user_room_order WHERE user_id = ?")
        .bind(user_id)
        .execute(&mut *tx)
        .await?;

    for (pos, room_id) in room_ids.iter().enumerate() {
        sqlx::query(
            r#"
            INSERT INTO user_room_order (user_id, room_id, position, user_seq, updated_at)
            VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
            "#,
        )
        .bind(user_id)
        .bind(room_id)
        .bind(pos as i64)
        .bind(seq)
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;

    let state = RoomOrderSyncState {
        room_ids: room_ids.clone(),
        user_seq: seq,
    };

    // 6. Publish room_order.sync event
    let payload = serde_json::json!({
        "room_ids": state.room_ids,
        "user_seq": state.user_seq,
    });
    let envelope = UserEventEnvelope::new("room_order.sync", state.user_seq, payload);
    if let Err(e) = publish_user_event(publisher, user_id, &envelope).await {
        tracing::warn!(error = %e, user_id = %user_id, "room_order.sync publish failed");
    }

    Ok(state)
}
