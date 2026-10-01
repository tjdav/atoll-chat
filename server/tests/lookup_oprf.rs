mod common;

use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use common::{login_user, obtain_username_token, register_user, setup_test_app};
use serde_json::{json, Value};
use tower::ServiceExt;

const TEST_CLIENT_ID: &str = "client_id_123456789";

#[tokio::test]
async fn test_lookup_user() {
    let (app, pool) = setup_test_app().await;

    let user_id = register_user(&app, "alice", "password123", None).await;
    let (_, login_body) = login_user(&app, "alice", "password123", TEST_CLIENT_ID, None).await;
    let session_token = login_body["session_token"].as_str().unwrap();

    let token = obtain_username_token(&app, "alice").await;

    // Lookup existing user
    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/users/lookup")
        .header(header::AUTHORIZATION, format!("Bearer {}", session_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "username_token": token }).to_string()))
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body_bytes).unwrap();

    assert_eq!(json["user_id"], user_id);
    assert!(json.get("encrypted_display").is_some());

    // Lookup non-existent user token (valid OPRF token format for "bob" who is not registered) -> 404
    let unk_token = obtain_username_token(&app, "bob").await;
    let req_unk = Request::builder()
        .method("POST")
        .uri("/api/v1/users/lookup")
        .header(header::AUTHORIZATION, format!("Bearer {}", session_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({ "username_token": unk_token }).to_string(),
        ))
        .unwrap();

    let resp_unk = app.clone().oneshot(req_unk).await.unwrap();
    assert_eq!(resp_unk.status(), StatusCode::NOT_FOUND);

    // Lookup deleted user -> 404
    sqlx::query("UPDATE users SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?")
        .bind(&user_id)
        .execute(&pool)
        .await
        .unwrap();

    let req_del = Request::builder()
        .method("POST")
        .uri("/api/v1/users/lookup")
        .header(header::AUTHORIZATION, format!("Bearer {}", session_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "username_token": token }).to_string()))
        .unwrap();

    let resp_del = app.clone().oneshot(req_del).await.unwrap();
    assert_eq!(resp_del.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn test_malformed_lookup_token_returns_400() {
    let (app, _pool) = setup_test_app().await;

    register_user(&app, "alice", "password123", None).await;
    let (_, login_body) = login_user(&app, "alice", "password123", TEST_CLIENT_ID, None).await;
    let session_token = login_body["session_token"].as_str().unwrap();

    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/users/lookup")
        .header(header::AUTHORIZATION, format!("Bearer {}", session_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "username_token": "short" }).to_string()))
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);

    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(json["error"], "invalid_username_token");
}
