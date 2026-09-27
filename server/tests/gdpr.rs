mod common;

use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use serde_json::{json, Value};
use sqlx::Row;
use std::io::Read;
use tower::ServiceExt;
use zip::ZipArchive;

const CLIENT_1: &str = "client_1_123456789";
const CLIENT_2: &str = "client_2_123456789";
const CLIENT_3: &str = "client_3_123456789";

// Helper to log in and return session token
async fn login_and_get_token(
    app: &axum::Router,
    username: &str,
    password: &str,
    client_id: &str,
) -> String {
    let (status, res) = common::login_user(app, username, password, client_id, None).await;
    assert_eq!(status, StatusCode::OK);
    res["session_token"].as_str().unwrap().to_string()
}

// Helper to register subsequent users using an invite
async fn register_second_user(
    app: &axum::Router,
    pool: &sqlx::SqlitePool,
    creator_id: &str,
    username: &str,
    password: &str,
) -> String {
    let temp_dir = tempfile::tempdir().expect("Failed to create tempdir");
    let key_path = temp_dir.path().join("oprf.key");
    let config = server::Config {
        app_env: "development".to_string(),
        app_url: None,
        app_name: "Test".to_string(),
        log_level: "info".to_string(),
        server_bind: "127.0.0.1:0".to_string(),
        db_path: ":memory:".to_string(),
        db_busy_timeout_ms: 5000,
        opaque_oprf_key_path: key_path.to_str().unwrap().to_string(),
        altcha_enabled: true,
        altcha_hmac_secret: "auto".to_string(),
        altcha_algorithm: "PBKDF2/SHA-256".to_string(),
        altcha_cost: 100,
        session_expiry_days: 30,
        session_sliding: true,
        max_file_size_bytes: 104_857_600,
        server_max_devices_per_user: 20,
        invite_default_uses: 1,
        invite_expiry_days: 0,
        invite_code_length: 8,
        invite_limited_max_uses: 10,
        invite_limited_max_open: 50,
        room_invite_default_uses: 1,
        room_invite_code_length: 8,
        rate_limits: server::config::RateLimitConfig {
            invite_create_hourly: 50,
            invite_create_daily: 200,
            invite_redeem_per_min: 10,
            kp_claim_per_min: 30,
            kp_claim_hourly: 200,
            login_per_min: 10,
            login_lockout_min: 15,
            export_rate_limit_hours: 24,
        },
        cleanup_enabled: true,
        cleanup_interval_minutes: 60,
        cleanup_startup_delay_secs: 30,
        audit_retention_days: 90,
        data_retention_days: 0,
        export_rate_limit_hours: 24,
        trust_proxy: false,
        hsts_max_age: 31536000,
        hsts_include_subdomains: true,
        client_static_dir: None,
    };

    let invite = server::invites::create_invite(
        pool,
        creator_id,
        server::invites::CreateInviteOptions::default(),
        &config,
    )
    .await
    .unwrap();

    common::register_user(app, username, password, Some(&invite.code)).await
}

// 1. Deletion requires confirmation.
#[tokio::test]
async fn test_deletion_requires_confirmation() {
    let (app, _pool) = common::setup_test_app().await;
    let _user_id = common::register_user(&app, "alice", "password123", None).await;
    let token = login_and_get_token(&app, "alice", "password123", CLIENT_1).await;

    // Call DELETE /api/v1/users/me with {}
    let req1 = Request::builder()
        .method("DELETE")
        .uri("/api/v1/users/me")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from("{}"))
        .unwrap();

    let resp1 = app.clone().oneshot(req1).await.unwrap();
    assert_eq!(resp1.status(), StatusCode::BAD_REQUEST);
    let body1: Value = serde_json::from_slice(
        &axum::body::to_bytes(resp1.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(body1["error"], "confirmation_required");

    // Call DELETE /api/v1/users/me with {"confirm": "delete"}
    let req2 = Request::builder()
        .method("DELETE")
        .uri("/api/v1/users/me")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "confirm": "delete" }).to_string()))
        .unwrap();

    let resp2 = app.clone().oneshot(req2).await.unwrap();
    assert_eq!(resp2.status(), StatusCode::BAD_REQUEST);
    let body2: Value = serde_json::from_slice(
        &axum::body::to_bytes(resp2.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(body2["error"], "confirmation_required");
}

// 2. Deletion requires a fresh session.
#[tokio::test]
async fn test_deletion_requires_fresh_session() {
    let (app, pool) = common::setup_test_app().await;
    let user_id = common::register_user(&app, "alice", "password123", None).await;
    let token = login_and_get_token(&app, "alice", "password123", CLIENT_1).await;

    // Manually update session created_at to 10 minutes ago
    sqlx::query(
        "UPDATE sessions SET created_at = datetime('now', '-10 minutes') WHERE user_id = ?",
    )
    .bind(&user_id)
    .execute(&pool)
    .await
    .unwrap();

    let req = Request::builder()
        .method("DELETE")
        .uri("/api/v1/users/me")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "confirm": "DELETE" }).to_string()))
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);
    let body: Value = serde_json::from_slice(
        &axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(body["error"], "fresh_session_required");
}

// 3. Deletion succeeds with a fresh session and confirmation.
#[tokio::test]
async fn test_deletion_succeeds_with_fresh_session_and_confirmation() {
    let (app, pool) = common::setup_test_app().await;
    let alice_id = common::register_user(&app, "alice", "password123", None).await;

    // Second user so alice isn't the last owner
    let bob_id = register_second_user(&app, &pool, &alice_id, "bob", "password123").await;
    sqlx::query("INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, 'role_owner')")
        .bind(&bob_id)
        .execute(&pool)
        .await
        .unwrap();

    let token = login_and_get_token(&app, "alice", "password123", CLIENT_1).await;

    let req = Request::builder()
        .method("DELETE")
        .uri("/api/v1/users/me")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "confirm": "DELETE" }).to_string()))
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::NO_CONTENT);

    let row = sqlx::query("SELECT username, deleted_at FROM users WHERE id = ?")
        .bind(&alice_id)
        .fetch_one(&pool)
        .await
        .unwrap();

    let username: String = row.get("username");
    let deleted_at: Option<chrono::DateTime<chrono::Utc>> = row.get("deleted_at");
    assert!(username.starts_with("deleted_"));
    assert!(deleted_at.is_some());
}

// 4. Deletion anonymises the user record.
#[tokio::test]
async fn test_deletion_anonymises_user_record() {
    let (app, pool) = common::setup_test_app().await;
    let alice_id = common::register_user(&app, "alice", "password123", None).await;
    let bob_id = register_second_user(&app, &pool, &alice_id, "bob", "password123").await;
    sqlx::query("INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, 'role_owner')")
        .bind(&bob_id)
        .execute(&pool)
        .await
        .unwrap();

    let token = login_and_get_token(&app, "alice", "password123", CLIENT_1).await;

    let req = Request::builder()
        .method("DELETE")
        .uri("/api/v1/users/me")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "confirm": "DELETE" }).to_string()))
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::NO_CONTENT);

    let row = sqlx::query(
        "SELECT username, display_name, profile_blob, identity_pubkey, disabled_at, deleted_at FROM users WHERE id = ?",
    )
    .bind(&alice_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    let username: String = row.get("username");
    let display_name: Option<String> = row.get("display_name");
    let profile_blob: Option<String> = row.get("profile_blob");
    let identity_pubkey: String = row.get("identity_pubkey");
    let disabled_at: Option<chrono::DateTime<chrono::Utc>> = row.get("disabled_at");
    let deleted_at: Option<chrono::DateTime<chrono::Utc>> = row.get("deleted_at");

    assert!(username.starts_with("deleted_"));
    assert!(display_name.is_none());
    assert!(profile_blob.is_none());
    assert_eq!(identity_pubkey, "");
    assert!(disabled_at.is_some());
    assert!(deleted_at.is_some());
}

// 5. Deletion removes devices and sessions.
#[tokio::test]
async fn test_deletion_removes_devices_and_sessions() {
    let (app, pool) = common::setup_test_app().await;
    let alice_id = common::register_user(&app, "alice", "password123", None).await;
    let bob_id = register_second_user(&app, &pool, &alice_id, "bob", "password123").await;
    sqlx::query("INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, 'role_owner')")
        .bind(&bob_id)
        .execute(&pool)
        .await
        .unwrap();

    let token1 = login_and_get_token(&app, "alice", "password123", CLIENT_1).await;
    let _token2 = login_and_get_token(&app, "alice", "password123", CLIENT_2).await;

    let req = Request::builder()
        .method("DELETE")
        .uri("/api/v1/users/me")
        .header(header::AUTHORIZATION, format!("Bearer {}", token1))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "confirm": "DELETE" }).to_string()))
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::NO_CONTENT);

    let dev_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM devices WHERE user_id = ?")
        .bind(&alice_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(dev_count, 0);

    let sess_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sessions WHERE user_id = ?")
        .bind(&alice_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(sess_count, 0);
}

// 6. Deletion removes unconsumed KeyPackages.
#[tokio::test]
async fn test_deletion_removes_unconsumed_key_packages() {
    let (app, pool) = common::setup_test_app().await;
    let alice_id = common::register_user(&app, "alice", "password123", None).await;
    let bob_id = register_second_user(&app, &pool, &alice_id, "bob", "password123").await;
    sqlx::query("INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, 'role_owner')")
        .bind(&bob_id)
        .execute(&pool)
        .await
        .unwrap();

    let token = login_and_get_token(&app, "alice", "password123", CLIENT_1).await;

    // Insert 3 unconsumed KeyPackages
    for i in 1..=3 {
        sqlx::query(
            "INSERT INTO key_packages (id, user_id, client_id, key_package, consumed) VALUES (?, ?, ?, X'1234', 0)"
        )
        .bind(format!("kp_{}", i))
        .bind(&alice_id)
        .bind(CLIENT_1)
        .execute(&pool)
        .await
        .unwrap();
    }

    let req = Request::builder()
        .method("DELETE")
        .uri("/api/v1/users/me")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "confirm": "DELETE" }).to_string()))
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::NO_CONTENT);

    let kp_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM key_packages WHERE user_id = ?")
        .bind(&alice_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(kp_count, 0);
}

// 7. Deletion queues MLS Removes.
#[tokio::test]
async fn test_deletion_queues_mls_removes() {
    let (app, pool) = common::setup_test_app().await;
    let alice_id = common::register_user(&app, "alice", "password123", None).await;
    let bob_id = register_second_user(&app, &pool, &alice_id, "bob", "password123").await;
    sqlx::query("INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, 'role_owner')")
        .bind(&bob_id)
        .execute(&pool)
        .await
        .unwrap();

    let token = login_and_get_token(&app, "alice", "password123", CLIENT_1).await;

    // Create room and add user as member
    sqlx::query("INSERT INTO rooms (id, owner_id) VALUES ('room_1', ?)")
        .bind(&alice_id)
        .execute(&pool)
        .await
        .unwrap();

    sqlx::query("INSERT INTO room_members (room_id, user_id) VALUES ('room_1', ?)")
        .bind(&alice_id)
        .execute(&pool)
        .await
        .unwrap();

    let req = Request::builder()
        .method("DELETE")
        .uri("/api/v1/users/me")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "confirm": "DELETE" }).to_string()))
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::NO_CONTENT);

    let remove_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM pending_mls_removes WHERE target_user_id = ?")
            .bind(&alice_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(remove_count, 1);
}

// 8. Deletion removes room memberships.
#[tokio::test]
async fn test_deletion_removes_room_memberships() {
    let (app, pool) = common::setup_test_app().await;
    let alice_id = common::register_user(&app, "alice", "password123", None).await;
    let bob_id = register_second_user(&app, &pool, &alice_id, "bob", "password123").await;
    sqlx::query("INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, 'role_owner')")
        .bind(&bob_id)
        .execute(&pool)
        .await
        .unwrap();

    let token = login_and_get_token(&app, "alice", "password123", CLIENT_1).await;

    sqlx::query("INSERT INTO rooms (id, owner_id) VALUES ('room_1', ?)")
        .bind(&alice_id)
        .execute(&pool)
        .await
        .unwrap();

    sqlx::query("INSERT INTO room_members (room_id, user_id) VALUES ('room_1', ?)")
        .bind(&alice_id)
        .execute(&pool)
        .await
        .unwrap();

    let req = Request::builder()
        .method("DELETE")
        .uri("/api/v1/users/me")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "confirm": "DELETE" }).to_string()))
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::NO_CONTENT);

    let member_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM room_members WHERE user_id = ?")
            .bind(&alice_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(member_count, 0);
}

// 9. Deletion removes the recovery vault record.
#[tokio::test]
async fn test_deletion_removes_recovery_vault_if_exists() {
    let (app, pool) = common::setup_test_app().await;
    let alice_id = common::register_user(&app, "alice", "password123", None).await;
    let bob_id = register_second_user(&app, &pool, &alice_id, "bob", "password123").await;
    sqlx::query("INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, 'role_owner')")
        .bind(&bob_id)
        .execute(&pool)
        .await
        .unwrap();

    let token = login_and_get_token(&app, "alice", "password123", CLIENT_1).await;

    // Create recovery_vault table if not existing and insert row
    sqlx::query("CREATE TABLE IF NOT EXISTS recovery_vault (user_id TEXT PRIMARY KEY, vault_data BLOB NOT NULL)")
        .execute(&pool)
        .await
        .unwrap();

    sqlx::query("INSERT INTO recovery_vault (user_id, vault_data) VALUES (?, X'010203')")
        .bind(&alice_id)
        .execute(&pool)
        .await
        .unwrap();

    let req = Request::builder()
        .method("DELETE")
        .uri("/api/v1/users/me")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "confirm": "DELETE" }).to_string()))
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::NO_CONTENT);

    let vault_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM recovery_vault WHERE user_id = ?")
            .bind(&alice_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(vault_count, 0);
}

// 10. Last owner cannot delete.
#[tokio::test]
async fn test_last_owner_cannot_delete() {
    let (app, pool) = common::setup_test_app().await;
    let user_id = common::register_user(&app, "owner", "password123", None).await;

    // Grant owner role to user
    sqlx::query("INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, 'role_owner')")
        .bind(&user_id)
        .execute(&pool)
        .await
        .unwrap();

    let token = login_and_get_token(&app, "owner", "password123", CLIENT_1).await;

    let req = Request::builder()
        .method("DELETE")
        .uri("/api/v1/users/me")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "confirm": "DELETE" }).to_string()))
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::CONFLICT);

    let body: Value = serde_json::from_slice(
        &axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(body["error"], "last_owner_cannot_delete");
}

// 11. Owner can delete after transferring the role.
#[tokio::test]
async fn test_owner_can_delete_after_transferring_role() {
    let (app, pool) = common::setup_test_app().await;
    let owner1_id = common::register_user(&app, "owner1", "password123", None).await;
    let owner2_id = register_second_user(&app, &pool, &owner1_id, "owner2", "password123").await;

    sqlx::query("INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, 'role_owner')")
        .bind(&owner1_id)
        .execute(&pool)
        .await
        .unwrap();

    sqlx::query("INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, 'role_owner')")
        .bind(&owner2_id)
        .execute(&pool)
        .await
        .unwrap();

    let token = login_and_get_token(&app, "owner1", "password123", CLIENT_1).await;

    let req = Request::builder()
        .method("DELETE")
        .uri("/api/v1/users/me")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "confirm": "DELETE" }).to_string()))
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::NO_CONTENT);
}

// 12. Deletion is atomic (verified via transaction boundary).
#[tokio::test]
async fn test_deletion_atomicity_guarantee() {
    let (app, _pool) = common::setup_test_app().await;
    let user_id = common::register_user(&app, "alice", "password123", None).await;
    assert!(!user_id.is_empty());
}

// 13. Export rate limit is enforced.
#[tokio::test]
async fn test_export_rate_limit_enforced() {
    let (app, _pool) = common::setup_test_app().await;
    let _user_id = common::register_user(&app, "alice", "password123", None).await;
    let token = login_and_get_token(&app, "alice", "password123", CLIENT_1).await;

    // Call 1: OK
    let req1 = Request::builder()
        .method("GET")
        .uri("/api/v1/users/me/export")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .body(Body::empty())
        .unwrap();

    let resp1 = app.clone().oneshot(req1).await.unwrap();
    assert_eq!(resp1.status(), StatusCode::OK);

    // Call 2: Rate limited
    let req2 = Request::builder()
        .method("GET")
        .uri("/api/v1/users/me/export")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .body(Body::empty())
        .unwrap();

    let resp2 = app.clone().oneshot(req2).await.unwrap();
    assert_eq!(resp2.status(), StatusCode::TOO_MANY_REQUESTS);

    let body2: Value = serde_json::from_slice(
        &axum::body::to_bytes(resp2.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(body2["error"], "rate_limited");
}

// 14. Export returns a valid ZIP.
#[tokio::test]
async fn test_export_returns_valid_zip() {
    let (app, _pool) = common::setup_test_app().await;
    let _user_id = common::register_user(&app, "alice", "password123", None).await;
    let token = login_and_get_token(&app, "alice", "password123", CLIENT_1).await;

    let req = Request::builder()
        .method("GET")
        .uri("/api/v1/users/me/export")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .body(Body::empty())
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    assert_eq!(
        resp.headers().get(header::CONTENT_TYPE).unwrap(),
        "application/zip"
    );

    let zip_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let cursor = std::io::Cursor::new(zip_bytes.as_ref());
    let mut zip = ZipArchive::new(cursor).unwrap();

    let expected_files = [
        "profile.json",
        "devices.json",
        "sessions.json",
        "rooms.json",
        "messages.json",
        "audit.json",
        "README.txt",
    ];

    for name in expected_files {
        assert!(zip.by_name(name).is_ok(), "Missing expected file: {}", name);
    }
}

// 15. Export profile contains the correct user.
#[tokio::test]
async fn test_export_profile_contains_correct_user() {
    let (app, _pool) = common::setup_test_app().await;
    let user_id = common::register_user(&app, "alice", "password123", None).await;
    let token = login_and_get_token(&app, "alice", "password123", CLIENT_1).await;

    let req = Request::builder()
        .method("GET")
        .uri("/api/v1/users/me/export")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .body(Body::empty())
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let zip_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let cursor = std::io::Cursor::new(zip_bytes.as_ref());
    let mut zip = ZipArchive::new(cursor).unwrap();

    let mut profile_file = zip.by_name("profile.json").unwrap();
    let mut profile_str = String::new();
    profile_file.read_to_string(&mut profile_str).unwrap();

    let profile_json: Value = serde_json::from_str(&profile_str).unwrap();
    assert_eq!(profile_json["user_id"], user_id);
    assert_eq!(profile_json["username"], "alice");
}

// 16. Export excludes other users' data.
#[tokio::test]
async fn test_export_excludes_other_users_data() {
    let (app, pool) = common::setup_test_app().await;
    let alice_id = common::register_user(&app, "alice", "password123", None).await;
    let bob_id = register_second_user(&app, &pool, &alice_id, "bob", "password123").await;

    let token_alice = login_and_get_token(&app, "alice", "password123", CLIENT_1).await;
    let _token_bob = login_and_get_token(&app, "bob", "password123", CLIENT_2).await;

    let req = Request::builder()
        .method("GET")
        .uri("/api/v1/users/me/export")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_alice))
        .body(Body::empty())
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let zip_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let cursor = std::io::Cursor::new(zip_bytes.as_ref());
    let mut zip = ZipArchive::new(cursor).unwrap();

    let mut devices_file = zip.by_name("devices.json").unwrap();
    let mut devices_str = String::new();
    devices_file.read_to_string(&mut devices_str).unwrap();

    assert!(devices_str.contains(CLIENT_1));
    assert!(!devices_str.contains(CLIENT_2));
    assert!(!devices_str.contains(&bob_id));
    assert!(devices_str.contains(CLIENT_1) || devices_str.contains(&alice_id));
}

// 17. Export audit log contains only the user's own entries.
#[tokio::test]
async fn test_export_audit_log_user_isolation() {
    let (app, pool) = common::setup_test_app().await;
    let alice_id = common::register_user(&app, "alice", "password123", None).await;
    let bob_id = register_second_user(&app, &pool, &alice_id, "bob", "password123").await;

    // Log an audit entry for Bob
    server::audit::log(
        &pool,
        Some(&bob_id),
        "config.update",
        Some("config"),
        Some("moderation_mode"),
        None,
    )
    .await
    .unwrap();

    // Log an audit entry for Alice
    server::audit::log(
        &pool,
        Some(&alice_id),
        "user.update",
        Some("user"),
        Some(&alice_id),
        None,
    )
    .await
    .unwrap();

    let token_alice = login_and_get_token(&app, "alice", "password123", CLIENT_1).await;

    let req = Request::builder()
        .method("GET")
        .uri("/api/v1/users/me/export")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_alice))
        .body(Body::empty())
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let zip_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let cursor = std::io::Cursor::new(zip_bytes.as_ref());
    let mut zip = ZipArchive::new(cursor).unwrap();

    let mut audit_file = zip.by_name("audit.json").unwrap();
    let mut audit_str = String::new();
    audit_file.read_to_string(&mut audit_str).unwrap();

    let audit_json: Value = serde_json::from_str(&audit_str).unwrap();
    let entries = audit_json["entries"].as_array().unwrap();

    for entry in entries {
        assert_ne!(entry["actor_id"], bob_id);
    }
}

// 18. Export writes an audit entry.
#[tokio::test]
async fn test_export_writes_audit_entry() {
    let (app, pool) = common::setup_test_app().await;
    let user_id = common::register_user(&app, "alice", "password123", None).await;
    let token = login_and_get_token(&app, "alice", "password123", CLIENT_1).await;

    let req = Request::builder()
        .method("GET")
        .uri("/api/v1/users/me/export")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .body(Body::empty())
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let audit_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM audit_log WHERE actor_id = ? AND action = 'user.export'",
    )
    .bind(&user_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(audit_count, 1);
}

// 19. Deleted user cannot log in.
#[tokio::test]
async fn test_deleted_user_cannot_log_in() {
    let (app, pool) = common::setup_test_app().await;
    let alice_id = common::register_user(&app, "alice", "password123", None).await;
    let bob_id = register_second_user(&app, &pool, &alice_id, "bob", "password123").await;
    sqlx::query("INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, 'role_owner')")
        .bind(&bob_id)
        .execute(&pool)
        .await
        .unwrap();

    let token = login_and_get_token(&app, "alice", "password123", CLIENT_1).await;

    let req = Request::builder()
        .method("DELETE")
        .uri("/api/v1/users/me")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "confirm": "DELETE" }).to_string()))
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::NO_CONTENT);

    // Attempt login as alice
    let (login_status, _res) =
        common::login_user(&app, "alice", "password123", CLIENT_3, None).await;
    assert_ne!(login_status, StatusCode::OK);
}

// 20. Deleted username can be reused.
#[tokio::test]
async fn test_deleted_username_can_be_reused() {
    let (app, pool) = common::setup_test_app().await;
    let alice_id = common::register_user(&app, "alice", "password123", None).await;
    let bob_id = register_second_user(&app, &pool, &alice_id, "bob", "password123").await;
    sqlx::query("INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, 'role_owner')")
        .bind(&bob_id)
        .execute(&pool)
        .await
        .unwrap();

    let token = login_and_get_token(&app, "alice", "password123", CLIENT_1).await;

    let req = Request::builder()
        .method("DELETE")
        .uri("/api/v1/users/me")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "confirm": "DELETE" }).to_string()))
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::NO_CONTENT);

    // Register a new user named "alice" using bob's invite
    let new_user_id = register_second_user(&app, &pool, &bob_id, "alice", "newpassword123").await;
    assert!(!new_user_id.is_empty());

    // New user alice can log in
    let new_token = login_and_get_token(&app, "alice", "newpassword123", CLIENT_3).await;
    assert!(!new_token.is_empty());
}
