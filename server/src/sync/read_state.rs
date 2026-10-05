use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{Row, SqlitePool};

use crate::sockudo::Publisher;
use crate::sync::{self, publish_user_event, UserEventEnvelope};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ReadStateRow {
    pub room_id: String,
    pub last_read_message_id: Option<String>,
    pub user_seq: i64,
    pub updated_at: DateTime<Utc>,
    pub deleted_at: Option<DateTime<Utc>>,
}

pub struct WriteRequest {
    pub user_id: String,
    pub room_id: String,
    pub last_read_message_id: Option<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum ReadStateError {
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("not a member of room {0}")]
    NotAMember(String),
    #[error("message not found in room")]
    MessageNotFound,
}

pub async fn write_read_state(
    pool: &SqlitePool,
    publisher: &Publisher,
    req: WriteRequest,
) -> Result<ReadStateRow, ReadStateError> {
    let mut tx = pool.begin().await?;

    // 1. Verify membership
    let is_member: Option<i32> =
        sqlx::query_scalar("SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?")
            .bind(&req.room_id)
            .bind(&req.user_id)
            .fetch_optional(&mut *tx)
            .await?;

    if is_member.is_none() {
        return Err(ReadStateError::NotAMember(req.room_id));
    }

    // 2. If last_read_message_id is Some, verify message exists in room
    if let Some(ref msg_id) = req.last_read_message_id {
        let msg_exists: Option<i32> =
            sqlx::query_scalar("SELECT 1 FROM room_messages WHERE id = ? AND room_id = ?")
                .bind(msg_id)
                .bind(&req.room_id)
                .fetch_optional(&mut *tx)
                .await?;

        if msg_exists.is_none() {
            return Err(ReadStateError::MessageNotFound);
        }
    }

    // 3. Allocate a user_seq
    let seq = sync::seq::allocate_user_seq(&mut tx, &req.user_id)
        .await
        .map_err(|e| match e {
            sync::SyncError::Database(err) => ReadStateError::Database(err),
            other => ReadStateError::Database(sqlx::Error::Protocol(other.to_string())),
        })?;

    // 4. Upsert the row
    let row: (DateTime<Utc>,) = sqlx::query_as(
        r#"
        INSERT INTO read_state (
            user_id, room_id, last_read_message_id, user_seq, updated_at, deleted_at
        ) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, NULL)
        ON CONFLICT(user_id, room_id) DO UPDATE SET
            last_read_message_id = excluded.last_read_message_id,
            user_seq = excluded.user_seq,
            updated_at = CURRENT_TIMESTAMP,
            deleted_at = NULL
        RETURNING updated_at
        "#,
    )
    .bind(&req.user_id)
    .bind(&req.room_id)
    .bind(&req.last_read_message_id)
    .bind(seq)
    .fetch_one(&mut *tx)
    .await?;

    // 5. Commit
    tx.commit().await?;

    let result_row = ReadStateRow {
        room_id: req.room_id.clone(),
        last_read_message_id: req.last_read_message_id.clone(),
        user_seq: seq,
        updated_at: row.0,
        deleted_at: None,
    };

    // 6. After commit, publish read.sync
    let payload = serde_json::json!({
        "room_id": req.room_id,
        "last_read_message_id": result_row.last_read_message_id,
        "user_seq": result_row.user_seq,
    });
    let envelope = UserEventEnvelope::new("read.sync", result_row.user_seq, payload);
    if let Err(e) = publish_user_event(publisher, &req.user_id, &envelope).await {
        tracing::warn!(error = %e, user_id = %req.user_id, "read.sync publish failed");
    }

    // 7. Return ReadStateRow
    Ok(result_row)
}

pub async fn list_read_state_since(
    pool: &SqlitePool,
    user_id: &str,
    since_seq: i64,
) -> Result<Vec<ReadStateRow>, ReadStateError> {
    let rows = sqlx::query(
        r#"
        SELECT room_id, last_read_message_id, user_seq, updated_at, deleted_at
        FROM read_state
        WHERE user_id = ? AND user_seq > ?
        ORDER BY user_seq ASC
        "#,
    )
    .bind(user_id)
    .bind(since_seq)
    .fetch_all(pool)
    .await?;

    let mut result = Vec::with_capacity(rows.len());
    for row in rows {
        result.push(ReadStateRow {
            room_id: row.get("room_id"),
            last_read_message_id: row.get("last_read_message_id"),
            user_seq: row.get("user_seq"),
            updated_at: row.get("updated_at"),
            deleted_at: row.get("deleted_at"),
        });
    }

    Ok(result)
}

pub async fn list_read_state_all(
    pool: &SqlitePool,
    user_id: &str,
) -> Result<Vec<ReadStateRow>, ReadStateError> {
    let rows = sqlx::query(
        r#"
        SELECT room_id, last_read_message_id, user_seq, updated_at, deleted_at
        FROM read_state
        WHERE user_id = ? AND deleted_at IS NULL
        ORDER BY user_seq ASC
        "#,
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?;

    let mut result = Vec::with_capacity(rows.len());
    for row in rows {
        result.push(ReadStateRow {
            room_id: row.get("room_id"),
            last_read_message_id: row.get("last_read_message_id"),
            user_seq: row.get("user_seq"),
            updated_at: row.get("updated_at"),
            deleted_at: row.get("deleted_at"),
        });
    }

    Ok(result)
}
