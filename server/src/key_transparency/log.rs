use crate::error::ApiError;
use sqlx::{SqliteConnection, SqlitePool};

/// Returns the current highest leaf index for the bot where `bot_id = ?`.
/// Returns `None` if the bot has no KT leaf entries.
pub async fn current_bot_leaf_index(
    pool: &SqlitePool,
    bot_id: &str,
) -> Result<Option<i64>, ApiError> {
    let leaf_index: Option<i64> =
        sqlx::query_scalar("SELECT MAX(leaf_index) FROM key_transparency_log WHERE bot_id = ?")
            .bind(bot_id)
            .fetch_one(pool)
            .await
            .map_err(|e| ApiError::Internal(e.into()))?;

    Ok(leaf_index)
}

/// Transaction variant of `current_bot_leaf_index` for use inside an existing transaction.
pub async fn current_bot_leaf_index_tx(
    conn: &mut SqliteConnection,
    bot_id: &str,
) -> Result<Option<i64>, ApiError> {
    let leaf_index: Option<i64> =
        sqlx::query_scalar("SELECT MAX(leaf_index) FROM key_transparency_log WHERE bot_id = ?")
            .bind(bot_id)
            .fetch_one(conn)
            .await
            .map_err(|e| ApiError::Internal(e.into()))?;

    Ok(leaf_index)
}

/// Appends a bot leaf to `key_transparency_log` within the caller's transaction `tx`.
/// Returns the allocated `leaf_index`.
pub async fn append_bot_leaf(
    tx: &mut SqliteConnection,
    bot_id: &str,
    bot_identity_pubkey: &str,
    command_pubkey: &str,
    identity_pubkey: &str,
) -> Result<i64, ApiError> {
    let leaf_index: i64 = sqlx::query_scalar(
        r#"
        INSERT INTO key_transparency_log (bot_id, bot_identity_pubkey, command_pubkey, identity_pubkey)
        VALUES (?, ?, ?, ?)
        RETURNING leaf_index
        "#,
    )
    .bind(bot_id)
    .bind(bot_identity_pubkey)
    .bind(command_pubkey)
    .bind(identity_pubkey)
    .fetch_one(tx)
    .await
    .map_err(|e| ApiError::Internal(e.into()))?;

    Ok(leaf_index)
}
