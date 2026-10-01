mod common;

use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use common::{login_user, register_user, setup_test_app};
use serde_json::{json, Value};
use tower::ServiceExt;

#[tokio::test]
async fn test_sync_channel_auth() {
    let (app, pool) = setup_test_app().await;

    let user_a_id = register_user(&app, "authuser_a", "Password123!", None).await;
    let (status, login_a) = login_user(
        &app,
        "authuser_a",
        "Password123!",
        "client_auth_a_123456",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let token_a = login_a["session_token"].as_str().unwrap();

    // Create invite for User B
    sqlx::query(
        "INSERT INTO server_invites (id, code, max_uses, current_uses) VALUES ('inv_auth_b', 'INVITEAUTHB1', 1, 0)",
    )
    .execute(&pool)
    .await
    .unwrap();

    let user_b_id = register_user(&app, "authuser_b", "Password123!", Some("INVITEAUTHB1")).await;
    let (status, login_b) = login_user(
        &app,
        "authuser_b",
        "Password123!",
        "client_auth_b_123456",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let token_b = login_b["session_token"].as_str().unwrap();

    // 1. User A can subscribe to their own user channel
    let auth_req = json!({
        "socket_id": "1234.5678",
        "channel_name": format!("private-user-{}", user_a_id)
    });

    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/sockudo/auth")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(auth_req.to_string()))
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let body: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert!(body["auth"].is_string());
    let auth_str = body["auth"].as_str().unwrap();
    assert!(auth_str.contains(':'));

    // 2. User A cannot subscribe to User B's channel
    let auth_req_b = json!({
        "socket_id": "1234.5678",
        "channel_name": format!("private-user-{}", user_b_id)
    });

    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/sockudo/auth")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(auth_req_b.to_string()))
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);
    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let body: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(body["error"], "forbidden");

    // 4. Invalid channel name returns 400
    let invalid_channel_req = json!({
        "socket_id": "1234.5678",
        "channel_name": "private-foo-xyz"
    });

    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/sockudo/auth")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(invalid_channel_req.to_string()))
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let body: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(body["error"], "invalid_channel_name");

    // Empty user id suffix returns 400
    let empty_user_req = json!({
        "socket_id": "1234.5678",
        "channel_name": "private-user-"
    });

    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/sockudo/auth")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(empty_user_req.to_string()))
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let body: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(body["error"], "invalid_channel_name");

    // 3. Room channel auth is unchanged
    // Create room for user A
    let create_room_req = json!({
        "name": "Sync Test Room"
    });

    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(create_room_req.to_string()))
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED);
    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let room_body: Value = serde_json::from_slice(&body_bytes).unwrap();
    let room_id = room_body["id"].as_str().unwrap();

    // User A can auth for private-room-{room_id}
    let room_auth_req = json!({
        "socket_id": "1234.5678",
        "channel_name": format!("private-room-{}", room_id)
    });

    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/sockudo/auth")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(room_auth_req.to_string()))
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    // User B cannot auth for private-room-{room_id} since they aren't a member
    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/sockudo/auth")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_b))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(room_auth_req.to_string()))
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);
}
