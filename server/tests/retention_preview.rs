mod common;

use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use common::{login_user, register_user, setup_test_app};
use serde_json::{json, Value};
use sqlx::SqlitePool;
use tower::ServiceExt;

async fn create_test_user(
    app: &axum::Router,
    pool: &SqlitePool,
    username: &str,
    client_id: &str,
) -> (String, String) {
    let has_users: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM users)")
        .fetch_one(pool)
        .await
        .unwrap();

    let invite_code = if has_users {
        let code = format!("INV_{}", username);
        sqlx::query(
            "INSERT INTO server_invites (id, code, max_uses, current_uses) VALUES (?, ?, 10, 0)",
        )
        .bind(format!("inv_id_{}", username))
        .bind(&code)
        .execute(pool)
        .await
        .unwrap();
        Some(code)
    } else {
        None
    };

    let user_id = register_user(app, username, "Password123!", invite_code.as_deref()).await;
    let (status, login_res) = login_user(app, username, "Password123!", client_id, None).await;
    if status != StatusCode::OK {
        panic!(
            "login_user failed for {}: status={}, res={:?}",
            username, status, login_res
        );
    }
    let token = login_res["session_token"].as_str().unwrap().to_string();

    (user_id, token)
}

#[tokio::test]
async fn test_retention_preview_flow() {
    let (app, pool) = setup_test_app().await;

    // Register user 1 (owner)
    let (owner_user_id, owner_token) =
        create_test_user(&app, &pool, "owner_user", "client_id_owner_12345").await;

    // Set instance limit for attachment_retention_days = 365 so effective retention isn't capped at default 0
    sqlx::query(
        "INSERT INTO instance_limits (key, value, updated_by) VALUES ('attachment_retention_days', '365', ?)",
    )
    .bind(&owner_user_id)
    .execute(&pool)
    .await
    .unwrap();

    // Register user 2 (regular member)
    let (member_user_id, member_token) =
        create_test_user(&app, &pool, "member_user", "client_id_member_12345").await;

    // Register user 3 (non-member)
    let (_non_member_user_id, non_member_token) =
        create_test_user(&app, &pool, "non_member_user", "client_id_non_member_12345").await;

    // Create room with default retention (90 days)
    let req_create = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms")
        .header(header::AUTHORIZATION, format!("Bearer {}", owner_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "retention_days": 90,
                "max_file_size_bytes": 10485760
            })
            .to_string(),
        ))
        .unwrap();

    let resp_create = app.clone().oneshot(req_create).await.unwrap();
    assert_eq!(resp_create.status(), StatusCode::CREATED);
    let body_bytes = axum::body::to_bytes(resp_create.into_body(), usize::MAX)
        .await
        .unwrap();
    let room_json: Value = serde_json::from_slice(&body_bytes).unwrap();
    let room_id = room_json["id"].as_str().unwrap();

    // Add member_user_id to room
    let req_add = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/members", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", owner_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "user_id": member_user_id }).to_string()))
        .unwrap();
    let resp_add = app.clone().oneshot(req_add).await.unwrap();
    assert_eq!(resp_add.status(), StatusCode::CREATED);

    // Seed room with messages:
    // Message 1: 100 days old (regular application message) -> should be affected by 30-day retention
    let msg1_id = "01HM0000000000000000000001";
    sqlx::query(
        r#"
        INSERT INTO room_messages (id, room_id, sender_user_id, sender_client_id, epoch, seq, content_type, ciphertext, created_at)
        VALUES (?, ?, ?, 'c1', 0, 1, 'application', X'1234', datetime('now', '-100 days'))
        "#,
    )
    .bind(msg1_id)
    .bind(room_id)
    .bind(&owner_user_id)
    .execute(&pool)
    .await
    .unwrap();

    // Message 2: 50 days old (edit row of msg1, edit_of = msg1_id) -> should be affected by 30-day retention
    let msg2_id = "01HM0000000000000000000002";
    sqlx::query(
        r#"
        INSERT INTO room_messages (id, room_id, sender_user_id, sender_client_id, epoch, seq, content_type, ciphertext, edit_of, edit_sequence, created_at)
        VALUES (?, ?, ?, 'c1', 0, 0, 'application', X'1234', ?, 1, datetime('now', '-50 days'))
        "#,
    )
    .bind(msg2_id)
    .bind(room_id)
    .bind(&owner_user_id)
    .bind(msg1_id)
    .execute(&pool)
    .await
    .unwrap();

    // Message 3: 40 days old (soft-deleted message) -> should NOT be counted
    let msg3_id = "01HM0000000000000000000003";
    sqlx::query(
        r#"
        INSERT INTO room_messages (id, room_id, sender_user_id, sender_client_id, epoch, seq, content_type, ciphertext, created_at, deleted_at)
        VALUES (?, ?, ?, 'c1', 0, 2, 'application', X'1234', datetime('now', '-40 days'), datetime('now', '-39 days'))
        "#,
    )
    .bind(msg3_id)
    .bind(room_id)
    .bind(&owner_user_id)
    .execute(&pool)
    .await
    .unwrap();

    // Message 4: 60 days old (commit protocol message) -> should NOT be counted
    let msg4_id = "01HM0000000000000000000004";
    sqlx::query(
        r#"
        INSERT INTO room_messages (id, room_id, sender_user_id, sender_client_id, epoch, seq, content_type, ciphertext, created_at)
        VALUES (?, ?, ?, 'c1', 0, 0, 'commit', X'1234', datetime('now', '-60 days'))
        "#,
    )
    .bind(msg4_id)
    .bind(room_id)
    .bind(&owner_user_id)
    .execute(&pool)
    .await
    .unwrap();

    // Message 5: 10 days old (regular application message) -> should NOT be affected by 30-day retention
    let msg5_id = "01HM0000000000000000000005";
    sqlx::query(
        r#"
        INSERT INTO room_messages (id, room_id, sender_user_id, sender_client_id, epoch, seq, content_type, ciphertext, created_at)
        VALUES (?, ?, ?, 'c1', 0, 3, 'application', X'1234', datetime('now', '-10 days'))
        "#,
    )
    .bind(msg5_id)
    .bind(room_id)
    .bind(&owner_user_id)
    .execute(&pool)
    .await
    .unwrap();

    // Seed Attachment: 70 days old in this room -> should be affected by 30-day retention
    let att_id = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";
    sqlx::query(
        r#"
        INSERT INTO attachments (id, room_id, uploader_id, storage_backend, storage_key, padded_size, plaintext_size, encrypted_size, chunk_size, chunk_count, nonce_prefix, base_counter, created_at)
        VALUES (?, ?, ?, 'fs', 'key1', 100, 100, 100, 100, 1, 'nonce', 0, datetime('now', '-70 days'))
        "#,
    )
    .bind(att_id)
    .bind(room_id)
    .bind(&owner_user_id)
    .execute(&pool)
    .await
    .unwrap();

    // Snapshot DB state before preview
    let msg_count_before: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM room_messages")
        .fetch_one(&pool)
        .await
        .unwrap();

    // 1. Successful preview by owner (proposed retention = 30 days)
    let req_preview = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/retention/preview", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", owner_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "retention_days": 30 }).to_string()))
        .unwrap();

    let resp_preview = app.clone().oneshot(req_preview).await.unwrap();
    assert_eq!(resp_preview.status(), StatusCode::OK);
    assert_eq!(
        resp_preview.headers().get(header::CACHE_CONTROL).unwrap(),
        "no-store"
    );

    let body_bytes = axum::body::to_bytes(resp_preview.into_body(), usize::MAX)
        .await
        .unwrap();
    let res_body: Value = serde_json::from_slice(&body_bytes).unwrap();

    assert_eq!(res_body["current_retention_days"], 90);
    assert_eq!(res_body["proposed_retention_days"], 30);
    assert_eq!(res_body["messages_affected"], 2); // msg1 (100d old) and msg2 (50d old edit row)
    assert_eq!(res_body["attachments_affected"], 1); // att_id (70d old)
    assert!(res_body["oldest_affected_at"].is_string());
    assert!(res_body["newest_affected_at"].is_string());

    // 2. Read-only assertion: verify DB row counts unchanged
    let msg_count_after: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM room_messages")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(msg_count_before, msg_count_after);

    // 3. Same retention preview (proposed = 90 days)
    let req_same = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/retention/preview", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", owner_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "retention_days": 90 }).to_string()))
        .unwrap();

    let resp_same = app.clone().oneshot(req_same).await.unwrap();
    assert_eq!(resp_same.status(), StatusCode::OK);
    let body_same = axum::body::to_bytes(resp_same.into_body(), usize::MAX)
        .await
        .unwrap();
    let same_body: Value = serde_json::from_slice(&body_same).unwrap();
    assert_eq!(same_body["messages_affected"], 1); // msg1 (100d old) is > 90 days

    // 4. Proposed retention = 0 (forever -> 0 affected)
    let req_forever = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/retention/preview", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", owner_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "retention_days": 0 }).to_string()))
        .unwrap();

    let resp_forever = app.clone().oneshot(req_forever).await.unwrap();
    assert_eq!(resp_forever.status(), StatusCode::OK);
    let body_forever = axum::body::to_bytes(resp_forever.into_body(), usize::MAX)
        .await
        .unwrap();
    let forever_body: Value = serde_json::from_slice(&body_forever).unwrap();
    assert_eq!(forever_body["messages_affected"], 0);
    assert_eq!(forever_body["attachments_affected"], 0);
    assert!(forever_body["oldest_affected_at"].is_null());
    assert!(forever_body["newest_affected_at"].is_null());

    // 5. Non-owner member rejection (403 forbidden)
    let req_member = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/retention/preview", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", member_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "retention_days": 30 }).to_string()))
        .unwrap();

    let resp_member = app.clone().oneshot(req_member).await.unwrap();
    assert_eq!(resp_member.status(), StatusCode::FORBIDDEN);

    // 6. Non-member rejection (404 room_not_found)
    let req_non_member = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/retention/preview", room_id))
        .header(
            header::AUTHORIZATION,
            format!("Bearer {}", non_member_token),
        )
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "retention_days": 30 }).to_string()))
        .unwrap();

    let resp_non_member = app.clone().oneshot(req_non_member).await.unwrap();
    assert_eq!(resp_non_member.status(), StatusCode::NOT_FOUND);

    // 7. Unauthenticated rejection (401)
    let req_unauth = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/retention/preview", room_id))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "retention_days": 30 }).to_string()))
        .unwrap();

    let resp_unauth = app.clone().oneshot(req_unauth).await.unwrap();
    assert_eq!(resp_unauth.status(), StatusCode::UNAUTHORIZED);

    // 8. Invalid retention_days (out of range -> 400 invalid_retention_days)
    let req_invalid_neg = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/retention/preview", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", owner_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "retention_days": -5 }).to_string()))
        .unwrap();

    let resp_invalid_neg = app.clone().oneshot(req_invalid_neg).await.unwrap();
    assert_eq!(resp_invalid_neg.status(), StatusCode::BAD_REQUEST);

    let req_invalid_large = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/retention/preview", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", owner_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "retention_days": 400 }).to_string()))
        .unwrap();

    let resp_invalid_large = app.oneshot(req_invalid_large).await.unwrap();
    assert_eq!(resp_invalid_large.status(), StatusCode::BAD_REQUEST);
}
