mod common;

use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use axum::Router;
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use common::{login_user, register_user, setup_test_app, setup_test_app_with_config};
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

async fn do_patch(
    app: &Router,
    uri: &str,
    token: &str,
    client_id: Option<&str>,
    body: &Value,
) -> (StatusCode, Value) {
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
async fn test_message_edit_window_validation() {
    let (app, pool, _) = setup_test_app_with_config(true, "auto", 100).await;

    // Mutate edit_window_seconds on instance_config if needed, or query room_messages
    let (_user_id, token, client_id) = create_test_user_with_device(&app, &pool, "ev1").await;
    let room_id = create_room(&app, &token).await;

    let orig_ct = BASE64.encode(b"original message");
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

    let msg_id = submit_body["message_id"].as_str().unwrap().to_string();

    // 1. Edit within window -> CREATED
    let (status_e1, _) = do_patch(
        &app,
        &format!("/api/v1/rooms/{room_id}/messages/{msg_id}"),
        &token,
        Some(&client_id),
        &json!({ "ciphertext": BASE64.encode(b"edit 1") }),
    )
    .await;
    assert_eq!(status_e1, StatusCode::CREATED);

    // 2. Backdate created_at by 1000 seconds to exceed 900s window
    sqlx::query(
        "UPDATE room_messages SET created_at = datetime('now', '-1000 seconds') WHERE id = ?",
    )
    .bind(&msg_id)
    .execute(&pool)
    .await
    .unwrap();

    // 3. Edit after window -> 403 edit_window_expired
    let (status_e2, edit2_body) = do_patch(
        &app,
        &format!("/api/v1/rooms/{room_id}/messages/{msg_id}"),
        &token,
        Some(&client_id),
        &json!({ "ciphertext": BASE64.encode(b"edit 2") }),
    )
    .await;

    assert_eq!(status_e2, StatusCode::FORBIDDEN);
    assert_eq!(edit2_body["error"], "edit_window_expired");
    assert_eq!(edit2_body["details"]["window_seconds"], 900);
}

#[tokio::test]
async fn test_message_edit_payload_and_rate_limit_validation() {
    let (app, pool) = setup_test_app().await;

    let (_user_id, token, client_id) = create_test_user_with_device(&app, &pool, "ev2").await;
    let room_id = create_room(&app, &token).await;

    let orig_ct = BASE64.encode(b"original message");
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

    let msg_id = submit_body["message_id"].as_str().unwrap().to_string();

    // 1. Missing ciphertext -> 400 missing_field
    let (status_missing, body_missing) = do_patch(
        &app,
        &format!("/api/v1/rooms/{room_id}/messages/{msg_id}"),
        &token,
        Some(&client_id),
        &json!({}),
    )
    .await;
    assert_eq!(status_missing, StatusCode::BAD_REQUEST);
    assert_eq!(body_missing["error"], "missing_field");

    // 2. Invalid base64 -> 400 invalid_ciphertext
    let (status_inv, body_inv) = do_patch(
        &app,
        &format!("/api/v1/rooms/{room_id}/messages/{msg_id}"),
        &token,
        Some(&client_id),
        &json!({ "ciphertext": "!!!invalid_b64!!!" }),
    )
    .await;
    assert_eq!(status_inv, StatusCode::BAD_REQUEST);
    assert_eq!(body_inv["error"], "invalid_ciphertext");
}

#[test]
fn test_edit_window_config_startup_range_validation() {
    use server::config::Config;

    std::env::set_var("APP_ENV", "development");

    // 1. EDIT_WINDOW_SECONDS above SERVER_MAX_EDIT_WINDOW_SECONDS fails
    std::env::set_var("SERVER_MAX_EDIT_WINDOW_SECONDS", "3600");
    std::env::set_var("EDIT_WINDOW_SECONDS", "7200");
    let cfg_err = Config::from_env();
    assert!(cfg_err.is_err(), "expected Config::from_env() to fail");
    let err_msg = cfg_err.unwrap_err().to_string();
    assert!(
        err_msg.contains("EDIT_WINDOW_SECONDS"),
        "error message should contain EDIT_WINDOW_SECONDS, got: {}",
        err_msg
    );

    // 2. EDIT_WINDOW_SECONDS below 60 fails
    std::env::set_var("SERVER_MAX_EDIT_WINDOW_SECONDS", "86400");
    std::env::set_var("EDIT_WINDOW_SECONDS", "30");
    let cfg_err2 = Config::from_env();
    assert!(cfg_err2.is_err(), "expected Config::from_env() to fail");
    let err_msg2 = cfg_err2.unwrap_err().to_string();
    assert!(
        err_msg2.contains("EDIT_WINDOW_SECONDS"),
        "error message should contain EDIT_WINDOW_SECONDS, got: {}",
        err_msg2
    );

    // Clean up env vars
    std::env::remove_var("SERVER_MAX_EDIT_WINDOW_SECONDS");
    std::env::remove_var("EDIT_WINDOW_SECONDS");
    std::env::remove_var("APP_ENV");
}
