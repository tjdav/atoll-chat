mod common;

use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use common::{login_user, register_user, setup_test_app};
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

    let user_id = register_user(app, username, "Password123!", invite_code.as_deref()).await;
    let (status, login_res) = login_user(app, username, "Password123!", client_id, None).await;
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
async fn test_01_create_room_succeeds() {
    let (app, pool) = setup_test_app().await;
    let (user_a_id, token_a) =
        create_test_user(&app, &pool, "alice", "device_client_id_a_12345").await;

    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({}).to_string()))
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED);

    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body_bytes).unwrap();

    assert_eq!(json["owner_id"], user_a_id);
    assert_eq!(json["current_user_role"], "owner");
    assert_eq!(json["member_count"], 1);
    assert!(!json["id"].as_str().unwrap().is_empty());
}

#[tokio::test]
async fn test_02_create_room_with_retention_and_file_size() {
    let (app, pool) = setup_test_app().await;
    let (_user_a_id, token_a) =
        create_test_user(&app, &pool, "alice", "device_client_id_a_12345").await;

    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "retention_days": 30,
                "max_file_size_bytes": 10485760
            })
            .to_string(),
        ))
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED);

    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body_bytes).unwrap();

    assert_eq!(json["retention_days"], 30);
    assert_eq!(json["max_file_size_bytes"], 10485760);
}

#[tokio::test]
async fn test_03_create_room_invalid_retention() {
    let (app, pool) = setup_test_app().await;
    let (_user_a_id, token_a) =
        create_test_user(&app, &pool, "alice", "device_client_id_a_12345").await;

    // retention 500 -> 400
    let req1 = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "retention_days": 500 }).to_string()))
        .unwrap();

    let resp1 = app.clone().oneshot(req1).await.unwrap();
    assert_eq!(resp1.status(), StatusCode::BAD_REQUEST);

    // retention -1 -> 400
    let req2 = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "retention_days": -1 }).to_string()))
        .unwrap();

    let resp2 = app.oneshot(req2).await.unwrap();
    assert_eq!(resp2.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn test_04_create_room_invalid_file_size() {
    let (app, pool) = setup_test_app().await;
    let (_user_a_id, token_a) =
        create_test_user(&app, &pool, "alice", "device_client_id_a_12345").await;

    // file size 0 -> 400
    let req1 = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "max_file_size_bytes": 0 }).to_string()))
        .unwrap();

    let resp1 = app.clone().oneshot(req1).await.unwrap();
    assert_eq!(resp1.status(), StatusCode::BAD_REQUEST);

    // file size exceeds server hard max -> 400
    let req2 = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({ "max_file_size_bytes": 999999999 }).to_string(),
        ))
        .unwrap();

    let resp2 = app.oneshot(req2).await.unwrap();
    assert_eq!(resp2.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn test_05_create_room_rooms_per_user_limit() {
    let (app, pool) = setup_test_app().await;
    let (user_a_id, token_a) =
        create_test_user(&app, &pool, "alice", "device_client_id_a_12345").await;

    // Set instance rooms_per_user limit to 2
    sqlx::query(
        "INSERT INTO instance_limits (key, value, updated_by) VALUES ('rooms_per_user', '2', ?)",
    )
    .bind(&user_a_id)
    .execute(&pool)
    .await
    .unwrap();

    // Create room 1
    let req1 = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({}).to_string()))
        .unwrap();
    let resp1 = app.clone().oneshot(req1).await.unwrap();
    assert_eq!(resp1.status(), StatusCode::CREATED);

    // Create room 2
    let req2 = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({}).to_string()))
        .unwrap();
    let resp2 = app.clone().oneshot(req2).await.unwrap();
    assert_eq!(resp2.status(), StatusCode::CREATED);

    // Create room 3 -> 409
    let req3 = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({}).to_string()))
        .unwrap();
    let resp3 = app.oneshot(req3).await.unwrap();
    assert_eq!(resp3.status(), StatusCode::CONFLICT);

    let body_bytes = axum::body::to_bytes(resp3.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(json["error"], "room_limit_reached");
}

#[tokio::test]
async fn test_06_list_rooms_returns_only_user_rooms() {
    let (app, pool) = setup_test_app().await;
    let (_user_a_id, token_a) =
        create_test_user(&app, &pool, "alice", "device_client_id_a_12345").await;
    let (_user_b_id, token_b) =
        create_test_user(&app, &pool, "bob", "device_client_id_b_12345").await;

    // Alice creates room
    let req1 = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({}).to_string()))
        .unwrap();
    let resp1 = app.clone().oneshot(req1).await.unwrap();
    let body1 = axum::body::to_bytes(resp1.into_body(), usize::MAX)
        .await
        .unwrap();
    let json1: Value = serde_json::from_slice(&body1).unwrap();
    let room_a_id = json1["id"].as_str().unwrap();

    // Bob creates room
    let req2 = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_b))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({}).to_string()))
        .unwrap();
    let resp2 = app.clone().oneshot(req2).await.unwrap();
    let body2 = axum::body::to_bytes(resp2.into_body(), usize::MAX)
        .await
        .unwrap();
    let json2: Value = serde_json::from_slice(&body2).unwrap();
    let room_b_id = json2["id"].as_str().unwrap();

    // Alice lists rooms
    let req_list_a = Request::builder()
        .method("GET")
        .uri("/api/v1/rooms")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();
    let resp_list_a = app.clone().oneshot(req_list_a).await.unwrap();
    let body_list_a = axum::body::to_bytes(resp_list_a.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_list_a: Value = serde_json::from_slice(&body_list_a).unwrap();
    let rooms_a = json_list_a["rooms"].as_array().unwrap();

    assert_eq!(rooms_a.len(), 1);
    assert_eq!(rooms_a[0]["id"], room_a_id);

    // Bob lists rooms
    let req_list_b = Request::builder()
        .method("GET")
        .uri("/api/v1/rooms")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_b))
        .body(Body::empty())
        .unwrap();
    let resp_list_b = app.oneshot(req_list_b).await.unwrap();
    let body_list_b = axum::body::to_bytes(resp_list_b.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_list_b: Value = serde_json::from_slice(&body_list_b).unwrap();
    let rooms_b = json_list_b["rooms"].as_array().unwrap();

    assert_eq!(rooms_b.len(), 1);
    assert_eq!(rooms_b[0]["id"], room_b_id);
}

#[tokio::test]
async fn test_07_get_room_returns_metadata_and_role() {
    let (app, pool) = setup_test_app().await;
    let (_user_a_id, token_a) =
        create_test_user(&app, &pool, "alice", "device_client_id_a_12345").await;
    let (user_b_id, token_b) =
        create_test_user(&app, &pool, "bob", "device_client_id_b_12345").await;

    // Alice creates room
    let req_create = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({}).to_string()))
        .unwrap();
    let resp_create = app.clone().oneshot(req_create).await.unwrap();
    let body_c = axum::body::to_bytes(resp_create.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_c: Value = serde_json::from_slice(&body_c).unwrap();
    let room_id = json_c["id"].as_str().unwrap();

    // Alice adds Bob
    let req_add = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/members", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "user_id": user_b_id }).to_string()))
        .unwrap();
    let resp_add = app.clone().oneshot(req_add).await.unwrap();
    assert_eq!(resp_add.status(), StatusCode::CREATED);

    // Bob gets room
    let req_get = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/rooms/{}", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_b))
        .body(Body::empty())
        .unwrap();
    let resp_get = app.oneshot(req_get).await.unwrap();
    assert_eq!(resp_get.status(), StatusCode::OK);

    let body_get = axum::body::to_bytes(resp_get.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_get: Value = serde_json::from_slice(&body_get).unwrap();

    assert_eq!(json_get["current_user_role"], "member");
    assert_eq!(json_get["member_count"], 2);
}

#[tokio::test]
async fn test_08_get_room_non_member_returns_404() {
    let (app, pool) = setup_test_app().await;
    let (_user_a_id, token_a) =
        create_test_user(&app, &pool, "alice", "device_client_id_a_12345").await;
    let (_user_b_id, token_b) =
        create_test_user(&app, &pool, "bob", "device_client_id_b_12345").await;

    // Alice creates room
    let req_create = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({}).to_string()))
        .unwrap();
    let resp_create = app.clone().oneshot(req_create).await.unwrap();
    let body_c = axum::body::to_bytes(resp_create.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_c: Value = serde_json::from_slice(&body_c).unwrap();
    let room_id = json_c["id"].as_str().unwrap();

    // Bob (non-member) attempts GET -> 404
    let req_get = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/rooms/{}", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_b))
        .body(Body::empty())
        .unwrap();
    let resp_get = app.oneshot(req_get).await.unwrap();
    assert_eq!(resp_get.status(), StatusCode::NOT_FOUND);

    let body_bytes = axum::body::to_bytes(resp_get.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(json["error"], "room_not_found");
}

#[tokio::test]
async fn test_09_delete_room_by_owner_succeeds() {
    let (app, pool) = setup_test_app().await;
    let (_user_a_id, token_a) =
        create_test_user(&app, &pool, "alice", "device_client_id_a_12345").await;

    // Create room
    let req_create = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({}).to_string()))
        .unwrap();
    let resp_create = app.clone().oneshot(req_create).await.unwrap();
    let body_c = axum::body::to_bytes(resp_create.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_c: Value = serde_json::from_slice(&body_c).unwrap();
    let room_id = json_c["id"].as_str().unwrap();

    // Owner deletes room -> 204
    let req_del = Request::builder()
        .method("DELETE")
        .uri(format!("/api/v1/rooms/{}", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();
    let resp_del = app.clone().oneshot(req_del).await.unwrap();
    assert_eq!(resp_del.status(), StatusCode::NO_CONTENT);

    // Confirm list is empty
    let req_list = Request::builder()
        .method("GET")
        .uri("/api/v1/rooms")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();
    let resp_list = app.oneshot(req_list).await.unwrap();
    let body_l = axum::body::to_bytes(resp_list.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_l: Value = serde_json::from_slice(&body_l).unwrap();
    assert_eq!(json_l["rooms"].as_array().unwrap().len(), 0);
}

#[tokio::test]
async fn test_10_delete_room_by_non_owner_returns_403() {
    let (app, pool) = setup_test_app().await;
    let (_user_a_id, token_a) =
        create_test_user(&app, &pool, "alice", "device_client_id_a_12345").await;
    let (user_b_id, token_b) =
        create_test_user(&app, &pool, "bob", "device_client_id_b_12345").await;

    // Create room, add Bob
    let req_create = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({}).to_string()))
        .unwrap();
    let resp_create = app.clone().oneshot(req_create).await.unwrap();
    let body_c = axum::body::to_bytes(resp_create.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_c: Value = serde_json::from_slice(&body_c).unwrap();
    let room_id = json_c["id"].as_str().unwrap();

    let req_add = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/members", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "user_id": user_b_id }).to_string()))
        .unwrap();
    app.clone().oneshot(req_add).await.unwrap();

    // Bob (member, non-owner) attempts DELETE -> 403
    let req_del = Request::builder()
        .method("DELETE")
        .uri(format!("/api/v1/rooms/{}", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_b))
        .body(Body::empty())
        .unwrap();
    let resp_del = app.oneshot(req_del).await.unwrap();
    assert_eq!(resp_del.status(), StatusCode::FORBIDDEN);

    let body_bytes = axum::body::to_bytes(resp_del.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(json["error"], "forbidden");
}

#[tokio::test]
async fn test_11_delete_room_by_non_member_returns_404() {
    let (app, pool) = setup_test_app().await;
    let (_user_a_id, token_a) =
        create_test_user(&app, &pool, "alice", "device_client_id_a_12345").await;
    let (_user_b_id, token_b) =
        create_test_user(&app, &pool, "bob", "device_client_id_b_12345").await;

    // Create room
    let req_create = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({}).to_string()))
        .unwrap();
    let resp_create = app.clone().oneshot(req_create).await.unwrap();
    let body_c = axum::body::to_bytes(resp_create.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_c: Value = serde_json::from_slice(&body_c).unwrap();
    let room_id = json_c["id"].as_str().unwrap();

    // Bob (non-member) attempts DELETE -> 404
    let req_del = Request::builder()
        .method("DELETE")
        .uri(format!("/api/v1/rooms/{}", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_b))
        .body(Body::empty())
        .unwrap();
    let resp_del = app.oneshot(req_del).await.unwrap();
    assert_eq!(resp_del.status(), StatusCode::NOT_FOUND);

    let body_bytes = axum::body::to_bytes(resp_del.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(json["error"], "room_not_found");
}

#[tokio::test]
async fn test_12_delete_room_cascades() {
    let (app, pool) = setup_test_app().await;
    let (_user_a_id, token_a) =
        create_test_user(&app, &pool, "alice", "device_client_id_a_12345").await;
    let (user_b_id, _token_b) =
        create_test_user(&app, &pool, "bob", "device_client_id_b_12345").await;

    // Create room, add member
    let req_create = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({}).to_string()))
        .unwrap();
    let resp_create = app.clone().oneshot(req_create).await.unwrap();
    let body_c = axum::body::to_bytes(resp_create.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_c: Value = serde_json::from_slice(&body_c).unwrap();
    let room_id = json_c["id"].as_str().unwrap();

    let req_add = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/members", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "user_id": user_b_id }).to_string()))
        .unwrap();
    app.clone().oneshot(req_add).await.unwrap();

    // Delete room
    let req_del = Request::builder()
        .method("DELETE")
        .uri(format!("/api/v1/rooms/{}", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();
    app.oneshot(req_del).await.unwrap();

    // Assert no rows remain in room_members or room_epochs
    let members_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM room_members WHERE room_id = ?")
            .bind(room_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(members_count, 0);

    let epochs_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM room_epochs WHERE room_id = ?")
            .bind(room_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(epochs_count, 0);
}

#[tokio::test]
async fn test_13_leave_room_as_regular_member_succeeds() {
    let (app, pool) = setup_test_app().await;
    let (_user_a_id, token_a) =
        create_test_user(&app, &pool, "alice", "device_client_id_a_12345").await;
    let (user_b_id, token_b) =
        create_test_user(&app, &pool, "bob", "device_client_id_b_12345").await;

    // Create room, add Bob
    let req_create = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({}).to_string()))
        .unwrap();
    let resp_create = app.clone().oneshot(req_create).await.unwrap();
    let body_c = axum::body::to_bytes(resp_create.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_c: Value = serde_json::from_slice(&body_c).unwrap();
    let room_id = json_c["id"].as_str().unwrap();

    let req_add = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/members", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "user_id": user_b_id }).to_string()))
        .unwrap();
    app.clone().oneshot(req_add).await.unwrap();

    // Bob leaves
    let req_leave = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/leave", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_b))
        .body(Body::empty())
        .unwrap();
    let resp_leave = app.oneshot(req_leave).await.unwrap();
    assert_eq!(resp_leave.status(), StatusCode::OK);

    let body_l = axum::body::to_bytes(resp_leave.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_l: Value = serde_json::from_slice(&body_l).unwrap();
    assert_eq!(json_l["outcome"], "left");

    // Assert room_members no longer contains Bob
    let count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM room_members WHERE room_id = ? AND user_id = ?")
            .bind(room_id)
            .bind(&user_b_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(count, 0);
}

#[tokio::test]
async fn test_14_leave_room_as_owner_with_other_members_transfers_ownership() {
    let (app, pool) = setup_test_app().await;
    let (_user_a_id, token_a) =
        create_test_user(&app, &pool, "alice", "device_client_id_a_12345").await;
    let (user_b_id, token_b) =
        create_test_user(&app, &pool, "bob", "device_client_id_b_12345").await;
    let (user_c_id, _token_c) =
        create_test_user(&app, &pool, "charlie", "device_client_id_c_12345").await;

    // Create room, add Bob then Charlie
    let req_create = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({}).to_string()))
        .unwrap();
    let resp_create = app.clone().oneshot(req_create).await.unwrap();
    let body_c = axum::body::to_bytes(resp_create.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_c: Value = serde_json::from_slice(&body_c).unwrap();
    let room_id = json_c["id"].as_str().unwrap();

    let req_add_b = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/members", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "user_id": user_b_id }).to_string()))
        .unwrap();
    app.clone().oneshot(req_add_b).await.unwrap();

    let req_add_c = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/members", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "user_id": user_c_id }).to_string()))
        .unwrap();
    app.clone().oneshot(req_add_c).await.unwrap();

    // Alice leaves
    let req_leave = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/leave", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();
    let resp_leave = app.clone().oneshot(req_leave).await.unwrap();
    assert_eq!(resp_leave.status(), StatusCode::OK);

    let body_l = axum::body::to_bytes(resp_leave.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_l: Value = serde_json::from_slice(&body_l).unwrap();
    assert_eq!(json_l["outcome"], "transferred_ownership");
    assert_eq!(json_l["new_owner_id"], user_b_id);

    // Confirm room owner_id is Bob and Bob's role is owner
    let owner_id: String = sqlx::query_scalar("SELECT owner_id FROM rooms WHERE id = ?")
        .bind(room_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(owner_id, user_b_id);

    let req_get_b = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/rooms/{}", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_b))
        .body(Body::empty())
        .unwrap();
    let resp_get_b = app.oneshot(req_get_b).await.unwrap();
    let body_gb = axum::body::to_bytes(resp_get_b.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_gb: Value = serde_json::from_slice(&body_gb).unwrap();
    assert_eq!(json_gb["current_user_role"], "owner");
}

#[tokio::test]
async fn test_15_leave_room_as_owner_transfers_to_moderator() {
    let (app, pool) = setup_test_app().await;
    let (_user_a_id, token_a) =
        create_test_user(&app, &pool, "alice", "device_client_id_a_12345").await;
    let (user_b_id, _token_b) =
        create_test_user(&app, &pool, "bob", "device_client_id_b_12345").await;
    let (user_c_id, _token_c) =
        create_test_user(&app, &pool, "charlie", "device_client_id_c_12345").await;

    // Create room, add Bob then Charlie
    let req_create = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({}).to_string()))
        .unwrap();
    let resp_create = app.clone().oneshot(req_create).await.unwrap();
    let body_c = axum::body::to_bytes(resp_create.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_c: Value = serde_json::from_slice(&body_c).unwrap();
    let room_id = json_c["id"].as_str().unwrap();

    let req_add_b = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/members", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "user_id": user_b_id }).to_string()))
        .unwrap();
    app.clone().oneshot(req_add_b).await.unwrap();

    let req_add_c = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/members", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "user_id": user_c_id }).to_string()))
        .unwrap();
    app.clone().oneshot(req_add_c).await.unwrap();

    // Manually set Charlie's role to 'moderator'
    sqlx::query("UPDATE room_members SET role = 'moderator' WHERE room_id = ? AND user_id = ?")
        .bind(room_id)
        .bind(&user_c_id)
        .execute(&pool)
        .await
        .unwrap();

    // Alice leaves -> Charlie (moderator) takes precedence over Bob (member) even though Bob joined earlier
    let req_leave = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/leave", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();
    let resp_leave = app.oneshot(req_leave).await.unwrap();
    assert_eq!(resp_leave.status(), StatusCode::OK);

    let body_l = axum::body::to_bytes(resp_leave.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_l: Value = serde_json::from_slice(&body_l).unwrap();
    assert_eq!(json_l["outcome"], "transferred_ownership");
    assert_eq!(json_l["new_owner_id"], user_c_id);
}

#[tokio::test]
async fn test_16_leave_room_as_last_member_deletes_room() {
    let (app, pool) = setup_test_app().await;
    let (_user_a_id, token_a) =
        create_test_user(&app, &pool, "alice", "device_client_id_a_12345").await;

    // Create room
    let req_create = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({}).to_string()))
        .unwrap();
    let resp_create = app.clone().oneshot(req_create).await.unwrap();
    let body_c = axum::body::to_bytes(resp_create.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_c: Value = serde_json::from_slice(&body_c).unwrap();
    let room_id = json_c["id"].as_str().unwrap();

    // Alice leaves (sole member)
    let req_leave = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/leave", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();
    let resp_leave = app.oneshot(req_leave).await.unwrap();
    assert_eq!(resp_leave.status(), StatusCode::OK);

    let body_l = axum::body::to_bytes(resp_leave.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_l: Value = serde_json::from_slice(&body_l).unwrap();
    assert_eq!(json_l["outcome"], "room_deleted");

    // Room no longer exists
    let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM rooms WHERE id = ?)")
        .bind(room_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert!(!exists);
}

#[tokio::test]
async fn test_17_leave_room_as_non_member_returns_400() {
    let (app, pool) = setup_test_app().await;
    let (_user_a_id, token_a) =
        create_test_user(&app, &pool, "alice", "device_client_id_a_12345").await;
    let (_user_b_id, token_b) =
        create_test_user(&app, &pool, "bob", "device_client_id_b_12345").await;

    // Create room as Alice
    let req_create = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({}).to_string()))
        .unwrap();
    let resp_create = app.clone().oneshot(req_create).await.unwrap();
    let body_c = axum::body::to_bytes(resp_create.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_c: Value = serde_json::from_slice(&body_c).unwrap();
    let room_id = json_c["id"].as_str().unwrap();

    // Bob (non-member) leaves -> 400 not_a_member
    let req_leave = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/leave", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_b))
        .body(Body::empty())
        .unwrap();
    let resp_leave = app.oneshot(req_leave).await.unwrap();
    assert_eq!(resp_leave.status(), StatusCode::BAD_REQUEST);

    let body_l = axum::body::to_bytes(resp_leave.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_l: Value = serde_json::from_slice(&body_l).unwrap();
    assert_eq!(json_l["error"], "not_a_member");
}

#[tokio::test]
async fn test_18_list_members_succeeds() {
    let (app, pool) = setup_test_app().await;
    let (_user_a_id, token_a) =
        create_test_user(&app, &pool, "alice", "device_client_id_a_12345").await;
    let (user_b_id, _token_b) =
        create_test_user(&app, &pool, "bob", "device_client_id_b_12345").await;

    // Create room, add Bob
    let req_create = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({}).to_string()))
        .unwrap();
    let resp_create = app.clone().oneshot(req_create).await.unwrap();
    let body_c = axum::body::to_bytes(resp_create.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_c: Value = serde_json::from_slice(&body_c).unwrap();
    let room_id = json_c["id"].as_str().unwrap();

    let req_add = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/members", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "user_id": user_b_id }).to_string()))
        .unwrap();
    app.clone().oneshot(req_add).await.unwrap();

    // GET members
    let req_mem = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/rooms/{}/members", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();
    let resp_mem = app.oneshot(req_mem).await.unwrap();
    assert_eq!(resp_mem.status(), StatusCode::OK);

    let body_m = axum::body::to_bytes(resp_mem.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_m: Value = serde_json::from_slice(&body_m).unwrap();
    let members = json_m["members"].as_array().unwrap();

    assert_eq!(members.len(), 2);
    assert!(members[0]["username_token"].is_string());
    assert_eq!(members[0]["role"], "owner");
    assert!(members[1]["username_token"].is_string());
    assert_eq!(members[1]["role"], "member");
}

#[tokio::test]
async fn test_19_list_members_as_non_member_returns_404() {
    let (app, pool) = setup_test_app().await;
    let (_user_a_id, token_a) =
        create_test_user(&app, &pool, "alice", "device_client_id_a_12345").await;
    let (_user_b_id, token_b) =
        create_test_user(&app, &pool, "bob", "device_client_id_b_12345").await;

    // Create room
    let req_create = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({}).to_string()))
        .unwrap();
    let resp_create = app.clone().oneshot(req_create).await.unwrap();
    let body_c = axum::body::to_bytes(resp_create.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_c: Value = serde_json::from_slice(&body_c).unwrap();
    let room_id = json_c["id"].as_str().unwrap();

    // Bob (non-member) lists members -> 404
    let req_mem = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/rooms/{}/members", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_b))
        .body(Body::empty())
        .unwrap();
    let resp_mem = app.oneshot(req_mem).await.unwrap();
    assert_eq!(resp_mem.status(), StatusCode::NOT_FOUND);

    let body_bytes = axum::body::to_bytes(resp_mem.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(json["error"], "room_not_found");
}

#[tokio::test]
async fn test_20_add_member_as_owner_succeeds() {
    let (app, pool) = setup_test_app().await;
    let (_user_a_id, token_a) =
        create_test_user(&app, &pool, "alice", "device_client_id_a_12345").await;
    let (user_b_id, _token_b) =
        create_test_user(&app, &pool, "bob", "device_client_id_b_12345").await;

    // Create room
    let req_create = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({}).to_string()))
        .unwrap();
    let resp_create = app.clone().oneshot(req_create).await.unwrap();
    let body_c = axum::body::to_bytes(resp_create.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_c: Value = serde_json::from_slice(&body_c).unwrap();
    let room_id = json_c["id"].as_str().unwrap();

    // Add Bob
    let req_add = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/members", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "user_id": user_b_id }).to_string()))
        .unwrap();
    let resp_add = app.oneshot(req_add).await.unwrap();
    assert_eq!(resp_add.status(), StatusCode::CREATED);

    let body_a = axum::body::to_bytes(resp_add.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_a: Value = serde_json::from_slice(&body_a).unwrap();

    assert_eq!(json_a["user_id"], user_b_id);
    assert!(json_a["username_token"].is_string());
    assert_eq!(json_a["role"], "member");
}

#[tokio::test]
async fn test_21_add_member_as_regular_member_returns_403() {
    let (app, pool) = setup_test_app().await;
    let (_user_a_id, token_a) =
        create_test_user(&app, &pool, "alice", "device_client_id_a_12345").await;
    let (user_b_id, token_b) =
        create_test_user(&app, &pool, "bob", "device_client_id_b_12345").await;
    let (user_c_id, _token_c) =
        create_test_user(&app, &pool, "charlie", "device_client_id_c_12345").await;

    // Create room, add Bob
    let req_create = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({}).to_string()))
        .unwrap();
    let resp_create = app.clone().oneshot(req_create).await.unwrap();
    let body_c = axum::body::to_bytes(resp_create.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_c: Value = serde_json::from_slice(&body_c).unwrap();
    let room_id = json_c["id"].as_str().unwrap();

    let req_add_b = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/members", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "user_id": user_b_id }).to_string()))
        .unwrap();
    app.clone().oneshot(req_add_b).await.unwrap();

    // Bob (regular member) attempts to add Charlie -> 403
    let req_add_c = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/members", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_b))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "user_id": user_c_id }).to_string()))
        .unwrap();
    let resp_add_c = app.oneshot(req_add_c).await.unwrap();
    assert_eq!(resp_add_c.status(), StatusCode::FORBIDDEN);

    let body_bytes = axum::body::to_bytes(resp_add_c.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(json["error"], "forbidden");
}

#[tokio::test]
async fn test_22_add_member_as_non_member_returns_404() {
    let (app, pool) = setup_test_app().await;
    let (_user_a_id, token_a) =
        create_test_user(&app, &pool, "alice", "device_client_id_a_12345").await;
    let (_user_b_id, token_b) =
        create_test_user(&app, &pool, "bob", "device_client_id_b_12345").await;
    let (user_c_id, _token_c) =
        create_test_user(&app, &pool, "charlie", "device_client_id_c_12345").await;

    // Create room
    let req_create = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({}).to_string()))
        .unwrap();
    let resp_create = app.clone().oneshot(req_create).await.unwrap();
    let body_c = axum::body::to_bytes(resp_create.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_c: Value = serde_json::from_slice(&body_c).unwrap();
    let room_id = json_c["id"].as_str().unwrap();

    // Bob (non-member) attempts to add Charlie -> 404
    let req_add = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/members", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_b))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "user_id": user_c_id }).to_string()))
        .unwrap();
    let resp_add = app.oneshot(req_add).await.unwrap();
    assert_eq!(resp_add.status(), StatusCode::NOT_FOUND);

    let body_bytes = axum::body::to_bytes(resp_add.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(json["error"], "room_not_found");
}

#[tokio::test]
async fn test_23_add_existing_member_returns_409() {
    let (app, pool) = setup_test_app().await;
    let (_user_a_id, token_a) =
        create_test_user(&app, &pool, "alice", "device_client_id_a_12345").await;
    let (user_b_id, _token_b) =
        create_test_user(&app, &pool, "bob", "device_client_id_b_12345").await;

    // Create room, add Bob
    let req_create = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({}).to_string()))
        .unwrap();
    let resp_create = app.clone().oneshot(req_create).await.unwrap();
    let body_c = axum::body::to_bytes(resp_create.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_c: Value = serde_json::from_slice(&body_c).unwrap();
    let room_id = json_c["id"].as_str().unwrap();

    let req_add1 = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/members", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "user_id": user_b_id }).to_string()))
        .unwrap();
    app.clone().oneshot(req_add1).await.unwrap();

    // Alice attempts to add Bob again -> 409
    let req_add2 = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/members", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "user_id": user_b_id }).to_string()))
        .unwrap();
    let resp_add2 = app.oneshot(req_add2).await.unwrap();
    assert_eq!(resp_add2.status(), StatusCode::CONFLICT);

    let body_bytes = axum::body::to_bytes(resp_add2.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(json["error"], "already_member");
}

#[tokio::test]
async fn test_24_add_non_existent_user_returns_404() {
    let (app, pool) = setup_test_app().await;
    let (_user_a_id, token_a) =
        create_test_user(&app, &pool, "alice", "device_client_id_a_12345").await;

    // Create room
    let req_create = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({}).to_string()))
        .unwrap();
    let resp_create = app.clone().oneshot(req_create).await.unwrap();
    let body_c = axum::body::to_bytes(resp_create.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_c: Value = serde_json::from_slice(&body_c).unwrap();
    let room_id = json_c["id"].as_str().unwrap();

    // Alice attempts to add unknown user ID -> 404
    let req_add = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/members", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({ "user_id": "non_existent_user_id_999" }).to_string(),
        ))
        .unwrap();
    let resp_add = app.oneshot(req_add).await.unwrap();
    assert_eq!(resp_add.status(), StatusCode::NOT_FOUND);

    let body_bytes = axum::body::to_bytes(resp_add.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(json["error"], "user_not_found");
}

#[tokio::test]
async fn test_25_add_deleted_user_returns_404() {
    let (app, pool) = setup_test_app().await;
    let (_user_a_id, token_a) =
        create_test_user(&app, &pool, "alice", "device_client_id_a_12345").await;
    let (user_b_id, _token_b) =
        create_test_user(&app, &pool, "bob", "device_client_id_b_12345").await;

    // Create room
    let req_create = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({}).to_string()))
        .unwrap();
    let resp_create = app.clone().oneshot(req_create).await.unwrap();
    let body_c = axum::body::to_bytes(resp_create.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_c: Value = serde_json::from_slice(&body_c).unwrap();
    let room_id = json_c["id"].as_str().unwrap();

    // Mark Bob as deleted
    sqlx::query("UPDATE users SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?")
        .bind(&user_b_id)
        .execute(&pool)
        .await
        .unwrap();

    // Alice attempts to add Bob's ID -> 404
    let req_add = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/members", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "user_id": user_b_id }).to_string()))
        .unwrap();
    let resp_add = app.oneshot(req_add).await.unwrap();
    assert_eq!(resp_add.status(), StatusCode::NOT_FOUND);

    let body_bytes = axum::body::to_bytes(resp_add.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(json["error"], "user_not_found");
}

#[tokio::test]
async fn test_26_room_size_limit_is_enforced() {
    let (app, pool) = setup_test_app().await;
    let (user_a_id, token_a) =
        create_test_user(&app, &pool, "alice", "device_client_id_a_12345").await;
    let (user_b_id, _token_b) =
        create_test_user(&app, &pool, "bob", "device_client_id_b_12345").await;
    let (user_c_id, _token_c) =
        create_test_user(&app, &pool, "charlie", "device_client_id_c_12345").await;

    // Set instance room_size limit to 2
    sqlx::query(
        "INSERT INTO instance_limits (key, value, updated_by) VALUES ('room_size', '2', ?)",
    )
    .bind(&user_a_id)
    .execute(&pool)
    .await
    .unwrap();

    // Create room (size = 1)
    let req_create = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({}).to_string()))
        .unwrap();
    let resp_create = app.clone().oneshot(req_create).await.unwrap();
    let body_c = axum::body::to_bytes(resp_create.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_c: Value = serde_json::from_slice(&body_c).unwrap();
    let room_id = json_c["id"].as_str().unwrap();

    // Add Bob (size = 2)
    let req_add_b = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/members", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "user_id": user_b_id }).to_string()))
        .unwrap();
    let resp_add_b = app.clone().oneshot(req_add_b).await.unwrap();
    assert_eq!(resp_add_b.status(), StatusCode::CREATED);

    // Attempt to add Charlie (would exceed size 2) -> 409
    let req_add_c = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/members", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "user_id": user_c_id }).to_string()))
        .unwrap();
    let resp_add_c = app.oneshot(req_add_c).await.unwrap();
    assert_eq!(resp_add_c.status(), StatusCode::CONFLICT);

    let body_bytes = axum::body::to_bytes(resp_add_c.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(json["error"], "room_full");
}

#[tokio::test]
async fn test_27_room_size_limit_clamps_to_server_hard_max() {
    let (app, pool) = setup_test_app().await;
    let (user_a_id, token_a) =
        create_test_user(&app, &pool, "alice", "device_client_id_a_12345").await;
    let (user_b_id, _token_b) =
        create_test_user(&app, &pool, "bob", "device_client_id_b_12345").await;

    // Set instance room_size limit to 1 (below minimum or small for testing clamp logic)
    sqlx::query(
        "INSERT INTO instance_limits (key, value, updated_by) VALUES ('room_size', '1', ?)",
    )
    .bind(&user_a_id)
    .execute(&pool)
    .await
    .unwrap();

    // Create room (size = 1)
    let req_create = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({}).to_string()))
        .unwrap();
    let resp_create = app.clone().oneshot(req_create).await.unwrap();
    let body_c = axum::body::to_bytes(resp_create.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_c: Value = serde_json::from_slice(&body_c).unwrap();
    let room_id = json_c["id"].as_str().unwrap();

    // Adding Bob when limit is 1 fails with room_full
    let req_add_b = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/members", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "user_id": user_b_id }).to_string()))
        .unwrap();
    let resp_add_b = app.oneshot(req_add_b).await.unwrap();
    assert_eq!(resp_add_b.status(), StatusCode::CONFLICT);
}

#[tokio::test]
async fn test_28_retention_clamp_applies() {
    let (app, pool) = setup_test_app().await;
    let (user_a_id, token_a) =
        create_test_user(&app, &pool, "alice", "device_client_id_a_12345").await;

    // Set instance attachment_retention_days: 30
    sqlx::query("INSERT INTO instance_limits (key, value, updated_by) VALUES ('attachment_retention_days', '30', ?)")
        .bind(&user_a_id)
        .execute(&pool)
        .await
        .unwrap();

    // Create room with retention_days: 100
    let req_create = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "retention_days": 100 }).to_string()))
        .unwrap();
    let resp_create = app.oneshot(req_create).await.unwrap();
    assert_eq!(resp_create.status(), StatusCode::CREATED);

    let body_c = axum::body::to_bytes(resp_create.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_c: Value = serde_json::from_slice(&body_c).unwrap();

    // Assert stored value is 30
    assert_eq!(json_c["retention_days"], 30);
}

#[tokio::test]
async fn test_29_file_size_clamp_applies() {
    let (app, pool) = setup_test_app().await;
    let (user_a_id, token_a) =
        create_test_user(&app, &pool, "alice", "device_client_id_a_12345").await;

    // Set instance file_size_bytes: 10000000
    sqlx::query("INSERT INTO instance_limits (key, value, updated_by) VALUES ('file_size_bytes', '10000000', ?)")
        .bind(&user_a_id)
        .execute(&pool)
        .await
        .unwrap();

    // Create room with max_file_size_bytes: 50000000
    let req_create = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({ "max_file_size_bytes": 50000000 }).to_string(),
        ))
        .unwrap();
    let resp_create = app.oneshot(req_create).await.unwrap();
    assert_eq!(resp_create.status(), StatusCode::CREATED);

    let body_c = axum::body::to_bytes(resp_create.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_c: Value = serde_json::from_slice(&body_c).unwrap();

    // Assert stored value is 10000000
    assert_eq!(json_c["max_file_size_bytes"], 10000000);
}

#[tokio::test]
async fn test_30_effective_limits_no_overrides() {
    let (app, pool) = setup_test_app().await;
    let (user_a_id, token_a) =
        create_test_user(&app, &pool, "alice", "device_client_id_a_12345").await;

    sqlx::query("INSERT OR REPLACE INTO instance_limits (key, value, updated_by) VALUES ('file_size_bytes', '50000000', ?)")
        .bind(&user_a_id)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT OR REPLACE INTO instance_limits (key, value, updated_by) VALUES ('attachment_retention_days', '30', ?)")
        .bind(&user_a_id)
        .execute(&pool)
        .await
        .unwrap();

    let req_create = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({}).to_string()))
        .unwrap();
    let resp_create = app.clone().oneshot(req_create).await.unwrap();
    let body_c = axum::body::to_bytes(resp_create.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_c: Value = serde_json::from_slice(&body_c).unwrap();
    let room_id = json_c["id"].as_str().unwrap();

    let req_get = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/rooms/{}", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();
    let resp_get = app.oneshot(req_get).await.unwrap();
    assert_eq!(resp_get.status(), StatusCode::OK);

    let body_g = axum::body::to_bytes(resp_get.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_g: Value = serde_json::from_slice(&body_g).unwrap();

    assert_eq!(json_g["effective_max_file_size_bytes"], 50000000);
    assert_eq!(json_g["effective_message_retention_days"], 30);
}

#[tokio::test]
async fn test_31_effective_limits_override_below_instance_limit() {
    let (app, pool) = setup_test_app().await;
    let (user_a_id, token_a) =
        create_test_user(&app, &pool, "alice", "device_client_id_a_12345").await;

    sqlx::query("INSERT OR REPLACE INTO instance_limits (key, value, updated_by) VALUES ('file_size_bytes', '50000000', ?)")
        .bind(&user_a_id)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT OR REPLACE INTO instance_limits (key, value, updated_by) VALUES ('attachment_retention_days', '30', ?)")
        .bind(&user_a_id)
        .execute(&pool)
        .await
        .unwrap();

    let req_create = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "retention_days": 10,
                "max_file_size_bytes": 10000000
            })
            .to_string(),
        ))
        .unwrap();
    let resp_create = app.clone().oneshot(req_create).await.unwrap();
    let body_c = axum::body::to_bytes(resp_create.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_c: Value = serde_json::from_slice(&body_c).unwrap();
    let room_id = json_c["id"].as_str().unwrap();

    let req_get = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/rooms/{}", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();
    let resp_get = app.oneshot(req_get).await.unwrap();
    assert_eq!(resp_get.status(), StatusCode::OK);

    let body_g = axum::body::to_bytes(resp_get.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_g: Value = serde_json::from_slice(&body_g).unwrap();

    assert_eq!(json_g["effective_max_file_size_bytes"], 10000000);
    assert_eq!(json_g["effective_message_retention_days"], 10);
}

#[tokio::test]
async fn test_32_effective_limits_override_above_instance_limit_is_clamped() {
    let (app, pool) = setup_test_app().await;
    let (user_a_id, token_a) =
        create_test_user(&app, &pool, "alice", "device_client_id_a_12345").await;

    // First create a room with no overrides
    let req_create = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({}).to_string()))
        .unwrap();
    let resp_create = app.clone().oneshot(req_create).await.unwrap();
    let body_c = axum::body::to_bytes(resp_create.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_c: Value = serde_json::from_slice(&body_c).unwrap();
    let room_id = json_c["id"].as_str().unwrap();

    // Insert high values directly via SQL to simulate a stale override
    sqlx::query(
        "UPDATE rooms SET retention_days = 300, max_file_size_bytes = 200000000 WHERE id = ?",
    )
    .bind(room_id)
    .execute(&pool)
    .await
    .unwrap();

    sqlx::query("INSERT OR REPLACE INTO instance_limits (key, value, updated_by) VALUES ('file_size_bytes', '50000000', ?)")
        .bind(&user_a_id)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT OR REPLACE INTO instance_limits (key, value, updated_by) VALUES ('attachment_retention_days', '30', ?)")
        .bind(&user_a_id)
        .execute(&pool)
        .await
        .unwrap();

    let req_get = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/rooms/{}", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();
    let resp_get = app.oneshot(req_get).await.unwrap();
    assert_eq!(resp_get.status(), StatusCode::OK);

    let body_g = axum::body::to_bytes(resp_get.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_g: Value = serde_json::from_slice(&body_g).unwrap();

    assert_eq!(json_g["effective_max_file_size_bytes"], 50000000);
    assert_eq!(json_g["effective_message_retention_days"], 30);
}

#[tokio::test]
async fn test_33_effective_limits_instance_above_server_max_is_clamped() {
    let (app, pool) = setup_test_app().await;
    let (user_a_id, token_a) =
        create_test_user(&app, &pool, "alice", "device_client_id_a_12345").await;

    sqlx::query("INSERT OR REPLACE INTO instance_limits (key, value, updated_by) VALUES ('file_size_bytes', '999999999', ?)")
        .bind(&user_a_id)
        .execute(&pool)
        .await
        .unwrap();

    let req_create = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({}).to_string()))
        .unwrap();
    let resp_create = app.clone().oneshot(req_create).await.unwrap();
    let body_c = axum::body::to_bytes(resp_create.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_c: Value = serde_json::from_slice(&body_c).unwrap();
    let room_id = json_c["id"].as_str().unwrap();

    let req_get = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/rooms/{}", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();
    let resp_get = app.oneshot(req_get).await.unwrap();
    assert_eq!(resp_get.status(), StatusCode::OK);

    let body_g = axum::body::to_bytes(resp_get.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_g: Value = serde_json::from_slice(&body_g).unwrap();

    // Default ServerHardMax file_size_bytes is 104,857,600
    assert_eq!(json_g["effective_max_file_size_bytes"], 104857600);
}

#[tokio::test]
async fn test_34_effective_limits_retention_zero_is_absorbing() {
    let (app, pool) = setup_test_app().await;
    let (user_a_id, token_a) =
        create_test_user(&app, &pool, "alice", "device_client_id_a_12345").await;

    sqlx::query("INSERT OR REPLACE INTO instance_limits (key, value, updated_by) VALUES ('attachment_retention_days', '0', ?)")
        .bind(&user_a_id)
        .execute(&pool)
        .await
        .unwrap();

    let req_create = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "retention_days": 30 }).to_string()))
        .unwrap();
    let resp_create = app.clone().oneshot(req_create).await.unwrap();
    let body_c = axum::body::to_bytes(resp_create.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_c: Value = serde_json::from_slice(&body_c).unwrap();
    let room_id = json_c["id"].as_str().unwrap();

    let req_get = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/rooms/{}", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();
    let resp_get = app.oneshot(req_get).await.unwrap();
    assert_eq!(resp_get.status(), StatusCode::OK);

    let body_g = axum::body::to_bytes(resp_get.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_g: Value = serde_json::from_slice(&body_g).unwrap();

    assert_eq!(json_g["effective_message_retention_days"], 0);
}

#[tokio::test]
async fn test_35_effective_limits_room_zero_retention_wins() {
    let (app, pool) = setup_test_app().await;
    let (user_a_id, token_a) =
        create_test_user(&app, &pool, "alice", "device_client_id_a_12345").await;

    sqlx::query("INSERT OR REPLACE INTO instance_limits (key, value, updated_by) VALUES ('attachment_retention_days', '30', ?)")
        .bind(&user_a_id)
        .execute(&pool)
        .await
        .unwrap();

    let req_create = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "retention_days": 0 }).to_string()))
        .unwrap();
    let resp_create = app.clone().oneshot(req_create).await.unwrap();
    let body_c = axum::body::to_bytes(resp_create.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_c: Value = serde_json::from_slice(&body_c).unwrap();
    let room_id = json_c["id"].as_str().unwrap();

    let req_get = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/rooms/{}", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();
    let resp_get = app.oneshot(req_get).await.unwrap();
    assert_eq!(resp_get.status(), StatusCode::OK);

    let body_g = axum::body::to_bytes(resp_get.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_g: Value = serde_json::from_slice(&body_g).unwrap();

    assert_eq!(json_g["effective_message_retention_days"], 0);
}

#[tokio::test]
async fn test_36_effective_limits_returned_on_room_list() {
    let (app, pool) = setup_test_app().await;
    let (_user_a_id, token_a) =
        create_test_user(&app, &pool, "alice", "device_client_id_a_12345").await;

    let req_create1 = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({ "max_file_size_bytes": 10000000 }).to_string(),
        ))
        .unwrap();
    app.clone().oneshot(req_create1).await.unwrap();

    let req_create2 = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({ "max_file_size_bytes": 20000000 }).to_string(),
        ))
        .unwrap();
    app.clone().oneshot(req_create2).await.unwrap();

    let req_list = Request::builder()
        .method("GET")
        .uri("/api/v1/rooms")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();
    let resp_list = app.oneshot(req_list).await.unwrap();
    assert_eq!(resp_list.status(), StatusCode::OK);

    let body_l = axum::body::to_bytes(resp_list.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_l: Value = serde_json::from_slice(&body_l).unwrap();
    let rooms = json_l["rooms"].as_array().unwrap();

    assert_eq!(rooms.len(), 2);
    assert!(rooms[0]["effective_max_file_size_bytes"].is_number());
    assert!(rooms[0]["effective_message_retention_days"].is_number());
    assert!(rooms[1]["effective_max_file_size_bytes"].is_number());
    assert!(rooms[1]["effective_message_retention_days"].is_number());
}

#[tokio::test]
async fn test_37_other_room_fields_unchanged() {
    let (app, pool) = setup_test_app().await;
    let (user_a_id, token_a) =
        create_test_user(&app, &pool, "alice", "device_client_id_a_12345").await;

    let req_create = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({}).to_string()))
        .unwrap();
    let resp_create = app.clone().oneshot(req_create).await.unwrap();
    let body_c = axum::body::to_bytes(resp_create.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_c: Value = serde_json::from_slice(&body_c).unwrap();
    let room_id = json_c["id"].as_str().unwrap();

    let req_get = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/rooms/{}", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();
    let resp_get = app.oneshot(req_get).await.unwrap();
    assert_eq!(resp_get.status(), StatusCode::OK);

    let body_g = axum::body::to_bytes(resp_get.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_g: Value = serde_json::from_slice(&body_g).unwrap();

    assert_eq!(json_g["id"], room_id);
    assert_eq!(json_g["owner_id"], user_a_id);
    assert_eq!(json_g["metadata"], Value::Null);
    assert_eq!(json_g["metadata_version"], 1);
    assert!(json_g["created_at"].is_string());
    assert_eq!(json_g["current_user_role"], "owner");
    assert_eq!(json_g["member_count"], 1);
}
