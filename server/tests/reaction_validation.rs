mod common;

use axum::http::StatusCode;
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use serde_json::{json, Value};
use tower::ServiceExt;

#[tokio::test]
async fn test_reaction_validation_and_limits() {
    let (app, pool) = common::setup_test_app().await;

    let user_id = common::register_user(&app, "react_val_user", "Password123!", None).await;
    let client_id = "val_client_123456789";
    let user_token = common::login_user(&app, "react_val_user", "Password123!", client_id, None)
        .await
        .1["session_token"]
        .as_str()
        .unwrap()
        .to_string();

    // Create room
    let req = axum::http::Request::builder()
        .method("POST")
        .uri("/api/v1/rooms")
        .header("Authorization", format!("Bearer {}", user_token))
        .header("Content-Type", "application/json")
        .body(axum::body::Body::from(json!({}).to_string()))
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    let body_bytes = axum::body::to_bytes(res.into_body(), usize::MAX)
        .await
        .unwrap();
    let room_body: Value = serde_json::from_slice(&body_bytes).unwrap();
    let room_id = room_body["id"].as_str().unwrap();

    // Submit message
    let ct = BASE64.encode(b"test message");
    let req = axum::http::Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/messages", room_id))
        .header("Authorization", format!("Bearer {}", user_token))
        .header("Content-Type", "application/json")
        .body(axum::body::Body::from(
            json!({
                "sender_client_id": client_id,
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
    let msg_body: Value = serde_json::from_slice(&body_bytes).unwrap();
    let msg_id = msg_body["message_id"].as_str().unwrap();

    // 1. Empty reaction returns 400 invalid_reaction
    let req = axum::http::Request::builder()
        .method("POST")
        .uri(format!(
            "/api/v1/rooms/{}/messages/{}/reactions",
            room_id, msg_id
        ))
        .header("Authorization", format!("Bearer {}", user_token))
        .header("Content-Type", "application/json")
        .body(axum::body::Body::from(
            json!({
                "reaction": "",
                "client_id": client_id
            })
            .to_string(),
        ))
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);

    // 2. Exceeding 64 chars returns 400
    let long_str = "a".repeat(65);
    let req = axum::http::Request::builder()
        .method("POST")
        .uri(format!(
            "/api/v1/rooms/{}/messages/{}/reactions",
            room_id, msg_id
        ))
        .header("Authorization", format!("Bearer {}", user_token))
        .header("Content-Type", "application/json")
        .body(axum::body::Body::from(
            json!({
                "reaction": long_str,
                "client_id": client_id
            })
            .to_string(),
        ))
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);

    // 3. Reaction containing control chars returns 400
    let req = axum::http::Request::builder()
        .method("POST")
        .uri(format!(
            "/api/v1/rooms/{}/messages/{}/reactions",
            room_id, msg_id
        ))
        .header("Authorization", format!("Bearer {}", user_token))
        .header("Content-Type", "application/json")
        .body(axum::body::Body::from(
            json!({
                "reaction": "hello\nworld",
                "client_id": client_id
            })
            .to_string(),
        ))
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);

    // 4. Unicode emoji with skin tone modifier & ZWJ sequence are accepted -> 201 Created
    let req = axum::http::Request::builder()
        .method("POST")
        .uri(format!(
            "/api/v1/rooms/{}/messages/{}/reactions",
            room_id, msg_id
        ))
        .header("Authorization", format!("Bearer {}", user_token))
        .header("Content-Type", "application/json")
        .body(axum::body::Body::from(
            json!({
                "reaction": "👍🏽",
                "sender_client_id": client_id
            })
            .to_string(),
        ))
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::CREATED);

    let req = axum::http::Request::builder()
        .method("POST")
        .uri(format!(
            "/api/v1/rooms/{}/messages/{}/reactions",
            room_id, msg_id
        ))
        .header("Authorization", format!("Bearer {}", user_token))
        .header("Content-Type", "application/json")
        .body(axum::body::Body::from(
            json!({
                "reaction": "👨‍👩‍👧‍👦",
                "sender_client_id": client_id
            })
            .to_string(),
        ))
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::CREATED);

    // 5. Instance limit per message enforced
    // Set reactions_per_message limit = 2
    sqlx::query(
        "INSERT INTO instance_limits (key, value, updated_at, updated_by) VALUES ('reactions_per_message', '2', CURRENT_TIMESTAMP, ?) ON CONFLICT(key) DO UPDATE SET value = '2'"
    )
    .bind(&user_id)
    .execute(&pool)
    .await
    .unwrap();

    // The message currently has 2 reactions ("👍🏽", "👨‍👩‍👧‍👦"). Attempting a 3rd should return 409 reaction_limit_reached
    let req = axum::http::Request::builder()
        .method("POST")
        .uri(format!(
            "/api/v1/rooms/{}/messages/{}/reactions",
            room_id, msg_id
        ))
        .header("Authorization", format!("Bearer {}", user_token))
        .header("Content-Type", "application/json")
        .body(axum::body::Body::from(
            json!({
                "reaction": "🎉",
                "client_id": client_id
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
    assert_eq!(err_body["error"], "reaction_limit_reached");
}

#[tokio::test]
async fn test_reaction_add_rate_limit_exceeded() {
    let (app, _pool) = common::setup_test_app().await;

    let _user_id = common::register_user(&app, "react_rl_user", "Password123!", None).await;
    let client_id = "rl_client_123456789";
    let user_token = common::login_user(&app, "react_rl_user", "Password123!", client_id, None)
        .await
        .1["session_token"]
        .as_str()
        .unwrap()
        .to_string();

    // Create room
    let req = axum::http::Request::builder()
        .method("POST")
        .uri("/api/v1/rooms")
        .header("Authorization", format!("Bearer {}", user_token))
        .header("Content-Type", "application/json")
        .body(axum::body::Body::from(json!({}).to_string()))
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    let body_bytes = axum::body::to_bytes(res.into_body(), usize::MAX)
        .await
        .unwrap();
    let room_id = serde_json::from_slice::<Value>(&body_bytes).unwrap()["id"]
        .as_str()
        .unwrap()
        .to_string();

    // Submit message
    let ct = BASE64.encode(b"test message for rate limit");
    let req = axum::http::Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/messages", room_id))
        .header("Authorization", format!("Bearer {}", user_token))
        .header("Content-Type", "application/json")
        .body(axum::body::Body::from(
            json!({
                "sender_client_id": client_id,
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
    let msg_id = serde_json::from_slice::<Value>(&body_bytes).unwrap()["message_id"]
        .as_str()
        .unwrap()
        .to_string();

    // Submit second message so per-message reaction limit (50) is not exceeded
    let req = axum::http::Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/messages", room_id))
        .header("Authorization", format!("Bearer {}", user_token))
        .header("Content-Type", "application/json")
        .body(axum::body::Body::from(
            json!({
                "sender_client_id": client_id,
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
    let msg_id_2 = serde_json::from_slice::<Value>(&body_bytes).unwrap()["message_id"]
        .as_str()
        .unwrap()
        .to_string();

    // Fire 60 reaction adds across both messages (30 on msg_id, 30 on msg_id_2) (RATE_REACTION_PER_MIN = 60)
    for i in 0..60 {
        let target_msg = if i < 30 { &msg_id } else { &msg_id_2 };
        let req = axum::http::Request::builder()
            .method("POST")
            .uri(format!(
                "/api/v1/rooms/{}/messages/{}/reactions",
                room_id, target_msg
            ))
            .header("Authorization", format!("Bearer {}", user_token))
            .header("Content-Type", "application/json")
            .body(axum::body::Body::from(
                json!({
                    "reaction": format!("emoji_{}", i),
                    "sender_client_id": client_id
                })
                .to_string(),
            ))
            .unwrap();
        let res = app.clone().oneshot(req).await.unwrap();
        assert_ne!(
            res.status(),
            StatusCode::TOO_MANY_REQUESTS,
            "Request {} within 60 limit should be allowed",
            i + 1
        );
    }

    // 61st add within the same minute should be rate limited (429 Too Many Requests)
    let req = axum::http::Request::builder()
        .method("POST")
        .uri(format!(
            "/api/v1/rooms/{}/messages/{}/reactions",
            room_id, msg_id
        ))
        .header("Authorization", format!("Bearer {}", user_token))
        .header("Content-Type", "application/json")
        .body(axum::body::Body::from(
            json!({
                "reaction": "emoji_overflow",
                "sender_client_id": client_id
            })
            .to_string(),
        ))
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::TOO_MANY_REQUESTS);
}
