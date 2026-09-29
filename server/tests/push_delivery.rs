use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use chrono::{Duration, Utc};
use server::config::Config;
use server::push::delivery::DeliveryCoordinator;
use server::push::subscriptions::{register_subscription, RegisterRequest};
use server::push::vapid::VapidKeys;
use sqlx::sqlite::SqlitePoolOptions;
use sqlx::SqlitePool;
use std::sync::Arc;
use wiremock::matchers::{header_exists, method};
use wiremock::{Mock, MockServer, ResponseTemplate};

async fn setup_db() -> SqlitePool {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .unwrap();

    sqlx::migrate!("./migrations").run(&pool).await.unwrap();

    pool
}

async fn insert_user(pool: &SqlitePool, user_id: &str) {
    sqlx::query(
        "INSERT INTO users (id, username, username_hash, opaque_registration, identity_pubkey) VALUES (?, ?, ?, 'data', 'pubkey')",
    )
    .bind(user_id)
    .bind(user_id)
    .bind(format!("hash-{}", user_id))
    .execute(pool)
    .await
    .unwrap();
}

async fn insert_room(pool: &SqlitePool, room_id: &str, owner_id: &str) {
    sqlx::query("INSERT INTO rooms (id, owner_id) VALUES (?, ?)")
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

    insert_room_member(pool, room_id, owner_id, "owner").await;
}

async fn insert_room_member(pool: &SqlitePool, room_id: &str, user_id: &str, role: &str) {
    sqlx::query("INSERT INTO room_members (room_id, user_id, role) VALUES (?, ?, ?)")
        .bind(room_id)
        .bind(user_id)
        .bind(role)
        .execute(pool)
        .await
        .unwrap();
}

async fn insert_device(pool: &SqlitePool, device_id: &str, user_id: &str) {
    sqlx::query("INSERT INTO devices (id, user_id, client_id) VALUES (?, ?, ?)")
        .bind(device_id)
        .bind(user_id)
        .bind(format!("client-{}", device_id))
        .execute(pool)
        .await
        .unwrap();
}

async fn add_web_subscription(
    pool: &SqlitePool,
    user_id: &str,
    device_id: Option<&str>,
    browser_id: &str,
    endpoint: &str,
) -> String {
    use p256::elliptic_curve::sec1::ToEncodedPoint;
    use p256::SecretKey;
    use rand::rngs::OsRng;

    let secret = SecretKey::random(&mut OsRng);
    let pub_point = secret.public_key().to_encoded_point(false);
    let p256dh = URL_SAFE_NO_PAD.encode(pub_point.as_bytes());
    let auth = URL_SAFE_NO_PAD.encode([0x01u8; 16]);

    let sub = register_subscription(
        pool,
        RegisterRequest {
            user_id: user_id.to_string(),
            platform: "web".to_string(),
            device_id: device_id.map(|s| s.to_string()),
            endpoint: Some(endpoint.to_string()),
            p256dh: Some(p256dh),
            auth: Some(auth),
            push_token: None,
            browser_id: Some(browser_id.to_string()),
            user_agent: Some("test-agent".to_string()),
        },
    )
    .await
    .unwrap();

    sub.id
}

#[tokio::test]
async fn test_delivers_to_single_subscriber() {
    let pool = setup_db().await;
    let config = Config::test_default();
    let vapid_keys = VapidKeys::load_or_generate(&pool, &config)
        .await
        .unwrap()
        .unwrap();
    let coordinator =
        DeliveryCoordinator::new(pool.clone(), &config, Arc::new(vapid_keys)).unwrap();

    let mock_server = MockServer::start().await;
    Mock::given(method("POST"))
        .respond_with(ResponseTemplate::new(201))
        .expect(1)
        .mount(&mock_server)
        .await;

    insert_user(&pool, "user-a").await;
    insert_user(&pool, "user-b").await;
    insert_room(&pool, "room-1", "user-a").await;
    insert_room_member(&pool, "room-1", "user-b", "member").await;

    let endpoint = format!("{}/send/1", mock_server.uri());
    add_web_subscription(&pool, "user-b", None, "browser-b", &endpoint).await;

    coordinator
        .dispatch_message_notification("room-1", "user-a")
        .await;
}

#[tokio::test]
async fn test_sender_excluded_from_notification() {
    let pool = setup_db().await;
    let config = Config::test_default();
    let vapid_keys = VapidKeys::load_or_generate(&pool, &config)
        .await
        .unwrap()
        .unwrap();
    let coordinator =
        DeliveryCoordinator::new(pool.clone(), &config, Arc::new(vapid_keys)).unwrap();

    let mock_server = MockServer::start().await;
    Mock::given(method("POST"))
        .respond_with(ResponseTemplate::new(201))
        .expect(0) // Sender should receive 0 requests
        .mount(&mock_server)
        .await;

    insert_user(&pool, "user-a").await;
    insert_room(&pool, "room-1", "user-a").await;

    let endpoint = format!("{}/send/a", mock_server.uri());
    add_web_subscription(&pool, "user-a", None, "browser-a", &endpoint).await;

    coordinator
        .dispatch_message_notification("room-1", "user-a")
        .await;
}

#[tokio::test]
async fn test_delivers_to_all_members_except_sender() {
    let pool = setup_db().await;
    let config = Config::test_default();
    let vapid_keys = VapidKeys::load_or_generate(&pool, &config)
        .await
        .unwrap()
        .unwrap();
    let coordinator =
        DeliveryCoordinator::new(pool.clone(), &config, Arc::new(vapid_keys)).unwrap();

    let mock_server = MockServer::start().await;
    Mock::given(method("POST"))
        .respond_with(ResponseTemplate::new(201))
        .expect(2) // B and C
        .mount(&mock_server)
        .await;

    insert_user(&pool, "user-a").await;
    insert_user(&pool, "user-b").await;
    insert_user(&pool, "user-c").await;
    insert_room(&pool, "room-1", "user-a").await;
    insert_room_member(&pool, "room-1", "user-b", "member").await;
    insert_room_member(&pool, "room-1", "user-c", "member").await;

    let endpoint_a = format!("{}/send/a", mock_server.uri());
    let endpoint_b = format!("{}/send/b", mock_server.uri());
    let endpoint_c = format!("{}/send/c", mock_server.uri());

    add_web_subscription(&pool, "user-a", None, "browser-a", &endpoint_a).await;
    add_web_subscription(&pool, "user-b", None, "browser-b", &endpoint_b).await;
    add_web_subscription(&pool, "user-c", None, "browser-c", &endpoint_c).await;

    coordinator
        .dispatch_message_notification("room-1", "user-a")
        .await;
}

#[tokio::test]
async fn test_suppressed_devices_are_skipped() {
    let pool = setup_db().await;
    let config = Config::test_default();
    let vapid_keys = VapidKeys::load_or_generate(&pool, &config)
        .await
        .unwrap()
        .unwrap();
    let coordinator =
        DeliveryCoordinator::new(pool.clone(), &config, Arc::new(vapid_keys)).unwrap();

    let mock_server = MockServer::start().await;
    Mock::given(method("POST"))
        .respond_with(ResponseTemplate::new(201))
        .expect(1) // Only C, since B is suppressed
        .mount(&mock_server)
        .await;

    insert_user(&pool, "user-a").await;
    insert_user(&pool, "user-b").await;
    insert_user(&pool, "user-c").await;
    insert_room(&pool, "room-1", "user-a").await;
    insert_room_member(&pool, "room-1", "user-b", "member").await;
    insert_room_member(&pool, "room-1", "user-c", "member").await;

    insert_device(&pool, "dev-b", "user-b").await;
    insert_device(&pool, "dev-c", "user-c").await;

    // Recent session for B (active connection)
    sqlx::query(
        "INSERT INTO sessions (id, user_id, device_id, token_hash, expires_at, last_seen_at) VALUES ('s-b', 'user-b', 'dev-b', 'hash-b', ?, ?)",
    )
    .bind(Utc::now() + Duration::days(1))
    .bind(Utc::now())
    .execute(&pool)
    .await
    .unwrap();

    let endpoint_b = format!("{}/send/b", mock_server.uri());
    let endpoint_c = format!("{}/send/c", mock_server.uri());

    add_web_subscription(&pool, "user-b", Some("dev-b"), "browser-b", &endpoint_b).await;
    add_web_subscription(&pool, "user-c", Some("dev-c"), "browser-c", &endpoint_c).await;

    coordinator
        .dispatch_message_notification("room-1", "user-a")
        .await;
}

#[tokio::test]
async fn test_410_gone_deletes_subscription() {
    let pool = setup_db().await;
    let config = Config::test_default();
    let vapid_keys = VapidKeys::load_or_generate(&pool, &config)
        .await
        .unwrap()
        .unwrap();
    let coordinator =
        DeliveryCoordinator::new(pool.clone(), &config, Arc::new(vapid_keys)).unwrap();

    let mock_server = MockServer::start().await;
    Mock::given(method("POST"))
        .respond_with(ResponseTemplate::new(410))
        .expect(1)
        .mount(&mock_server)
        .await;

    insert_user(&pool, "user-a").await;
    insert_user(&pool, "user-b").await;
    insert_room(&pool, "room-1", "user-a").await;
    insert_room_member(&pool, "room-1", "user-b", "member").await;

    let endpoint = format!("{}/send/410", mock_server.uri());
    let sub_id = add_web_subscription(&pool, "user-b", None, "browser-b", &endpoint).await;

    coordinator
        .dispatch_message_notification("room-1", "user-a")
        .await;

    // Assert subscription row is gone
    let exists: Option<(String,)> =
        sqlx::query_as("SELECT id FROM push_subscriptions WHERE id = ?")
            .bind(&sub_id)
            .fetch_optional(&pool)
            .await
            .unwrap();

    assert!(exists.is_none(), "subscription should be deleted on 410");
}

#[tokio::test]
async fn test_transient_failure_retains_subscription() {
    let pool = setup_db().await;
    let config = Config::test_default();
    let vapid_keys = VapidKeys::load_or_generate(&pool, &config)
        .await
        .unwrap()
        .unwrap();
    let coordinator =
        DeliveryCoordinator::new(pool.clone(), &config, Arc::new(vapid_keys)).unwrap();

    let mock_server = MockServer::start().await;
    Mock::given(method("POST"))
        .respond_with(ResponseTemplate::new(500))
        .expect(1)
        .mount(&mock_server)
        .await;

    insert_user(&pool, "user-a").await;
    insert_user(&pool, "user-b").await;
    insert_room(&pool, "room-1", "user-a").await;
    insert_room_member(&pool, "room-1", "user-b", "member").await;

    let endpoint = format!("{}/send/500", mock_server.uri());
    let sub_id = add_web_subscription(&pool, "user-b", None, "browser-b", &endpoint).await;

    coordinator
        .dispatch_message_notification("room-1", "user-a")
        .await;

    // Assert subscription row still exists
    let exists: Option<(String,)> =
        sqlx::query_as("SELECT id FROM push_subscriptions WHERE id = ?")
            .bind(&sub_id)
            .fetch_optional(&pool)
            .await
            .unwrap();

    assert!(
        exists.is_some(),
        "subscription should be retained on transient failure"
    );
}

#[tokio::test]
async fn test_last_used_at_updated_on_success() {
    let pool = setup_db().await;
    let config = Config::test_default();
    let vapid_keys = VapidKeys::load_or_generate(&pool, &config)
        .await
        .unwrap()
        .unwrap();
    let coordinator =
        DeliveryCoordinator::new(pool.clone(), &config, Arc::new(vapid_keys)).unwrap();

    let mock_server = MockServer::start().await;
    Mock::given(method("POST"))
        .respond_with(ResponseTemplate::new(201))
        .expect(1)
        .mount(&mock_server)
        .await;

    insert_user(&pool, "user-a").await;
    insert_user(&pool, "user-b").await;
    insert_room(&pool, "room-1", "user-a").await;
    insert_room_member(&pool, "room-1", "user-b", "member").await;

    let endpoint = format!("{}/send/success", mock_server.uri());
    let sub_id = add_web_subscription(&pool, "user-b", None, "browser-b", &endpoint).await;

    coordinator
        .dispatch_message_notification("room-1", "user-a")
        .await;

    let last_used: Option<chrono::DateTime<Utc>> =
        sqlx::query_scalar("SELECT last_used_at FROM push_subscriptions WHERE id = ?")
            .bind(&sub_id)
            .fetch_one(&pool)
            .await
            .unwrap();

    assert!(last_used.is_some(), "last_used_at should be set on success");
}

#[tokio::test]
async fn test_vapid_headers_present() {
    let pool = setup_db().await;
    let config = Config::test_default();
    let vapid_keys = VapidKeys::load_or_generate(&pool, &config)
        .await
        .unwrap()
        .unwrap();
    let coordinator =
        DeliveryCoordinator::new(pool.clone(), &config, Arc::new(vapid_keys)).unwrap();

    let mock_server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(header_exists("authorization"))
        .and(header_exists("content-encoding"))
        .respond_with(ResponseTemplate::new(201))
        .expect(1)
        .mount(&mock_server)
        .await;

    insert_user(&pool, "user-a").await;
    insert_user(&pool, "user-b").await;
    insert_room(&pool, "room-1", "user-a").await;
    insert_room_member(&pool, "room-1", "user-b", "member").await;

    let endpoint = format!("{}/send/vapid", mock_server.uri());
    add_web_subscription(&pool, "user-b", None, "browser-b", &endpoint).await;

    coordinator
        .dispatch_message_notification("room-1", "user-a")
        .await;
}

#[tokio::test]
async fn test_timeout_handled_as_transient() {
    let pool = setup_db().await;
    let mut config = Config::test_default();
    config.push_delivery_timeout_secs = 1;

    let vapid_keys = VapidKeys::load_or_generate(&pool, &config)
        .await
        .unwrap()
        .unwrap();
    let coordinator =
        DeliveryCoordinator::new(pool.clone(), &config, Arc::new(vapid_keys)).unwrap();

    let mock_server = MockServer::start().await;
    Mock::given(method("POST"))
        .respond_with(ResponseTemplate::new(201).set_delay(std::time::Duration::from_secs(3)))
        .expect(1)
        .mount(&mock_server)
        .await;

    insert_user(&pool, "user-a").await;
    insert_user(&pool, "user-b").await;
    insert_room(&pool, "room-1", "user-a").await;
    insert_room_member(&pool, "room-1", "user-b", "member").await;

    let endpoint = format!("{}/send/timeout", mock_server.uri());
    let sub_id = add_web_subscription(&pool, "user-b", None, "browser-b", &endpoint).await;

    coordinator
        .dispatch_message_notification("room-1", "user-a")
        .await;

    let exists: Option<(String,)> =
        sqlx::query_as("SELECT id FROM push_subscriptions WHERE id = ?")
            .bind(&sub_id)
            .fetch_optional(&pool)
            .await
            .unwrap();

    assert!(
        exists.is_some(),
        "subscription should be retained on timeout"
    );
}

#[tokio::test]
async fn test_non_members_and_unsupported_platforms_skipped() {
    let pool = setup_db().await;
    let config = Config::test_default();
    let vapid_keys = VapidKeys::load_or_generate(&pool, &config)
        .await
        .unwrap()
        .unwrap();
    let coordinator =
        DeliveryCoordinator::new(pool.clone(), &config, Arc::new(vapid_keys)).unwrap();

    let mock_server = MockServer::start().await;
    Mock::given(method("POST"))
        .respond_with(ResponseTemplate::new(201))
        .expect(0)
        .mount(&mock_server)
        .await;

    insert_user(&pool, "user-a").await;
    insert_user(&pool, "user-b").await; // Member with iOS platform
    insert_user(&pool, "user-c").await; // Non-member with Web platform

    insert_room(&pool, "room-1", "user-a").await;
    insert_room_member(&pool, "room-1", "user-b", "member").await;

    // iOS subscription (no sender in phase 15b)
    register_subscription(
        &pool,
        RegisterRequest {
            user_id: "user-b".to_string(),
            platform: "ios".to_string(),
            device_id: None,
            endpoint: None,
            p256dh: None,
            auth: None,
            push_token: Some("token-ios".to_string()),
            browser_id: None,
            user_agent: None,
        },
    )
    .await
    .unwrap();

    // Web subscription for non-member C
    let endpoint_c = format!("{}/send/c", mock_server.uri());
    add_web_subscription(&pool, "user-c", None, "browser-c", &endpoint_c).await;

    coordinator
        .dispatch_message_notification("room-1", "user-a")
        .await;
}
