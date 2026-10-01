mod common;

use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use common::{login_user, obtain_username_token, register_user, setup_test_app};
use serde_json::{json, Value};
use tower::ServiceExt;

const TEST_CLIENT_ID: &str = "client_id_123456789";

#[tokio::test]
async fn test_successful_login() {
    let (app, _pool) = setup_test_app().await;

    let user_id = register_user(&app, "alice", "password123", None).await;

    let (status, body) = login_user(&app, "alice", "password123", TEST_CLIENT_ID, None).await;
    assert_eq!(status, StatusCode::OK);

    assert_eq!(body["user_id"], user_id);
    assert!(body["username_token"].is_string());
    assert!(body.get("session_token").is_some());
    assert!(body.get("expires_at").is_some());
}

#[tokio::test]
async fn test_wrong_password_and_unknown_token_same_error() {
    let (app, _pool) = setup_test_app().await;

    register_user(&app, "alice", "password123", None).await;

    // Wrong password
    let (status_wrong, body_wrong) =
        login_user(&app, "alice", "wrong_password", TEST_CLIENT_ID, None).await;
    assert_eq!(status_wrong, StatusCode::UNAUTHORIZED);
    assert_eq!(body_wrong["error"], "invalid_credentials");

    // Unknown token
    let (status_unk, body_unk) =
        login_user(&app, "unknown_user", "password123", TEST_CLIENT_ID, None).await;
    assert_eq!(status_unk, StatusCode::UNAUTHORIZED);
    assert_eq!(body_unk["error"], "invalid_credentials");
}

#[tokio::test]
async fn test_disabled_account_login() {
    let (app, pool) = setup_test_app().await;

    let user_id = register_user(&app, "alice", "password123", None).await;

    sqlx::query("UPDATE users SET disabled_at = CURRENT_TIMESTAMP WHERE id = ?")
        .bind(&user_id)
        .execute(&pool)
        .await
        .unwrap();

    let (status, body) = login_user(&app, "alice", "password123", TEST_CLIENT_ID, None).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(body["error"], "account_disabled");
}

#[tokio::test]
async fn test_deleted_account_login() {
    let (app, pool) = setup_test_app().await;

    let user_id = register_user(&app, "alice", "password123", None).await;

    sqlx::query("UPDATE users SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?")
        .bind(&user_id)
        .execute(&pool)
        .await
        .unwrap();

    let (status, body) = login_user(&app, "alice", "password123", TEST_CLIENT_ID, None).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(body["error"], "invalid_credentials");
}

#[tokio::test]
async fn test_requires_reregistration_login() {
    let (app, pool) = setup_test_app().await;

    let user_id = register_user(&app, "alice", "password123", None).await;

    sqlx::query("UPDATE users SET requires_reregistration = 1 WHERE id = ?")
        .bind(&user_id)
        .execute(&pool)
        .await
        .unwrap();

    let token = obtain_username_token(&app, "alice").await;

    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/auth/login/start")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "username_token": token,
                "credential_request": STANDARD.encode([0u8; 32]),
                "client_id": TEST_CLIENT_ID,
            })
            .to_string(),
        ))
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::CONFLICT);

    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(json["error"], "reregistration_required");
}
