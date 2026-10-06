use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{Row, SqlitePool};
use ulid::Ulid;

use crate::reactions::list::ReactionSummary;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct MessageCursor {
    pub epoch: i64,
    pub seq: i64,
}

pub struct ListMessagesQuery {
    pub room_id: String,
    pub requester_id: String,
    pub since: Option<MessageCursor>,
    pub limit: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct ListMessagesResult {
    pub messages: Vec<RoomMessageView>,
    pub next_cursor: Option<MessageCursor>,
    pub has_more: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct RoomMessageView {
    pub id: String,
    pub room_id: String,
    pub sender_user_id: String,
    pub sender_client_id: String,
    pub epoch: i64,
    pub seq: i64,
    pub content_type: String,
    pub reply_to: Option<String>,
    pub edit_of: Option<String>,
    pub edit_sequence: i64,
    pub edited_at: Option<DateTime<Utc>>,
    pub deleted_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub reactions: Vec<ReactionSummary>,
}

pub struct EditRequest {
    pub room_id: String,
    pub message_id: String,
    pub requester_user_id: String,
    pub requester_client_id: String,
    pub new_ciphertext: Vec<u8>,
    pub content_type: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct EditResult {
    pub edit_id: String,
    pub original_id: String,
    pub edit_sequence: i64,
    pub epoch: i64,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(untagged)]
pub enum SubmitOutcome {
    Application {
        message_id: String,
        epoch: i64,
        seq: i64,
        reply_to: Option<String>,
        created_at: DateTime<Utc>,
    },
    Commit {
        message_id: String,
        new_epoch: i64,
        #[serde(skip_serializing_if = "Option::is_none")]
        transcript_hash: Option<Vec<u8>>,
        created_at: DateTime<Utc>,
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
    pub reply_to: Option<String>,
}

#[derive(Debug)]
pub struct DeleteRequest {
    pub room_id: String,
    pub message_id: String,
    pub requester_id: String,
    pub moderation_mode: String,
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
    #[error("invalid reply target")]
    InvalidReplyTarget { reason: Option<String> },
    #[error("message not found")]
    MessageNotFound,
    #[error("message already deleted")]
    AlreadyDeleted,
    #[error("forbidden")]
    Forbidden,
    #[error("message deleted")]
    MessageDeleted,
    #[error("cannot edit deleted message")]
    EditDeleted,
    #[error("cannot edit an edit")]
    CannotEditEdit,
    #[error("content type mismatch")]
    ContentTypeMismatch,
    #[error("not sender")]
    NotSender,
    #[error("edit window expired")]
    WindowExpired,
    #[error("not editable")]
    NotEditable,
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

                let (created_at,): (DateTime<Utc>,) =
                    sqlx::query_as("SELECT created_at FROM room_messages WHERE id = ?")
                        .bind(&message_id)
                        .fetch_one(&mut *conn)
                        .await?;

                Ok(SubmitOutcome::Commit {
                    message_id,
                    new_epoch,
                    transcript_hash: Some(transcript_hash),
                    created_at,
                })
            }
            MessageContentType::Application | MessageContentType::Proposal => {
                if req.epoch != current_epoch {
                    return Err(RoomMessageError::EpochMismatch {
                        expected: current_epoch,
                        received: req.epoch,
                    });
                }

                // Validate reply_to if present
                if let Some(ref target_id) = req.reply_to {
                    let target_row: Option<(String, String, Option<DateTime<Utc>>)> =
                        sqlx::query_as("SELECT room_id, content_type, deleted_at FROM room_messages WHERE id = ?")
                            .bind(target_id)
                            .fetch_optional(&mut *conn)
                            .await?;

                    match target_row {
                        None => {
                            return Err(RoomMessageError::InvalidReplyTarget { reason: None });
                        }
                        Some((target_room_id, target_content_type, target_deleted_at)) => {
                            if target_room_id != req.room_id {
                                return Err(RoomMessageError::InvalidReplyTarget {
                                    reason: Some("not_in_room".to_string()),
                                });
                            }
                            if target_deleted_at.is_some() {
                                return Err(RoomMessageError::InvalidReplyTarget {
                                    reason: Some("deleted".to_string()),
                                });
                            }
                            if target_content_type != "application" {
                                return Err(RoomMessageError::InvalidReplyTarget {
                                    reason: Some("not_application".to_string()),
                                });
                            }
                        }
                    }
                }

                let next_sequence = current_sequence + 1;
                let message_id = Ulid::new().to_string();

                sqlx::query(
                    r#"
                    INSERT INTO room_messages (id, room_id, sender_user_id, sender_client_id, epoch, seq, content_type, ciphertext, reply_to)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                .bind(&req.reply_to)
                .execute(&mut *conn)
                .await?;

                sqlx::query("UPDATE room_epochs SET sequence = ? WHERE room_id = ?")
                    .bind(next_sequence)
                    .bind(&req.room_id)
                    .execute(&mut *conn)
                    .await?;

                let (created_at,): (DateTime<Utc>,) =
                    sqlx::query_as("SELECT created_at FROM room_messages WHERE id = ?")
                        .bind(&message_id)
                        .fetch_one(&mut *conn)
                        .await?;

                Ok(SubmitOutcome::Application {
                    message_id,
                    epoch: current_epoch,
                    seq: next_sequence,
                    reply_to: req.reply_to,
                    created_at,
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
    query: ListMessagesQuery,
) -> Result<ListMessagesResult, RoomMessageError> {
    let is_member: Option<(i32,)> =
        sqlx::query_as("SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?")
            .bind(&query.room_id)
            .bind(&query.requester_id)
            .fetch_optional(pool)
            .await?;

    if is_member.is_none() {
        return Err(RoomMessageError::NotAMember);
    }

    let limit = if query.limit <= 0 {
        50
    } else {
        query.limit.clamp(1, 500)
    };

    let fetch_limit = limit + 1;

    let (messages, has_more) = match query.since {
        Some(since) => {
            let rows = sqlx::query(
                r#"
                SELECT id, room_id, sender_user_id, sender_client_id, epoch, seq, content_type, reply_to, edit_of, edit_sequence, edited_at, deleted_at, created_at
                FROM room_messages
                WHERE room_id = ?
                  AND (epoch, seq) > (?, ?)
                ORDER BY epoch ASC, seq ASC
                LIMIT ?
                "#,
            )
            .bind(&query.room_id)
            .bind(since.epoch)
            .bind(since.seq)
            .bind(fetch_limit)
            .fetch_all(pool)
            .await?;

            let msg_ids: Vec<String> = rows.iter().map(|r| r.get("id")).collect();
            let reactions_map = crate::reactions::list::list_reactions_for_messages(
                pool,
                &query.room_id,
                &query.requester_id,
                &msg_ids,
            )
            .await
            .unwrap_or_default();

            let mut msgs: Vec<RoomMessageView> = rows
                .into_iter()
                .map(|row| {
                    let id: String = row.get("id");
                    let reactions = reactions_map.get(&id).cloned().unwrap_or_default();
                    RoomMessageView {
                        id,
                        room_id: row.get("room_id"),
                        sender_user_id: row.get("sender_user_id"),
                        sender_client_id: row.get("sender_client_id"),
                        epoch: row.get("epoch"),
                        seq: row.get("seq"),
                        content_type: row.get("content_type"),
                        reply_to: row.get("reply_to"),
                        edit_of: row.get("edit_of"),
                        edit_sequence: row.get("edit_sequence"),
                        edited_at: row.get("edited_at"),
                        deleted_at: row.get("deleted_at"),
                        created_at: row.get("created_at"),
                        reactions,
                    }
                })
                .collect();

            let has_more = msgs.len() as i64 > limit;
            if has_more {
                msgs.pop();
            }
            (msgs, has_more)
        }
        None => {
            let rows = sqlx::query(
                r#"
                SELECT id, room_id, sender_user_id, sender_client_id, epoch, seq, content_type, reply_to, edit_of, edit_sequence, edited_at, deleted_at, created_at
                FROM room_messages
                WHERE room_id = ?
                ORDER BY epoch DESC, seq DESC
                LIMIT ?
                "#,
            )
            .bind(&query.room_id)
            .bind(fetch_limit)
            .fetch_all(pool)
            .await?;

            let msg_ids: Vec<String> = rows.iter().map(|r| r.get("id")).collect();
            let reactions_map = crate::reactions::list::list_reactions_for_messages(
                pool,
                &query.room_id,
                &query.requester_id,
                &msg_ids,
            )
            .await
            .unwrap_or_default();

            let mut msgs: Vec<RoomMessageView> = rows
                .into_iter()
                .map(|row| {
                    let id: String = row.get("id");
                    let reactions = reactions_map.get(&id).cloned().unwrap_or_default();
                    RoomMessageView {
                        id,
                        room_id: row.get("room_id"),
                        sender_user_id: row.get("sender_user_id"),
                        sender_client_id: row.get("sender_client_id"),
                        epoch: row.get("epoch"),
                        seq: row.get("seq"),
                        content_type: row.get("content_type"),
                        reply_to: row.get("reply_to"),
                        edit_of: row.get("edit_of"),
                        edit_sequence: row.get("edit_sequence"),
                        edited_at: row.get("edited_at"),
                        deleted_at: row.get("deleted_at"),
                        created_at: row.get("created_at"),
                        reactions,
                    }
                })
                .collect();

            let has_more = msgs.len() as i64 > limit;
            if has_more {
                msgs.pop();
            }
            msgs.reverse();
            (msgs, has_more)
        }
    };

    let next_cursor = messages.last().map(|m| MessageCursor {
        epoch: m.epoch,
        seq: m.seq,
    });

    Ok(ListMessagesResult {
        messages,
        next_cursor,
        has_more,
    })
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

    let row_opt: Option<(Vec<u8>, Option<DateTime<Utc>>)> = sqlx::query_as(
        "SELECT ciphertext, deleted_at FROM room_messages WHERE id = ? AND room_id = ?",
    )
    .bind(message_id)
    .bind(room_id)
    .fetch_optional(pool)
    .await?;

    match row_opt {
        Some((_, Some(_))) => Err(RoomMessageError::MessageDeleted),
        Some((ct, None)) => Ok(ct),
        None => Err(RoomMessageError::MessageNotFound),
    }
}

pub async fn delete_message(pool: &SqlitePool, req: DeleteRequest) -> Result<(), RoomMessageError> {
    let mut conn = pool.acquire().await?;
    sqlx::query("BEGIN IMMEDIATE").execute(&mut *conn).await?;

    let result = async {
        // 1. Verify requester is member
        let member_role: Option<(String,)> =
            sqlx::query_as("SELECT role FROM room_members WHERE room_id = ? AND user_id = ?")
                .bind(&req.room_id)
                .bind(&req.requester_id)
                .fetch_optional(&mut *conn)
                .await?;

        let role = match member_role {
            Some((r,)) => r,
            None => return Err(RoomMessageError::NotAMember),
        };

        // 2. Fetch message
        let msg_row: Option<(String, Option<DateTime<Utc>>)> = sqlx::query_as(
            "SELECT sender_user_id, deleted_at FROM room_messages WHERE id = ? AND room_id = ?",
        )
        .bind(&req.message_id)
        .bind(&req.room_id)
        .fetch_optional(&mut *conn)
        .await?;

        let (sender_user_id, deleted_at) = match msg_row {
            Some(row) => row,
            None => return Err(RoomMessageError::MessageNotFound),
        };

        if deleted_at.is_some() {
            return Err(RoomMessageError::AlreadyDeleted);
        }

        // 3. Verify authorization
        let authorized = req.requester_id == sender_user_id
            || role == "owner"
            || (role == "moderator" && req.moderation_mode == "discord");

        if !authorized {
            return Err(RoomMessageError::Forbidden);
        }

        // 4. Tombstone message
        sqlx::query(
            "UPDATE room_messages SET deleted_at = CURRENT_TIMESTAMP WHERE id = ? AND room_id = ?",
        )
        .bind(&req.message_id)
        .bind(&req.room_id)
        .execute(&mut *conn)
        .await?;

        Ok(())
    }
    .await;

    match result {
        Ok(()) => {
            sqlx::query("COMMIT").execute(&mut *conn).await?;
            Ok(())
        }
        Err(err) => {
            let _ = sqlx::query("ROLLBACK").execute(&mut *conn).await;
            Err(err)
        }
    }
}

pub async fn edit_message(
    pool: &SqlitePool,
    req: EditRequest,
    edit_window_seconds: i64,
) -> Result<RoomMessageView, RoomMessageError> {
    let mut conn = pool.acquire().await?;
    sqlx::query("BEGIN IMMEDIATE").execute(&mut *conn).await?;

    let result = async {
        // 1. Verify requester is member
        let member_role: Option<(String,)> =
            sqlx::query_as("SELECT role FROM room_members WHERE room_id = ? AND user_id = ?")
                .bind(&req.room_id)
                .bind(&req.requester_user_id)
                .fetch_optional(&mut *conn)
                .await?;

        if member_role.is_none() {
            return Err(RoomMessageError::NotAMember);
        }

        // 2. Fetch original message
        #[derive(sqlx::FromRow)]
        struct OrigMsgRow {
            sender_user_id: String,
            content_type: String,
            created_at: DateTime<Utc>,
            deleted_at: Option<DateTime<Utc>>,
            epoch: i64,
            edit_of: Option<String>,
        }

        let orig_row: Option<OrigMsgRow> =
            sqlx::query_as(
                "SELECT sender_user_id, content_type, created_at, deleted_at, epoch, edit_of FROM room_messages WHERE id = ? AND room_id = ?"
            )
            .bind(&req.message_id)
            .bind(&req.room_id)
            .fetch_optional(&mut *conn)
            .await?;

        let OrigMsgRow { sender_user_id, content_type: orig_content_type, created_at, deleted_at, epoch: original_epoch, edit_of } = match orig_row {
            Some(row) => row,
            None => return Err(RoomMessageError::MessageNotFound),
        };

        // Flat chain check: Edits cannot chain off other edits
        if edit_of.is_some() {
            return Err(RoomMessageError::CannotEditEdit);
        }

        // Reject if deleted
        if deleted_at.is_some() {
            return Err(RoomMessageError::EditDeleted);
        }

        // Reject if content_type != "application" and != "bot"
        if orig_content_type != "application" && orig_content_type != "bot" {
            return Err(RoomMessageError::NotEditable);
        }

        // Validate request content_type if provided
        if let Some(ref req_ct) = req.content_type {
            if req_ct != &orig_content_type {
                return Err(RoomMessageError::ContentTypeMismatch);
            }
        }

        // Verify requester is sender
        if sender_user_id != req.requester_user_id {
            return Err(RoomMessageError::NotSender);
        }

        // Enforce edit window (created_at + window_seconds < now)
        let now = Utc::now();
        let elapsed = (now - created_at).num_seconds();
        if elapsed > edit_window_seconds {
            return Err(RoomMessageError::WindowExpired);
        }

        // Fetch MAX(edit_sequence) for this original
        let max_seq_row: Option<(Option<i64>,)> =
            sqlx::query_as("SELECT MAX(edit_sequence) FROM room_messages WHERE edit_of = ?")
                .bind(&req.message_id)
                .fetch_optional(&mut *conn)
                .await?;

        let next_edit_sequence = match max_seq_row {
            Some((Some(max_seq),)) => max_seq + 1,
            _ => 1,
        };

        let final_content_type = req.content_type.as_deref().unwrap_or(&orig_content_type);

        // Insert edit row (edited_at is set on the edit row itself per §7.6)
        let edit_id = Ulid::new().to_string();
        sqlx::query(
            r#"
            INSERT INTO room_messages (
                id, room_id, sender_user_id, sender_client_id,
                epoch, seq, content_type, ciphertext,
                edit_of, edit_sequence, edited_at, created_at
            ) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            "#,
        )
        .bind(&edit_id)
        .bind(&req.room_id)
        .bind(&req.requester_user_id)
        .bind(&req.requester_client_id)
        .bind(original_epoch)
        .bind(final_content_type)
        .bind(&req.new_ciphertext)
        .bind(&req.message_id)
        .bind(next_edit_sequence)
        .execute(&mut *conn)
        .await?;

        let (edit_created_at,): (DateTime<Utc>,) =
            sqlx::query_as("SELECT created_at FROM room_messages WHERE id = ?")
                .bind(&edit_id)
                .fetch_one(&mut *conn)
                .await?;

        Ok(RoomMessageView {
            id: edit_id,
            room_id: req.room_id,
            sender_user_id: req.requester_user_id,
            sender_client_id: req.requester_client_id,
            epoch: original_epoch,
            seq: 0,
            content_type: final_content_type.to_string(),
            reply_to: None,
            edit_of: Some(req.message_id),
            edit_sequence: next_edit_sequence,
            edited_at: Some(edit_created_at),
            deleted_at: None,
            created_at: edit_created_at,
            reactions: vec![],
        })
    }
    .await;

    match result {
        Ok(res) => {
            sqlx::query("COMMIT").execute(&mut *conn).await?;
            Ok(res)
        }
        Err(err) => {
            let _ = sqlx::query("ROLLBACK").execute(&mut *conn).await;
            Err(err)
        }
    }
}
