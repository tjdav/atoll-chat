use chrono::{DateTime, Utc};
use sqlx::SqlitePool;
use ulid::Ulid;

use super::{ReactionError, MAX_REACTION_BYTES, MAX_REACTION_LENGTH};

pub struct AddRequest {
    pub room_id: String,
    pub message_id: String,
    pub user_id: String,
    pub client_id: String,
    pub reaction: String,
}

pub struct AddResult {
    pub id: String,
    pub message_id: String,
    pub reaction: String,
    pub user_id: String,
    pub client_id: String,
    pub created_at: DateTime<Utc>,
    pub reactions_per_message_effective: i64,
    pub is_new: bool,
}

pub struct RemoveRequest {
    pub room_id: String,
    pub message_id: String,
    pub reaction_id: String,
    pub requester_user_id: String,
}

pub struct RemoveResult {
    pub reaction_id: String,
    pub sender_user_id: String,
    pub reaction: String,
}

fn validate_reaction_string(r: &str) -> Result<(), ReactionError> {
    if r.is_empty() {
        return Err(ReactionError::InvalidReaction(
            "reaction string cannot be empty".to_string(),
        ));
    }

    if r.chars().count() > MAX_REACTION_LENGTH {
        return Err(ReactionError::InvalidReaction(format!(
            "reaction exceeds maximum char limit of {MAX_REACTION_LENGTH}"
        )));
    }

    if r.len() > MAX_REACTION_BYTES {
        return Err(ReactionError::InvalidReaction(format!(
            "reaction exceeds maximum byte limit of {MAX_REACTION_BYTES}"
        )));
    }

    for c in r.chars() {
        if ('\u{0000}'..='\u{001F}').contains(&c) || ('\u{007F}'..='\u{009F}').contains(&c) {
            return Err(ReactionError::InvalidReaction(
                "reaction contains control characters".to_string(),
            ));
        }
    }

    Ok(())
}

pub async fn add_reaction(
    pool: &SqlitePool,
    req: AddRequest,
    per_message_limit: i64,
) -> Result<AddResult, ReactionError> {
    validate_reaction_string(&req.reaction)?;

    let mut conn = pool.acquire().await?;
    sqlx::query("BEGIN IMMEDIATE").execute(&mut *conn).await?;

    let result = async {
        // 1. Verify membership
        let member_role: Option<(String,)> =
            sqlx::query_as("SELECT role FROM room_members WHERE room_id = ? AND user_id = ?")
                .bind(&req.room_id)
                .bind(&req.user_id)
                .fetch_optional(&mut *conn)
                .await?;

        if member_role.is_none() {
            return Err(ReactionError::NotAMember);
        }

        // 2. Verify message existence in room (including tombstoned messages per §7.6)
        let msg_exists: Option<(String,)> = sqlx::query_as(
            "SELECT id FROM room_messages WHERE id = ? AND room_id = ?",
        )
        .bind(&req.message_id)
        .bind(&req.room_id)
        .fetch_optional(&mut *conn)
        .await?;

        if msg_exists.is_none() {
            return Err(ReactionError::MessageNotFound);
        }

        // 3. Count non-deleted reactions on message
        let (active_count,): (i64,) = sqlx::query_as(
            "SELECT COUNT(*) FROM reactions WHERE message_id = ? AND deleted_at IS NULL",
        )
        .bind(&req.message_id)
        .fetch_one(&mut *conn)
        .await?;

        if active_count >= per_message_limit {
            return Err(ReactionError::LimitReached);
        }

        // 4. Check for active or soft-deleted row matching UNIQUE (message_id, sender_user_id, sender_client_id, reaction)
        let existing_row: Option<(String, Option<DateTime<Utc>>)> = sqlx::query_as(
            "SELECT id, deleted_at FROM reactions WHERE message_id = ? AND sender_user_id = ? AND sender_client_id = ? AND reaction = ?"
        )
        .bind(&req.message_id)
        .bind(&req.user_id)
        .bind(&req.client_id)
        .bind(&req.reaction)
        .fetch_optional(&mut *conn)
        .await?;

        let (reaction_id, created_at, is_new) = match existing_row {
            Some((id, None)) => {
                // Active reaction already exists -> return existing row (idempotent repeat)
                let (created_at,): (DateTime<Utc>,) =
                    sqlx::query_as("SELECT created_at FROM reactions WHERE id = ?")
                        .bind(&id)
                        .fetch_one(&mut *conn)
                        .await?;

                (id, created_at, false)
            }
            Some((id, Some(_))) => {
                // Reactivate soft-deleted reaction -> clear deleted_at, keep stable id
                sqlx::query(
                    "UPDATE reactions SET deleted_at = NULL, created_at = CURRENT_TIMESTAMP WHERE id = ?"
                )
                .bind(&id)
                .execute(&mut *conn)
                .await?;

                let (now,): (DateTime<Utc>,) =
                    sqlx::query_as("SELECT created_at FROM reactions WHERE id = ?")
                        .bind(&id)
                        .fetch_one(&mut *conn)
                        .await?;

                (id, now, true)
            }
            None => {
                // Insert new row
                let id = Ulid::new().to_string();
                sqlx::query(
                    r#"
                    INSERT INTO reactions (id, room_id, message_id, sender_user_id, sender_client_id, reaction)
                    VALUES (?, ?, ?, ?, ?, ?)
                    "#,
                )
                .bind(&id)
                .bind(&req.room_id)
                .bind(&req.message_id)
                .bind(&req.user_id)
                .bind(&req.client_id)
                .bind(&req.reaction)
                .execute(&mut *conn)
                .await?;

                let (created_at,): (DateTime<Utc>,) =
                    sqlx::query_as("SELECT created_at FROM reactions WHERE id = ?")
                        .bind(&id)
                        .fetch_one(&mut *conn)
                        .await?;

                (id, created_at, true)
            }
        };

        Ok(AddResult {
            id: reaction_id,
            message_id: req.message_id,
            reaction: req.reaction,
            user_id: req.user_id,
            client_id: req.client_id,
            created_at,
            reactions_per_message_effective: per_message_limit,
            is_new,
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

pub async fn remove_reaction(
    pool: &SqlitePool,
    req: RemoveRequest,
) -> Result<RemoveResult, ReactionError> {
    let mut conn = pool.acquire().await?;
    sqlx::query("BEGIN IMMEDIATE").execute(&mut *conn).await?;

    let result = async {
        // 1. Verify membership
        let member_role: Option<(String,)> =
            sqlx::query_as("SELECT role FROM room_members WHERE room_id = ? AND user_id = ?")
                .bind(&req.room_id)
                .bind(&req.requester_user_id)
                .fetch_optional(&mut *conn)
                .await?;

        let requester_role = match member_role {
            Some((role,)) => role,
            None => return Err(ReactionError::NotAMember),
        };

        // 2. Find active reaction row by reaction_id, room_id, message_id
        let active_row: Option<(String, String, String)> = sqlx::query_as(
            r#"
            SELECT id, sender_user_id, reaction
            FROM reactions
            WHERE id = ? AND room_id = ? AND message_id = ? AND deleted_at IS NULL
            "#,
        )
        .bind(&req.reaction_id)
        .bind(&req.room_id)
        .bind(&req.message_id)
        .fetch_optional(&mut *conn)
        .await?;

        let (id, sender_user_id, reaction) = match active_row {
            Some(row) => row,
            None => return Err(ReactionError::NotFound),
        };

        // 3. Authorization check: sender or room owner/moderator
        let is_sender = sender_user_id == req.requester_user_id;
        let is_owner_or_mod = requester_role == "owner" || requester_role == "moderator";
        if !is_sender && !is_owner_or_mod {
            return Err(ReactionError::Forbidden);
        }

        // 4. Soft delete
        sqlx::query("UPDATE reactions SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?")
            .bind(&id)
            .execute(&mut *conn)
            .await?;

        Ok(RemoveResult {
            reaction_id: id,
            sender_user_id,
            reaction,
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
