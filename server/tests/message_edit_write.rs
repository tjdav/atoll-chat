mod common;

use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use axum::Router;
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use common::{login_user, register_user, setup_test_app};
use serde_json::{json, Value};
use sqlx::SqlitePool;
use tower::ServiceExt;

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

async fn do_get(app: &Router, uri: &str, token: &str) -> (StatusCode, Value, header::HeaderMap) {
    let req = Request::builder()
        .method("GET")
        .uri(uri)
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::empty())
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    let status = resp.status();
    let headers = resp.headers().clone();
    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body_bytes).unwrap_or(json!({}));
    (status, json, headers)
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

async fn do_patch(
    app: &Router,
    uri: &str,
    token: &str,
    client_id: Option<&str>,
    body: &Value,
) -> (StatusCode, Value, header::HeaderMap) {
    let mut builder = Request::builder()
        .method("PATCH")
        .uri(uri)
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json");

    if let Some(cid) = client_id {
        builder = builder.header("x-client-id", cid);
    }

    let req = builder.body(Body::from(body.to_string())).unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    let status = resp.status();
    let headers = resp.headers().clone();
    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body_bytes).unwrap_or(json!({}));
    (status, json, headers)
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

async fn add_member(app: &Router, token: &str, room_id: &str, user_id: &str) {
    let (status, _) = do_post(
        app,
        &format!("/api/v1/rooms/{room_id}/members"),
        token,
        &json!({ "user_id": user_id }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
}

#[tokio::test]
async fn test_message_edit_write_flow() {
    let (app, pool) = setup_test_app().await;

    // 1. Register user and create room
    let (_user_id, token, client_id) = create_test_user_with_device(&app, &pool, "ew1").await;
    let room_id = create_room(&app, &token).await;

    // 2. Submit original application message
    let orig_ct = BASE64.encode(b"original message content");
    let (status_sub, submit_body) = do_post(
        &app,
        &format!("/api/v1/rooms/{room_id}/messages"),
        &token,
        &json!({
            "sender_client_id": client_id,
            "epoch": 0,
            "content_type": "application",
            "ciphertext": orig_ct
        }),
    )
    .await;

    assert_eq!(status_sub, StatusCode::CREATED);
    let orig_msg_id = submit_body["message_id"].as_str().unwrap().to_string();

    // 3. First edit
    let edit1_ct = BASE64.encode(b"edited message content 1");
    let (status_e1, edit1_body, headers_e1) = do_patch(
        &app,
        &format!("/api/v1/rooms/{room_id}/messages/{orig_msg_id}"),
        &token,
        Some(&client_id),
        &json!({ "ciphertext": edit1_ct }),
    )
    .await;

    assert_eq!(status_e1, StatusCode::OK);
    assert_eq!(headers_e1.get("cache-control").unwrap(), "no-store");
    assert_eq!(edit1_body["original_id"], orig_msg_id);
    assert_eq!(edit1_body["edit_sequence"], 1);
    assert_eq!(edit1_body["epoch"], 0);
    let edit1_id = edit1_body["edit_id"].as_str().unwrap().to_string();

    // Verify original message has edited_at set
    let (orig_edited_at,): (Option<String>,) =
        sqlx::query_as("SELECT edited_at FROM room_messages WHERE id = ?")
            .bind(&orig_msg_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(orig_edited_at.is_some());

    // 4. Second edit
    let edit2_ct = BASE64.encode(b"edited message content 2");
    let (status_e2, edit2_body, _) = do_patch(
        &app,
        &format!("/api/v1/rooms/{room_id}/messages/{orig_msg_id}"),
        &token,
        Some(&client_id),
        &json!({ "ciphertext": edit2_ct }),
    )
    .await;

    assert_eq!(status_e2, StatusCode::OK);
    assert_eq!(edit2_body["original_id"], orig_msg_id);
    assert_eq!(edit2_body["edit_sequence"], 2);

    // 5. Verify edit row properties
    let (edit1_seq, edit1_of, edit1_epoch): (i64, Option<String>, i64) =
        sqlx::query_as("SELECT seq, edit_of, epoch FROM room_messages WHERE id = ?")
            .bind(&edit1_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(edit1_seq, 0);
    assert_eq!(edit1_of.as_deref(), Some(orig_msg_id.as_str()));
    assert_eq!(edit1_epoch, 0);

    // 6. List messages and verify exposure of edit_of and edit_sequence
    let (status_list, list_body, _) =
        do_get(&app, &format!("/api/v1/rooms/{room_id}/messages"), &token).await;

    assert_eq!(status_list, StatusCode::OK);
    let msgs = list_body["messages"].as_array().unwrap();

    let orig_view = msgs.iter().find(|m| m["id"] == orig_msg_id).unwrap();
    assert!(orig_view["edit_of"].is_null());
    assert_eq!(orig_view["edit_sequence"], 0);
    assert!(orig_view["edited_at"].is_string());

    let edit1_view = msgs.iter().find(|m| m["id"] == edit1_id).unwrap();
    assert_eq!(edit1_view["edit_of"], orig_msg_id);
    assert_eq!(edit1_view["edit_sequence"], 1);
}

#[tokio::test]
async fn test_message_edit_authorization_and_states() {
    let (app, pool) = setup_test_app().await;

    let (user1_id, token1, client1_id) = create_test_user_with_device(&app, &pool, "ea_a").await;
    let (user2_id, token2, _client2_id) = create_test_user_with_device(&app, &pool, "ea_b").await;

    let room_id = create_room(&app, &token1).await;
    add_member(&app, &token1, &room_id, &user2_id).await;

    // Submit original message from user1
    let orig_ct = BASE64.encode(b"original text");
    let (status_sub, submit_body) = do_post(
        &app,
        &format!("/api/v1/rooms/{room_id}/messages"),
        &token1,
        &json!({
            "sender_client_id": client1_id,
            "epoch": 0,
            "content_type": "application",
            "ciphertext": orig_ct
        }),
    )
    .await;
    assert_eq!(status_sub, StatusCode::CREATED);
    let orig_msg_id = submit_body["message_id"].as_str().unwrap().to_string();

    // 1. Non-sender (user2) attempts edit -> 403 forbidden
    let edit_ct = BASE64.encode(b"unauthorized edit");
    let (status_user2, _, _) = do_patch(
        &app,
        &format!("/api/v1/rooms/{room_id}/messages/{orig_msg_id}"),
        &token2,
        None,
        &json!({ "ciphertext": edit_ct }),
    )
    .await;
    assert_eq!(status_user2, StatusCode::FORBIDDEN);

    // 2. Non-member attempts edit -> 404 room_not_found
    let (_user3_id, token3, _client3_id) = create_test_user_with_device(&app, &pool, "ea_c").await;
    let (status_user3, _, _) = do_patch(
        &app,
        &format!("/api/v1/rooms/{room_id}/messages/{orig_msg_id}"),
        &token3,
        None,
        &json!({ "ciphertext": edit_ct }),
    )
    .await;
    assert_eq!(status_user3, StatusCode::NOT_FOUND);

    // 3. Unknown message -> 404 message_not_found
    let (status_unk, _, _) = do_patch(
        &app,
        &format!("/api/v1/rooms/{room_id}/messages/01HN0000000000000000000000"),
        &token1,
        None,
        &json!({ "ciphertext": edit_ct }),
    )
    .await;
    assert_eq!(status_unk, StatusCode::NOT_FOUND);

    // 4. Editing deleted message -> 409 message_deleted
    let (status_del, _) = do_delete(
        &app,
        &format!("/api/v1/rooms/{room_id}/messages/{orig_msg_id}"),
        &token1,
    )
    .await;
    assert_eq!(status_del, StatusCode::NO_CONTENT);

    let (status_edit_del, edit_del_body, _) = do_patch(
        &app,
        &format!("/api/v1/rooms/{room_id}/messages/{orig_msg_id}"),
        &token1,
        None,
        &json!({ "ciphertext": edit_ct }),
    )
    .await;
    assert_eq!(status_edit_del, StatusCode::CONFLICT);
    assert_eq!(edit_del_body["error"], "message_deleted");

    // 5. Editing commit message -> 400 not_editable
    let commit_msg_id = ulid::Ulid::new().to_string();
    let dummy_ct: &[u8] = b"dummy commit";
    sqlx::query(
        "INSERT INTO room_messages (id, room_id, sender_user_id, sender_client_id, epoch, seq, content_type, ciphertext) VALUES (?, ?, ?, ?, 0, 0, 'commit', ?)",
    )
    .bind(&commit_msg_id)
    .bind(&room_id)
    .bind(&user1_id)
    .bind(&client1_id)
    .bind(dummy_ct)
    .execute(&pool)
    .await
    .unwrap();

    let (status_commit, edit_commit_body, _) = do_patch(
        &app,
        &format!("/api/v1/rooms/{room_id}/messages/{commit_msg_id}"),
        &token1,
        None,
        &json!({ "ciphertext": edit_ct }),
    )
    .await;
    assert_eq!(status_commit, StatusCode::BAD_REQUEST);
    assert_eq!(edit_commit_body["error"], "not_editable");
}
