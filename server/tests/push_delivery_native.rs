use serde_json::json;
use server::config::Config;
use server::push::delivery::DeliveryCoordinator;
use server::push::subscriptions::{register_subscription, RegisterRequest};
use server::push::vapid::VapidKeys;
use sqlx::SqlitePool;
use std::sync::Arc;
use wiremock::matchers::{header, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

mod common;

const RSA_PRIVATE_KEY: &str = "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQCyy6CREL6/k47T\n5/g9UE7UN184i7G7tT47otbeRjwZFKs+laPJ0C302tg848QxkrCJ9+B6RYGT+dKq\nJ3CVqh5ndIeHO/HEZPxIjyzE8It7SoahcKq+PP8x2wKvvFGK4adXeK0e/x6GN8tm\n2ySH76yzYdeaPZQPJ+uQBegZBhwEHNQHlYfygDwwZV0aiIfGhkupP2X32LVauyL1\nAeWNrYD4Bu6vMa0XBTCHRmd1jXfj3VPXL9RLmDZl8vNEemVu3TKS/qs9uKS2xECP\n6PpA8aLzP8BBk6T+2gmFr04seL3o1PWjwfcGRUGljIHsCaRWxsD8HPQJ4eKZ/FRM\nUNY3z59RAgMBAAECgf95SlSivw6nknJR+WDC4g1ClE2vDmqD7BqhBNa+nZF8x4i5\nQXTbHglkZxGfkjkwvVJa8M0CJXoXPbgBC2r/chMuG4nVM9UkZggUhmGDOFYRotJc\nsmch/D8ikxrqHIE0td/PzGL6TsIQ9ciw/fjKPs0+43ZfgWaaNs/r5BXk4+rIM6Po\ndTiVpVk6XFY/uUWmWJDY/NE7fBFbjuTAHdCx89gfqJpobS6JkmiqiZ/rAVYSWVAj\njV6OL+GXhnDsQMkhzA8fK/sQ+WzGdW70X6i85Sv5G8FCYwD+KGfKqgeqdq8WxM87\ncr7xOMrLF3VXqbGqm+fXRb90Y/mHWAOvGwm8dAECgYEA3ENodXTxcqsCs4uSQqK7\nk40G0ZNM+U4KuA2dhjgCZc7etKw2TaIByry0mFDh9RbNUavqmpnrPWENJ+9fRKiS\nyLmV/Q0Br70G1wlfkDFDvNmrwzkTMNaGRHkgjqbnY2JK5XoOhTdn9wqo9D6113T3\nIRlEgo2ZnL7NY586JPji1ZECgYEAz83bzp6s2+MsRWeQSAddUZ8XK2iF4xmGSA20\nHz5s5AQOGIA8WKGZV66kDV245PXRh5eRnsGP1H4oFGBd5EK6p2OiBM99uePM1AiK\neZ7U2YTGBFpZvU1usvFuFv05YBlH4P2W+lKY5GEUUZUSZTXg9jGxP8TMzJvRw24E\nbimQTcECgYEA1tUEYHOUP+Rd+SLroAS68Xo+qVCDZjHhMI1PFCcy53uzKgNB38xg\n9Q3DE0DocrUvwzXr16jCkZZET6wgfoXwzMh+a1cxSugScNBanff++oZQClRzzFGg\nmc6Om7RcwUmQhWvcF8DnrUN/cOJtV91kYKsVcESODBzplP4rpv39uJECgYEAnVqK\nqWjqCA97xIppbMF23omTZ+FcEN2RGxqVXFtO5VJUwiTIjWzAyu6Jdz2S9n1VzlDt\nicOUgBmPi+506pXE9V+yneXolEx1G9Hj2bh2AMhTkZRBA+GQg5vh+zKAsc4y6aHd\nI2xMLhN86VHyfgVQddynFVyWoBEVw+CZJjn+9YECgYEA0RAztKxklLT6Y2+hQGvc\nYT0/0qOFBl7Re7VsjfvVX/3dvquXdcu3zLDnd5shlthIHPkKVR6SNX6XN3sHl7dJ\nbGRFNO/y12jzddQcDpAqIIne0GwrZLZUvO61FDkNdKMuTz1qpqw+h3D4fkYtkHM6\nWDPTJJnpkNvnukVsNAaT2Kk=\n-----END PRIVATE KEY-----";

fn synthetic_fcm_sa(token_uri: &str) -> String {
    json!({
        "type": "service_account",
        "project_id": "native-push-project",
        "private_key": RSA_PRIVATE_KEY,
        "client_email": "test@native-push-project.iam.gserviceaccount.com",
        "token_uri": token_uri
    })
    .to_string()
}

async fn setup_user(pool: &SqlitePool, user_id: &str, username: &str) {
    let hash = format!("hash_{}", username);
    sqlx::query(
        "INSERT INTO users (id, username, username_hash, opaque_registration, identity_pubkey) VALUES (?, ?, ?, X'00', '')",
    )
    .bind(user_id)
    .bind(username)
    .bind(hash)
    .execute(pool)
    .await
    .unwrap();
}

async fn setup_room(pool: &SqlitePool, room_id: &str, owner_id: &str) {
    sqlx::query("INSERT INTO rooms (id, owner_id) VALUES (?, ?)")
        .bind(room_id)
        .bind(owner_id)
        .execute(pool)
        .await
        .unwrap();

    sqlx::query("INSERT INTO room_members (room_id, user_id, role) VALUES (?, ?, 'owner')")
        .bind(room_id)
        .bind(owner_id)
        .execute(pool)
        .await
        .unwrap();

    sqlx::query("INSERT INTO room_epochs (room_id, epoch, sequence) VALUES (?, 0, 0)")
        .bind(room_id)
        .execute(pool)
        .await
        .unwrap();
}

async fn add_member(pool: &SqlitePool, room_id: &str, user_id: &str) {
    sqlx::query("INSERT INTO room_members (room_id, user_id, role) VALUES (?, ?, 'member')")
        .bind(room_id)
        .bind(user_id)
        .execute(pool)
        .await
        .unwrap();
}

#[tokio::test]
async fn test_android_subscription_dispatches_to_fcm() {
    let pool = common::setup_test_db().await;
    let mock_server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/oauth2/token"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "access_token": "native-oauth-token",
            "token_type": "Bearer",
            "expires_in": 3600
        })))
        .mount(&mock_server)
        .await;

    Mock::given(method("POST"))
        .and(path("/v1/projects/native-push-project/messages:send"))
        .and(header("Authorization", "Bearer native-oauth-token"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"name": "msg1"})))
        .expect(1)
        .mount(&mock_server)
        .await;

    let token_uri = format!("{}/oauth2/token", mock_server.uri());
    let sa_json = synthetic_fcm_sa(&token_uri);

    let mut config = Config::test_default();
    config.push_enabled = true;
    config.push_delivery_enabled = true;
    config.push_fcm_service_account_json = Some(sa_json);
    config.push_gateway_url = Some(mock_server.uri());

    let vapid_keys = VapidKeys::load_or_generate(&pool, &config)
        .await
        .unwrap()
        .map(Arc::new)
        .unwrap();

    let coordinator = DeliveryCoordinator::new(pool.clone(), &config, vapid_keys)
        .await
        .unwrap();

    setup_user(&pool, "user-a", "alice").await;
    setup_user(&pool, "user-b", "bob").await;
    setup_room(&pool, "room-native", "user-a").await;
    add_member(&pool, "room-native", "user-b").await;

    register_subscription(
        &pool,
        RegisterRequest {
            user_id: "user-b".to_string(),
            platform: "android".to_string(),
            device_id: None,
            endpoint: None,
            p256dh: None,
            auth: None,
            push_token: Some("android-device-push-token-123".to_string()),
            browser_id: None,
            user_agent: None,
        },
    )
    .await
    .unwrap();

    coordinator
        .dispatch_message_notification("room-native", "user-a")
        .await;
}

#[tokio::test]
async fn test_fcm_unregistered_deletes_subscription() {
    let pool = common::setup_test_db().await;
    let mock_server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/oauth2/token"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "access_token": "token1",
            "token_type": "Bearer",
            "expires_in": 3600
        })))
        .mount(&mock_server)
        .await;

    Mock::given(method("POST"))
        .and(path("/v1/projects/native-push-project/messages:send"))
        .respond_with(ResponseTemplate::new(404).set_body_json(json!({
            "error": { "code": 404, "status": "UNREGISTERED" }
        })))
        .expect(1)
        .mount(&mock_server)
        .await;

    let sa_json = synthetic_fcm_sa(&format!("{}/oauth2/token", mock_server.uri()));

    let mut config = Config::test_default();
    config.push_enabled = true;
    config.push_delivery_enabled = true;
    config.push_fcm_service_account_json = Some(sa_json);
    config.push_gateway_url = Some(mock_server.uri());

    let vapid_keys = VapidKeys::load_or_generate(&pool, &config)
        .await
        .unwrap()
        .map(Arc::new)
        .unwrap();

    let coordinator = DeliveryCoordinator::new(pool.clone(), &config, vapid_keys)
        .await
        .unwrap();

    setup_user(&pool, "user-a", "alice").await;
    setup_user(&pool, "user-b", "bob").await;
    setup_room(&pool, "room-native", "user-a").await;
    add_member(&pool, "room-native", "user-b").await;

    let sub = register_subscription(
        &pool,
        RegisterRequest {
            user_id: "user-b".to_string(),
            platform: "android".to_string(),
            device_id: None,
            endpoint: None,
            p256dh: None,
            auth: None,
            push_token: Some("android-device-push-token-expired".to_string()),
            browser_id: None,
            user_agent: None,
        },
    )
    .await
    .unwrap();

    coordinator
        .dispatch_message_notification("room-native", "user-a")
        .await;

    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM push_subscriptions WHERE id = ?")
        .bind(&sub.id)
        .fetch_one(&pool)
        .await
        .unwrap();

    assert_eq!(count, 0);
}
