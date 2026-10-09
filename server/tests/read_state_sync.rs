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
async fn test_read_state_sync_integration() {
    let (app, pool) = setup_test_app().await;

    // Register User A and User B
    let user_a_id = register_user(&app, "sync_user_a", "Password123!", None).await;
    let (status, login_res_a) = login_user(
        &app,
        "sync_user_a",
        "Password123!",
        "client_sync_a_123456",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let token_a = login_res_a["session_token"].as_str().unwrap().to_string();

    // Insert invite for User B
    sqlx::query(
        "INSERT INTO server_invites (id, code, max_uses, current_uses) VALUES ('inv_sync_b', 'INVITESYNCB1', 1, 0)",
    )
    .execute(&pool)
    .await
    .unwrap();

    let _user_b_id = register_user(&app, "sync_user_b", "Password123!", Some("INVITESYNCB1")).await;
    let (status, login_res_b) = login_user(
        &app,
        "sync_user_b",
        "Password123!",
        "client_sync_b_123456",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let token_b = login_res_b["session_token"].as_str().unwrap().to_string();

    // User A creates three rooms
    let room_1 = create_room(&app, &token_a, "Room 1", 30, 104_857_600).await;
    let room_2 = create_room(&app, &token_a, "Room 2", 30, 104_857_600).await;
    let room_3 = create_room(&app, &token_a, "Room 3", 30, 104_857_600).await;

    // User B creates a room
    let room_b = create_room(&app, &token_b, "Room B", 30, 104_857_600).await;

    // Messages in User A's rooms and User B's room
    let msg_1 = submit_message(
        &app,
        &token_a,
        &room_1,
        "client_sync_a_123456",
        0,
        0,
        "application",
        "dGVzdA==",
        None,
    )
    .await;
    let _msg_b = submit_message(
        &app,
        &token_b,
        &room_b,
        "client_sync_b_123456",
        0,
        0,
        "application",
        "dGVzdA==",
        None,
    )
    .await;
    let msg_2 = submit_message(
        &app,
        &token_a,
        &room_2,
        "client_sync_a_123456",
        0,
        0,
        "application",
        "dGVzdA==",
        None,
    )
    .await;
    let msg_3 = submit_message(
        &app,
        &token_a,
        &room_3,
        "client_sync_a_123456",
        0,
        0,
        "application",
        "dGVzdA==",
        None,
    )
    .await;

    // Write read state for Room 1 -> user_seq = 2
    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/users/me/read-state")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({ "room_id": room_1, "last_read_message_id": msg_1 }).to_string(),
        ))
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    // Write read state for Room 2 -> user_seq = 3
    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/users/me/read-state")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({ "room_id": room_2, "last_read_message_id": msg_2 }).to_string(),
        ))
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    // Write read state for Room 3 -> user_seq = 4
    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/users/me/read-state")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({ "room_id": room_3, "last_read_message_id": msg_3 }).to_string(),
        ))
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    // 1. Full sync returns all non-deleted read state
    let req = Request::builder()
        .method("GET")
        .uri("/api/v1/users/me/sync?since_seq=0")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let body: Value = serde_json::from_slice(&body_bytes).unwrap();
    let read_states = body["read_state"].as_array().unwrap();
    assert_eq!(read_states.len(), 3);
    assert_eq!(body["max_seq"], 4);

    // 2. Delta sync returns rows after cursor (since_seq=3 returns room_3 with user_seq=4)
    let req = Request::builder()
        .method("GET")
        .uri("/api/v1/users/me/sync?since_seq=3")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let body: Value = serde_json::from_slice(&body_bytes).unwrap();
    let read_states = body["read_state"].as_array().unwrap();
    assert_eq!(read_states.len(), 1);
    assert_eq!(read_states[0]["room_id"], room_3);
    assert_eq!(body["max_seq"], 4);

    // 3. Delta sync up to date returns empty array and max_seq == since_seq
    let req = Request::builder()
        .method("GET")
        .uri("/api/v1/users/me/sync?since_seq=4")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let body: Value = serde_json::from_slice(&body_bytes).unwrap();
    let read_states = body["read_state"].as_array().unwrap();
    assert_eq!(read_states.len(), 0);
    assert_eq!(body["max_seq"], 4);

    // 4. Tombstone behavior
    // Set deleted_at for room_1
    sqlx::query(
        "UPDATE read_state SET deleted_at = CURRENT_TIMESTAMP WHERE user_id = ? AND room_id = ?",
    )
    .bind(&user_a_id)
    .bind(&room_1)
    .execute(&pool)
    .await
    .unwrap();

    // Delta sync includes tombstones
    let req = Request::builder()
        .method("GET")
        .uri("/api/v1/users/me/sync?since_seq=0")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let body: Value = serde_json::from_slice(&body_bytes).unwrap();
    let read_states = body["read_state"].as_array().unwrap();
    // Full sync excludes deleted rows!
    assert_eq!(read_states.len(), 2);

    // Delta sync with since_seq=4 includes the deleted tombstone for room_1 if user_seq > 4
    // Let's write read_state for room_1 to allocate user_seq=5 and set deleted_at
    let mut tx = pool.begin().await.unwrap();
    let seq_5 = server::sync::allocate_user_seq(&mut tx, &user_a_id)
        .await
        .unwrap();
    assert_eq!(seq_5, 5);
    sqlx::query(
        "UPDATE read_state SET user_seq = ?, deleted_at = CURRENT_TIMESTAMP WHERE user_id = ? AND room_id = ?",
    )
    .bind(seq_5)
    .bind(&user_a_id)
    .bind(&room_1)
    .execute(&mut *tx)
    .await
    .unwrap();
    tx.commit().await.unwrap();

    let req = Request::builder()
        .method("GET")
        .uri("/api/v1/users/me/sync?since_seq=4")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let body: Value = serde_json::from_slice(&body_bytes).unwrap();
    let read_states = body["read_state"].as_array().unwrap();
    assert_eq!(read_states.len(), 1);
    assert_eq!(read_states[0]["room_id"], room_1);
    assert!(!read_states[0]["deleted_at"].is_null());
    assert_eq!(body["max_seq"], 5);

    // 5. Cross-user isolation in sync
    let req = Request::builder()
        .method("GET")
        .uri("/api/v1/users/me/sync?since_seq=0")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_b))
        .body(Body::empty())
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let body: Value = serde_json::from_slice(&body_bytes).unwrap();
    let read_states = body["read_state"].as_array().unwrap();
    assert_eq!(read_states.len(), 0);

    // 6. Deleted room ON DELETE CASCADE removes read_state
    let req = Request::builder()
        .method("DELETE")
        .uri(format!("/api/v1/rooms/{}", room_2))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::NO_CONTENT);

    let req = Request::builder()
        .method("GET")
        .uri("/api/v1/users/me/sync?since_seq=0")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let body: Value = serde_json::from_slice(&body_bytes).unwrap();
    let read_states = body["read_state"].as_array().unwrap();
    assert_eq!(read_states.len(), 1);
    assert_eq!(read_states[0]["room_id"], room_3);
}
