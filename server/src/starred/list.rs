use crate::starred::{StarredItemRow, StarredItemView};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

#[derive(Debug, thiserror::Error)]
pub enum ListStarError {
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("invalid item type")]
    InvalidItemType,
    #[error("invalid cursor")]
    InvalidCursor,
}

#[derive(Debug, Deserialize)]
pub struct ListStarQuery {
    pub r#type: Option<String>,
    pub room_id: Option<String>,
    pub limit: Option<u32>,
    pub cursor: Option<String>,
    pub include_deleted: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct StarredItemCursor {
    pub user_id: String,
    pub last_item_id: String,
    pub last_item_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_starred_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Serialize)]
pub struct ListStarredItemsResponse {
    pub items: Vec<StarredItemView>,
    pub next_cursor: Option<String>,
    pub has_more: bool,
}

pub fn encode_cursor(cursor: &StarredItemCursor) -> Result<String, ListStarError> {
    let json_bytes = serde_json::to_vec(cursor)
        .map_err(|e| ListStarError::Database(sqlx::Error::Protocol(e.to_string())))?;
    Ok(URL_SAFE_NO_PAD.encode(json_bytes))
}

pub fn decode_cursor(
    cursor_str: &str,
    expected_user_id: &str,
) -> Result<StarredItemCursor, ListStarError> {
    let bytes = URL_SAFE_NO_PAD
        .decode(cursor_str)
        .map_err(|_| ListStarError::InvalidCursor)?;
    let parsed: StarredItemCursor =
        serde_json::from_slice(&bytes).map_err(|_| ListStarError::InvalidCursor)?;

    if parsed.user_id != expected_user_id {
        return Err(ListStarError::InvalidCursor);
    }

    Ok(parsed)
}

pub async fn list_starred_items(
    pool: &SqlitePool,
    user_id: &str,
    query: ListStarQuery,
) -> Result<ListStarredItemsResponse, ListStarError> {
    if let Some(ref t) = query.r#type {
        if !crate::starred::write::validate_item_type(t) {
            return Err(ListStarError::InvalidItemType);
        }
    }

    let limit = query.limit.unwrap_or(100).min(500) as i64;
    let fetch_limit = limit + 1;
    let include_deleted = query.include_deleted.unwrap_or(false);

    let parsed_cursor = if let Some(ref c) = query.cursor {
        Some(decode_cursor(c, user_id)?)
    } else {
        None
    };

    let cursor_starred_at = if let Some(ref cursor) = parsed_cursor {
        match cursor.last_starred_at {
            Some(dt) => Some(dt),
            None => {
                let row: Option<(DateTime<Utc>,)> = sqlx::query_as(
                    "SELECT starred_at FROM starred_items WHERE user_id = ? AND item_id = ? AND item_type = ?",
                )
                .bind(user_id)
                .bind(&cursor.last_item_id)
                .bind(&cursor.last_item_type)
                .fetch_optional(pool)
                .await?;

                match row {
                    Some((dt,)) => Some(dt),
                    None => return Err(ListStarError::InvalidCursor),
                }
            }
        }
    } else {
        None
    };

    let mut builder = sqlx::QueryBuilder::new(
        r#"
        SELECT user_id, item_id, item_type, room_id, user_seq, starred_at, deleted_at
        FROM starred_items
        WHERE user_id =
        "#,
    );
    builder.push_bind(user_id);

    if !include_deleted {
        builder.push(" AND deleted_at IS NULL");
    }

    if let Some(ref t) = query.r#type {
        builder.push(" AND item_type = ");
        builder.push_bind(t);
    }

    if let Some(ref r) = query.room_id {
        builder.push(" AND room_id = ");
        builder.push_bind(r);
    }

    if let (Some(cursor), Some(starred_at)) = (parsed_cursor.as_ref(), cursor_starred_at) {
        builder.push(" AND (starred_at < ");
        builder.push_bind(starred_at);
        builder.push(" OR (starred_at = ");
        builder.push_bind(starred_at);
        builder.push(" AND (item_id > ");
        builder.push_bind(&cursor.last_item_id);
        builder.push(" OR (item_id = ");
        builder.push_bind(&cursor.last_item_id);
        builder.push(" AND item_type > ");
        builder.push_bind(&cursor.last_item_type);
        builder.push("))))");
    }

    builder.push(" ORDER BY starred_at DESC, item_id ASC, item_type ASC LIMIT ");
    builder.push_bind(fetch_limit);

    let rows: Vec<StarredItemRow> = builder.build_query_as().fetch_all(pool).await?;

    let has_more = rows.len() as i64 > limit;
    let items_slice = if has_more {
        &rows[..limit as usize]
    } else {
        &rows[..]
    };

    let views: Vec<StarredItemView> = items_slice.iter().cloned().map(Into::into).collect();

    let next_cursor = if has_more {
        if let Some(last_item) = views.last() {
            let cursor_payload = StarredItemCursor {
                user_id: user_id.to_string(),
                last_item_id: last_item.item_id.clone(),
                last_item_type: last_item.item_type.clone(),
                last_starred_at: Some(last_item.starred_at),
            };
            Some(encode_cursor(&cursor_payload)?)
        } else {
            None
        }
    } else {
        None
    };

    Ok(ListStarredItemsResponse {
        items: views,
        next_cursor,
        has_more,
    })
}
