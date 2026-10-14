//! Bot channel event delivery, sequence allocation, and event logging (§8.9).

use serde_json::Value;
use sqlx::SqliteConnection;

/// Allocates the next `bot_seq` value for a bot account.
///
/// Must be called inside a transaction. The caller uses the returned
/// value in the same transaction that writes the `bot_event_log` row.
///
/// Behavior:
/// - If the bot has no row in `bot_seq`, inserts one with `next_seq = 2`
///   and returns 1.
/// - Otherwise, reads `next_seq`, updates it to `next_seq + 1`, and returns
///   the previous value.
pub async fn allocate_bot_seq(tx: &mut SqliteConnection, bot_id: &str) -> Result<i64, sqlx::Error> {
    let next: i64 = sqlx::query_scalar(
        "INSERT INTO bot_seq (bot_id, next_seq) VALUES (?, 2)
         ON CONFLICT(bot_id) DO UPDATE SET next_seq = next_seq + 1
         RETURNING next_seq - 1",
    )
    .bind(bot_id)
    .fetch_one(&mut *tx)
    .await?;

    Ok(next)
}

/// Appends a durable event to the `bot_event_log` table.
///
/// Must be called inside a transaction alongside the state change.
pub async fn append_bot_event_log(
    tx: &mut SqliteConnection,
    bot_id: &str,
    bot_seq: i64,
    event_type: &str,
    payload: &Value,
) -> Result<(), sqlx::Error> {
    let compact_payload = serde_json::to_string(payload)
        .map_err(|e| sqlx::Error::Protocol(format!("failed to serialize payload: {}", e)))?;

    sqlx::query(
        "INSERT INTO bot_event_log (bot_id, bot_seq, event_type, payload) VALUES (?, ?, ?, ?)",
    )
    .bind(bot_id)
    .bind(bot_seq)
    .bind(event_type)
    .bind(&compact_payload)
    .execute(&mut *tx)
    .await?;

    Ok(())
}

/// Prepares a durable bot event inside a transaction.
///
/// Allocates a `bot_seq`, attaches `bot_seq` to `payload`, appends the row to
/// `bot_event_log`, and returns `(bot_seq, payload)` so the caller can publish
/// the payload to Sockudo after transaction commit.
pub async fn prepare_durable_bot_event(
    tx: &mut SqliteConnection,
    bot_id: &str,
    event_type: &str,
    mut payload: Value,
) -> Result<(i64, Value), sqlx::Error> {
    let seq = allocate_bot_seq(tx, bot_id).await?;

    if let Value::Object(ref mut map) = payload {
        map.insert("bot_seq".to_string(), Value::Number(seq.into()));
    }

    append_bot_event_log(tx, bot_id, seq, event_type, &payload).await?;

    Ok((seq, payload))
}
