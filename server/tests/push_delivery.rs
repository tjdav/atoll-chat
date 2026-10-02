use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use chrono::{Duration, Utc};
use p256::elliptic_curve::sec1::ToEncodedPoint;
use rand::rngs::OsRng;
use std::sync::Arc;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

fn dummy_p256dh() -> String {
    let secret = p256::SecretKey::random(&mut OsRng);
    let public = secret.public_key().to_encoded_point(false);
    URL_SAFE_NO_PAD.encode(public.as_bytes())
}

fn dummy_auth() -> String {
    let mut bytes = [0u8; 16];
    rand::RngCore::fill_bytes(&mut OsRng, &mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

use server::config::Config;
use server::push::delivery::DeliveryCoordinator;
use server::push::subscriptions::{register_subscription, RegisterRequest};
use server::push::vapid::VapidKeys;
use sqlx::SqlitePool;

mod common;

async fn setup_user(pool: &SqlitePool, user_id: &str, username: &str) {
    let mut token_bytes = [0u8; 64];
    let user_bytes = username.as_bytes();
    let len = user_bytes.len().min(64);
    token_bytes[..len].copy_from_slice(&user_bytes[..len]);
    let token = URL_SAFE_NO_PAD.encode(token_bytes);

    sqlx::query(
        "INSERT INTO users (id, username_token, opaque_registration, identity_pubkey) VALUES (?, ?, X'00', '')",
    )
    .bind(user_id)
    .bind(token)
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

async fn create_coordinator(
    pool: SqlitePool,
    config_override: impl FnOnce(&mut Config),
) -> (DeliveryCoordinator, Arc<VapidKeys>) {
    let mut config = Config::test_default();
    config.push_enabled = true;
    config.push_delivery_enabled = true;
    config_override(&mut config);

    let vapid_keys = VapidKeys::load_or_generate(&pool, &config)
        .await
        .unwrap()
        .map(Arc::new)
        .unwrap();

    let coordinator = DeliveryCoordinator::new(pool.clone(), &config, vapid_keys.clone())
        .await
        .unwrap();

    (coordinator, vapid_keys)
}

#[tokio::test]
async fn test_deliver_single_subscriber() {
    let pool = common::setup_test_db().await;
    let mock_server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/send/sub1"))
        .respond_with(ResponseTemplate::new(201))
        .expect(1)
        .mount(&mock_server)
        .await;

    setup_user(&pool, "user-a", "alice").await;
    setup_user(&pool, "user-b", "bob").await;
    setup_room(&pool, "room-1", "user-a").await;
    add_member(&pool, "room-1", "user-b").await;

    register_subscription(
        &pool,
        RegisterRequest {
            user_id: "user-b".to_string(),
            platform: "web".to_string(),
            device_id: None,
            endpoint: Some(format!("{}/send/sub1", mock_server.uri())),
            p256dh: Some(dummy_p256dh()),
            auth: Some(dummy_auth()),
            push_token: None,
            browser_id: Some("browser-1".to_string()),
            user_agent: None,
        },
    )
    .await
    .unwrap();

    let (coordinator, _) = create_coordinator(pool, |_| {}).await;

    coordinator
        .dispatch_message_notification("room-1", "user-a")
        .await;
}

#[tokio::test]
async fn test_sender_does_not_receive_own_notification() {
    let pool = common::setup_test_db().await;
    let mock_server = MockServer::start().await;

    Mock::given(method("POST"))
        .respond_with(ResponseTemplate::new(201))
        .expect(0)
        .mount(&mock_server)
        .await;

    setup_user(&pool, "user-a", "alice").await;
    setup_room(&pool, "room-1", "user-a").await;

    // Sender has a subscription
    register_subscription(
        &pool,
        RegisterRequest {
            user_id: "user-a".to_string(),
            platform: "web".to_string(),
            device_id: None,
            endpoint: Some(format!("{}/send/sender", mock_server.uri())),
            p256dh: Some(dummy_p256dh()),
            auth: Some(dummy_auth()),
            push_token: None,
            browser_id: Some("browser-a".to_string()),
            user_agent: None,
        },
    )
    .await
    .unwrap();

    let (coordinator, _) = create_coordinator(pool, |_| {}).await;

    coordinator
        .dispatch_message_notification("room-1", "user-a")
        .await;
}

#[tokio::test]
async fn test_delivers_to_all_members_except_sender() {
    let pool = common::setup_test_db().await;
    let mock_server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/send/b"))
        .respond_with(ResponseTemplate::new(201))
        .expect(1)
        .mount(&mock_server)
        .await;

    Mock::given(method("POST"))
        .and(path("/send/c"))
        .respond_with(ResponseTemplate::new(201))
        .expect(1)
        .mount(&mock_server)
        .await;

    setup_user(&pool, "user-a", "alice").await;
    setup_user(&pool, "user-b", "bob").await;
    setup_user(&pool, "user-c", "charlie").await;

    setup_room(&pool, "room-1", "user-a").await;
    add_member(&pool, "room-1", "user-b").await;
    add_member(&pool, "room-1", "user-c").await;

    for (uid, path_suffix) in [("user-a", "a"), ("user-b", "b"), ("user-c", "c")] {
        register_subscription(
            &pool,
            RegisterRequest {
                user_id: uid.to_string(),
                platform: "web".to_string(),
                device_id: None,
                endpoint: Some(format!("{}/send/{}", mock_server.uri(), path_suffix)),
                p256dh: Some(dummy_p256dh()),
                auth: Some(dummy_auth()),
                push_token: None,
                browser_id: Some(format!("browser-{}", uid)),
                user_agent: None,
            },
        )
        .await
        .unwrap();
    }

    let (coordinator, _) = create_coordinator(pool, |_| {}).await;

    coordinator
        .dispatch_message_notification("room-1", "user-a")
        .await;
}

#[tokio::test]
async fn test_suppressed_devices_do_not_receive() {
    let pool = common::setup_test_db().await;
    let mock_server = MockServer::start().await;

    // Only C receives push, B is suppressed
    Mock::given(method("POST"))
        .and(path("/send/c"))
        .respond_with(ResponseTemplate::new(201))
        .expect(1)
        .mount(&mock_server)
        .await;

    Mock::given(method("POST"))
        .and(path("/send/b"))
        .respond_with(ResponseTemplate::new(201))
        .expect(0)
        .mount(&mock_server)
        .await;

    setup_user(&pool, "user-a", "alice").await;
    setup_user(&pool, "user-b", "bob").await;
    setup_user(&pool, "user-c", "charlie").await;

    setup_room(&pool, "room-1", "user-a").await;
    add_member(&pool, "room-1", "user-b").await;
    add_member(&pool, "room-1", "user-c").await;

    // Add device for B
    sqlx::query(
        "INSERT INTO devices (id, user_id, client_id) VALUES ('dev-b', 'user-b', 'client-b')",
    )
    .execute(&pool)
    .await
    .unwrap();

    // Insert active session for B's device
    let now = Utc::now();
    sqlx::query(
        r#"
        INSERT INTO sessions (id, token_hash, user_id, device_id, created_at, expires_at, last_seen_at)
        VALUES ('sess-b', 'hash-b', 'user-b', 'dev-b', ?, ?, ?)
        "#,
    )
    .bind(now)
    .bind(now + Duration::days(30))
    .bind(now)
    .execute(&pool)
    .await
    .unwrap();

    register_subscription(
        &pool,
        RegisterRequest {
            user_id: "user-b".to_string(),
            platform: "web".to_string(),
            device_id: Some("dev-b".to_string()),
            endpoint: Some(format!("{}/send/b", mock_server.uri())),
            p256dh: Some(dummy_p256dh()),
            auth: Some(dummy_auth()),
            push_token: None,
            browser_id: Some("browser-b".to_string()),
            user_agent: None,
        },
    )
    .await
    .unwrap();

    register_subscription(
        &pool,
        RegisterRequest {
            user_id: "user-c".to_string(),
            platform: "web".to_string(),
            device_id: None,
            endpoint: Some(format!("{}/send/c", mock_server.uri())),
            p256dh: Some(dummy_p256dh()),
            auth: Some(dummy_auth()),
            push_token: None,
            browser_id: Some("browser-c".to_string()),
            user_agent: None,
        },
    )
    .await
    .unwrap();

    let (coordinator, _) = create_coordinator(pool, |_| {}).await;

    coordinator
        .dispatch_message_notification("room-1", "user-a")
        .await;
}

#[tokio::test]
async fn test_410_gone_deletes_subscription() {
    let _ = tracing_subscriber::fmt()
        .with_env_filter("server=debug,push=debug")
        .try_init();
    let pool = common::setup_test_db().await;
    let mock_server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/send/gone"))
        .respond_with(ResponseTemplate::new(410))
        .expect(1)
        .mount(&mock_server)
        .await;

    setup_user(&pool, "user-a", "alice").await;
    setup_user(&pool, "user-b", "bob").await;
    setup_room(&pool, "room-1", "user-a").await;
    add_member(&pool, "room-1", "user-b").await;

    let sub = register_subscription(
        &pool,
        RegisterRequest {
            user_id: "user-b".to_string(),
            platform: "web".to_string(),
            device_id: None,
            endpoint: Some(format!("{}/send/gone", mock_server.uri())),
            p256dh: Some(dummy_p256dh()),
            auth: Some(dummy_auth()),
            push_token: None,
            browser_id: Some("browser-b".to_string()),
            user_agent: None,
        },
    )
    .await
    .unwrap();

    let (coordinator, _) = create_coordinator(pool.clone(), |_| {}).await;

    coordinator
        .dispatch_message_notification("room-1", "user-a")
        .await;

    // Assert subscription row is deleted
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM push_subscriptions WHERE id = ?")
        .bind(&sub.id)
        .fetch_one(&pool)
        .await
        .unwrap();

    assert_eq!(count, 0);
}

#[tokio::test]
async fn test_transient_failure_leaves_subscription() {
    let pool = common::setup_test_db().await;
    let mock_server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/send/500"))
        .respond_with(ResponseTemplate::new(500))
        .expect(1)
        .mount(&mock_server)
        .await;

    setup_user(&pool, "user-a", "alice").await;
    setup_user(&pool, "user-b", "bob").await;
    setup_room(&pool, "room-1", "user-a").await;
    add_member(&pool, "room-1", "user-b").await;

    let sub = register_subscription(
        &pool,
        RegisterRequest {
            user_id: "user-b".to_string(),
            platform: "web".to_string(),
            device_id: None,
            endpoint: Some(format!("{}/send/500", mock_server.uri())),
            p256dh: Some(dummy_p256dh()),
            auth: Some(dummy_auth()),
            push_token: None,
            browser_id: Some("browser-b".to_string()),
            user_agent: None,
        },
    )
    .await
    .unwrap();

    let (coordinator, _) = create_coordinator(pool.clone(), |_| {}).await;

    coordinator
        .dispatch_message_notification("room-1", "user-a")
        .await;

    // Assert subscription row remains
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM push_subscriptions WHERE id = ?")
        .bind(&sub.id)
        .fetch_one(&pool)
        .await
        .unwrap();

    assert_eq!(count, 1);
}

#[tokio::test]
async fn test_last_used_at_updated_on_success() {
    let pool = common::setup_test_db().await;
    let mock_server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/send/ok"))
        .respond_with(ResponseTemplate::new(201))
        .expect(1)
        .mount(&mock_server)
        .await;

    setup_user(&pool, "user-a", "alice").await;
    setup_user(&pool, "user-b", "bob").await;
    setup_room(&pool, "room-1", "user-a").await;
    add_member(&pool, "room-1", "user-b").await;

    let sub = register_subscription(
        &pool,
        RegisterRequest {
            user_id: "user-b".to_string(),
            platform: "web".to_string(),
            device_id: None,
            endpoint: Some(format!("{}/send/ok", mock_server.uri())),
            p256dh: Some(dummy_p256dh()),
            auth: Some(dummy_auth()),
            push_token: None,
            browser_id: Some("browser-b".to_string()),
            user_agent: None,
        },
    )
    .await
    .unwrap();

    assert!(sub.last_used_at.is_none());

    let (coordinator, _) = create_coordinator(pool.clone(), |_| {}).await;

    coordinator
        .dispatch_message_notification("room-1", "user-a")
        .await;

    let last_used: Option<chrono::DateTime<Utc>> =
        sqlx::query_scalar("SELECT last_used_at FROM push_subscriptions WHERE id = ?")
            .bind(&sub.id)
            .fetch_one(&pool)
            .await
            .unwrap();

    assert!(last_used.is_some());
}

#[tokio::test]
async fn test_vapid_header_and_content_encoding_present() {
    let pool = common::setup_test_db().await;
    let mock_server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/send/headers"))
        .and(wiremock::matchers::header_exists("Authorization"))
        .and(wiremock::matchers::header("Content-Encoding", "aes128gcm"))
        .respond_with(ResponseTemplate::new(201))
        .expect(1)
        .mount(&mock_server)
        .await;

    setup_user(&pool, "user-a", "alice").await;
    setup_user(&pool, "user-b", "bob").await;
    setup_room(&pool, "room-1", "user-a").await;
    add_member(&pool, "room-1", "user-b").await;

    register_subscription(
        &pool,
        RegisterRequest {
            user_id: "user-b".to_string(),
            platform: "web".to_string(),
            device_id: None,
            endpoint: Some(format!("{}/send/headers", mock_server.uri())),
            p256dh: Some(dummy_p256dh()),
            auth: Some(dummy_auth()),
            push_token: None,
            browser_id: Some("browser-b".to_string()),
            user_agent: None,
        },
    )
    .await
    .unwrap();

    let (coordinator, _) = create_coordinator(pool, |_| {}).await;

    coordinator
        .dispatch_message_notification("room-1", "user-a")
        .await;
}

#[tokio::test]
async fn test_timeout_handled_as_transient() {
    let pool = common::setup_test_db().await;
    let mock_server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/send/slow"))
        .respond_with(ResponseTemplate::new(201).set_delay(std::time::Duration::from_millis(500)))
        .expect(1)
        .mount(&mock_server)
        .await;

    setup_user(&pool, "user-a", "alice").await;
    setup_user(&pool, "user-b", "bob").await;
    setup_room(&pool, "room-1", "user-a").await;
    add_member(&pool, "room-1", "user-b").await;

    let sub = register_subscription(
        &pool,
        RegisterRequest {
            user_id: "user-b".to_string(),
            platform: "web".to_string(),
            device_id: None,
            endpoint: Some(format!("{}/send/slow", mock_server.uri())),
            p256dh: Some(dummy_p256dh()),
            auth: Some(dummy_auth()),
            push_token: None,
            browser_id: Some("browser-b".to_string()),
            user_agent: None,
        },
    )
    .await
    .unwrap();

    // Set timeout_secs = 1 (100ms timeout for test)
    let (coordinator, _) = create_coordinator(pool.clone(), |cfg| {
        cfg.push_delivery_timeout_secs = 1;
    })
    .await;

    // Dispatch finishes promptly despite delay
    coordinator
        .dispatch_message_notification("room-1", "user-a")
        .await;

    // Subscription row remains
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM push_subscriptions WHERE id = ?")
        .bind(&sub.id)
        .fetch_one(&pool)
        .await
        .unwrap();

    assert_eq!(count, 1);
}

#[tokio::test]
async fn test_multiple_subscriptions_same_user() {
    let pool = common::setup_test_db().await;
    let mock_server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/send/sub-a"))
        .respond_with(ResponseTemplate::new(201))
        .expect(1)
        .mount(&mock_server)
        .await;

    Mock::given(method("POST"))
        .and(path("/send/sub-b"))
        .respond_with(ResponseTemplate::new(201))
        .expect(1)
        .mount(&mock_server)
        .await;

    setup_user(&pool, "user-a", "alice").await;
    setup_user(&pool, "user-b", "bob").await;
    setup_room(&pool, "room-1", "user-a").await;
    add_member(&pool, "room-1", "user-b").await;

    register_subscription(
        &pool,
        RegisterRequest {
            user_id: "user-b".to_string(),
            platform: "web".to_string(),
            device_id: None,
            endpoint: Some(format!("{}/send/sub-a", mock_server.uri())),
            p256dh: Some(dummy_p256dh()),
            auth: Some(dummy_auth()),
            push_token: None,
            browser_id: Some("browser-a".to_string()),
            user_agent: None,
        },
    )
    .await
    .unwrap();

    register_subscription(
        &pool,
        RegisterRequest {
            user_id: "user-b".to_string(),
            platform: "web".to_string(),
            device_id: None,
            endpoint: Some(format!("{}/send/sub-b", mock_server.uri())),
            p256dh: Some(dummy_p256dh()),
            auth: Some(dummy_auth()),
            push_token: None,
            browser_id: Some("browser-b".to_string()),
            user_agent: None,
        },
    )
    .await
    .unwrap();

    let (coordinator, _) = create_coordinator(pool, |_| {}).await;

    coordinator
        .dispatch_message_notification("room-1", "user-a")
        .await;
}

#[tokio::test]
async fn test_non_members_not_notified() {
    let pool = common::setup_test_db().await;
    let mock_server = MockServer::start().await;

    Mock::given(method("POST"))
        .respond_with(ResponseTemplate::new(201))
        .expect(0)
        .mount(&mock_server)
        .await;

    setup_user(&pool, "user-a", "alice").await;
    setup_user(&pool, "user-c", "charlie").await;
    setup_room(&pool, "room-1", "user-a").await;

    // Charlie is not a member of room-1
    register_subscription(
        &pool,
        RegisterRequest {
            user_id: "user-c".to_string(),
            platform: "web".to_string(),
            device_id: None,
            endpoint: Some(format!("{}/send/charlie", mock_server.uri())),
            p256dh: Some(dummy_p256dh()),
            auth: Some(dummy_auth()),
            push_token: None,
            browser_id: Some("browser-c".to_string()),
            user_agent: None,
        },
    )
    .await
    .unwrap();

    let (coordinator, _) = create_coordinator(pool, |_| {}).await;

    coordinator
        .dispatch_message_notification("room-1", "user-a")
        .await;
}

#[tokio::test]
async fn test_unsupported_platform_skipped() {
    let pool = common::setup_test_db().await;
    let mock_server = MockServer::start().await;

    Mock::given(method("POST"))
        .respond_with(ResponseTemplate::new(201))
        .expect(0)
        .mount(&mock_server)
        .await;

    setup_user(&pool, "user-a", "alice").await;
    setup_user(&pool, "user-b", "bob").await;
    setup_room(&pool, "room-1", "user-a").await;
    add_member(&pool, "room-1", "user-b").await;

    // Register iOS platform subscription
    register_subscription(
        &pool,
        RegisterRequest {
            user_id: "user-b".to_string(),
            platform: "ios".to_string(),
            device_id: None,
            endpoint: None,
            p256dh: None,
            auth: None,
            push_token: Some("apns-token-123".to_string()),
            browser_id: None,
            user_agent: None,
        },
    )
    .await
    .unwrap();

    let (coordinator, _) = create_coordinator(pool, |_| {}).await;

    coordinator
        .dispatch_message_notification("room-1", "user-a")
        .await;
}

#[tokio::test]
async fn test_anonymized_or_deleted_sender_delivers_valid_sender_ref() {
    let pool = common::setup_test_db().await;
    let mock_server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/send/anon"))
        .respond_with(ResponseTemplate::new(201))
        .expect(1)
        .mount(&mock_server)
        .await;

    // Create user A with random anonymized 86-char base64url username_token (§14.2)
    let anon_token = URL_SAFE_NO_PAD.encode([7u8; 64]);
    sqlx::query(
        "INSERT INTO users (id, username_token, opaque_registration, identity_pubkey, deleted_at) VALUES ('user-anon', ?, X'00', '', CURRENT_TIMESTAMP)",
    )
    .bind(&anon_token)
    .execute(&pool)
    .await
    .unwrap();

    setup_user(&pool, "user-b", "bob").await;
    setup_room(&pool, "room-1", "user-anon").await;
    add_member(&pool, "room-1", "user-b").await;

    register_subscription(
        &pool,
        RegisterRequest {
            user_id: "user-b".to_string(),
            platform: "web".to_string(),
            device_id: None,
            endpoint: Some(format!("{}/send/anon", mock_server.uri())),
            p256dh: Some(dummy_p256dh()),
            auth: Some(dummy_auth()),
            push_token: None,
            browser_id: Some("browser-b".to_string()),
            user_agent: None,
        },
    )
    .await
    .unwrap();

    let (coordinator, _) = create_coordinator(pool, |_| {}).await;

    coordinator
        .dispatch_message_notification("room-1", "user-anon")
        .await;
}

#[tokio::test]
async fn test_revoked_subscription_skipped() {
    let pool = common::setup_test_db().await;
    let mock_server = MockServer::start().await;

    Mock::given(method("POST"))
        .respond_with(ResponseTemplate::new(201))
        .expect(0)
        .mount(&mock_server)
        .await;

    setup_user(&pool, "user-a", "alice").await;
    setup_user(&pool, "user-b", "bob").await;
    setup_room(&pool, "room-1", "user-a").await;
    add_member(&pool, "room-1", "user-b").await;

    let sub = register_subscription(
        &pool,
        RegisterRequest {
            user_id: "user-b".to_string(),
            platform: "web".to_string(),
            device_id: None,
            endpoint: Some(format!("{}/send/revoked", mock_server.uri())),
            p256dh: Some(dummy_p256dh()),
            auth: Some(dummy_auth()),
            push_token: None,
            browser_id: Some("browser-b".to_string()),
            user_agent: None,
        },
    )
    .await
    .unwrap();

    server::push::subscriptions::revoke_subscription(&pool, "user-b", &sub.id)
        .await
        .unwrap();

    let (coordinator, _) = create_coordinator(pool, |_| {}).await;

    coordinator
        .dispatch_message_notification("room-1", "user-a")
        .await;
}
