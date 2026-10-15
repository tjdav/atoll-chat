use axum::http::{header, Request, StatusCode};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use serde_json::{json, Value};
use tower::ServiceExt;

mod common;

async fn create_test_room(pool: &sqlx::SqlitePool, owner_id: &str) -> String {
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

async fn add_user_to_room(pool: &sqlx::SqlitePool, room_id: &str, user_id: &str, role: &str) {
    sqlx::query("INSERT INTO room_members (room_id, user_id, role) VALUES (?, ?, ?)")
        .bind(room_id)
        .bind(user_id)
        .bind(role)
        .execute(pool)
        .await
        .unwrap();
}

fn sample_pubkey() -> String {
    URL_SAFE_NO_PAD.encode([7u8; 32])
}

async fn create_test_bot(app: &axum::Router, user_token: &str, name: &str) -> (String, String) {
    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/bots")
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(axum::body::Body::from(
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

#[allow(clippy::too_many_arguments)]
async fn seed_queue_entry(
    pool: &sqlx::SqlitePool,
    id: &str,
    bot_id: &str,
    room_id: &str,
    audience: &str,
    requester_user_id: &str,
    payload: &Value,
    preview: &str,
    status: &str,
    queued_at: &str,
) {
    let payload_str = serde_json::to_string(payload).unwrap();
    sqlx::query(
        r#"
        INSERT INTO bot_operator_queue (id, bot_id, room_id, audience, requester_user_id, payload, payload_preview, status, queued_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        "#,
    )
    .bind(id)
    .bind(bot_id)
    .bind(room_id)
    .bind(audience)
    .bind(requester_user_id)
    .bind(&payload_str)
    .bind(preview)
    .bind(status)
    .bind(queued_at)
    .execute(pool)
    .await
    .unwrap();
}

#[tokio::test]
async fn test_operator_queue_authorization_404() {
    let (app, pool) = common::setup_test_app().await;
    let (owner_token, owner_id) = common::create_test_user_and_session(&app, &pool).await;
    let (stranger_token, _stranger_id) = common::create_test_user_and_session(&app, &pool).await;

    let room_id = create_test_room(&pool, &owner_id).await;
    let (bot_id, _) = create_test_bot(&app, &owner_token, "Auth Bot").await;

    seed_queue_entry(
        &pool,
        "req_auth_1",
        &bot_id,
        &room_id,
        "private",
        &owner_id,
        &json!({"question": "Auth check?"}),
        "Auth check?",
        "pending",
        "2026-01-15T09:00:00.000Z",
    )
    .await;

    // 1. Stranger calls list -> 404
    let req_list = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/bots/{}/operator-queue", bot_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", stranger_token))
        .body(axum::body::Body::empty())
        .unwrap();
    let res_list = app.clone().oneshot(req_list).await.unwrap();
    assert_eq!(res_list.status(), StatusCode::NOT_FOUND);

    // 2. Stranger calls detail -> 404
    let req_detail = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/bots/{}/operator-queue/req_auth_1", bot_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", stranger_token))
        .body(axum::body::Body::empty())
        .unwrap();
    let res_detail = app.clone().oneshot(req_detail).await.unwrap();
    assert_eq!(res_detail.status(), StatusCode::NOT_FOUND);

    // 3. Stranger calls respond -> 404
    let req_respond = Request::builder()
        .method("POST")
        .uri(format!(
            "/api/v1/bots/{}/operator-queue/req_auth_1/respond",
            bot_id
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", stranger_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(axum::body::Body::from(
            json!({"response": "Unwanted"}).to_string(),
        ))
        .unwrap();
    let res_respond = app.clone().oneshot(req_respond).await.unwrap();
    assert_eq!(res_respond.status(), StatusCode::NOT_FOUND);

    // 4. Non-existent bot_id for owner -> 404
    let req_nobot = Request::builder()
        .method("GET")
        .uri("/api/v1/bots/b_non_existent/operator-queue")
        .header(header::AUTHORIZATION, format!("Bearer {}", owner_token))
        .body(axum::body::Body::empty())
        .unwrap();
    let res_nobot = app.clone().oneshot(req_nobot).await.unwrap();
    assert_eq!(res_nobot.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn test_operator_queue_list_and_filters() {
    let (app, pool) = common::setup_test_app().await;
    let (owner_token, owner_id) = common::create_test_user_and_session(&app, &pool).await;
    let (op_token, op_id) = common::create_test_user_and_session(&app, &pool).await;

    let room1 = create_test_room(&pool, &owner_id).await;
    let room2 = create_test_room(&pool, &owner_id).await;
    add_user_to_room(&pool, &room1, &op_id, "member").await;

    let (bot_id, bot_token) = create_test_bot(&app, &owner_token, "List Bot").await;

    // Grant bot in room1 with op_id as operator
    let req_grant = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/bots", room1))
        .header(header::AUTHORIZATION, format!("Bearer {}", owner_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(axum::body::Body::from(
            json!({
                "bot_id": bot_id,
                "scopes": ["post_message"],
                "operators": [op_id]
            })
            .to_string(),
        ))
        .unwrap();
    let res_grant = app.clone().oneshot(req_grant).await.unwrap();
    assert_eq!(res_grant.status(), StatusCode::CREATED);

    // Seed pending entries across room1 and room2
    seed_queue_entry(
        &pool,
        "req_p1",
        &bot_id,
        &room1,
        "private",
        &owner_id,
        &json!({"q": "1"}),
        "Q1",
        "pending",
        "2026-01-15T09:00:00.000Z",
    )
    .await;
    seed_queue_entry(
        &pool,
        "req_p2",
        &bot_id,
        &room2,
        "public",
        &owner_id,
        &json!({"q": "2"}),
        "Q2",
        "pending",
        "2026-01-15T10:00:00.000Z",
    )
    .await;
    seed_queue_entry(
        &pool,
        "req_p3",
        &bot_id,
        &room1,
        "private",
        &owner_id,
        &json!({"q": "3"}),
        "Q3",
        "pending",
        "2026-01-15T11:00:00.000Z",
    )
    .await;

    // Seed answered entry
    sqlx::query(
        r#"
        INSERT INTO bot_operator_queue (id, bot_id, room_id, audience, requester_user_id, payload, payload_preview, status, queued_at, answered_at, responded_by, response)
        VALUES ('req_a1', ?, ?, 'private', ?, '{}', 'QA1', 'answered', '2026-01-15T08:00:00.000Z', '2026-01-15T08:05:00.000Z', ?, 'Done')
        "#,
    )
    .bind(&bot_id)
    .bind(&room1)
    .bind(&owner_id)
    .bind(&owner_id)
    .execute(&pool)
    .await
    .unwrap();

    // 1. Owner lists pending (default status)
    let req_owner = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/bots/{}/operator-queue", bot_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", owner_token))
        .body(axum::body::Body::empty())
        .unwrap();
    let res_owner = app.clone().oneshot(req_owner).await.unwrap();
    assert_eq!(res_owner.status(), StatusCode::OK);
    assert_eq!(
        res_owner.headers().get("cache-control").unwrap(),
        "no-store"
    );

    let body_owner: Value = serde_json::from_slice(
        &axum::body::to_bytes(res_owner.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();

    let entries = body_owner["entries"].as_array().unwrap();
    assert_eq!(entries.len(), 3);
    // ORDER BY queued_at DESC, id ASC -> req_p3 (11:00), req_p2 (10:00), req_p1 (09:00)
    assert_eq!(entries[0]["request_id"], "req_p3");
    assert_eq!(entries[1]["request_id"], "req_p2");
    assert_eq!(entries[2]["request_id"], "req_p1");
    // Confirm payload field is absent from list response
    assert!(entries[0]["payload"].is_null());
    assert_eq!(entries[0]["payload_preview"], "Q3");

    // 2. Designated operator lists pending
    let req_op = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/bots/{}/operator-queue", bot_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", op_token))
        .body(axum::body::Body::empty())
        .unwrap();
    let res_op = app.clone().oneshot(req_op).await.unwrap();
    assert_eq!(res_op.status(), StatusCode::OK);

    // 3. Bot token lists pending
    let req_bot = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/bots/{}/operator-queue", bot_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", bot_token))
        .body(axum::body::Body::empty())
        .unwrap();
    let res_bot = app.clone().oneshot(req_bot).await.unwrap();
    assert_eq!(res_bot.status(), StatusCode::OK);

    // 4. room_id filter
    let req_room = Request::builder()
        .method("GET")
        .uri(format!(
            "/api/v1/bots/{}/operator-queue?room_id={}",
            bot_id, room1
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", owner_token))
        .body(axum::body::Body::empty())
        .unwrap();
    let res_room = app.clone().oneshot(req_room).await.unwrap();
    assert_eq!(res_room.status(), StatusCode::OK);
    let body_room: Value = serde_json::from_slice(
        &axum::body::to_bytes(res_room.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    let entries_room = body_room["entries"].as_array().unwrap();
    assert_eq!(entries_room.len(), 2);
    assert_eq!(entries_room[0]["request_id"], "req_p3");
    assert_eq!(entries_room[1]["request_id"], "req_p1");

    // 5. status=answered filter
    let req_ans = Request::builder()
        .method("GET")
        .uri(format!(
            "/api/v1/bots/{}/operator-queue?status=answered",
            bot_id
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", owner_token))
        .body(axum::body::Body::empty())
        .unwrap();
    let res_ans = app.clone().oneshot(req_ans).await.unwrap();
    assert_eq!(res_ans.status(), StatusCode::OK);
    let body_ans: Value = serde_json::from_slice(
        &axum::body::to_bytes(res_ans.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    let entries_ans = body_ans["entries"].as_array().unwrap();
    assert_eq!(entries_ans.len(), 1);
    assert_eq!(entries_ans[0]["request_id"], "req_a1");

    // 6. Invalid status -> 400
    let req_badstat = Request::builder()
        .method("GET")
        .uri(format!(
            "/api/v1/bots/{}/operator-queue?status=expired",
            bot_id
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", owner_token))
        .body(axum::body::Body::empty())
        .unwrap();
    let res_badstat = app.clone().oneshot(req_badstat).await.unwrap();
    assert_eq!(res_badstat.status(), StatusCode::BAD_REQUEST);

    // 7. Invalid cursor -> 400
    let req_badcur = Request::builder()
        .method("GET")
        .uri(format!(
            "/api/v1/bots/{}/operator-queue?before=invalid_base64!",
            bot_id
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", owner_token))
        .body(axum::body::Body::empty())
        .unwrap();
    let res_badcur = app.clone().oneshot(req_badcur).await.unwrap();
    assert_eq!(res_badcur.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn test_operator_queue_pagination_and_cursors() {
    let (app, pool) = common::setup_test_app().await;
    let (owner_token, owner_id) = common::create_test_user_and_session(&app, &pool).await;

    let room_id = create_test_room(&pool, &owner_id).await;
    let (bot_id, _) = create_test_bot(&app, &owner_token, "Cursor Bot").await;

    // Seed 5 pending entries
    for i in 1..=5 {
        let ts = format!("2026-01-15T09:0{}:00.000Z", i);
        seed_queue_entry(
            &pool,
            &format!("req_page_{}", i),
            &bot_id,
            &room_id,
            "private",
            &owner_id,
            &json!({"n": i}),
            &format!("P{}", i),
            "pending",
            &ts,
        )
        .await;
    }

    // Fetch page 1 with limit=2
    let req_p1 = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/bots/{}/operator-queue?limit=2", bot_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", owner_token))
        .body(axum::body::Body::empty())
        .unwrap();
    let res_p1 = app.clone().oneshot(req_p1).await.unwrap();
    assert_eq!(res_p1.status(), StatusCode::OK);

    let body_p1: Value = serde_json::from_slice(
        &axum::body::to_bytes(res_p1.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    let entries_p1 = body_p1["entries"].as_array().unwrap();
    assert_eq!(entries_p1.len(), 2);
    assert_eq!(entries_p1[0]["request_id"], "req_page_5");
    assert_eq!(entries_p1[1]["request_id"], "req_page_4");

    let next_cursor = body_p1["next_cursor"]
        .as_str()
        .expect("next_cursor string present");

    // Fetch page 2 using cursor with limit=2
    let req_p2 = Request::builder()
        .method("GET")
        .uri(format!(
            "/api/v1/bots/{}/operator-queue?limit=2&before={}",
            bot_id, next_cursor
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", owner_token))
        .body(axum::body::Body::empty())
        .unwrap();
    let res_p2 = app.clone().oneshot(req_p2).await.unwrap();
    assert_eq!(res_p2.status(), StatusCode::OK);

    let body_p2: Value = serde_json::from_slice(
        &axum::body::to_bytes(res_p2.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    let entries_p2 = body_p2["entries"].as_array().unwrap();
    assert_eq!(entries_p2.len(), 2);
    assert_eq!(entries_p2[0]["request_id"], "req_page_3");
    assert_eq!(entries_p2[1]["request_id"], "req_page_2");

    let next_cursor_2 = body_p2["next_cursor"]
        .as_str()
        .expect("next_cursor_2 present");

    // Fetch page 3 using cursor_2 with limit=2
    let req_p3 = Request::builder()
        .method("GET")
        .uri(format!(
            "/api/v1/bots/{}/operator-queue?limit=2&before={}",
            bot_id, next_cursor_2
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", owner_token))
        .body(axum::body::Body::empty())
        .unwrap();
    let res_p3 = app.clone().oneshot(req_p3).await.unwrap();
    assert_eq!(res_p3.status(), StatusCode::OK);

    let body_p3: Value = serde_json::from_slice(
        &axum::body::to_bytes(res_p3.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    let entries_p3 = body_p3["entries"].as_array().unwrap();
    assert_eq!(entries_p3.len(), 1);
    assert_eq!(entries_p3[0]["request_id"], "req_page_1");
    assert!(body_p3["next_cursor"].is_null());
}

#[tokio::test]
async fn test_operator_queue_detail_endpoint() {
    let (app, pool) = common::setup_test_app().await;
    let (owner_token, owner_id) = common::create_test_user_and_session(&app, &pool).await;

    let room_id = create_test_room(&pool, &owner_id).await;
    let (bot_id, _) = create_test_bot(&app, &owner_token, "Detail Bot").await;

    let payload = json!({"question": "What does the goblin do?", "context": "dungeon"});

    seed_queue_entry(
        &pool,
        "req_detail_1",
        &bot_id,
        &room_id,
        "private",
        &owner_id,
        &payload,
        "What does the goblin do?",
        "pending",
        "2026-01-15T09:00:00.000Z",
    )
    .await;

    // 1. Valid detail fetch
    let req = Request::builder()
        .method("GET")
        .uri(format!(
            "/api/v1/bots/{}/operator-queue/req_detail_1",
            bot_id
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", owner_token))
        .body(axum::body::Body::empty())
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    assert_eq!(res.headers().get("cache-control").unwrap(), "no-store");

    let body: Value = serde_json::from_slice(
        &axum::body::to_bytes(res.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();

    assert_eq!(body["request_id"], "req_detail_1");
    assert_eq!(body["room_id"], room_id);
    assert_eq!(body["audience"], "private");
    assert_eq!(body["requester_user_id"], owner_id);
    assert!(body["requester_display_name"].is_null());
    assert_eq!(body["payload"], payload);
    assert_eq!(body["payload_preview"], "What does the goblin do?");
    assert_eq!(body["status"], "pending");

    // 2. Non-existent request_id -> 404
    let req_missing = Request::builder()
        .method("GET")
        .uri(format!(
            "/api/v1/bots/{}/operator-queue/req_non_existent",
            bot_id
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", owner_token))
        .body(axum::body::Body::empty())
        .unwrap();
    let res_missing = app.clone().oneshot(req_missing).await.unwrap();
    assert_eq!(res_missing.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn test_operator_queue_respond_and_events() {
    let (app, pool) = common::setup_test_app().await;
    let (owner_token, owner_id) = common::create_test_user_and_session(&app, &pool).await;
    let (op_token, op_id) = common::create_test_user_and_session(&app, &pool).await;

    let room_id = create_test_room(&pool, &owner_id).await;
    add_user_to_room(&pool, &room_id, &op_id, "member").await;

    let (bot_id, _) = create_test_bot(&app, &owner_token, "Respond Bot").await;

    // Grant bot with operator
    let req_grant = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/bots", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", owner_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(axum::body::Body::from(
            json!({
                "bot_id": bot_id,
                "scopes": ["post_message"],
                "operators": [op_id]
            })
            .to_string(),
        ))
        .unwrap();
    let res_grant = app.clone().oneshot(req_grant).await.unwrap();
    assert_eq!(res_grant.status(), StatusCode::CREATED);

    // Seed pending entry
    seed_queue_entry(
        &pool,
        "req_resp_1",
        &bot_id,
        &room_id,
        "private",
        &owner_id,
        &json!({"question": "Action?"}),
        "Action?",
        "pending",
        "2026-01-15T09:00:00.000Z",
    )
    .await;

    // Seed expired entry
    seed_queue_entry(
        &pool,
        "req_exp_1",
        &bot_id,
        &room_id,
        "private",
        &owner_id,
        &json!({"question": "Expired?"}),
        "Expired?",
        "expired",
        "2026-01-15T08:00:00.000Z",
    )
    .await;

    // 1. Validation error: Present routing field -> 400 invalid_routing
    let req_routing = Request::builder()
        .method("POST")
        .uri(format!(
            "/api/v1/bots/{}/operator-queue/req_resp_1/respond",
            bot_id
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", op_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(axum::body::Body::from(
            json!({
                "response": "Answer",
                "routing": "private"
            })
            .to_string(),
        ))
        .unwrap();
    let res_routing = app.clone().oneshot(req_routing).await.unwrap();
    assert_eq!(res_routing.status(), StatusCode::BAD_REQUEST);

    // 2. Validation error: Empty response -> 400 invalid_response
    let req_empty = Request::builder()
        .method("POST")
        .uri(format!(
            "/api/v1/bots/{}/operator-queue/req_resp_1/respond",
            bot_id
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", op_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(axum::body::Body::from(
            json!({
                "response": "   "
            })
            .to_string(),
        ))
        .unwrap();
    let res_empty = app.clone().oneshot(req_empty).await.unwrap();
    assert_eq!(res_empty.status(), StatusCode::BAD_REQUEST);

    // 3. Validation error: Oversized response (>64 KiB) -> 400 invalid_response
    let huge_resp = "a".repeat(65537);
    let req_huge = Request::builder()
        .method("POST")
        .uri(format!(
            "/api/v1/bots/{}/operator-queue/req_resp_1/respond",
            bot_id
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", op_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(axum::body::Body::from(
            json!({
                "response": huge_resp
            })
            .to_string(),
        ))
        .unwrap();
    let res_huge = app.clone().oneshot(req_huge).await.unwrap();
    assert_eq!(res_huge.status(), StatusCode::BAD_REQUEST);

    // 4. Respond to expired entry -> 410 Gone
    let req_exp = Request::builder()
        .method("POST")
        .uri(format!(
            "/api/v1/bots/{}/operator-queue/req_exp_1/respond",
            bot_id
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", op_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(axum::body::Body::from(
            json!({
                "response": "Too late"
            })
            .to_string(),
        ))
        .unwrap();
    let res_exp = app.clone().oneshot(req_exp).await.unwrap();
    assert_eq!(res_exp.status(), StatusCode::GONE);

    // 5. Valid respond by designated operator -> 204 No Content
    let req_valid = Request::builder()
        .method("POST")
        .uri(format!(
            "/api/v1/bots/{}/operator-queue/req_resp_1/respond",
            bot_id
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", op_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(axum::body::Body::from(
            json!({
                "response": "The goblin narrows its eyes and steps back."
            })
            .to_string(),
        ))
        .unwrap();
    let res_valid = app.clone().oneshot(req_valid).await.unwrap();
    assert_eq!(res_valid.status(), StatusCode::NO_CONTENT);
    assert_eq!(
        res_valid.headers().get("cache-control").unwrap(),
        "no-store"
    );

    // Verify DB state
    let row: (String, String, String, String) = sqlx::query_as(
        "SELECT status, responded_by, response, routing FROM bot_operator_queue WHERE id = 'req_resp_1'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(row.0, "answered");
    assert_eq!(row.1, op_id);
    assert_eq!(row.2, "The goblin narrows its eyes and steps back.");
    assert_eq!(row.3, "private");

    // Verify bot_event_log entry created with bot_seq
    let log_row: (i64, String, String) = sqlx::query_as(
        "SELECT bot_seq, event_type, payload FROM bot_event_log WHERE bot_id = ? ORDER BY bot_seq DESC LIMIT 1",
    )
    .bind(&bot_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(log_row.0, 1);
    assert_eq!(log_row.1, "bot.operator_response");
    let event_payload: Value = serde_json::from_str(&log_row.2).unwrap();
    assert_eq!(event_payload["request_id"], "req_resp_1");
    assert_eq!(
        event_payload["response"],
        "The goblin narrows its eyes and steps back."
    );
    assert_eq!(event_payload["routing"], "private");
    assert_eq!(event_payload["room_id"], room_id);
    assert_eq!(event_payload["responded_by"], op_id);
    assert_eq!(event_payload["bot_seq"], 1);

    // 6. Repeat respond on already answered entry -> 409 Conflict
    let req_repeat = Request::builder()
        .method("POST")
        .uri(format!(
            "/api/v1/bots/{}/operator-queue/req_resp_1/respond",
            bot_id
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", owner_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(axum::body::Body::from(
            json!({
                "response": "Another response"
            })
            .to_string(),
        ))
        .unwrap();
    let res_repeat = app.clone().oneshot(req_repeat).await.unwrap();
    assert_eq!(res_repeat.status(), StatusCode::CONFLICT);
}
