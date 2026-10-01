mod common;

use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use common::{login_user, register_user, setup_test_app};

async fn create_room(
    app: &axum::Router,
    token: &str,
    _name: &str,
    retention_days: i64,
    max_file_size_bytes: i64,
) -> String {
    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "retention_days": retention_days,
                "max_file_size_bytes": max_file_size_bytes
            })
            .to_string(),
        ))
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED);
    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body_bytes).unwrap();
    json["id"].as_str().unwrap().to_string()
}

#[allow(clippy::too_many_arguments)]
async fn submit_message(
    app: &axum::Router,
    token: &str,
    room_id: &str,
    client_id: &str,
    epoch: i64,
    seq: i64,
    content_type: &str,
    ciphertext: &str,
    transcript_hash: Option<&str>,
) -> String {
    let req = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/messages", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "sender_client_id": client_id,
                "epoch": epoch,
                "seq": seq,
                "content_type": content_type,
                "ciphertext": ciphertext,
                "transcript_hash": transcript_hash
            })
            .to_string(),
        ))
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    let status = resp.status();
    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let body_str = String::from_utf8_lossy(&body_bytes);
    if status != StatusCode::CREATED {
        panic!(
            "submit_message failed: status={}, body={}",
            status, body_str
        );
    }
    let json: Value = serde_json::from_slice(&body_bytes).unwrap();
    json["message_id"].as_str().unwrap().to_string()
}
use serde_json::{json, Value};
use tower::ServiceExt;

#[tokio::test]
async fn test_read_state_write_endpoints() {
    let (app, pool) = setup_test_app().await;

    // Register User A
    let user_a_id = register_user(&app, "read_writer_a", "Password123!", None).await;
    let (status, login_res) = login_user(
        &app,
        "read_writer_a",
        "Password123!",
        "client_rw_a_123456",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let token_a = login_res["session_token"].as_str().unwrap().to_string();

    // Insert invite for User B
    sqlx::query(
        "INSERT INTO server_invites (id, code, max_uses, current_uses) VALUES ('inv_rw_b', 'INVITERWB123', 1, 0)",
    )
    .execute(&pool)
    .await
    .unwrap();

    // Register User B
    let _user_b_id =
        register_user(&app, "read_writer_b", "Password123!", Some("INVITERWB123")).await;
    let (status, login_res_b) = login_user(
        &app,
        "read_writer_b",
        "Password123!",
        "client_rw_b_123456",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let token_b = login_res_b["session_token"].as_str().unwrap().to_string();

    // User A creates Room A
    let room_a_id = create_room(&app, &token_a, "Room A", 30, 104_857_600).await;

    // User B creates Room B
    let room_b_id = create_room(&app, &token_b, "Room B", 30, 104_857_600).await;

    // Submit message in Room A
    let msg_a1_id = submit_message(
        &app,
        &token_a,
        &room_a_id,
        "client_rw_a_123456",
        0,
        0,
        "application",
        "dGVzdCBjaXBoZXJ0ZXh0",
        None,
    )
    .await;

    // Submit message in Room B
    let msg_b1_id = submit_message(
        &app,
        &token_b,
        &room_b_id,
        "client_rw_b_123456",
        0,
        0,
        "application",
        "dGVzdCBjaXBoZXJ0ZXh0",
        None,
    )
    .await;

    // 1. Write creates a row & returns user_seq = 1
    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/users/me/read-state")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "room_id": room_a_id,
                "last_read_message_id": msg_a1_id
            })
            .to_string(),
        ))
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let cache_control = resp
        .headers()
        .get("cache-control")
        .unwrap()
        .to_str()
        .unwrap();
    assert_eq!(cache_control, "no-store");

    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let body: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(body["room_id"], room_a_id);
    assert_eq!(body["last_read_message_id"], msg_a1_id);
    assert_eq!(body["user_seq"], 1);
    assert!(body["deleted_at"].is_null());

    // 2. Second write advances user_seq to 2
    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/users/me/read-state")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "room_id": room_a_id,
                "last_read_message_id": msg_a1_id
            })
            .to_string(),
        ))
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let body: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(body["user_seq"], 2);

    // 3. Write with last_read_message_id: null succeeds
    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/users/me/read-state")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "room_id": room_a_id,
                "last_read_message_id": null
            })
            .to_string(),
        ))
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let body: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert!(body["last_read_message_id"].is_null());

    // 4. Write for a room user is not a member of returns 404 room_not_found
    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/users/me/read-state")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "room_id": room_b_id,
                "last_read_message_id": msg_b1_id
            })
            .to_string(),
        ))
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let body: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(body["error"], "room_not_found");

    // 5. Write with message ID from another room returns 404 message_not_found
    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/users/me/read-state")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "room_id": room_a_id,
                "last_read_message_id": msg_b1_id
            })
            .to_string(),
        ))
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let body: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(body["error"], "message_not_found");

    // 6. Missing room_id returns 400 missing_field
    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/users/me/read-state")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "last_read_message_id": msg_a1_id
            })
            .to_string(),
        ))
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let body: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(body["error"], "missing_field");

    // 7. Invalid last_read_message_id (empty string) returns 400 invalid_message_id
    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/users/me/read-state")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "room_id": room_a_id,
                "last_read_message_id": "   "
            })
            .to_string(),
        ))
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let body: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(body["error"], "invalid_message_id");

    // 8. Cross-user isolation
    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/users/me/read-state")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_b))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "room_id": room_b_id,
                "last_read_message_id": msg_b1_id
            })
            .to_string(),
        ))
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let body: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(body["user_seq"], 1);

    // 9. Resurrecting deleted_at
    sqlx::query(
        "UPDATE read_state SET deleted_at = CURRENT_TIMESTAMP WHERE user_id = ? AND room_id = ?",
    )
    .bind(&user_a_id)
    .bind(&room_a_id)
    .execute(&pool)
    .await
    .unwrap();

    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/users/me/read-state")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "room_id": room_a_id,
                "last_read_message_id": msg_a1_id
            })
            .to_string(),
        ))
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let body: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert!(body["deleted_at"].is_null());
}
