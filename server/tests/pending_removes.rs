mod common;

use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use serde_json::{json, Value};

#[tokio::test]
async fn test_pending_removes_workflow() {
    let (app, pool, _) = common::setup_test_app_with_config(true, "auto", 100).await;

    // Register User A (owner)
    let user_a_id = common::register_user(&app, "usera", "Password123!", None).await;
    let (status_a, login_a) =
        common::login_user(&app, "usera", "Password123!", "client_a_123456789", None).await;
    assert_eq!(status_a, StatusCode::OK);
    let token_a = login_a["session_token"].as_str().unwrap();

    // Create server invites for B and C
    sqlx::query(
        "INSERT INTO server_invites (id, code, max_uses, current_uses) VALUES ('inv_b', 'INVITEB1234', 1, 0)",
    )
    .execute(&pool)
    .await
    .unwrap();

    sqlx::query(
        "INSERT INTO server_invites (id, code, max_uses, current_uses) VALUES ('inv_c', 'INVITEC1234', 1, 0)",
    )
    .execute(&pool)
    .await
    .unwrap();

    let user_b_id = common::register_user(&app, "userb", "Password123!", Some("INVITEB1234")).await;
    let (status_b1, _login_b1) =
        common::login_user(&app, "userb", "Password123!", "client_b_123456789", None).await;
    assert_eq!(status_b1, StatusCode::OK);

    // B logs in on second device
    let (status_b2, _login_b2) =
        common::login_user(&app, "userb", "Password123!", "client_b_987654321", None).await;
    assert_eq!(status_b2, StatusCode::OK);

    let _user_c_id =
        common::register_user(&app, "userc", "Password123!", Some("INVITEC1234")).await;
    let (status_c, login_c) =
        common::login_user(&app, "userc", "Password123!", "client_c_123456789", None).await;
    assert_eq!(status_c, StatusCode::OK);
    let token_c = login_c["session_token"].as_str().unwrap();

    // User A creates Room 1
    let create_room_req = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({}).to_string()))
        .unwrap();

    let resp = tower::ServiceExt::oneshot(app.clone(), create_room_req)
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED);
    let room_json: Value = serde_json::from_slice(
        &axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    let room_1_id = room_json["id"].as_str().unwrap();

    // 1. Empty list for fresh room
    let list_req = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/rooms/{}/pending-removes", room_1_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();

    let list_resp = tower::ServiceExt::oneshot(app.clone(), list_req)
        .await
        .unwrap();
    assert_eq!(list_resp.status(), StatusCode::OK);
    let list_json: Value = serde_json::from_slice(
        &axum::body::to_bytes(list_resp.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(list_json["removes"].as_array().unwrap().len(), 0);

    // 4. Non-member (User C) cannot list -> HTTP 404
    let list_req_c = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/rooms/{}/pending-removes", room_1_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_c))
        .body(Body::empty())
        .unwrap();

    let list_resp_c = tower::ServiceExt::oneshot(app.clone(), list_req_c)
        .await
        .unwrap();
    assert_eq!(list_resp_c.status(), StatusCode::NOT_FOUND);

    // 5. Non-member cannot consume -> HTTP 404
    let consume_req_c = Request::builder()
        .method("POST")
        .uri(format!(
            "/api/v1/rooms/{}/pending-removes/dummyid/consume",
            room_1_id
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_c))
        .body(Body::empty())
        .unwrap();

    let consume_resp_c = tower::ServiceExt::oneshot(app.clone(), consume_req_c)
        .await
        .unwrap();
    assert_eq!(consume_resp_c.status(), StatusCode::NOT_FOUND);

    // User A adds User B to Room 1
    let add_b_req = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/members", room_1_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "user_id": user_b_id }).to_string()))
        .unwrap();

    let add_b_resp = tower::ServiceExt::oneshot(app.clone(), add_b_req)
        .await
        .unwrap();
    assert_eq!(add_b_resp.status(), StatusCode::CREATED);

    // 2 & 3. Kicking User B (with 2 devices) queues 2 removes
    let kick_b_req = Request::builder()
        .method("DELETE")
        .uri(format!("/api/v1/rooms/{}/members/{}", room_1_id, user_b_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();

    let kick_b_resp = tower::ServiceExt::oneshot(app.clone(), kick_b_req)
        .await
        .unwrap();
    assert_eq!(kick_b_resp.status(), StatusCode::NO_CONTENT);

    // Check pending removes for Room 1 -> expect 2 rows for user B
    let list_req2 = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/rooms/{}/pending-removes", room_1_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();

    let list_resp2 = tower::ServiceExt::oneshot(app.clone(), list_req2)
        .await
        .unwrap();
    assert_eq!(list_resp2.status(), StatusCode::OK);
    let list_json2: Value = serde_json::from_slice(
        &axum::body::to_bytes(list_resp2.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    let removes = list_json2["removes"].as_array().unwrap();
    assert_eq!(removes.len(), 2);
    let remove_1_id = removes[0]["id"].as_str().unwrap().to_string();
    let remove_2_id = removes[1]["id"].as_str().unwrap().to_string();
    assert_eq!(removes[0]["target_user_id"], user_b_id);
    assert_eq!(removes[1]["target_user_id"], user_b_id);

    // 6. Consuming marks the row
    let consume_1_req = Request::builder()
        .method("POST")
        .uri(format!(
            "/api/v1/rooms/{}/pending-removes/{}/consume",
            room_1_id, remove_1_id
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();

    let consume_1_resp = tower::ServiceExt::oneshot(app.clone(), consume_1_req)
        .await
        .unwrap();
    assert_eq!(consume_1_resp.status(), StatusCode::NO_CONTENT);

    // 7. Consuming twice returns 404 remove_not_found
    let consume_1_req_again = Request::builder()
        .method("POST")
        .uri(format!(
            "/api/v1/rooms/{}/pending-removes/{}/consume",
            room_1_id, remove_1_id
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();

    let consume_1_resp_again = tower::ServiceExt::oneshot(app.clone(), consume_1_req_again)
        .await
        .unwrap();
    assert_eq!(consume_1_resp_again.status(), StatusCode::NOT_FOUND);

    // 8. Consuming a remove from another room returns 404
    // User A creates Room 2
    let create_room_2_req = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({}).to_string()))
        .unwrap();

    let resp_r2 = tower::ServiceExt::oneshot(app.clone(), create_room_2_req)
        .await
        .unwrap();
    assert_eq!(resp_r2.status(), StatusCode::CREATED);
    let r2_json: Value = serde_json::from_slice(
        &axum::body::to_bytes(resp_r2.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    let room_2_id = r2_json["id"].as_str().unwrap();

    // Attempt to consume Room 1's remove_2_id via Room 2's URL
    let cross_consume_req = Request::builder()
        .method("POST")
        .uri(format!(
            "/api/v1/rooms/{}/pending-removes/{}/consume",
            room_2_id, remove_2_id
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();

    let cross_consume_resp = tower::ServiceExt::oneshot(app.clone(), cross_consume_req)
        .await
        .unwrap();
    assert_eq!(cross_consume_resp.status(), StatusCode::NOT_FOUND);

    // Consume remove_2_id correctly
    let consume_2_req = Request::builder()
        .method("POST")
        .uri(format!(
            "/api/v1/rooms/{}/pending-removes/{}/consume",
            room_1_id, remove_2_id
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();

    let consume_2_resp = tower::ServiceExt::oneshot(app.clone(), consume_2_req)
        .await
        .unwrap();
    assert_eq!(consume_2_resp.status(), StatusCode::NO_CONTENT);

    // 9. Room delete cascades removes
    // Add B to Room 2, kick B to queue a remove in Room 2
    let _ = user_a_id;
    let add_b_r2 = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/members", room_2_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "user_id": user_b_id }).to_string()))
        .unwrap();
    let _ = tower::ServiceExt::oneshot(app.clone(), add_b_r2)
        .await
        .unwrap();

    let kick_b_r2 = Request::builder()
        .method("DELETE")
        .uri(format!("/api/v1/rooms/{}/members/{}", room_2_id, user_b_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();
    let _ = tower::ServiceExt::oneshot(app.clone(), kick_b_r2)
        .await
        .unwrap();

    let count_before: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM pending_mls_removes WHERE room_id = ?")
            .bind(room_2_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(count_before.0 > 0);

    // Delete Room 2
    let del_r2_req = Request::builder()
        .method("DELETE")
        .uri(format!("/api/v1/rooms/{}", room_2_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();

    let del_r2_resp = tower::ServiceExt::oneshot(app.clone(), del_r2_req)
        .await
        .unwrap();
    assert_eq!(del_r2_resp.status(), StatusCode::NO_CONTENT);

    let count_after: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM pending_mls_removes WHERE room_id = ?")
            .bind(room_2_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(count_after.0, 0);
}
