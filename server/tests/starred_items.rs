mod common;

use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use common::{login_user, register_user, setup_test_app, setup_test_app_with_custom_config};
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
async fn test_starred_items_crud_flow() {
    let (app, _pool) = setup_test_app().await;

    let _user_id = register_user(&app, "star_user_1", "Password123!", None).await;
    let (status, login_res) = login_user(
        &app,
        "star_user_1",
        "Password123!",
        "client_star_1_123456",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let token = login_res["session_token"].as_str().unwrap().to_string();

    let room_id = create_room(&app, &token).await;

    // 1. Star a message
    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/users/me/starred-items")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "item_id": "msg_123",
                "item_type": "message",
                "room_id": room_id
            })
            .to_string(),
        ))
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED);
    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let star_body: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(star_body["item_id"], "msg_123");
    assert_eq!(star_body["item_type"], "message");
    assert_eq!(star_body["room_id"], room_id);
    assert_eq!(star_body["user_seq"], 1);
    assert!(star_body["deleted_at"].is_null());

    // 2. Star same item again (Idempotent 200 OK)
    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/users/me/starred-items")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "item_id": "msg_123",
                "item_type": "message",
                "room_id": room_id
            })
            .to_string(),
        ))
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let star_body_2: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(star_body_2["user_seq"], 1);

    // 3. Star an attachment and a link
    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/users/me/starred-items")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "item_id": "att_456",
                "item_type": "attachment",
                "room_id": room_id
            })
            .to_string(),
        ))
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED);

    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/users/me/starred-items")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "item_id": "https://example.com",
                "item_type": "link",
                "room_id": room_id
            })
            .to_string(),
        ))
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED);

    // 4. List starred items (default excludes tombstones)
    let req = Request::builder()
        .method("GET")
        .uri("/api/v1/users/me/starred-items")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .body(Body::empty())
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let list_body: Value = serde_json::from_slice(&body_bytes).unwrap();
    let items = list_body["items"].as_array().unwrap();
    assert_eq!(items.len(), 3);

    // 5. Unstar an item
    let req = Request::builder()
        .method("DELETE")
        .uri("/api/v1/users/me/starred-items/msg_123?item_type=message")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .body(Body::empty())
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::NO_CONTENT);

    // 6. Unstar non-existent or already unstarred item -> 404
    let req = Request::builder()
        .method("DELETE")
        .uri("/api/v1/users/me/starred-items/msg_123?item_type=message")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .body(Body::empty())
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);

    // 7. List excludes unstarred item
    let req = Request::builder()
        .method("GET")
        .uri("/api/v1/users/me/starred-items")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .body(Body::empty())
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let list_after_body: Value = serde_json::from_slice(&body_bytes).unwrap();
    let active_items = list_after_body["items"].as_array().unwrap();
    assert_eq!(active_items.len(), 2);

    // 8. List with include_deleted=true includes tombstone
    let req = Request::builder()
        .method("GET")
        .uri("/api/v1/users/me/starred-items?include_deleted=true")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .body(Body::empty())
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let del_list_body: Value = serde_json::from_slice(&body_bytes).unwrap();
    let all_items = del_list_body["items"].as_array().unwrap();
    assert_eq!(all_items.len(), 3);

    // 9. Re-star item after unstar -> tombstone cleared, user_seq bumped
    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/users/me/starred-items")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "item_id": "msg_123",
                "item_type": "message",
                "room_id": room_id
            })
            .to_string(),
        ))
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED);
    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let restar_body: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(restar_body["item_id"], "msg_123");
    assert!(restar_body["deleted_at"].is_null());
    assert!(restar_body["user_seq"].as_i64().unwrap() > 3);
}

#[tokio::test]
async fn test_starred_items_pagination_and_spec_cursor() {
    let (app, _pool) = setup_test_app().await;

    let user_id = register_user(&app, "star_page_user", "Password123!", None).await;
    let (status, login_res) = login_user(
        &app,
        "star_page_user",
        "Password123!",
        "client_star_p_12345",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let token = login_res["session_token"].as_str().unwrap().to_string();

    let room_id = create_room(&app, &token).await;

    for item_id in &["msg_1", "msg_2", "msg_3"] {
        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/users/me/starred-items")
            .header(header::AUTHORIZATION, format!("Bearer {}", token))
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(
                json!({
                    "item_id": item_id,
                    "item_type": "message",
                    "room_id": room_id
                })
                .to_string(),
            ))
            .unwrap();
        let resp = app.clone().oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::CREATED);
    }

    // Spec cursor payload without last_starred_at
    let spec_cursor_payload = json!({
        "user_id": user_id,
        "last_item_id": "msg_2",
        "last_item_type": "message"
    });
    let spec_cursor_b64 = URL_SAFE_NO_PAD.encode(spec_cursor_payload.to_string().as_bytes());

    let req = Request::builder()
        .method("GET")
        .uri(format!(
            "/api/v1/users/me/starred-items?cursor={}",
            spec_cursor_b64
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .body(Body::empty())
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let page_body: Value = serde_json::from_slice(&body_bytes).unwrap();
    let page_items = page_body["items"].as_array().unwrap();
    assert_eq!(page_items.len(), 1);
    assert_eq!(page_items[0]["item_id"], "msg_1");

    // Mismatched user_id in cursor -> 400
    let bad_user_cursor = json!({
        "user_id": "wrong_user_id",
        "last_item_id": "msg_2",
        "last_item_type": "message"
    });
    let bad_cursor_b64 = URL_SAFE_NO_PAD.encode(bad_user_cursor.to_string().as_bytes());

    let req = Request::builder()
        .method("GET")
        .uri(format!(
            "/api/v1/users/me/starred-items?cursor={}",
            bad_cursor_b64
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .body(Body::empty())
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);

    // Malformed base64 cursor -> 400
    let req = Request::builder()
        .method("GET")
        .uri("/api/v1/users/me/starred-items?cursor=invalid_base64!!!")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .body(Body::empty())
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn test_starred_items_limit_enforcement() {
    let (app, _pool, _) = setup_test_app_with_custom_config(|config| {
        config.max_starred_items_per_user = 2;
    })
    .await;

    let _user_id = register_user(&app, "limit_user", "Password123!", None).await;
    let (status, login_res) = login_user(
        &app,
        "limit_user",
        "Password123!",
        "client_limit_12345",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let token = login_res["session_token"].as_str().unwrap().to_string();

    let room_id = create_room(&app, &token).await;

    // Star item 1 -> 201
    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/users/me/starred-items")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "item_id": "item_1",
                "item_type": "message",
                "room_id": room_id
            })
            .to_string(),
        ))
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED);

    // Star item 2 -> 201
    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/users/me/starred-items")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "item_id": "item_2",
                "item_type": "message",
                "room_id": room_id
            })
            .to_string(),
        ))
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED);

    // Star item 3 -> 409 Conflict
    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/users/me/starred-items")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "item_id": "item_3",
                "item_type": "message",
                "room_id": room_id
            })
            .to_string(),
        ))
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::CONFLICT);

    // Unstar item 1 -> 204
    let req = Request::builder()
        .method("DELETE")
        .uri("/api/v1/users/me/starred-items/item_1?item_type=message")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .body(Body::empty())
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::NO_CONTENT);

    // Star item 3 -> now succeeds (201)
    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/users/me/starred-items")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "item_id": "item_3",
                "item_type": "message",
                "room_id": room_id
            })
            .to_string(),
        ))
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED);
}

#[tokio::test]
async fn test_starred_items_validation_and_limits() {
    let (app, _pool) = setup_test_app().await;

    let _user_id = register_user(&app, "star_user_2", "Password123!", None).await;
    let (status, login_res) = login_user(
        &app,
        "star_user_2",
        "Password123!",
        "client_star_2_123456",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let token = login_res["session_token"].as_str().unwrap().to_string();

    let room_id = create_room(&app, &token).await;

    // Invalid item_type on POST -> 400
    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/users/me/starred-items")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "item_id": "item1",
                "item_type": "unknown_type",
                "room_id": room_id
            })
            .to_string(),
        ))
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);

    // Non-member room -> 404
    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/users/me/starred-items")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "item_id": "item1",
                "item_type": "message",
                "room_id": "non_existent_room"
            })
            .to_string(),
        ))
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);

    // Unauthenticated -> 401
    let req = Request::builder()
        .method("GET")
        .uri("/api/v1/users/me/starred-items")
        .body(Body::empty())
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn test_starred_items_sync_and_gdpr() {
    let (app, pool) = setup_test_app().await;

    // Register initial bootstrap owner user
    let _owner_id = register_user(&app, "owner_user", "Password123!", None).await;

    // Insert server invite for star_user_3
    sqlx::query(
        "INSERT INTO server_invites (id, code, max_uses, current_uses) VALUES ('inv_star_3', 'INVITESTAR31', 1, 0)",
    )
    .execute(&pool)
    .await
    .unwrap();

    let user_id = register_user(&app, "star_user_3", "Password123!", Some("INVITESTAR31")).await;
    let (status, login_res) = login_user(
        &app,
        "star_user_3",
        "Password123!",
        "client_star_3_123456",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let token = login_res["session_token"].as_str().unwrap().to_string();

    let room_id = create_room(&app, &token).await;

    // Star item
    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/users/me/starred-items")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "item_id": "msg_sync_1",
                "item_type": "message",
                "room_id": room_id
            })
            .to_string(),
        ))
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED);

    // Check GET /users/me/sync
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
    let sync_body: Value = serde_json::from_slice(&body_bytes).unwrap();
    let starred_sync = sync_body["starred_items"].as_array().unwrap();
    assert_eq!(starred_sync.len(), 1);
    assert_eq!(starred_sync[0]["item_id"], "msg_sync_1");
    assert!(
        sync_body["max_seq"].as_i64().unwrap() >= starred_sync[0]["user_seq"].as_i64().unwrap()
    );

    // Check GDPR Export contains starred_items.json
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
    let mut starred_file = zip.by_name("starred_items.json").unwrap();
    let mut contents = String::new();
    std::io::Read::read_to_string(&mut starred_file, &mut contents).unwrap();
    let export_json: Value = serde_json::from_str(&contents).unwrap();
    assert_eq!(export_json["starred_items"].as_array().unwrap().len(), 1);

    // GDPR Delete user removes starred_items
    let req = Request::builder()
        .method("DELETE")
        .uri("/api/v1/users/me")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "confirm": "DELETE" }).to_string()))
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::NO_CONTENT);

    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM starred_items WHERE user_id = ?")
        .bind(&user_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 0);
}
