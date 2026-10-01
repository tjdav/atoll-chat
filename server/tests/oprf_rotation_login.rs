mod common;

use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use common::{login_user, register_user, setup_test_app};
use serde_json::Value;
use tower::ServiceExt;

#[tokio::test]
async fn test_flagged_user_cannot_login() {
    let (app, pool) = setup_test_app().await;

    let user_id = register_user(&app, "alice_flagged", "Password123!", None).await;

    // Flag user via SQL
    sqlx::query("UPDATE users SET requires_reregistration = 1 WHERE id = ?")
        .bind(&user_id)
        .execute(&pool)
        .await
        .unwrap();

    let (status, login_val) = login_user(
        &app,
        "alice_flagged",
        "Password123!",
        "client_device_12345",
        None,
    )
    .await;

    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(login_val["error"], "reregistration_required");
    assert!(login_val["details"]["message"]
        .as_str()
        .unwrap_or("")
        .contains("re-register"));
}

#[tokio::test]
async fn test_unflagged_user_logs_in_normally() {
    let (app, _) = setup_test_app().await;

    let _user_id = register_user(&app, "alice_unflagged", "Password123!", None).await;

    let (status, login_val) = login_user(
        &app,
        "alice_unflagged",
        "Password123!",
        "client_device_12345",
        None,
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert!(login_val["session_token"].is_string());
}

#[tokio::test]
async fn test_flag_checked_after_user_lookup() {
    let (app, _) = setup_test_app().await;

    let (status, login_val) = login_user(
        &app,
        "unknown_user_nonexistent",
        "Password123!",
        "client_device_12345",
        None,
    )
    .await;

    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(login_val["error"], "invalid_credentials");
}

#[tokio::test]
async fn test_disabled_user_takes_precedence_over_flagged() {
    let (app, pool) = setup_test_app().await;

    let user_id = register_user(&app, "alice_dis_flag", "Password123!", None).await;

    sqlx::query("UPDATE users SET disabled_at = CURRENT_TIMESTAMP, requires_reregistration = 1 WHERE id = ?")
        .bind(&user_id)
        .execute(&pool)
        .await
        .unwrap();

    let (status, login_val) = login_user(
        &app,
        "alice_dis_flag",
        "Password123!",
        "client_device_12345",
        None,
    )
    .await;

    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(login_val["error"], "account_disabled");
}

#[tokio::test]
async fn test_deleted_user_takes_precedence_over_flagged() {
    let (app, pool) = setup_test_app().await;

    let user_id = register_user(&app, "alice_del_flag", "Password123!", None).await;

    sqlx::query(
        "UPDATE users SET deleted_at = CURRENT_TIMESTAMP, requires_reregistration = 1 WHERE id = ?",
    )
    .bind(&user_id)
    .execute(&pool)
    .await
    .unwrap();

    let (status, login_val) = login_user(
        &app,
        "alice_del_flag",
        "Password123!",
        "client_device_12345",
        None,
    )
    .await;

    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(login_val["error"], "invalid_credentials");
}

#[tokio::test]
async fn test_existing_sessions_survive_rotation() {
    let (app, pool) = setup_test_app().await;

    let _user_id = register_user(&app, "alice_sess_survive", "Password123!", None).await;

    let (status, login_val) = login_user(
        &app,
        "alice_sess_survive",
        "Password123!",
        "client_device_12345",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let session_token = login_val["session_token"].as_str().unwrap();

    let temp_dir = std::env::temp_dir().join(format!("test_oprf_sess_{}", ulid::Ulid::new()));
    std::fs::create_dir_all(&temp_dir).unwrap();
    let key_path = temp_dir.join("oprf.key");
    let _server = server::OpaqueServer::load_or_generate(&key_path).unwrap();

    // Rotate key directly
    let config = server::Config {
        opaque_oprf_key_path: key_path.to_str().unwrap().to_string(),
        ..server::Config::test_default()
    };
    let _outcome = server::oprf::rotation::rotate_oprf_key(&pool, &config)
        .await
        .unwrap();

    // Existing session remains valid
    let req = Request::builder()
        .method("GET")
        .uri("/api/v1/users/me")
        .header(header::AUTHORIZATION, format!("Bearer {}", session_token))
        .body(Body::empty())
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let me_val: Value = serde_json::from_slice(&bytes).unwrap();
    assert!(me_val["id"].is_string());
}
