mod common;

use axum::http::StatusCode;
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use serde_json::{json, Value};
use tower::ServiceExt;

#[tokio::test]
async fn test_reaction_events_and_audit() {
    let (app, pool) = common::setup_test_app().await;

    let _user_id = common::register_user(&app, "react_evt_user", "Password123!", None).await;
    let client_id = "evt_client_123456789";
    let (status, login_res) =
        common::login_user(&app, "react_evt_user", "Password123!", client_id, None).await;
    assert_eq!(status, StatusCode::OK);
    let user_token = login_res["session_token"].as_str().unwrap().to_string();

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
    let ct = BASE64.encode(b"message for reaction events");
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

    // 1. Add reaction
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
    assert_eq!(res.status(), StatusCode::OK);

    // Verify reaction.create audit log
    let audit_rows = sqlx::query(
        "SELECT action, target_type, metadata FROM audit_log WHERE action = 'reaction.create'",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(audit_rows.len(), 1);

    // 2. Remove reaction
    let req = axum::http::Request::builder()
        .method("DELETE")
        .uri(format!(
            "/api/v1/rooms/{}/messages/{}/reactions/%F0%9F%8E%89?client_id={}",
            room_id, msg_id, client_id
        ))
        .header("Authorization", format!("Bearer {}", user_token))
        .body(axum::body::Body::empty())
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::NO_CONTENT);

    // Verify reaction.delete audit log
    let audit_del_rows = sqlx::query(
        "SELECT action, target_type, metadata FROM audit_log WHERE action = 'reaction.delete'",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(audit_del_rows.len(), 1);
}
