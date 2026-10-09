mod common;

use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use common::{login_user, register_user, setup_test_app};
use serde_json::{json, Value};
use tower::ServiceExt;

async fn create_room(app: &axum::Router, token: &str) -> String {
    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({}).to_string()))
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    let status = resp.status();
    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let body_str = String::from_utf8_lossy(&body_bytes);
    if status != StatusCode::CREATED {
        panic!("create_room failed: status={}, body={}", status, body_str);
    }
    let json: Value = serde_json::from_slice(&body_bytes).unwrap();
    json["id"].as_str().unwrap().to_string()
}

#[tokio::test]
async fn test_room_order_schema_and_pk() {
    let (_app, pool) = setup_test_app().await;

    // Verify index exists
    let index_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = 'idx_user_room_order_seq'"
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(index_count, 1);

    // Create a dummy user and room
    sqlx::query(
        "INSERT INTO users (id, username_token, opaque_registration, identity_pubkey) VALUES ('u_ro_pk', 'token_ro_pk', randomblob(32), 'pubkey')",
    )
    .execute(&pool)
    .await
    .unwrap();

    sqlx::query("INSERT INTO rooms (id, owner_id) VALUES ('r_ro_pk', 'u_ro_pk')")
        .execute(&pool)
        .await
        .unwrap();

    // Insert first row
    sqlx::query(
        "INSERT INTO user_room_order (user_id, room_id, position, user_seq) VALUES ('u_ro_pk', 'r_ro_pk', 0, 1)"
    )
    .execute(&pool)
    .await
    .unwrap();

    // Direct insert with duplicate PK (user_id, room_id) must fail
    let res = sqlx::query(
        "INSERT INTO user_room_order (user_id, room_id, position, user_seq) VALUES ('u_ro_pk', 'r_ro_pk', 1, 2)"
    )
    .execute(&pool)
    .await;

    assert!(
        res.is_err(),
        "Expected PK constraint failure on duplicate (user_id, room_id)"
    );
}

#[tokio::test]
async fn test_room_order_patch_and_no_op_guard() {
    let (app, _pool) = setup_test_app().await;

    let _user_id = register_user(&app, "ro_user_1", "Password123!", None).await;
    let (status, login_res) = login_user(
        &app,
        "ro_user_1",
        "Password123!",
        "client_ro_1_123456",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let token = login_res["session_token"].as_str().unwrap().to_string();

    let room1 = create_room(&app, &token).await;
    let room2 = create_room(&app, &token).await;
    let room3 = create_room(&app, &token).await;

    // 1. Initial PATCH
    let req = Request::builder()
        .method("PATCH")
        .uri("/api/v1/users/me/room-order")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "room_ids": [room1, room2, room3]
            })
            .to_string(),
        ))
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    assert_eq!(
        resp.headers()
            .get("Cache-Control")
            .map(|h| h.to_str().unwrap()),
        Some("no-store")
    );

    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let body: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(body["room_ids"], json!([room1, room2, room3]));
    let initial_seq = body["user_seq"].as_i64().unwrap();
    assert!(initial_seq >= 1);

    // 2. No-Op PATCH with identical list in exact order
    let req = Request::builder()
        .method("PATCH")
        .uri("/api/v1/users/me/room-order")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "room_ids": [room1, room2, room3]
            })
            .to_string(),
        ))
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let noop_body: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(noop_body["user_seq"].as_i64().unwrap(), initial_seq);

    // 3. PATCH with reordered list -> replaces all rows and bumps user_seq
    let req = Request::builder()
        .method("PATCH")
        .uri("/api/v1/users/me/room-order")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "room_ids": [room3, room1, room2]
            })
            .to_string(),
        ))
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let reorder_body: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(reorder_body["room_ids"], json!([room3, room1, room2]));
    let new_seq = reorder_body["user_seq"].as_i64().unwrap();
    assert!(new_seq > initial_seq);

    // 4. PATCH with empty list -> clears room order
    let req = Request::builder()
        .method("PATCH")
        .uri("/api/v1/users/me/room-order")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "room_ids": []
            })
            .to_string(),
        ))
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let empty_body: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(empty_body["room_ids"], json!([]));
    assert!(empty_body["user_seq"].as_i64().unwrap() > new_seq);
}

#[tokio::test]
async fn test_room_order_validation() {
    let (app, _pool) = setup_test_app().await;

    let _user_id = register_user(&app, "ro_val_user", "Password123!", None).await;
    let (status, login_res) = login_user(
        &app,
        "ro_val_user",
        "Password123!",
        "client_ro_val_12345",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let token = login_res["session_token"].as_str().unwrap().to_string();

    let room1 = create_room(&app, &token).await;

    // 1. Duplicate room_ids -> 400 invalid_room_ids
    let req = Request::builder()
        .method("PATCH")
        .uri("/api/v1/users/me/room-order")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "room_ids": [room1, room1]
            })
            .to_string(),
        ))
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);

    // 2. Non-member room_id -> 403 not_a_member
    let req = Request::builder()
        .method("PATCH")
        .uri("/api/v1/users/me/room-order")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "room_ids": [room1, "non_existent_room"]
            })
            .to_string(),
        ))
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);

    // 3. Unauthenticated -> 401
    let req = Request::builder()
        .method("PATCH")
        .uri("/api/v1/users/me/room-order")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "room_ids": [room1]
            })
            .to_string(),
        ))
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn test_room_order_limit_enforcement() {
    let (app, pool) = setup_test_app().await;

    // Set instance limit rooms_per_user to 2
    sqlx::query(
        "INSERT INTO instance_limits (key, value) VALUES ('rooms_per_user', '2') ON CONFLICT(key) DO UPDATE SET value = '2'"
    )
    .execute(&pool)
    .await
    .unwrap();

    let _user_id = register_user(&app, "ro_limit_user", "Password123!", None).await;
    let (status, login_res) = login_user(
        &app,
        "ro_limit_user",
        "Password123!",
        "client_ro_limit_12345",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let token = login_res["session_token"].as_str().unwrap().to_string();

    let room1 = create_room(&app, &token).await;
    let room2 = create_room(&app, &token).await;

    // PATCH with 3 rooms when limit is 2 -> 400 too_many_rooms (length check fails first)
    let req = Request::builder()
        .method("PATCH")
        .uri("/api/v1/users/me/room-order")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "room_ids": [room1, room2, "dummy_room_3"]
            })
            .to_string(),
        ))
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);

    // PATCH with 2 rooms -> 200 OK
    let req = Request::builder()
        .method("PATCH")
        .uri("/api/v1/users/me/room-order")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "room_ids": [room1, room2]
            })
            .to_string(),
        ))
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
}

#[tokio::test]
async fn test_room_order_sync_integration_and_gdpr() {
    let (app, pool) = setup_test_app().await;

    // Register initial bootstrap owner user
    let _owner_id = register_user(&app, "owner_user_ro", "Password123!", None).await;

    sqlx::query(
        "INSERT INTO server_invites (id, code, max_uses, current_uses) VALUES ('inv_ro_sync', 'INVITEROSYNC1', 1, 0)",
    )
    .execute(&pool)
    .await
    .unwrap();

    let user_id = register_user(&app, "ro_sync_user", "Password123!", Some("INVITEROSYNC1")).await;
    let (status, login_res) = login_user(
        &app,
        "ro_sync_user",
        "Password123!",
        "client_ro_sync_12345",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let token = login_res["session_token"].as_str().unwrap().to_string();

    let room1 = create_room(&app, &token).await;
    let room2 = create_room(&app, &token).await;

    // 1. Initial sync before setting room order -> room_order is null
    let req = Request::builder()
        .method("GET")
        .uri("/api/v1/users/me/sync?since_seq=0")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .body(Body::empty())
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let sync_1: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert!(sync_1["room_order"].is_null());

    // 2. PATCH room order
    let req = Request::builder()
        .method("PATCH")
        .uri("/api/v1/users/me/room-order")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "room_ids": [room1, room2]
            })
            .to_string(),
        ))
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let patch_body: Value = serde_json::from_slice(&body_bytes).unwrap();
    let order_seq = patch_body["user_seq"].as_i64().unwrap();

    // 3. GET /users/me/sync?since_seq=0 -> returns room_order
    let req = Request::builder()
        .method("GET")
        .uri("/api/v1/users/me/sync?since_seq=0")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .body(Body::empty())
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let sync_2: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(sync_2["room_order"]["room_ids"], json!([room1, room2]));
    assert_eq!(sync_2["room_order"]["user_seq"], order_seq);
    assert!(sync_2["max_seq"].as_i64().unwrap() >= order_seq);

    // 4. GET /users/me/sync?since_seq=N (where N >= order_seq) -> room_order is null
    let req = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/users/me/sync?since_seq={}", order_seq))
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .body(Body::empty())
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let sync_3: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert!(sync_3["room_order"].is_null());

    // 5. Check Preferences Reserved Key Regression
    let req = Request::builder()
        .method("PATCH")
        .uri("/api/v1/users/me/preferences/room_order")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "value": "AQID" }).to_string()))
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);

    // 6. Check GDPR Export includes room_order.json
    let req = Request::builder()
        .method("GET")
        .uri("/api/v1/users/me/export")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .body(Body::empty())
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let zip_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let reader = std::io::Cursor::new(zip_bytes);
    let mut zip = zip::ZipArchive::new(reader).unwrap();
    let mut ro_file = zip.by_name("room_order.json").unwrap();
    let mut contents = String::new();
    std::io::Read::read_to_string(&mut ro_file, &mut contents).unwrap();
    let export_json: Value = serde_json::from_str(&contents).unwrap();
    assert_eq!(export_json["room_ids"], json!([room1, room2]));

    // 7. GDPR Delete user removes user_room_order
    let req = Request::builder()
        .method("DELETE")
        .uri("/api/v1/users/me")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "confirm": "DELETE" }).to_string()))
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::NO_CONTENT);

    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM user_room_order WHERE user_id = ?")
        .bind(&user_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 0);
}
