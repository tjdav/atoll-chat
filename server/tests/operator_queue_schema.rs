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

#[tokio::test]
async fn test_schema_tables_indexes_and_checks() {
    let pool = common::setup_test_db().await;

    // Direct inserts testing CHECK constraints
    // 1. Invalid binding in bot_operators
    let err = sqlx::query(
        "INSERT INTO bot_operators (bot_id, user_id, binding) VALUES ('b_1', 'u_1', 'invalid')",
    )
    .execute(&pool)
    .await;
    assert!(err.is_err(), "Expected CHECK failure for invalid binding");

    // 2. Invalid status in bot_operator_queue
    let err = sqlx::query(
        "INSERT INTO bot_operator_queue (id, bot_id, audience, payload, payload_preview, status) VALUES ('q_1', 'b_1', 'private', '{}', 'preview', 'invalid')",
    )
    .execute(&pool)
    .await;
    assert!(err.is_err(), "Expected CHECK failure for invalid status");

    // 3. Valid inserts & CASCADE deletion test
    sqlx::query("INSERT INTO users (id, username_token, opaque_registration, identity_pubkey) VALUES ('u_owner', 'tok_owner', X'00', 'pk_owner')")
        .execute(&pool)
        .await
        .unwrap();

    sqlx::query("INSERT INTO bot_accounts (id, display_name, bot_identity_pubkey, bot_command_pubkey, identity_pubkey, owner_user_id) VALUES ('b_cascade', 'Cascade Bot', 'pk1', 'pk2', 'pk3', 'u_owner')")
        .execute(&pool)
        .await
        .unwrap();

    sqlx::query("INSERT INTO bot_operators (bot_id, user_id, bound_by, binding) VALUES ('b_cascade', 'u_owner', 'u_owner', 'self')")
        .execute(&pool)
        .await
        .unwrap();

    sqlx::query("INSERT INTO bot_operator_queue (id, bot_id, audience, payload, payload_preview) VALUES ('q_cascade', 'b_cascade', 'private', '{}', '[request]')")
        .execute(&pool)
        .await
        .unwrap();

    let op_cnt: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM bot_operators WHERE bot_id = 'b_cascade'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(op_cnt, 1);

    let q_cnt: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM bot_operator_queue WHERE bot_id = 'b_cascade'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(q_cnt, 1);

    // Delete bot directly to trigger SQLite ON DELETE CASCADE
    sqlx::query("DELETE FROM bot_accounts WHERE id = 'b_cascade'")
        .execute(&pool)
        .await
        .unwrap();

    let op_cnt_after: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM bot_operators WHERE bot_id = 'b_cascade'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(op_cnt_after, 0);

    let q_cnt_after: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM bot_operator_queue WHERE bot_id = 'b_cascade'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(q_cnt_after, 0);
}

#[tokio::test]
async fn test_bot_creation_self_binding() {
    let (app, pool) = common::setup_test_app().await;
    let (token, user_id) = common::create_test_user_and_session(&app, &pool).await;

    let (bot_id, _) = create_test_bot(&app, &token, "Self Bound Bot").await;

    // Verify self binding row in DB
    let row = sqlx::query_as::<_, (String, String, String)>(
        "SELECT user_id, bound_by, binding FROM bot_operators WHERE bot_id = ?",
    )
    .bind(&bot_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(row.0, user_id);
    assert_eq!(row.1, user_id);
    assert_eq!(row.2, "self");

    // Verify audit log
    let audit_row = sqlx::query_as::<_, (String, String)>(
        "SELECT action, metadata FROM audit_log WHERE action = 'bot.operator.bound' AND target_id = ?",
    )
    .bind(&bot_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(audit_row.0, "bot.operator.bound");
    let meta: Value = serde_json::from_str(&audit_row.1).unwrap();
    assert_eq!(meta["bot_id"], bot_id);
    assert_eq!(meta["user_id"], user_id);
    assert_eq!(meta["binding"], "self");
    assert!(meta["room_id"].is_null());

    // Verify GET /bots/:id returns owner in operators array
    let req = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/bots/{}", bot_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .body(axum::body::Body::empty())
        .unwrap();

    let res = app.oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let bytes = axum::body::to_bytes(res.into_body(), usize::MAX)
        .await
        .unwrap();
    let body: Value = serde_json::from_slice(&bytes).unwrap();

    let ops = body["operators"]
        .as_array()
        .expect("operators array present");
    assert_eq!(ops.len(), 1);
    assert_eq!(ops[0]["user_id"], user_id);
    assert_eq!(ops[0]["binding"], "self");
    assert!(ops[0]["bound_at"].is_string());
}

#[tokio::test]
async fn test_grant_and_revoke_flow() {
    let (app, pool) = common::setup_test_app().await;
    let (owner_token, owner_id) = common::create_test_user_and_session(&app, &pool).await;
    let (_op_token_1, op_id_1) = common::create_test_user_and_session(&app, &pool).await;
    let (_op_token_2, op_id_2) = common::create_test_user_and_session(&app, &pool).await;
    let (_non_member_token, non_member_id) =
        common::create_test_user_and_session(&app, &pool).await;

    let room_id = create_test_room(&pool, &owner_id).await;
    add_user_to_room(&pool, &room_id, &op_id_1, "member").await;
    add_user_to_room(&pool, &room_id, &op_id_2, "member").await;

    let (bot_id, _) = create_test_bot(&app, &owner_token, "Operated Bot").await;

    // 1. Grant with non-member operator -> 400 invalid_operator
    let req_fail = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/bots", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", owner_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(axum::body::Body::from(
            json!({
                "bot_id": bot_id,
                "scopes": ["post_message"],
                "operators": [non_member_id]
            })
            .to_string(),
        ))
        .unwrap();

    let res_fail = app.clone().oneshot(req_fail).await.unwrap();
    assert_eq!(res_fail.status(), StatusCode::BAD_REQUEST);

    // 2. Grant with valid room members
    let req_grant = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/bots", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", owner_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(axum::body::Body::from(
            json!({
                "bot_id": bot_id,
                "scopes": ["post_message"],
                "operators": [op_id_1, op_id_2]
            })
            .to_string(),
        ))
        .unwrap();

    let res_grant = app.clone().oneshot(req_grant).await.unwrap();
    assert_eq!(res_grant.status(), StatusCode::CREATED);

    // Verify DB bindings
    let ops_db: Vec<(String, String, String)> = sqlx::query_as(
        "SELECT user_id, binding, bound_by FROM bot_operators WHERE bot_id = ? ORDER BY bound_at ASC",
    )
    .bind(&bot_id)
    .fetch_all(&pool)
    .await
    .unwrap();

    assert_eq!(ops_db.len(), 3);
    assert_eq!(
        ops_db[0],
        (owner_id.clone(), "self".to_string(), owner_id.clone())
    );
    assert_eq!(
        ops_db[1],
        (op_id_1.clone(), "room-member".to_string(), owner_id.clone())
    );
    assert_eq!(
        ops_db[2],
        (op_id_2.clone(), "room-member".to_string(), owner_id.clone())
    );

    // Verify audit logs for grant
    let audit_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM audit_log WHERE action = 'bot.operator.bound' AND target_id = ?",
    )
    .bind(&bot_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(audit_count, 3); // 1 self + 2 room-member

    // Revoke flow
    let req_revoke = Request::builder()
        .method("DELETE")
        .uri(format!("/api/v1/rooms/{}/bots/{}", room_id, bot_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", owner_token))
        .body(axum::body::Body::empty())
        .unwrap();

    let res_revoke = app.clone().oneshot(req_revoke).await.unwrap();
    assert_eq!(res_revoke.status(), StatusCode::NO_CONTENT);

    // Verify DB bindings after revoke (only self-binding remains)
    let ops_after: Vec<(String, String)> =
        sqlx::query_as("SELECT user_id, binding FROM bot_operators WHERE bot_id = ?")
            .bind(&bot_id)
            .fetch_all(&pool)
            .await
            .unwrap();

    assert_eq!(ops_after.len(), 1);
    assert_eq!(ops_after[0], (owner_id.clone(), "self".to_string()));

    // Verify unbound audit logs
    let unbound_audit_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM audit_log WHERE action = 'bot.operator.unbound' AND target_id = ?",
    )
    .bind(&bot_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(unbound_audit_count, 2);
}

#[tokio::test]
async fn test_get_bot_operators_visibility() {
    let (app, pool) = common::setup_test_app().await;
    let (owner_token, owner_id) = common::create_test_user_and_session(&app, &pool).await;
    let (op_token, op_id) = common::create_test_user_and_session(&app, &pool).await;
    let (other_token, _other_id) = common::create_test_user_and_session(&app, &pool).await;

    let room_id = create_test_room(&pool, &owner_id).await;
    add_user_to_room(&pool, &room_id, &op_id, "member").await;

    let (bot_id, bot_token) = create_test_bot(&app, &owner_token, "Visibility Bot").await;

    // Grant bot with op_id as operator
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

    // 1. Owner sees operators array
    let req_owner = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/bots/{}", bot_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", owner_token))
        .body(axum::body::Body::empty())
        .unwrap();
    let res_owner = app.clone().oneshot(req_owner).await.unwrap();
    assert_eq!(res_owner.status(), StatusCode::OK);
    let body_owner: Value = serde_json::from_slice(
        &axum::body::to_bytes(res_owner.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    assert!(body_owner["operators"].is_array());
    assert_eq!(body_owner["operators"].as_array().unwrap().len(), 2);

    // 2. Designated operator sees operators array
    let req_op = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/bots/{}", bot_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", op_token))
        .body(axum::body::Body::empty())
        .unwrap();
    let res_op = app.clone().oneshot(req_op).await.unwrap();
    assert_eq!(res_op.status(), StatusCode::OK);
    let body_op: Value = serde_json::from_slice(
        &axum::body::to_bytes(res_op.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    assert!(body_op["operators"].is_array());
    assert_eq!(body_op["operators"].as_array().unwrap().len(), 2);

    // 3. Bot token matching bot_id sees operators array
    let req_bot = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/bots/{}", bot_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", bot_token))
        .body(axum::body::Body::empty())
        .unwrap();
    let res_bot = app.clone().oneshot(req_bot).await.unwrap();
    assert_eq!(res_bot.status(), StatusCode::OK);
    let body_bot: Value = serde_json::from_slice(
        &axum::body::to_bytes(res_bot.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    assert!(body_bot["operators"].is_array());

    // 4. Non-operator caller returns 403 Forbidden
    let req_other = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/bots/{}", bot_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", other_token))
        .body(axum::body::Body::empty())
        .unwrap();
    let res_other = app.clone().oneshot(req_other).await.unwrap();
    assert_eq!(res_other.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn test_bot_deletion_purges_operators_and_queue() {
    let (app, pool) = common::setup_test_app().await;
    let (owner_token, _owner_id) = common::create_test_user_and_session(&app, &pool).await;

    let (bot_id, _) = create_test_bot(&app, &owner_token, "To Delete Bot").await;

    // Seed dummy operator queue entry
    sqlx::query("INSERT INTO bot_operator_queue (id, bot_id, audience, payload, payload_preview) VALUES ('q_del_1', ?, 'private', '{}', '[request]')")
        .bind(&bot_id)
        .execute(&pool)
        .await
        .unwrap();

    // Delete bot
    let req_del = Request::builder()
        .method("DELETE")
        .uri(format!("/api/v1/bots/{}", bot_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", owner_token))
        .body(axum::body::Body::empty())
        .unwrap();

    let res_del = app.clone().oneshot(req_del).await.unwrap();
    assert_eq!(res_del.status(), StatusCode::NO_CONTENT);

    // Confirm operator bindings and queue entries are removed
    let op_cnt: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM bot_operators WHERE bot_id = ?")
        .bind(&bot_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(op_cnt, 0);

    let q_cnt: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM bot_operator_queue WHERE bot_id = ?")
        .bind(&bot_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(q_cnt, 0);

    // Confirm audit log wrote BOT_OPERATOR_QUEUE_PURGED with entries count = 1
    let audit_row = sqlx::query_as::<_, (String, String)>(
        "SELECT action, metadata FROM audit_log WHERE action = 'bot.operator_queue_purged' AND target_id = ?",
    )
    .bind(&bot_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(audit_row.0, "bot.operator_queue_purged");
    let meta: Value = serde_json::from_str(&audit_row.1).unwrap();
    assert_eq!(meta["bot_id"], bot_id);
    assert_eq!(meta["entries"], 1);
}

#[test]
fn test_derive_payload_preview_priority_and_truncation() {
    use server::bots::derive_payload_preview;

    // Rule 1: String payload
    assert_eq!(derive_payload_preview(&json!("Hello World")), "Hello World");

    // Rule 2: Object with preview
    assert_eq!(
        derive_payload_preview(&json!({
            "preview": "Preview text",
            "message": "Message text",
            "question": "Question text"
        })),
        "Preview text"
    );

    // Rule 3: Object with message
    assert_eq!(
        derive_payload_preview(&json!({
            "message": "Message text",
            "question": "Question text"
        })),
        "Message text"
    );

    // Rule 4: Object with question
    assert_eq!(
        derive_payload_preview(&json!({
            "question": "Question text"
        })),
        "Question text"
    );

    // Rule 5: Non-conforming object / array / bool
    assert_eq!(derive_payload_preview(&json!({"foo": "bar"})), "[request]");
    assert_eq!(derive_payload_preview(&json!([1, 2, 3])), "[request]");
    assert_eq!(derive_payload_preview(&json!(true)), "[request]");

    // Truncation at 120 chars
    let long_str = "a".repeat(150);
    let preview = derive_payload_preview(&json!(long_str));
    assert_eq!(preview.chars().count(), 123); // 120 + '...'
    assert!(preview.ends_with("..."));
}
