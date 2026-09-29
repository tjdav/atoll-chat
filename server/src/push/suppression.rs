use chrono::{DateTime, Duration, Utc};
use sqlx::SqlitePool;

use crate::push::vapid::PushError;

pub async fn should_suppress(
    pool: &SqlitePool,
    user_id: &str,
    device_id: Option<&str>,
    window_secs: u64,
) -> Result<bool, PushError> {
    let device_id = match device_id {
        Some(id) if !id.trim().is_empty() => id.trim(),
        _ => return Ok(false),
    };

    let max_last_seen: Option<DateTime<Utc>> = sqlx::query_scalar(
        "SELECT MAX(last_seen_at) FROM sessions WHERE user_id = ? AND device_id = ?",
    )
    .bind(user_id)
    .bind(device_id)
    .fetch_one(pool)
    .await?;

    let last_seen = match max_last_seen {
        Some(ts) => ts,
        None => return Ok(false),
    };

    let cutoff = Utc::now() - Duration::seconds(window_secs as i64);

    if last_seen > cutoff {
        Ok(true)
    } else {
        Ok(false)
    }
}
