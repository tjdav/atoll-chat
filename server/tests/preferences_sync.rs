mod common;

use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use serde_json::{json, Value};
use tower::ServiceExt;

#[tokio::test]
async fn test_preference_sync_integration() {
    let (app, pool) = common::setup_test_app().await;

    // Register User A
    common::register_user(&app, "alice", "Password123!", None).await;
    let (_, login_a) =
        common::login_user(&app, "alice", "Password123!", "client_device1_123456", None).await;
    let token_a = login_a["session_token"].as_str().unwrap();

    // Create invite for User B
    sqlx::query(
        "INSERT INTO server_invites (id, code, max_uses, current_uses) VALUES ('inv_sync_b', 'INVITESYNCB123', 1, 0)",
    )
    .execute(&pool)
    .await
    .unwrap();

    // Register User B
    common::register_user(&app, "bob", "Password123!", Some("INVITESYNCB123")).await;
    let (_, login_b) =
        common::login_user(&app, "bob", "Password123!", "client_device2_123456", None).await;
    let token_b = login_b["session_token"].as_str().unwrap();

    // 1. Initial sync is empty
    let req = Request::builder()
        .method("GET")
        .uri("/api/v1/users/me/sync?since_seq=0")
        .header(header::AUTHORIZATION, format!("Bearer {token_a}"))
        .body(Body::empty())
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let sync_res: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(sync_res["user_preferences"], json!([]));
    assert_eq!(sync_res["max_seq"], 1);

    let dark_b64 = URL_SAFE_NO_PAD.encode(b"dark");
    let sound_b64 = URL_SAFE_NO_PAD.encode(b"sound");

    // 2. User A writes two preferences
    let req = Request::builder()
        .method("PATCH")
        .uri("/api/v1/users/me/preferences/theme")
        .header(header::AUTHORIZATION, format!("Bearer {token_a}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "value": dark_b64 }).to_string()))
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let req = Request::builder()
        .method("PATCH")
        .uri("/api/v1/users/me/preferences/notifications:sound")
        .header(header::AUTHORIZATION, format!("Bearer {token_a}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "value": sound_b64 }).to_string()))
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    // 3. Sync since_seq=0 returns both preferences
    let req = Request::builder()
        .method("GET")
        .uri("/api/v1/users/me/sync?since_seq=0")
        .header(header::AUTHORIZATION, format!("Bearer {token_a}"))
        .body(Body::empty())
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let sync_res: Value = serde_json::from_slice(&body_bytes).unwrap();

    let prefs = sync_res["user_preferences"].as_array().unwrap();
    assert_eq!(prefs.len(), 2);
    assert_eq!(prefs[0]["key"], "theme");
    assert_eq!(prefs[0]["value"], dark_b64);
    assert_eq!(prefs[0]["user_seq"], 2);

    assert_eq!(prefs[1]["key"], "notifications:sound");
    assert_eq!(prefs[1]["value"], sound_b64);
    assert_eq!(prefs[1]["user_seq"], 3);

    assert_eq!(sync_res["max_seq"], 3);

    // 4. Delta sync (since_seq=2) returns only the second preference
    let req = Request::builder()
        .method("GET")
        .uri("/api/v1/users/me/sync?since_seq=2")
        .header(header::AUTHORIZATION, format!("Bearer {token_a}"))
        .body(Body::empty())
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let sync_res: Value = serde_json::from_slice(&body_bytes).unwrap();

    let prefs = sync_res["user_preferences"].as_array().unwrap();
    assert_eq!(prefs.len(), 1);
    assert_eq!(prefs[0]["key"], "notifications:sound");
    assert_eq!(sync_res["max_seq"], 3);

    // 5. Delete "theme" preference (allocates user_seq 3)
    let req = Request::builder()
        .method("DELETE")
        .uri("/api/v1/users/me/preferences/theme")
        .header(header::AUTHORIZATION, format!("Bearer {token_a}"))
        .body(Body::empty())
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::NO_CONTENT);

    // Full sync (since_seq=0) excludes deleted preference
    let req = Request::builder()
        .method("GET")
        .uri("/api/v1/users/me/sync?since_seq=0")
        .header(header::AUTHORIZATION, format!("Bearer {token_a}"))
        .body(Body::empty())
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let sync_res: Value = serde_json::from_slice(&body_bytes).unwrap();

    let prefs = sync_res["user_preferences"].as_array().unwrap();
    assert_eq!(prefs.len(), 1);
    assert_eq!(prefs[0]["key"], "notifications:sound");

    // 6. User B sync is isolated and remains empty
    let req = Request::builder()
        .method("GET")
        .uri("/api/v1/users/me/sync?since_seq=0")
        .header(header::AUTHORIZATION, format!("Bearer {token_b}"))
        .body(Body::empty())
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let sync_res: Value = serde_json::from_slice(&body_bytes).unwrap();

    assert_eq!(sync_res["user_preferences"], json!([]));
    assert_eq!(sync_res["max_seq"], 1);
}
