use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use axum::Router;
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use serde_json::{json, Value};
use sqlx::SqlitePool;
use tower::ServiceExt;

mod common;
use common::{login_user, register_user, setup_test_app};

async fn create_test_user_with_device(
    app: &Router,
    pool: &SqlitePool,
    prefix: &str,
) -> (String, String, String) {
    let username = format!("{}_user", prefix);
    let password = "Password123!";
    let client_id = format!("{}_client_12345678", prefix);

    let has_users: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM users)")
        .fetch_one(pool)
        .await
        .unwrap();

    let invite_code = if has_users {
        let code = format!("INV_{}", prefix);
        sqlx::query(
            "INSERT INTO server_invites (id, code, max_uses, current_uses) VALUES (?, ?, 10, 0)",
        )
        .bind(format!("inv_id_{}", prefix))
        .bind(&code)
        .execute(pool)
        .await
        .unwrap();
        Some(code)
    } else {
        None
    };

    let user_id = register_user(app, &username, password, invite_code.as_deref()).await;
    let (status, login_res) = login_user(app, &username, password, &client_id, None).await;

    if status != StatusCode::OK {
        panic!(
            "login_user failed for {}: status={}, res={:?}",
            username, status, login_res
        );
    }

    let token = login_res["session_token"].as_str().unwrap().to_string();

    (user_id, token, client_id)
}

async fn do_get(app: &Router, uri: &str, token: &str) -> (StatusCode, Value) {
    let req = Request::builder()
        .method("GET")
        .uri(uri)
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::empty())
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    let status = resp.status();
    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body_bytes).unwrap_or(json!({}));
    (status, json)
}

async fn do_post(app: &Router, uri: &str, token: &str, body: &Value) -> (StatusCode, Value) {
    let req = Request::builder()
        .method("POST")
        .uri(uri)
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(body.to_string()))
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    let status = resp.status();
    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body_bytes).unwrap_or(json!({}));
    (status, json)
}

async fn create_room(app: &Router, token: &str) -> String {
    let (status, body) = do_post(app, "/api/v1/rooms", token, &json!({})).await;
    assert_eq!(status, StatusCode::CREATED);
    body["id"].as_str().unwrap().to_string()
}

#[tokio::test]
async fn test_01_fresh_room_starts_at_epoch_0_seq_0() {
    let (app, pool) = setup_test_app().await;
    let (_user_a, token_a, _) = create_test_user_with_device(&app, &pool, "user_a").await;

    let room_id = create_room(&app, &token_a).await;

    let (status, body) = do_get(&app, &format!("/api/v1/rooms/{room_id}/epoch"), &token_a).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["epoch"], 0);
    assert_eq!(body["sequence"], 0);
}

#[tokio::test]
async fn test_02_application_message_increments_sequence() {
    let (app, pool) = setup_test_app().await;
    let (_user_a, token_a, client_id_a) = create_test_user_with_device(&app, &pool, "user_a").await;

    let room_id = create_room(&app, &token_a).await;

    let ct_b64 = BASE64.encode(b"hello world");

    let (status, body) = do_post(
        &app,
        &format!("/api/v1/rooms/{room_id}/messages"),
        &token_a,
        &json!({
            "sender_client_id": client_id_a,
            "epoch": 0,
            "content_type": "application",
            "ciphertext": ct_b64,
        }),
    )
    .await;

    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(body["epoch"], 0);
    assert_eq!(body["seq"], 1);

    let (epoch_status, epoch_body) =
        do_get(&app, &format!("/api/v1/rooms/{room_id}/epoch"), &token_a).await;
    assert_eq!(epoch_status, StatusCode::OK);
    assert_eq!(epoch_body["epoch"], 0);
    assert_eq!(epoch_body["sequence"], 1);
}

#[tokio::test]
async fn test_03_multiple_application_messages_increment_sequence() {
    let (app, pool) = setup_test_app().await;
    let (_user_a, token_a, client_id_a) = create_test_user_with_device(&app, &pool, "user_a").await;

    let room_id = create_room(&app, &token_a).await;
    let ct_b64 = BASE64.encode(b"payload");

    for expected_seq in 1..=3 {
        let (status, body) = do_post(
            &app,
            &format!("/api/v1/rooms/{room_id}/messages"),
            &token_a,
            &json!({
                "sender_client_id": client_id_a,
                "epoch": 0,
                "content_type": "application",
                "ciphertext": ct_b64,
            }),
        )
        .await;

        assert_eq!(status, StatusCode::CREATED);
        assert_eq!(body["seq"], expected_seq);
    }
}

#[tokio::test]
async fn test_04_commit_advances_epoch_and_resets_sequence() {
    let (app, pool) = setup_test_app().await;
    let (_user_a, token_a, client_id_a) = create_test_user_with_device(&app, &pool, "user_a").await;

    let room_id = create_room(&app, &token_a).await;
    let ct_b64 = BASE64.encode(b"payload");

    // Submit 2 applications
    for _ in 0..2 {
        let _ = do_post(
            &app,
            &format!("/api/v1/rooms/{room_id}/messages"),
            &token_a,
            &json!({
                "sender_client_id": client_id_a,
                "epoch": 0,
                "content_type": "application",
                "ciphertext": ct_b64,
            }),
        )
        .await;
    }

    let th_b64 = BASE64.encode([7u8; 32]);

    let (commit_status, commit_body) = do_post(
        &app,
        &format!("/api/v1/rooms/{room_id}/messages"),
        &token_a,
        &json!({
            "sender_client_id": client_id_a,
            "epoch": 0,
            "content_type": "commit",
            "ciphertext": ct_b64,
            "transcript_hash": th_b64,
        }),
    )
    .await;

    assert_eq!(commit_status, StatusCode::CREATED);
    assert_eq!(commit_body["new_epoch"], 1);

    let (epoch_status, epoch_body) =
        do_get(&app, &format!("/api/v1/rooms/{room_id}/epoch"), &token_a).await;
    assert_eq!(epoch_status, StatusCode::OK);
    assert_eq!(epoch_body["epoch"], 1);
    assert_eq!(epoch_body["sequence"], 0);
}

#[tokio::test]
async fn test_05_application_at_stale_epoch_returns_409() {
    let (app, pool) = setup_test_app().await;
    let (_user_a, token_a, client_id_a) = create_test_user_with_device(&app, &pool, "user_a").await;

    let room_id = create_room(&app, &token_a).await;
    let ct_b64 = BASE64.encode(b"payload");
    let th_b64 = BASE64.encode([7u8; 32]);

    // Commit to advance to epoch 1
    let _ = do_post(
        &app,
        &format!("/api/v1/rooms/{room_id}/messages"),
        &token_a,
        &json!({
            "sender_client_id": client_id_a,
            "epoch": 0,
            "content_type": "commit",
            "ciphertext": ct_b64,
            "transcript_hash": th_b64,
        }),
    )
    .await;

    // Try application at epoch 0
    let (status, body) = do_post(
        &app,
        &format!("/api/v1/rooms/{room_id}/messages"),
        &token_a,
        &json!({
            "sender_client_id": client_id_a,
            "epoch": 0,
            "content_type": "application",
            "ciphertext": ct_b64,
        }),
    )
    .await;

    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(body["error"], "epoch_mismatch");
    assert_eq!(body["details"]["expected"], 1);
    assert_eq!(body["details"]["received"], 0);
}

#[tokio::test]
async fn test_06_commit_at_stale_epoch_returns_409() {
    let (app, pool) = setup_test_app().await;
    let (_user_a, token_a, client_id_a) = create_test_user_with_device(&app, &pool, "user_a").await;

    let room_id = create_room(&app, &token_a).await;
    let ct_b64 = BASE64.encode(b"payload");
    let th_b64 = BASE64.encode([7u8; 32]);

    // Commit to advance to epoch 1
    let _ = do_post(
        &app,
        &format!("/api/v1/rooms/{room_id}/messages"),
        &token_a,
        &json!({
            "sender_client_id": client_id_a,
            "epoch": 0,
            "content_type": "commit",
            "ciphertext": ct_b64,
            "transcript_hash": th_b64,
        }),
    )
    .await;

    // Try another commit at epoch 0
    let (status, body) = do_post(
        &app,
        &format!("/api/v1/rooms/{room_id}/messages"),
        &token_a,
        &json!({
            "sender_client_id": client_id_a,
            "epoch": 0,
            "content_type": "commit",
            "ciphertext": ct_b64,
            "transcript_hash": th_b64,
        }),
    )
    .await;

    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(body["error"], "epoch_mismatch");
}

#[tokio::test]
async fn test_07_commit_without_transcript_hash_returns_400() {
    let (app, pool) = setup_test_app().await;
    let (_user_a, token_a, client_id_a) = create_test_user_with_device(&app, &pool, "user_a").await;

    let room_id = create_room(&app, &token_a).await;
    let ct_b64 = BASE64.encode(b"payload");

    let (status, body) = do_post(
        &app,
        &format!("/api/v1/rooms/{room_id}/messages"),
        &token_a,
        &json!({
            "sender_client_id": client_id_a,
            "epoch": 0,
            "content_type": "commit",
            "ciphertext": ct_b64,
            "transcript_hash": null,
        }),
    )
    .await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["error"], "missing_transcript_hash");
}

#[tokio::test]
async fn test_08_concurrent_commits_at_same_epoch_one_succeeds() {
    let (app, pool) = setup_test_app().await;
    let (_user_a, token_a, client_id_a) = create_test_user_with_device(&app, &pool, "user_a").await;

    let room_id = create_room(&app, &token_a).await;
    let ct_b64 = BASE64.encode(b"payload");
    let th_b64 = BASE64.encode([7u8; 32]);

    let uri = format!("/api/v1/rooms/{room_id}/messages");
    let payload = json!({
        "sender_client_id": client_id_a,
        "epoch": 0,
        "content_type": "commit",
        "ciphertext": ct_b64,
        "transcript_hash": th_b64,
    });

    let req1 = do_post(&app, &uri, &token_a, &payload);
    let req2 = do_post(&app, &uri, &token_a, &payload);

    let ((status1, _), (status2, _)) = tokio::join!(req1, req2);

    let statuses = [status1, status2];
    assert!(statuses.contains(&StatusCode::CREATED));
    assert!(statuses.contains(&StatusCode::CONFLICT));
}

#[tokio::test]
async fn test_09_non_member_cannot_submit() {
    let (app, pool) = setup_test_app().await;
    let (_user_a, token_a, _) = create_test_user_with_device(&app, &pool, "user_a").await;
    let (_user_c, token_c, client_id_c) = create_test_user_with_device(&app, &pool, "user_c").await;

    let room_id = create_room(&app, &token_a).await;
    let ct_b64 = BASE64.encode(b"payload");

    let (status, body) = do_post(
        &app,
        &format!("/api/v1/rooms/{room_id}/messages"),
        &token_c,
        &json!({
            "sender_client_id": client_id_c,
            "epoch": 0,
            "content_type": "application",
            "ciphertext": ct_b64,
        }),
    )
    .await;

    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body["error"], "room_not_found");
}

#[tokio::test]
async fn test_10_unknown_sender_client_id_returns_400() {
    let (app, pool) = setup_test_app().await;
    let (_user_a, token_a, _) = create_test_user_with_device(&app, &pool, "user_a").await;

    let room_id = create_room(&app, &token_a).await;
    let ct_b64 = BASE64.encode(b"payload");

    let (status, body) = do_post(
        &app,
        &format!("/api/v1/rooms/{room_id}/messages"),
        &token_a,
        &json!({
            "sender_client_id": "fake_client_id_999",
            "epoch": 0,
            "content_type": "application",
            "ciphertext": ct_b64,
        }),
    )
    .await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["error"], "unknown_client_id");
}

#[tokio::test]
async fn test_11_oversized_ciphertext_returns_400() {
    let (app, pool) = setup_test_app().await;
    let (_user_a, token_a, client_id_a) = create_test_user_with_device(&app, &pool, "user_a").await;

    let room_id = create_room(&app, &token_a).await;
    let huge_bytes = vec![0u8; 1024 * 1024 + 1];
    let ct_b64 = BASE64.encode(&huge_bytes);

    let (status, _) = do_post(
        &app,
        &format!("/api/v1/rooms/{room_id}/messages"),
        &token_a,
        &json!({
            "sender_client_id": client_id_a,
            "epoch": 0,
            "content_type": "application",
            "ciphertext": ct_b64,
        }),
    )
    .await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn test_12_invalid_ciphertext_base64_returns_400() {
    let (app, pool) = setup_test_app().await;
    let (_user_a, token_a, client_id_a) = create_test_user_with_device(&app, &pool, "user_a").await;

    let room_id = create_room(&app, &token_a).await;

    let (status, _) = do_post(
        &app,
        &format!("/api/v1/rooms/{room_id}/messages"),
        &token_a,
        &json!({
            "sender_client_id": client_id_a,
            "epoch": 0,
            "content_type": "application",
            "ciphertext": "not base64!!!",
        }),
    )
    .await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn test_13_list_returns_all_messages_in_order() {
    let (app, pool) = setup_test_app().await;
    let (_user_a, token_a, client_id_a) = create_test_user_with_device(&app, &pool, "user_a").await;

    let room_id = create_room(&app, &token_a).await;
    let ct_b64 = BASE64.encode(b"payload");
    let th_b64 = BASE64.encode([7u8; 32]);

    // Submit 3 apps + 1 commit
    for _ in 0..3 {
        let _ = do_post(
            &app,
            &format!("/api/v1/rooms/{room_id}/messages"),
            &token_a,
            &json!({
                "sender_client_id": client_id_a,
                "epoch": 0,
                "content_type": "application",
                "ciphertext": ct_b64,
            }),
        )
        .await;
    }

    let _ = do_post(
        &app,
        &format!("/api/v1/rooms/{room_id}/messages"),
        &token_a,
        &json!({
            "sender_client_id": client_id_a,
            "epoch": 0,
            "content_type": "commit",
            "ciphertext": ct_b64,
            "transcript_hash": th_b64,
        }),
    )
    .await;

    let (status, body) = do_get(&app, &format!("/api/v1/rooms/{room_id}/messages"), &token_a).await;
    assert_eq!(status, StatusCode::OK);

    let msgs = body["messages"].as_array().unwrap();
    assert_eq!(msgs.len(), 4);
    assert_eq!(msgs[0]["epoch"], 0);
    assert_eq!(msgs[0]["seq"], 0);
    assert_eq!(msgs[0]["content_type"], "commit");
    assert_eq!(msgs[1]["epoch"], 0);
    assert_eq!(msgs[1]["seq"], 1);
    assert_eq!(msgs[2]["epoch"], 0);
    assert_eq!(msgs[2]["seq"], 2);
    assert_eq!(msgs[3]["epoch"], 0);
    assert_eq!(msgs[3]["seq"], 3);
}

#[tokio::test]
async fn test_14_list_does_not_include_ciphertext() {
    let (app, pool) = setup_test_app().await;
    let (_user_a, token_a, client_id_a) = create_test_user_with_device(&app, &pool, "user_a").await;

    let room_id = create_room(&app, &token_a).await;
    let ct_b64 = BASE64.encode(b"secret payload");

    let _ = do_post(
        &app,
        &format!("/api/v1/rooms/{room_id}/messages"),
        &token_a,
        &json!({
            "sender_client_id": client_id_a,
            "epoch": 0,
            "content_type": "application",
            "ciphertext": ct_b64,
        }),
    )
    .await;

    let (_, body) = do_get(&app, &format!("/api/v1/rooms/{room_id}/messages"), &token_a).await;
    let msg = &body["messages"][0];
    assert!(msg.get("ciphertext").is_none());
}

#[tokio::test]
async fn test_15_since_epoch_filters() {
    let (app, pool) = setup_test_app().await;
    let (_user_a, token_a, client_id_a) = create_test_user_with_device(&app, &pool, "user_a").await;

    let room_id = create_room(&app, &token_a).await;
    let ct_b64 = BASE64.encode(b"payload");
    let th_b64 = BASE64.encode([7u8; 32]);

    // Message at epoch 0
    let _ = do_post(
        &app,
        &format!("/api/v1/rooms/{room_id}/messages"),
        &token_a,
        &json!({
            "sender_client_id": client_id_a,
            "epoch": 0,
            "content_type": "application",
            "ciphertext": ct_b64,
        }),
    )
    .await;

    // Commit to epoch 1
    let _ = do_post(
        &app,
        &format!("/api/v1/rooms/{room_id}/messages"),
        &token_a,
        &json!({
            "sender_client_id": client_id_a,
            "epoch": 0,
            "content_type": "commit",
            "ciphertext": ct_b64,
            "transcript_hash": th_b64,
        }),
    )
    .await;

    // Message at epoch 1
    let _ = do_post(
        &app,
        &format!("/api/v1/rooms/{room_id}/messages"),
        &token_a,
        &json!({
            "sender_client_id": client_id_a,
            "epoch": 1,
            "content_type": "application",
            "ciphertext": ct_b64,
        }),
    )
    .await;

    let (_, body) = do_get(
        &app,
        &format!("/api/v1/rooms/{room_id}/messages?since_epoch=1"),
        &token_a,
    )
    .await;

    let msgs = body["messages"].as_array().unwrap();
    assert_eq!(msgs.len(), 1);
    assert_eq!(msgs[0]["epoch"], 1);
}

#[tokio::test]
async fn test_16_limit_caps_the_response() {
    let (app, pool) = setup_test_app().await;
    let (_user_a, token_a, client_id_a) = create_test_user_with_device(&app, &pool, "user_a").await;

    let room_id = create_room(&app, &token_a).await;
    let ct_b64 = BASE64.encode(b"payload");

    for _ in 0..10 {
        let _ = do_post(
            &app,
            &format!("/api/v1/rooms/{room_id}/messages"),
            &token_a,
            &json!({
                "sender_client_id": client_id_a,
                "epoch": 0,
                "content_type": "application",
                "ciphertext": ct_b64,
            }),
        )
        .await;
    }

    let (_, body) = do_get(
        &app,
        &format!("/api/v1/rooms/{room_id}/messages?limit=3"),
        &token_a,
    )
    .await;

    let msgs = body["messages"].as_array().unwrap();
    assert_eq!(msgs.len(), 3);
}

#[tokio::test]
async fn test_17_non_member_cannot_list() {
    let (app, pool) = setup_test_app().await;
    let (_user_a, token_a, _) = create_test_user_with_device(&app, &pool, "user_a").await;
    let (_user_c, token_c, _) = create_test_user_with_device(&app, &pool, "user_c").await;

    let room_id = create_room(&app, &token_a).await;

    let (status, _) = do_get(&app, &format!("/api/v1/rooms/{room_id}/messages"), &token_c).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn test_18_ciphertext_endpoint_returns_blob() {
    let (app, pool) = setup_test_app().await;
    let (_user_a, token_a, client_id_a) = create_test_user_with_device(&app, &pool, "user_a").await;

    let room_id = create_room(&app, &token_a).await;
    let ct_b64 = BASE64.encode(b"my super secret payload");

    let (_, post_body) = do_post(
        &app,
        &format!("/api/v1/rooms/{room_id}/messages"),
        &token_a,
        &json!({
            "sender_client_id": client_id_a,
            "epoch": 0,
            "content_type": "application",
            "ciphertext": ct_b64,
        }),
    )
    .await;

    let msg_id = post_body["message_id"].as_str().unwrap();

    let (status, body) = do_get(
        &app,
        &format!("/api/v1/rooms/{room_id}/messages/{msg_id}/ciphertext"),
        &token_a,
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["id"], msg_id);
    assert_eq!(body["ciphertext"], ct_b64);
}

#[tokio::test]
async fn test_19_ciphertext_for_unknown_message_returns_404() {
    let (app, pool) = setup_test_app().await;
    let (_user_a, token_a, _) = create_test_user_with_device(&app, &pool, "user_a").await;

    let room_id = create_room(&app, &token_a).await;

    let (status, body) = do_get(
        &app,
        &format!("/api/v1/rooms/{room_id}/messages/fake_msg_id/ciphertext"),
        &token_a,
    )
    .await;

    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body["error"], "message_not_found");
}

#[tokio::test]
async fn test_20_non_member_cannot_fetch_ciphertext() {
    let (app, pool) = setup_test_app().await;
    let (_user_a, token_a, client_id_a) = create_test_user_with_device(&app, &pool, "user_a").await;
    let (_user_c, token_c, _) = create_test_user_with_device(&app, &pool, "user_c").await;

    let room_id = create_room(&app, &token_a).await;
    let ct_b64 = BASE64.encode(b"payload");

    let (_, post_body) = do_post(
        &app,
        &format!("/api/v1/rooms/{room_id}/messages"),
        &token_a,
        &json!({
            "sender_client_id": client_id_a,
            "epoch": 0,
            "content_type": "application",
            "ciphertext": ct_b64,
        }),
    )
    .await;

    let msg_id = post_body["message_id"].as_str().unwrap();

    let (status, _) = do_get(
        &app,
        &format!("/api/v1/rooms/{room_id}/messages/{msg_id}/ciphertext"),
        &token_c,
    )
    .await;

    assert_eq!(status, StatusCode::NOT_FOUND);
}
