use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use serde_json::{json, Value};
use tower::ServiceExt;

mod common;

#[tokio::test]
async fn test_key_transparency_log_append_on_register() {
    let (app, pool) = common::setup_test_app().await;

    // Register user 1
    let user_id1 = common::register_user(&app, "ktuser1", "pass123456", None).await;

    // Query DB for user 1 leaf
    let row1: (i64, String, String) = sqlx::query_as(
        "SELECT leaf_index, user_id, username_token FROM key_transparency_log WHERE user_id = ?",
    )
    .bind(&user_id1)
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(row1.0, 1);
    assert_eq!(row1.1, user_id1);

    // Register user 2 using invite from user 1
    let temp_dir = tempfile::tempdir().expect("Failed to create tempdir");
    let key_path = temp_dir.path().join("oprf.key");
    let config = server::Config {
        opaque_oprf_key_path: key_path.to_str().unwrap().to_string(),
        altcha_enabled: true,
        altcha_hmac_secret: "auto".to_string(),
        altcha_cost: 100,
        cleanup_enabled: true,
        cleanup_startup_delay_secs: 30,
        ..server::Config::test_default()
    };

    let invite = server::invites::create_invite(
        &pool,
        &user_id1,
        server::invites::CreateInviteOptions::default(),
        &config,
    )
    .await
    .unwrap();

    let user_id2 = common::register_user(&app, "ktuser2", "pass123456", Some(&invite.code)).await;

    let row2: (i64, String, String) = sqlx::query_as(
        "SELECT leaf_index, user_id, username_token FROM key_transparency_log WHERE user_id = ?",
    )
    .bind(&user_id2)
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(row2.0, 2);
    assert_eq!(row2.1, user_id2);
}

#[tokio::test]
async fn test_key_transparency_disabled_flag_and_toggle() {
    let (app, _pool) = common::setup_test_app().await;

    let _user_id1 = common::register_user(&app, "flaguser1", "pass123456", None).await;

    let (login_status, login_res) =
        common::login_user(&app, "flaguser1", "pass123456", "client_1_123456789", None).await;
    assert_eq!(login_status, StatusCode::OK);
    let owner_token = login_res["session_token"].as_str().unwrap();

    let req1 = Request::builder()
        .method("GET")
        .uri("/api/v1/admin/key-transparency")
        .header(header::AUTHORIZATION, format!("Bearer {}", owner_token))
        .body(Body::empty())
        .unwrap();

    let resp1 = app.clone().oneshot(req1).await.unwrap();

    assert_eq!(resp1.status(), StatusCode::OK);
    let body1: Value = serde_json::from_slice(
        &axum::body::to_bytes(resp1.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(body1["enabled"], true);
    assert_eq!(body1["tree_size"], 1);

    // Test with disabled flag
    let (app_disabled, pool_disabled, _) = common::setup_test_app_with_custom_config(|c| {
        c.key_transparency_enabled = false;
    })
    .await;

    let user_id2 = common::register_user(&app_disabled, "flaguser2", "pass123456", None).await;

    let count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM key_transparency_log WHERE user_id = ?")
            .bind(&user_id2)
            .fetch_one(&pool_disabled)
            .await
            .unwrap();

    assert_eq!(count, 0);
}

#[tokio::test]
async fn test_key_transparency_account_deletion_anonymization() {
    let (app, pool) = common::setup_test_app().await;

    let alice_id = common::register_user(&app, "alice", "pass123456", None).await;

    let temp_dir = tempfile::tempdir().expect("Failed to create tempdir");
    let key_path = temp_dir.path().join("oprf.key");
    let config = server::Config {
        opaque_oprf_key_path: key_path.to_str().unwrap().to_string(),
        altcha_enabled: true,
        altcha_hmac_secret: "auto".to_string(),
        altcha_cost: 100,
        cleanup_enabled: true,
        cleanup_startup_delay_secs: 30,
        ..server::Config::test_default()
    };

    let invite = server::invites::create_invite(
        &pool,
        &alice_id,
        server::invites::CreateInviteOptions::default(),
        &config,
    )
    .await
    .unwrap();

    let bob_id = common::register_user(&app, "bob", "pass123456", Some(&invite.code)).await;
    sqlx::query("INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, 'role_owner')")
        .bind(&bob_id)
        .execute(&pool)
        .await
        .unwrap();

    let (login_status, login_res) =
        common::login_user(&app, "alice", "pass123456", "client_1_123456789", None).await;
    assert_eq!(login_status, StatusCode::OK);
    let token = login_res["session_token"].as_str().unwrap();

    let username_token: String =
        sqlx::query_scalar("SELECT username_token FROM users WHERE id = ?")
            .bind(&alice_id)
            .fetch_one(&pool)
            .await
            .unwrap();

    // Verify row exists in KT log before deletion
    let initial_row: (String, String) = sqlx::query_as(
        "SELECT user_id, username_token FROM key_transparency_log WHERE user_id = ?",
    )
    .bind(&alice_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(initial_row.0, alice_id);
    assert_eq!(initial_row.1, username_token);

    // Call DELETE /api/v1/users/me
    let req = Request::builder()
        .method("DELETE")
        .uri("/api/v1/users/me")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "confirm": "DELETE" }).to_string()))
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::NO_CONTENT);

    // Verify row still exists in KT log, user_id replaced with anon_ placeholder, username_token retained
    let anon_row: (String, String) = sqlx::query_as(
        "SELECT user_id, username_token FROM key_transparency_log WHERE username_token = ?",
    )
    .bind(&username_token)
    .fetch_one(&pool)
    .await
    .unwrap();

    assert!(
        anon_row.0.starts_with("anon_"),
        "user_id should start with anon_, got {}",
        anon_row.0
    );
    assert_ne!(anon_row.0, alice_id);
    assert_eq!(anon_row.1, username_token);
}

#[tokio::test]
async fn test_admin_key_transparency_endpoint_empty_log() {
    let (app, pool) = common::setup_test_app().await;

    // First user is owner
    let _owner_id = common::register_user(&app, "owner_user", "Password123!", None).await;
    let (status, login_res) = common::login_user(
        &app,
        "owner_user",
        "Password123!",
        "owner_device_client_1",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let owner_token = login_res["session_token"].as_str().unwrap();

    // Clear key_transparency_log to simulate empty log
    sqlx::query("DELETE FROM key_transparency_log")
        .execute(&pool)
        .await
        .unwrap();

    let req_empty = Request::builder()
        .method("GET")
        .uri("/api/v1/admin/key-transparency")
        .header(header::AUTHORIZATION, format!("Bearer {}", owner_token))
        .body(Body::empty())
        .unwrap();

    let resp_empty = app.clone().oneshot(req_empty).await.unwrap();

    assert_eq!(resp_empty.status(), StatusCode::OK);
    let body_empty: Value = serde_json::from_slice(
        &axum::body::to_bytes(resp_empty.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();

    assert_eq!(body_empty["enabled"], true);
    assert_eq!(body_empty["tree_size"], 0);
    assert!(body_empty["oldest_leaf_added_at"].is_null());
    assert!(body_empty["newest_leaf_added_at"].is_null());

    // Assert no leaf data leak in response keys
    let obj = body_empty.as_object().unwrap();
    assert!(!obj.contains_key("user_id"));
    assert!(!obj.contains_key("username_token"));
    assert!(!obj.contains_key("identity_pubkey"));
}

#[tokio::test]
async fn test_key_transparency_registration_transaction_rollback() {
    let (_app, pool) = common::setup_test_app().await;

    let count_before: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM key_transparency_log")
        .fetch_one(&pool)
        .await
        .unwrap();

    let mut tx = pool.begin().await.unwrap();

    sqlx::query(
        "INSERT INTO users (id, username_token, opaque_registration, identity_pubkey) VALUES ('rollback_user', 'rollback_token', X'00', '')",
    )
    .execute(&mut *tx)
    .await
    .unwrap();

    sqlx::query(
        "INSERT INTO key_transparency_log (user_id, username_token, identity_pubkey) VALUES ('rollback_user', 'rollback_token', '')",
    )
    .execute(&mut *tx)
    .await
    .unwrap();

    // Rollback explicitly
    tx.rollback().await.unwrap();

    let count_after: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM key_transparency_log")
        .fetch_one(&pool)
        .await
        .unwrap();

    assert_eq!(count_before, count_after);
}

#[tokio::test]
async fn test_admin_key_transparency_endpoint() {
    let (app, pool) = common::setup_test_app().await;

    let owner_id = common::register_user(&app, "owner_user", "Password123!", None).await;
    let (status, login_res) = common::login_user(
        &app,
        "owner_user",
        "Password123!",
        "owner_device_client_1",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let owner_token = login_res["session_token"].as_str().unwrap();

    // 1. Check log stats
    let req_empty = Request::builder()
        .method("GET")
        .uri("/api/v1/admin/key-transparency")
        .header(header::AUTHORIZATION, format!("Bearer {}", owner_token))
        .body(Body::empty())
        .unwrap();

    let resp_empty = app.clone().oneshot(req_empty).await.unwrap();

    assert_eq!(resp_empty.status(), StatusCode::OK);
    let body_empty: Value = serde_json::from_slice(
        &axum::body::to_bytes(resp_empty.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(body_empty["enabled"], true);
    assert_eq!(body_empty["tree_size"], 1);
    assert!(body_empty["oldest_leaf_added_at"].is_string());
    assert!(body_empty["newest_leaf_added_at"].is_string());

    // Assert no leaf data leak in response keys
    let obj = body_empty.as_object().unwrap();
    assert!(!obj.contains_key("user_id"));
    assert!(!obj.contains_key("username_token"));
    assert!(!obj.contains_key("identity_pubkey"));

    // 2. Auth checks
    let temp_dir = tempfile::tempdir().expect("Failed to create tempdir");
    let key_path = temp_dir.path().join("oprf.key");
    let config = server::Config {
        opaque_oprf_key_path: key_path.to_str().unwrap().to_string(),
        altcha_enabled: true,
        altcha_hmac_secret: "auto".to_string(),
        altcha_cost: 100,
        cleanup_enabled: true,
        cleanup_startup_delay_secs: 30,
        ..server::Config::test_default()
    };

    let invite = server::invites::create_invite(
        &pool,
        &owner_id,
        server::invites::CreateInviteOptions::default(),
        &config,
    )
    .await
    .unwrap();

    let _member_id =
        common::register_user(&app, "member_user", "Password123!", Some(&invite.code)).await;
    let (status_m, login_res_m) = common::login_user(
        &app,
        "member_user",
        "Password123!",
        "member_device_client_1",
        None,
    )
    .await;
    assert_eq!(status_m, StatusCode::OK);
    let member_token = login_res_m["session_token"].as_str().unwrap();

    let req_forbidden = Request::builder()
        .method("GET")
        .uri("/api/v1/admin/key-transparency")
        .header(header::AUTHORIZATION, format!("Bearer {}", member_token))
        .body(Body::empty())
        .unwrap();

    let resp_forbidden = app.clone().oneshot(req_forbidden).await.unwrap();
    assert_eq!(resp_forbidden.status(), StatusCode::FORBIDDEN);

    let req_unauth = Request::builder()
        .method("GET")
        .uri("/api/v1/admin/key-transparency")
        .body(Body::empty())
        .unwrap();

    let resp_unauth = app.clone().oneshot(req_unauth).await.unwrap();
    assert_eq!(resp_unauth.status(), StatusCode::UNAUTHORIZED);
}
