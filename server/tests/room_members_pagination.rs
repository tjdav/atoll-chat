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
async fn test_member_list_pagination_first_page_default_limit() {
    let (app, pool) = setup_test_app().await;
    let (_alice_id, token_a) =
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

    // Add 3 members
    for i in 1..=3 {
        let name = format!("user_{}", i);
        let client_id = format!("client_id_{}_123456789", i);
        let (uid, _) = create_test_user(&app, &pool, &name, &client_id).await;

        let req_add = Request::builder()
            .method("POST")
            .uri(format!("/api/v1/rooms/{}/members", room_id))
            .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(json!({ "user_id": uid }).to_string()))
            .unwrap();
        app.clone().oneshot(req_add).await.unwrap();
    }

    // GET /rooms/:id/members without limit or cursor -> 4 total members
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
    assert_eq!(members.len(), 4);
    assert_eq!(json_m["next_cursor"], Value::Null);

    // Verify user_id ordering and type field per §8.4
    let mut user_ids = Vec::new();
    for m in members {
        assert_eq!(m["type"], "user");
        assert!(m.get("bot_id").is_none());
        assert!(m.get("mode").is_none());
        assert!(m.get("display_name").is_none());
        assert!(m.get("avatar_file_id").is_none());
        user_ids.push(m["user_id"].as_str().unwrap());
    }
    let mut sorted_user_ids = user_ids.clone();
    sorted_user_ids.sort();
    assert_eq!(user_ids, sorted_user_ids);
}

#[tokio::test]
async fn test_member_list_pagination_custom_limit_and_pages() {
    let (app, pool) = setup_test_app().await;
    let (_alice_id, token_a) =
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

    // Add 4 additional members (total 5)
    for i in 1..=4 {
        let name = format!("user_{}", i);
        let client_id = format!("client_id_{}_123456789", i);
        let (uid, _) = create_test_user(&app, &pool, &name, &client_id).await;

        let req_add = Request::builder()
            .method("POST")
            .uri(format!("/api/v1/rooms/{}/members", room_id))
            .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(json!({ "user_id": uid }).to_string()))
            .unwrap();
        app.clone().oneshot(req_add).await.unwrap();
    }

    // Page 1: limit=2
    let req_p1 = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/rooms/{}/members?limit=2", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();
    let resp_p1 = app.clone().oneshot(req_p1).await.unwrap();
    assert_eq!(resp_p1.status(), StatusCode::OK);

    let body_p1 = axum::body::to_bytes(resp_p1.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_p1: Value = serde_json::from_slice(&body_p1).unwrap();

    let members_p1 = json_p1["members"].as_array().unwrap();
    assert_eq!(members_p1.len(), 2);
    let cursor_1 = json_p1["next_cursor"].as_str().unwrap();

    // Page 2: limit=2 with cursor
    let req_p2 = Request::builder()
        .method("GET")
        .uri(format!(
            "/api/v1/rooms/{}/members?limit=2&cursor={}",
            room_id, cursor_1
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();
    let resp_p2 = app.clone().oneshot(req_p2).await.unwrap();
    assert_eq!(resp_p2.status(), StatusCode::OK);

    let body_p2 = axum::body::to_bytes(resp_p2.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_p2: Value = serde_json::from_slice(&body_p2).unwrap();

    let members_p2 = json_p2["members"].as_array().unwrap();
    assert_eq!(members_p2.len(), 2);
    let cursor_2 = json_p2["next_cursor"].as_str().unwrap();

    // Ensure no overlap between page 1 and page 2
    let ids_p1: Vec<&str> = members_p1
        .iter()
        .map(|m| m["user_id"].as_str().unwrap())
        .collect();
    let ids_p2: Vec<&str> = members_p2
        .iter()
        .map(|m| m["user_id"].as_str().unwrap())
        .collect();
    for id in &ids_p2 {
        assert!(!ids_p1.contains(id));
    }

    // Page 3: remaining 1 member
    let req_p3 = Request::builder()
        .method("GET")
        .uri(format!(
            "/api/v1/rooms/{}/members?limit=2&cursor={}",
            room_id, cursor_2
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();
    let resp_p3 = app.oneshot(req_p3).await.unwrap();
    assert_eq!(resp_p3.status(), StatusCode::OK);

    let body_p3 = axum::body::to_bytes(resp_p3.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_p3: Value = serde_json::from_slice(&body_p3).unwrap();

    let members_p3 = json_p3["members"].as_array().unwrap();
    assert_eq!(members_p3.len(), 1);
    assert_eq!(json_p3["next_cursor"], Value::Null);
}

#[tokio::test]
async fn test_member_list_pagination_limit_clamping_and_validation() {
    let (app, pool) = setup_test_app().await;
    let (_alice_id, token_a) =
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

    // Limit above max 200 -> clamped to 200 (succeeds)
    let req_clamp = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/rooms/{}/members?limit=500", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();
    let resp_clamp = app.clone().oneshot(req_clamp).await.unwrap();
    assert_eq!(resp_clamp.status(), StatusCode::OK);

    // Limit = 0 -> 400 invalid_limit
    let req_zero = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/rooms/{}/members?limit=0", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();
    let resp_zero = app.clone().oneshot(req_zero).await.unwrap();
    assert_eq!(resp_zero.status(), StatusCode::BAD_REQUEST);

    // Limit negative -> 400 invalid_limit
    let req_neg = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/rooms/{}/members?limit=-5", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();
    let resp_neg = app.clone().oneshot(req_neg).await.unwrap();
    assert_eq!(resp_neg.status(), StatusCode::BAD_REQUEST);

    // Limit non-integer string -> 400 invalid_limit
    let req_str = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/rooms/{}/members?limit=abc", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();
    let resp_str = app.oneshot(req_str).await.unwrap();
    assert_eq!(resp_str.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn test_member_list_pagination_cursor_validation() {
    let (app, pool) = setup_test_app().await;
    let (_alice_id, token_a) =
        create_test_user(&app, &pool, "alice", "device_client_id_a_12345").await;

    // Create room 1
    let req_create1 = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({}).to_string()))
        .unwrap();
    let resp_create1 = app.clone().oneshot(req_create1).await.unwrap();
    let body_c1 = axum::body::to_bytes(resp_create1.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_c1: Value = serde_json::from_slice(&body_c1).unwrap();
    let room_id_1 = json_c1["id"].as_str().unwrap();

    // Create room 2
    let req_create2 = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({}).to_string()))
        .unwrap();
    let resp_create2 = app.clone().oneshot(req_create2).await.unwrap();
    let body_c2 = axum::body::to_bytes(resp_create2.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_c2: Value = serde_json::from_slice(&body_c2).unwrap();
    let room_id_2 = json_c2["id"].as_str().unwrap();

    // Malformed cursor -> 400 invalid_cursor
    let req_malformed = Request::builder()
        .method("GET")
        .uri(format!(
            "/api/v1/rooms/{}/members?cursor=invalid_base64_json",
            room_id_1
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();
    let resp_malformed = app.clone().oneshot(req_malformed).await.unwrap();
    assert_eq!(resp_malformed.status(), StatusCode::BAD_REQUEST);

    // Encode a valid cursor for room 1
    use base64::engine::general_purpose::URL_SAFE_NO_PAD;
    use base64::Engine;
    let room1_cursor_struct = json!({
        "room_id": room_id_1,
        "last_user_id": "usr_some_id"
    });
    let room1_cursor_b64 = URL_SAFE_NO_PAD.encode(room1_cursor_struct.to_string().as_bytes());

    // Use cursor for room 1 against room 2 endpoint -> 400 invalid_cursor
    let req_mismatch = Request::builder()
        .method("GET")
        .uri(format!(
            "/api/v1/rooms/{}/members?cursor={}",
            room_id_2, room1_cursor_b64
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();
    let resp_mismatch = app.oneshot(req_mismatch).await.unwrap();
    assert_eq!(resp_mismatch.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn test_member_list_pagination_auth_and_concurrency() {
    let (app, pool) = setup_test_app().await;
    let (_alice_id, token_a) =
        create_test_user(&app, &pool, "alice", "device_client_id_a_12345").await;
    let (_bob_id, token_b) = create_test_user(&app, &pool, "bob", "device_client_id_b_12345").await;

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

    // Unauthenticated -> 401
    let req_unauth = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/rooms/{}/members", room_id))
        .body(Body::empty())
        .unwrap();
    let resp_unauth = app.clone().oneshot(req_unauth).await.unwrap();
    assert_eq!(resp_unauth.status(), StatusCode::UNAUTHORIZED);

    // Non-member (Bob) -> 404 room_not_found
    let req_non_member = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/rooms/{}/members", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_b))
        .body(Body::empty())
        .unwrap();
    let resp_non_member = app.clone().oneshot(req_non_member).await.unwrap();
    assert_eq!(resp_non_member.status(), StatusCode::NOT_FOUND);

    // Assert no duplicate user_id within a single response
    let req_members = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/rooms/{}/members", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();
    let resp_members = app.oneshot(req_members).await.unwrap();
    let body_m = axum::body::to_bytes(resp_members.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_m: Value = serde_json::from_slice(&body_m).unwrap();
    let members = json_m["members"].as_array().unwrap();

    let mut seen_ids = std::collections::HashSet::new();
    for m in members {
        let uid = m["user_id"].as_str().unwrap();
        assert!(
            seen_ids.insert(uid),
            "Duplicate user_id found in single response: {}",
            uid
        );
    }
}

#[tokio::test]
async fn test_member_list_pagination_merged_users_and_bots() {
    let (app, pool) = setup_test_app().await;
    let (alice_id, token_a) =
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

    // Add 1 human member (total 2 users: alice + bob)
    let (bob_id, _) = create_test_user(&app, &pool, "bob", "device_client_id_b_12345").await;
    let req_add = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/members", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "user_id": bob_id }).to_string()))
        .unwrap();
    app.clone().oneshot(req_add).await.unwrap();

    // Insert 2 bots directly into bot_accounts and room_bots
    sqlx::query(
        "INSERT INTO bot_accounts (id, display_name, avatar_file_id, owner_user_id) VALUES (?, ?, ?, ?)",
    )
    .bind("b_bot_alpha")
    .bind("Alpha Bot")
    .bind(Some("f_avatar1"))
    .bind(&alice_id)
    .execute(&pool)
    .await
    .unwrap();

    sqlx::query("INSERT INTO room_bots (room_id, bot_id, mode, granted_by) VALUES (?, ?, ?, ?)")
        .bind(room_id)
        .bind("b_bot_alpha")
        .bind("write_only")
        .bind(&alice_id)
        .execute(&pool)
        .await
        .unwrap();

    sqlx::query(
        "INSERT INTO bot_accounts (id, display_name, avatar_file_id, owner_user_id) VALUES (?, ?, ?, ?)",
    )
    .bind("b_bot_beta")
    .bind("Beta Bot")
    .bind::<Option<&str>>(None)
    .bind(&alice_id)
    .execute(&pool)
    .await
    .unwrap();

    sqlx::query("INSERT INTO room_bots (room_id, bot_id, mode, granted_by) VALUES (?, ?, ?, ?)")
        .bind(room_id)
        .bind("b_bot_beta")
        .bind("observer")
        .bind(&alice_id)
        .execute(&pool)
        .await
        .unwrap();

    // Page 1: limit=3 -> Should return 2 users and 1 bot (total 3 items)
    let req_p1 = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/rooms/{}/members?limit=3", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();
    let resp_p1 = app.clone().oneshot(req_p1).await.unwrap();
    assert_eq!(resp_p1.status(), StatusCode::OK);

    let body_p1 = axum::body::to_bytes(resp_p1.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_p1: Value = serde_json::from_slice(&body_p1).unwrap();

    let members_p1 = json_p1["members"].as_array().unwrap();
    assert_eq!(members_p1.len(), 3);

    // Verify first 2 entries are users
    assert_eq!(members_p1[0]["type"], "user");
    assert_eq!(members_p1[1]["type"], "user");
    assert!(members_p1[0].get("user_id").is_some());
    assert!(members_p1[0].get("role").is_some());
    assert!(members_p1[0].get("joined_at").is_some());
    assert!(members_p1[0].get("bot_id").is_none());

    // Verify 3rd entry is a bot
    assert_eq!(members_p1[2]["type"], "bot");
    assert_eq!(members_p1[2]["bot_id"], "b_bot_alpha");
    assert_eq!(members_p1[2]["mode"], "write_only");
    assert_eq!(members_p1[2]["display_name"], "Alpha Bot");
    assert_eq!(members_p1[2]["avatar_file_id"], "f_avatar1");
    assert!(members_p1[2].get("joined_at").is_some());
    assert!(members_p1[2].get("user_id").is_none());
    assert!(members_p1[2].get("role").is_none());

    let cursor_1 = json_p1["next_cursor"].as_str().unwrap();

    // Page 2: limit=3 with cursor -> Should return remaining 1 bot (b_bot_beta)
    let req_p2 = Request::builder()
        .method("GET")
        .uri(format!(
            "/api/v1/rooms/{}/members?limit=3&cursor={}",
            room_id, cursor_1
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();
    let resp_p2 = app.oneshot(req_p2).await.unwrap();
    assert_eq!(resp_p2.status(), StatusCode::OK);

    let body_p2 = axum::body::to_bytes(resp_p2.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_p2: Value = serde_json::from_slice(&body_p2).unwrap();

    let members_p2 = json_p2["members"].as_array().unwrap();
    assert_eq!(members_p2.len(), 1);
    assert_eq!(members_p2[0]["type"], "bot");
    assert_eq!(members_p2[0]["bot_id"], "b_bot_beta");
    assert_eq!(members_p2[0]["mode"], "observer");
    assert_eq!(members_p2[0]["display_name"], "Beta Bot");
    assert_eq!(members_p2[0]["avatar_file_id"], Value::Null);
    assert_eq!(json_p2["next_cursor"], Value::Null);
}

#[tokio::test]
async fn test_member_list_pagination_revoked_and_deleted_bots_excluded() {
    let (app, pool) = setup_test_app().await;
    let (alice_id, token_a) =
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

    // 1. Active Bot
    sqlx::query(
        "INSERT INTO bot_accounts (id, display_name, avatar_file_id, owner_user_id) VALUES (?, ?, ?, ?)",
    )
    .bind("b_active")
    .bind("Active Bot")
    .bind::<Option<&str>>(None)
    .bind(&alice_id)
    .execute(&pool)
    .await
    .unwrap();

    sqlx::query("INSERT INTO room_bots (room_id, bot_id, mode, granted_by) VALUES (?, ?, ?, ?)")
        .bind(room_id)
        .bind("b_active")
        .bind("member")
        .bind(&alice_id)
        .execute(&pool)
        .await
        .unwrap();

    // 2. Revoked Bot (revoked_at IS NOT NULL)
    sqlx::query(
        "INSERT INTO bot_accounts (id, display_name, avatar_file_id, owner_user_id) VALUES (?, ?, ?, ?)",
    )
    .bind("b_revoked")
    .bind("Revoked Bot")
    .bind::<Option<&str>>(None)
    .bind(&alice_id)
    .execute(&pool)
    .await
    .unwrap();

    sqlx::query(
        "INSERT INTO room_bots (room_id, bot_id, mode, granted_by, revoked_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)",
    )
    .bind(room_id)
    .bind("b_revoked")
    .bind("member")
    .bind(&alice_id)
    .execute(&pool)
    .await
    .unwrap();

    // 3. Deleted Bot (deleted_at IS NOT NULL)
    sqlx::query(
        "INSERT INTO bot_accounts (id, display_name, avatar_file_id, owner_user_id, deleted_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)",
    )
    .bind("b_deleted")
    .bind("Deleted Bot")
    .bind::<Option<&str>>(None)
    .bind(&alice_id)
    .execute(&pool)
    .await
    .unwrap();

    sqlx::query("INSERT INTO room_bots (room_id, bot_id, mode, granted_by) VALUES (?, ?, ?, ?)")
        .bind(room_id)
        .bind("b_deleted")
        .bind("member")
        .bind(&alice_id)
        .execute(&pool)
        .await
        .unwrap();

    // GET /rooms/:id/members
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
    // 1 user (alice) + 1 active bot (b_active) = 2 items total
    assert_eq!(members.len(), 2);

    let bot_entries: Vec<&Value> = members.iter().filter(|m| m["type"] == "bot").collect();
    assert_eq!(bot_entries.len(), 1);
    assert_eq!(bot_entries[0]["bot_id"], "b_active");
}
