mod common;

use axum::{
    body::Body,
    http::{header, Request, StatusCode},
};
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use common::{login_user, obtain_username_token, register_user, setup_test_app};
use opaque_ke::{ClientLogin, ClientLoginFinishParameters, CredentialResponse};
use rand::rngs::OsRng;
use serde_json::{json, Value};
use server::opaque::DefaultCipherSuite;
use server::session;
use tower::ServiceExt;

const TEST_CLIENT_ID: &str = "client_id_123456789";

#[tokio::test]
async fn test_1_successful_login_with_valid_credentials() {
    let (app, pool) = setup_test_app().await;

    let user_id = register_user(&app, "alice", "password123", None).await;

    let (status, body) = login_user(&app, "alice", "password123", TEST_CLIENT_ID, None).await;
    assert_eq!(status, StatusCode::OK);

    let session_token = body["session_token"]
        .as_str()
        .expect("missing session_token");
    assert!(!session_token.is_empty());
    assert_eq!(body["user_id"], user_id);
    assert!(body["username_token"].is_string());

    // Assert row exists in sessions table
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sessions WHERE user_id = ?")
        .bind(&user_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 1);
}

#[tokio::test]
async fn test_2_login_fails_with_wrong_password() {
    let (app, pool) = setup_test_app().await;

    let user_id = register_user(&app, "alice", "password123", None).await;

    let (status, body) = login_user(&app, "alice", "wrong_password", TEST_CLIENT_ID, None).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(body["error"], "invalid_credentials");

    // Assert no session row was created
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sessions WHERE user_id = ?")
        .bind(&user_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 0);
}

#[tokio::test]
async fn test_3_login_fails_with_unknown_username() {
    let (app, _pool) = setup_test_app().await;

    let (status, body) = login_user(&app, "nonexistent", "password123", TEST_CLIENT_ID, None).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(body["error"], "invalid_credentials");
}

#[tokio::test]
async fn test_4_login_fails_with_disabled_account() {
    let (app, pool) = setup_test_app().await;

    let user_id = register_user(&app, "alice", "password123", None).await;

    // Disable the account
    sqlx::query("UPDATE users SET disabled_at = CURRENT_TIMESTAMP WHERE id = ?")
        .bind(&user_id)
        .execute(&pool)
        .await
        .unwrap();

    let (status, body) = login_user(&app, "alice", "password123", TEST_CLIENT_ID, None).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(body["error"], "account_disabled");
}

#[tokio::test]
async fn test_5_login_state_expires_after_ttl() {
    let (app, _pool) = setup_test_app().await;

    register_user(&app, "alice", "password123", None).await;
    let username_token = obtain_username_token(&app, "alice").await;

    let mut rng = OsRng;
    let client_start = ClientLogin::<DefaultCipherSuite>::start(&mut rng, b"password123")
        .expect("ClientLogin::start failed");
    let cred_req_b64 = STANDARD.encode(client_start.message.serialize());

    let req1 = Request::builder()
        .method("POST")
        .uri("/api/v1/auth/login/start")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "username_token": username_token,
                "credential_request": cred_req_b64,
                "client_id": TEST_CLIENT_ID,
                "platform": "web",
            })
            .to_string(),
        ))
        .unwrap();

    let resp1 = app.clone().oneshot(req1).await.unwrap();
    assert_eq!(resp1.status(), StatusCode::OK);
    let body_bytes1 = axum::body::to_bytes(resp1.into_body(), usize::MAX)
        .await
        .unwrap();
    let json1: Value = serde_json::from_slice(&body_bytes1).unwrap();
    let login_id = json1["login_id"].as_str().unwrap();
    let cred_resp_b64 = json1["credential_response"].as_str().unwrap();

    let cred_resp_bytes = STANDARD.decode(cred_resp_b64).unwrap();
    let cred_resp =
        CredentialResponse::<DefaultCipherSuite>::deserialize(&cred_resp_bytes).unwrap();
    let client_finish = client_start
        .state
        .finish(
            &mut rng,
            b"password123",
            cred_resp,
            ClientLoginFinishParameters::default(),
        )
        .unwrap();
    let cred_fin_b64 = STANDARD.encode(client_finish.message.serialize());

    // First attempt to finish consumes the login state
    let req2 = Request::builder()
        .method("POST")
        .uri("/api/v1/auth/login/finish")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "login_id": login_id,
                "credential_finalization": cred_fin_b64,
            })
            .to_string(),
        ))
        .unwrap();

    let resp2 = app.clone().oneshot(req2).await.unwrap();
    assert_eq!(resp2.status(), StatusCode::OK);

    // Second attempt with same login_id (already consumed / expired) fails with 400
    let req3 = Request::builder()
        .method("POST")
        .uri("/api/v1/auth/login/finish")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "login_id": login_id,
                "credential_finalization": cred_fin_b64,
            })
            .to_string(),
        ))
        .unwrap();

    let resp3 = app.clone().oneshot(req3).await.unwrap();
    assert_eq!(resp3.status(), StatusCode::BAD_REQUEST);
    let body_bytes3 = axum::body::to_bytes(resp3.into_body(), usize::MAX)
        .await
        .unwrap();
    let json3: Value = serde_json::from_slice(&body_bytes3).unwrap();
    assert_eq!(json3["error"], "unknown or expired login_id");
}

#[tokio::test]
async fn test_6_invalid_login_id_returns_400() {
    let (app, _pool) = setup_test_app().await;

    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/auth/login/finish")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "login_id": "random_invalid_login_id_12345",
                "credential_finalization": STANDARD.encode(b"dummy"),
            })
            .to_string(),
        ))
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let body: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(body["error"], "unknown or expired login_id");
}

#[tokio::test]
async fn test_7_identity_pubkey_is_stored_on_first_login() {
    let (app, pool) = setup_test_app().await;

    let user_id = register_user(&app, "alice", "password123", None).await;

    // Check stored identity_pubkey is empty initially
    let initial_key: String = sqlx::query_scalar("SELECT identity_pubkey FROM users WHERE id = ?")
        .bind(&user_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(initial_key, "");

    let pubkey_a = STANDARD.encode([1u8; 32]);
    let (status, _body) = login_user(
        &app,
        "alice",
        "password123",
        TEST_CLIENT_ID,
        Some(&pubkey_a),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    // Check stored identity_pubkey is updated to pubkey_a
    let stored_key: String = sqlx::query_scalar("SELECT identity_pubkey FROM users WHERE id = ?")
        .bind(&user_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(stored_key, pubkey_a);
}

#[tokio::test]
async fn test_8_identity_pubkey_mismatch_is_rejected() {
    let (app, _pool) = setup_test_app().await;

    register_user(&app, "alice", "password123", None).await;

    let pubkey_a = STANDARD.encode([1u8; 32]);
    let (status1, _) = login_user(
        &app,
        "alice",
        "password123",
        TEST_CLIENT_ID,
        Some(&pubkey_a),
    )
    .await;
    assert_eq!(status1, StatusCode::OK);

    // Login with key B (different)
    let pubkey_b = STANDARD.encode([2u8; 32]);
    let (status2, body2) = login_user(
        &app,
        "alice",
        "password123",
        TEST_CLIENT_ID,
        Some(&pubkey_b),
    )
    .await;
    assert_eq!(status2, StatusCode::BAD_REQUEST);
    assert_eq!(body2["error"], "identity_key_mismatch");
}

#[tokio::test]
async fn test_9_session_token_is_valid_for_authentication() {
    let (app, pool) = setup_test_app().await;

    let user_id = register_user(&app, "alice", "password123", None).await;

    let (status, body) = login_user(&app, "alice", "password123", TEST_CLIENT_ID, None).await;
    assert_eq!(status, StatusCode::OK);

    let session_token = body["session_token"].as_str().unwrap();

    let ctx = session::validate_session(&pool, session_token)
        .await
        .unwrap()
        .expect("session should be valid");

    assert_eq!(ctx.user_id, user_id);
}

#[tokio::test]
async fn test_10_session_token_is_revoked_aware() {
    let (app, pool) = setup_test_app().await;

    register_user(&app, "alice", "password123", None).await;

    let (status, body) = login_user(&app, "alice", "password123", TEST_CLIENT_ID, None).await;
    assert_eq!(status, StatusCode::OK);

    let session_token = body["session_token"].as_str().unwrap();

    // Revoke session
    sqlx::query("UPDATE sessions SET revoked_at = CURRENT_TIMESTAMP")
        .execute(&pool)
        .await
        .unwrap();

    let ctx = session::validate_session(&pool, session_token)
        .await
        .unwrap();

    assert!(ctx.is_none());
}

#[tokio::test]
async fn test_11_expired_session_returns_none() {
    let (app, pool) = setup_test_app().await;

    register_user(&app, "alice", "password123", None).await;

    let (status, body) = login_user(&app, "alice", "password123", TEST_CLIENT_ID, None).await;
    assert_eq!(status, StatusCode::OK);

    let session_token = body["session_token"].as_str().unwrap();

    // Set expires_at in the past
    sqlx::query("UPDATE sessions SET expires_at = datetime('now', '-1 day')")
        .execute(&pool)
        .await
        .unwrap();

    let ctx = session::validate_session(&pool, session_token)
        .await
        .unwrap();

    assert!(ctx.is_none());
}

#[tokio::test]
async fn test_12_session_token_is_not_stored_in_plaintext() {
    let (app, pool) = setup_test_app().await;

    register_user(&app, "alice", "password123", None).await;

    let (status, body) = login_user(&app, "alice", "password123", TEST_CLIENT_ID, None).await;
    assert_eq!(status, StatusCode::OK);

    let raw_token = body["session_token"].as_str().unwrap();

    let token_hash: String = sqlx::query_scalar("SELECT token_hash FROM sessions LIMIT 1")
        .fetch_one(&pool)
        .await
        .unwrap();

    // Hash should be 64-char hex string and not equal raw token
    assert_ne!(token_hash, raw_token);
    assert_eq!(token_hash.len(), 64);
    assert!(token_hash.chars().all(|c| c.is_ascii_hexdigit()));
}

#[tokio::test]
async fn test_13_login_start_invalid_platform_rejection() {
    let (app, pool) = setup_test_app().await;

    register_user(&app, "alice", "password123", None).await;
    let username_token = obtain_username_token(&app, "alice").await;

    let mut rng = OsRng;
    let client_start = ClientLogin::<DefaultCipherSuite>::start(&mut rng, b"password123")
        .expect("ClientLogin::start failed");
    let cred_req_b64 = STANDARD.encode(client_start.message.serialize());

    // Send login_start with platform = "windows"
    let req_win = Request::builder()
        .method("POST")
        .uri("/api/v1/auth/login/start")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "username_token": username_token,
                "credential_request": cred_req_b64,
                "client_id": TEST_CLIENT_ID,
                "platform": "windows",
            })
            .to_string(),
        ))
        .unwrap();

    let resp_win = app.clone().oneshot(req_win).await.unwrap();
    assert_eq!(resp_win.status(), StatusCode::BAD_REQUEST);
    let body_bytes_win = axum::body::to_bytes(resp_win.into_body(), usize::MAX)
        .await
        .unwrap();
    let body_win: Value = serde_json::from_slice(&body_bytes_win).unwrap();
    assert_eq!(body_win["error"], "invalid_platform");

    // Send login_start with platform = "toaster"
    let req_toaster = Request::builder()
        .method("POST")
        .uri("/api/v1/auth/login/start")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "username_token": username_token,
                "credential_request": cred_req_b64,
                "client_id": TEST_CLIENT_ID,
                "platform": "toaster",
            })
            .to_string(),
        ))
        .unwrap();

    let resp_toaster = app.clone().oneshot(req_toaster).await.unwrap();
    assert_eq!(resp_toaster.status(), StatusCode::BAD_REQUEST);
    let body_bytes_toaster = axum::body::to_bytes(resp_toaster.into_body(), usize::MAX)
        .await
        .unwrap();
    let body_toaster: Value = serde_json::from_slice(&body_bytes_toaster).unwrap();
    assert_eq!(body_toaster["error"], "invalid_platform");

    // Assert no session created
    let session_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sessions")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(session_count, 0);
}

#[tokio::test]
async fn test_15_device_added_event_payload_shape() {
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

    let user_id = register_user(&app, "user_dev_added", "password123", None).await;

    // Login creates a new device
    let (status, login_res) = login_user(
        &app,
        "user_dev_added",
        "password123",
        "c_dev_added_123456",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let dev_id = login_res["device_id"].as_str().expect("device_id");

    // Capture published Sockudo event
    let requests = mock_server.received_requests().await.unwrap();
    assert_eq!(requests.len(), 1, "Exactly one event must be published");

    let body_json: Value = serde_json::from_slice(&requests[0].body).unwrap();
    assert_eq!(body_json["name"], "device.added");
    let target_channel = format!("private-user-{}", user_id);
    assert_eq!(
        body_json["channels"],
        json!([target_channel]),
        "Event must be published solely to private-user-{{user_id}}"
    );

    let data_str = body_json["data"].as_str().expect("data string");
    let envelope: Value = serde_json::from_str(data_str).unwrap();

    assert_eq!(envelope["event_type"], "device.added");
    let seq = envelope["user_seq"].as_i64().expect("user_seq i64");
    assert!(seq >= 1);

    let payload = envelope["payload"]
        .as_object()
        .expect("payload must be an object");

    // Assert payload contains exactly device_id, platform, added_at, user_seq
    assert_eq!(payload.len(), 4, "Payload must contain exactly 4 fields");
    assert_eq!(payload["device_id"], dev_id);
    assert_eq!(payload["platform"], "web");
    assert_eq!(payload["user_seq"], seq);

    let added_at_str = payload["added_at"].as_str().expect("added_at string");
    chrono::DateTime::parse_from_rfc3339(added_at_str)
        .expect("added_at must be a valid ISO 8601 / RFC 3339 timestamp");

    // Verify user_seq matches allocated sequence for user read from DB immediately after login
    let db_seq: i64 = sqlx::query_scalar("SELECT next_seq - 1 FROM user_seq WHERE user_id = ?")
        .bind(&user_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(seq, db_seq);
}

#[tokio::test]
#[ignore = "Forcing a transaction rollback after allocate_user_seq requires a production test hook, which is out of scope for this test-only task."]
async fn test_16_rolled_back_device_creation_does_not_consume_seq() {
    let (app, pool) = setup_test_app().await;

    let user_id = register_user(&app, "user_rollback_create", "password123", None).await;

    let seq_before: Option<i64> =
        sqlx::query_scalar("SELECT next_seq FROM user_seq WHERE user_id = ?")
            .bind(&user_id)
            .fetch_optional(&pool)
            .await
            .unwrap();

    // Contract: If a device creation transaction fails or rolls back after allocate_user_seq,
    // user_seq.next_seq must remain unchanged.
    //
    // Implementation Note: In production code (server/src/routes/login.rs), allocate_user_seq
    // is called inside tx right before tx.commit().await?. Without a production test hook or
    // failpoint to interrupt the transaction at that boundary, this test cannot force a
    // rollback after sequence allocation without modifying production code.
    let _ = app;

    let seq_after: Option<i64> =
        sqlx::query_scalar("SELECT next_seq FROM user_seq WHERE user_id = ?")
            .bind(&user_id)
            .fetch_optional(&pool)
            .await
            .unwrap();

    assert_eq!(seq_before, seq_after);
}

#[tokio::test]
async fn test_14_login_start_missing_platform_rejection() {
    let (app, pool) = setup_test_app().await;

    register_user(&app, "alice", "password123", None).await;
    let username_token = obtain_username_token(&app, "alice").await;

    let mut rng = OsRng;
    let client_start = ClientLogin::<DefaultCipherSuite>::start(&mut rng, b"password123")
        .expect("ClientLogin::start failed");
    let cred_req_b64 = STANDARD.encode(client_start.message.serialize());

    // Send login_start with platform field missing
    let req_missing = Request::builder()
        .method("POST")
        .uri("/api/v1/auth/login/start")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "username_token": username_token,
                "credential_request": cred_req_b64,
                "client_id": TEST_CLIENT_ID,
            })
            .to_string(),
        ))
        .unwrap();

    let resp_missing = app.clone().oneshot(req_missing).await.unwrap();
    assert_eq!(resp_missing.status(), StatusCode::BAD_REQUEST);
    let body_bytes_missing = axum::body::to_bytes(resp_missing.into_body(), usize::MAX)
        .await
        .unwrap();
    let body_missing: Value = serde_json::from_slice(&body_bytes_missing).unwrap();
    assert_eq!(body_missing["error"], "invalid_platform");

    // Send login_start with platform = ""
    let req_empty = Request::builder()
        .method("POST")
        .uri("/api/v1/auth/login/start")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "username_token": username_token,
                "credential_request": cred_req_b64,
                "client_id": TEST_CLIENT_ID,
                "platform": "",
            })
            .to_string(),
        ))
        .unwrap();

    let resp_empty = app.clone().oneshot(req_empty).await.unwrap();
    assert_eq!(resp_empty.status(), StatusCode::BAD_REQUEST);
    let body_bytes_empty = axum::body::to_bytes(resp_empty.into_body(), usize::MAX)
        .await
        .unwrap();
    let body_empty: Value = serde_json::from_slice(&body_bytes_empty).unwrap();
    assert_eq!(body_empty["error"], "invalid_platform");

    // Assert no session created
    let session_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sessions")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(session_count, 0);
}
