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

async fn set_moderation_mode(pool: &SqlitePool, mode: &str) {
    sqlx::query(
        r#"
        INSERT INTO instance_config (key, value, updated_at)
        VALUES ('moderation_mode', ?, CURRENT_TIMESTAMP)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
        "#,
    )
    .bind(mode)
    .execute(pool)
    .await
    .unwrap();
}

async fn create_room_and_add_members(
    app: &axum::Router,
    token_owner: &str,
    target_user_ids: &[&str],
) -> String {
    let req_create = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_owner))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({}).to_string()))
        .unwrap();

    let resp_create = app.clone().oneshot(req_create).await.unwrap();
    assert_eq!(resp_create.status(), StatusCode::CREATED);
    let body_bytes = axum::body::to_bytes(resp_create.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_c: Value = serde_json::from_slice(&body_bytes).unwrap();
    let room_id = json_c["id"].as_str().unwrap().to_string();

    for target_id in target_user_ids {
        let req_add = Request::builder()
            .method("POST")
            .uri(format!("/api/v1/rooms/{}/members", room_id))
            .header(header::AUTHORIZATION, format!("Bearer {}", token_owner))
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(json!({ "user_id": target_id }).to_string()))
            .unwrap();
        let resp_add = app.clone().oneshot(req_add).await.unwrap();
        assert_eq!(resp_add.status(), StatusCode::CREATED);
    }

    room_id
}

// 1. Owner kicks a member (messenger mode).
#[tokio::test]
async fn test_01_owner_kicks_member_messenger_mode() {
    let (app, pool) = setup_test_app().await;
    let (_user_a, token_a) =
        create_test_user(&app, &pool, "alice", "device_client_id_a_12345").await;
    let (user_b, _token_b) = create_test_user(&app, &pool, "bob", "device_client_id_b_12345").await;

    let room_id = create_room_and_add_members(&app, &token_a, &[&user_b]).await;

    let req_kick = Request::builder()
        .method("DELETE")
        .uri(format!("/api/v1/rooms/{}/members/{}", room_id, user_b))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();
    let resp = app.oneshot(req_kick).await.unwrap();
    assert_eq!(resp.status(), StatusCode::NO_CONTENT);

    let count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM room_members WHERE room_id = ? AND user_id = ?")
            .bind(&room_id)
            .bind(&user_b)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(count, 0);
}

// 2. Owner kicks a member (discord mode).
#[tokio::test]
async fn test_02_owner_kicks_member_discord_mode() {
    let (app, pool) = setup_test_app().await;
    set_moderation_mode(&pool, "discord").await;
    let (_user_a, token_a) =
        create_test_user(&app, &pool, "alice", "device_client_id_a_12345").await;
    let (user_b, _token_b) = create_test_user(&app, &pool, "bob", "device_client_id_b_12345").await;

    let room_id = create_room_and_add_members(&app, &token_a, &[&user_b]).await;

    let req_kick = Request::builder()
        .method("DELETE")
        .uri(format!("/api/v1/rooms/{}/members/{}", room_id, user_b))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();
    let resp = app.oneshot(req_kick).await.unwrap();
    assert_eq!(resp.status(), StatusCode::NO_CONTENT);
}

// 3. Member cannot kick (messenger mode).
#[tokio::test]
async fn test_03_member_cannot_kick_messenger_mode() {
    let (app, pool) = setup_test_app().await;
    let (_user_a, token_a) =
        create_test_user(&app, &pool, "alice", "device_client_id_a_12345").await;
    let (user_b, token_b) = create_test_user(&app, &pool, "bob", "device_client_id_b_12345").await;
    let (user_c, _token_c) =
        create_test_user(&app, &pool, "charlie", "device_client_id_c_12345").await;

    let room_id = create_room_and_add_members(&app, &token_a, &[&user_b, &user_c]).await;

    let req_kick = Request::builder()
        .method("DELETE")
        .uri(format!("/api/v1/rooms/{}/members/{}", room_id, user_c))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_b))
        .body(Body::empty())
        .unwrap();
    let resp = app.oneshot(req_kick).await.unwrap();
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);
}

// 4. Member cannot kick (discord mode).
#[tokio::test]
async fn test_04_member_cannot_kick_discord_mode() {
    let (app, pool) = setup_test_app().await;
    set_moderation_mode(&pool, "discord").await;
    let (_user_a, token_a) =
        create_test_user(&app, &pool, "alice", "device_client_id_a_12345").await;
    let (user_b, token_b) = create_test_user(&app, &pool, "bob", "device_client_id_b_12345").await;
    let (user_c, _token_c) =
        create_test_user(&app, &pool, "charlie", "device_client_id_c_12345").await;

    let room_id = create_room_and_add_members(&app, &token_a, &[&user_b, &user_c]).await;

    let req_kick = Request::builder()
        .method("DELETE")
        .uri(format!("/api/v1/rooms/{}/members/{}", room_id, user_c))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_b))
        .body(Body::empty())
        .unwrap();
    let resp = app.oneshot(req_kick).await.unwrap();
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);
}

// 5. Moderator can kick (discord mode).
#[tokio::test]
async fn test_05_moderator_can_kick_discord_mode() {
    let (app, pool) = setup_test_app().await;
    set_moderation_mode(&pool, "discord").await;
    let (_user_a, token_a) =
        create_test_user(&app, &pool, "alice", "device_client_id_a_12345").await;
    let (user_b, token_b) = create_test_user(&app, &pool, "bob", "device_client_id_b_12345").await;
    let (user_c, _token_c) =
        create_test_user(&app, &pool, "charlie", "device_client_id_c_12345").await;

    let room_id = create_room_and_add_members(&app, &token_a, &[&user_b, &user_c]).await;

    // Promote B
    let req_prom = Request::builder()
        .method("POST")
        .uri(format!(
            "/api/v1/rooms/{}/members/{}/promote",
            room_id, user_b
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();
    app.clone().oneshot(req_prom).await.unwrap();

    // B kicks C
    let req_kick = Request::builder()
        .method("DELETE")
        .uri(format!("/api/v1/rooms/{}/members/{}", room_id, user_c))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_b))
        .body(Body::empty())
        .unwrap();
    let resp = app.oneshot(req_kick).await.unwrap();
    assert_eq!(resp.status(), StatusCode::NO_CONTENT);
}

// 6. Moderator cannot kick (messenger mode).
#[tokio::test]
async fn test_06_moderator_cannot_kick_messenger_mode() {
    let (app, pool) = setup_test_app().await;
    let (_user_a, token_a) =
        create_test_user(&app, &pool, "alice", "device_client_id_a_12345").await;
    let (user_b, token_b) = create_test_user(&app, &pool, "bob", "device_client_id_b_12345").await;
    let (user_c, _token_c) =
        create_test_user(&app, &pool, "charlie", "device_client_id_c_12345").await;

    let room_id = create_room_and_add_members(&app, &token_a, &[&user_b, &user_c]).await;

    // Manually set B's role to 'moderator'
    sqlx::query("UPDATE room_members SET role = 'moderator' WHERE room_id = ? AND user_id = ?")
        .bind(&room_id)
        .bind(&user_b)
        .execute(&pool)
        .await
        .unwrap();

    // B attempts to kick C in messenger mode -> 403
    let req_kick = Request::builder()
        .method("DELETE")
        .uri(format!("/api/v1/rooms/{}/members/{}", room_id, user_c))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_b))
        .body(Body::empty())
        .unwrap();
    let resp = app.oneshot(req_kick).await.unwrap();
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);
}

// 7. Owner cannot kick themselves.
#[tokio::test]
async fn test_07_owner_cannot_kick_self() {
    let (app, pool) = setup_test_app().await;
    let (user_a, token_a) =
        create_test_user(&app, &pool, "alice", "device_client_id_a_12345").await;

    let room_id = create_room_and_add_members(&app, &token_a, &[]).await;

    let req_kick = Request::builder()
        .method("DELETE")
        .uri(format!("/api/v1/rooms/{}/members/{}", room_id, user_a))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();
    let resp = app.oneshot(req_kick).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);

    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(json["error"], "cannot_kick_self");
}

// 8. Kick target must be a member.
#[tokio::test]
async fn test_08_kick_target_must_be_member() {
    let (app, pool) = setup_test_app().await;
    let (_user_a, token_a) =
        create_test_user(&app, &pool, "alice", "device_client_id_a_12345").await;
    let (user_b, _token_b) = create_test_user(&app, &pool, "bob", "device_client_id_b_12345").await;

    let room_id = create_room_and_add_members(&app, &token_a, &[]).await;

    let req_kick = Request::builder()
        .method("DELETE")
        .uri(format!("/api/v1/rooms/{}/members/{}", room_id, user_b))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();
    let resp = app.oneshot(req_kick).await.unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);

    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(json["error"], "member_not_found");
}

// 9. Kick by non-member returns 404.
#[tokio::test]
async fn test_09_kick_by_non_member_returns_404() {
    let (app, pool) = setup_test_app().await;
    let (_user_a, token_a) =
        create_test_user(&app, &pool, "alice", "device_client_id_a_12345").await;
    let (user_b, _token_b) = create_test_user(&app, &pool, "bob", "device_client_id_b_12345").await;
    let (_user_c, token_c) =
        create_test_user(&app, &pool, "charlie", "device_client_id_c_12345").await;

    let room_id = create_room_and_add_members(&app, &token_a, &[&user_b]).await;

    // Charlie (non-member) attempts to kick Bob
    let req_kick = Request::builder()
        .method("DELETE")
        .uri(format!("/api/v1/rooms/{}/members/{}", room_id, user_b))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_c))
        .body(Body::empty())
        .unwrap();
    let resp = app.oneshot(req_kick).await.unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);

    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(json["error"], "room_not_found");
}

// 10. Kick queues MLS Removes.
#[tokio::test]
async fn test_10_kick_queues_mls_removes() {
    let (app, pool) = setup_test_app().await;
    let (_user_a, token_a) =
        create_test_user(&app, &pool, "alice", "device_client_id_a_12345").await;

    // Register Bob and log Bob in on two devices
    let has_users: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM users)")
        .fetch_one(&pool)
        .await
        .unwrap();
    let code = "INV_bob";
    if has_users {
        sqlx::query(
            "INSERT INTO server_invites (id, code, max_uses, current_uses) VALUES ('inv_bob', ?, 10, 0)",
        )
        .bind(code)
        .execute(&pool)
        .await
        .unwrap();
    }
    let user_b = register_user(&app, "bob", "Password123!", Some(code)).await;
    let (status1, _) = login_user(
        &app,
        "bob",
        "Password123!",
        "device_client_id_b1_12345",
        None,
    )
    .await;
    assert_eq!(status1, StatusCode::OK);
    let (status2, _) = login_user(
        &app,
        "bob",
        "Password123!",
        "device_client_id_b2_12345",
        None,
    )
    .await;
    assert_eq!(status2, StatusCode::OK);

    let room_id = create_room_and_add_members(&app, &token_a, &[&user_b]).await;

    // Kick Bob
    let req_kick = Request::builder()
        .method("DELETE")
        .uri(format!("/api/v1/rooms/{}/members/{}", room_id, user_b))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();
    let resp = app.oneshot(req_kick).await.unwrap();
    assert_eq!(resp.status(), StatusCode::NO_CONTENT);

    // Assert 1 row in pending_mls_removes for Bob
    let rows: Vec<(Option<String>, Option<String>)> = sqlx::query_as(
        "SELECT target_user_id, target_bot_id FROM pending_mls_removes WHERE room_id = ?",
    )
    .bind(&room_id)
    .fetch_all(&pool)
    .await
    .unwrap();

    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].0.as_deref(), Some(user_b.as_str()));
    assert_eq!(rows[0].1, None);
}

// 11. Kick by owner in discord mode without moderator also works.
#[tokio::test]
async fn test_11_kick_by_owner_discord_mode_without_moderator() {
    let (app, pool) = setup_test_app().await;
    set_moderation_mode(&pool, "discord").await;
    let (_user_a, token_a) =
        create_test_user(&app, &pool, "alice", "device_client_id_a_12345").await;
    let (user_b, _token_b) = create_test_user(&app, &pool, "bob", "device_client_id_b_12345").await;

    let room_id = create_room_and_add_members(&app, &token_a, &[&user_b]).await;

    let req_kick = Request::builder()
        .method("DELETE")
        .uri(format!("/api/v1/rooms/{}/members/{}", room_id, user_b))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();
    let resp = app.oneshot(req_kick).await.unwrap();
    assert_eq!(resp.status(), StatusCode::NO_CONTENT);
}

// 12. Owner promotes a member (discord mode).
#[tokio::test]
async fn test_12_owner_promotes_member_discord_mode() {
    let (app, pool) = setup_test_app().await;
    set_moderation_mode(&pool, "discord").await;
    let (_user_a, token_a) =
        create_test_user(&app, &pool, "alice", "device_client_id_a_12345").await;
    let (user_b, _token_b) = create_test_user(&app, &pool, "bob", "device_client_id_b_12345").await;

    let room_id = create_room_and_add_members(&app, &token_a, &[&user_b]).await;

    let req = Request::builder()
        .method("POST")
        .uri(format!(
            "/api/v1/rooms/{}/members/{}/promote",
            room_id, user_b
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::NO_CONTENT);

    let role: String =
        sqlx::query_scalar("SELECT role FROM room_members WHERE room_id = ? AND user_id = ?")
            .bind(&room_id)
            .bind(&user_b)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(role, "moderator");
}

// 13. Promote is disabled in messenger mode.
#[tokio::test]
async fn test_13_promote_disabled_messenger_mode() {
    let (app, pool) = setup_test_app().await;
    set_moderation_mode(&pool, "messenger").await;
    let (_user_a, token_a) =
        create_test_user(&app, &pool, "alice", "device_client_id_a_12345").await;
    let (user_b, _token_b) = create_test_user(&app, &pool, "bob", "device_client_id_b_12345").await;

    let room_id = create_room_and_add_members(&app, &token_a, &[&user_b]).await;

    let req = Request::builder()
        .method("POST")
        .uri(format!(
            "/api/v1/rooms/{}/members/{}/promote",
            room_id, user_b
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::CONFLICT);

    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(json["error"], "moderation_disabled");
}

// 14. Member cannot promote.
#[tokio::test]
async fn test_14_member_cannot_promote() {
    let (app, pool) = setup_test_app().await;
    set_moderation_mode(&pool, "discord").await;
    let (_user_a, token_a) =
        create_test_user(&app, &pool, "alice", "device_client_id_a_12345").await;
    let (user_b, token_b) = create_test_user(&app, &pool, "bob", "device_client_id_b_12345").await;
    let (user_c, _token_c) =
        create_test_user(&app, &pool, "charlie", "device_client_id_c_12345").await;

    let room_id = create_room_and_add_members(&app, &token_a, &[&user_b, &user_c]).await;

    let req = Request::builder()
        .method("POST")
        .uri(format!(
            "/api/v1/rooms/{}/members/{}/promote",
            room_id, user_c
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_b))
        .body(Body::empty())
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);
}

// 15. Cannot promote the owner.
#[tokio::test]
async fn test_15_cannot_promote_owner() {
    let (app, pool) = setup_test_app().await;
    set_moderation_mode(&pool, "discord").await;
    let (user_a, token_a) =
        create_test_user(&app, &pool, "alice", "device_client_id_a_12345").await;

    let room_id = create_room_and_add_members(&app, &token_a, &[]).await;

    let req = Request::builder()
        .method("POST")
        .uri(format!(
            "/api/v1/rooms/{}/members/{}/promote",
            room_id, user_a
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);

    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(json["error"], "cannot_modify_owner");
}

// 16. Cannot promote an already-moderator.
#[tokio::test]
async fn test_16_cannot_promote_already_moderator() {
    let (app, pool) = setup_test_app().await;
    set_moderation_mode(&pool, "discord").await;
    let (_user_a, token_a) =
        create_test_user(&app, &pool, "alice", "device_client_id_a_12345").await;
    let (user_b, _token_b) = create_test_user(&app, &pool, "bob", "device_client_id_b_12345").await;

    let room_id = create_room_and_add_members(&app, &token_a, &[&user_b]).await;

    // First promote
    let req1 = Request::builder()
        .method("POST")
        .uri(format!(
            "/api/v1/rooms/{}/members/{}/promote",
            room_id, user_b
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();
    app.clone().oneshot(req1).await.unwrap();

    // Second promote -> 409 already_moderator
    let req2 = Request::builder()
        .method("POST")
        .uri(format!(
            "/api/v1/rooms/{}/members/{}/promote",
            room_id, user_b
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();
    let resp2 = app.oneshot(req2).await.unwrap();
    assert_eq!(resp2.status(), StatusCode::CONFLICT);

    let body_bytes = axum::body::to_bytes(resp2.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(json["error"], "already_moderator");
}

// 17. Promote target must be a member.
#[tokio::test]
async fn test_17_promote_target_must_be_member() {
    let (app, pool) = setup_test_app().await;
    set_moderation_mode(&pool, "discord").await;
    let (_user_a, token_a) =
        create_test_user(&app, &pool, "alice", "device_client_id_a_12345").await;
    let (user_b, _token_b) = create_test_user(&app, &pool, "bob", "device_client_id_b_12345").await;

    let room_id = create_room_and_add_members(&app, &token_a, &[]).await;

    let req = Request::builder()
        .method("POST")
        .uri(format!(
            "/api/v1/rooms/{}/members/{}/promote",
            room_id, user_b
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);

    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(json["error"], "member_not_found");
}

// 18. Owner demotes a moderator (discord mode).
#[tokio::test]
async fn test_18_owner_demotes_moderator_discord_mode() {
    let (app, pool) = setup_test_app().await;
    set_moderation_mode(&pool, "discord").await;
    let (_user_a, token_a) =
        create_test_user(&app, &pool, "alice", "device_client_id_a_12345").await;
    let (user_b, _token_b) = create_test_user(&app, &pool, "bob", "device_client_id_b_12345").await;

    let room_id = create_room_and_add_members(&app, &token_a, &[&user_b]).await;

    // Promote B
    let req_prom = Request::builder()
        .method("POST")
        .uri(format!(
            "/api/v1/rooms/{}/members/{}/promote",
            room_id, user_b
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();
    app.clone().oneshot(req_prom).await.unwrap();

    // Demote B
    let req_dem = Request::builder()
        .method("POST")
        .uri(format!(
            "/api/v1/rooms/{}/members/{}/demote",
            room_id, user_b
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();
    let resp = app.oneshot(req_dem).await.unwrap();
    assert_eq!(resp.status(), StatusCode::NO_CONTENT);

    let role: String =
        sqlx::query_scalar("SELECT role FROM room_members WHERE room_id = ? AND user_id = ?")
            .bind(&room_id)
            .bind(&user_b)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(role, "member");
}

// 19. Demote is disabled in messenger mode.
#[tokio::test]
async fn test_19_demote_disabled_messenger_mode() {
    let (app, pool) = setup_test_app().await;
    let (_user_a, token_a) =
        create_test_user(&app, &pool, "alice", "device_client_id_a_12345").await;
    let (user_b, _token_b) = create_test_user(&app, &pool, "bob", "device_client_id_b_12345").await;

    let room_id = create_room_and_add_members(&app, &token_a, &[&user_b]).await;

    // Set B's role to 'moderator' via SQL
    sqlx::query("UPDATE room_members SET role = 'moderator' WHERE room_id = ? AND user_id = ?")
        .bind(&room_id)
        .bind(&user_b)
        .execute(&pool)
        .await
        .unwrap();

    // Ensure mode is messenger
    set_moderation_mode(&pool, "messenger").await;

    let req = Request::builder()
        .method("POST")
        .uri(format!(
            "/api/v1/rooms/{}/members/{}/demote",
            room_id, user_b
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::CONFLICT);

    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(json["error"], "moderation_disabled");
}

// 20. Cannot demote a non-moderator.
#[tokio::test]
async fn test_20_cannot_demote_non_moderator() {
    let (app, pool) = setup_test_app().await;
    set_moderation_mode(&pool, "discord").await;
    let (_user_a, token_a) =
        create_test_user(&app, &pool, "alice", "device_client_id_a_12345").await;
    let (user_b, _token_b) = create_test_user(&app, &pool, "bob", "device_client_id_b_12345").await;

    let room_id = create_room_and_add_members(&app, &token_a, &[&user_b]).await;

    // Demote B (who is member, not moderator) -> 409 not_a_moderator
    let req = Request::builder()
        .method("POST")
        .uri(format!(
            "/api/v1/rooms/{}/members/{}/demote",
            room_id, user_b
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::CONFLICT);

    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(json["error"], "not_a_moderator");
}

// 21. Cannot demote the owner.
#[tokio::test]
async fn test_21_cannot_demote_owner() {
    let (app, pool) = setup_test_app().await;
    set_moderation_mode(&pool, "discord").await;
    let (user_a, token_a) =
        create_test_user(&app, &pool, "alice", "device_client_id_a_12345").await;

    let room_id = create_room_and_add_members(&app, &token_a, &[]).await;

    let req = Request::builder()
        .method("POST")
        .uri(format!(
            "/api/v1/rooms/{}/members/{}/demote",
            room_id, user_a
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);

    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(json["error"], "cannot_modify_owner");
}

// 22. Owner transfers to a member.
#[tokio::test]
async fn test_22_owner_transfers_ownership_to_member() {
    let (app, pool) = setup_test_app().await;
    let (user_a, token_a) =
        create_test_user(&app, &pool, "alice", "device_client_id_a_12345").await;
    let (user_b, token_b) = create_test_user(&app, &pool, "bob", "device_client_id_b_12345").await;

    let room_id = create_room_and_add_members(&app, &token_a, &[&user_b]).await;

    let req = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/transfer", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "user_id": user_b }).to_string()))
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::NO_CONTENT);

    // Assert B's role is owner
    let role_b: String =
        sqlx::query_scalar("SELECT role FROM room_members WHERE room_id = ? AND user_id = ?")
            .bind(&room_id)
            .bind(&user_b)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(role_b, "owner");

    // Assert A's role is member
    let role_a: String =
        sqlx::query_scalar("SELECT role FROM room_members WHERE room_id = ? AND user_id = ?")
            .bind(&room_id)
            .bind(&user_a)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(role_a, "member");

    // Assert rooms.owner_id is B
    let owner_id: String = sqlx::query_scalar("SELECT owner_id FROM rooms WHERE id = ?")
        .bind(&room_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(owner_id, user_b);

    // Check GET /rooms/:id for B returns owner role
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

// 23. Cannot transfer to self.
#[tokio::test]
async fn test_23_cannot_transfer_to_self() {
    let (app, pool) = setup_test_app().await;
    let (user_a, token_a) =
        create_test_user(&app, &pool, "alice", "device_client_id_a_12345").await;

    let room_id = create_room_and_add_members(&app, &token_a, &[]).await;

    let req = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/transfer", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "user_id": user_a }).to_string()))
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);

    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(json["error"], "cannot_transfer_to_self");
}

// 24. Cannot transfer to a non-member.
#[tokio::test]
async fn test_24_cannot_transfer_to_non_member() {
    let (app, pool) = setup_test_app().await;
    let (_user_a, token_a) =
        create_test_user(&app, &pool, "alice", "device_client_id_a_12345").await;
    let (user_b, _token_b) = create_test_user(&app, &pool, "bob", "device_client_id_b_12345").await;

    let room_id = create_room_and_add_members(&app, &token_a, &[]).await;

    let req = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/transfer", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "user_id": user_b }).to_string()))
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);

    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(json["error"], "member_not_found");
}

// 25. Member cannot transfer ownership.
#[tokio::test]
async fn test_25_member_cannot_transfer_ownership() {
    let (app, pool) = setup_test_app().await;
    let (user_a, token_a) =
        create_test_user(&app, &pool, "alice", "device_client_id_a_12345").await;
    let (user_b, token_b) = create_test_user(&app, &pool, "bob", "device_client_id_b_12345").await;

    let room_id = create_room_and_add_members(&app, &token_a, &[&user_b]).await;

    let req = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/transfer", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_b))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "user_id": user_a }).to_string()))
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);

    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(json["error"], "forbidden");
}

// 26. Non-member transfer returns 404.
#[tokio::test]
async fn test_26_non_member_transfer_returns_404() {
    let (app, pool) = setup_test_app().await;
    let (_user_a, token_a) =
        create_test_user(&app, &pool, "alice", "device_client_id_a_12345").await;
    let (user_b, _token_b) = create_test_user(&app, &pool, "bob", "device_client_id_b_12345").await;
    let (_user_c, token_c) =
        create_test_user(&app, &pool, "charlie", "device_client_id_c_12345").await;

    let room_id = create_room_and_add_members(&app, &token_a, &[&user_b]).await;

    // User C (non-member) attempts transfer
    let req = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/transfer", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_c))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "user_id": user_b }).to_string()))
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);

    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(json["error"], "room_not_found");
}
