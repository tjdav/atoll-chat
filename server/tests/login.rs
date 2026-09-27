mod common;

use axum::{
    body::Body,
    http::{header, Request, StatusCode},
};
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use common::{login_user, register_user, setup_test_app};
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
    assert_eq!(body["username"], "alice");

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
                "username": "alice",
                "credential_request": cred_req_b64,
                "client_id": TEST_CLIENT_ID,
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
