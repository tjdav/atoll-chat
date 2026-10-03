use crate::sockudo::Publisher;
use crate::starred::StarredItemRow;
use crate::sync::envelope::{publish_user_event, UserEventEnvelope};
use crate::sync::seq::allocate_user_seq;
use chrono::Utc;
use serde::Deserialize;
use serde_json::json;
use sqlx::SqlitePool;

#[derive(Debug, thiserror::Error)]
pub enum StarError {
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("invalid item type")]
    InvalidItemType,
    #[error("room not found")]
    RoomNotFound,
    #[error("starred item not found")]
    StarredItemNotFound,
    #[error("starred items limit reached")]
    LimitReached,
}

#[derive(Debug, Deserialize)]
pub struct StarRequest {
    pub item_id: String,
    pub item_type: String,
    pub room_id: String,
}

pub fn validate_item_type(item_type: &str) -> bool {
    matches!(item_type, "attachment" | "message" | "link")
}

pub async fn star_item(
    pool: &SqlitePool,
    publisher: &Publisher,
    user_id: &str,
    req: StarRequest,
    max_starred_limit: u32,
) -> Result<(StarredItemRow, bool), StarError> {
    if !validate_item_type(&req.item_type) {
        return Err(StarError::InvalidItemType);
    }

    // Check caller room membership
    let is_member: Option<(i64,)> =
        sqlx::query_as("SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?")
            .bind(&req.room_id)
            .bind(user_id)
            .fetch_optional(pool)
            .await?;

    if is_member.is_none() {
        tracing::warn!(user_id = %user_id, room_id = %req.room_id, "is_member check failed in star_item");
        return Err(StarError::RoomNotFound);
    }

    let existing: Option<StarredItemRow> = sqlx::query_as(
        r#"
        SELECT user_id, item_id, item_type, room_id, user_seq, starred_at, deleted_at
        FROM starred_items
        WHERE user_id = ? AND item_id = ? AND item_type = ?
        "#,
    )
    .bind(user_id)
    .bind(&req.item_id)
    .bind(&req.item_type)
    .fetch_optional(pool)
    .await?;

    if let Some(row) = existing {
        if row.deleted_at.is_none() {
            // Already active star -> Idempotent 200 OK
            return Ok((row, false));
        }

        // Re-star path: clear tombstone, bump user_seq, update starred_at = now
        let mut tx = pool.begin().await?;
        let new_user_seq = allocate_user_seq(&mut tx, user_id)
            .await
            .map_err(|e| match e {
                crate::sync::SyncError::Database(d) => StarError::Database(d),
                _ => StarError::Database(sqlx::Error::Protocol(e.to_string())),
            })?;

        let now = Utc::now();
        let updated: StarredItemRow = sqlx::query_as(
            r#"
            UPDATE starred_items
            SET deleted_at = NULL, user_seq = ?, starred_at = ?
            WHERE user_id = ? AND item_id = ? AND item_type = ?
            RETURNING user_id, item_id, item_type, room_id, user_seq, starred_at, deleted_at
            "#,
        )
        .bind(new_user_seq)
        .bind(now)
        .bind(user_id)
        .bind(&req.item_id)
        .bind(&req.item_type)
        .fetch_one(&mut *tx)
        .await?;

        tx.commit().await?;

        // Publish starred_item.added post-commit
        let payload = json!({
            "item_id": updated.item_id,
            "item_type": updated.item_type,
            "room_id": updated.room_id,
            "user_seq": updated.user_seq
        });
        let envelope = UserEventEnvelope::new("starred_item.added", updated.user_seq, payload);
        let _ = publish_user_event(publisher, user_id, &envelope).await;

        return Ok((updated, true));
    }

    // Fresh star path
    let mut tx = pool.begin().await?;

    let active_count: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM starred_items WHERE user_id = ? AND deleted_at IS NULL",
    )
    .bind(user_id)
    .fetch_one(&mut *tx)
    .await?;

    if active_count.0 >= max_starred_limit as i64 {
        return Err(StarError::LimitReached);
    }

    let user_seq = allocate_user_seq(&mut tx, user_id)
        .await
        .map_err(|e| match e {
            crate::sync::SyncError::Database(d) => StarError::Database(d),
            _ => StarError::Database(sqlx::Error::Protocol(e.to_string())),
        })?;

    let now = Utc::now();
    let row: StarredItemRow = sqlx::query_as(
        r#"
        INSERT INTO starred_items (user_id, item_id, item_type, room_id, user_seq, starred_at, deleted_at)
        VALUES (?, ?, ?, ?, ?, ?, NULL)
        RETURNING user_id, item_id, item_type, room_id, user_seq, starred_at, deleted_at
        "#,
    )
    .bind(user_id)
    .bind(&req.item_id)
    .bind(&req.item_type)
    .bind(&req.room_id)
    .bind(user_seq)
    .bind(now)
    .fetch_one(&mut *tx)
    .await?;

    tx.commit().await?;

    // Publish starred_item.added post-commit
    let payload = json!({
        "item_id": row.item_id,
        "item_type": row.item_type,
        "room_id": row.room_id,
        "user_seq": row.user_seq
    });
    let envelope = UserEventEnvelope::new("starred_item.added", row.user_seq, payload);
    let _ = publish_user_event(publisher, user_id, &envelope).await;

    Ok((row, true))
}

pub async fn unstar_item(
    pool: &SqlitePool,
    publisher: &Publisher,
    user_id: &str,
    item_id: &str,
    item_type: &str,
) -> Result<(), StarError> {
    if !validate_item_type(item_type) {
        return Err(StarError::InvalidItemType);
    }

    let existing: Option<StarredItemRow> = sqlx::query_as(
        r#"
        SELECT user_id, item_id, item_type, room_id, user_seq, starred_at, deleted_at
        FROM starred_items
        WHERE user_id = ? AND item_id = ? AND item_type = ?
        "#,
    )
    .bind(user_id)
    .bind(item_id)
    .bind(item_type)
    .fetch_optional(pool)
    .await?;

    let row = match existing {
        Some(r) if r.deleted_at.is_none() => r,
        _ => return Err(StarError::StarredItemNotFound),
    };

    let mut tx = pool.begin().await?;

    let user_seq = allocate_user_seq(&mut tx, user_id)
        .await
        .map_err(|e| match e {
            crate::sync::SyncError::Database(d) => StarError::Database(d),
            _ => StarError::Database(sqlx::Error::Protocol(e.to_string())),
        })?;

    let now = Utc::now();
    sqlx::query(
        r#"
        UPDATE starred_items
        SET deleted_at = ?, user_seq = ?
        WHERE user_id = ? AND item_id = ? AND item_type = ?
        "#,
    )
    .bind(now)
    .bind(user_seq)
    .bind(user_id)
    .bind(item_id)
    .bind(item_type)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;

    // Publish starred_item.removed post-commit (note: NO room_id per §8.8)
    let payload = json!({
        "item_id": row.item_id,
        "item_type": row.item_type,
        "user_seq": user_seq
    });
    let envelope = UserEventEnvelope::new("starred_item.removed", user_seq, payload);
    let _ = publish_user_event(publisher, user_id, &envelope).await;

    Ok(())
}
