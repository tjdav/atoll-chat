mod common;

use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use serde_json::{json, Value};
use server::cleanup::CleanupJob;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

#[tokio::test]
async fn test_pending_removes_workflow() {
    let (app, pool, _) = common::setup_test_app_with_config(true, "auto", 100).await;

    // Register User A (owner)
    let user_a_id = common::register_user(&app, "usera", "Password123!", None).await;
    let (status_a, login_a) =
        common::login_user(&app, "usera", "Password123!", "client_a_123456789", None).await;
    assert_eq!(status_a, StatusCode::OK);
    let token_a = login_a["session_token"].as_str().unwrap();

    // Create server invites for B and C
    sqlx::query(
        "INSERT INTO server_invites (id, code, max_uses, current_uses) VALUES ('inv_b', 'INVITEB1234', 1, 0)",
    )
    .execute(&pool)
    .await
    .unwrap();

    sqlx::query(
        "INSERT INTO server_invites (id, code, max_uses, current_uses) VALUES ('inv_c', 'INVITEC1234', 1, 0)",
    )
    .execute(&pool)
    .await
    .unwrap();

    let user_b_id = common::register_user(&app, "userb", "Password123!", Some("INVITEB1234")).await;
    let (status_b1, _login_b1) =
        common::login_user(&app, "userb", "Password123!", "client_b_123456789", None).await;
    assert_eq!(status_b1, StatusCode::OK);

    // B logs in on second device
    let (status_b2, _login_b2) =
        common::login_user(&app, "userb", "Password123!", "client_b_987654321", None).await;
    assert_eq!(status_b2, StatusCode::OK);

    let _user_c_id =
        common::register_user(&app, "userc", "Password123!", Some("INVITEC1234")).await;
    let (status_c, login_c) =
        common::login_user(&app, "userc", "Password123!", "client_c_123456789", None).await;
    assert_eq!(status_c, StatusCode::OK);
    let token_c = login_c["session_token"].as_str().unwrap();

    // User A creates Room 1
    let create_room_req = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({}).to_string()))
        .unwrap();

    let resp = tower::ServiceExt::oneshot(app.clone(), create_room_req)
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED);
    let room_json: Value = serde_json::from_slice(
        &axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    let room_1_id = room_json["id"].as_str().unwrap();

    // 1. Empty list for fresh room
    let list_req = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/rooms/{}/pending-removes", room_1_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();

    let list_resp = tower::ServiceExt::oneshot(app.clone(), list_req)
        .await
        .unwrap();
    assert_eq!(list_resp.status(), StatusCode::OK);
    assert_eq!(
        list_resp.headers().get(header::CACHE_CONTROL).unwrap(),
        "no-store"
    );
    let list_json: Value = serde_json::from_slice(
        &axum::body::to_bytes(list_resp.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(list_json["removes"].as_array().unwrap().len(), 0);

    // 4. Non-member (User C) cannot list -> HTTP 404
    let list_req_c = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/rooms/{}/pending-removes", room_1_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_c))
        .body(Body::empty())
        .unwrap();

    let list_resp_c = tower::ServiceExt::oneshot(app.clone(), list_req_c)
        .await
        .unwrap();
    assert_eq!(list_resp_c.status(), StatusCode::NOT_FOUND);

    // 5. Non-member cannot consume -> HTTP 404
    let consume_req_c = Request::builder()
        .method("POST")
        .uri(format!(
            "/api/v1/rooms/{}/pending-removes/dummyid/consume",
            room_1_id
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_c))
        .body(Body::empty())
        .unwrap();

    let consume_resp_c = tower::ServiceExt::oneshot(app.clone(), consume_req_c)
        .await
        .unwrap();
    assert_eq!(consume_resp_c.status(), StatusCode::NOT_FOUND);

    // User A adds User B to Room 1
    let add_b_req = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/members", room_1_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "user_id": user_b_id }).to_string()))
        .unwrap();

    let add_b_resp = tower::ServiceExt::oneshot(app.clone(), add_b_req)
        .await
        .unwrap();
    assert_eq!(add_b_resp.status(), StatusCode::CREATED);

    // 2 & 3. Kicking User B queues 1 remove for target user
    let kick_b_req = Request::builder()
        .method("DELETE")
        .uri(format!("/api/v1/rooms/{}/members/{}", room_1_id, user_b_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();

    let kick_b_resp = tower::ServiceExt::oneshot(app.clone(), kick_b_req)
        .await
        .unwrap();
    assert_eq!(kick_b_resp.status(), StatusCode::NO_CONTENT);

    // Check pending removes for Room 1 -> expect 1 row for user B
    let list_req2 = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/rooms/{}/pending-removes", room_1_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();

    let list_resp2 = tower::ServiceExt::oneshot(app.clone(), list_req2)
        .await
        .unwrap();
    assert_eq!(list_resp2.status(), StatusCode::OK);
    let list_json2: Value = serde_json::from_slice(
        &axum::body::to_bytes(list_resp2.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    let removes = list_json2["removes"].as_array().unwrap();
    assert_eq!(removes.len(), 1);
    let remove_1_id = removes[0]["id"].as_str().unwrap().to_string();
    assert_eq!(removes[0]["target_user_id"], user_b_id);
    assert_eq!(removes[0]["target_bot_id"], Value::Null);

    // 6. Consuming marks the row
    let consume_1_req = Request::builder()
        .method("POST")
        .uri(format!(
            "/api/v1/rooms/{}/pending-removes/{}/consume",
            room_1_id, remove_1_id
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();

    let consume_1_resp = tower::ServiceExt::oneshot(app.clone(), consume_1_req)
        .await
        .unwrap();
    assert_eq!(consume_1_resp.status(), StatusCode::NO_CONTENT);

    // 7. Consuming twice returns 404 remove_not_found
    let consume_1_req_again = Request::builder()
        .method("POST")
        .uri(format!(
            "/api/v1/rooms/{}/pending-removes/{}/consume",
            room_1_id, remove_1_id
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();

    let consume_1_resp_again = tower::ServiceExt::oneshot(app.clone(), consume_1_req_again)
        .await
        .unwrap();
    assert_eq!(consume_1_resp_again.status(), StatusCode::NOT_FOUND);

    // 8. Consuming a remove from another room returns 404
    // User A creates Room 2
    let create_room_2_req = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({}).to_string()))
        .unwrap();

    let resp_r2 = tower::ServiceExt::oneshot(app.clone(), create_room_2_req)
        .await
        .unwrap();
    assert_eq!(resp_r2.status(), StatusCode::CREATED);
    let r2_json: Value = serde_json::from_slice(
        &axum::body::to_bytes(resp_r2.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    let room_2_id = r2_json["id"].as_str().unwrap();

    // Add B to Room 2, kick B
    let _ = user_a_id;
    let add_b_r2 = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/members", room_2_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "user_id": user_b_id }).to_string()))
        .unwrap();
    let _ = tower::ServiceExt::oneshot(app.clone(), add_b_r2)
        .await
        .unwrap();

    let kick_b_r2 = Request::builder()
        .method("DELETE")
        .uri(format!("/api/v1/rooms/{}/members/{}", room_2_id, user_b_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();
    let _ = tower::ServiceExt::oneshot(app.clone(), kick_b_r2)
        .await
        .unwrap();

    // Get remove ID in room 2
    let list_req_r2 = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/rooms/{}/pending-removes", room_2_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();
    let list_resp_r2 = tower::ServiceExt::oneshot(app.clone(), list_req_r2)
        .await
        .unwrap();
    let r2_list_json: Value = serde_json::from_slice(
        &axum::body::to_bytes(list_resp_r2.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    let remove_2_id = r2_list_json["removes"][0]["id"]
        .as_str()
        .unwrap()
        .to_string();

    // Attempt to consume Room 2's remove via Room 1's URL -> 404
    let cross_consume_req = Request::builder()
        .method("POST")
        .uri(format!(
            "/api/v1/rooms/{}/pending-removes/{}/consume",
            room_1_id, remove_2_id
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();

    let cross_consume_resp = tower::ServiceExt::oneshot(app.clone(), cross_consume_req)
        .await
        .unwrap();
    assert_eq!(cross_consume_resp.status(), StatusCode::NOT_FOUND);

    // Consume remove_2_id correctly
    let consume_2_req = Request::builder()
        .method("POST")
        .uri(format!(
            "/api/v1/rooms/{}/pending-removes/{}/consume",
            room_2_id, remove_2_id
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();

    let consume_2_resp = tower::ServiceExt::oneshot(app.clone(), consume_2_req)
        .await
        .unwrap();
    assert_eq!(consume_2_resp.status(), StatusCode::NO_CONTENT);

    // 9. Room delete cascades removes
    // Add B to Room 2, kick B to queue a remove in Room 2
    let add_b_r2_2 = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/members", room_2_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "user_id": user_b_id }).to_string()))
        .unwrap();
    let _ = tower::ServiceExt::oneshot(app.clone(), add_b_r2_2)
        .await
        .unwrap();

    let kick_b_r2_2 = Request::builder()
        .method("DELETE")
        .uri(format!("/api/v1/rooms/{}/members/{}", room_2_id, user_b_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();
    let _ = tower::ServiceExt::oneshot(app.clone(), kick_b_r2_2)
        .await
        .unwrap();

    let count_before: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM pending_mls_removes WHERE room_id = ?")
            .bind(room_2_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(count_before.0 > 0);

    // Delete Room 2
    let del_r2_req = Request::builder()
        .method("DELETE")
        .uri(format!("/api/v1/rooms/{}", room_2_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();

    let del_r2_resp = tower::ServiceExt::oneshot(app.clone(), del_r2_req)
        .await
        .unwrap();
    assert_eq!(del_r2_resp.status(), StatusCode::NO_CONTENT);

    let count_after: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM pending_mls_removes WHERE room_id = ?")
            .bind(room_2_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(count_after.0, 0);
}

#[tokio::test]
async fn test_pending_removes_xor_check() {
    let pool = common::setup_test_db().await;

    // Direct insert with both targets fails
    let res_both = sqlx::query(
        "INSERT INTO pending_mls_removes (id, room_id, target_user_id, target_bot_id) VALUES ('x','r_1','u_1','b_1')",
    )
    .execute(&pool)
    .await;
    assert!(res_both.is_err());

    // Direct insert with neither target fails
    let res_neither =
        sqlx::query("INSERT INTO pending_mls_removes (id, room_id) VALUES ('y','r_1')")
            .execute(&pool)
            .await;
    assert!(res_neither.is_err());

    // Direct insert with user target succeeds (needs valid room_id and user_id due to FK)
    sqlx::query("INSERT INTO users (id, username_token, opaque_registration, identity_pubkey) VALUES ('u_xor', 'tok_xor_1234567890123456789012345678901234567890123456789012345678901234567890123456789012', 'reg', 'pub')")
        .execute(&pool)
        .await
        .unwrap();

    sqlx::query("INSERT INTO rooms (id, owner_id) VALUES ('r_xor', 'u_xor')")
        .execute(&pool)
        .await
        .unwrap();

    sqlx::query("INSERT INTO bot_accounts (id, display_name, owner_user_id) VALUES ('b_xor', 'Bot XOR', 'u_xor')")
        .execute(&pool)
        .await
        .unwrap();

    let res_user = sqlx::query(
        "INSERT INTO pending_mls_removes (id, room_id, target_user_id) VALUES ('r_u','r_xor','u_xor')",
    )
    .execute(&pool)
    .await;
    assert!(res_user.is_ok());

    let res_bot = sqlx::query(
        "INSERT INTO pending_mls_removes (id, room_id, target_bot_id) VALUES ('r_b','r_xor','b_xor')",
    )
    .execute(&pool)
    .await;
    assert!(res_bot.is_ok());
}

#[tokio::test]
async fn test_queue_pending_mls_remove_batch() {
    let pool = common::setup_test_db().await;
    let mut tx = pool.begin().await.unwrap();

    sqlx::query("INSERT INTO users (id, username_token, opaque_registration, identity_pubkey) VALUES ('u_q', 'tok_q_1234567890123456789012345678901234567890123456789012345678901234567890123456789012', 'reg', 'pub')")
        .execute(&mut *tx)
        .await
        .unwrap();

    sqlx::query("INSERT INTO rooms (id, owner_id) VALUES ('r_q', 'u_q')")
        .execute(&mut *tx)
        .await
        .unwrap();

    sqlx::query(
        "INSERT INTO bot_accounts (id, display_name, owner_user_id) VALUES ('b_q', 'Bot Q', 'u_q')",
    )
    .execute(&mut *tx)
    .await
    .unwrap();

    // MlsTarget::User
    let rem_u = server::rooms::queue_pending_mls_remove_batch(
        &mut tx,
        "r_q",
        server::rooms::MlsTarget::User("u_q"),
    )
    .await
    .unwrap();

    // MlsTarget::Bot
    let rem_b = server::rooms::queue_pending_mls_remove_batch(
        &mut tx,
        "r_q",
        server::rooms::MlsTarget::Bot("b_q"),
    )
    .await
    .unwrap();

    tx.commit().await.unwrap();

    let row_u: (Option<String>, Option<String>) = sqlx::query_as(
        "SELECT target_user_id, target_bot_id FROM pending_mls_removes WHERE id = ?",
    )
    .bind(&rem_u)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(row_u.0.as_deref(), Some("u_q"));
    assert_eq!(row_u.1, None);

    let row_b: (Option<String>, Option<String>) = sqlx::query_as(
        "SELECT target_user_id, target_bot_id FROM pending_mls_removes WHERE id = ?",
    )
    .bind(&rem_b)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(row_b.0, None);
    assert_eq!(row_b.1.as_deref(), Some("b_q"));
}

#[tokio::test]
async fn test_pending_removes_stale_timeout_job() {
    let mock_server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/apps/chat/events"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"ok": true})))
        .mount(&mock_server)
        .await;

    let (app, pool, _) = common::setup_test_app_with_custom_config(|cfg| {
        cfg.sockudo_url = mock_server.uri();
        cfg.sockudo_app_key = "test-key".to_string();
        cfg.sockudo_app_secret = "test-secret".to_string();
        cfg.pending_mls_remove_timeout_days = 30;
    })
    .await;

    let user_owner = common::register_user(&app, "owner_stale", "Password123!", None).await;

    sqlx::query("INSERT INTO rooms (id, owner_id) VALUES ('r_stale', ?)")
        .bind(&user_owner)
        .execute(&pool)
        .await
        .unwrap();

    sqlx::query("INSERT INTO bot_accounts (id, display_name, owner_user_id) VALUES ('b_stale', 'Bot Stale', ?)")
        .bind(&user_owner)
        .execute(&pool)
        .await
        .unwrap();

    // 1. User row older than 30d (queued_at = 35d ago), stale_at IS NULL -> SHOULD BE MARKED STALE
    sqlx::query("INSERT INTO pending_mls_removes (id, room_id, target_user_id, queued_at) VALUES ('rem_user_old', 'r_stale', ?, datetime('now', '-35 days'))")
        .bind(&user_owner)
        .execute(&pool)
        .await
        .unwrap();

    // 2. Bot row older than 30d (queued_at = 40d ago), stale_at IS NULL -> SHOULD BE MARKED STALE
    sqlx::query("INSERT INTO pending_mls_removes (id, room_id, target_bot_id, queued_at) VALUES ('rem_bot_old', 'r_stale', 'b_stale', datetime('now', '-40 days'))")
        .execute(&pool)
        .await
        .unwrap();

    // 3. User row already stale (stale_at IS NOT NULL) -> SHOULD NOT BE RE-MARKED
    sqlx::query("INSERT INTO pending_mls_removes (id, room_id, target_user_id, queued_at, stale_at) VALUES ('rem_user_already_stale', 'r_stale', ?, datetime('now', '-35 days'), datetime('now', '-1 day'))")
        .bind(&user_owner)
        .execute(&pool)
        .await
        .unwrap();

    // 4. User row confirmed (remove_confirmed_at IS NOT NULL) -> SHOULD NOT BE MARKED STALE
    sqlx::query("INSERT INTO pending_mls_removes (id, room_id, target_user_id, queued_at, remove_confirmed_at) VALUES ('rem_user_confirmed', 'r_stale', ?, datetime('now', '-35 days'), datetime('now', '-1 day'))")
        .bind(&user_owner)
        .execute(&pool)
        .await
        .unwrap();

    // 5. User row cancelled (cancelled_at IS NOT NULL) -> SHOULD NOT BE MARKED STALE
    sqlx::query("INSERT INTO pending_mls_removes (id, room_id, target_user_id, queued_at, cancelled_at) VALUES ('rem_user_cancelled', 'r_stale', ?, datetime('now', '-35 days'), datetime('now', '-1 day'))")
        .bind(&user_owner)
        .execute(&pool)
        .await
        .unwrap();

    // 6. User row younger than 30d (queued_at = 10d ago) -> SHOULD NOT BE MARKED STALE
    sqlx::query("INSERT INTO pending_mls_removes (id, room_id, target_user_id, queued_at) VALUES ('rem_user_young', 'r_stale', ?, datetime('now', '-10 days'))")
        .bind(&user_owner)
        .execute(&pool)
        .await
        .unwrap();

    let config = std::sync::Arc::new(server::Config {
        pending_mls_remove_timeout_days: 30,
        ..server::Config::test_default()
    });
    let reg_store = std::sync::Arc::new(server::RegistrationStore::new());
    let login_store = std::sync::Arc::new(server::LoginStore::new());
    let rec_store = std::sync::Arc::new(server::RecoveryStore::new());
    let storage = server::build_storage(&config).unwrap();
    let hard_max = std::sync::Arc::new(server::ServerHardMax {
        file_size_bytes: 104857600,
        room_size: 1000,
        rooms_per_user: 500,
        devices_per_user: 50,
        keypackages_per_device: 50,
        message_size_bytes: 65536,
        attachment_retention_days: 365,
        call_max_participants: 50,
        reactions_per_message: 50,
        room_metadata_bytes: config.server_max_room_metadata_bytes,
        edit_window_seconds: config.server_max_edit_window_seconds,
    });

    let sockudo_cfg = server::SockudoConfig {
        http_base: mock_server.uri(),
        app_id: "chat".to_string(),
        app_key: "test-key".to_string(),
        app_secret: "test-secret".to_string(),
        enable_client_events: true,
    };
    let publisher = std::sync::Arc::new(server::Publisher::new(sockudo_cfg));

    let cleanup_ctx = server::cleanup::CleanupContext {
        pool: &pool,
        config: &config,
        registration_store: &reg_store,
        login_store: &login_store,
        recovery_store: &rec_store,
        storage: &storage,
        server_max: &hard_max,
        publisher: &publisher,
    };

    let job = server::cleanup::pending_removes::PendingRemovesJob;

    // Run 1: exactly 2 rows marked stale (rem_user_old and rem_bot_old)
    let report1 = job.run(&cleanup_ctx).await.unwrap();
    assert!(report1
        .notes
        .iter()
        .any(|n| n.contains("rows_marked_stale=2")));

    let is_stale_u: Option<String> = sqlx::query_scalar(
        "SELECT CAST(stale_at AS TEXT) FROM pending_mls_removes WHERE id = 'rem_user_old'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(is_stale_u.is_some());

    let is_stale_b: Option<String> = sqlx::query_scalar(
        "SELECT CAST(stale_at AS TEXT) FROM pending_mls_removes WHERE id = 'rem_bot_old'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(is_stale_b.is_some());

    let is_young_stale: Option<String> = sqlx::query_scalar(
        "SELECT CAST(stale_at AS TEXT) FROM pending_mls_removes WHERE id = 'rem_user_young'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(is_young_stale.is_none());

    // Verify events received on MockServer
    let requests = mock_server.received_requests().await.unwrap();
    let stale_reqs: Vec<&wiremock::Request> = requests
        .iter()
        .filter(|r| {
            let body: Value = serde_json::from_slice(&r.body).unwrap();
            body["name"] == "mls.remove_stale"
        })
        .collect();

    assert_eq!(stale_reqs.len(), 2);

    // Verify user-targeted stale payload shape
    let user_event_req = stale_reqs
        .iter()
        .find(|r| {
            let body: Value = serde_json::from_slice(&r.body).unwrap();
            let data: Value = serde_json::from_str(body["data"].as_str().unwrap()).unwrap();
            data["target_user_id"] == user_owner
        })
        .expect("user stale event");
    let user_body: Value = serde_json::from_slice(&user_event_req.body).unwrap();
    let user_data: Value = serde_json::from_str(user_body["data"].as_str().unwrap()).unwrap();
    assert_eq!(user_data["room_id"], "r_stale");
    assert_eq!(user_data["target_user_id"], user_owner);
    assert_eq!(user_data["target_bot_id"], Value::Null);
    assert!(user_data.get("stale_since").is_some());

    // Verify bot-targeted stale payload shape
    let bot_event_req = stale_reqs
        .iter()
        .find(|r| {
            let body: Value = serde_json::from_slice(&r.body).unwrap();
            let data: Value = serde_json::from_str(body["data"].as_str().unwrap()).unwrap();
            data["target_bot_id"] == "b_stale"
        })
        .expect("bot stale event");
    let bot_body: Value = serde_json::from_slice(&bot_event_req.body).unwrap();
    let bot_data: Value = serde_json::from_str(bot_body["data"].as_str().unwrap()).unwrap();
    assert_eq!(bot_data["room_id"], "r_stale");
    assert_eq!(bot_data["target_user_id"], Value::Null);
    assert_eq!(bot_data["target_bot_id"], "b_stale");
    assert!(bot_data.get("stale_since").is_some());

    // Run 2: Idempotency check -> 0 new rows marked stale, 0 events
    let report2 = job.run(&cleanup_ctx).await.unwrap();
    assert!(report2.notes.is_empty());
}

#[tokio::test]
async fn test_pending_removes_consumed_pruning_job() {
    let pool = common::setup_test_db().await;

    sqlx::query("INSERT INTO users (id, username_token, opaque_registration, identity_pubkey) VALUES ('u_prune_rem', 'tok_p_rem_1234567890123456789012345678901234567890123456789012345678901234567890123456789012', 'reg', 'pub')")
        .execute(&pool)
        .await
        .unwrap();

    sqlx::query("INSERT INTO rooms (id, owner_id) VALUES ('r_prune_rem', 'u_prune_rem')")
        .execute(&pool)
        .await
        .unwrap();

    // 1. Consumed older than 30d -> SHOULD BE PRUNED
    sqlx::query("INSERT INTO pending_mls_removes (id, room_id, target_user_id, consumed_at) VALUES ('rem_cons_old', 'r_prune_rem', 'u_prune_rem', datetime('now', '-35 days'))")
        .execute(&pool)
        .await
        .unwrap();

    // 2. Consumed within 30d -> SHOULD BE RETAINED
    sqlx::query("INSERT INTO pending_mls_removes (id, room_id, target_user_id, consumed_at) VALUES ('rem_cons_recent', 'r_prune_rem', 'u_prune_rem', datetime('now', '-10 days'))")
        .execute(&pool)
        .await
        .unwrap();

    // 3. Cancelled older than 30d -> SHOULD BE PRUNED
    sqlx::query("INSERT INTO pending_mls_removes (id, room_id, target_user_id, cancelled_at) VALUES ('rem_canc_old', 'r_prune_rem', 'u_prune_rem', datetime('now', '-40 days'))")
        .execute(&pool)
        .await
        .unwrap();

    // 4. Cancelled within 30d -> SHOULD BE RETAINED
    sqlx::query("INSERT INTO pending_mls_removes (id, room_id, target_user_id, cancelled_at) VALUES ('rem_canc_recent', 'r_prune_rem', 'u_prune_rem', datetime('now', '-5 days'))")
        .execute(&pool)
        .await
        .unwrap();

    let config = std::sync::Arc::new(server::Config {
        pending_mls_remove_timeout_days: 30,
        ..server::Config::test_default()
    });
    let reg_store = std::sync::Arc::new(server::RegistrationStore::new());
    let login_store = std::sync::Arc::new(server::LoginStore::new());
    let rec_store = std::sync::Arc::new(server::RecoveryStore::new());
    let storage = server::build_storage(&config).unwrap();
    let hard_max = std::sync::Arc::new(server::ServerHardMax {
        file_size_bytes: 104857600,
        room_size: 1000,
        rooms_per_user: 500,
        devices_per_user: 50,
        keypackages_per_device: 50,
        message_size_bytes: 65536,
        attachment_retention_days: 365,
        call_max_participants: 50,
        reactions_per_message: 50,
        room_metadata_bytes: config.server_max_room_metadata_bytes,
        edit_window_seconds: config.server_max_edit_window_seconds,
    });

    let sockudo_cfg = server::SockudoConfig {
        http_base: "http://localhost:8080".to_string(),
        app_id: "test_app".to_string(),
        app_key: "test_key".to_string(),
        app_secret: "test_secret".to_string(),
        enable_client_events: true,
    };
    let publisher = std::sync::Arc::new(server::Publisher::new(sockudo_cfg));

    let cleanup_ctx = server::cleanup::CleanupContext {
        pool: &pool,
        config: &config,
        registration_store: &reg_store,
        login_store: &login_store,
        recovery_store: &rec_store,
        storage: &storage,
        server_max: &hard_max,
        publisher: &publisher,
    };

    let job = server::cleanup::pending_removes::PendingRemovesJob;

    // Run 1: exactly 2 rows pruned (rem_cons_old and rem_canc_old)
    let report1 = job.run(&cleanup_ctx).await.unwrap();
    assert_eq!(report1.rows_deleted, 2);

    let cons_old_exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM pending_mls_removes WHERE id = 'rem_cons_old')",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(!cons_old_exists);

    let canc_old_exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM pending_mls_removes WHERE id = 'rem_canc_old')",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(!canc_old_exists);

    let cons_recent_exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM pending_mls_removes WHERE id = 'rem_cons_recent')",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(cons_recent_exists);

    let canc_recent_exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM pending_mls_removes WHERE id = 'rem_canc_recent')",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(canc_recent_exists);

    // Run 2: Idempotency check -> 0 rows deleted
    let report2 = job.run(&cleanup_ctx).await.unwrap();
    assert_eq!(report2.rows_deleted, 0);
}

#[tokio::test]
async fn test_pending_removes_confirmed_events() {
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    let mock_server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/apps/chat/events"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"ok": true})))
        .mount(&mock_server)
        .await;

    let (app, pool, _) = common::setup_test_app_with_custom_config(|cfg| {
        cfg.sockudo_url = mock_server.uri();
        cfg.sockudo_app_key = "test-key".to_string();
        cfg.sockudo_app_secret = "test-secret".to_string();
    })
    .await;

    let user_a = common::register_user(&app, "owner_conf", "Password123!", None).await;
    let (status_a, login_a) = common::login_user(
        &app,
        "owner_conf",
        "Password123!",
        "c_conf_a_123456789",
        None,
    )
    .await;
    assert_eq!(status_a, StatusCode::OK, "login_a failed: {:?}", login_a);
    let token_a = login_a["session_token"]
        .as_str()
        .expect("missing session_token in login_a");

    sqlx::query(
        "INSERT INTO server_invites (id, code, max_uses, current_uses) VALUES ('inv_conf_b', 'INV_CONF_B', 1, 0)",
    )
    .execute(&pool)
    .await
    .unwrap();

    let user_b =
        common::register_user(&app, "target_conf", "Password123!", Some("INV_CONF_B")).await;
    let (status_b, login_b) = common::login_user(
        &app,
        "target_conf",
        "Password123!",
        "c_conf_b_123456789",
        None,
    )
    .await;
    assert_eq!(status_b, StatusCode::OK, "login_b failed: {:?}", login_b);

    // Create room
    let create_req = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({}).to_string()))
        .unwrap();

    let resp = tower::ServiceExt::oneshot(app.clone(), create_req)
        .await
        .unwrap();
    let room_json: Value = serde_json::from_slice(
        &axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    let room_id = room_json["id"].as_str().unwrap();

    // Add user_b & kick user_b
    let add_req = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/members", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "user_id": user_b }).to_string()))
        .unwrap();
    let _ = tower::ServiceExt::oneshot(app.clone(), add_req)
        .await
        .unwrap();

    let kick_req = Request::builder()
        .method("DELETE")
        .uri(format!("/api/v1/rooms/{}/members/{}", room_id, user_b))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();
    let _ = tower::ServiceExt::oneshot(app.clone(), kick_req)
        .await
        .unwrap();

    // List removes
    let list_req = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/rooms/{}/pending-removes", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();
    let list_resp = tower::ServiceExt::oneshot(app.clone(), list_req)
        .await
        .unwrap();
    let list_json: Value = serde_json::from_slice(
        &axum::body::to_bytes(list_resp.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    let remove_id = list_json["removes"][0]["id"].as_str().unwrap();

    // Consume remove
    let consume_req = Request::builder()
        .method("POST")
        .uri(format!(
            "/api/v1/rooms/{}/pending-removes/{}/consume",
            room_id, remove_id
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();

    let consume_resp = tower::ServiceExt::oneshot(app.clone(), consume_req)
        .await
        .unwrap();
    assert_eq!(consume_resp.status(), StatusCode::NO_CONTENT);

    // Verify events received on MockServer
    let requests = mock_server.received_requests().await.unwrap();

    // 1. Room channel event
    let room_conf_req = requests
        .iter()
        .find(|r| {
            let body: Value = serde_json::from_slice(&r.body).unwrap();
            body["name"] == "mls.remove_confirmed"
                && body["channels"] == json!([format!("private-room-{}", room_id)])
        })
        .expect("mls.remove_confirmed room event");

    let r_body: Value = serde_json::from_slice(&room_conf_req.body).unwrap();
    let r_data: Value = serde_json::from_str(r_body["data"].as_str().unwrap()).unwrap();
    assert_eq!(r_data["room_id"], room_id);
    assert_eq!(r_data["target_user_id"], user_b);
    assert_eq!(r_data["target_bot_id"], Value::Null);
    assert!(r_data.get("confirmed_at").is_some());

    // 2. User channel events (for target_user_id and for requester user_a)
    let user_a_conf_req = requests
        .iter()
        .find(|r| {
            let body: Value = serde_json::from_slice(&r.body).unwrap();
            body["name"] == "mls.remove_confirmed"
                && body["channels"] == json!([format!("private-user-{}", user_a)])
        })
        .expect("mls.remove_confirmed user A event");

    let u_body: Value = serde_json::from_slice(&user_a_conf_req.body).unwrap();
    let u_envelope: Value = serde_json::from_str(u_body["data"].as_str().unwrap()).unwrap();
    assert_eq!(u_envelope["event_type"], "mls.remove_confirmed");
    assert!(u_envelope["user_seq"].as_i64().unwrap() >= 1);
    let u_payload = &u_envelope["payload"];
    assert_eq!(u_payload["room_id"], room_id);
    assert_eq!(u_payload["target_user_id"], user_b);
    assert_eq!(u_payload["target_bot_id"], Value::Null);
    assert!(u_payload.get("confirmed_at").is_some());
}
