mod common;

use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use common::{login_user, register_user, setup_test_app};
use serde_json::{json, Value};
use server::sync::allocate_user_seq;
use tower::ServiceExt;

#[tokio::test]
async fn test_user_seq_allocator_monotonic_and_rollback() {
    let (_app, pool) = setup_test_app().await;
    let user_a = "usr_seq_a";
    let user_b = "usr_seq_b";

    // Insert dummy user rows for foreign key integrity
    sqlx::query(
        "INSERT INTO users (id, username_token, opaque_registration, identity_pubkey) VALUES (?, ?, ?, ?)",
    )
    .bind(user_a)
    .bind("token_seq_a")
    .bind(vec![1u8, 2, 3])
    .bind("pubkey_seq_a")
    .execute(&pool)
    .await
    .unwrap();

    sqlx::query(
        "INSERT INTO users (id, username_token, opaque_registration, identity_pubkey) VALUES (?, ?, ?, ?)",
    )
    .bind(user_b)
    .bind("token_seq_b")
    .bind(vec![1u8, 2, 3])
    .bind("pubkey_seq_b")
    .execute(&pool)
    .await
    .unwrap();

    // 1. First allocation returns 1
    let mut tx = pool.begin().await.unwrap();
    let seq_a1 = allocate_user_seq(&mut tx, user_a).await.unwrap();
    tx.commit().await.unwrap();
    assert_eq!(seq_a1, 1);

    // 2. Second allocation returns 2
    let mut tx = pool.begin().await.unwrap();
    let seq_a2 = allocate_user_seq(&mut tx, user_a).await.unwrap();
    tx.commit().await.unwrap();
    assert_eq!(seq_a2, 2);

    // 3. Rollback of transaction does NOT consume a sequence number
    let mut tx_rb = pool.begin().await.unwrap();
    let seq_a3_rb = allocate_user_seq(&mut tx_rb, user_a).await.unwrap();
    assert_eq!(seq_a3_rb, 3);
    tx_rb.rollback().await.unwrap();

    // Re-allocation after rollback returns 3
    let mut tx = pool.begin().await.unwrap();
    let seq_a3 = allocate_user_seq(&mut tx, user_a).await.unwrap();
    tx.commit().await.unwrap();
    assert_eq!(seq_a3, 3);

    // 4. Independent sequences across users
    let mut tx = pool.begin().await.unwrap();
    let seq_b1 = allocate_user_seq(&mut tx, user_b).await.unwrap();
    tx.commit().await.unwrap();
    assert_eq!(seq_b1, 1);
}

#[tokio::test]
async fn test_sync_endpoint_auth_and_response_shape() {
    let (app, _pool) = setup_test_app().await;

    // Unauthenticated request returns 401
    let req = Request::builder()
        .method("GET")
        .uri("/api/v1/users/me/sync?since_seq=0")
        .body(Body::empty())
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);

    // Authenticated request
    let _user_id = register_user(&app, "sync_shape_user", "Password123!", None).await;
    let (status, login_res) = login_user(
        &app,
        "sync_shape_user",
        "Password123!",
        "client_shape_123456",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let token = login_res["session_token"].as_str().unwrap();

    let req = Request::builder()
        .method("GET")
        .uri("/api/v1/users/me/sync?since_seq=0")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .body(Body::empty())
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let cache_control = resp
        .headers()
        .get(header::CACHE_CONTROL)
        .unwrap()
        .to_str()
        .unwrap();
    assert_eq!(cache_control, "no-store");

    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let body: Value = serde_json::from_slice(&body_bytes).unwrap();

    // Verify exact V3 §8.2.4 response shape
    assert!(body.get("read_state").unwrap().is_array());
    assert!(body.get("user_preferences").unwrap().is_array());
    assert!(body.get("device_state").unwrap().is_array());
    assert!(body.get("starred_items").unwrap().is_array());
    assert!(body.get("bot_settings").unwrap().is_array());
    assert_eq!(body["bot_settings"], json!([]));
    assert_eq!(body["max_seq"], 0);
    assert_eq!(body["full_resync_required"], false);
}

#[tokio::test]
async fn test_sync_endpoint_full_delta_tombstones_and_isolation() {
    let (app, pool) = setup_test_app().await;

    // Register User A and User B
    let user_a_id = register_user(&app, "foundation_usr_a", "Password123!", None).await;
    let (status, login_res_a) = login_user(
        &app,
        "foundation_usr_a",
        "Password123!",
        "client_found_a_123456",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let token_a = login_res_a["session_token"].as_str().unwrap().to_string();

    sqlx::query(
        "INSERT INTO server_invites (id, code, max_uses, current_uses) VALUES ('inv_found_b', 'INVITEFOUNDB', 1, 0)",
    )
    .execute(&pool)
    .await
    .unwrap();

    let _user_b_id = register_user(
        &app,
        "foundation_usr_b",
        "Password123!",
        Some("INVITEFOUNDB"),
    )
    .await;
    let (status, login_res_b) = login_user(
        &app,
        "foundation_usr_b",
        "Password123!",
        "client_found_b_123456",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let token_b = login_res_b["session_token"].as_str().unwrap().to_string();

    // Create 3 rooms for User A
    let create_room = || {
        let app = app.clone();
        let token = token_a.clone();
        async move {
            let req = Request::builder()
                .method("POST")
                .uri("/api/v1/rooms")
                .header(header::AUTHORIZATION, format!("Bearer {}", token))
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    json!({ "retention_days": 30, "max_file_size_bytes": 104857600 }).to_string(),
                ))
                .unwrap();
            let resp = app.oneshot(req).await.unwrap();
            assert_eq!(resp.status(), StatusCode::CREATED);
            let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
                .await
                .unwrap();
            let v: Value = serde_json::from_slice(&bytes).unwrap();
            v["id"].as_str().unwrap().to_string()
        }
    };

    let room_1 = create_room().await;
    let room_2 = create_room().await;
    let room_3 = create_room().await;

    // Submit read state for Room 1 -> user_seq = 1
    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/users/me/read-state")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({ "room_id": room_1, "last_read_message_id": null }).to_string(),
        ))
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    // Submit read state for Room 2 -> user_seq = 2
    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/users/me/read-state")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({ "room_id": room_2, "last_read_message_id": null }).to_string(),
        ))
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    // Submit read state for Room 3 -> user_seq = 3
    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/users/me/read-state")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({ "room_id": room_3, "last_read_message_id": null }).to_string(),
        ))
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    // 1. Full sync (since_seq = 0) returns all 3 read_state rows and max_seq = 3
    let req = Request::builder()
        .method("GET")
        .uri("/api/v1/users/me/sync?since_seq=0")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let body: Value = serde_json::from_slice(&bytes).unwrap();
    let read_states = body["read_state"].as_array().unwrap();
    assert_eq!(read_states.len(), 3);
    assert_eq!(body["max_seq"], 3);

    // 2. Delta sync (since_seq = 2) returns only row with user_seq > 2
    let req = Request::builder()
        .method("GET")
        .uri("/api/v1/users/me/sync?since_seq=2")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let body: Value = serde_json::from_slice(&bytes).unwrap();
    let read_states = body["read_state"].as_array().unwrap();
    assert_eq!(read_states.len(), 1);
    assert_eq!(read_states[0]["room_id"], room_3);
    assert_eq!(body["max_seq"], 3);

    // 3. User B calling sync sees 0 read_state rows (User isolation)
    let req = Request::builder()
        .method("GET")
        .uri("/api/v1/users/me/sync?since_seq=0")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_b))
        .body(Body::empty())
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let body: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(body["read_state"].as_array().unwrap().len(), 0);

    // 4. Tombstone behavior
    // Allocate user_seq = 4 and mark room_1 as deleted
    let mut tx = pool.begin().await.unwrap();
    let seq_4 = allocate_user_seq(&mut tx, &user_a_id).await.unwrap();
    assert_eq!(seq_4, 4);
    sqlx::query(
        "UPDATE read_state SET user_seq = ?, deleted_at = CURRENT_TIMESTAMP WHERE user_id = ? AND room_id = ?",
    )
    .bind(seq_4)
    .bind(&user_a_id)
    .bind(&room_1)
    .execute(&mut *tx)
    .await
    .unwrap();
    tx.commit().await.unwrap();

    // Delta sync with since_seq = 3 returns room_1 tombstone with deleted_at set
    let req = Request::builder()
        .method("GET")
        .uri("/api/v1/users/me/sync?since_seq=3")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let body: Value = serde_json::from_slice(&bytes).unwrap();
    let read_states = body["read_state"].as_array().unwrap();
    assert_eq!(read_states.len(), 1);
    assert_eq!(read_states[0]["room_id"], room_1);
    assert!(!read_states[0]["deleted_at"].is_null());
    assert_eq!(body["max_seq"], 4);

    // Full sync (since_seq = 0) excludes tombstones
    let req = Request::builder()
        .method("GET")
        .uri("/api/v1/users/me/sync?since_seq=0")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let body: Value = serde_json::from_slice(&bytes).unwrap();
    let read_states = body["read_state"].as_array().unwrap();
    assert_eq!(read_states.len(), 2);
}

#[tokio::test]
async fn test_sync_endpoint_full_resync_required_retention_window() {
    let (app, pool) = setup_test_app().await;

    let user_a_id = register_user(&app, "retention_usr", "Password123!", None).await;
    let (status, login_res_a) = login_user(
        &app,
        "retention_usr",
        "Password123!",
        "client_ret_a_123456",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let token_a = login_res_a["session_token"].as_str().unwrap().to_string();

    // Create room
    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({ "retention_days": 30, "max_file_size_bytes": 104857600 }).to_string(),
        ))
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED);
    let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let room_val: Value = serde_json::from_slice(&bytes).unwrap();
    let room_id = room_val["id"].as_str().unwrap();

    // Submit read state -> user_seq = 1
    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/users/me/read-state")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({ "room_id": room_id, "last_read_message_id": null }).to_string(),
        ))
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    // 1. Fresh state within retention window -> full_resync_required = false
    let req = Request::builder()
        .method("GET")
        .uri("/api/v1/users/me/sync?since_seq=1")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let body: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(body["full_resync_required"], false);

    // 2. Set timestamp of read_state user_seq = 1 to 100 days ago (older than 90 days retention window)
    sqlx::query(
        "UPDATE read_state SET updated_at = datetime('now', '-100 days') WHERE user_id = ? AND room_id = ?",
    )
    .bind(&user_a_id)
    .bind(room_id)
    .execute(&pool)
    .await
    .unwrap();

    // Request with since_seq = 1 now triggers full_resync_required = true
    let req = Request::builder()
        .method("GET")
        .uri("/api/v1/users/me/sync?since_seq=1")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let body: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(body["full_resync_required"], true);

    // Full sync (since_seq = 0) always returns full_resync_required = false
    let req = Request::builder()
        .method("GET")
        .uri("/api/v1/users/me/sync?since_seq=0")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let body: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(body["full_resync_required"], false);
}
