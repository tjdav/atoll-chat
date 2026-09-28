mod common;

use axum::{
    body::Body,
    http::{header, Request, StatusCode},
};
use common::{login_user, register_user, setup_test_app};
use serde_json::{json, Value};
use tower::ServiceExt;

#[tokio::test]
async fn test_01_kicking_member_queues_remove() {
    let (app, pool) = setup_test_app().await;

    let _user_a_id = register_user(&app, "alice", "password123", None).await;
    let (_, login_a) = login_user(&app, "alice", "password123", "client_a_123456789", None).await;
    let token_a = login_a["session_token"].as_str().unwrap();

    sqlx::query(
        "INSERT INTO server_invites (id, code, max_uses, current_uses) VALUES ('inv_1', 'INVITE123', 1, 0)",
    )
    .execute(&pool)
    .await
    .unwrap();

    let user_b_id = register_user(&app, "bob", "password123", Some("INVITE123")).await;
    login_user(&app, "bob", "password123", "client_b_123456789", None).await;

    // Alice creates room
    let req_create = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from("{}"))
        .unwrap();

    let resp_create = app.clone().oneshot(req_create).await.unwrap();
    let body_bytes = axum::body::to_bytes(resp_create.into_body(), usize::MAX)
        .await
        .unwrap();
    let room_json: Value = serde_json::from_slice(&body_bytes).unwrap();
    let room_id = room_json["id"].as_str().unwrap();

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

    // Alice kicks Bob
    let req_kick = Request::builder()
        .method("DELETE")
        .uri(format!("/api/v1/rooms/{}/members/{}", room_id, user_b_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();

    let resp_kick = app.clone().oneshot(req_kick).await.unwrap();
    assert_eq!(resp_kick.status(), StatusCode::NO_CONTENT);

    // Alice lists pending removes
    let req_list = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/rooms/{}/pending-removes", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();

    let resp_list = app.clone().oneshot(req_list).await.unwrap();
    assert_eq!(resp_list.status(), StatusCode::OK);

    let list_bytes = axum::body::to_bytes(resp_list.into_body(), usize::MAX)
        .await
        .unwrap();
    let list_json: Value = serde_json::from_slice(&list_bytes).unwrap();
    let removes = list_json["removes"].as_array().unwrap();

    assert_eq!(removes.len(), 1);
    assert_eq!(removes[0]["target_user_id"], user_b_id);
    assert_eq!(removes[0]["target_client_id"], "client_b_123456789");
}

#[tokio::test]
async fn test_02_multiple_devices_queue_multiple_removes() {
    let (app, pool) = setup_test_app().await;

    let _user_a_id = register_user(&app, "alice", "password123", None).await;
    let (_, login_a) = login_user(&app, "alice", "password123", "client_a_123456789", None).await;
    let token_a = login_a["session_token"].as_str().unwrap();

    sqlx::query(
        "INSERT INTO server_invites (id, code, max_uses, current_uses) VALUES ('inv_1', 'INVITE123', 1, 0)",
    )
    .execute(&pool)
    .await
    .unwrap();

    let user_b_id = register_user(&app, "bob", "password123", Some("INVITE123")).await;
    login_user(&app, "bob", "password123", "client_b_device_1", None).await;
    login_user(&app, "bob", "password123", "client_b_device_2", None).await;

    // Alice creates room
    let req_create = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from("{}"))
        .unwrap();

    let resp_create = app.clone().oneshot(req_create).await.unwrap();
    let body_bytes = axum::body::to_bytes(resp_create.into_body(), usize::MAX)
        .await
        .unwrap();
    let room_json: Value = serde_json::from_slice(&body_bytes).unwrap();
    let room_id = room_json["id"].as_str().unwrap();

    // Alice adds Bob
    let req_add = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/members", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "user_id": user_b_id }).to_string()))
        .unwrap();

    app.clone().oneshot(req_add).await.unwrap();

    // Alice kicks Bob
    let req_kick = Request::builder()
        .method("DELETE")
        .uri(format!("/api/v1/rooms/{}/members/{}", room_id, user_b_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();

    app.clone().oneshot(req_kick).await.unwrap();

    // Alice lists pending removes
    let req_list = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/rooms/{}/pending-removes", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();

    let resp_list = app.clone().oneshot(req_list).await.unwrap();
    let list_bytes = axum::body::to_bytes(resp_list.into_body(), usize::MAX)
        .await
        .unwrap();
    let list_json: Value = serde_json::from_slice(&list_bytes).unwrap();
    let removes = list_json["removes"].as_array().unwrap();

    assert_eq!(removes.len(), 2);
}

#[tokio::test]
async fn test_03_non_member_cannot_list() {
    let (app, pool) = setup_test_app().await;

    register_user(&app, "alice", "password123", None).await;
    let (_, login_a) = login_user(&app, "alice", "password123", "client_a_123456789", None).await;
    let token_a = login_a["session_token"].as_str().unwrap();

    sqlx::query(
        "INSERT INTO server_invites (id, code, max_uses, current_uses) VALUES ('inv_1', 'INVITE123', 1, 0)",
    )
    .execute(&pool)
    .await
    .unwrap();

    register_user(&app, "bob", "password123", Some("INVITE123")).await;
    let (_, login_b) = login_user(&app, "bob", "password123", "client_b_123456789", None).await;
    let token_b = login_b["session_token"].as_str().unwrap();

    // Alice creates room
    let req_create = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from("{}"))
        .unwrap();

    let resp_create = app.clone().oneshot(req_create).await.unwrap();
    let body_bytes = axum::body::to_bytes(resp_create.into_body(), usize::MAX)
        .await
        .unwrap();
    let room_json: Value = serde_json::from_slice(&body_bytes).unwrap();
    let room_id = room_json["id"].as_str().unwrap();

    // Bob (non-member) tries to list pending removes
    let req_list = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/rooms/{}/pending-removes", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_b))
        .body(Body::empty())
        .unwrap();

    let resp_list = app.clone().oneshot(req_list).await.unwrap();
    assert_eq!(resp_list.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn test_04_consuming_marks_the_row() {
    let (app, pool) = setup_test_app().await;

    let _user_a_id = register_user(&app, "alice", "password123", None).await;
    let (_, login_a) = login_user(&app, "alice", "password123", "client_a_123456789", None).await;
    let token_a = login_a["session_token"].as_str().unwrap();

    sqlx::query(
        "INSERT INTO server_invites (id, code, max_uses, current_uses) VALUES ('inv_1', 'INVITE123', 1, 0)",
    )
    .execute(&pool)
    .await
    .unwrap();

    let user_b_id = register_user(&app, "bob", "password123", Some("INVITE123")).await;
    login_user(&app, "bob", "password123", "client_b_123456789", None).await;

    // Alice creates room and adds/kicks Bob
    let req_create = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from("{}"))
        .unwrap();

    let resp_create = app.clone().oneshot(req_create).await.unwrap();
    let body_bytes = axum::body::to_bytes(resp_create.into_body(), usize::MAX)
        .await
        .unwrap();
    let room_json: Value = serde_json::from_slice(&body_bytes).unwrap();
    let room_id = room_json["id"].as_str().unwrap();

    let req_add = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/members", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "user_id": user_b_id }).to_string()))
        .unwrap();
    app.clone().oneshot(req_add).await.unwrap();

    let req_kick = Request::builder()
        .method("DELETE")
        .uri(format!("/api/v1/rooms/{}/members/{}", room_id, user_b_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();
    app.clone().oneshot(req_kick).await.unwrap();

    // Alice fetches remove ID
    let req_list = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/rooms/{}/pending-removes", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();

    let resp_list = app.clone().oneshot(req_list).await.unwrap();
    let list_bytes = axum::body::to_bytes(resp_list.into_body(), usize::MAX)
        .await
        .unwrap();
    let list_json: Value = serde_json::from_slice(&list_bytes).unwrap();
    let remove_id = list_json["removes"][0]["id"].as_str().unwrap();

    // Alice consumes remove
    let req_consume = Request::builder()
        .method("POST")
        .uri(format!(
            "/api/v1/rooms/{}/pending-removes/{}/consume",
            room_id, remove_id
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();

    let resp_consume = app.clone().oneshot(req_consume).await.unwrap();
    assert_eq!(resp_consume.status(), StatusCode::NO_CONTENT);

    // List again -> empty
    let req_list2 = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/rooms/{}/pending-removes", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();

    let resp_list2 = app.clone().oneshot(req_list2).await.unwrap();
    let list_bytes2 = axum::body::to_bytes(resp_list2.into_body(), usize::MAX)
        .await
        .unwrap();
    let list_json2: Value = serde_json::from_slice(&list_bytes2).unwrap();
    assert_eq!(list_json2["removes"].as_array().unwrap().len(), 0);
}

#[tokio::test]
async fn test_05_consuming_twice_returns_404() {
    let (app, pool) = setup_test_app().await;

    let _user_a_id = register_user(&app, "alice", "password123", None).await;
    let (_, login_a) = login_user(&app, "alice", "password123", "client_a_123456789", None).await;
    let token_a = login_a["session_token"].as_str().unwrap();

    sqlx::query(
        "INSERT INTO server_invites (id, code, max_uses, current_uses) VALUES ('inv_1', 'INVITE123', 1, 0)",
    )
    .execute(&pool)
    .await
    .unwrap();

    let user_b_id = register_user(&app, "bob", "password123", Some("INVITE123")).await;
    login_user(&app, "bob", "password123", "client_b_123456789", None).await;

    let req_create = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from("{}"))
        .unwrap();

    let resp_create = app.clone().oneshot(req_create).await.unwrap();
    let body_bytes = axum::body::to_bytes(resp_create.into_body(), usize::MAX)
        .await
        .unwrap();
    let room_json: Value = serde_json::from_slice(&body_bytes).unwrap();
    let room_id = room_json["id"].as_str().unwrap();

    let req_add = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/members", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "user_id": user_b_id }).to_string()))
        .unwrap();
    app.clone().oneshot(req_add).await.unwrap();

    let req_kick = Request::builder()
        .method("DELETE")
        .uri(format!("/api/v1/rooms/{}/members/{}", room_id, user_b_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();
    app.clone().oneshot(req_kick).await.unwrap();

    let req_list = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/rooms/{}/pending-removes", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();

    let resp_list = app.clone().oneshot(req_list).await.unwrap();
    let list_bytes = axum::body::to_bytes(resp_list.into_body(), usize::MAX)
        .await
        .unwrap();
    let list_json: Value = serde_json::from_slice(&list_bytes).unwrap();
    let remove_id = list_json["removes"][0]["id"].as_str().unwrap();

    // Consume once
    let req_consume1 = Request::builder()
        .method("POST")
        .uri(format!(
            "/api/v1/rooms/{}/pending-removes/{}/consume",
            room_id, remove_id
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();

    let resp_consume1 = app.clone().oneshot(req_consume1).await.unwrap();
    assert_eq!(resp_consume1.status(), StatusCode::NO_CONTENT);

    // Consume twice
    let req_consume2 = Request::builder()
        .method("POST")
        .uri(format!(
            "/api/v1/rooms/{}/pending-removes/{}/consume",
            room_id, remove_id
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();

    let resp_consume2 = app.clone().oneshot(req_consume2).await.unwrap();
    assert_eq!(resp_consume2.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn test_06_consuming_another_room_remove_returns_404() {
    let (app, pool) = setup_test_app().await;

    let _user_a_id = register_user(&app, "alice", "password123", None).await;
    let (_, login_a) = login_user(&app, "alice", "password123", "client_a_123456789", None).await;
    let token_a = login_a["session_token"].as_str().unwrap();

    sqlx::query(
        "INSERT INTO server_invites (id, code, max_uses, current_uses) VALUES ('inv_1', 'INVITE123', 1, 0)",
    )
    .execute(&pool)
    .await
    .unwrap();

    let user_b_id = register_user(&app, "bob", "password123", Some("INVITE123")).await;
    login_user(&app, "bob", "password123", "client_b_123456789", None).await;

    // Create Room 1 and Room 2
    let req_c1 = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from("{}"))
        .unwrap();

    let resp_c1 = app.clone().oneshot(req_c1).await.unwrap();
    let bytes1 = axum::body::to_bytes(resp_c1.into_body(), usize::MAX)
        .await
        .unwrap();
    let room1_id = serde_json::from_slice::<Value>(&bytes1).unwrap()["id"]
        .as_str()
        .unwrap()
        .to_string();

    let req_c2 = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from("{}"))
        .unwrap();

    let resp_c2 = app.clone().oneshot(req_c2).await.unwrap();
    let bytes2 = axum::body::to_bytes(resp_c2.into_body(), usize::MAX)
        .await
        .unwrap();
    let room2_id = serde_json::from_slice::<Value>(&bytes2).unwrap()["id"]
        .as_str()
        .unwrap()
        .to_string();

    // Add & kick Bob in Room 1
    let req_add = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/members", room1_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "user_id": user_b_id }).to_string()))
        .unwrap();
    app.clone().oneshot(req_add).await.unwrap();

    let req_kick = Request::builder()
        .method("DELETE")
        .uri(format!("/api/v1/rooms/{}/members/{}", room1_id, user_b_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();
    app.clone().oneshot(req_kick).await.unwrap();

    // Get remove ID from Room 1
    let req_list = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/rooms/{}/pending-removes", room1_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();

    let resp_list = app.clone().oneshot(req_list).await.unwrap();
    let list_bytes = axum::body::to_bytes(resp_list.into_body(), usize::MAX)
        .await
        .unwrap();
    let remove_id = serde_json::from_slice::<Value>(&list_bytes).unwrap()["removes"][0]["id"]
        .as_str()
        .unwrap()
        .to_string();

    // Try consuming Room 1's remove using Room 2's URL
    let req_consume = Request::builder()
        .method("POST")
        .uri(format!(
            "/api/v1/rooms/{}/pending-removes/{}/consume",
            room2_id, remove_id
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();

    let resp_consume = app.clone().oneshot(req_consume).await.unwrap();
    assert_eq!(resp_consume.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn test_07_cascade_on_room_delete() {
    let (app, pool) = setup_test_app().await;

    let _user_a_id = register_user(&app, "alice", "password123", None).await;
    let (_, login_a) = login_user(&app, "alice", "password123", "client_a_123456789", None).await;
    let token_a = login_a["session_token"].as_str().unwrap();

    sqlx::query(
        "INSERT INTO server_invites (id, code, max_uses, current_uses) VALUES ('inv_1', 'INVITE123', 1, 0)",
    )
    .execute(&pool)
    .await
    .unwrap();

    let user_b_id = register_user(&app, "bob", "password123", Some("INVITE123")).await;
    login_user(&app, "bob", "password123", "client_b_123456789", None).await;

    let req_create = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from("{}"))
        .unwrap();

    let resp_create = app.clone().oneshot(req_create).await.unwrap();
    let body_bytes = axum::body::to_bytes(resp_create.into_body(), usize::MAX)
        .await
        .unwrap();
    let room_json: Value = serde_json::from_slice(&body_bytes).unwrap();
    let room_id = room_json["id"].as_str().unwrap();

    let req_add = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/members", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "user_id": user_b_id }).to_string()))
        .unwrap();
    app.clone().oneshot(req_add).await.unwrap();

    let req_kick = Request::builder()
        .method("DELETE")
        .uri(format!("/api/v1/rooms/{}/members/{}", room_id, user_b_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();
    app.clone().oneshot(req_kick).await.unwrap();

    // Verify row exists
    let count1: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM pending_mls_removes WHERE room_id = ?")
            .bind(room_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(count1, 1);

    // Delete room
    let req_del = Request::builder()
        .method("DELETE")
        .uri(format!("/api/v1/rooms/{}", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();
    app.clone().oneshot(req_del).await.unwrap();

    // Verify row deleted via CASCADE
    let count2: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM pending_mls_removes WHERE room_id = ?")
            .bind(room_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(count2, 0);
}
