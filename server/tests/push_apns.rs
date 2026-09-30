use a2::{Client, ClientConfig, Endpoint};
use server::config::Config;
use server::push::apns::ApnsSender;
use server::push::payload::build_message_payload;
use server::push::sender::{PushSender, SendError};
use server::push::subscriptions::PushSubscription;

const TEST_P8_KEY: &str = "-----BEGIN PRIVATE KEY-----\nMIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgXR57/JflgJijReVZ\ndLAm+kJBUxsQ0kc3yFzXDAunFcmhRANCAATVFNWbkrmxCTJ4aPOGlW7LCsIsH8l2\nesuwIXThIaAqXbVocsjaI1+BbMEUg1kpF6mnzJom3pzc8eY89evXpsM/\n-----END PRIVATE KEY-----";

fn test_subscription(token: &str) -> PushSubscription {
    PushSubscription {
        id: "sub-ios-1".to_string(),
        user_id: "user-1".to_string(),
        device_id: None,
        platform: "ios".to_string(),
        browser_id: None,
        endpoint: None,
        p256dh: None,
        auth: None,
        push_token: Some(token.to_string()),
        user_agent: None,
        created_at: chrono::Utc::now(),
        last_used_at: None,
        revoked_at: None,
    }
}

#[tokio::test]
async fn test_apns_sender_incomplete_config_returns_none() {
    let mut config = Config::test_default();
    config.push_apns_key = Some(TEST_P8_KEY.to_string());
    let sender = ApnsSender::new(&config).unwrap();
    assert!(sender.is_none());
}

#[tokio::test]
async fn test_apns_sender_constructs_with_full_config() {
    let mut config = Config::test_default();
    config.push_apns_key = Some(TEST_P8_KEY.to_string());
    config.push_apns_key_id = Some("KEY123".to_string());
    config.push_apns_team_id = Some("TEAM456".to_string());
    config.push_apns_bundle_id = Some("com.example.app".to_string());
    config.push_apns_use_sandbox = true;

    let sender = ApnsSender::new(&config)
        .unwrap()
        .expect("should construct APNs sender");
    assert!(sender.use_sandbox());
    assert_eq!(sender.platform(), "ios");
}

#[tokio::test]
async fn test_apns_malformed_token_returns_permanent_error() {
    let mut config = Config::test_default();
    config.push_apns_key = Some(TEST_P8_KEY.to_string());
    config.push_apns_key_id = Some("KEY123".to_string());
    config.push_apns_team_id = Some("TEAM456".to_string());
    config.push_apns_bundle_id = Some("com.example.app".to_string());

    let sender = ApnsSender::new(&config).unwrap().unwrap();
    let payload = build_message_payload("room-1", "user-sender");

    let sub = test_subscription("12345");
    let res = sender.send(&sub, &payload).await;

    match res {
        Err(SendError::Permanent(msg)) => {
            assert!(msg.contains("invalid APNs device token"));
        }
        _ => panic!(
            "expected SendError::Permanent for malformed token, got {:?}",
            res
        ),
    }
}

#[tokio::test]
async fn test_apns_valid_token_structure() {
    let client_config = ClientConfig::new(Endpoint::Sandbox);

    let client = Client::token(
        std::io::Cursor::new(TEST_P8_KEY.as_bytes()),
        "KEY123",
        "TEAM456",
        client_config,
    )
    .unwrap();

    let sender = ApnsSender::new_with_custom_client(client, "com.example.app".to_string(), true);
    let payload = build_message_payload("room-100", "user-200");

    let valid_hex_token = "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
    let sub = test_subscription(valid_hex_token);

    let res = sender.send(&sub, &payload).await;
    assert!(res.is_err());
}
