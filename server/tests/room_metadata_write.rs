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
async fn test_owner_can_update_metadata_and_version_increments() {
    let (app, pool) = setup_test_app().await;
    let (_user_a_id, token_a) =
        create_test_user(&app, &pool, "alice", "device_client_id_a_12345").await;

    // 1. Create room
    let req_create = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({}).to_string()))
        .unwrap();
    let resp_create = app.clone().oneshot(req_create).await.unwrap();
    assert_eq!(resp_create.status(), StatusCode::CREATED);

    let body_c = axum::body::to_bytes(resp_create.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_c: Value = serde_json::from_slice(&body_c).unwrap();
    let room_id = json_c["id"].as_str().unwrap();
    assert_eq!(json_c["metadata"], Value::Null);
    assert_eq!(json_c["metadata_version"], 1);

    // 2. PATCH metadata
    let blob = "ZXhhbXBsZV9tZXRhZGF0YV9ibG9i"; // base64url string
    let req_patch1 = Request::builder()
        .method("PATCH")
        .uri(format!("/api/v1/rooms/{}", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "metadata": blob }).to_string()))
        .unwrap();

    let resp_patch1 = app.clone().oneshot(req_patch1).await.unwrap();
    assert_eq!(resp_patch1.status(), StatusCode::OK);
    assert_eq!(
        resp_patch1.headers().get(header::CACHE_CONTROL).unwrap(),
        "no-store"
    );

    let body_p1 = axum::body::to_bytes(resp_patch1.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_p1: Value = serde_json::from_slice(&body_p1).unwrap();

    assert_eq!(json_p1["room_id"], room_id);
    assert_eq!(json_p1["metadata"], blob);
    assert_eq!(json_p1["metadata_version"], 2);
    assert!(json_p1["updated_at"].is_string());

    // 3. GET room metadata verbatim
    let req_get1 = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/rooms/{}", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();

    let resp_get1 = app.clone().oneshot(req_get1).await.unwrap();
    assert_eq!(resp_get1.status(), StatusCode::OK);

    let body_g1 = axum::body::to_bytes(resp_get1.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_g1: Value = serde_json::from_slice(&body_g1).unwrap();
    assert_eq!(json_g1["metadata"], blob);
    assert_eq!(json_g1["metadata_version"], 2);

    // 4. Update metadata again -> version increments to 3
    let blob2 = "bmV3X21ldGFkYXRhX2Jsb2I";
    let req_patch2 = Request::builder()
        .method("PATCH")
        .uri(format!("/api/v1/rooms/{}", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "metadata": blob2 }).to_string()))
        .unwrap();

    let resp_patch2 = app.clone().oneshot(req_patch2).await.unwrap();
    assert_eq!(resp_patch2.status(), StatusCode::OK);

    let body_p2 = axum::body::to_bytes(resp_patch2.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_p2: Value = serde_json::from_slice(&body_p2).unwrap();
    assert_eq!(json_p2["metadata"], blob2);
    assert_eq!(json_p2["metadata_version"], 3);

    // 5. Clear metadata via null -> version increments to 4
    let req_patch_null = Request::builder()
        .method("PATCH")
        .uri(format!("/api/v1/rooms/{}", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "metadata": null }).to_string()))
        .unwrap();

    let resp_patch_null = app.oneshot(req_patch_null).await.unwrap();
    assert_eq!(resp_patch_null.status(), StatusCode::OK);

    let body_pn = axum::body::to_bytes(resp_patch_null.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_pn: Value = serde_json::from_slice(&body_pn).unwrap();
    assert_eq!(json_pn["metadata"], Value::Null);
    assert_eq!(json_pn["metadata_version"], 4);
}

#[tokio::test]
async fn test_non_owner_and_non_member_forbidden_and_not_found() {
    let (app, pool) = setup_test_app().await;
    let (_user_a_id, token_a) =
        create_test_user(&app, &pool, "alice", "device_client_id_a_12345").await;
    let (user_b_id, token_b) =
        create_test_user(&app, &pool, "bob", "device_client_id_b_12345").await;
    let (_user_c_id, token_c) =
        create_test_user(&app, &pool, "charlie", "device_client_id_c_12345").await;

    // Alice creates room, adds Bob
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

    // Bob (member, non-owner) attempts update -> 403
    let req_patch_b = Request::builder()
        .method("PATCH")
        .uri(format!("/api/v1/rooms/{}", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_b))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({ "metadata": "ZXhhbXBsZV9tZXRhZGF0YV9ibG9i" }).to_string(),
        ))
        .unwrap();
    let resp_patch_b = app.clone().oneshot(req_patch_b).await.unwrap();
    assert_eq!(resp_patch_b.status(), StatusCode::FORBIDDEN);

    let body_pb = axum::body::to_bytes(resp_patch_b.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_pb: Value = serde_json::from_slice(&body_pb).unwrap();
    assert_eq!(json_pb["error"], "forbidden");

    // Charlie (non-member) attempts update -> 404
    let req_patch_c = Request::builder()
        .method("PATCH")
        .uri(format!("/api/v1/rooms/{}", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_c))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({ "metadata": "ZXhhbXBsZV9tZXRhZGF0YV9ibG9i" }).to_string(),
        ))
        .unwrap();
    let resp_patch_c = app.clone().oneshot(req_patch_c).await.unwrap();
    assert_eq!(resp_patch_c.status(), StatusCode::NOT_FOUND);

    let body_pc = axum::body::to_bytes(resp_patch_c.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_pc: Value = serde_json::from_slice(&body_pc).unwrap();
    assert_eq!(json_pc["error"], "room_not_found");

    // Unknown room ID -> 404
    let req_patch_unk = Request::builder()
        .method("PATCH")
        .uri("/api/v1/rooms/non_existent_room_id")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({ "metadata": "ZXhhbXBsZV9tZXRhZGF0YV9ibG9i" }).to_string(),
        ))
        .unwrap();
    let resp_patch_unk = app.oneshot(req_patch_unk).await.unwrap();
    assert_eq!(resp_patch_unk.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn test_missing_metadata_field_returns_400() {
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

    // PATCH with empty JSON object {} (missing metadata field)
    let req_patch = Request::builder()
        .method("PATCH")
        .uri(format!("/api/v1/rooms/{}", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({}).to_string()))
        .unwrap();

    let resp_patch = app.oneshot(req_patch).await.unwrap();
    assert_eq!(resp_patch.status(), StatusCode::BAD_REQUEST);

    let body_p = axum::body::to_bytes(resp_patch.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_p: Value = serde_json::from_slice(&body_p).unwrap();
    assert_eq!(json_p["error"], "missing_field");
    assert_eq!(json_p["details"]["field"], "metadata");
}
