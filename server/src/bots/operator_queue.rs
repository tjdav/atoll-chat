use serde_json::Value;
use sqlx::SqlitePool;

use crate::sockudo::Publisher;

/// Derives a short text preview from an opaque JSON payload per proposal §9.
/// Priority rules:
/// 1. If payload is a string, use it.
/// 2. If payload is an object with a `preview` string field, use it.
/// 3. If payload is an object with a `message` string field, use it.
/// 4. If payload is an object with a `question` string field, use it.
/// 5. Otherwise, return "[request]".
///
/// Truncates string results longer than 120 characters with an ellipsis ("...").
pub fn derive_payload_preview(payload: &Value) -> String {
    let raw = if let Some(s) = payload.as_str() {
        s
    } else if let Some(obj) = payload.as_object() {
        obj.get("preview")
            .and_then(|v| v.as_str())
            .or_else(|| obj.get("message").and_then(|v| v.as_str()))
            .or_else(|| obj.get("question").and_then(|v| v.as_str()))
            .unwrap_or("[request]")
    } else {
        "[request]"
    };

    if raw.chars().count() > 120 {
        let mut truncated: String = raw.chars().take(120).collect();
        truncated.push_str("...");
        truncated
    } else {
        raw.to_string()
    }
}

/// Enumerates all user IDs designated as operators for the given bot, ordered by bound_at ASC.
pub async fn enumerate_operators(
    pool: &SqlitePool,
    bot_id: &str,
) -> Result<Vec<String>, sqlx::Error> {
    sqlx::query_scalar("SELECT user_id FROM bot_operators WHERE bot_id = ? ORDER BY bound_at ASC")
        .bind(bot_id)
        .fetch_all(pool)
        .await
}

/// Non-durable, best-effort publication helper for user channel operator queue events (`operator.queue.updated`, `operator.response.acked`).
pub async fn publish_operator_queue_event(
    publisher: &Publisher,
    user_id: &str,
    event_name: &str,
    payload: Value,
) {
    let channel = format!("private-user-{user_id}");
    if let Err(e) = Publisher::publish(publisher, &channel, event_name, payload).await {
        tracing::warn!(event_name = %event_name, error = %e, "Failed to publish user channel operator queue event");
    }
}
