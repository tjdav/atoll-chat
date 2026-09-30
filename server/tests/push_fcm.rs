use serde_json::json;
use server::config::Config;
use server::push::fcm::FcmSender;
use server::push::payload::build_message_payload;
use server::push::sender::{PushSender, SendError};
use server::push::subscriptions::PushSubscription;
use wiremock::matchers::{header, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

const RSA_PRIVATE_KEY: &str = "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQCyy6CREL6/k47T\n5/g9UE7UN184i7G7tT47otbeRjwZFKs+laPJ0C302tg848QxkrCJ9+B6RYGT+dKq\nJ3CVqh5ndIeHO/HEZPxIjyzE8It7SoahcKq+PP8x2wKvvFGK4adXeK0e/x6GN8tm\n2ySH76yzYdeaPZQPJ+uQBegZBhwEHNQHlYfygDwwZV0aiIfGhkupP2X32LVauyL1\nAeWNrYD4Bu6vMa0XBTCHRmd1jXfj3VPXL9RLmDZl8vNEemVu3TKS/qs9uKS2xECP\n6PpA8aLzP8BBk6T+2gmFr04seL3o1PWjwfcGRUGljIHsCaRWxsD8HPQJ4eKZ/FRM\nUNY3z59RAgMBAAECgf95SlSivw6nknJR+WDC4g1ClE2vDmqD7BqhBNa+nZF8x4i5\nQXTbHglkZxGfkjkwvVJa8M0CJXoXPbgBC2r/chMuG4nVM9UkZggUhmGDOFYRotJc\nsmch/D8ikxrqHIE0td/PzGL6TsIQ9ciw/fjKPs0+43ZfgWaaNs/r5BXk4+rIM6Po\ndTiVpVk6XFY/uUWmWJDY/NE7fBFbjuTAHdCx89gfqJpobS6JkmiqiZ/rAVYSWVAj\njV6OL+GXhnDsQMkhzA8fK/sQ+WzGdW70X6i85Sv5G8FCYwD+KGfKqgeqdq8WxM87\ncr7xOMrLF3VXqbGqm+fXRb90Y/mHWAOvGwm8dAECgYEA3ENodXTxcqsCs4uSQqK7\nk40G0ZNM+U4KuA2dhjgCZc7etKw2TaIByry0mFDh9RbNUavqmpnrPWENJ+9fRKiS\nyLmV/Q0Br70G1wlfkDFDvNmrwzkTMNaGRHkgjqbnY2JK5XoOhTdn9wqo9D6113T3\nIRlEgo2ZnL7NY586JPji1ZECgYEAz83bzp6s2+MsRWeQSAddUZ8XK2iF4xmGSA20\nHz5s5AQOGIA8WKGZV66kDV245PXRh5eRnsGP1H4oFGBd5EK6p2OiBM99uePM1AiK\neZ7U2YTGBFpZvU1usvFuFv05YBlH4P2W+lKY5GEUUZUSZTXg9jGxP8TMzJvRw24E\nbimQTcECgYEA1tUEYHOUP+Rd+SLroAS68Xo+qVCDZjHhMI1PFCcy53uzKgNB38xg\n9Q3DE0DocrUvwzXr16jCkZZET6wgfoXwzMh+a1cxSugScNBanff++oZQClRzzFGg\nmc6Om7RcwUmQhWvcF8DnrUN/cOJtV91kYKsVcESODBzplP4rpv39uJECgYEAnVqK\nqWjqCA97xIppbMF23omTZ+FcEN2RGxqVXFtO5VJUwiTIjWzAyu6Jdz2S9n1VzlDt\nicOUgBmPi+506pXE9V+yneXolEx1G9Hj2bh2AMhTkZRBA+GQg5vh+zKAsc4y6aHd\nI2xMLhN86VHyfgVQddynFVyWoBEVw+CZJjn+9YECgYEA0RAztKxklLT6Y2+hQGvc\nYT0/0qOFBl7Re7VsjfvVX/3dvquXdcu3zLDnd5shlthIHPkKVR6SNX6XN3sHl7dJ\nbGRFNO/y12jzddQcDpAqIIne0GwrZLZUvO61FDkNdKMuTz1qpqw+h3D4fkYtkHM6\nWDPTJJnpkNvnukVsNAaT2Kk=\n-----END PRIVATE KEY-----";

fn synthetic_service_account_json(token_uri: &str) -> String {
    json!({
        "type": "service_account",
        "project_id": "test-fcm-project",
        "private_key_id": "key123",
        "private_key": RSA_PRIVATE_KEY,
        "client_email": "test-fcm@test-fcm-project.iam.gserviceaccount.com",
        "client_id": "123456789",
        "auth_uri": "https://accounts.google.com/o/oauth2/auth",
        "token_uri": token_uri,
        "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs"
    })
    .to_string()
}

fn test_android_subscription(token: &str) -> PushSubscription {
    PushSubscription {
        id: "sub-fcm-1".to_string(),
        user_id: "user-android-1".to_string(),
        device_id: None,
        platform: "android".to_string(),
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
async fn test_fcm_sender_missing_config_returns_none() {
    let config = Config::test_default();
    let sender = FcmSender::new(&config).await.unwrap();
    assert!(sender.is_none());
}

#[tokio::test]
async fn test_fcm_sender_invalid_json_returns_error() {
    let mut config = Config::test_default();
    config.push_fcm_service_account_json = Some("{invalid json}".to_string());
    let res = FcmSender::new(&config).await;
    assert!(res.is_err());
}

#[tokio::test]
async fn test_fcm_sender_missing_project_id_returns_error() {
    let sa_json = json!({
        "type": "service_account",
        "private_key": RSA_PRIVATE_KEY,
        "client_email": "test@example.com"
    })
    .to_string();

    let mut config = Config::test_default();
    config.push_fcm_service_account_json = Some(sa_json);
    let res = FcmSender::new(&config).await;
    assert!(res.is_err());
}

#[tokio::test]
async fn test_fcm_send_success() {
    let mock_server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/oauth2/token"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "access_token": "mock-oauth-token",
            "token_type": "Bearer",
            "expires_in": 3600
        })))
        .mount(&mock_server)
        .await;

    Mock::given(method("POST"))
        .and(path("/v1/projects/test-fcm-project/messages:send"))
        .and(header("Authorization", "Bearer mock-oauth-token"))
        .and(header("Content-Type", "application/json"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "name": "projects/test-fcm-project/messages/12345"
        })))
        .expect(1)
        .mount(&mock_server)
        .await;

    let token_uri = format!("{}/oauth2/token", mock_server.uri());
    let sa_json = synthetic_service_account_json(&token_uri);

    let mut config = Config::test_default();
    config.push_fcm_service_account_json = Some(sa_json);

    let sender = FcmSender::new_with_base_url(&config, &mock_server.uri())
        .await
        .unwrap()
        .expect("should construct FCM sender");

    assert_eq!(sender.platform(), "android");

    let sub = test_android_subscription("fcm-device-token-12345");
    let payload = build_message_payload("room-fcm-1", "user-sender-1");

    let res = sender.send(&sub, &payload).await;
    assert!(res.is_ok());
}

#[tokio::test]
async fn test_fcm_unregistered_status_maps_to_gone() {
    let mock_server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/oauth2/token"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "access_token": "mock-oauth-token",
            "token_type": "Bearer",
            "expires_in": 3600
        })))
        .mount(&mock_server)
        .await;

    Mock::given(method("POST"))
        .and(path("/v1/projects/test-fcm-project/messages:send"))
        .respond_with(ResponseTemplate::new(404).set_body_json(json!({
            "error": {
                "code": 404,
                "message": "Requested entity was not found.",
                "status": "UNREGISTERED"
            }
        })))
        .expect(1)
        .mount(&mock_server)
        .await;

    let token_uri = format!("{}/oauth2/token", mock_server.uri());
    let sa_json = synthetic_service_account_json(&token_uri);

    let mut config = Config::test_default();
    config.push_fcm_service_account_json = Some(sa_json);

    let sender = FcmSender::new_with_base_url(&config, &mock_server.uri())
        .await
        .unwrap()
        .unwrap();

    let sub = test_android_subscription("fcm-device-token-expired");
    let payload = build_message_payload("room-fcm-1", "user-sender-1");

    let res = sender.send(&sub, &payload).await;
    match res {
        Err(SendError::Gone(msg)) => {
            assert!(msg.contains("404"));
        }
        _ => panic!("expected SendError::Gone, got {:?}", res),
    }
}
