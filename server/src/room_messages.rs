use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::{Row, SqlitePool};
use ulid::Ulid;

#[derive(Debug, Clone, Serialize)]
pub struct RoomMessageView {
    pub id: String,
    pub room_id: String,
    pub sender_user_id: String,
    pub sender_client_id: String,
    pub epoch: i64,
    pub seq: i64,
    pub content_type: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(untagged)]
pub enum SubmitOutcome {
    Application {
        message_id: String,
        epoch: i64,
        seq: i64,
    },
    Commit {
        message_id: String,
        new_epoch: i64,
        #[serde(skip_serializing_if = "Option::is_none")]
        transcript_hash: Option<Vec<u8>>,
    },
}

#[derive(Debug)]
pub struct SubmitRequest {
    pub room_id: String,
    pub sender_user_id: String,
    pub sender_client_id: String,
    pub epoch: i64,
    pub content_type: MessageContentType,
    pub ciphertext: Vec<u8>,
    pub transcript_hash: Option<Vec<u8>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MessageContentType {
    Application,
    Commit,
    Proposal,
}

impl MessageContentType {
    pub fn as_str(&self) -> &'static str {
        match self {
            MessageContentType::Application => "application",
            MessageContentType::Commit => "commit",
            MessageContentType::Proposal => "proposal",
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum RoomMessageError {
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("room not found")]
    RoomNotFound,
    #[error("not a member")]
    NotAMember,
    #[error("epoch mismatch: expected {expected}, received {received}")]
    EpochMismatch { expected: i64, received: i64 },
    #[error("commit requires a transcript hash")]
    MissingTranscriptHash,
    #[error("application message requires an existing epoch")]
    NoEpochEstablished,
    #[error("message not found")]
    MessageNotFound,
}

pub async fn submit_message(
    pool: &SqlitePool,
    req: SubmitRequest,
) -> Result<SubmitOutcome, RoomMessageError> {
    let mut conn = pool.acquire().await?;
    sqlx::query("BEGIN IMMEDIATE").execute(&mut *conn).await?;

    let result = async {
        // 1. Verify sender is member
        let member_role: Option<(String,)> =
            sqlx::query_as("SELECT role FROM room_members WHERE room_id = ? AND user_id = ?")
                .bind(&req.room_id)
                .bind(&req.sender_user_id)
                .fetch_optional(&mut *conn)
                .await?;

        if member_role.is_none() {
            return Err(RoomMessageError::NotAMember);
        }

        // 2. Fetch current epoch row
        let epoch_row: Option<(i64, i64)> =
            sqlx::query_as("SELECT epoch, sequence FROM room_epochs WHERE room_id = ?")
                .bind(&req.room_id)
                .fetch_optional(&mut *conn)
                .await?;

        let (current_epoch, current_sequence) = match epoch_row {
            Some(row) => row,
            None => return Err(RoomMessageError::RoomNotFound),
        };

        // 3. Handle by content_type
        match req.content_type {
            MessageContentType::Commit => {
                if req.epoch != current_epoch {
                    return Err(RoomMessageError::EpochMismatch {
                        expected: current_epoch,
                        received: req.epoch,
                    });
                }

                let transcript_hash = match req.transcript_hash.clone() {
                    Some(th) => th,
                    None => return Err(RoomMessageError::MissingTranscriptHash),
                };

                let message_id = Ulid::new().to_string();

                sqlx::query(
                    r#"
                    INSERT INTO room_messages (id, room_id, sender_user_id, sender_client_id, epoch, seq, content_type, ciphertext)
                    VALUES (?, ?, ?, ?, ?, 0, 'commit', ?)
                    "#,
                )
                .bind(&message_id)
                .bind(&req.room_id)
                .bind(&req.sender_user_id)
                .bind(&req.sender_client_id)
                .bind(current_epoch)
                .bind(&req.ciphertext)
                .execute(&mut *conn)
                .await?;

                let new_epoch = current_epoch + 1;

                sqlx::query(
                    r#"
                    UPDATE room_epochs
                    SET epoch = ?, sequence = 0, confirmed_transcript_hash = ?, updated_at = CURRENT_TIMESTAMP
                    WHERE room_id = ?
                    "#,
                )
                .bind(new_epoch)
                .bind(&transcript_hash)
                .bind(&req.room_id)
                .execute(&mut *conn)
                .await?;

                Ok(SubmitOutcome::Commit {
                    message_id,
                    new_epoch,
                    transcript_hash: Some(transcript_hash),
                })
            }
            MessageContentType::Application | MessageContentType::Proposal => {
                if req.epoch != current_epoch {
                    return Err(RoomMessageError::EpochMismatch {
                        expected: current_epoch,
                        received: req.epoch,
                    });
                }

                let next_sequence = current_sequence + 1;
                let message_id = Ulid::new().to_string();

                sqlx::query(
                    r#"
                    INSERT INTO room_messages (id, room_id, sender_user_id, sender_client_id, epoch, seq, content_type, ciphertext)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    "#,
                )
                .bind(&message_id)
                .bind(&req.room_id)
                .bind(&req.sender_user_id)
                .bind(&req.sender_client_id)
                .bind(current_epoch)
                .bind(next_sequence)
                .bind(req.content_type.as_str())
                .bind(&req.ciphertext)
                .execute(&mut *conn)
                .await?;

                sqlx::query("UPDATE room_epochs SET sequence = ? WHERE room_id = ?")
                    .bind(next_sequence)
                    .bind(&req.room_id)
                    .execute(&mut *conn)
                    .await?;

                Ok(SubmitOutcome::Application {
                    message_id,
                    epoch: current_epoch,
                    seq: next_sequence,
                })
            }
        }
    }
    .await;

    match result {
        Ok(outcome) => {
            sqlx::query("COMMIT").execute(&mut *conn).await?;
            Ok(outcome)
        }
        Err(err) => {
            let _ = sqlx::query("ROLLBACK").execute(&mut *conn).await;
            Err(err)
        }
    }
}

pub async fn get_current_epoch(
    pool: &SqlitePool,
    room_id: &str,
    user_id: &str,
) -> Result<(i64, i64), RoomMessageError> {
    let is_member: Option<(i32,)> =
        sqlx::query_as("SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?")
            .bind(room_id)
            .bind(user_id)
            .fetch_optional(pool)
            .await?;

    if is_member.is_none() {
        return Err(RoomMessageError::NotAMember);
    }

    let epoch_row: Option<(i64, i64)> =
        sqlx::query_as("SELECT epoch, sequence FROM room_epochs WHERE room_id = ?")
            .bind(room_id)
            .fetch_optional(pool)
            .await?;

    match epoch_row {
        Some(row) => Ok(row),
        None => Err(RoomMessageError::RoomNotFound),
    }
}

pub async fn list_messages(
    pool: &SqlitePool,
    room_id: &str,
    user_id: &str,
    since_epoch: Option<i64>,
    limit: i64,
) -> Result<Vec<RoomMessageView>, RoomMessageError> {
    let is_member: Option<(i32,)> =
        sqlx::query_as("SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?")
            .bind(room_id)
            .bind(user_id)
            .fetch_optional(pool)
            .await?;

    if is_member.is_none() {
        return Err(RoomMessageError::NotAMember);
    }

    let rows = sqlx::query(
        r#"
        SELECT id, room_id, sender_user_id, sender_client_id, epoch, seq, content_type, created_at
        FROM room_messages
        WHERE room_id = ?
          AND (? IS NULL OR epoch >= ?)
        ORDER BY epoch ASC, seq ASC
        LIMIT ?
        "#,
    )
    .bind(room_id)
    .bind(since_epoch)
    .bind(since_epoch)
    .bind(limit)
    .fetch_all(pool)
    .await?;

    let messages = rows
        .into_iter()
        .map(|row| RoomMessageView {
            id: row.get("id"),
            room_id: row.get("room_id"),
            sender_user_id: row.get("sender_user_id"),
            sender_client_id: row.get("sender_client_id"),
            epoch: row.get("epoch"),
            seq: row.get("seq"),
            content_type: row.get("content_type"),
            created_at: row.get("created_at"),
        })
        .collect();

    Ok(messages)
}

pub async fn get_message_ciphertext(
    pool: &SqlitePool,
    room_id: &str,
    user_id: &str,
    message_id: &str,
) -> Result<Vec<u8>, RoomMessageError> {
    let is_member: Option<(i32,)> =
        sqlx::query_as("SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?")
            .bind(room_id)
            .bind(user_id)
            .fetch_optional(pool)
            .await?;

    if is_member.is_none() {
        return Err(RoomMessageError::NotAMember);
    }

    let row_opt: Option<(Vec<u8>,)> =
        sqlx::query_as("SELECT ciphertext FROM room_messages WHERE id = ? AND room_id = ?")
            .bind(message_id)
            .bind(room_id)
            .fetch_optional(pool)
            .await?;

    match row_opt {
        Some((ct,)) => Ok(ct),
        None => Err(RoomMessageError::MessageNotFound),
    }
}
