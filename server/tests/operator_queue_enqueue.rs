use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use axum::Router;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use serde_json::{json, Value};
use sqlx::SqlitePool;
use tower::ServiceExt;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

mod common;

fn sample_pubkey() -> String {
    URL_SAFE_NO_PAD.encode([7u8; 32])
}

async fn setup_test_app_with_sockudo_mock() -> (Router, SqlitePool, MockServer) {
    let mock_server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/apps/chat/events"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"ok": true})))
        .mount(&mock_server)
        .await;

    let (app, pool, _) = common::setup_test_app_with_custom_config(|cfg| {
        cfg.websocket_url = mock_server.uri();
        cfg.pusher_app_key = "test-app-key".to_string();
        cfg.pusher_app_secret = "test-app-secret".to_string();
        cfg.rate_limits.rate_operator_queue_enqueue_per_min = 60;
    })
    .await;

    (app, pool, mock_server)
}

async fn create_test_room(pool: &SqlitePool, owner_id: &str) -> String {
    let room_id = format!("r_{}", ulid::Ulid::new());
    sqlx::query("INSERT INTO rooms (id, owner_id) VALUES (?, ?)")
        .bind(&room_id)
        .bind(owner_id)
        .execute(pool)
        .await
        .unwrap();

    sqlx::query("INSERT INTO room_members (room_id, user_id, role) VALUES (?, ?, 'owner')")
        .bind(&room_id)
        .bind(owner_id)
        .execute(pool)
        .await
        .unwrap();

    room_id
}

async fn add_user_to_room(pool: &SqlitePool, room_id: &str, user_id: &str, role: &str) {
    sqlx::query("INSERT INTO room_members (room_id, user_id, role) VALUES (?, ?, ?)")
        .bind(room_id)
        .bind(user_id)
        .bind(role)
        .execute(pool)
        .await
        .unwrap();
}

async fn create_test_bot(app: &Router, user_token: &str, name: &str) -> (String, String) {
    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/bots")
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "display_name": name,
                "bot_identity_pubkey": sample_pubkey(),
                "bot_command_pubkey": sample_pubkey(),
                "identity_pubkey": sample_pubkey(),
                "declared_scopes": ["post_message", "read_commands"]
            })
            .to_string(),
        ))
        .unwrap();

    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::CREATED);
    let bytes = axum::body::to_bytes(res.into_body(), usize::MAX)
        .await
        .unwrap();
    let data: Value = serde_json::from_slice(&bytes).unwrap();
    (
        data["bot_id"].as_str().unwrap().to_string(),
        data["bot_token"].as_str().unwrap().to_string(),
    )
}

async fn grant_bot(
    app: &Router,
    user_token: &str,
    room_id: &str,
    bot_id: &str,
    scopes: &[&str],
    operators: Option<&[&str]>,
) {
    let mut payload = json!({
        "bot_id": bot_id,
        "scopes": scopes
    });
    if let Some(ops) = operators {
        payload["operators"] = json!(ops);
    }

    let req = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/bots", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(payload.to_string()))
        .unwrap();

    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::CREATED);
}

#[tokio::test]
async fn test_enqueue_happy_path_private() {
    let (app, pool, mock_server) = setup_test_app_with_sockudo_mock().await;
    let (owner_token, owner_id) = common::create_test_user_and_session(&app, &pool).await;
    let (_op1_token, op1_id) = common::create_test_user_and_session(&app, &pool).await;

    let room_id = create_test_room(&pool, &owner_id).await;
    add_user_to_room(&pool, &room_id, &op1_id, "member").await;

    let (bot_id, bot_token) = create_test_bot(&app, &owner_token, "QueueBot1").await;
    grant_bot(
        &app,
        &owner_token,
        &room_id,
        &bot_id,
        &["read_commands"],
        Some(&[&op1_id]),
    )
    .await;

    // Enqueue request
    let enqueue_req = Request::builder()
        .method("POST")
        .uri("/api/v1/bots/me/operator-queue")
        .header(header::AUTHORIZATION, format!("Bearer {}", bot_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "request_id": "req_happy_1",
                "room_id": room_id,
                "audience": "private",
                "payload": { "question": "What does the goblin do?" },
                "timeout": "never",
                "on_timeout": "ignore"
            })
            .to_string(),
        ))
        .unwrap();

    let res = app.clone().oneshot(enqueue_req).await.unwrap();
    assert_eq!(res.status(), StatusCode::CREATED);
    assert_eq!(res.headers().get("cache-control").unwrap(), "no-store");

    let bytes = axum::body::to_bytes(res.into_body(), usize::MAX)
        .await
        .unwrap();
    let body: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(body["request_id"], "req_happy_1");
    assert!(body["queued_at"].is_string());

    // Assert DB row
    let row = sqlx::query(
        "SELECT id, bot_id, room_id, audience, payload, payload_preview, status, timeout_at, on_timeout FROM bot_operator_queue WHERE id = 'req_happy_1'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();

    let status: String = sqlx::Row::get(&row, "status");
    let payload: String = sqlx::Row::get(&row, "payload");
    let preview: String = sqlx::Row::get(&row, "payload_preview");
    let timeout_at: Option<String> = sqlx::Row::get(&row, "timeout_at");
    let on_timeout: String = sqlx::Row::get(&row, "on_timeout");

    assert_eq!(status, "pending");
    assert_eq!(payload, "{\"question\":\"What does the goblin do?\"}");
    assert_eq!(preview, "What does the goblin do?");
    assert!(timeout_at.is_none());
    assert_eq!(on_timeout, "ignore");

    // Assert user channel event published to both operators (owner self-bound + op1)
    let requests = mock_server.received_requests().await.unwrap();
    let queue_updated_events: Vec<&wiremock::Request> = requests
        .iter()
        .filter(|r| {
            let body: Value = serde_json::from_slice(&r.body).unwrap();
            body["name"] == "operator.queue.updated"
        })
        .collect();

    assert_eq!(queue_updated_events.len(), 2);
    let channels: Vec<String> = queue_updated_events
        .iter()
        .map(|r| {
            let body: Value = serde_json::from_slice(&r.body).unwrap();
            body["channels"][0].as_str().unwrap().to_string()
        })
        .collect();

    assert!(channels.contains(&format!("private-user-{}", owner_id)));
    assert!(channels.contains(&format!("private-user-{}", op1_id)));

    let sample_body: Value = serde_json::from_slice(&queue_updated_events[0].body).unwrap();
    let data_str = sample_body["data"].as_str().unwrap();
    let payload_val: Value = serde_json::from_str(data_str).unwrap();
    assert_eq!(payload_val["bot_id"], bot_id);
    assert_eq!(payload_val["request_id"], "req_happy_1");
    assert_eq!(payload_val["room_id"], room_id);
}

#[tokio::test]
async fn test_enqueue_happy_path_numeric_timeout_and_canned_response() {
    let (app, pool, _) = setup_test_app_with_sockudo_mock().await;
    let (owner_token, owner_id) = common::create_test_user_and_session(&app, &pool).await;
    let room_id = create_test_room(&pool, &owner_id).await;

    let (bot_id, bot_token) = create_test_bot(&app, &owner_token, "QueueBot2").await;
    grant_bot(
        &app,
        &owner_token,
        &room_id,
        &bot_id,
        &["read_commands"],
        None,
    )
    .await;

    let enqueue_req = Request::builder()
        .method("POST")
        .uri("/api/v1/bots/me/operator-queue")
        .header(header::AUTHORIZATION, format!("Bearer {}", bot_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "request_id": "req_timeout_1",
                "room_id": room_id,
                "audience": "private",
                "payload": { "preview": "Short prompt" },
                "timeout": "300",
                "on_timeout": "canned",
                "canned_response": "Sorry, operator was away."
            })
            .to_string(),
        ))
        .unwrap();

    let res = app.clone().oneshot(enqueue_req).await.unwrap();
    assert_eq!(res.status(), StatusCode::CREATED);

    let row = sqlx::query(
        "SELECT timeout_at, on_timeout, canned_response FROM bot_operator_queue WHERE id = 'req_timeout_1'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();

    let timeout_at: Option<String> = sqlx::Row::get(&row, "timeout_at");
    let on_timeout: String = sqlx::Row::get(&row, "on_timeout");
    let canned_response: Option<String> = sqlx::Row::get(&row, "canned_response");

    assert!(timeout_at.is_some());
    assert_eq!(on_timeout, "canned");
    assert_eq!(
        canned_response.as_deref(),
        Some("Sorry, operator was away.")
    );
}

#[tokio::test]
async fn test_enqueue_retry_semantics() {
    let (app, pool, _) = setup_test_app_with_sockudo_mock().await;
    let (owner_token, owner_id) = common::create_test_user_and_session(&app, &pool).await;
    let room_id = create_test_room(&pool, &owner_id).await;

    let (bot_id, bot_token) = create_test_bot(&app, &owner_token, "QueueBotRetry").await;
    grant_bot(
        &app,
        &owner_token,
        &room_id,
        &bot_id,
        &["read_commands"],
        None,
    )
    .await;

    // 1. Initial Enqueue -> 201 Created
    let req1 = Request::builder()
        .method("POST")
        .uri("/api/v1/bots/me/operator-queue")
        .header(header::AUTHORIZATION, format!("Bearer {}", bot_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "request_id": "req_retry_1",
                "room_id": room_id,
                "audience": "private",
                "payload": { "message": "First attempt" },
                "timeout": "never",
                "on_timeout": "ignore"
            })
            .to_string(),
        ))
        .unwrap();

    let res1 = app.clone().oneshot(req1).await.unwrap();
    assert_eq!(res1.status(), StatusCode::CREATED);
    let bytes1 = axum::body::to_bytes(res1.into_body(), usize::MAX)
        .await
        .unwrap();
    let body1: Value = serde_json::from_slice(&bytes1).unwrap();
    let queued_at_1 = body1["queued_at"].as_str().unwrap();

    // 2. Repeat Enqueue while pending -> 200 OK (retry path), same queued_at
    let req2 = Request::builder()
        .method("POST")
        .uri("/api/v1/bots/me/operator-queue")
        .header(header::AUTHORIZATION, format!("Bearer {}", bot_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "request_id": "req_retry_1",
                "room_id": room_id,
                "audience": "private",
                "payload": { "message": "Duplicate network retry" },
                "timeout": "never",
                "on_timeout": "ignore"
            })
            .to_string(),
        ))
        .unwrap();

    let res2 = app.clone().oneshot(req2).await.unwrap();
    assert_eq!(res2.status(), StatusCode::OK);
    let bytes2 = axum::body::to_bytes(res2.into_body(), usize::MAX)
        .await
        .unwrap();
    let body2: Value = serde_json::from_slice(&bytes2).unwrap();
    assert_eq!(body2["queued_at"].as_str().unwrap(), queued_at_1);

    // Verify only 1 row exists in DB
    let count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM bot_operator_queue WHERE id = 'req_retry_1'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(count, 1);

    // 3. Respond to entry so status becomes 'answered'
    let respond_req = Request::builder()
        .method("POST")
        .uri(format!(
            "/api/v1/bots/{}/operator-queue/req_retry_1/respond",
            bot_id
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", owner_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({ "response": "Operator answered" }).to_string(),
        ))
        .unwrap();

    let respond_res = app.clone().oneshot(respond_req).await.unwrap();
    assert_eq!(respond_res.status(), StatusCode::NO_CONTENT);

    // 4. Repeat Enqueue after answered -> 409 Conflict duplicate_request_id
    let req3 = Request::builder()
        .method("POST")
        .uri("/api/v1/bots/me/operator-queue")
        .header(header::AUTHORIZATION, format!("Bearer {}", bot_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "request_id": "req_retry_1",
                "room_id": room_id,
                "audience": "private",
                "payload": { "message": "Late retry" },
                "timeout": "never",
                "on_timeout": "ignore"
            })
            .to_string(),
        ))
        .unwrap();

    let res3 = app.clone().oneshot(req3).await.unwrap();
    assert_eq!(res3.status(), StatusCode::CONFLICT);
    let bytes3 = axum::body::to_bytes(res3.into_body(), usize::MAX)
        .await
        .unwrap();
    let body3: Value = serde_json::from_slice(&bytes3).unwrap();
    assert_eq!(body3["error"], "duplicate_request_id");

    // 5. Seed expired entry and repeat enqueue -> 409 Conflict duplicate_request_id
    sqlx::query(
        "INSERT INTO bot_operator_queue (id, bot_id, room_id, audience, payload, payload_preview, status) VALUES ('req_expired', ?, ?, 'private', '{}', 'p', 'expired')",
    )
    .bind(&bot_id)
    .bind(&room_id)
    .execute(&pool)
    .await
    .unwrap();

    let req_exp = Request::builder()
        .method("POST")
        .uri("/api/v1/bots/me/operator-queue")
        .header(header::AUTHORIZATION, format!("Bearer {}", bot_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "request_id": "req_expired",
                "room_id": room_id,
                "audience": "private",
                "payload": { "message": "Retry expired" },
                "timeout": "never",
                "on_timeout": "ignore"
            })
            .to_string(),
        ))
        .unwrap();

    let res_exp = app.clone().oneshot(req_exp).await.unwrap();
    assert_eq!(res_exp.status(), StatusCode::CONFLICT);
}

#[tokio::test]
async fn test_enqueue_auth_and_scope_authorization() {
    let (app, pool, _) = setup_test_app_with_sockudo_mock().await;
    let (owner_token, owner_id) = common::create_test_user_and_session(&app, &pool).await;
    let room_id = create_test_room(&pool, &owner_id).await;

    let (bot_id, bot_token) = create_test_bot(&app, &owner_token, "QueueBotAuth").await;

    // 1. User session token -> 401 Unauthorized
    let req_user = Request::builder()
        .method("POST")
        .uri("/api/v1/bots/me/operator-queue")
        .header(header::AUTHORIZATION, format!("Bearer {}", owner_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "request_id": "req_unauth_1",
                "room_id": room_id,
                "audience": "private",
                "payload": {},
                "timeout": "never",
                "on_timeout": "ignore"
            })
            .to_string(),
        ))
        .unwrap();

    let res_user = app.clone().oneshot(req_user).await.unwrap();
    assert_eq!(res_user.status(), StatusCode::UNAUTHORIZED);

    // 2. Bot token without active grant in room_id -> 403 Forbidden bot_not_granted
    let req_no_grant = Request::builder()
        .method("POST")
        .uri("/api/v1/bots/me/operator-queue")
        .header(header::AUTHORIZATION, format!("Bearer {}", bot_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "request_id": "req_no_grant",
                "room_id": room_id,
                "audience": "private",
                "payload": {},
                "timeout": "never",
                "on_timeout": "ignore"
            })
            .to_string(),
        ))
        .unwrap();

    let res_no_grant = app.clone().oneshot(req_no_grant).await.unwrap();
    assert_eq!(res_no_grant.status(), StatusCode::FORBIDDEN);
    let bytes = axum::body::to_bytes(res_no_grant.into_body(), usize::MAX)
        .await
        .unwrap();
    let body: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(body["error"], "bot_not_granted");

    // 3. Grant bot with read_commands ONLY (lacks post_message)
    grant_bot(
        &app,
        &owner_token,
        &room_id,
        &bot_id,
        &["read_commands"],
        None,
    )
    .await;

    // Audience 'private' succeeds with read_commands
    let req_priv = Request::builder()
        .method("POST")
        .uri("/api/v1/bots/me/operator-queue")
        .header(header::AUTHORIZATION, format!("Bearer {}", bot_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "request_id": "req_priv_ok",
                "room_id": room_id,
                "audience": "private",
                "payload": {},
                "timeout": "never",
                "on_timeout": "ignore"
            })
            .to_string(),
        ))
        .unwrap();

    let res_priv = app.clone().oneshot(req_priv).await.unwrap();
    assert_eq!(res_priv.status(), StatusCode::CREATED);

    // Audience 'public' fails with scope_missing when post_message is absent
    let req_pub_fail = Request::builder()
        .method("POST")
        .uri("/api/v1/bots/me/operator-queue")
        .header(header::AUTHORIZATION, format!("Bearer {}", bot_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "request_id": "req_pub_fail",
                "room_id": room_id,
                "audience": "public",
                "payload": {},
                "timeout": "never",
                "on_timeout": "ignore"
            })
            .to_string(),
        ))
        .unwrap();

    let res_pub_fail = app.clone().oneshot(req_pub_fail).await.unwrap();
    assert_eq!(res_pub_fail.status(), StatusCode::FORBIDDEN);
    let bytes_pub = axum::body::to_bytes(res_pub_fail.into_body(), usize::MAX)
        .await
        .unwrap();
    let body_pub: Value = serde_json::from_slice(&bytes_pub).unwrap();
    assert_eq!(body_pub["error"], "scope_missing");

    // Re-grant with post_message included
    sqlx::query(
        "INSERT INTO room_bot_scopes (room_id, bot_id, scope) VALUES (?, ?, 'post_message')",
    )
    .bind(&room_id)
    .bind(&bot_id)
    .execute(&pool)
    .await
    .unwrap();

    // Now audience 'public' succeeds
    let req_pub_ok = Request::builder()
        .method("POST")
        .uri("/api/v1/bots/me/operator-queue")
        .header(header::AUTHORIZATION, format!("Bearer {}", bot_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "request_id": "req_pub_ok",
                "room_id": room_id,
                "audience": "public",
                "payload": {},
                "timeout": "never",
                "on_timeout": "ignore"
            })
            .to_string(),
        ))
        .unwrap();

    let res_pub_ok = app.clone().oneshot(req_pub_ok).await.unwrap();
    assert_eq!(res_pub_ok.status(), StatusCode::CREATED);
}

#[tokio::test]
async fn test_enqueue_request_validation() {
    let (app, pool, _) = setup_test_app_with_sockudo_mock().await;
    let (owner_token, owner_id) = common::create_test_user_and_session(&app, &pool).await;
    let room_id = create_test_room(&pool, &owner_id).await;

    let (bot_id, bot_token) = create_test_bot(&app, &owner_token, "QueueBotVal").await;
    grant_bot(
        &app,
        &owner_token,
        &room_id,
        &bot_id,
        &["read_commands"],
        None,
    )
    .await;

    // Helper macro for sending validation requests
    let send_req = |body: Value| {
        let app_clone = app.clone();
        let token_clone = bot_token.clone();
        async move {
            let req = Request::builder()
                .method("POST")
                .uri("/api/v1/bots/me/operator-queue")
                .header(header::AUTHORIZATION, format!("Bearer {}", token_clone))
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(body.to_string()))
                .unwrap();

            let res = app_clone.oneshot(req).await.unwrap();
            let status = res.status();
            let bytes = axum::body::to_bytes(res.into_body(), usize::MAX)
                .await
                .unwrap();
            let err_body: Value = serde_json::from_slice(&bytes).unwrap_or(json!({}));
            (status, err_body["error"].as_str().unwrap_or("").to_string())
        }
    };

    // 1. Invalid request_id (empty)
    let (s, e) = send_req(json!({
        "request_id": "", "room_id": room_id, "audience": "private", "payload": {}, "timeout": "never", "on_timeout": "ignore"
    })).await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    assert_eq!(e, "invalid_request_id");

    // 2. Invalid request_id (> 128 chars)
    let long_req_id = "a".repeat(129);
    let (s, e) = send_req(json!({
        "request_id": long_req_id, "room_id": room_id, "audience": "private", "payload": {}, "timeout": "never", "on_timeout": "ignore"
    })).await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    assert_eq!(e, "invalid_request_id");

    // 3. Invalid timeout ("0", "-5", "abc")
    for bad_t in &["0", "-5", "abc"] {
        let (s, e) = send_req(json!({
            "request_id": "req_val_1", "room_id": room_id, "audience": "private", "payload": {}, "timeout": bad_t, "on_timeout": "ignore"
        })).await;
        assert_eq!(s, StatusCode::BAD_REQUEST);
        assert_eq!(e, "invalid_timeout");
    }

    // 4. on_timeout = "canned" without canned_response
    let (s, e) = send_req(json!({
        "request_id": "req_val_2", "room_id": room_id, "audience": "private", "payload": {}, "timeout": "never", "on_timeout": "canned"
    })).await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    assert_eq!(e, "invalid_canned_response");

    // 5. on_timeout = "ignore" with present canned_response
    let (s, e) = send_req(json!({
        "request_id": "req_val_3", "room_id": room_id, "audience": "private", "payload": {}, "timeout": "never", "on_timeout": "ignore", "canned_response": "Unexpected"
    })).await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    assert_eq!(e, "unexpected_canned_response");

    // 6. Missing room_id
    let (s, e) = send_req(json!({
        "request_id": "req_val_4", "room_id": "", "audience": "private", "payload": {}, "timeout": "never", "on_timeout": "ignore"
    })).await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    assert_eq!(e, "invalid_room_id");
}

#[tokio::test]
async fn test_payload_preview_derivation_rules() {
    let (app, pool, _) = setup_test_app_with_sockudo_mock().await;
    let (owner_token, owner_id) = common::create_test_user_and_session(&app, &pool).await;
    let room_id = create_test_room(&pool, &owner_id).await;

    let (bot_id, bot_token) = create_test_bot(&app, &owner_token, "QueueBotPrev").await;
    grant_bot(
        &app,
        &owner_token,
        &room_id,
        &bot_id,
        &["read_commands"],
        None,
    )
    .await;

    let long_preview = format!("{}...", "a".repeat(120));
    let test_cases = vec![
        (json!("Direct string payload"), "Direct string payload"),
        (json!({"preview": "P text", "message": "M text"}), "P text"),
        (json!({"message": "M text", "question": "Q text"}), "M text"),
        (json!({"question": "Q text"}), "Q text"),
        (json!({"unsupported": 123}), "[request]"),
        (json!({ "preview": "a".repeat(130) }), long_preview.as_str()),
    ];

    for (idx, (payload, expected_preview)) in test_cases.into_iter().enumerate() {
        let req_id = format!("req_prev_{}", idx);
        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/bots/me/operator-queue")
            .header(header::AUTHORIZATION, format!("Bearer {}", bot_token))
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(
                json!({
                    "request_id": req_id,
                    "room_id": room_id,
                    "audience": "private",
                    "payload": payload,
                    "timeout": "never",
                    "on_timeout": "ignore"
                })
                .to_string(),
            ))
            .unwrap();

        let res = app.clone().oneshot(req).await.unwrap();
        assert_eq!(res.status(), StatusCode::CREATED);

        let row = sqlx::query("SELECT payload_preview FROM bot_operator_queue WHERE id = ?")
            .bind(&req_id)
            .fetch_one(&pool)
            .await
            .unwrap();

        let preview: String = sqlx::Row::get(&row, "payload_preview");
        assert_eq!(preview, expected_preview, "Failed on index {}", idx);
    }
}

#[tokio::test]
async fn test_respond_user_channel_notification() {
    let (app, pool, mock_server) = setup_test_app_with_sockudo_mock().await;
    let (owner_token, owner_id) = common::create_test_user_and_session(&app, &pool).await;
    let room_id = create_test_room(&pool, &owner_id).await;

    let (bot_id, bot_token) = create_test_bot(&app, &owner_token, "QueueBotResp").await;
    grant_bot(
        &app,
        &owner_token,
        &room_id,
        &bot_id,
        &["read_commands"],
        None,
    )
    .await;

    // Enqueue entry
    let enqueue_req = Request::builder()
        .method("POST")
        .uri("/api/v1/bots/me/operator-queue")
        .header(header::AUTHORIZATION, format!("Bearer {}", bot_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "request_id": "req_acked_1",
                "room_id": room_id,
                "audience": "private",
                "payload": { "question": "What is the answer?" },
                "timeout": "never",
                "on_timeout": "ignore"
            })
            .to_string(),
        ))
        .unwrap();

    let enq_res = app.clone().oneshot(enqueue_req).await.unwrap();
    assert_eq!(enq_res.status(), StatusCode::CREATED);

    // Respond to entry
    let respond_req = Request::builder()
        .method("POST")
        .uri(format!(
            "/api/v1/bots/{}/operator-queue/req_acked_1/respond",
            bot_id
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", owner_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({ "response": "The answer is 42." }).to_string(),
        ))
        .unwrap();

    let resp_res = app.clone().oneshot(respond_req).await.unwrap();
    assert_eq!(resp_res.status(), StatusCode::NO_CONTENT);

    // Verify WireMock event publication order and payload
    let requests = mock_server.received_requests().await.unwrap();

    let bot_resp_events: Vec<&wiremock::Request> = requests
        .iter()
        .filter(|r| {
            let body: Value = serde_json::from_slice(&r.body).unwrap();
            body["name"] == "bot.operator_response"
        })
        .collect();

    let acked_events: Vec<&wiremock::Request> = requests
        .iter()
        .filter(|r| {
            let body: Value = serde_json::from_slice(&r.body).unwrap();
            body["name"] == "operator.response.acked"
        })
        .collect();

    assert_eq!(bot_resp_events.len(), 1);
    assert_eq!(acked_events.len(), 1);

    // Verify bot.operator_response channel
    let bot_event_body: Value = serde_json::from_slice(&bot_resp_events[0].body).unwrap();
    assert_eq!(
        bot_event_body["channels"][0],
        format!("private-bot-{}", bot_id)
    );

    // Verify operator.response.acked channel and payload
    let acked_body: Value = serde_json::from_slice(&acked_events[0].body).unwrap();
    assert_eq!(
        acked_body["channels"][0],
        format!("private-user-{}", owner_id)
    );

    let acked_data_str = acked_body["data"].as_str().unwrap();
    let acked_data: Value = serde_json::from_str(acked_data_str).unwrap();
    assert_eq!(acked_data["bot_id"], bot_id);
    assert_eq!(acked_data["request_id"], "req_acked_1");
    assert!(acked_data["answered_at"].is_string());
}

#[tokio::test]
async fn test_enqueue_rate_limiting() {
    let (app, pool, _) = setup_test_app_with_sockudo_mock().await;
    let (owner_token, owner_id) = common::create_test_user_and_session(&app, &pool).await;
    let room_id = create_test_room(&pool, &owner_id).await;

    let (bot_id, bot_token) = create_test_bot(&app, &owner_token, "QueueBotRate1").await;
    grant_bot(
        &app,
        &owner_token,
        &room_id,
        &bot_id,
        &["read_commands"],
        None,
    )
    .await;

    let (bot2_id, bot2_token) = create_test_bot(&app, &owner_token, "QueueBotRate2").await;
    grant_bot(
        &app,
        &owner_token,
        &room_id,
        &bot2_id,
        &["read_commands"],
        None,
    )
    .await;

    // Send 60 requests -> all 201 Created
    for i in 0..60 {
        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/bots/me/operator-queue")
            .header(header::AUTHORIZATION, format!("Bearer {}", bot_token))
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(
                json!({
                    "request_id": format!("req_rate_{}", i),
                    "room_id": room_id,
                    "audience": "private",
                    "payload": {},
                    "timeout": "never",
                    "on_timeout": "ignore"
                })
                .to_string(),
            ))
            .unwrap();

        let res = app.clone().oneshot(req).await.unwrap();
        assert_eq!(res.status(), StatusCode::CREATED);
    }

    // 61st request from bot 1 -> 429 Too Many Requests
    let req_breach = Request::builder()
        .method("POST")
        .uri("/api/v1/bots/me/operator-queue")
        .header(header::AUTHORIZATION, format!("Bearer {}", bot_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "request_id": "req_rate_breach",
                "room_id": room_id,
                "audience": "private",
                "payload": {},
                "timeout": "never",
                "on_timeout": "ignore"
            })
            .to_string(),
        ))
        .unwrap();

    let res_breach = app.clone().oneshot(req_breach).await.unwrap();
    assert_eq!(res_breach.status(), StatusCode::TOO_MANY_REQUESTS);
    assert!(res_breach.headers().get("retry-after").is_some());

    // Bot 2 is unblocked
    let req_bot2 = Request::builder()
        .method("POST")
        .uri("/api/v1/bots/me/operator-queue")
        .header(header::AUTHORIZATION, format!("Bearer {}", bot2_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "request_id": "req_bot2_ok",
                "room_id": room_id,
                "audience": "private",
                "payload": {},
                "timeout": "never",
                "on_timeout": "ignore"
            })
            .to_string(),
        ))
        .unwrap();

    let res_bot2 = app.clone().oneshot(req_bot2).await.unwrap();
    assert_eq!(res_bot2.status(), StatusCode::CREATED);
}
