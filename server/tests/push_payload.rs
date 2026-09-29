use chrono::DateTime;
use server::push::payload::{build_message_payload, NotificationPayload};

#[test]
fn test_payload_fields() {
    let payload = build_message_payload("room-123", "user-456");

    assert_eq!(payload.notification_type, "message");
    assert_eq!(payload.room_id, "room-123");
    assert_eq!(payload.sender_user_id, "user-456");
    assert_eq!(payload.encrypted_payload, "");
    assert_eq!(payload.priority, "high");
    assert_eq!(payload.collapse_key, "room-123");
    assert!(!payload.notification_id.is_empty());
}

#[test]
fn test_notification_id_unique() {
    let payload1 = build_message_payload("room-123", "user-456");
    let payload2 = build_message_payload("room-123", "user-456");

    assert_ne!(payload1.notification_id, payload2.notification_id);
}

#[test]
fn test_timestamp_valid_iso8601() {
    let payload = build_message_payload("room-123", "user-456");
    let parsed = DateTime::parse_from_rfc3339(&payload.timestamp);
    assert!(parsed.is_ok(), "timestamp should be valid ISO 8601 RFC3339");
}

#[test]
fn test_payload_json_serialization() {
    let payload = build_message_payload("room-abc", "user-xyz");
    let json_str = serde_json::to_string(&payload).expect("should serialize");

    assert!(json_str.contains(r#""type":"message""#));
    assert!(json_str.contains(r#""room_id":"room-abc""#));
    assert!(json_str.contains(r#""sender_user_id":"user-xyz""#));
    assert!(json_str.contains(r#""encrypted_payload":""#));
    assert!(json_str.contains(r#""priority":"high""#));
    assert!(json_str.contains(r#""collapse_key":"room-abc""#));

    let deserialized: NotificationPayload =
        serde_json::from_str(&json_str).expect("should deserialize");
    assert_eq!(deserialized, payload);
}
