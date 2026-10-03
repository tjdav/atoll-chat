use crate::starred::StarredItemRow;
use sqlx::SqlitePool;

pub async fn list_starred_items_since(
    pool: &SqlitePool,
    user_id: &str,
    since_seq: i64,
) -> Result<Vec<StarredItemRow>, sqlx::Error> {
    sqlx::query_as(
        r#"
        SELECT user_id, item_id, item_type, room_id, user_seq, starred_at, deleted_at
        FROM starred_items
        WHERE user_id = ? AND user_seq > ?
        ORDER BY user_seq ASC
        "#,
    )
    .bind(user_id)
    .bind(since_seq)
    .fetch_all(pool)
    .await
}

pub async fn list_starred_items_all(
    pool: &SqlitePool,
    user_id: &str,
) -> Result<Vec<StarredItemRow>, sqlx::Error> {
    sqlx::query_as(
        r#"
        SELECT user_id, item_id, item_type, room_id, user_seq, starred_at, deleted_at
        FROM starred_items
        WHERE user_id = ?
        ORDER BY user_seq ASC
        "#,
    )
    .bind(user_id)
    .fetch_all(pool)
    .await
}
