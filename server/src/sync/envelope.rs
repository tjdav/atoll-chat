use crate::sockudo::Publisher;
use crate::sync::SyncError;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserEventEnvelope {
    /// Event type, e.g. "read.sync", "room_order.sync", "starred_item.added".
    pub event_type: String,

    /// The user_seq value assigned to the state row that changed.
    pub user_seq: i64,

    /// The row data. Shape varies per event type.
    pub payload: serde_json::Value,

    /// Timestamp of the change (server clock).
    pub emitted_at: DateTime<Utc>,
}

impl UserEventEnvelope {
    pub fn new(event_type: impl Into<String>, user_seq: i64, payload: serde_json::Value) -> Self {
        Self {
            event_type: event_type.into(),
            user_seq,
            payload,
            emitted_at: Utc::now(),
        }
    }
}

pub async fn publish_user_event(
    publisher: &Publisher,
    user_id: &str,
    envelope: &UserEventEnvelope,
) -> Result<(), SyncError> {
    let channel = format!("private-user-{}", user_id);
    let payload =
        serde_json::to_value(envelope).map_err(|e| SyncError::Serialization(e.to_string()))?;

    if let Err(e) = publisher
        .publish(&channel, &envelope.event_type, payload)
        .await
    {
        tracing::warn!(error = %e, channel = %channel, "sockudo user event publish failed");
    }

    Ok(())
}
