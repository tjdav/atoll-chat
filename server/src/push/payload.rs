use chrono::Utc;
use serde::{Deserialize, Serialize};
use ulid::Ulid;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct NotificationPayload {
    #[serde(rename = "type")]
    pub notification_type: String,
    pub room_id: String,
    pub sender_user_id: String,
    pub encrypted_payload: String,
    pub notification_id: String,
    pub priority: String,
    pub collapse_key: String,
    pub timestamp: String,
}

pub fn build_message_payload(room_id: &str, sender_user_id: &str) -> NotificationPayload {
    NotificationPayload {
        notification_type: "message".to_string(),
        room_id: room_id.to_string(),
        sender_user_id: sender_user_id.to_string(),
        encrypted_payload: String::new(),
        notification_id: Ulid::new().to_string(),
        priority: "high".to_string(),
        collapse_key: room_id.to_string(),
        timestamp: Utc::now().to_rfc3339(),
    }
}
