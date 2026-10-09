use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use serde_json::{json, Value};
use tower::ServiceExt;

mod common;

fn valid_pubkey() -> String {
    URL_SAFE_NO_PAD.encode([9u8; 32])
}

async fn create_test_bot(
    app: &axum::Router,
    user_token: &str,
    scopes: &[&str],
) -> (String, String) {
    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/bots")
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "display_name": "Grant Bot",
                "bot_identity_pubkey": valid_pubkey(),
                "bot_command_pubkey": valid_pubkey(),
                "identity_pubkey": valid_pubkey(),
                "declared_scopes": scopes
            })
            .to_string(),
        ))
        .unwrap();

    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::CREATED);
    let body: Value = serde_json::from_slice(
        &axum::body::to_bytes(res.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();

    let bot_id = body["bot_id"].as_str().unwrap().to_string();
    let bot_token = body["bot_token"].as_str().unwrap().to_string();
    (bot_id, bot_token)
}

async fn create_test_room(app: &axum::Router, user_token: &str, moderation_mode: &str) -> String {
    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms")
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "name": "Bot Room",
                "moderation_mode": moderation_mode
            })
            .to_string(),
        ))
        .unwrap();

    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::CREATED);
    let body: Value = serde_json::from_slice(
        &axum::body::to_bytes(res.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();

    body["id"].as_str().unwrap().to_string()
}

#[tokio::test]
async fn test_room_bot_grants_and_mode_derivation() {
    let (app, pool) = common::setup_test_app().await;
    let (owner_token, _owner_id) = common::create_test_user_and_session(&app, &pool).await;

    let (bot_id, _) = create_test_bot(
        &app,
        &owner_token,
        &[
            "post_message",
            "read_metadata",
            "read_content",
            "post_reaction",
        ],
    )
    .await;

    let room_id = create_test_room(&app, &owner_token, "messenger").await;

    // 1. Grant scope not declared -> 400 scope_not_declared
    let req_undeclared = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/bots", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", owner_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "bot_id": bot_id,
                "scopes": ["post_attachment"] // Not declared
            })
            .to_string(),
        ))
        .unwrap();

    let res_undeclared = app.clone().oneshot(req_undeclared).await.unwrap();
    assert_eq!(res_undeclared.status(), StatusCode::BAD_REQUEST);

    // 2. Grant write_only mode
    let (write_bot_id, _) = create_test_bot(&app, &owner_token, &["post_message"]).await;
    let req_grant_write = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/bots", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", owner_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "bot_id": write_bot_id,
                "scopes": ["post_message"]
            })
            .to_string(),
        ))
        .unwrap();

    let res_grant_write = app.clone().oneshot(req_grant_write).await.unwrap();
    assert_eq!(res_grant_write.status(), StatusCode::CREATED);
    let body_grant_write: Value = serde_json::from_slice(
        &axum::body::to_bytes(res_grant_write.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(body_grant_write["mode"], "write_only");

    // 3. Grant member mode (includes read_content & post_reaction)
    // Seed key package for member mode MLS add test
    sqlx::query(
        r#"
        INSERT INTO key_packages (id, bot_id, client_id, cipher_suite, key_package)
        VALUES ('kp_b1', ?, 'c_bot_1', 1, X'1234')
        "#,
    )
    .bind(&bot_id)
    .execute(&pool)
    .await
    .unwrap();

    let req_grant_member = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/bots", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", owner_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "bot_id": bot_id,
                "scopes": ["post_message", "read_content", "post_reaction"]
            })
            .to_string(),
        ))
        .unwrap();

    let res_grant_member = app.clone().oneshot(req_grant_member).await.unwrap();
    assert_eq!(res_grant_member.status(), StatusCode::CREATED);
    let body_grant_member: Value = serde_json::from_slice(
        &axum::body::to_bytes(res_grant_member.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(body_grant_member["mode"], "member");

    // Assert pending_mls_adds row exists for bot in member mode
    let add_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM pending_mls_adds WHERE room_id = ? AND target_bot_id = ?",
    )
    .bind(&room_id)
    .bind(&bot_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(add_count, 1);

    // 4. GET /rooms/:id/bots — Test connected field owner visibility
    let req_get_bots_owner = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/rooms/{}/bots", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", owner_token))
        .body(Body::empty())
        .unwrap();

    let res_get_bots_owner = app.clone().oneshot(req_get_bots_owner).await.unwrap();
    assert_eq!(res_get_bots_owner.status(), StatusCode::OK);
    let body_get_owner: Value = serde_json::from_slice(
        &axum::body::to_bytes(res_get_bots_owner.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();

    let bots_array = body_get_owner["bots"].as_array().unwrap();
    assert_eq!(bots_array.len(), 2);
    // Owner should see "connected" boolean field
    assert!(bots_array[0].get("connected").is_some());
    assert_eq!(bots_array[0]["connected"], false);

    // Non-owner member should NOT see "connected" field
    let (other_token, other_id) = common::create_test_user_and_session(&app, &pool).await;
    sqlx::query("INSERT INTO room_members (room_id, user_id, role) VALUES (?, ?, 'member')")
        .bind(&room_id)
        .bind(&other_id)
        .execute(&pool)
        .await
        .unwrap();

    let req_get_bots_other = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/rooms/{}/bots", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", other_token))
        .body(Body::empty())
        .unwrap();

    let res_get_bots_other = app.clone().oneshot(req_get_bots_other).await.unwrap();
    let body_get_other: Value = serde_json::from_slice(
        &axum::body::to_bytes(res_get_bots_other.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    let other_array = body_get_other["bots"].as_array().unwrap();
    assert!(other_array[0].get("connected").is_none());

    // 5. PATCH /rooms/:id/bots/:bot_id — Transition away from member mode
    let req_patch_away = Request::builder()
        .method("PATCH")
        .uri(format!("/api/v1/rooms/{}/bots/{}", room_id, bot_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", owner_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "scopes": ["post_message"] // Transition from member to write_only
            })
            .to_string(),
        ))
        .unwrap();

    let res_patch_away = app.clone().oneshot(req_patch_away).await.unwrap();
    assert_eq!(res_patch_away.status(), StatusCode::OK);
    let body_patch_away: Value = serde_json::from_slice(
        &axum::body::to_bytes(res_patch_away.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(body_patch_away["mode"], "write_only");

    // Assert pending_mls_removes row exists for transition away from member
    let remove_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM pending_mls_removes WHERE room_id = ? AND target_bot_id = ?",
    )
    .bind(&room_id)
    .bind(&bot_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(remove_count, 1);

    // 6. DELETE /rooms/:id/bots/:bot_id — Revoke grant
    let req_revoke = Request::builder()
        .method("DELETE")
        .uri(format!("/api/v1/rooms/{}/bots/{}", room_id, bot_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", owner_token))
        .body(Body::empty())
        .unwrap();

    let res_revoke = app.clone().oneshot(req_revoke).await.unwrap();
    assert_eq!(res_revoke.status(), StatusCode::NO_CONTENT);

    // Verify revoked grant is excluded from list
    let req_get_after = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/rooms/{}/bots", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", owner_token))
        .body(Body::empty())
        .unwrap();

    let res_get_after = app.clone().oneshot(req_get_after).await.unwrap();
    let body_after: Value = serde_json::from_slice(
        &axum::body::to_bytes(res_get_after.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(body_after["bots"].as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn test_room_bot_moderation_mode_permissions() {
    let (app, pool) = common::setup_test_app().await;
    let (owner_token, _) = common::create_test_user_and_session(&app, &pool).await;
    let (mod_token, mod_id) = common::create_test_user_and_session(&app, &pool).await;

    let (bot_id, _) = create_test_bot(&app, &owner_token, &["post_message"]).await;

    // 1. Messenger mode room: moderator CANNOT grant bots
    let room_messenger = create_test_room(&app, &owner_token, "messenger").await;
    sqlx::query("UPDATE rooms SET moderation_override = 'messenger' WHERE id = ?")
        .bind(&room_messenger)
        .execute(&pool)
        .await
        .unwrap();

    sqlx::query("INSERT INTO room_members (room_id, user_id, role) VALUES (?, ?, 'moderator')")
        .bind(&room_messenger)
        .bind(&mod_id)
        .execute(&pool)
        .await
        .unwrap();

    let req_mod_messenger = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/bots", room_messenger))
        .header(header::AUTHORIZATION, format!("Bearer {}", mod_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({ "bot_id": bot_id, "scopes": ["post_message"] }).to_string(),
        ))
        .unwrap();

    let res_mod_messenger = app.clone().oneshot(req_mod_messenger).await.unwrap();
    assert_eq!(res_mod_messenger.status(), StatusCode::FORBIDDEN);

    // 2. Discord mode room: moderator CAN grant bots
    let room_discord = create_test_room(&app, &owner_token, "discord").await;
    sqlx::query("UPDATE rooms SET moderation_override = 'discord' WHERE id = ?")
        .bind(&room_discord)
        .execute(&pool)
        .await
        .unwrap();

    sqlx::query("INSERT INTO room_members (room_id, user_id, role) VALUES (?, ?, 'moderator')")
        .bind(&room_discord)
        .bind(&mod_id)
        .execute(&pool)
        .await
        .unwrap();

    let req_mod_discord = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/bots", room_discord))
        .header(header::AUTHORIZATION, format!("Bearer {}", mod_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({ "bot_id": bot_id, "scopes": ["post_message"] }).to_string(),
        ))
        .unwrap();

    let res_mod_discord = app.clone().oneshot(req_mod_discord).await.unwrap();
    assert_eq!(res_mod_discord.status(), StatusCode::CREATED);
}
