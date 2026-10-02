use std::collections::HashMap;

use serde::Serialize;
use sqlx::{Row, SqlitePool};

use super::ReactionError;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ReactionSummary {
    pub reaction: String,
    pub count: i64,
    pub reacted_by_me: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ReactionForMessage {
    pub message_id: String,
    pub reactions: Vec<ReactionSummary>,
}

pub async fn list_reactions(
    pool: &SqlitePool,
    room_id: &str,
    message_id: &str,
    requester_user_id: &str,
) -> Result<Vec<ReactionSummary>, ReactionError> {
    // 1. Verify membership
    let is_member: Option<(i32,)> =
        sqlx::query_as("SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?")
            .bind(room_id)
            .bind(requester_user_id)
            .fetch_optional(pool)
            .await?;

    if is_member.is_none() {
        return Err(ReactionError::NotAMember);
    }

    // 2. Verify non-deleted message existence in room
    let msg_exists: Option<(i32,)> = sqlx::query_as(
        "SELECT 1 FROM room_messages WHERE id = ? AND room_id = ? AND deleted_at IS NULL",
    )
    .bind(message_id)
    .bind(room_id)
    .fetch_optional(pool)
    .await?;

    if msg_exists.is_none() {
        return Err(ReactionError::MessageNotFound);
    }

    // 3. Aggregate reactions
    let rows = sqlx::query(
        r#"
        SELECT reaction, COUNT(*) as count,
               SUM(CASE WHEN sender_user_id = ? THEN 1 ELSE 0 END) as reacted_by_me
        FROM reactions
        WHERE message_id = ? AND deleted_at IS NULL
        GROUP BY reaction
        ORDER BY count DESC, reaction ASC
        "#,
    )
    .bind(requester_user_id)
    .bind(message_id)
    .fetch_all(pool)
    .await?;

    let mut summaries = Vec::with_capacity(rows.len());
    for row in rows {
        let reaction: String = row.get("reaction");
        let count: i64 = row.get("count");
        let reacted_by_me_raw: i64 = row.get("reacted_by_me");
        summaries.push(ReactionSummary {
            reaction,
            count,
            reacted_by_me: reacted_by_me_raw > 0,
        });
    }

    Ok(summaries)
}

pub async fn list_reactions_for_messages(
    pool: &SqlitePool,
    room_id: &str,
    requester_user_id: &str,
    message_ids: &[String],
) -> Result<HashMap<String, Vec<ReactionSummary>>, ReactionError> {
    if message_ids.is_empty() {
        return Ok(HashMap::new());
    }

    // Verify membership
    let is_member: Option<(i32,)> =
        sqlx::query_as("SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?")
            .bind(room_id)
            .bind(requester_user_id)
            .fetch_optional(pool)
            .await?;

    if is_member.is_none() {
        return Err(ReactionError::NotAMember);
    }

    let mut map: HashMap<String, Vec<ReactionSummary>> = HashMap::new();

    // Chunk message_ids in batches of 500
    for chunk in message_ids.chunks(500) {
        let mut query = String::from(
            r#"
            SELECT message_id, reaction, COUNT(*) as count,
                   SUM(CASE WHEN sender_user_id = ? THEN 1 ELSE 0 END) as reacted_by_me
            FROM reactions
            WHERE deleted_at IS NULL AND message_id IN (
            "#,
        );

        for (i, _) in chunk.iter().enumerate() {
            if i > 0 {
                query.push_str(", ");
            }
            query.push('?');
        }
        query.push_str(
            ") GROUP BY message_id, reaction ORDER BY message_id ASC, count DESC, reaction ASC",
        );

        let mut q = sqlx::query(&query).bind(requester_user_id);
        for id in chunk {
            q = q.bind(id);
        }

        let rows = q.fetch_all(pool).await?;
        for row in rows {
            let msg_id: String = row.get("message_id");
            let reaction: String = row.get("reaction");
            let count: i64 = row.get("count");
            let reacted_by_me_raw: i64 = row.get("reacted_by_me");

            map.entry(msg_id).or_default().push(ReactionSummary {
                reaction,
                count,
                reacted_by_me: reacted_by_me_raw > 0,
            });
        }
    }

    Ok(map)
}
