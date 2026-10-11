use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use axum::Router;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use ed25519_dalek::{Signer, SigningKey};
use serde_json::{json, Value};
use sqlx::Row;
use tower::ServiceExt;

mod common;

fn make_keypair(byte: u8) -> (SigningKey, String) {
    let sk = SigningKey::from_bytes(&[byte; 32]);
    let vk = sk.verifying_key();
    let pub_str = URL_SAFE_NO_PAD.encode(vk.as_bytes());
    (sk, pub_str)
}

fn valid_pubkey(byte: u8) -> String {
    URL_SAFE_NO_PAD.encode([byte; 32])
}

async fn create_test_room(app: &Router, user_token: &str) -> String {
    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms")
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({"name": "Test Room"}).to_string()))
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

async fn get_room_epoch(app: &Router, user_token: &str, room_id: &str) -> u64 {
    let req = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/rooms/{}/epoch", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .body(Body::empty())
        .unwrap();

    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let body: Value = serde_json::from_slice(
        &axum::body::to_bytes(res.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    body["epoch"].as_u64().unwrap()
}

#[tokio::test]
async fn test_bot_key_rotation_happy_path_and_events() {
    let (app, pool) = common::setup_test_app().await;
    let (user_token, user_id) = common::create_test_user_and_session(&app, &pool).await;

    let (_, old_bot_id_pk) = make_keypair(1);
    let old_bot_cmd_pk = valid_pubkey(2);
    let old_id_pk = valid_pubkey(3);

    // Create a bot
    let req_create = Request::builder()
        .method("POST")
        .uri("/api/v1/bots")
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "display_name": "Rotation Bot",
                "bot_identity_pubkey": old_bot_id_pk,
                "bot_command_pubkey": old_bot_cmd_pk,
                "identity_pubkey": old_id_pk,
                "declared_scopes": ["post_message"]
            })
            .to_string(),
        ))
        .unwrap();

    let res_create = app.clone().oneshot(req_create).await.unwrap();
    assert_eq!(res_create.status(), StatusCode::CREATED);
    let body_create: Value = serde_json::from_slice(
        &axum::body::to_bytes(res_create.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    let bot_id = body_create["bot_id"].as_str().unwrap().to_string();

    // Verify initial KT leaf index = 1
    let initial_leaf_index: i64 =
        sqlx::query_scalar("SELECT MAX(leaf_index) FROM key_transparency_log WHERE bot_id = ?")
            .bind(&bot_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(initial_leaf_index, 1);

    // New keys for rotation
    let (_, new_bot_id_pk) = make_keypair(10);
    let new_bot_cmd_pk = valid_pubkey(11);
    let new_id_pk = valid_pubkey(12);

    // PATCH /bots/:id/keys — Owner rotates keys
    let req_rotate = Request::builder()
        .method("PATCH")
        .uri(format!("/api/v1/bots/{}/keys", bot_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "bot_identity_pubkey": new_bot_id_pk,
                "bot_command_pubkey": new_bot_cmd_pk,
                "identity_pubkey": new_id_pk
            })
            .to_string(),
        ))
        .unwrap();

    let res_rotate = app.clone().oneshot(req_rotate).await.unwrap();
    assert_eq!(res_rotate.status(), StatusCode::OK);
    assert_eq!(
        res_rotate.headers().get(header::CACHE_CONTROL).unwrap(),
        "no-store"
    );

    let body_rotate: Value = serde_json::from_slice(
        &axum::body::to_bytes(res_rotate.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(body_rotate["bot_id"], bot_id);
    assert_eq!(body_rotate["bot_identity_pubkey"], new_bot_id_pk);
    assert_eq!(body_rotate["bot_command_pubkey"], new_bot_cmd_pk);
    assert_eq!(body_rotate["identity_pubkey"], new_id_pk);

    // Check DB bot_accounts updated
    let row = sqlx::query(
        "SELECT bot_identity_pubkey, bot_command_pubkey, identity_pubkey FROM bot_accounts WHERE id = ?",
    )
    .bind(&bot_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    let db_bot_id_pk: String = row.get("bot_identity_pubkey");
    let db_bot_cmd_pk: String = row.get("bot_command_pubkey");
    let db_id_pk: String = row.get("identity_pubkey");

    assert_eq!(db_bot_id_pk, new_bot_id_pk);
    assert_eq!(db_bot_cmd_pk, new_bot_cmd_pk);
    assert_eq!(db_id_pk, new_id_pk);

    // Verify a new KT leaf was appended (leaf index = 2)
    let count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM key_transparency_log WHERE bot_id = ?")
            .bind(&bot_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(count, 2);

    let latest_leaf = sqlx::query(
        "SELECT leaf_index, bot_identity_pubkey, command_pubkey, identity_pubkey FROM key_transparency_log WHERE bot_id = ? ORDER BY leaf_index DESC LIMIT 1",
    )
    .bind(&bot_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    let leaf_idx: i64 = latest_leaf.get("leaf_index");
    let leaf_bot_id_pk: String = latest_leaf.get("bot_identity_pubkey");
    let leaf_bot_cmd_pk: String = latest_leaf.get("command_pubkey");
    let leaf_id_pk: String = latest_leaf.get("identity_pubkey");

    assert_eq!(leaf_idx, 2);
    assert_eq!(leaf_bot_id_pk, new_bot_id_pk);
    assert_eq!(leaf_bot_cmd_pk, new_bot_cmd_pk);
    assert_eq!(leaf_id_pk, new_id_pk);

    // Verify audit log entry
    let audit_row = sqlx::query(
        "SELECT action, target_type, target_id, metadata FROM audit_log WHERE action = 'bot.key_rotate' AND target_id = ?",
    )
    .bind(&bot_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    let action: String = audit_row.get("action");
    let target_type: String = audit_row.get("target_type");
    let metadata_str: String = audit_row.get("metadata");
    let metadata: Value = serde_json::from_str(&metadata_str).unwrap();

    assert_eq!(action, "bot.key_rotate");
    assert_eq!(target_type, "bot");
    assert_eq!(metadata["bot_id"], bot_id);
    assert!(metadata["room_id"].is_null());
    // Confirm pubkey values are NOT present in metadata
    assert!(metadata.get("bot_identity_pubkey").is_none());
    assert!(metadata.get("bot_command_pubkey").is_none());
    assert!(metadata.get("identity_pubkey").is_none());

    // Regression check: GET /bots/:id returns updated record
    let req_get = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/bots/{}", bot_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .body(Body::empty())
        .unwrap();

    let res_get = app.clone().oneshot(req_get).await.unwrap();
    assert_eq!(res_get.status(), StatusCode::OK);
    let body_get: Value = serde_json::from_slice(
        &axum::body::to_bytes(res_get.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(body_get["bot_identity_pubkey"], new_bot_id_pk);
    assert_eq!(body_get["owner_user_id"], user_id);
}

#[tokio::test]
async fn test_bot_key_rotation_auth_matrix() {
    let (app, pool) = common::setup_test_app().await;
    let (owner_token, _) = common::create_test_user_and_session(&app, &pool).await;
    let (other_user_token, _) = common::create_test_user_and_session(&app, &pool).await;

    // Create Bot 1
    let req_c1 = Request::builder()
        .method("POST")
        .uri("/api/v1/bots")
        .header(header::AUTHORIZATION, format!("Bearer {}", owner_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "display_name": "Bot 1",
                "bot_identity_pubkey": valid_pubkey(1),
                "bot_command_pubkey": valid_pubkey(2),
                "identity_pubkey": valid_pubkey(3),
                "declared_scopes": ["post_message"]
            })
            .to_string(),
        ))
        .unwrap();
    let res_c1 = app.clone().oneshot(req_c1).await.unwrap();
    let b1: Value = serde_json::from_slice(
        &axum::body::to_bytes(res_c1.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    let bot_id_1 = b1["bot_id"].as_str().unwrap().to_string();
    let bot_token_1 = b1["bot_token"].as_str().unwrap().to_string();

    // Create Bot 2
    let req_c2 = Request::builder()
        .method("POST")
        .uri("/api/v1/bots")
        .header(header::AUTHORIZATION, format!("Bearer {}", owner_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "display_name": "Bot 2",
                "bot_identity_pubkey": valid_pubkey(4),
                "bot_command_pubkey": valid_pubkey(5),
                "identity_pubkey": valid_pubkey(6),
                "declared_scopes": ["post_message"]
            })
            .to_string(),
        ))
        .unwrap();
    let res_c2 = app.clone().oneshot(req_c2).await.unwrap();
    let b2: Value = serde_json::from_slice(
        &axum::body::to_bytes(res_c2.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    let bot_id_2 = b2["bot_id"].as_str().unwrap().to_string();
    let _bot_token_2 = b2["bot_token"].as_str().unwrap().to_string();

    let rotate_body = json!({
        "bot_identity_pubkey": valid_pubkey(20),
        "bot_command_pubkey": valid_pubkey(21),
        "identity_pubkey": valid_pubkey(22)
    })
    .to_string();

    // 1. Unauthenticated -> 401
    let req_unauth = Request::builder()
        .method("PATCH")
        .uri(format!("/api/v1/bots/{}/keys", bot_id_1))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(rotate_body.clone()))
        .unwrap();
    let res_unauth = app.clone().oneshot(req_unauth).await.unwrap();
    assert_eq!(res_unauth.status(), StatusCode::UNAUTHORIZED);

    // 2. Non-owner user session -> 403
    let req_other_user = Request::builder()
        .method("PATCH")
        .uri(format!("/api/v1/bots/{}/keys", bot_id_1))
        .header(
            header::AUTHORIZATION,
            format!("Bearer {}", other_user_token),
        )
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(rotate_body.clone()))
        .unwrap();
    let res_other_user = app.clone().oneshot(req_other_user).await.unwrap();
    assert_eq!(res_other_user.status(), StatusCode::FORBIDDEN);

    // 3. Bot token for a different bot (Bot 1 token rotating Bot 2) -> 403
    let req_other_bot = Request::builder()
        .method("PATCH")
        .uri(format!("/api/v1/bots/{}/keys", bot_id_2))
        .header(header::AUTHORIZATION, format!("Bearer {}", bot_token_1))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(rotate_body.clone()))
        .unwrap();
    let res_other_bot = app.clone().oneshot(req_other_bot).await.unwrap();
    assert_eq!(res_other_bot.status(), StatusCode::FORBIDDEN);

    // 4. Bot's own token (Bot 1 token rotating Bot 1) -> 200 OK
    let req_self_bot = Request::builder()
        .method("PATCH")
        .uri(format!("/api/v1/bots/{}/keys", bot_id_1))
        .header(header::AUTHORIZATION, format!("Bearer {}", bot_token_1))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(rotate_body.clone()))
        .unwrap();
    let res_self_bot = app.clone().oneshot(req_self_bot).await.unwrap();
    assert_eq!(res_self_bot.status(), StatusCode::OK);
}

#[tokio::test]
async fn test_bot_key_rotation_validation_and_errors() {
    let (app, pool) = common::setup_test_app().await;
    let (user_token, _) = common::create_test_user_and_session(&app, &pool).await;

    // Create a bot
    let req_create = Request::builder()
        .method("POST")
        .uri("/api/v1/bots")
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "display_name": "Validation Bot",
                "bot_identity_pubkey": valid_pubkey(1),
                "bot_command_pubkey": valid_pubkey(2),
                "identity_pubkey": valid_pubkey(3),
                "declared_scopes": ["post_message"]
            })
            .to_string(),
        ))
        .unwrap();
    let res_create = app.clone().oneshot(req_create).await.unwrap();
    let b: Value = serde_json::from_slice(
        &axum::body::to_bytes(res_create.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    let bot_id = b["bot_id"].as_str().unwrap().to_string();

    // 1. Missing any field -> 400 partial_rotation_not_supported
    let req_partial = Request::builder()
        .method("PATCH")
        .uri(format!("/api/v1/bots/{}/keys", bot_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "bot_identity_pubkey": valid_pubkey(10),
                "bot_command_pubkey": valid_pubkey(11)
                // identity_pubkey missing
            })
            .to_string(),
        ))
        .unwrap();
    let res_partial = app.clone().oneshot(req_partial).await.unwrap();
    assert_eq!(res_partial.status(), StatusCode::BAD_REQUEST);
    let body_partial: Value = serde_json::from_slice(
        &axum::body::to_bytes(res_partial.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(body_partial["error"], "partial_rotation_not_supported");

    // 2. Invalid bot_identity_pubkey (wrong length: 31 bytes)
    let bad_31b = URL_SAFE_NO_PAD.encode([0u8; 31]);
    let req_bad_id_pk = Request::builder()
        .method("PATCH")
        .uri(format!("/api/v1/bots/{}/keys", bot_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "bot_identity_pubkey": bad_31b,
                "bot_command_pubkey": valid_pubkey(11),
                "identity_pubkey": valid_pubkey(12)
            })
            .to_string(),
        ))
        .unwrap();
    let res_bad_id_pk = app.clone().oneshot(req_bad_id_pk).await.unwrap();
    assert_eq!(res_bad_id_pk.status(), StatusCode::BAD_REQUEST);
    let body_bad_id_pk: Value = serde_json::from_slice(
        &axum::body::to_bytes(res_bad_id_pk.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(body_bad_id_pk["error"], "invalid_bot_identity_pubkey");

    // 3. Invalid bot_command_pubkey (invalid base64url characters)
    let req_bad_cmd_pk = Request::builder()
        .method("PATCH")
        .uri(format!("/api/v1/bots/{}/keys", bot_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "bot_identity_pubkey": valid_pubkey(10),
                "bot_command_pubkey": "not-valid-base64url!!!",
                "identity_pubkey": valid_pubkey(12)
            })
            .to_string(),
        ))
        .unwrap();
    let res_bad_cmd_pk = app.clone().oneshot(req_bad_cmd_pk).await.unwrap();
    assert_eq!(res_bad_cmd_pk.status(), StatusCode::BAD_REQUEST);
    let body_bad_cmd_pk: Value = serde_json::from_slice(
        &axum::body::to_bytes(res_bad_cmd_pk.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(body_bad_cmd_pk["error"], "invalid_bot_command_pubkey");

    // 4. Invalid identity_pubkey (33 bytes)
    let bad_33b = URL_SAFE_NO_PAD.encode([0u8; 33]);
    let req_bad_id = Request::builder()
        .method("PATCH")
        .uri(format!("/api/v1/bots/{}/keys", bot_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "bot_identity_pubkey": valid_pubkey(10),
                "bot_command_pubkey": valid_pubkey(11),
                "identity_pubkey": bad_33b
            })
            .to_string(),
        ))
        .unwrap();
    let res_bad_id = app.clone().oneshot(req_bad_id).await.unwrap();
    assert_eq!(res_bad_id.status(), StatusCode::BAD_REQUEST);
    let body_bad_id: Value = serde_json::from_slice(
        &axum::body::to_bytes(res_bad_id.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(body_bad_id["error"], "invalid_identity_pubkey");

    // 5. Unknown bot ID -> 404 bot_not_found
    let req_unknown = Request::builder()
        .method("PATCH")
        .uri("/api/v1/bots/b_nonexistent/keys")
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "bot_identity_pubkey": valid_pubkey(10),
                "bot_command_pubkey": valid_pubkey(11),
                "identity_pubkey": valid_pubkey(12)
            })
            .to_string(),
        ))
        .unwrap();
    let res_unknown = app.clone().oneshot(req_unknown).await.unwrap();
    assert_eq!(res_unknown.status(), StatusCode::NOT_FOUND);

    // 6. Soft-deleted bot -> 404 bot_not_found
    sqlx::query("UPDATE bot_accounts SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?")
        .bind(&bot_id)
        .execute(&pool)
        .await
        .unwrap();

    let req_deleted = Request::builder()
        .method("PATCH")
        .uri(format!("/api/v1/bots/{}/keys", bot_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "bot_identity_pubkey": valid_pubkey(10),
                "bot_command_pubkey": valid_pubkey(11),
                "identity_pubkey": valid_pubkey(12)
            })
            .to_string(),
        ))
        .unwrap();
    let res_deleted = app.clone().oneshot(req_deleted).await.unwrap();
    assert_eq!(res_deleted.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn test_bot_key_rotation_rate_limit() {
    let (app, pool) = common::setup_test_app().await;
    let (user_token, _) = common::create_test_user_and_session(&app, &pool).await;

    // Create Bot A
    let req_ca = Request::builder()
        .method("POST")
        .uri("/api/v1/bots")
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "display_name": "Bot A",
                "bot_identity_pubkey": valid_pubkey(1),
                "bot_command_pubkey": valid_pubkey(2),
                "identity_pubkey": valid_pubkey(3),
                "declared_scopes": ["post_message"]
            })
            .to_string(),
        ))
        .unwrap();
    let res_ca = app.clone().oneshot(req_ca).await.unwrap();
    let ba: Value = serde_json::from_slice(
        &axum::body::to_bytes(res_ca.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    let bot_id_a = ba["bot_id"].as_str().unwrap().to_string();

    // Create Bot B
    let req_cb = Request::builder()
        .method("POST")
        .uri("/api/v1/bots")
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "display_name": "Bot B",
                "bot_identity_pubkey": valid_pubkey(4),
                "bot_command_pubkey": valid_pubkey(5),
                "identity_pubkey": valid_pubkey(6),
                "declared_scopes": ["post_message"]
            })
            .to_string(),
        ))
        .unwrap();
    let res_cb = app.clone().oneshot(req_cb).await.unwrap();
    let bb: Value = serde_json::from_slice(
        &axum::body::to_bytes(res_cb.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    let bot_id_b = bb["bot_id"].as_str().unwrap().to_string();

    // RATE_BOT_KEY_ROTATE_PER_HOUR default is 5. Perform 5 rotations for Bot A.
    for i in 0..5 {
        let req = Request::builder()
            .method("PATCH")
            .uri(format!("/api/v1/bots/{}/keys", bot_id_a))
            .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(
                json!({
                    "bot_identity_pubkey": valid_pubkey(10 + i),
                    "bot_command_pubkey": valid_pubkey(30 + i),
                    "identity_pubkey": valid_pubkey(50 + i)
                })
                .to_string(),
            ))
            .unwrap();

        let res = app.clone().oneshot(req).await.unwrap();
        assert_eq!(res.status(), StatusCode::OK);
    }

    // 6th rotation for Bot A should fail with 429
    let req_over_a = Request::builder()
        .method("PATCH")
        .uri(format!("/api/v1/bots/{}/keys", bot_id_a))
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "bot_identity_pubkey": valid_pubkey(99),
                "bot_command_pubkey": valid_pubkey(99),
                "identity_pubkey": valid_pubkey(99)
            })
            .to_string(),
        ))
        .unwrap();
    let res_over_a = app.clone().oneshot(req_over_a).await.unwrap();
    assert_eq!(res_over_a.status(), StatusCode::TOO_MANY_REQUESTS);

    // Bot B rotation should still succeed (per-bot limit isolation)
    let req_b = Request::builder()
        .method("PATCH")
        .uri(format!("/api/v1/bots/{}/keys", bot_id_b))
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "bot_identity_pubkey": valid_pubkey(80),
                "bot_command_pubkey": valid_pubkey(81),
                "identity_pubkey": valid_pubkey(82)
            })
            .to_string(),
        ))
        .unwrap();
    let res_b = app.clone().oneshot(req_b).await.unwrap();
    assert_eq!(res_b.status(), StatusCode::OK);
}

#[tokio::test]
async fn test_bot_key_rotation_signature_verification_and_historical_preservation() {
    let (app, pool) = common::setup_test_app().await;
    let (user_token, _user_id) = common::create_test_user_and_session(&app, &pool).await;

    // Create room
    let room_id = create_test_room(&app, &user_token).await;

    let (old_kp, old_bot_id_pk) = make_keypair(1);
    let old_bot_cmd_pk = valid_pubkey(2);
    let old_id_pk = valid_pubkey(3);

    // Create Bot
    let req_create = Request::builder()
        .method("POST")
        .uri("/api/v1/bots")
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "display_name": "Signing Bot",
                "bot_identity_pubkey": old_bot_id_pk,
                "bot_command_pubkey": old_bot_cmd_pk,
                "identity_pubkey": old_id_pk,
                "declared_scopes": ["post_message", "read_content"]
            })
            .to_string(),
        ))
        .unwrap();
    let res_create = app.clone().oneshot(req_create).await.unwrap();
    let body_create: Value = serde_json::from_slice(
        &axum::body::to_bytes(res_create.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    let bot_id = body_create["bot_id"].as_str().unwrap().to_string();
    let bot_token = body_create["bot_token"].as_str().unwrap().to_string();

    // Grant bot to room
    let req_grant = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/bots", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "bot_id": bot_id,
                "scopes": ["post_message", "read_content"]
            })
            .to_string(),
        ))
        .unwrap();
    let res_grant = app.clone().oneshot(req_grant).await.unwrap();
    assert_eq!(res_grant.status(), StatusCode::CREATED);

    // Get current epoch
    let epoch = get_room_epoch(&app, &user_token, &room_id).await;

    // Helper to sign message payload using server signing input
    let sign_payload = |kp: &SigningKey, raw_ct: &[u8]| -> String {
        let input =
            server::signing::encode_bot_message_signing_input(&room_id, epoch, "bot", raw_ct);
        let sig = kp.sign(&input);
        URL_SAFE_NO_PAD.encode(sig.to_bytes())
    };

    let raw_ct_1 = b"pre-rotation bot message";
    let ct_1 = URL_SAFE_NO_PAD.encode(raw_ct_1);
    let sig_1 = sign_payload(&old_kp, raw_ct_1);

    // Post pre-rotation message
    let req_msg_1 = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/bot-messages", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", bot_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "ciphertext": ct_1,
                "content_type": "bot",
                "signature": sig_1,
                "epoch": epoch
            })
            .to_string(),
        ))
        .unwrap();

    let res_msg_1 = app.clone().oneshot(req_msg_1).await.unwrap();
    assert_eq!(res_msg_1.status(), StatusCode::ACCEPTED);
    let body_msg_1: Value = serde_json::from_slice(
        &axum::body::to_bytes(res_msg_1.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    let message_id_1 = body_msg_1["message_id"].as_str().unwrap().to_string();

    // Verify message 1 recorded bot_key_leaf_index = 1
    let msg_row_1 = sqlx::query("SELECT bot_key_leaf_index FROM room_messages WHERE id = ?")
        .bind(&message_id_1)
        .fetch_one(&pool)
        .await
        .unwrap();
    let msg_leaf_idx_1: i64 = msg_row_1.get("bot_key_leaf_index");
    assert_eq!(msg_leaf_idx_1, 1);

    // Set a bot setting before rotation
    let req_setting = Request::builder()
        .method("PATCH")
        .uri(format!(
            "/api/v1/users/me/bots/{}/settings/config_key",
            bot_id
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "is_secret": false,
                "value_encrypted_bot": URL_SAFE_NO_PAD.encode([11u8; 60]),
                "value_encrypted_client": URL_SAFE_NO_PAD.encode([12u8; 32])
            })
            .to_string(),
        ))
        .unwrap();
    let res_setting = app.clone().oneshot(req_setting).await.unwrap();
    assert_eq!(res_setting.status(), StatusCode::OK);

    // --- ROTATE KEYS ---
    let (new_kp, new_bot_id_pk) = make_keypair(10);
    let new_bot_cmd_pk = valid_pubkey(11);
    let new_id_pk = valid_pubkey(12);

    let req_rotate = Request::builder()
        .method("PATCH")
        .uri(format!("/api/v1/bots/{}/keys", bot_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "bot_identity_pubkey": new_bot_id_pk,
                "bot_command_pubkey": new_bot_cmd_pk,
                "identity_pubkey": new_id_pk
            })
            .to_string(),
        ))
        .unwrap();
    let res_rotate = app.clone().oneshot(req_rotate).await.unwrap();
    assert_eq!(res_rotate.status(), StatusCode::OK);

    // Attempt to post message signed with OLD key post-rotation -> 400 signature_invalid
    let raw_ct_2 = b"post-rotation message old sig";
    let ct_2 = URL_SAFE_NO_PAD.encode(raw_ct_2);
    let sig_old = sign_payload(&old_kp, raw_ct_2);

    let req_msg_old_sig = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/bot-messages", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", bot_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "ciphertext": ct_2,
                "content_type": "bot",
                "signature": sig_old,
                "epoch": epoch
            })
            .to_string(),
        ))
        .unwrap();

    let res_msg_old_sig = app.clone().oneshot(req_msg_old_sig).await.unwrap();
    assert_eq!(res_msg_old_sig.status(), StatusCode::BAD_REQUEST);

    // Post message signed with NEW key post-rotation -> 202 ACCEPTED
    let sig_new = sign_payload(&new_kp, raw_ct_2);

    let req_msg_new_sig = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/bot-messages", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", bot_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "ciphertext": ct_2,
                "content_type": "bot",
                "signature": sig_new,
                "epoch": epoch
            })
            .to_string(),
        ))
        .unwrap();

    let res_msg_new_sig = app.clone().oneshot(req_msg_new_sig).await.unwrap();
    assert_eq!(res_msg_new_sig.status(), StatusCode::ACCEPTED);
    let body_msg_2: Value = serde_json::from_slice(
        &axum::body::to_bytes(res_msg_new_sig.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    let message_id_2 = body_msg_2["message_id"].as_str().unwrap().to_string();

    // Verify message 2 recorded new bot_key_leaf_index = 2
    let msg_row_2 = sqlx::query("SELECT bot_key_leaf_index FROM room_messages WHERE id = ?")
        .bind(&message_id_2)
        .fetch_one(&pool)
        .await
        .unwrap();
    let msg_leaf_idx_2: i64 = msg_row_2.get("bot_key_leaf_index");
    assert_eq!(msg_leaf_idx_2, 2);

    // Verify historical message 1 STILL has bot_key_leaf_index = 1
    let msg_row_1_again = sqlx::query("SELECT bot_key_leaf_index FROM room_messages WHERE id = ?")
        .bind(&message_id_1)
        .fetch_one(&pool)
        .await
        .unwrap();
    let msg_leaf_idx_1_again: i64 = msg_row_1_again.get("bot_key_leaf_index");
    assert_eq!(msg_leaf_idx_1_again, 1);

    // Verify GET /rooms/:id/messages returns respective bot_key_leaf_index values
    let req_fetch_msgs = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/rooms/{}/messages", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .body(Body::empty())
        .unwrap();

    let res_fetch_msgs = app.clone().oneshot(req_fetch_msgs).await.unwrap();
    assert_eq!(res_fetch_msgs.status(), StatusCode::OK);
    let body_fetch_msgs: Value = serde_json::from_slice(
        &axum::body::to_bytes(res_fetch_msgs.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();

    let messages = body_fetch_msgs["messages"].as_array().unwrap();
    let msg_1_item = messages
        .iter()
        .find(|m| m["id"] == message_id_1)
        .expect("msg_1 found");
    let msg_2_item = messages
        .iter()
        .find(|m| m["id"] == message_id_2)
        .expect("msg_2 found");

    assert_eq!(msg_1_item["bot_key_leaf_index"], 1);
    assert_eq!(msg_2_item["bot_key_leaf_index"], 2);

    // Verify bot settings row is unchanged post-rotation
    let setting_row = sqlx::query(
        "SELECT value_encrypted_bot, value_encrypted_client FROM bot_settings WHERE bot_id = ? AND key = 'config_key'",
    )
    .bind(&bot_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    let ct_bot: String = setting_row.get("value_encrypted_bot");
    let ct_client: String = setting_row.get("value_encrypted_client");
    assert_eq!(ct_bot, URL_SAFE_NO_PAD.encode([11u8; 60]));
    assert_eq!(ct_client, URL_SAFE_NO_PAD.encode([12u8; 32]));

    // KT Endpoints check
    // 1. GET /kt/bot/:id — Latest leaf (leaf_index = 2, new keys)
    let req_kt_bot = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/kt/bot/{}", bot_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .body(Body::empty())
        .unwrap();

    let res_kt_bot = app.clone().oneshot(req_kt_bot).await.unwrap();
    assert_eq!(res_kt_bot.status(), StatusCode::OK);
    let body_kt_bot: Value = serde_json::from_slice(
        &axum::body::to_bytes(res_kt_bot.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(body_kt_bot["leaf_index"], 2);
    assert_eq!(body_kt_bot["bot_identity_pubkey"], new_bot_id_pk);
    assert_eq!(body_kt_bot["bot_command_pubkey"], new_bot_cmd_pk);
    assert_eq!(body_kt_bot["identity_pubkey"], new_id_pk);

    // 2. GET /kt/bot/:id/history — Both leaves (leaf_index 1 and 2)
    let req_kt_history = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/kt/bot/{}/history", bot_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .body(Body::empty())
        .unwrap();

    let res_kt_history = app.clone().oneshot(req_kt_history).await.unwrap();
    assert_eq!(res_kt_history.status(), StatusCode::OK);
    let body_kt_history: Value = serde_json::from_slice(
        &axum::body::to_bytes(res_kt_history.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();

    let entries = body_kt_history["entries"].as_array().unwrap();
    assert_eq!(entries.len(), 2);
    assert_eq!(entries[0]["leaf_index"], 1);
    assert_eq!(entries[0]["bot_identity_pubkey"], old_bot_id_pk);
    assert_eq!(entries[0]["bot_command_pubkey"], old_bot_cmd_pk);
    assert_eq!(entries[0]["identity_pubkey"], old_id_pk);

    assert_eq!(entries[1]["leaf_index"], 2);
    assert_eq!(entries[1]["bot_identity_pubkey"], new_bot_id_pk);
    assert_eq!(entries[1]["bot_command_pubkey"], new_bot_cmd_pk);
    assert_eq!(entries[1]["identity_pubkey"], new_id_pk);

    // Verify POST /bots/me/messages (local message for owner) still works post-rotation
    let req_local_msg = Request::builder()
        .method("POST")
        .uri("/api/v1/bots/me/messages")
        .header(header::AUTHORIZATION, format!("Bearer {}", bot_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "target": "owner",
                "result_type": "toast",
                "ciphertext": URL_SAFE_NO_PAD.encode(b"post rotation toast"),
                "bot_result_pubkey": valid_pubkey(99)
            })
            .to_string(),
        ))
        .unwrap();

    let res_local_msg = app.clone().oneshot(req_local_msg).await.unwrap();
    assert_eq!(res_local_msg.status(), StatusCode::NO_CONTENT);

    // Verify existing bot tokens remain valid post-rotation
    let req_get_token = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/bots/{}", bot_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", bot_token))
        .body(Body::empty())
        .unwrap();

    let res_get_token = app.clone().oneshot(req_get_token).await.unwrap();
    assert_eq!(res_get_token.status(), StatusCode::OK);
}
