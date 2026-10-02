use chrono::Utc;
use serde::Serialize;
use ulid::Ulid;

#[derive(Debug, Clone, Serialize)]
pub struct NotificationPayload {
    #[serde(rename = "type")]
    pub notification_type: String, // "message"
    pub room_id: String,
    pub sender_ref: String,
    pub encrypted_payload: String, // empty in V1
    pub notification_id: String,   // ULID
    pub priority: String,          // "high" | "normal"
    pub collapse_key: String,      // room_id
    pub timestamp: String,         // ISO 8601 UTC
}

pub fn build_message_payload(room_id: &str, sender_ref: &str) -> NotificationPayload {
    NotificationPayload {
        notification_type: "message".to_string(),
        room_id: room_id.to_string(),
        sender_ref: sender_ref.to_string(),
        encrypted_payload: String::new(),
        notification_id: Ulid::new().to_string(),
        priority: "high".to_string(),
        collapse_key: room_id.to_string(),
        timestamp: Utc::now().to_rfc3339(),
    }
}
