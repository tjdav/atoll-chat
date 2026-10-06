mod common;

use axum::http::{header, StatusCode};
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
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

    let user_id =
        common::register_user(app, username, "Password123!", invite_code.as_deref()).await;
    let (status, login_res) =
        common::login_user(app, username, "Password123!", client_id, None).await;
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
async fn test_reaction_write_flow() {
    let (app, pool) = common::setup_test_app().await;

    let owner_client_id = "owner_client_1234567";
    let user2_client_id = "user2_client_1234567";

    // 1. Register owner & user2
    let (_owner_id, owner_token) =
        create_test_user(&app, &pool, "react_owner", owner_client_id).await;
    let (user2_id, user2_token) =
        create_test_user(&app, &pool, "react_user2", user2_client_id).await;

    // Create room via router call or direct helper
    let req = axum::http::Request::builder()
        .method("POST")
        .uri("/api/v1/rooms")
        .header("Authorization", format!("Bearer {}", owner_token))
        .header("Content-Type", "application/json")
        .body(axum::body::Body::from(json!({}).to_string()))
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::CREATED);
    let body_bytes = axum::body::to_bytes(res.into_body(), usize::MAX)
        .await
        .unwrap();
    let room_body: Value = serde_json::from_slice(&body_bytes).unwrap();
    let room_id = room_body["id"].as_str().unwrap();

    // Add user2 to room
    let req = axum::http::Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/members", room_id))
        .header("Authorization", format!("Bearer {}", owner_token))
        .header("Content-Type", "application/json")
        .body(axum::body::Body::from(
            json!({ "user_id": user2_id }).to_string(),
        ))
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::CREATED);

    // 3. Submit message in room
    let ct = BASE64.encode(b"hello world");
    let req = axum::http::Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/messages", room_id))
        .header("Authorization", format!("Bearer {}", owner_token))
        .header("Content-Type", "application/json")
        .body(axum::body::Body::from(
            json!({
                "sender_client_id": owner_client_id,
                "epoch": 0,
                "content_type": "application",
                "ciphertext": ct,
            })
            .to_string(),
        ))
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::CREATED);
    let body_bytes = axum::body::to_bytes(res.into_body(), usize::MAX)
        .await
        .unwrap();
    let msg_body: Value = serde_json::from_slice(&body_bytes).unwrap();
    let msg_id = msg_body["message_id"].as_str().unwrap();

    // 4. Add reaction by owner -> returns 201 Created
    let req = axum::http::Request::builder()
        .method("POST")
        .uri(format!(
            "/api/v1/rooms/{}/messages/{}/reactions",
            room_id, msg_id
        ))
        .header("Authorization", format!("Bearer {}", owner_token))
        .header("Content-Type", "application/json")
        .body(axum::body::Body::from(
            json!({
                "reaction": "👍",
                "sender_client_id": owner_client_id
            })
            .to_string(),
        ))
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::CREATED);
    assert_eq!(
        res.headers().get(header::CACHE_CONTROL).unwrap(),
        "no-store"
    );
    let body_bytes = axum::body::to_bytes(res.into_body(), usize::MAX)
        .await
        .unwrap();
    let add_body: Value = serde_json::from_slice(&body_bytes).unwrap();
    let reaction_id = add_body["id"].as_str().unwrap().to_string();
    assert_eq!(add_body["room_id"], room_id);
    assert_eq!(add_body["message_id"], msg_id);
    assert_eq!(add_body["reaction"], "👍");

    // 5. Add duplicate reaction by same user & client returns 200 OK with same reaction id (idempotent repeat)
    let req = axum::http::Request::builder()
        .method("POST")
        .uri(format!(
            "/api/v1/rooms/{}/messages/{}/reactions",
            room_id, msg_id
        ))
        .header("Authorization", format!("Bearer {}", owner_token))
        .header("Content-Type", "application/json")
        .body(axum::body::Body::from(
            json!({
                "reaction": "👍",
                "sender_client_id": owner_client_id
            })
            .to_string(),
        ))
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let body_bytes = axum::body::to_bytes(res.into_body(), usize::MAX)
        .await
        .unwrap();
    let repeat_body: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(repeat_body["id"], reaction_id);

    // 6. Two different reactions from same client succeed -> 201 Created
    let req = axum::http::Request::builder()
        .method("POST")
        .uri(format!(
            "/api/v1/rooms/{}/messages/{}/reactions",
            room_id, msg_id
        ))
        .header("Authorization", format!("Bearer {}", owner_token))
        .header("Content-Type", "application/json")
        .body(axum::body::Body::from(
            json!({
                "reaction": "❤️",
                "sender_client_id": owner_client_id
            })
            .to_string(),
        ))
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::CREATED);

    // 7. Remove reaction by reaction_id (soft-delete)
    let req = axum::http::Request::builder()
        .method("DELETE")
        .uri(format!(
            "/api/v1/rooms/{}/messages/{}/reactions/{}",
            room_id, msg_id, reaction_id
        ))
        .header("Authorization", format!("Bearer {}", owner_token))
        .body(axum::body::Body::empty())
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::NO_CONTENT);

    // 8. Subsequent re-add reactivates row -> 201 Created with same reaction_id
    let req = axum::http::Request::builder()
        .method("POST")
        .uri(format!(
            "/api/v1/rooms/{}/messages/{}/reactions",
            room_id, msg_id
        ))
        .header("Authorization", format!("Bearer {}", owner_token))
        .header("Content-Type", "application/json")
        .body(axum::body::Body::from(
            json!({
                "reaction": "👍",
                "sender_client_id": owner_client_id
            })
            .to_string(),
        ))
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::CREATED);
    let body_bytes = axum::body::to_bytes(res.into_body(), usize::MAX)
        .await
        .unwrap();
    let readd_body: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(readd_body["id"], reaction_id);

    // 9. Non-member cannot add (HTTP 404 room_not_found)
    let (_non_member_id, non_member_token) =
        create_test_user(&app, &pool, "react_non_member", "nm_client_12345678").await;

    let req = axum::http::Request::builder()
        .method("POST")
        .uri(format!(
            "/api/v1/rooms/{}/messages/{}/reactions",
            room_id, msg_id
        ))
        .header("Authorization", format!("Bearer {}", non_member_token))
        .header("Content-Type", "application/json")
        .body(axum::body::Body::from(
            json!({
                "reaction": "👍",
                "client_id": "nm_client_12345678"
            })
            .to_string(),
        ))
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::NOT_FOUND);

    // 10. Unknown message returns 404 message_not_found
    let req = axum::http::Request::builder()
        .method("POST")
        .uri(format!(
            "/api/v1/rooms/{}/messages/nonexistent_msg/reactions",
            room_id
        ))
        .header("Authorization", format!("Bearer {}", owner_token))
        .header("Content-Type", "application/json")
        .body(axum::body::Body::from(
            json!({
                "reaction": "👍",
                "client_id": owner_client_id
            })
            .to_string(),
        ))
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::NOT_FOUND);

    // 11. Remove non-existent reaction returns 404 reaction_not_found
    let req = axum::http::Request::builder()
        .method("DELETE")
        .uri(format!(
            "/api/v1/rooms/{}/messages/{}/reactions/nonexistent_rxn_id",
            room_id, msg_id
        ))
        .header("Authorization", format!("Bearer {}", owner_token))
        .body(axum::body::Body::empty())
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::NOT_FOUND);

    // 12. Remove another user's reaction: regular user returns 403 forbidden, room owner/moderator succeeds
    // User2 adds a reaction
    let req = axum::http::Request::builder()
        .method("POST")
        .uri(format!(
            "/api/v1/rooms/{}/messages/{}/reactions",
            room_id, msg_id
        ))
        .header("Authorization", format!("Bearer {}", user2_token))
        .header("Content-Type", "application/json")
        .body(axum::body::Body::from(
            json!({
                "reaction": "🔥",
                "sender_client_id": user2_client_id
            })
            .to_string(),
        ))
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::CREATED);
    let body_bytes = axum::body::to_bytes(res.into_body(), usize::MAX)
        .await
        .unwrap();
    let user2_rxn_id = serde_json::from_slice::<Value>(&body_bytes).unwrap()["id"]
        .as_str()
        .unwrap()
        .to_string();

    // Register user3 (regular member)
    let (user3_id, user3_token) =
        create_test_user(&app, &pool, "react_user3", "user3_client_12345").await;
    let req = axum::http::Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/members", room_id))
        .header("Authorization", format!("Bearer {}", owner_token))
        .header("Content-Type", "application/json")
        .body(axum::body::Body::from(
            json!({ "user_id": user3_id }).to_string(),
        ))
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::CREATED);

    // Regular member user3 tries to remove user2's reaction -> 403 Forbidden
    let req = axum::http::Request::builder()
        .method("DELETE")
        .uri(format!(
            "/api/v1/rooms/{}/messages/{}/reactions/{}",
            room_id, msg_id, user2_rxn_id
        ))
        .header("Authorization", format!("Bearer {}", user3_token))
        .body(axum::body::Body::empty())
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::FORBIDDEN);

    // Room owner removes user2's reaction -> 204 No Content
    let req = axum::http::Request::builder()
        .method("DELETE")
        .uri(format!(
            "/api/v1/rooms/{}/messages/{}/reactions/{}",
            room_id, msg_id, user2_rxn_id
        ))
        .header("Authorization", format!("Bearer {}", owner_token))
        .body(axum::body::Body::empty())
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::NO_CONTENT);

    // 13. Reaction on tombstoned message succeeds (§7.6)
    // Delete the parent message (tombstone)
    let req = axum::http::Request::builder()
        .method("DELETE")
        .uri(format!("/api/v1/rooms/{}/messages/{}", room_id, msg_id))
        .header("Authorization", format!("Bearer {}", owner_token))
        .body(axum::body::Body::empty())
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::NO_CONTENT);

    // Adding reaction to tombstoned message succeeds -> 201 Created
    let req = axum::http::Request::builder()
        .method("POST")
        .uri(format!(
            "/api/v1/rooms/{}/messages/{}/reactions",
            room_id, msg_id
        ))
        .header("Authorization", format!("Bearer {}", owner_token))
        .header("Content-Type", "application/json")
        .body(axum::body::Body::from(
            json!({
                "reaction": "👏",
                "sender_client_id": owner_client_id
            })
            .to_string(),
        ))
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::CREATED);
    let body_bytes = axum::body::to_bytes(res.into_body(), usize::MAX)
        .await
        .unwrap();
    let tombstone_rxn_id = serde_json::from_slice::<Value>(&body_bytes).unwrap()["id"]
        .as_str()
        .unwrap()
        .to_string();

    // Removing reaction from tombstoned message succeeds -> 204 No Content
    let req = axum::http::Request::builder()
        .method("DELETE")
        .uri(format!(
            "/api/v1/rooms/{}/messages/{}/reactions/{}",
            room_id, msg_id, tombstone_rxn_id
        ))
        .header("Authorization", format!("Bearer {}", owner_token))
        .body(axum::body::Body::empty())
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::NO_CONTENT);

    // 14. Moderator authorization in Discord vs Messenger mode
    // User2 adds a reaction
    let req = axum::http::Request::builder()
        .method("POST")
        .uri(format!(
            "/api/v1/rooms/{}/messages/{}/reactions",
            room_id, msg_id
        ))
        .header("Authorization", format!("Bearer {}", user2_token))
        .header("Content-Type", "application/json")
        .body(axum::body::Body::from(
            json!({
                "reaction": "🚀",
                "sender_client_id": user2_client_id
            })
            .to_string(),
        ))
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::CREATED);
    let body_bytes = axum::body::to_bytes(res.into_body(), usize::MAX)
        .await
        .unwrap();
    let mod_target_rxn_id = serde_json::from_slice::<Value>(&body_bytes).unwrap()["id"]
        .as_str()
        .unwrap()
        .to_string();

    // Promote user3 to moderator
    sqlx::query("UPDATE room_members SET role = 'moderator' WHERE room_id = ? AND user_id = ?")
        .bind(room_id)
        .bind(&user3_id)
        .execute(&pool)
        .await
        .unwrap();

    // In Messenger mode (default), moderator user3 tries to delete user2's reaction -> 403 Forbidden
    let req = axum::http::Request::builder()
        .method("DELETE")
        .uri(format!(
            "/api/v1/rooms/{}/messages/{}/reactions/{}",
            room_id, msg_id, mod_target_rxn_id
        ))
        .header("Authorization", format!("Bearer {}", user3_token))
        .body(axum::body::Body::empty())
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::FORBIDDEN);

    // Set moderation_override = 'discord' for room
    sqlx::query("UPDATE rooms SET moderation_override = 'discord' WHERE id = ?")
        .bind(room_id)
        .execute(&pool)
        .await
        .unwrap();

    // In Discord mode, moderator user3 deletes user2's reaction -> 204 No Content
    let req = axum::http::Request::builder()
        .method("DELETE")
        .uri(format!(
            "/api/v1/rooms/{}/messages/{}/reactions/{}",
            room_id, msg_id, mod_target_rxn_id
        ))
        .header("Authorization", format!("Bearer {}", user3_token))
        .body(axum::body::Body::empty())
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::NO_CONTENT);

    // 15. Delete endpoint is unthrottled: 100 sequential deletes return 404 (or 204) without 429
    for i in 0..100 {
        let req = axum::http::Request::builder()
            .method("DELETE")
            .uri(format!(
                "/api/v1/rooms/{}/messages/{}/reactions/nonexistent_rxn_{}",
                room_id, msg_id, i
            ))
            .header("Authorization", format!("Bearer {}", owner_token))
            .body(axum::body::Body::empty())
            .unwrap();
        let res = app.clone().oneshot(req).await.unwrap();
        assert_ne!(
            res.status(),
            StatusCode::TOO_MANY_REQUESTS,
            "Delete endpoint must not be rate limited"
        );
    }

    // 16. Database UNIQUE constraint enforcement
    let insert_result = sqlx::query(
        r#"
        INSERT INTO reactions (id, room_id, message_id, sender_user_id, sender_client_id, reaction)
        VALUES ('dup_1', ?, ?, ?, ?, '🎉'), ('dup_2', ?, ?, ?, ?, '🎉')
        "#,
    )
    .bind(room_id)
    .bind(msg_id)
    .bind(&user2_id)
    .bind(user2_client_id)
    .bind(room_id)
    .bind(msg_id)
    .bind(&user2_id)
    .bind(user2_client_id)
    .execute(&pool)
    .await;
    assert!(
        insert_result.is_err(),
        "Direct insert of duplicate reaction must trigger SQLite UNIQUE constraint violation"
    );

    // 17. Database Cascade Deletion on parent room deletion
    let rxn_count_before: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM reactions WHERE room_id = ?")
            .bind(room_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(rxn_count_before > 0);

    sqlx::query("DELETE FROM rooms WHERE id = ?")
        .bind(room_id)
        .execute(&pool)
        .await
        .unwrap();

    let rxn_count_after: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM reactions WHERE room_id = ?")
            .bind(room_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(
        rxn_count_after, 0,
        "Deleting parent room must cascade-delete all reactions in database"
    );
}
