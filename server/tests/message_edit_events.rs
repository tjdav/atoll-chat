mod common;

use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use axum::Router;
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use common::{login_user, register_user};
use serde_json::{json, Value};
use sqlx::SqlitePool;
use tower::ServiceExt;
use wiremock::matchers::{method, path};
use wiremock::{Mock, ResponseTemplate};

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

async fn create_room(app: &Router, token: &str) -> String {
    let (status, body) = do_post(app, "/api/v1/rooms", token, &json!({})).await;
    assert_eq!(status, StatusCode::CREATED);
    body["id"].as_str().unwrap().to_string()
}

#[tokio::test]
async fn test_message_edit_events_and_audit() {
    let mock_server = wiremock::MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/apps/chat/events"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({"ok": true})))
        .mount(&mock_server)
        .await;

    let mock_uri = mock_server.uri();
    let (app, pool, _) = common::setup_test_app_with_custom_config(|cfg| {
        cfg.sockudo_url = mock_uri;
        cfg.sockudo_app_key = "test-app-key".to_string();
        cfg.sockudo_app_secret = "test-app-secret".to_string();
    })
    .await;

    let (user_id, token, client_id) = create_test_user_with_device(&app, &pool, "ee1").await;
    let room_id = create_room(&app, &token).await;

    let orig_ct = BASE64.encode(b"original content");
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

    let edit_ct = BASE64.encode(b"edited content");
    let (status_edit, edit_body) = do_patch(
        &app,
        &format!("/api/v1/rooms/{room_id}/messages/{orig_msg_id}"),
        &token,
        Some(&client_id),
        &json!({ "ciphertext": edit_ct }),
    )
    .await;

    assert_eq!(status_edit, StatusCode::CREATED);
    let edit_id = edit_body["id"].as_str().unwrap().to_string();

    // Verify audit log entry edit.create
    let (action, target_type, target_id, metadata_str): (
        String,
        Option<String>,
        Option<String>,
        Option<String>,
    ) = sqlx::query_as(
        "SELECT action, target_type, target_id, metadata FROM audit_log WHERE action = 'edit.create'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(action, "edit.create");
    assert_eq!(target_type.as_deref(), Some("room_message"));
    assert_eq!(target_id.as_deref(), Some(edit_id.as_str()));

    let metadata: serde_json::Value = serde_json::from_str(&metadata_str.unwrap()).unwrap();
    assert_eq!(metadata["room_id"], room_id);
    assert_eq!(metadata["original_id"], orig_msg_id);
    assert_eq!(metadata["edit_sequence"], 1);

    // Verify Sockudo message.edited event payload shape
    let requests = mock_server.received_requests().await.unwrap();
    let edit_event_req = requests
        .iter()
        .find(|r| {
            let body_json: serde_json::Value = serde_json::from_slice(&r.body).unwrap_or_default();
            body_json["name"] == "message.edited"
        })
        .expect("message.edited event published");

    let event_env: serde_json::Value = serde_json::from_slice(&edit_event_req.body).unwrap();
    assert_eq!(event_env["channels"][0], format!("private-room-{room_id}"));
    let data: serde_json::Value =
        serde_json::from_str(event_env["data"].as_str().unwrap()).unwrap();

    assert_eq!(data["id"], edit_id);
    assert_eq!(data["edit_of"], orig_msg_id);
    assert_eq!(data["edit_sequence"], 1);
    assert_eq!(data["room_id"], room_id);
    assert_eq!(data["sender_type"], "user");
    assert_eq!(data["sender_id"], user_id);
    assert!(data["created_at"].is_string());

    // Assert absence of edit_id and original_id
    assert!(data["edit_id"].is_null());
    assert!(data["original_id"].is_null());

    // Assert event is not published on private-user-{user_id} channel
    let user_channel = format!("private-user-{user_id}");
    assert!(
        !event_env["channels"]
            .as_array()
            .unwrap()
            .iter()
            .any(|c| c == &user_channel),
        "message.edited must not be published on user channel"
    );
}
