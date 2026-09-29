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

async fn do_delete(app: &Router, uri: &str, token: &str) -> (StatusCode, Value) {
    let req = Request::builder()
        .method("DELETE")
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

async fn create_room(app: &Router, token: &str) -> String {
    let (status, body) = do_post(app, "/api/v1/rooms", token, &json!({})).await;
    assert_eq!(status, StatusCode::CREATED);
    body["id"].as_str().unwrap().to_string()
}

// 1. Empty room returns empty messages and null cursor.
#[tokio::test]
async fn test_01_empty_room_initial_sync() {
    let (app, pool) = setup_test_app().await;
    let (_user_a, token_a, _) = create_test_user_with_device(&app, &pool, "user_a").await;
    let room_id = create_room(&app, &token_a).await;

    let (status, body) = do_get(&app, &format!("/api/v1/rooms/{room_id}/messages"), &token_a).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["messages"], json!([]));
    assert!(body["next_cursor"].is_null());
    assert_eq!(body["has_more"], false);
}

// 2. Initial sync returns messages ascending.
#[tokio::test]
async fn test_02_initial_sync_ascending_order() {
    let (app, pool) = setup_test_app().await;
    let (_user_a, token_a, client_id_a) = create_test_user_with_device(&app, &pool, "user_a").await;
    let room_id = create_room(&app, &token_a).await;
    let ct_b64 = BASE64.encode(b"payload");

    for _ in 0..5 {
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

    let (status, body) = do_get(&app, &format!("/api/v1/rooms/{room_id}/messages"), &token_a).await;
    assert_eq!(status, StatusCode::OK);
    let msgs = body["messages"].as_array().unwrap();
    assert_eq!(msgs.len(), 5);
    for (i, msg) in msgs.iter().enumerate() {
        assert_eq!(msg["seq"], (i + 1) as i64);
    }
    assert_eq!(body["has_more"], false);
    assert_eq!(body["next_cursor"]["epoch"], 0);
    assert_eq!(body["next_cursor"]["seq"], 5);
}

// 3. Initial sync respects default limit (50).
#[tokio::test]
async fn test_03_initial_sync_default_limit() {
    let (app, pool) = setup_test_app().await;
    let (_user_a, token_a, client_id_a) = create_test_user_with_device(&app, &pool, "user_a").await;
    let room_id = create_room(&app, &token_a).await;
    let ct_b64 = BASE64.encode(b"payload");

    for _ in 0..60 {
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

    let (status, body) = do_get(&app, &format!("/api/v1/rooms/{room_id}/messages"), &token_a).await;
    assert_eq!(status, StatusCode::OK);
    let msgs = body["messages"].as_array().unwrap();
    assert_eq!(msgs.len(), 50);
    assert_eq!(body["has_more"], true);
    // Most recent 50 messages means seq 11 to 60, ascending
    assert_eq!(msgs[0]["seq"], 11);
    assert_eq!(msgs[49]["seq"], 60);
    assert_eq!(body["next_cursor"]["epoch"], 0);
    assert_eq!(body["next_cursor"]["seq"], 60);
}

// 4. Initial sync respects an explicit limit.
#[tokio::test]
async fn test_04_initial_sync_explicit_limit() {
    let (app, pool) = setup_test_app().await;
    let (_user_a, token_a, client_id_a) = create_test_user_with_device(&app, &pool, "user_a").await;
    let room_id = create_room(&app, &token_a).await;
    let ct_b64 = BASE64.encode(b"payload");

    for _ in 0..20 {
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

    let (status, body) = do_get(
        &app,
        &format!("/api/v1/rooms/{room_id}/messages?limit=10"),
        &token_a,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let msgs = body["messages"].as_array().unwrap();
    assert_eq!(msgs.len(), 10);
    assert_eq!(body["has_more"], true);
    // Most recent 10 messages: seq 11 to 20
    assert_eq!(msgs[0]["seq"], 11);
    assert_eq!(msgs[9]["seq"], 20);
}

// 5. Initial sync with fewer messages than limit.
#[tokio::test]
async fn test_05_initial_sync_fewer_than_limit() {
    let (app, pool) = setup_test_app().await;
    let (_user_a, token_a, client_id_a) = create_test_user_with_device(&app, &pool, "user_a").await;
    let room_id = create_room(&app, &token_a).await;
    let ct_b64 = BASE64.encode(b"payload");

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

    let (status, body) = do_get(
        &app,
        &format!("/api/v1/rooms/{room_id}/messages?limit=10"),
        &token_a,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let msgs = body["messages"].as_array().unwrap();
    assert_eq!(msgs.len(), 3);
    assert_eq!(body["has_more"], false);
    assert_eq!(body["next_cursor"]["epoch"], 0);
    assert_eq!(body["next_cursor"]["seq"], 3);
}

// 6. next_cursor matches the last message.
#[tokio::test]
async fn test_06_next_cursor_matches_last_message() {
    let (app, pool) = setup_test_app().await;
    let (_user_a, token_a, client_id_a) = create_test_user_with_device(&app, &pool, "user_a").await;
    let room_id = create_room(&app, &token_a).await;
    let ct_b64 = BASE64.encode(b"payload");

    for _ in 0..5 {
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

    let (status, body) = do_get(&app, &format!("/api/v1/rooms/{room_id}/messages"), &token_a).await;
    assert_eq!(status, StatusCode::OK);
    let msgs = body["messages"].as_array().unwrap();
    let last = &msgs[msgs.len() - 1];

    assert_eq!(body["next_cursor"]["epoch"], last["epoch"]);
    assert_eq!(body["next_cursor"]["seq"], last["seq"]);
}

// 7. Delta sync returns messages after the cursor.
#[tokio::test]
async fn test_07_delta_sync_after_cursor() {
    let (app, pool) = setup_test_app().await;
    let (_user_a, token_a, client_id_a) = create_test_user_with_device(&app, &pool, "user_a").await;
    let room_id = create_room(&app, &token_a).await;
    let ct_b64 = BASE64.encode(b"payload");

    for _ in 0..5 {
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

    let (status, body) = do_get(
        &app,
        &format!("/api/v1/rooms/{room_id}/messages?since_epoch=0&since_seq=5"),
        &token_a,
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    let msgs = body["messages"].as_array().unwrap();
    assert_eq!(msgs.len(), 3);
    assert_eq!(msgs[0]["seq"], 6);
    assert_eq!(msgs[1]["seq"], 7);
    assert_eq!(msgs[2]["seq"], 8);
    assert_eq!(body["next_cursor"]["epoch"], 0);
    assert_eq!(body["next_cursor"]["seq"], 8);
    assert_eq!(body["has_more"], false);
}

// 8. Delta sync across epoch boundary.
#[tokio::test]
async fn test_08_delta_sync_across_epoch_boundary() {
    let (app, pool) = setup_test_app().await;
    let (_user_a, token_a, client_id_a) = create_test_user_with_device(&app, &pool, "user_a").await;
    let room_id = create_room(&app, &token_a).await;
    let ct_b64 = BASE64.encode(b"payload");
    let th_b64 = BASE64.encode([7u8; 32]);

    // 3 apps in epoch 0
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

    // 1 commit advancing to epoch 1
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

    // 2 apps in epoch 1
    for _ in 0..2 {
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
    }

    let (status, body) = do_get(
        &app,
        &format!("/api/v1/rooms/{room_id}/messages?since_epoch=0&since_seq=3"),
        &token_a,
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    let msgs = body["messages"].as_array().unwrap();
    // Commit is stored as (0, 0). (epoch, seq) > (0, 3) matches messages in epoch 1: (1, 1) and (1, 2).
    assert_eq!(msgs.len(), 2);
    assert_eq!(msgs[0]["epoch"], 1);
    assert_eq!(msgs[0]["seq"], 1);
    assert_eq!(msgs[1]["epoch"], 1);
    assert_eq!(msgs[1]["seq"], 2);
}

// 9. Delta sync with no new messages.
#[tokio::test]
async fn test_09_delta_sync_no_new_messages() {
    let (app, pool) = setup_test_app().await;
    let (_user_a, token_a, client_id_a) = create_test_user_with_device(&app, &pool, "user_a").await;
    let room_id = create_room(&app, &token_a).await;
    let ct_b64 = BASE64.encode(b"payload");

    for _ in 0..5 {
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

    let (status, body) = do_get(
        &app,
        &format!("/api/v1/rooms/{room_id}/messages?since_epoch=0&since_seq=5"),
        &token_a,
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["messages"], json!([]));
    assert!(body["next_cursor"].is_null());
    assert_eq!(body["has_more"], false);
}

// 10. Delta sync respects limit.
#[tokio::test]
async fn test_10_delta_sync_respects_limit() {
    let (app, pool) = setup_test_app().await;
    let (_user_a, token_a, client_id_a) = create_test_user_with_device(&app, &pool, "user_a").await;
    let room_id = create_room(&app, &token_a).await;
    let ct_b64 = BASE64.encode(b"payload");

    for _ in 0..20 {
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

    let (status, body) = do_get(
        &app,
        &format!("/api/v1/rooms/{room_id}/messages?since_epoch=0&since_seq=0&limit=5"),
        &token_a,
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    let msgs = body["messages"].as_array().unwrap();
    assert_eq!(msgs.len(), 5);
    assert_eq!(body["has_more"], true);
    assert_eq!(msgs[0]["seq"], 1);
    assert_eq!(msgs[4]["seq"], 5);
    assert_eq!(body["next_cursor"]["epoch"], 0);
    assert_eq!(body["next_cursor"]["seq"], 5);
}

// 11. Delta sync pagination.
#[tokio::test]
async fn test_11_delta_sync_pagination() {
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

    // Page 1
    let (status1, body1) = do_get(
        &app,
        &format!("/api/v1/rooms/{room_id}/messages?since_epoch=0&since_seq=0&limit=5"),
        &token_a,
    )
    .await;
    assert_eq!(status1, StatusCode::OK);
    let msgs1 = body1["messages"].as_array().unwrap();
    assert_eq!(msgs1.len(), 5);
    assert_eq!(body1["has_more"], true);
    assert_eq!(body1["next_cursor"]["seq"], 5);

    // Page 2
    let (status2, body2) = do_get(
        &app,
        &format!("/api/v1/rooms/{room_id}/messages?since_epoch=0&since_seq=5&limit=5"),
        &token_a,
    )
    .await;
    assert_eq!(status2, StatusCode::OK);
    let msgs2 = body2["messages"].as_array().unwrap();
    assert_eq!(msgs2.len(), 5);
    assert_eq!(body2["has_more"], false);
    assert_eq!(body2["next_cursor"]["seq"], 10);

    // Page 3 (empty)
    let (status3, body3) = do_get(
        &app,
        &format!("/api/v1/rooms/{room_id}/messages?since_epoch=0&since_seq=10&limit=5"),
        &token_a,
    )
    .await;
    assert_eq!(status3, StatusCode::OK);
    assert_eq!(body3["messages"], json!([]));
    assert!(body3["next_cursor"].is_null());
    assert_eq!(body3["has_more"], false);
}

// 12. Only since_epoch provided returns 400.
#[tokio::test]
async fn test_12_only_since_epoch_returns_400() {
    let (app, pool) = setup_test_app().await;
    let (_user_a, token_a, _) = create_test_user_with_device(&app, &pool, "user_a").await;
    let room_id = create_room(&app, &token_a).await;

    let (status, body) = do_get(
        &app,
        &format!("/api/v1/rooms/{room_id}/messages?since_epoch=1"),
        &token_a,
    )
    .await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["error"], "invalid_cursor");
}

// 13. Only since_seq provided returns 400.
#[tokio::test]
async fn test_13_only_since_seq_returns_400() {
    let (app, pool) = setup_test_app().await;
    let (_user_a, token_a, _) = create_test_user_with_device(&app, &pool, "user_a").await;
    let room_id = create_room(&app, &token_a).await;

    let (status, body) = do_get(
        &app,
        &format!("/api/v1/rooms/{room_id}/messages?since_seq=1"),
        &token_a,
    )
    .await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["error"], "invalid_cursor");
}

// 14. Negative since_epoch returns 400.
#[tokio::test]
async fn test_14_negative_since_epoch_returns_400() {
    let (app, pool) = setup_test_app().await;
    let (_user_a, token_a, _) = create_test_user_with_device(&app, &pool, "user_a").await;
    let room_id = create_room(&app, &token_a).await;

    let (status, body) = do_get(
        &app,
        &format!("/api/v1/rooms/{room_id}/messages?since_epoch=-1&since_seq=0"),
        &token_a,
    )
    .await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["error"], "invalid_cursor");
}

// 15. Negative since_seq returns 400.
#[tokio::test]
async fn test_15_negative_since_seq_returns_400() {
    let (app, pool) = setup_test_app().await;
    let (_user_a, token_a, _) = create_test_user_with_device(&app, &pool, "user_a").await;
    let room_id = create_room(&app, &token_a).await;

    let (status, body) = do_get(
        &app,
        &format!("/api/v1/rooms/{room_id}/messages?since_epoch=0&since_seq=-1"),
        &token_a,
    )
    .await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["error"], "invalid_cursor");
}

// 16. Limit above 500 is clamped to 500.
#[tokio::test]
async fn test_16_limit_clamped_to_500() {
    let (app, pool) = setup_test_app().await;
    let (_user_a, token_a, _) = create_test_user_with_device(&app, &pool, "user_a").await;
    let room_id = create_room(&app, &token_a).await;

    let (status, body) = do_get(
        &app,
        &format!("/api/v1/rooms/{room_id}/messages?limit=1000"),
        &token_a,
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    let msgs = body["messages"].as_array().unwrap();
    assert!(msgs.len() <= 500);
}

// 17. Limit of 0 treated as default (50).
#[tokio::test]
async fn test_17_limit_zero_treated_as_default() {
    let (app, pool) = setup_test_app().await;
    let (_user_a, token_a, client_id_a) = create_test_user_with_device(&app, &pool, "user_a").await;
    let room_id = create_room(&app, &token_a).await;
    let ct_b64 = BASE64.encode(b"payload");

    for _ in 0..60 {
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

    let (status, body) = do_get(
        &app,
        &format!("/api/v1/rooms/{room_id}/messages?limit=0"),
        &token_a,
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    let msgs = body["messages"].as_array().unwrap();
    assert_eq!(msgs.len(), 50);
}

// 18. Negative limit treated as default (50).
#[tokio::test]
async fn test_18_negative_limit_treated_as_default() {
    let (app, pool) = setup_test_app().await;
    let (_user_a, token_a, client_id_a) = create_test_user_with_device(&app, &pool, "user_a").await;
    let room_id = create_room(&app, &token_a).await;
    let ct_b64 = BASE64.encode(b"payload");

    for _ in 0..60 {
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

    let (status, body) = do_get(
        &app,
        &format!("/api/v1/rooms/{room_id}/messages?limit=-10"),
        &token_a,
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    let msgs = body["messages"].as_array().unwrap();
    assert_eq!(msgs.len(), 50);
}

// 19. Deleted messages appear in the list with deleted_at set.
#[tokio::test]
async fn test_19_deleted_messages_appear_with_deleted_at() {
    let (app, pool) = setup_test_app().await;
    let (_user_a, token_a, client_id_a) = create_test_user_with_device(&app, &pool, "user_a").await;
    let room_id = create_room(&app, &token_a).await;
    let ct_b64 = BASE64.encode(b"payload");

    let mut msg_ids = Vec::new();
    for _ in 0..3 {
        let (_, post_res) = do_post(
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
        msg_ids.push(post_res["message_id"].as_str().unwrap().to_string());
    }

    // Delete middle message
    let (del_status, _) = do_delete(
        &app,
        &format!("/api/v1/rooms/{room_id}/messages/{}", msg_ids[1]),
        &token_a,
    )
    .await;
    assert_eq!(del_status, StatusCode::NO_CONTENT);

    let (status, body) = do_get(&app, &format!("/api/v1/rooms/{room_id}/messages"), &token_a).await;
    assert_eq!(status, StatusCode::OK);
    let msgs = body["messages"].as_array().unwrap();
    assert_eq!(msgs.len(), 3);
    assert!(msgs[0]["deleted_at"].is_null());
    assert!(msgs[1]["deleted_at"].is_string());
    assert!(msgs[2]["deleted_at"].is_null());
}

// 20. Deleted messages in delta sync if created after cursor.
#[tokio::test]
async fn test_20_deleted_messages_included_in_delta_sync() {
    let (app, pool) = setup_test_app().await;
    let (_user_a, token_a, client_id_a) = create_test_user_with_device(&app, &pool, "user_a").await;
    let room_id = create_room(&app, &token_a).await;
    let ct_b64 = BASE64.encode(b"payload");

    // Submit 2 messages
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

    // Capture cursor at (0, 2)
    // Submit 1 message and delete it
    let (_, post_res) = do_post(
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
    let msg_id = post_res["message_id"].as_str().unwrap().to_string();

    let _ = do_delete(
        &app,
        &format!("/api/v1/rooms/{room_id}/messages/{msg_id}"),
        &token_a,
    )
    .await;

    // Delta sync from (0, 2)
    let (status, body) = do_get(
        &app,
        &format!("/api/v1/rooms/{room_id}/messages?since_epoch=0&since_seq=2"),
        &token_a,
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    let msgs = body["messages"].as_array().unwrap();
    assert_eq!(msgs.len(), 1);
    assert_eq!(msgs[0]["seq"], 3);
    assert!(msgs[0]["deleted_at"].is_string());
}

// 21. Non-member cannot list.
#[tokio::test]
async fn test_21_non_member_cannot_list() {
    let (app, pool) = setup_test_app().await;
    let (_user_a, token_a, _) = create_test_user_with_device(&app, &pool, "user_a").await;
    let (_user_b, token_b, _) = create_test_user_with_device(&app, &pool, "user_b").await;
    let room_id = create_room(&app, &token_a).await;

    let (status, body) = do_get(&app, &format!("/api/v1/rooms/{room_id}/messages"), &token_b).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body["error"], "room_not_found");
}

// 22. Unknown room returns 404.
#[tokio::test]
async fn test_22_unknown_room_returns_404() {
    let (app, pool) = setup_test_app().await;
    let (_user_a, token_a, _) = create_test_user_with_device(&app, &pool, "user_a").await;

    let (status, body) = do_get(
        &app,
        "/api/v1/rooms/non_existent_room_id/messages",
        &token_a,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body["error"], "room_not_found");
}

// 23. Initial sync returns ascending order matching delta sync.
#[tokio::test]
async fn test_23_ordering_invariant() {
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

    let (_, initial_body) =
        do_get(&app, &format!("/api/v1/rooms/{room_id}/messages"), &token_a).await;
    let (_, delta_body) = do_get(
        &app,
        &format!("/api/v1/rooms/{room_id}/messages?since_epoch=0&since_seq=0"),
        &token_a,
    )
    .await;

    let init_msgs = initial_body["messages"].as_array().unwrap();
    let delta_msgs = delta_body["messages"].as_array().unwrap();

    assert_eq!(init_msgs.len(), delta_msgs.len());
    for i in 0..init_msgs.len() {
        assert_eq!(init_msgs[i]["id"], delta_msgs[i]["id"]);
        assert_eq!(init_msgs[i]["epoch"], delta_msgs[i]["epoch"]);
        assert_eq!(init_msgs[i]["seq"], delta_msgs[i]["seq"]);
    }
}
