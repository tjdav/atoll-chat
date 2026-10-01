use crate::sync::SyncError;

/// Allocates the next user_seq value for a user.
///
/// Must be called inside a transaction. The caller uses the returned
/// value in the same transaction that writes the sync state row.
///
/// Behavior:
/// - If the user has no row in `user_seq`, inserts one with `next_seq = 2`
///   and returns 1.
/// - Otherwise, reads `next_seq`, updates it to `next_seq + 1`, and returns
///   the previous value.
///
/// This is a compare-and-swap on the user's counter. Concurrent calls for
/// the same user are serialized by SQLite's write lock. Concurrent calls for
/// different users proceed independently.
pub async fn allocate_user_seq(
    tx: &mut sqlx::SqliteConnection,
    user_id: &str,
) -> Result<i64, SyncError> {
    let next: i64 = sqlx::query_scalar(
        "INSERT INTO user_seq (user_id, next_seq) VALUES (?, 2)
         ON CONFLICT(user_id) DO UPDATE SET next_seq = next_seq + 1
         RETURNING next_seq - 1",
    )
    .bind(user_id)
    .fetch_one(&mut *tx)
    .await?;

    Ok(next)
}
