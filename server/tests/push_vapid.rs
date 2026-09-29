use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use p256::elliptic_curve::sec1::ToEncodedPoint;
use p256::SecretKey;
use rand::rngs::OsRng;
use sqlx::sqlite::SqlitePoolOptions;

use server::config::Config;
use server::push::vapid::VapidKeys;

async fn setup_db() -> sqlx::SqlitePool {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .expect("Failed to create test db");
    sqlx::migrate!("./migrations")
        .run(&pool)
        .await
        .expect("Failed to run migrations");
    pool
}

#[tokio::test]
async fn test_push_disabled_skips_generation() {
    let pool = setup_db().await;
    let mut config = Config::test_default();
    config.push_enabled = false;

    let keys = VapidKeys::load_or_generate(&pool, &config)
        .await
        .expect("load_or_generate failed");
    assert!(keys.is_none());

    let count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM instance_config WHERE key LIKE 'push_vapid%'")
            .fetch_one(&pool)
            .await
            .expect("query failed");
    assert_eq!(count, 0);
}

#[tokio::test]
async fn test_first_startup_generates_keys() {
    let pool = setup_db().await;
    let config = Config::test_default();

    let keys = VapidKeys::load_or_generate(&pool, &config)
        .await
        .expect("load_or_generate failed")
        .expect("keys should be generated");

    assert!(!keys.public_key.is_empty());
    assert!(!keys.private_key.is_empty());

    let pub_bytes = URL_SAFE_NO_PAD
        .decode(&keys.public_key)
        .expect("valid base64url public key");
    assert_eq!(pub_bytes.len(), 65);
    assert_eq!(pub_bytes[0], 0x04);

    let priv_bytes = URL_SAFE_NO_PAD
        .decode(&keys.private_key)
        .expect("valid base64url private key");
    assert_eq!(priv_bytes.len(), 32);

    let stored_pub: String =
        sqlx::query_scalar("SELECT value FROM instance_config WHERE key = 'push_vapid_public_key'")
            .fetch_one(&pool)
            .await
            .expect("fetch pub key");
    let stored_priv: String = sqlx::query_scalar(
        "SELECT value FROM instance_config WHERE key = 'push_vapid_private_key'",
    )
    .fetch_one(&pool)
    .await
    .expect("fetch priv key");

    assert_eq!(stored_pub, keys.public_key);
    assert_eq!(stored_priv, keys.private_key);
}

#[tokio::test]
async fn test_subsequent_startup_loads_existing_keys() {
    let pool = setup_db().await;
    let config = Config::test_default();

    let keys1 = VapidKeys::load_or_generate(&pool, &config)
        .await
        .expect("first run")
        .expect("keys1");

    let keys2 = VapidKeys::load_or_generate(&pool, &config)
        .await
        .expect("second run")
        .expect("keys2");

    assert_eq!(keys1.public_key, keys2.public_key);
    assert_eq!(keys1.private_key, keys2.private_key);
}

#[tokio::test]
async fn test_explicit_keys_used_as_is() {
    let pool = setup_db().await;

    let secret = SecretKey::random(&mut OsRng);
    let public = secret.public_key().to_encoded_point(false);
    let pub_b64 = URL_SAFE_NO_PAD.encode(public.as_bytes());
    let priv_b64 = URL_SAFE_NO_PAD.encode(secret.to_bytes());

    let mut config = Config::test_default();
    config.push_vapid_public_key = pub_b64.clone();
    config.push_vapid_private_key = priv_b64.clone();

    let keys = VapidKeys::load_or_generate(&pool, &config)
        .await
        .expect("explicit keys load")
        .expect("keys");

    assert_eq!(keys.public_key, pub_b64);
    assert_eq!(keys.private_key, priv_b64);

    let count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM instance_config WHERE key LIKE 'push_vapid%'")
            .fetch_one(&pool)
            .await
            .expect("query count");
    assert_eq!(count, 0);
}

static ENV_MUTEX: std::sync::Mutex<()> = std::sync::Mutex::new(());

#[test]
fn test_mixed_auto_explicit_fails_config() {
    let _guard = ENV_MUTEX.lock().unwrap();
    std::env::set_var("APP_ENV", "development");
    std::env::set_var("PUSH_ENABLED", "true");
    std::env::set_var("PUSH_VAPID_PUBLIC_KEY", "auto");
    std::env::set_var("PUSH_VAPID_PRIVATE_KEY", "explicit-key");

    let res = Config::from_env();
    assert!(res.is_err());
    let err_str = res.unwrap_err().to_string();
    assert!(err_str.contains("must both be \"auto\" or both be explicit values"));

    std::env::remove_var("APP_ENV");
    std::env::remove_var("PUSH_ENABLED");
    std::env::remove_var("PUSH_VAPID_PUBLIC_KEY");
    std::env::remove_var("PUSH_VAPID_PRIVATE_KEY");
}

#[test]
fn test_invalid_public_key_fails_config() {
    let _guard = ENV_MUTEX.lock().unwrap();
    std::env::set_var("APP_ENV", "development");
    std::env::set_var("PUSH_ENABLED", "true");
    let invalid_pub = URL_SAFE_NO_PAD.encode([0u8; 32]);
    let valid_priv = URL_SAFE_NO_PAD.encode([0u8; 32]);
    std::env::set_var("PUSH_VAPID_PUBLIC_KEY", &invalid_pub);
    std::env::set_var("PUSH_VAPID_PRIVATE_KEY", &valid_priv);

    let res = Config::from_env();
    assert!(res.is_err());
    let err_str = res.unwrap_err().to_string();
    assert!(err_str.contains("Invalid PUSH_VAPID_PUBLIC_KEY"));

    std::env::remove_var("APP_ENV");
    std::env::remove_var("PUSH_ENABLED");
    std::env::remove_var("PUSH_VAPID_PUBLIC_KEY");
    std::env::remove_var("PUSH_VAPID_PRIVATE_KEY");
}

#[test]
fn test_invalid_private_key_fails_config() {
    let _guard = ENV_MUTEX.lock().unwrap();
    std::env::set_var("APP_ENV", "development");
    std::env::set_var("PUSH_ENABLED", "true");
    let secret = SecretKey::random(&mut OsRng);
    let public = secret.public_key().to_encoded_point(false);
    let valid_pub = URL_SAFE_NO_PAD.encode(public.as_bytes());
    let invalid_priv = URL_SAFE_NO_PAD.encode([0u8; 64]);

    std::env::set_var("PUSH_VAPID_PUBLIC_KEY", &valid_pub);
    std::env::set_var("PUSH_VAPID_PRIVATE_KEY", &invalid_priv);

    let res = Config::from_env();
    assert!(res.is_err());
    let err_str = res.unwrap_err().to_string();
    println!("ERR STR: {err_str}");
    assert!(err_str.contains("Invalid PUSH_VAPID_PRIVATE_KEY"));

    std::env::remove_var("APP_ENV");
    std::env::remove_var("PUSH_ENABLED");
    std::env::remove_var("PUSH_VAPID_PUBLIC_KEY");
    std::env::remove_var("PUSH_VAPID_PRIVATE_KEY");
}

#[tokio::test]
async fn test_private_key_never_logged() {
    let pool = setup_db().await;
    let config = Config::test_default();

    let keys = VapidKeys::load_or_generate(&pool, &config)
        .await
        .expect("generate")
        .expect("keys");

    let private_key_str = keys.private_key.clone();
    assert!(!private_key_str.is_empty());

    let debug_output = format!("{:?}", keys);
    assert!(!debug_output.contains(&private_key_str));
    assert!(debug_output.contains("<redacted>"));
}
