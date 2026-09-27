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

async fn create_room(app: &axum::Router, token: &str) -> String {
    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({}).to_string()))
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED);

    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body_bytes).unwrap();
    json["id"].as_str().unwrap().to_string()
}

async fn add_member(app: &axum::Router, token: &str, room_id: &str, target_user_id: &str) {
    let req = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/members", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "user_id": target_user_id }).to_string()))
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED);
}

#[tokio::test]
async fn test_01_member_creates_invite() {
    let (app, pool) = setup_test_app().await;
    let (_user_a, token_a) =
        create_test_user(&app, &pool, "alice", "device_client_id_a_12345").await;
    let (user_b, token_b) = create_test_user(&app, &pool, "bob", "device_client_id_b_12345").await;

    let room_id = create_room(&app, &token_a).await;
    add_member(&app, &token_a, &room_id, &user_b).await;

    // Member B creates invite with max_uses: 5
    let req = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/invites", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_b))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "max_uses": 5 }).to_string()))
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED);

    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body_bytes).unwrap();

    assert_eq!(json["max_uses"], 5);
    assert_eq!(json["current_uses"], 0);
    let code = json["code"].as_str().unwrap();
    assert_eq!(code.len(), 8);
}

#[tokio::test]
async fn test_02_code_matches_crockford_base32() {
    let (app, pool) = setup_test_app().await;
    let (_user_a, token_a) =
        create_test_user(&app, &pool, "alice", "device_client_id_a_12345").await;

    let room_id = create_room(&app, &token_a).await;

    let req = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/invites", room_id))
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

    let code = json["code"].as_str().unwrap();
    let alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
    assert_eq!(code.len(), 8);
    assert!(
        code.chars().all(|c| alphabet.contains(c)),
        "Code '{}' is not Crockford Base32",
        code
    );
}

#[tokio::test]
async fn test_03_non_member_cannot_create_invite() {
    let (app, pool) = setup_test_app().await;
    let (_user_a, token_a) =
        create_test_user(&app, &pool, "alice", "device_client_id_a_12345").await;
    let (_user_c, token_c) =
        create_test_user(&app, &pool, "charlie", "device_client_id_c_12345").await;

    let room_id = create_room(&app, &token_a).await;

    // User C (non-member) attempts create
    let req = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/invites", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_c))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({}).to_string()))
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);

    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(json["error"], "room_not_found");
}

#[tokio::test]
async fn test_04_invalid_max_uses_rejected() {
    let (app, pool) = setup_test_app().await;
    let (_user_a, token_a) =
        create_test_user(&app, &pool, "alice", "device_client_id_a_12345").await;

    let room_id = create_room(&app, &token_a).await;

    // max_uses: -1
    let req1 = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/invites", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "max_uses": -1 }).to_string()))
        .unwrap();
    let resp1 = app.clone().oneshot(req1).await.unwrap();
    assert_eq!(resp1.status(), StatusCode::BAD_REQUEST);

    // max_uses: 99999
    let req2 = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/invites", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "max_uses": 99999 }).to_string()))
        .unwrap();
    let resp2 = app.oneshot(req2).await.unwrap();
    assert_eq!(resp2.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn test_05_invalid_expiry_rejected() {
    let (app, pool) = setup_test_app().await;
    let (_user_a, token_a) =
        create_test_user(&app, &pool, "alice", "device_client_id_a_12345").await;

    let room_id = create_room(&app, &token_a).await;

    // expires_in_days: -1
    let req1 = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/invites", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "expires_in_days": -1 }).to_string()))
        .unwrap();
    let resp1 = app.clone().oneshot(req1).await.unwrap();
    assert_eq!(resp1.status(), StatusCode::BAD_REQUEST);

    // expires_in_days: 500
    let req2 = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/invites", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "expires_in_days": 500 }).to_string()))
        .unwrap();
    let resp2 = app.oneshot(req2).await.unwrap();
    assert_eq!(resp2.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn test_06_max_uses_zero_is_unlimited() {
    let (app, pool) = setup_test_app().await;
    let (_user_a, token_a) =
        create_test_user(&app, &pool, "alice", "device_client_id_a_12345").await;

    let room_id = create_room(&app, &token_a).await;

    let req = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/invites", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "max_uses": 0 }).to_string()))
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED);

    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(json["max_uses"], 0);
}

#[tokio::test]
async fn test_07_default_max_uses_when_omitted() {
    let (app, pool) = setup_test_app().await;
    let (_user_a, token_a) =
        create_test_user(&app, &pool, "alice", "device_client_id_a_12345").await;

    let room_id = create_room(&app, &token_a).await;

    let req = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/invites", room_id))
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
    // ROOM_INVITE_DEFAULT_USES default is 1
    assert_eq!(json["max_uses"], 1);
}

#[tokio::test]
async fn test_08_list_returns_active_invites() {
    let (app, pool) = setup_test_app().await;
    let (_user_a, token_a) =
        create_test_user(&app, &pool, "alice", "device_client_id_a_12345").await;

    let room_id = create_room(&app, &token_a).await;

    // Create invite 1
    let req1 = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/invites", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({}).to_string()))
        .unwrap();
    let resp1 = app.clone().oneshot(req1).await.unwrap();
    let body1 = axum::body::to_bytes(resp1.into_body(), usize::MAX)
        .await
        .unwrap();
    let json1: Value = serde_json::from_slice(&body1).unwrap();
    let inv1_id = json1["id"].as_str().unwrap();

    // Create invite 2
    let req2 = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/invites", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({}).to_string()))
        .unwrap();
    let _resp2 = app.clone().oneshot(req2).await.unwrap();

    // Revoke invite 1
    let req_rev = Request::builder()
        .method("DELETE")
        .uri(format!("/api/v1/rooms/{}/invites/{}", room_id, inv1_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();
    app.clone().oneshot(req_rev).await.unwrap();

    // List active -> 1 invite
    let req_list = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/rooms/{}/invites", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();
    let resp_list = app.oneshot(req_list).await.unwrap();
    assert_eq!(resp_list.status(), StatusCode::OK);

    let body_l = axum::body::to_bytes(resp_list.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_l: Value = serde_json::from_slice(&body_l).unwrap();
    let invites = json_l["invites"].as_array().unwrap();

    assert_eq!(invites.len(), 1);
    assert_ne!(invites[0]["id"], inv1_id);
}

#[tokio::test]
async fn test_09_list_with_include_revoked_returns_both() {
    let (app, pool) = setup_test_app().await;
    let (_user_a, token_a) =
        create_test_user(&app, &pool, "alice", "device_client_id_a_12345").await;

    let room_id = create_room(&app, &token_a).await;

    // Create invite 1
    let req1 = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/invites", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({}).to_string()))
        .unwrap();
    let resp1 = app.clone().oneshot(req1).await.unwrap();
    let body1 = axum::body::to_bytes(resp1.into_body(), usize::MAX)
        .await
        .unwrap();
    let json1: Value = serde_json::from_slice(&body1).unwrap();
    let inv1_id = json1["id"].as_str().unwrap();

    // Create invite 2
    let req2 = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/invites", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({}).to_string()))
        .unwrap();
    app.clone().oneshot(req2).await.unwrap();

    // Revoke invite 1
    let req_rev = Request::builder()
        .method("DELETE")
        .uri(format!("/api/v1/rooms/{}/invites/{}", room_id, inv1_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();
    app.clone().oneshot(req_rev).await.unwrap();

    // List with include_revoked=true
    let req_list = Request::builder()
        .method("GET")
        .uri(format!(
            "/api/v1/rooms/{}/invites?include_revoked=true",
            room_id
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();
    let resp_list = app.oneshot(req_list).await.unwrap();
    assert_eq!(resp_list.status(), StatusCode::OK);

    let body_l = axum::body::to_bytes(resp_list.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_l: Value = serde_json::from_slice(&body_l).unwrap();
    let invites = json_l["invites"].as_array().unwrap();

    assert_eq!(invites.len(), 2);
}

#[tokio::test]
async fn test_10_list_does_not_include_code() {
    let (app, pool) = setup_test_app().await;
    let (_user_a, token_a) =
        create_test_user(&app, &pool, "alice", "device_client_id_a_12345").await;

    let room_id = create_room(&app, &token_a).await;

    let req = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/invites", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({}).to_string()))
        .unwrap();
    app.clone().oneshot(req).await.unwrap();

    let req_list = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/rooms/{}/invites", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();
    let resp_list = app.oneshot(req_list).await.unwrap();
    let body_l = axum::body::to_bytes(resp_list.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_l: Value = serde_json::from_slice(&body_l).unwrap();

    let invites = json_l["invites"].as_array().unwrap();
    assert_eq!(invites.len(), 1);
    assert_eq!(invites[0].get("code"), None);
}

#[tokio::test]
async fn test_11_non_member_cannot_list() {
    let (app, pool) = setup_test_app().await;
    let (_user_a, token_a) =
        create_test_user(&app, &pool, "alice", "device_client_id_a_12345").await;
    let (_user_c, token_c) =
        create_test_user(&app, &pool, "charlie", "device_client_id_c_12345").await;

    let room_id = create_room(&app, &token_a).await;

    let req = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/rooms/{}/invites", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_c))
        .body(Body::empty())
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);

    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(json["error"], "room_not_found");
}

#[tokio::test]
async fn test_12_any_member_can_revoke() {
    let (app, pool) = setup_test_app().await;
    let (_user_a, token_a) =
        create_test_user(&app, &pool, "alice", "device_client_id_a_12345").await;
    let (user_b, token_b) = create_test_user(&app, &pool, "bob", "device_client_id_b_12345").await;

    let room_id = create_room(&app, &token_a).await;
    add_member(&app, &token_a, &room_id, &user_b).await;

    // A creates invite
    let req_inv = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/invites", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({}).to_string()))
        .unwrap();
    let resp_inv = app.clone().oneshot(req_inv).await.unwrap();
    let body_i = axum::body::to_bytes(resp_inv.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_i: Value = serde_json::from_slice(&body_i).unwrap();
    let invite_id = json_i["id"].as_str().unwrap();

    // B revokes it
    let req_rev = Request::builder()
        .method("DELETE")
        .uri(format!("/api/v1/rooms/{}/invites/{}", room_id, invite_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_b))
        .body(Body::empty())
        .unwrap();
    let resp_rev = app.oneshot(req_rev).await.unwrap();
    assert_eq!(resp_rev.status(), StatusCode::NO_CONTENT);
}

#[tokio::test]
async fn test_13_revoked_invite_is_not_usable() {
    let (app, pool) = setup_test_app().await;
    let (_user_a, token_a) =
        create_test_user(&app, &pool, "alice", "device_client_id_a_12345").await;
    let (_user_c, token_c) =
        create_test_user(&app, &pool, "charlie", "device_client_id_c_12345").await;

    let room_id = create_room(&app, &token_a).await;

    // Create invite
    let req_inv = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/invites", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({}).to_string()))
        .unwrap();
    let resp_inv = app.clone().oneshot(req_inv).await.unwrap();
    let body_i = axum::body::to_bytes(resp_inv.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_i: Value = serde_json::from_slice(&body_i).unwrap();
    let invite_id = json_i["id"].as_str().unwrap();
    let code = json_i["code"].as_str().unwrap();

    // Revoke
    let req_rev = Request::builder()
        .method("DELETE")
        .uri(format!("/api/v1/rooms/{}/invites/{}", room_id, invite_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();
    app.clone().oneshot(req_rev).await.unwrap();

    // C attempts join -> 410 invite_revoked
    let req_join = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms/join")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_c))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "code": code }).to_string()))
        .unwrap();
    let resp_join = app.oneshot(req_join).await.unwrap();
    assert_eq!(resp_join.status(), StatusCode::GONE);

    let body_bytes = axum::body::to_bytes(resp_join.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(json["error"], "invite_revoked");
}

#[tokio::test]
async fn test_14_revoke_non_existent_returns_404() {
    let (app, pool) = setup_test_app().await;
    let (_user_a, token_a) =
        create_test_user(&app, &pool, "alice", "device_client_id_a_12345").await;

    let room_id = create_room(&app, &token_a).await;

    let req_rev = Request::builder()
        .method("DELETE")
        .uri(format!(
            "/api/v1/rooms/{}/invites/non_existent_invite_id",
            room_id
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();
    let resp_rev = app.oneshot(req_rev).await.unwrap();
    assert_eq!(resp_rev.status(), StatusCode::NOT_FOUND);

    let body_bytes = axum::body::to_bytes(resp_rev.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(json["error"], "invite_not_found");
}

#[tokio::test]
async fn test_15_revoke_already_revoked_returns_404() {
    let (app, pool) = setup_test_app().await;
    let (_user_a, token_a) =
        create_test_user(&app, &pool, "alice", "device_client_id_a_12345").await;

    let room_id = create_room(&app, &token_a).await;

    // Create invite
    let req_inv = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/invites", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({}).to_string()))
        .unwrap();
    let resp_inv = app.clone().oneshot(req_inv).await.unwrap();
    let body_i = axum::body::to_bytes(resp_inv.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_i: Value = serde_json::from_slice(&body_i).unwrap();
    let invite_id = json_i["id"].as_str().unwrap();

    // Revoke first time
    let req_rev1 = Request::builder()
        .method("DELETE")
        .uri(format!("/api/v1/rooms/{}/invites/{}", room_id, invite_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();
    let resp_rev1 = app.clone().oneshot(req_rev1).await.unwrap();
    assert_eq!(resp_rev1.status(), StatusCode::NO_CONTENT);

    // Revoke second time -> 404 invite_not_found
    let req_rev2 = Request::builder()
        .method("DELETE")
        .uri(format!("/api/v1/rooms/{}/invites/{}", room_id, invite_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();
    let resp_rev2 = app.oneshot(req_rev2).await.unwrap();
    assert_eq!(resp_rev2.status(), StatusCode::NOT_FOUND);

    let body_bytes = axum::body::to_bytes(resp_rev2.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(json["error"], "invite_not_found");
}

#[tokio::test]
async fn test_16_valid_code_joins_room() {
    let (app, pool) = setup_test_app().await;
    let (_user_a, token_a) =
        create_test_user(&app, &pool, "alice", "device_client_id_a_12345").await;
    let (user_b, token_b) = create_test_user(&app, &pool, "bob", "device_client_id_b_12345").await;

    let room_id = create_room(&app, &token_a).await;

    let req_inv = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/invites", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({}).to_string()))
        .unwrap();
    let resp_inv = app.clone().oneshot(req_inv).await.unwrap();
    let body_i = axum::body::to_bytes(resp_inv.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_i: Value = serde_json::from_slice(&body_i).unwrap();
    let code = json_i["code"].as_str().unwrap();

    let req_join = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms/join")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_b))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "code": code }).to_string()))
        .unwrap();
    let resp_join = app.clone().oneshot(req_join).await.unwrap();
    assert_eq!(resp_join.status(), StatusCode::OK);

    let body_j = axum::body::to_bytes(resp_join.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_j: Value = serde_json::from_slice(&body_j).unwrap();

    assert_eq!(json_j["room_id"], room_id);
    assert_eq!(json_j["member_role"], "member");
    assert_eq!(json_j["already_member"], false);

    // Verify B is now member
    let req_get = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/rooms/{}", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_b))
        .body(Body::empty())
        .unwrap();
    let resp_get = app.oneshot(req_get).await.unwrap();
    assert_eq!(resp_get.status(), StatusCode::OK);

    let count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM room_members WHERE room_id = ? AND user_id = ?")
            .bind(&room_id)
            .bind(&user_b)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(count, 1);
}

#[tokio::test]
async fn test_17_redeeming_increments_current_uses() {
    let (app, pool) = setup_test_app().await;
    let (_user_a, token_a) =
        create_test_user(&app, &pool, "alice", "device_client_id_a_12345").await;
    let (_user_b, token_b) = create_test_user(&app, &pool, "bob", "device_client_id_b_12345").await;

    let room_id = create_room(&app, &token_a).await;

    let req_inv = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/invites", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "max_uses": 5 }).to_string()))
        .unwrap();
    let resp_inv = app.clone().oneshot(req_inv).await.unwrap();
    let body_i = axum::body::to_bytes(resp_inv.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_i: Value = serde_json::from_slice(&body_i).unwrap();
    let code = json_i["code"].as_str().unwrap();

    // B joins
    let req_join = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms/join")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_b))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "code": code }).to_string()))
        .unwrap();
    app.clone().oneshot(req_join).await.unwrap();

    // List invites -> current_uses: 1
    let req_list = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/rooms/{}/invites", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();
    let resp_list = app.oneshot(req_list).await.unwrap();
    let body_l = axum::body::to_bytes(resp_list.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_l: Value = serde_json::from_slice(&body_l).unwrap();

    assert_eq!(json_l["invites"][0]["current_uses"], 1);
}

#[tokio::test]
async fn test_18_redeeming_when_already_member_does_not_consume_use() {
    let (app, pool) = setup_test_app().await;
    let (_user_a, token_a) =
        create_test_user(&app, &pool, "alice", "device_client_id_a_12345").await;
    let (user_b, token_b) = create_test_user(&app, &pool, "bob", "device_client_id_b_12345").await;

    let room_id = create_room(&app, &token_a).await;
    add_member(&app, &token_a, &room_id, &user_b).await;

    // A creates invite
    let req_inv = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/invites", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "max_uses": 5 }).to_string()))
        .unwrap();
    let resp_inv = app.clone().oneshot(req_inv).await.unwrap();
    let body_i = axum::body::to_bytes(resp_inv.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_i: Value = serde_json::from_slice(&body_i).unwrap();
    let code = json_i["code"].as_str().unwrap();

    // B (already member) joins with code
    let req_join = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms/join")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_b))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "code": code }).to_string()))
        .unwrap();
    let resp_join = app.clone().oneshot(req_join).await.unwrap();
    assert_eq!(resp_join.status(), StatusCode::OK);

    let body_j = axum::body::to_bytes(resp_join.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_j: Value = serde_json::from_slice(&body_j).unwrap();

    assert_eq!(json_j["already_member"], true);

    // List invites -> current_uses remains 0
    let req_list = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/rooms/{}/invites", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();
    let resp_list = app.oneshot(req_list).await.unwrap();
    let body_l = axum::body::to_bytes(resp_list.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_l: Value = serde_json::from_slice(&body_l).unwrap();

    assert_eq!(json_l["invites"][0]["current_uses"], 0);
}

#[tokio::test]
async fn test_19_exhausted_invite_returns_410() {
    let (app, pool) = setup_test_app().await;
    let (_user_a, token_a) =
        create_test_user(&app, &pool, "alice", "device_client_id_a_12345").await;
    let (_user_b, token_b) = create_test_user(&app, &pool, "bob", "device_client_id_b_12345").await;
    let (_user_c, token_c) =
        create_test_user(&app, &pool, "charlie", "device_client_id_c_12345").await;

    let room_id = create_room(&app, &token_a).await;

    // Create invite with max_uses: 1
    let req_inv = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/invites", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "max_uses": 1 }).to_string()))
        .unwrap();
    let resp_inv = app.clone().oneshot(req_inv).await.unwrap();
    let body_i = axum::body::to_bytes(resp_inv.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_i: Value = serde_json::from_slice(&body_i).unwrap();
    let code = json_i["code"].as_str().unwrap();

    // B joins (consumes 1 use)
    let req_join1 = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms/join")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_b))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "code": code }).to_string()))
        .unwrap();
    let resp_join1 = app.clone().oneshot(req_join1).await.unwrap();
    assert_eq!(resp_join1.status(), StatusCode::OK);

    // C attempts join -> 410 invite_exhausted
    let req_join2 = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms/join")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_c))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "code": code }).to_string()))
        .unwrap();
    let resp_join2 = app.oneshot(req_join2).await.unwrap();
    assert_eq!(resp_join2.status(), StatusCode::GONE);

    let body_bytes = axum::body::to_bytes(resp_join2.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(json["error"], "invite_exhausted");
}

#[tokio::test]
async fn test_20_expired_invite_returns_410() {
    let (app, pool) = setup_test_app().await;
    let (_user_a, token_a) =
        create_test_user(&app, &pool, "alice", "device_client_id_a_12345").await;
    let (_user_b, token_b) = create_test_user(&app, &pool, "bob", "device_client_id_b_12345").await;

    let room_id = create_room(&app, &token_a).await;

    let req_inv = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/invites", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "expires_in_days": 1 }).to_string()))
        .unwrap();
    let resp_inv = app.clone().oneshot(req_inv).await.unwrap();
    let body_i = axum::body::to_bytes(resp_inv.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_i: Value = serde_json::from_slice(&body_i).unwrap();
    let invite_id = json_i["id"].as_str().unwrap();
    let code = json_i["code"].as_str().unwrap();

    // Set expires_at to past via SQL
    sqlx::query("UPDATE room_invites SET expires_at = datetime('now', '-1 day') WHERE id = ?")
        .bind(invite_id)
        .execute(&pool)
        .await
        .unwrap();

    // B attempts join -> 410 invite_expired
    let req_join = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms/join")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_b))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "code": code }).to_string()))
        .unwrap();
    let resp_join = app.oneshot(req_join).await.unwrap();
    assert_eq!(resp_join.status(), StatusCode::GONE);

    let body_bytes = axum::body::to_bytes(resp_join.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(json["error"], "invite_expired");
}

#[tokio::test]
async fn test_21_revoked_invite_returns_410() {
    let (app, pool) = setup_test_app().await;
    let (_user_a, token_a) =
        create_test_user(&app, &pool, "alice", "device_client_id_a_12345").await;
    let (_user_b, token_b) = create_test_user(&app, &pool, "bob", "device_client_id_b_12345").await;

    let room_id = create_room(&app, &token_a).await;

    let req_inv = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/invites", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({}).to_string()))
        .unwrap();
    let resp_inv = app.clone().oneshot(req_inv).await.unwrap();
    let body_i = axum::body::to_bytes(resp_inv.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_i: Value = serde_json::from_slice(&body_i).unwrap();
    let invite_id = json_i["id"].as_str().unwrap();
    let code = json_i["code"].as_str().unwrap();

    // Revoke
    let req_rev = Request::builder()
        .method("DELETE")
        .uri(format!("/api/v1/rooms/{}/invites/{}", room_id, invite_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();
    app.clone().oneshot(req_rev).await.unwrap();

    // B attempts join -> 410 invite_revoked
    let req_join = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms/join")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_b))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "code": code }).to_string()))
        .unwrap();
    let resp_join = app.oneshot(req_join).await.unwrap();
    assert_eq!(resp_join.status(), StatusCode::GONE);

    let body_bytes = axum::body::to_bytes(resp_join.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(json["error"], "invite_revoked");
}

#[tokio::test]
async fn test_22_unknown_code_returns_404() {
    let (app, pool) = setup_test_app().await;
    let (_user_a, token_a) =
        create_test_user(&app, &pool, "alice", "device_client_id_a_12345").await;

    let req_join = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms/join")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "code": "UNKNOWN1" }).to_string()))
        .unwrap();
    let resp_join = app.oneshot(req_join).await.unwrap();
    assert_eq!(resp_join.status(), StatusCode::NOT_FOUND);

    let body_bytes = axum::body::to_bytes(resp_join.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(json["error"], "invite_not_found");
}

#[tokio::test]
async fn test_23_full_room_returns_409() {
    let (app, pool) = setup_test_app().await;
    let (user_a, token_a) =
        create_test_user(&app, &pool, "alice", "device_client_id_a_12345").await;
    let (user_b, _token_b) = create_test_user(&app, &pool, "bob", "device_client_id_b_12345").await;
    let (_user_c, token_c) =
        create_test_user(&app, &pool, "charlie", "device_client_id_c_12345").await;

    // Set instance room_size to 2
    sqlx::query(
        "INSERT INTO instance_limits (key, value, updated_by) VALUES ('room_size', '2', ?)",
    )
    .bind(&user_a)
    .execute(&pool)
    .await
    .unwrap();

    let room_id = create_room(&app, &token_a).await;
    add_member(&app, &token_a, &room_id, &user_b).await; // room size = 2 (full)

    // A creates invite
    let req_inv = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/invites", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "max_uses": 5 }).to_string()))
        .unwrap();
    let resp_inv = app.clone().oneshot(req_inv).await.unwrap();
    let body_i = axum::body::to_bytes(resp_inv.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_i: Value = serde_json::from_slice(&body_i).unwrap();
    let code = json_i["code"].as_str().unwrap();

    // C attempts join -> 409 room_full
    let req_join = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms/join")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_c))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "code": code }).to_string()))
        .unwrap();
    let resp_join = app.oneshot(req_join).await.unwrap();
    assert_eq!(resp_join.status(), StatusCode::CONFLICT);

    let body_bytes = axum::body::to_bytes(resp_join.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(json["error"], "room_full");
}

#[tokio::test]
async fn test_24_full_room_does_not_consume_invite() {
    let (app, pool) = setup_test_app().await;
    let (user_a, token_a) =
        create_test_user(&app, &pool, "alice", "device_client_id_a_12345").await;
    let (user_b, _token_b) = create_test_user(&app, &pool, "bob", "device_client_id_b_12345").await;
    let (_user_c, token_c) =
        create_test_user(&app, &pool, "charlie", "device_client_id_c_12345").await;

    // Set instance room_size to 2
    sqlx::query(
        "INSERT INTO instance_limits (key, value, updated_by) VALUES ('room_size', '2', ?)",
    )
    .bind(&user_a)
    .execute(&pool)
    .await
    .unwrap();

    let room_id = create_room(&app, &token_a).await;
    add_member(&app, &token_a, &room_id, &user_b).await; // room size = 2 (full)

    // A creates invite
    let req_inv = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/invites", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "max_uses": 5 }).to_string()))
        .unwrap();
    let resp_inv = app.clone().oneshot(req_inv).await.unwrap();
    let body_i = axum::body::to_bytes(resp_inv.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_i: Value = serde_json::from_slice(&body_i).unwrap();
    let code = json_i["code"].as_str().unwrap();

    // C attempts join -> 409 room_full
    let req_join1 = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms/join")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_c))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "code": code }).to_string()))
        .unwrap();
    let resp_join1 = app.clone().oneshot(req_join1).await.unwrap();
    assert_eq!(resp_join1.status(), StatusCode::CONFLICT);

    // Remove B
    sqlx::query("DELETE FROM room_members WHERE room_id = ? AND user_id = ?")
        .bind(&room_id)
        .bind(&user_b)
        .execute(&pool)
        .await
        .unwrap();

    // C joins -> 200 OK
    let req_join2 = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms/join")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_c))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "code": code }).to_string()))
        .unwrap();
    let resp_join2 = app.clone().oneshot(req_join2).await.unwrap();
    assert_eq!(resp_join2.status(), StatusCode::OK);

    // Check use count is 1
    let req_list = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/rooms/{}/invites", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();
    let resp_list = app.oneshot(req_list).await.unwrap();
    let body_l = axum::body::to_bytes(resp_list.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_l: Value = serde_json::from_slice(&body_l).unwrap();

    assert_eq!(json_l["invites"][0]["current_uses"], 1);
}

#[tokio::test]
async fn test_25_rate_limit_on_redemption_is_enforced() {
    let (app, pool) = setup_test_app().await;
    let (_user_a, token_a) =
        create_test_user(&app, &pool, "alice", "device_client_id_a_12345").await;

    // Default config rate_invite_redeem_per_min = 10
    // Perform 10 failed joins (unknown code), then 11th should return 429
    for _ in 0..10 {
        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/rooms/join")
            .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
            .header(header::CONTENT_TYPE, "application/json")
            .header("x-forwarded-for", "192.168.1.100")
            .body(Body::from(json!({ "code": "UNKNOWNX" }).to_string()))
            .unwrap();
        let resp = app.clone().oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    }

    // 11th request -> 429 Too Many Requests
    let req11 = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms/join")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .header("x-forwarded-for", "192.168.1.100")
        .body(Body::from(json!({ "code": "UNKNOWNX" }).to_string()))
        .unwrap();
    let resp11 = app.oneshot(req11).await.unwrap();
    assert_eq!(resp11.status(), StatusCode::TOO_MANY_REQUESTS);

    let body_bytes = axum::body::to_bytes(resp11.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(json["error"], "rate_limited");
}

#[tokio::test]
async fn test_26_concurrent_redemption_of_single_use_invite() {
    let (app, pool) = setup_test_app().await;
    let (_user_a, token_a) =
        create_test_user(&app, &pool, "alice", "device_client_id_a_12345").await;
    let (_user_b, token_b) = create_test_user(&app, &pool, "bob", "device_client_id_b_12345").await;
    let (_user_c, token_c) =
        create_test_user(&app, &pool, "charlie", "device_client_id_c_12345").await;

    let room_id = create_room(&app, &token_a).await;

    let req_inv = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/invites", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "max_uses": 1 }).to_string()))
        .unwrap();
    let resp_inv = app.clone().oneshot(req_inv).await.unwrap();
    let body_i = axum::body::to_bytes(resp_inv.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_i: Value = serde_json::from_slice(&body_i).unwrap();
    let code = json_i["code"].as_str().unwrap();

    let req_b = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms/join")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_b))
        .header(header::CONTENT_TYPE, "application/json")
        .header("x-forwarded-for", "10.0.0.1")
        .body(Body::from(json!({ "code": code }).to_string()))
        .unwrap();

    let req_c = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms/join")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_c))
        .header(header::CONTENT_TYPE, "application/json")
        .header("x-forwarded-for", "10.0.0.2")
        .body(Body::from(json!({ "code": code }).to_string()))
        .unwrap();

    let app_b = app.clone();
    let app_c = app.clone();

    let (res_b, res_c) = tokio::join!(app_b.oneshot(req_b), app_c.oneshot(req_c));

    let resp_b = res_b.unwrap();
    let resp_c = res_c.unwrap();

    let statuses = [resp_b.status(), resp_c.status()];
    assert!(
        statuses.contains(&StatusCode::OK),
        "One request must succeed"
    );
    assert!(
        statuses.contains(&StatusCode::GONE),
        "One request must fail with 410 Gone"
    );
}

#[tokio::test]
async fn test_27_invite_code_is_case_sensitive() {
    let (app, pool) = setup_test_app().await;
    let (_user_a, token_a) =
        create_test_user(&app, &pool, "alice", "device_client_id_a_12345").await;
    let (_user_b, token_b) = create_test_user(&app, &pool, "bob", "device_client_id_b_12345").await;

    let room_id = create_room(&app, &token_a).await;

    let req_inv = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/invites", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({}).to_string()))
        .unwrap();
    let resp_inv = app.clone().oneshot(req_inv).await.unwrap();
    let body_i = axum::body::to_bytes(resp_inv.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_i: Value = serde_json::from_slice(&body_i).unwrap();
    let code = json_i["code"].as_str().unwrap();

    let lower_code = code.to_lowercase();

    // If code is strictly uppercase, lower_code is different from code.
    // In rare cases if code contains only numbers, it won't change; ensure different string for testing
    let lowercase_attempt = if lower_code == code {
        format!("{}x", lower_code)
    } else {
        lower_code
    };

    let req_join = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms/join")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_b))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "code": lowercase_attempt }).to_string()))
        .unwrap();
    let resp_join = app.oneshot(req_join).await.unwrap();
    assert_eq!(resp_join.status(), StatusCode::NOT_FOUND);

    let body_bytes = axum::body::to_bytes(resp_join.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(json["error"], "invite_not_found");
}

#[tokio::test]
async fn test_28_invite_from_deleted_room_is_unusable() {
    let (app, pool) = setup_test_app().await;
    let (_user_a, token_a) =
        create_test_user(&app, &pool, "alice", "device_client_id_a_12345").await;
    let (_user_b, token_b) = create_test_user(&app, &pool, "bob", "device_client_id_b_12345").await;

    let room_id = create_room(&app, &token_a).await;

    // A creates invite
    let req_inv = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/invites", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({}).to_string()))
        .unwrap();
    let resp_inv = app.clone().oneshot(req_inv).await.unwrap();
    let body_i = axum::body::to_bytes(resp_inv.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_i: Value = serde_json::from_slice(&body_i).unwrap();
    let code = json_i["code"].as_str().unwrap();

    // A deletes room
    let req_del = Request::builder()
        .method("DELETE")
        .uri(format!("/api/v1/rooms/{}", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();
    app.clone().oneshot(req_del).await.unwrap();

    // B attempts join -> 404 invite_not_found (invite cascaded away with room)
    let req_join = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms/join")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_b))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "code": code }).to_string()))
        .unwrap();
    let resp_join = app.oneshot(req_join).await.unwrap();
    assert_eq!(resp_join.status(), StatusCode::NOT_FOUND);

    let body_bytes = axum::body::to_bytes(resp_join.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(json["error"], "invite_not_found");
}
