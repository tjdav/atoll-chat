use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use ed25519_dalek::{Signer, SigningKey};
use rand::RngCore;
use serde_json::{json, Value};
use tower::ServiceExt;

mod common;

fn generate_test_signing_key() -> SigningKey {
    let mut seed = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut seed);
    SigningKey::from_bytes(&seed)
}

async fn create_test_room(app: &axum::Router, user_token: &str) -> String {
    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms")
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({ "name": "Publisher Key Room" }).to_string(),
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

async fn set_user_identity_pubkey(
    pool: &sqlx::SqlitePool,
    user_id: &str,
    signing_key: &SigningKey,
) {
    let verifying_key = signing_key.verifying_key();
    let pubkey_b64 = URL_SAFE_NO_PAD.encode(verifying_key.as_bytes());
    sqlx::query("UPDATE users SET identity_pubkey = ? WHERE id = ?")
        .bind(&pubkey_b64)
        .bind(user_id)
        .execute(pool)
        .await
        .unwrap();
}

async fn create_test_bot(app: &axum::Router, user_token: &str) -> (String, String) {
    let dummy_pubkey = URL_SAFE_NO_PAD.encode([7u8; 32]);
    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/bots")
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "display_name": "Test Bot",
                "bot_identity_pubkey": dummy_pubkey,
                "bot_command_pubkey": dummy_pubkey,
                "identity_pubkey": dummy_pubkey,
                "declared_scopes": ["post_message", "read_metadata"]
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

    (
        body["bot_id"].as_str().unwrap().to_string(),
        body["bot_token"].as_str().unwrap().to_string(),
    )
}

#[tokio::test]
async fn test_room_publisher_keys_schema_and_pk_constraint() {
    let (app, pool) = common::setup_test_app().await;
    let (user_token, user_id) = common::create_test_user_and_session(&app, &pool).await;
    let room_id = create_test_room(&app, &user_token).await;

    // Direct DB insertion matching §7.4 schema
    sqlx::query(
        r#"
        INSERT INTO room_publisher_keys (room_id, epoch, publisher_public_key, signer_user_id, signature)
        VALUES (?, 0, X'1111', ?, X'2222')
        "#,
    )
    .bind(&room_id)
    .bind(&user_id)
    .execute(&pool)
    .await
    .unwrap();

    // Duplicate room_id primary key insertion fails
    let res = sqlx::query(
        r#"
        INSERT INTO room_publisher_keys (room_id, epoch, publisher_public_key, signer_user_id, signature)
        VALUES (?, 1, X'3333', ?, X'4444')
        "#,
    )
    .bind(&room_id)
    .bind(&user_id)
    .execute(&pool)
    .await;

    assert!(res.is_err());
}

#[tokio::test]
async fn test_get_publisher_key_flows() {
    let (app, pool) = common::setup_test_app().await;
    let (member_token, member_id) = common::create_test_user_and_session(&app, &pool).await;
    let (non_member_token, _) = common::create_test_user_and_session(&app, &pool).await;

    let room_id = create_test_room(&app, &member_token).await;

    // 1. GET before any key published -> 404 publisher_key_unavailable
    let req_get_empty = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/rooms/{}/publisher-key", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", member_token))
        .body(Body::empty())
        .unwrap();

    let res_get_empty = app.clone().oneshot(req_get_empty).await.unwrap();
    assert_eq!(res_get_empty.status(), StatusCode::NOT_FOUND);

    // Seed publisher key for epoch 0
    let key_bytes = [0x55u8; 32];
    let sig_bytes = [0x66u8; 64];
    sqlx::query(
        r#"
        INSERT INTO room_publisher_keys (room_id, epoch, publisher_public_key, signer_user_id, signature)
        VALUES (?, 0, ?, ?, ?)
        "#,
    )
    .bind(&room_id)
    .bind(&key_bytes[..])
    .bind(&member_id)
    .bind(&sig_bytes[..])
    .execute(&pool)
    .await
    .unwrap();

    // 2. GET without ?epoch -> returns key for current epoch (epoch 0)
    let req_get_current = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/rooms/{}/publisher-key", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", member_token))
        .body(Body::empty())
        .unwrap();

    let res_get_current = app.clone().oneshot(req_get_current).await.unwrap();
    assert_eq!(res_get_current.status(), StatusCode::OK);
    assert_eq!(
        res_get_current.headers().get("cache-control").unwrap(),
        "no-store"
    );

    let body_current: Value = serde_json::from_slice(
        &axum::body::to_bytes(res_get_current.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();

    assert_eq!(body_current["room_id"], room_id);
    assert_eq!(body_current["epoch"], 0);
    assert_eq!(
        body_current["publisher_public_key"],
        URL_SAFE_NO_PAD.encode(key_bytes)
    );
    assert_eq!(body_current["signer_user_id"], member_id);
    assert_eq!(body_current["signature"], URL_SAFE_NO_PAD.encode(sig_bytes));

    // 3. GET with ?epoch=0 -> returns key
    let req_get_epoch0 = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/rooms/{}/publisher-key?epoch=0", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", member_token))
        .body(Body::empty())
        .unwrap();

    let res_get_epoch0 = app.clone().oneshot(req_get_epoch0).await.unwrap();
    assert_eq!(res_get_epoch0.status(), StatusCode::OK);

    // 4. GET with ?epoch=99 (non-existent epoch) -> 404 publisher_key_unavailable
    let req_get_epoch99 = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/rooms/{}/publisher-key?epoch=99", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", member_token))
        .body(Body::empty())
        .unwrap();

    let res_get_epoch99 = app.clone().oneshot(req_get_epoch99).await.unwrap();
    assert_eq!(res_get_epoch99.status(), StatusCode::NOT_FOUND);

    // 5. Non-member GET -> 404 room_not_found
    let req_get_non_member = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/rooms/{}/publisher-key", room_id))
        .header(
            header::AUTHORIZATION,
            format!("Bearer {}", non_member_token),
        )
        .body(Body::empty())
        .unwrap();

    let res_get_non_member = app.clone().oneshot(req_get_non_member).await.unwrap();
    assert_eq!(res_get_non_member.status(), StatusCode::NOT_FOUND);

    // 6. Unauthenticated GET -> 401
    let req_get_unauth = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/rooms/{}/publisher-key", room_id))
        .body(Body::empty())
        .unwrap();

    let res_get_unauth = app.clone().oneshot(req_get_unauth).await.unwrap();
    assert_eq!(res_get_unauth.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn test_post_publisher_key_validations_and_events() {
    let (app, pool) = common::setup_test_app().await;
    let (member_token, member_id) = common::create_test_user_and_session(&app, &pool).await;
    let (non_member_token, _) = common::create_test_user_and_session(&app, &pool).await;

    let room_id = create_test_room(&app, &member_token).await;

    // Generate member Ed25519 signing key and set users.identity_pubkey
    let member_signing_key = generate_test_signing_key();
    set_user_identity_pubkey(&pool, &member_id, &member_signing_key).await;

    // Construct valid publisher public key and Ed25519 signature over §8.10 input
    let pubkey_bytes = [0x11u8; 32];
    let pubkey_b64 = URL_SAFE_NO_PAD.encode(pubkey_bytes);

    let epoch = 0u64;
    let signing_input =
        server::signing::encode_publisher_key_signing_input(&room_id, epoch, &pubkey_bytes);
    let signature = member_signing_key.sign(&signing_input);
    let signature_b64 = URL_SAFE_NO_PAD.encode(signature.to_bytes());

    // 1. Non-member POST -> 403 not_a_member
    let req_non_member = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/publisher-key", room_id))
        .header(
            header::AUTHORIZATION,
            format!("Bearer {}", non_member_token),
        )
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "epoch": epoch,
                "publisher_public_key": pubkey_b64,
                "signature": signature_b64
            })
            .to_string(),
        ))
        .unwrap();

    let res_non_member = app.clone().oneshot(req_non_member).await.unwrap();
    assert_eq!(res_non_member.status(), StatusCode::FORBIDDEN);

    // 2. Bot token POST -> 403 forbidden
    let (bot_id, bot_token) = create_test_bot(&app, &member_token).await;
    // Grant bot to room
    sqlx::query(
        "INSERT INTO room_bots (room_id, bot_id, mode, granted_by) VALUES (?, ?, 'observer', ?)",
    )
    .bind(&room_id)
    .bind(&bot_id)
    .bind(&member_id)
    .execute(&pool)
    .await
    .unwrap();

    let req_bot = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/publisher-key", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", bot_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "epoch": epoch,
                "publisher_public_key": pubkey_b64,
                "signature": signature_b64
            })
            .to_string(),
        ))
        .unwrap();

    let res_bot = app.clone().oneshot(req_bot).await.unwrap();
    assert_eq!(res_bot.status(), StatusCode::FORBIDDEN);

    // 3. Invalid key size (!= 32 bytes) -> 400 invalid_publisher_public_key
    let req_bad_key = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/publisher-key", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", member_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "epoch": epoch,
                "publisher_public_key": URL_SAFE_NO_PAD.encode([0u8; 16]), // 16 bytes
                "signature": signature_b64
            })
            .to_string(),
        ))
        .unwrap();

    let res_bad_key = app.clone().oneshot(req_bad_key).await.unwrap();
    assert_eq!(res_bad_key.status(), StatusCode::BAD_REQUEST);

    // 4. Invalid signature size (!= 64 bytes) -> 400 invalid_signature
    let req_bad_sig_len = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/publisher-key", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", member_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "epoch": epoch,
                "publisher_public_key": pubkey_b64,
                "signature": URL_SAFE_NO_PAD.encode([0u8; 32]) // 32 bytes
            })
            .to_string(),
        ))
        .unwrap();

    let res_bad_sig_len = app.clone().oneshot(req_bad_sig_len).await.unwrap();
    assert_eq!(res_bad_sig_len.status(), StatusCode::BAD_REQUEST);

    // 5. Invalid signature (signed with different key) -> 400 signature_invalid
    let wrong_key = generate_test_signing_key();
    let wrong_sig = wrong_key.sign(&signing_input);
    let req_bad_sig = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/publisher-key", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", member_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "epoch": epoch,
                "publisher_public_key": pubkey_b64,
                "signature": URL_SAFE_NO_PAD.encode(wrong_sig.to_bytes())
            })
            .to_string(),
        ))
        .unwrap();

    let res_bad_sig = app.clone().oneshot(req_bad_sig).await.unwrap();
    assert_eq!(res_bad_sig.status(), StatusCode::BAD_REQUEST);

    // Record initial user_seq for member to verify no user_seq allocation
    let initial_user_seq: Option<i64> =
        sqlx::query_scalar("SELECT next_seq FROM user_seq WHERE user_id = ?")
            .bind(&member_id)
            .fetch_optional(&pool)
            .await
            .unwrap();

    // 6. Valid POST -> 200 OK
    let req_valid = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/publisher-key", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", member_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "epoch": epoch,
                "publisher_public_key": pubkey_b64,
                "signature": signature_b64
            })
            .to_string(),
        ))
        .unwrap();

    let res_valid = app.clone().oneshot(req_valid).await.unwrap();
    assert_eq!(res_valid.status(), StatusCode::OK);
    assert_eq!(
        res_valid.headers().get("cache-control").unwrap(),
        "no-store"
    );

    let body_valid: Value = serde_json::from_slice(
        &axum::body::to_bytes(res_valid.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();

    assert_eq!(body_valid["room_id"], room_id);
    assert_eq!(body_valid["epoch"], 0);
    assert_eq!(body_valid["publisher_public_key"], pubkey_b64);
    assert_eq!(body_valid["signer_user_id"], member_id);
    assert_eq!(body_valid["signature"], signature_b64);

    // Verify user_seq is unchanged
    let post_user_seq: Option<i64> =
        sqlx::query_scalar("SELECT next_seq FROM user_seq WHERE user_id = ?")
            .bind(&member_id)
            .fetch_optional(&pool)
            .await
            .unwrap();
    assert_eq!(initial_user_seq, post_user_seq);

    // 7. Duplicate epoch POST -> 409 epoch_already_published
    let req_dup = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/publisher-key", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", member_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "epoch": epoch,
                "publisher_public_key": pubkey_b64,
                "signature": signature_b64
            })
            .to_string(),
        ))
        .unwrap();

    let res_dup = app.clone().oneshot(req_dup).await.unwrap();
    assert_eq!(res_dup.status(), StatusCode::CONFLICT);

    // 8. New epoch POST (epoch 1) -> replaces stored row
    let epoch1 = 1u64;
    let pubkey1_bytes = [0x22u8; 32];
    let pubkey1_b64 = URL_SAFE_NO_PAD.encode(pubkey1_bytes);
    let signing_input1 =
        server::signing::encode_publisher_key_signing_input(&room_id, epoch1, &pubkey1_bytes);
    let sig1 = member_signing_key.sign(&signing_input1);
    let sig1_b64 = URL_SAFE_NO_PAD.encode(sig1.to_bytes());

    let req_epoch1 = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/publisher-key", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", member_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "epoch": epoch1,
                "publisher_public_key": pubkey1_b64,
                "signature": sig1_b64
            })
            .to_string(),
        ))
        .unwrap();

    let res_epoch1 = app.clone().oneshot(req_epoch1).await.unwrap();
    assert_eq!(res_epoch1.status(), StatusCode::OK);

    // Update room_epochs to epoch 1 so GET without epoch returns the new key
    sqlx::query("UPDATE room_epochs SET epoch = 1 WHERE room_id = ?")
        .bind(&room_id)
        .execute(&pool)
        .await
        .unwrap();

    let req_get_epoch1 = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/rooms/{}/publisher-key", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", member_token))
        .body(Body::empty())
        .unwrap();

    let res_get_epoch1 = app.clone().oneshot(req_get_epoch1).await.unwrap();
    assert_eq!(res_get_epoch1.status(), StatusCode::OK);
    let body_epoch1: Value = serde_json::from_slice(
        &axum::body::to_bytes(res_get_epoch1.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(body_epoch1["epoch"], 1);
    assert_eq!(body_epoch1["publisher_public_key"], pubkey1_b64);
}

#[tokio::test]
async fn test_security_boundary_no_mls_verification() {
    let (app, pool) = common::setup_test_app().await;
    let (member_token, member_id) = common::create_test_user_and_session(&app, &pool).await;

    let room_id = create_test_room(&app, &member_token).await;

    let member_signing_key = generate_test_signing_key();
    set_user_identity_pubkey(&pool, &member_id, &member_signing_key).await;

    // Send an arbitrary/random 32-byte publisher key value with a valid signature.
    // The server must accept it without verifying against MLS state per §12.
    let arbitrary_key_bytes = [0x99u8; 32];
    let arbitrary_key_b64 = URL_SAFE_NO_PAD.encode(arbitrary_key_bytes);

    let epoch = 0u64;
    let signing_input =
        server::signing::encode_publisher_key_signing_input(&room_id, epoch, &arbitrary_key_bytes);
    let sig = member_signing_key.sign(&signing_input);
    let sig_b64 = URL_SAFE_NO_PAD.encode(sig.to_bytes());

    let req = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/publisher-key", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", member_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "epoch": epoch,
                "publisher_public_key": arbitrary_key_b64,
                "signature": sig_b64
            })
            .to_string(),
        ))
        .unwrap();

    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
}

#[tokio::test]
async fn test_bot_model_and_member_list_regressions() {
    let (app, pool) = common::setup_test_app().await;
    let (owner_token, _) = common::create_test_user_and_session(&app, &pool).await;

    let room_id = create_test_room(&app, &owner_token).await;
    let (bot_id, _) = create_test_bot(&app, &owner_token).await;

    // Grant bot to room
    let req_grant = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/bots", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", owner_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "bot_id": bot_id,
                "scopes": ["post_message"]
            })
            .to_string(),
        ))
        .unwrap();

    let res_grant = app.clone().oneshot(req_grant).await.unwrap();
    assert_eq!(res_grant.status(), StatusCode::CREATED);

    // Verify GET /rooms/:id/members merges bot entry (Phase 11)
    let req_members = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/rooms/{}/members", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", owner_token))
        .body(Body::empty())
        .unwrap();

    let res_members = app.clone().oneshot(req_members).await.unwrap();
    assert_eq!(res_members.status(), StatusCode::OK);

    let body_members: Value = serde_json::from_slice(
        &axum::body::to_bytes(res_members.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();

    let members = body_members["members"].as_array().unwrap();
    assert_eq!(members.len(), 2); // 1 user + 1 bot
    let user_member = members.iter().find(|m| m["type"] == "user").unwrap();
    let bot_member = members.iter().find(|m| m["type"] == "bot").unwrap();

    assert_eq!(bot_member["bot_id"], bot_id);
    assert_eq!(user_member["type"], "user");
}
