mod common;

use axum::http::{header, StatusCode};
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use serde_json::{json, Value};
use sqlx::SqlitePool;
use tower::ServiceExt;

async fn create_test_user(
    app: &axum::Router,
    pool: &SqlitePool,
    username: &str,
    client_id: &str,
) -> (String, String) {
    let has_users: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM users)")
        .fetch_one(pool)
        .await
        .unwrap();

    let invite_code = if has_users {
        let code = format!("INV_{}", username);
        sqlx::query(
            "INSERT INTO server_invites (id, code, max_uses, current_uses) VALUES (?, ?, 10, 0)",
        )
        .bind(format!("inv_id_{}", username))
        .bind(&code)
        .execute(pool)
        .await
        .unwrap();
        Some(code)
    } else {
        None
    };

    let user_id =
        common::register_user(app, username, "Password123!", invite_code.as_deref()).await;
    let (status, login_res) =
        common::login_user(app, username, "Password123!", client_id, None).await;
    if status != StatusCode::OK {
        panic!(
            "login_user failed for {}: status={}, res={:?}",
            username, status, login_res
        );
    }
    let token = login_res["session_token"].as_str().unwrap().to_string();

    (user_id, token)
}

#[tokio::test]
async fn test_reaction_write_flow() {
    let (app, pool) = common::setup_test_app().await;

    let owner_client_id = "owner_client_1234567";
    let user2_client_id = "user2_client_1234567";

    // 1. Register owner & user2
    let (_owner_id, owner_token) =
        create_test_user(&app, &pool, "react_owner", owner_client_id).await;
    let (user2_id, user2_token) =
        create_test_user(&app, &pool, "react_user2", user2_client_id).await;

    // Create room via router call or direct helper
    let req = axum::http::Request::builder()
        .method("POST")
        .uri("/api/v1/rooms")
        .header("Authorization", format!("Bearer {}", owner_token))
        .header("Content-Type", "application/json")
        .body(axum::body::Body::from(json!({}).to_string()))
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::CREATED);
    let body_bytes = axum::body::to_bytes(res.into_body(), usize::MAX)
        .await
        .unwrap();
    let room_body: Value = serde_json::from_slice(&body_bytes).unwrap();
    let room_id = room_body["id"].as_str().unwrap();

    // Add user2 to room
    let req = axum::http::Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/members", room_id))
        .header("Authorization", format!("Bearer {}", owner_token))
        .header("Content-Type", "application/json")
        .body(axum::body::Body::from(
            json!({ "user_id": user2_id }).to_string(),
        ))
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::CREATED);

    // 3. Submit message in room
    let ct = BASE64.encode(b"hello world");
    let req = axum::http::Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/messages", room_id))
        .header("Authorization", format!("Bearer {}", owner_token))
        .header("Content-Type", "application/json")
        .body(axum::body::Body::from(
            json!({
                "sender_client_id": owner_client_id,
                "epoch": 0,
                "content_type": "application",
                "ciphertext": ct,
            })
            .to_string(),
        ))
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::CREATED);
    let body_bytes = axum::body::to_bytes(res.into_body(), usize::MAX)
        .await
        .unwrap();
    let msg_body: Value = serde_json::from_slice(&body_bytes).unwrap();
    let msg_id = msg_body["message_id"].as_str().unwrap();

    // 4. Add reaction by owner
    let req = axum::http::Request::builder()
        .method("POST")
        .uri(format!(
            "/api/v1/rooms/{}/messages/{}/reactions",
            room_id, msg_id
        ))
        .header("Authorization", format!("Bearer {}", owner_token))
        .header("Content-Type", "application/json")
        .body(axum::body::Body::from(
            json!({
                "reaction": "👍",
                "client_id": owner_client_id
            })
            .to_string(),
        ))
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    assert_eq!(
        res.headers().get(header::CACHE_CONTROL).unwrap(),
        "no-store"
    );
    let body_bytes = axum::body::to_bytes(res.into_body(), usize::MAX)
        .await
        .unwrap();
    let add_body: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(add_body["message_id"], msg_id);
    assert_eq!(add_body["reaction"], "👍");

    // 5. Add duplicate reaction by same user & client returns 409 already_reacted
    let req = axum::http::Request::builder()
        .method("POST")
        .uri(format!(
            "/api/v1/rooms/{}/messages/{}/reactions",
            room_id, msg_id
        ))
        .header("Authorization", format!("Bearer {}", owner_token))
        .header("Content-Type", "application/json")
        .body(axum::body::Body::from(
            json!({
                "reaction": "👍",
                "client_id": owner_client_id
            })
            .to_string(),
        ))
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::CONFLICT);
    let body_bytes = axum::body::to_bytes(res.into_body(), usize::MAX)
        .await
        .unwrap();
    let err_body: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(err_body["error"], "already_reacted");

    // 6. Two different reactions from same client succeed
    let req = axum::http::Request::builder()
        .method("POST")
        .uri(format!(
            "/api/v1/rooms/{}/messages/{}/reactions",
            room_id, msg_id
        ))
        .header("Authorization", format!("Bearer {}", owner_token))
        .header("Content-Type", "application/json")
        .body(axum::body::Body::from(
            json!({
                "reaction": "❤️",
                "client_id": owner_client_id
            })
            .to_string(),
        ))
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);

    // 7. Remove reaction (soft-delete)
    let req = axum::http::Request::builder()
        .method("DELETE")
        .uri(format!(
            "/api/v1/rooms/{}/messages/{}/reactions/%F0%9F%91%8D?client_id={}",
            room_id, msg_id, owner_client_id
        ))
        .header("Authorization", format!("Bearer {}", owner_token))
        .body(axum::body::Body::empty())
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::NO_CONTENT);
    assert_eq!(
        res.headers().get(header::CACHE_CONTROL).unwrap(),
        "no-store"
    );

    // 8. Subsequent add reactivates row
    let req = axum::http::Request::builder()
        .method("POST")
        .uri(format!(
            "/api/v1/rooms/{}/messages/{}/reactions",
            room_id, msg_id
        ))
        .header("Authorization", format!("Bearer {}", owner_token))
        .header("Content-Type", "application/json")
        .body(axum::body::Body::from(
            json!({
                "reaction": "👍",
                "client_id": owner_client_id
            })
            .to_string(),
        ))
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);

    // 9. Non-member cannot add (HTTP 404 room_not_found)
    let (_non_member_id, non_member_token) =
        create_test_user(&app, &pool, "react_non_member", "nm_client_12345678").await;

    let req = axum::http::Request::builder()
        .method("POST")
        .uri(format!(
            "/api/v1/rooms/{}/messages/{}/reactions",
            room_id, msg_id
        ))
        .header("Authorization", format!("Bearer {}", non_member_token))
        .header("Content-Type", "application/json")
        .body(axum::body::Body::from(
            json!({
                "reaction": "👍",
                "client_id": "nm_client_12345678"
            })
            .to_string(),
        ))
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::NOT_FOUND);

    // 10. Unknown message returns 404 message_not_found
    let req = axum::http::Request::builder()
        .method("POST")
        .uri(format!(
            "/api/v1/rooms/{}/messages/nonexistent_msg/reactions",
            room_id
        ))
        .header("Authorization", format!("Bearer {}", owner_token))
        .header("Content-Type", "application/json")
        .body(axum::body::Body::from(
            json!({
                "reaction": "👍",
                "client_id": owner_client_id
            })
            .to_string(),
        ))
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::NOT_FOUND);

    // 11. Remove non-existent reaction returns 404 reaction_not_found
    let req = axum::http::Request::builder()
        .method("DELETE")
        .uri(format!(
            "/api/v1/rooms/{}/messages/{}/reactions/🚀?client_id={}",
            room_id, msg_id, owner_client_id
        ))
        .header("Authorization", format!("Bearer {}", owner_token))
        .body(axum::body::Body::empty())
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::NOT_FOUND);

    // 12. Remove another user's reaction returns 404
    let req = axum::http::Request::builder()
        .method("DELETE")
        .uri(format!(
            "/api/v1/rooms/{}/messages/{}/reactions/👍?client_id={}",
            room_id, msg_id, owner_client_id
        ))
        .header("Authorization", format!("Bearer {}", user2_token))
        .body(axum::body::Body::empty())
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::NOT_FOUND);
}
