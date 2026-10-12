use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use base64::engine::general_purpose::{STANDARD as BASE64, URL_SAFE_NO_PAD};
use base64::Engine;
use futures::stream::StreamExt;
use serde_json::{json, Value};
use server::events::{ObserverCursorStore, ObserverKey, RoomEventBroadcast, RoomEventEnvelope};
use std::time::Duration;
use tower::ServiceExt;

mod common;

fn valid_pubkey() -> String {
    URL_SAFE_NO_PAD.encode([7u8; 32])
}

async fn create_test_bot(
    app: &axum::Router,
    user_token: &str,
    scopes: &[&str],
) -> (String, String) {
    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/bots")
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "display_name": "Observer Test Bot",
                "bot_identity_pubkey": valid_pubkey(),
                "bot_command_pubkey": valid_pubkey(),
                "identity_pubkey": valid_pubkey(),
                "declared_scopes": scopes
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

    let bot_id = body["bot_id"].as_str().unwrap().to_string();
    let bot_token = body["bot_token"].as_str().unwrap().to_string();
    (bot_id, bot_token)
}

async fn create_test_room(app: &axum::Router, user_token: &str) -> String {
    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms")
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from("{}"))
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

async fn grant_bot_scope(
    app: &axum::Router,
    owner_token: &str,
    room_id: &str,
    bot_id: &str,
    scopes: &[&str],
) {
    let req = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/bots", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", owner_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "bot_id": bot_id,
                "scopes": scopes
            })
            .to_string(),
        ))
        .unwrap();

    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::CREATED);
}

// =========================================================================
// Unit tests for RoomEventBroadcast
// =========================================================================

#[tokio::test]
async fn test_broadcast_unit_publish_and_subscribe() {
    let broadcast = RoomEventBroadcast::new(16);
    let mut rx = broadcast.subscribe();

    let envelope = RoomEventEnvelope {
        room_id: "r_123".to_string(),
        event: "message.new".to_string(),
        data: json!({"id": "m_1"}),
    };

    broadcast.publish(envelope.clone());

    let received = rx.recv().await.unwrap();
    assert_eq!(received.room_id, "r_123");
    assert_eq!(received.event, "message.new");
    assert_eq!(received.data["id"], "m_1");
}

#[tokio::test]
async fn test_broadcast_unit_slow_subscriber_lagged() {
    let broadcast = RoomEventBroadcast::new(2);
    let mut rx = broadcast.subscribe();

    for i in 0..5 {
        broadcast.publish(RoomEventEnvelope {
            room_id: "r_1".to_string(),
            event: "message.new".to_string(),
            data: json!({"idx": i}),
        });
    }

    match rx.recv().await {
        Err(tokio::sync::broadcast::error::RecvError::Lagged(count)) => {
            assert!(count > 0);
        }
        other => panic!("Expected RecvError::Lagged, got {:?}", other),
    }
}

#[tokio::test]
async fn test_broadcast_unit_multiple_subscribers() {
    let broadcast = RoomEventBroadcast::new(16);
    let mut rx1 = broadcast.subscribe();
    let mut rx2 = broadcast.subscribe();

    broadcast.publish(RoomEventEnvelope {
        room_id: "r_multi".to_string(),
        event: "room.member_added".to_string(),
        data: json!({"user_id": "u_1"}),
    });

    let env1 = rx1.recv().await.unwrap();
    let env2 = rx2.recv().await.unwrap();

    assert_eq!(env1.room_id, "r_multi");
    assert_eq!(env2.room_id, "r_multi");
}

// =========================================================================
// Integration tests for Observer Stream Endpoint
// =========================================================================

#[tokio::test]
async fn test_observer_stream_auth_and_scope() {
    let (app, pool) = common::setup_test_app().await;
    let (owner_token, _owner_id) = common::create_test_user_and_session(&app, &pool).await;

    let (bot_id, bot_token) =
        create_test_bot(&app, &owner_token, &["read_metadata", "post_message"]).await;

    let room_id = create_test_room(&app, &owner_token).await;

    // 1. Unauthenticated -> 401
    let req_unauth = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/rooms/{}/observer-stream", room_id))
        .body(Body::empty())
        .unwrap();

    let res_unauth = app.clone().oneshot(req_unauth).await.unwrap();
    assert_eq!(res_unauth.status(), StatusCode::UNAUTHORIZED);

    // 2. User session token -> 401
    let req_user = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/rooms/{}/observer-stream", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", owner_token))
        .body(Body::empty())
        .unwrap();

    let res_user = app.clone().oneshot(req_user).await.unwrap();
    assert_eq!(res_user.status(), StatusCode::UNAUTHORIZED);

    // 3. Bot token without grant in room -> 403
    let req_no_grant = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/rooms/{}/observer-stream", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", bot_token))
        .body(Body::empty())
        .unwrap();

    let res_no_grant = app.clone().oneshot(req_no_grant).await.unwrap();
    assert_eq!(res_no_grant.status(), StatusCode::FORBIDDEN);

    // 4. Bot token with grant but WITHOUT read_metadata scope -> 403
    let (write_bot_id, write_bot_token) =
        create_test_bot(&app, &owner_token, &["post_message"]).await;
    grant_bot_scope(
        &app,
        &owner_token,
        &room_id,
        &write_bot_id,
        &["post_message"],
    )
    .await;

    let req_no_scope = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/rooms/{}/observer-stream", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", write_bot_token))
        .body(Body::empty())
        .unwrap();

    let res_no_scope = app.clone().oneshot(req_no_scope).await.unwrap();
    assert_eq!(res_no_scope.status(), StatusCode::FORBIDDEN);

    // 5. Bot token with grant AND read_metadata scope -> 200 OK
    grant_bot_scope(
        &app,
        &owner_token,
        &room_id,
        &bot_id,
        &["read_metadata", "post_message"],
    )
    .await;

    let req_ok = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/rooms/{}/observer-stream", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", bot_token))
        .body(Body::empty())
        .unwrap();

    let res_ok = app.clone().oneshot(req_ok).await.unwrap();
    assert_eq!(res_ok.status(), StatusCode::OK);
    assert_eq!(
        res_ok.headers().get(header::CONTENT_TYPE).unwrap(),
        "text/event-stream"
    );
    assert_eq!(
        res_ok.headers().get(header::CACHE_CONTROL).unwrap(),
        "no-store"
    );
    assert_eq!(res_ok.headers().get("x-accel-buffering").unwrap(), "no");
}

#[tokio::test]
async fn test_observer_stream_event_allowlist_and_projections() {
    let (app, pool) = common::setup_test_app().await;
    let (owner_token, owner_id) = common::create_test_user_and_session(&app, &pool).await;

    // Insert device for owner
    sqlx::query(
        "INSERT INTO devices (id, user_id, client_id, platform) VALUES ('dev_owner_1', ?, 'c_owner_1', 'web')",
    )
    .bind(&owner_id)
    .execute(&pool)
    .await
    .unwrap();

    let (bot_id, bot_token) =
        create_test_bot(&app, &owner_token, &["read_metadata", "post_message"]).await;

    let room_id = create_test_room(&app, &owner_token).await;

    grant_bot_scope(
        &app,
        &owner_token,
        &room_id,
        &bot_id,
        &["read_metadata", "post_message"],
    )
    .await;

    // Connect to observer stream
    let req_stream = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/rooms/{}/observer-stream", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", bot_token))
        .body(Body::empty())
        .unwrap();

    let res_stream = app.clone().oneshot(req_stream).await.unwrap();
    assert_eq!(res_stream.status(), StatusCode::OK);

    let body_stream = res_stream.into_body();

    // Spawn task to trigger events on room_id and forbidden events
    let app_clone = app.clone();
    let room_id_clone = room_id.clone();
    let owner_token_clone = owner_token.clone();

    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(50)).await;

        // 1. Post message -> triggers message.new
        let ct_b64 = BASE64.encode(b"secret message ciphertext");
        let req_msg = Request::builder()
            .method("POST")
            .uri(format!("/api/v1/rooms/{}/messages", room_id_clone))
            .header(
                header::AUTHORIZATION,
                format!("Bearer {}", owner_token_clone),
            )
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(
                json!({
                    "sender_client_id": "c_owner_1",
                    "epoch": 0,
                    "content_type": "application",
                    "ciphertext": ct_b64
                })
                .to_string(),
            ))
            .unwrap();

        let res_msg = app_clone.clone().oneshot(req_msg).await.unwrap();
        assert_eq!(res_msg.status(), StatusCode::CREATED);

        // 2. Publish forbidden event directly on room_events broadcast to test allowlist filter
        // (reaction.added, session.created, call.started, epoch.updated)
        let state_room_events = server::events::RoomEventBroadcast::default();
        state_room_events.publish(RoomEventEnvelope {
            room_id: room_id_clone.clone(),
            event: "reaction.added".to_string(),
            data: json!({"reaction": "👍"}),
        });
        state_room_events.publish(RoomEventEnvelope {
            room_id: room_id_clone.clone(),
            event: "epoch.updated".to_string(),
            data: json!({"epoch": 1}),
        });

        // 3. Update room metadata -> triggers room.updated
        let req_meta = Request::builder()
            .method("PATCH")
            .uri(format!("/api/v1/rooms/{}", room_id_clone))
            .header(
                header::AUTHORIZATION,
                format!("Bearer {}", owner_token_clone),
            )
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(json!({"metadata": "aGVsbG8"}).to_string()))
            .unwrap();

        let res_meta = app_clone.clone().oneshot(req_meta).await.unwrap();
        assert_eq!(res_meta.status(), StatusCode::OK);
    });

    // Read chunks from SSE stream with a short timeout per chunk
    let mut data_stream = body_stream.into_data_stream();
    let mut collected = Vec::new();

    while let Ok(Some(Ok(chunk))) =
        tokio::time::timeout(Duration::from_millis(500), data_stream.next()).await
    {
        collected.extend_from_slice(&chunk);
        let text = String::from_utf8_lossy(&collected);
        if text.contains("event: room.updated") {
            break;
        }
    }

    let stream_text = String::from_utf8_lossy(&collected);

    // Verify framing and allowlist
    assert!(stream_text.contains("event: message.new"));
    assert!(stream_text.contains("event: room.updated"));
    assert!(!stream_text.contains("reaction.added"));
    assert!(!stream_text.contains("epoch.updated"));

    // Verify metadata projections (NO ciphertext, NO metadata blob)
    assert!(!stream_text.contains("secret message ciphertext"));
    assert!(!stream_text.contains("aGVsbG8")); // metadata blob excluded
    assert!(stream_text.contains("size_bytes"));
}

#[tokio::test]
async fn test_observer_stream_reconnection_and_cursors() {
    let (app, pool) = common::setup_test_app().await;
    let (owner_token, _owner_id) = common::create_test_user_and_session(&app, &pool).await;

    let (bot_id, bot_token) =
        create_test_bot(&app, &owner_token, &["read_metadata", "post_message"]).await;

    let room_id = create_test_room(&app, &owner_token).await;

    grant_bot_scope(
        &app,
        &owner_token,
        &room_id,
        &bot_id,
        &["read_metadata", "post_message"],
    )
    .await;

    // Connect with Last-Event-ID: 5 -> first emitted ID should be 6
    let req_reconnect = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/rooms/{}/observer-stream", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", bot_token))
        .header("Last-Event-ID", "5")
        .body(Body::empty())
        .unwrap();

    let res_reconnect = app.clone().oneshot(req_reconnect).await.unwrap();
    assert_eq!(res_reconnect.status(), StatusCode::OK);

    // Check in-memory cursor store directly
    let obs_key = ObserverKey {
        bot_id: bot_id.clone(),
        room_id: room_id.clone(),
    };

    let cursor_store = ObserverCursorStore::new();
    cursor_store
        .update(obs_key.clone(), 5, Duration::from_secs(300))
        .await;

    let cursor = cursor_store.get(&obs_key).await.unwrap();
    assert_eq!(cursor.last_event_id, 5);

    // Verify non-persistence: No observer tables in SQLite
    let observer_tables: Vec<String> = sqlx::query_scalar(
        "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%observer%'",
    )
    .fetch_all(&pool)
    .await
    .unwrap();

    assert!(observer_tables.is_empty());
}
