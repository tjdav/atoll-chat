use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use ed25519_dalek::{Signer, SigningKey};
use serde_json::Value;
use tower::ServiceExt;

mod common;

fn test_signing_key() -> SigningKey {
    SigningKey::from_bytes(&[7u8; 32])
}

fn valid_pubkey() -> String {
    let sk = test_signing_key();
    URL_SAFE_NO_PAD.encode(sk.verifying_key().as_bytes())
}

fn make_bot_sig(room_id: &str, epoch: u64, content_type: &str, ciphertext: &[u8]) -> String {
    let input =
        server::signing::encode_bot_message_signing_input(room_id, epoch, content_type, ciphertext);
    let sk = test_signing_key();
    let sig = sk.sign(&input);
    URL_SAFE_NO_PAD.encode(sig.to_bytes())
}

#[tokio::test]
async fn test_current_bot_leaf_index_helper() {
    let (_app, pool) = common::setup_test_app().await;

    // 1. Bot with no leaf returns None
    let res = server::key_transparency::current_bot_leaf_index(&pool, "b_missing")
        .await
        .unwrap();
    assert_eq!(res, None);

    // 2. Insert bot account and two leaves directly for b_multi
    sqlx::query(
        "INSERT INTO users (id, username_token, opaque_registration, identity_pubkey) VALUES ('u_owner', 'tok_owner', X'1234', 'pk_owner')"
    )
    .execute(&pool)
    .await
    .unwrap();

    sqlx::query(
        "INSERT INTO bot_accounts (id, display_name, owner_user_id, bot_identity_pubkey, bot_command_pubkey, identity_pubkey) VALUES ('b_multi', 'Multi Bot', 'u_owner', 'pk1', 'pk2', 'pk3')"
    )
    .execute(&pool)
    .await
    .unwrap();

    let hash1 = server::key_transparency::merkle::bot_leaf_hash("pk1", "cmd1", "mls1");
    sqlx::query(
        "INSERT INTO key_transparency_log (leaf_index, bot_id, bot_identity_pubkey, command_pubkey, identity_pubkey, leaf_hash) VALUES (10, 'b_multi', 'pk1', 'cmd1', 'mls1', ?)",
    )
    .bind(&hash1[..])
    .execute(&pool)
    .await
    .unwrap();

    let res1 = server::key_transparency::current_bot_leaf_index(&pool, "b_multi")
        .await
        .unwrap();
    assert_eq!(res1, Some(10));

    let hash2 = server::key_transparency::merkle::bot_leaf_hash("pk2", "cmd2", "mls2");
    sqlx::query(
        "INSERT INTO key_transparency_log (leaf_index, bot_id, bot_identity_pubkey, command_pubkey, identity_pubkey, leaf_hash) VALUES (25, 'b_multi', 'pk2', 'cmd2', 'mls2', ?)",
    )
    .bind(&hash2[..])
    .execute(&pool)
    .await
    .unwrap();

    let res2 = server::key_transparency::current_bot_leaf_index(&pool, "b_multi")
        .await
        .unwrap();
    assert_eq!(
        res2,
        Some(25),
        "current_bot_leaf_index MUST return the highest leaf index"
    );
}

#[tokio::test]
async fn test_bot_message_populates_bot_key_leaf_index_and_events() {
    let (app, pool) = common::setup_test_app().await;

    // 1. Register user & create room
    let (user_token, user_id) = common::create_test_user_and_session(&app, &pool).await;

    sqlx::query(
        "INSERT INTO devices (id, user_id, client_id, platform) VALUES ('d_leaf_1', ?, 'client_1', 'web')",
    )
    .bind(&user_id)
    .execute(&pool)
    .await
    .unwrap();

    let req_create_room = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms")
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from("{}"))
        .unwrap();
    let resp_room = app.clone().oneshot(req_create_room).await.unwrap();
    let room_body: Value = serde_json::from_slice(
        &axum::body::to_bytes(resp_room.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    let room_id = room_body["id"].as_str().unwrap().to_string();

    // 2. Create bot (POST /bots automatically appends a KT leaf)
    let req_create_bot = Request::builder()
        .method("POST")
        .uri("/api/v1/bots")
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            serde_json::to_string(&serde_json::json!({
                "display_name": "Leaf Test Bot",
                "bot_identity_pubkey": valid_pubkey(),
                "bot_command_pubkey": valid_pubkey(),
                "identity_pubkey": valid_pubkey(),
                "declared_scopes": ["post_message"]
            }))
            .unwrap(),
        ))
        .unwrap();

    let resp_bot = app.clone().oneshot(req_create_bot).await.unwrap();
    assert_eq!(resp_bot.status(), StatusCode::CREATED);
    let bot_body: Value = serde_json::from_slice(
        &axum::body::to_bytes(resp_bot.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    let bot_id = bot_body["bot_id"].as_str().unwrap().to_string();
    let bot_token = bot_body["bot_token"].as_str().unwrap().to_string();

    // Grant bot to room
    let req_grant = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/bots", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            serde_json::to_string(&serde_json::json!({
                "bot_id": bot_id,
                "scopes": ["post_message"]
            }))
            .unwrap(),
        ))
        .unwrap();
    let resp_grant = app.clone().oneshot(req_grant).await.unwrap();
    assert_eq!(resp_grant.status(), StatusCode::CREATED);

    // Verify bot leaf was created
    let expected_leaf_index = server::key_transparency::current_bot_leaf_index(&pool, &bot_id)
        .await
        .unwrap()
        .expect("bot MUST have a KT leaf after POST /bots");

    // 3. User submits a message first
    let req_user_msg = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/messages", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            serde_json::to_string(&serde_json::json!({
                "sender_client_id": "client_1",
                "epoch": 0,
                "content_type": "application",
                "ciphertext": URL_SAFE_NO_PAD.encode(b"user message")
            }))
            .unwrap(),
        ))
        .unwrap();
    let resp_user_msg = app.clone().oneshot(req_user_msg).await.unwrap();
    assert_eq!(resp_user_msg.status(), StatusCode::CREATED);

    // 4. Bot posts a message
    let ct_bytes = b"bot message ciphertext";
    let sig = make_bot_sig(&room_id, 0, "bot", ct_bytes);

    let req_bot_msg = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/bot-messages", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", bot_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            serde_json::to_string(&serde_json::json!({
                "epoch": 0,
                "content_type": "bot",
                "ciphertext": URL_SAFE_NO_PAD.encode(ct_bytes),
                "signature": sig
            }))
            .unwrap(),
        ))
        .unwrap();

    let resp_bot_msg = app.clone().oneshot(req_bot_msg).await.unwrap();
    assert_eq!(resp_bot_msg.status(), StatusCode::ACCEPTED);
    let bot_msg_body: Value = serde_json::from_slice(
        &axum::body::to_bytes(resp_bot_msg.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    let bot_msg_id = bot_msg_body["message_id"].as_str().unwrap();

    // 5. Query DB directly to verify room_messages row
    let (db_sender_bot_id, db_sender_user_id, db_leaf_index): (
        Option<String>,
        Option<String>,
        Option<i64>,
    ) = sqlx::query_as(
        "SELECT sender_bot_id, sender_user_id, bot_key_leaf_index FROM room_messages WHERE id = ?",
    )
    .bind(bot_msg_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(db_sender_bot_id.as_deref(), Some(bot_id.as_str()));
    assert!(
        db_sender_user_id.is_none(),
        "sender_user_id MUST be NULL for bot messages"
    );
    assert_eq!(db_leaf_index, Some(expected_leaf_index));

    // 6. Fetch messages via GET /rooms/:id/messages
    let req_fetch = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/rooms/{}/messages", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .body(Body::empty())
        .unwrap();

    let resp_fetch = app.clone().oneshot(req_fetch).await.unwrap();
    assert_eq!(resp_fetch.status(), StatusCode::OK);
    let fetch_body: Value = serde_json::from_slice(
        &axum::body::to_bytes(resp_fetch.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();

    let msgs = fetch_body["messages"].as_array().unwrap();

    let user_msg_view = msgs.iter().find(|m| m["sender_type"] == "user").unwrap();
    assert_eq!(user_msg_view["sender_id"], user_id);
    assert!(
        user_msg_view["bot_key_leaf_index"].is_null(),
        "user message bot_key_leaf_index MUST be null"
    );

    let bot_msg_view = msgs.iter().find(|m| m["sender_type"] == "bot").unwrap();
    assert_eq!(bot_msg_view["sender_id"], bot_id);
    assert_eq!(bot_msg_view["bot_key_leaf_index"], expected_leaf_index);
}

#[tokio::test]
async fn test_bot_message_without_kt_leaf_handles_anomalous_case() {
    let (app, pool) = common::setup_test_app().await;

    let (user_token, _user_id) = common::create_test_user_and_session(&app, &pool).await;

    let req_create_room = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms")
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from("{}"))
        .unwrap();
    let resp_room = app.clone().oneshot(req_create_room).await.unwrap();
    let room_body: Value = serde_json::from_slice(
        &axum::body::to_bytes(resp_room.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    let room_id = room_body["id"].as_str().unwrap().to_string();

    let req_create_bot = Request::builder()
        .method("POST")
        .uri("/api/v1/bots")
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            serde_json::to_string(&serde_json::json!({
                "display_name": "No-Leaf Bot",
                "bot_identity_pubkey": valid_pubkey(),
                "bot_command_pubkey": valid_pubkey(),
                "identity_pubkey": valid_pubkey(),
                "declared_scopes": ["post_message"]
            }))
            .unwrap(),
        ))
        .unwrap();

    let resp_bot = app.clone().oneshot(req_create_bot).await.unwrap();
    let bot_body: Value = serde_json::from_slice(
        &axum::body::to_bytes(resp_bot.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    let bot_id = bot_body["bot_id"].as_str().unwrap().to_string();
    let bot_token = bot_body["bot_token"].as_str().unwrap().to_string();

    // Grant bot
    let req_grant = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/bots", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            serde_json::to_string(&serde_json::json!({
                "bot_id": bot_id,
                "scopes": ["post_message"]
            }))
            .unwrap(),
        ))
        .unwrap();
    let _ = app.clone().oneshot(req_grant).await.unwrap();

    // Force missing KT leaf by deleting all leaves for this bot
    sqlx::query("DELETE FROM key_transparency_log WHERE bot_id = ?")
        .bind(&bot_id)
        .execute(&pool)
        .await
        .unwrap();

    let ct_bytes = b"no leaf bot msg";
    let sig = make_bot_sig(&room_id, 0, "bot", ct_bytes);

    let req_bot_msg = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/bot-messages", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", bot_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            serde_json::to_string(&serde_json::json!({
                "epoch": 0,
                "content_type": "bot",
                "ciphertext": URL_SAFE_NO_PAD.encode(ct_bytes),
                "signature": sig
            }))
            .unwrap(),
        ))
        .unwrap();

    let resp_bot_msg = app.clone().oneshot(req_bot_msg).await.unwrap();
    assert_eq!(resp_bot_msg.status(), StatusCode::ACCEPTED);
    let bot_msg_body: Value = serde_json::from_slice(
        &axum::body::to_bytes(resp_bot_msg.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    let bot_msg_id = bot_msg_body["message_id"].as_str().unwrap();

    let db_leaf_index: Option<i64> =
        sqlx::query_scalar("SELECT bot_key_leaf_index FROM room_messages WHERE id = ?")
            .bind(bot_msg_id)
            .fetch_one(&pool)
            .await
            .unwrap();

    assert!(
        db_leaf_index.is_none(),
        "Anomalous bot message without KT leaf MUST have NULL bot_key_leaf_index"
    );
}
