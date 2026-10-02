mod common;

use axum::http::StatusCode;
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
async fn test_reaction_list_and_aggregation() {
    let (app, pool) = common::setup_test_app().await;

    let c1 = "client_1_123456789";
    let c2 = "client_2_123456789";

    let (_u1_id, u1_token) = create_test_user(&app, &pool, "react_list_u1", c1).await;
    let (u2_id, u2_token) = create_test_user(&app, &pool, "react_list_u2", c2).await;

    // Create room & add user2
    let req = axum::http::Request::builder()
        .method("POST")
        .uri("/api/v1/rooms")
        .header("Authorization", format!("Bearer {}", u1_token))
        .header("Content-Type", "application/json")
        .body(axum::body::Body::from(json!({}).to_string()))
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    let body_bytes = axum::body::to_bytes(res.into_body(), usize::MAX)
        .await
        .unwrap();
    let room_body: Value = serde_json::from_slice(&body_bytes).unwrap();
    let room_id = room_body["id"].as_str().unwrap();

    let req = axum::http::Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/members", room_id))
        .header("Authorization", format!("Bearer {}", u1_token))
        .header("Content-Type", "application/json")
        .body(axum::body::Body::from(
            json!({ "user_id": u2_id }).to_string(),
        ))
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::CREATED);

    // Submit message 1
    let ct = BASE64.encode(b"message 1");
    let req = axum::http::Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/messages", room_id))
        .header("Authorization", format!("Bearer {}", u1_token))
        .header("Content-Type", "application/json")
        .body(axum::body::Body::from(
            json!({
                "sender_client_id": c1,
                "epoch": 0,
                "content_type": "application",
                "ciphertext": ct,
            })
            .to_string(),
        ))
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    let body_bytes = axum::body::to_bytes(res.into_body(), usize::MAX)
        .await
        .unwrap();
    let msg1_body: Value = serde_json::from_slice(&body_bytes).unwrap();
    let msg1_id = msg1_body["message_id"].as_str().unwrap();

    // User1 reacts with 👍 and ❤️
    let req = axum::http::Request::builder()
        .method("POST")
        .uri(format!(
            "/api/v1/rooms/{}/messages/{}/reactions",
            room_id, msg1_id
        ))
        .header("Authorization", format!("Bearer {}", u1_token))
        .header("Content-Type", "application/json")
        .body(axum::body::Body::from(
            json!({ "reaction": "👍", "client_id": c1 }).to_string(),
        ))
        .unwrap();
    let _ = app.clone().oneshot(req).await;

    let req = axum::http::Request::builder()
        .method("POST")
        .uri(format!(
            "/api/v1/rooms/{}/messages/{}/reactions",
            room_id, msg1_id
        ))
        .header("Authorization", format!("Bearer {}", u1_token))
        .header("Content-Type", "application/json")
        .body(axum::body::Body::from(
            json!({ "reaction": "❤️", "client_id": c1 }).to_string(),
        ))
        .unwrap();
    let _ = app.clone().oneshot(req).await;

    // User2 reacts with 👍
    let req = axum::http::Request::builder()
        .method("POST")
        .uri(format!(
            "/api/v1/rooms/{}/messages/{}/reactions",
            room_id, msg1_id
        ))
        .header("Authorization", format!("Bearer {}", u2_token))
        .header("Content-Type", "application/json")
        .body(axum::body::Body::from(
            json!({ "reaction": "👍", "client_id": c2 }).to_string(),
        ))
        .unwrap();
    let _ = app.clone().oneshot(req).await;

    // 1. GET reactions for single message from user1's perspective
    let req = axum::http::Request::builder()
        .method("GET")
        .uri(format!(
            "/api/v1/rooms/{}/messages/{}/reactions",
            room_id, msg1_id
        ))
        .header("Authorization", format!("Bearer {}", u1_token))
        .body(axum::body::Body::empty())
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let body_bytes = axum::body::to_bytes(res.into_body(), usize::MAX)
        .await
        .unwrap();
    let list_body: Value = serde_json::from_slice(&body_bytes).unwrap();
    let reactions = list_body["reactions"].as_array().unwrap();
    assert_eq!(reactions.len(), 2);
    // Highest count first: 👍 has 2, ❤️ has 1
    assert_eq!(reactions[0]["reaction"], "👍");
    assert_eq!(reactions[0]["count"], 2);
    assert_eq!(reactions[0]["reacted_by_me"], true);

    assert_eq!(reactions[1]["reaction"], "❤️");
    assert_eq!(reactions[1]["count"], 1);
    assert_eq!(reactions[1]["reacted_by_me"], true);

    // 2. GET reactions for single message from user2's perspective
    let req = axum::http::Request::builder()
        .method("GET")
        .uri(format!(
            "/api/v1/rooms/{}/messages/{}/reactions",
            room_id, msg1_id
        ))
        .header("Authorization", format!("Bearer {}", u2_token))
        .body(axum::body::Body::empty())
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let body_bytes = axum::body::to_bytes(res.into_body(), usize::MAX)
        .await
        .unwrap();
    let list_body2: Value = serde_json::from_slice(&body_bytes).unwrap();
    let reactions2 = list_body2["reactions"].as_array().unwrap();
    assert_eq!(reactions2[0]["reaction"], "👍");
    assert_eq!(reactions2[0]["reacted_by_me"], true);
    assert_eq!(reactions2[1]["reaction"], "❤️");
    assert_eq!(reactions2[1]["reacted_by_me"], false);

    // 3. GET /rooms/:id/messages includes reactions per message
    let req = axum::http::Request::builder()
        .method("GET")
        .uri(format!("/api/v1/rooms/{}/messages", room_id))
        .header("Authorization", format!("Bearer {}", u1_token))
        .body(axum::body::Body::empty())
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let body_bytes = axum::body::to_bytes(res.into_body(), usize::MAX)
        .await
        .unwrap();
    let msgs_res: Value = serde_json::from_slice(&body_bytes).unwrap();
    let messages = msgs_res["messages"].as_array().unwrap();
    assert_eq!(messages.len(), 1);
    let msg_reactions = messages[0]["reactions"].as_array().unwrap();
    assert_eq!(msg_reactions.len(), 2);
    assert_eq!(msg_reactions[0]["reaction"], "👍");
    assert_eq!(msg_reactions[0]["count"], 2);
}
