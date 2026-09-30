use chrono::DateTime;
use server::push::payload::build_message_payload;

#[test]
fn test_payload_fields() {
    let payload = build_message_payload("room-123", "user-456");

    assert_eq!(payload.notification_type, "message");
    assert_eq!(payload.room_id, "room-123");
    assert_eq!(payload.sender_user_id, "user-456");
    assert_eq!(payload.encrypted_payload, "");
    assert_eq!(payload.priority, "high");
    assert_eq!(payload.collapse_key, "room-123");
}

#[test]
fn test_notification_id_uniqueness() {
    let p1 = build_message_payload("room-1", "user-1");
    let p2 = build_message_payload("room-1", "user-1");

    assert_ne!(p1.notification_id, p2.notification_id);
    assert!(!p1.notification_id.is_empty());
    assert!(!p2.notification_id.is_empty());
}

#[test]
fn test_timestamp_iso8601() {
    let payload = build_message_payload("room-1", "user-1");

    let parsed = DateTime::parse_from_rfc3339(&payload.timestamp);
    assert!(
        parsed.is_ok(),
        "timestamp should be valid ISO 8601 / RFC 3339"
    );
}

#[test]
fn test_payload_json_serialization() {
    let payload = build_message_payload("room-789", "user-789");

    let json_val = serde_json::to_value(&payload).expect("should serialize to JSON value");

    assert_eq!(json_val["type"], "message");
    assert_eq!(json_val["room_id"], "room-789");
    assert_eq!(json_val["sender_user_id"], "user-789");
    assert_eq!(json_val["encrypted_payload"], "");
    assert_eq!(json_val["priority"], "high");
    assert_eq!(json_val["collapse_key"], "room-789");
    assert_eq!(json_val["notification_id"], payload.notification_id);
    assert_eq!(json_val["timestamp"], payload.timestamp);
}
