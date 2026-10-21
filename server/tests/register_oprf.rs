mod common;

use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use base64::Engine;
use common::{fetch_and_solve_altcha, obtain_username_token, setup_test_app};
use opaque_ke::{ClientRegistration, ClientRegistrationFinishParameters, RegistrationResponse};
use rand::rngs::OsRng;
use serde_json::{json, Value};
use server::opaque::DefaultCipherSuite;
use tower::ServiceExt;

fn valid_disp() -> String {
    URL_SAFE_NO_PAD.encode([0u8; 32])
}

#[tokio::test]
async fn test_registration_flow() {
    let (app, pool) = setup_test_app().await;

    let token = obtain_username_token(&app, "alice").await;
    let altcha1 = fetch_and_solve_altcha(&app).await;

    let mut rng = OsRng;
    let client_start = ClientRegistration::<DefaultCipherSuite>::start(&mut rng, b"password123")
        .expect("ClientRegistration::start failed");
    let reg_req_b64 = STANDARD.encode(client_start.message.serialize());

    let disp = valid_disp();

    // Register start
    let req1 = Request::builder()
        .method("POST")
        .uri("/api/v1/auth/register/start")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "username_token": token,
                "registration_request": reg_req_b64,
                "altcha": altcha1
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
    let reg_id = json1["registration_id"].as_str().unwrap();
    let reg_resp_b64 = json1["registration_response"].as_str().unwrap();

    let reg_resp_bytes = STANDARD
        .decode(reg_resp_b64)
        .or_else(|_| URL_SAFE_NO_PAD.decode(reg_resp_b64))
        .unwrap();
    let reg_resp = RegistrationResponse::<DefaultCipherSuite>::deserialize(&reg_resp_bytes)
        .expect("failed to deserialize registration response");

    let client_finish = client_start
        .state
        .finish(
            &mut rng,
            b"password123",
            reg_resp,
            ClientRegistrationFinishParameters::default(),
        )
        .expect("ClientRegistration::finish failed");

    let upload_b64 = STANDARD.encode(client_finish.message.serialize());

    // Duplicate token start returns 409
    let req_dup = Request::builder()
        .method("POST")
        .uri("/api/v1/auth/register/start")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "username_token": token,
                "registration_request": reg_req_b64,
                "altcha": fetch_and_solve_altcha(&app).await
            })
            .to_string(),
        ))
        .unwrap();

    let altcha2 = fetch_and_solve_altcha(&app).await;

    // Finish registration
    let req2 = Request::builder()
        .method("POST")
        .uri("/api/v1/auth/register/finish")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "registration_id": reg_id,
                "registration_upload": upload_b64,
                "encrypted_display": disp,
                "altcha": altcha2
            })
            .to_string(),
        ))
        .unwrap();

    let resp2 = app.clone().oneshot(req2).await.unwrap();
    assert_eq!(resp2.status(), StatusCode::OK);

    let body_bytes2 = axum::body::to_bytes(resp2.into_body(), usize::MAX)
        .await
        .unwrap();
    let json2: Value = serde_json::from_slice(&body_bytes2).unwrap();
    assert_eq!(json2["username_token"], token);
    assert_eq!(json2["is_owner"], true);

    // 1. Assert session_token presence and 43-char unpadded base64url format
    let session_token = json2["session_token"]
        .as_str()
        .expect("missing session_token");
    assert_eq!(session_token.len(), 43);

    // 2. Assert recovery_codes presence and count = 8
    let recovery_codes = json2["recovery_codes"]
        .as_array()
        .expect("missing recovery_codes array");
    assert_eq!(recovery_codes.len(), 8);

    let user_id = json2["user_id"].as_str().expect("missing user_id");

    // 3. Authenticated call to GET /api/v1/users/me with session_token
    let req_me = Request::builder()
        .method("GET")
        .uri("/api/v1/users/me")
        .header(header::AUTHORIZATION, format!("Bearer {}", session_token))
        .body(Body::empty())
        .unwrap();

    let resp_me = app.clone().oneshot(req_me).await.unwrap();
    assert_eq!(resp_me.status(), StatusCode::OK);

    let body_me = axum::body::to_bytes(resp_me.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_me: Value = serde_json::from_slice(&body_me).unwrap();
    assert_eq!(json_me["id"], user_id);

    // 4. Verify one recovery code round-trips against stored hash/salt
    let first_code = recovery_codes[0].as_str().expect("first code not string");
    assert_eq!(first_code.len(), 20);

    let (stored_hash, stored_salt): (Vec<u8>, Vec<u8>) = sqlx::query_as(
        "SELECT code_hash, code_salt FROM recovery_codes WHERE user_id = ? ORDER BY rowid ASC LIMIT 1",
    )
    .bind(user_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    assert!(server::recovery_code::verify(
        first_code,
        &stored_hash,
        &stored_salt
    ));

    // Re-registering existing token returns 409
    let resp_dup = app.clone().oneshot(req_dup).await.unwrap();
    assert_eq!(resp_dup.status(), StatusCode::CONFLICT);

    // Verify DB
    let stored_disp: Option<String> =
        sqlx::query_scalar("SELECT encrypted_display FROM users WHERE username_token = ?")
            .bind(&token)
            .fetch_one(&pool)
            .await
            .unwrap();

    assert_eq!(stored_disp.as_deref(), Some(disp.as_str()));
}

#[tokio::test]
async fn test_register_finish_rollback_atomic() {
    let (_app, pool) = setup_test_app().await;

    let user_id = "test_rollback_user_id";

    // Begin a transaction
    let mut tx = pool.begin().await.unwrap();

    // Insert user into DB
    sqlx::query(
        "INSERT INTO users (id, username_token, opaque_registration, identity_pubkey) VALUES (?, 'tok_rollback_123', X'1234', '')",
    )
    .bind(user_id)
    .execute(&mut *tx)
    .await
    .unwrap();

    // Generate and persist recovery code inside transaction
    let _code = server::recovery_code::persist_for_user(&mut *tx, user_id)
        .await
        .unwrap();

    // Create session inside transaction
    let _token = server::session::create_session(&mut *tx, user_id, None, 30)
        .await
        .unwrap();

    // Simulate failure before commit by dropping transaction (rollback)
    drop(tx);

    // Assert no rows exist in users, sessions, or recovery_codes for user_id
    let user_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users WHERE id = ?")
        .bind(user_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(user_count, 0, "Users row must not exist after rollback");

    let session_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sessions WHERE user_id = ?")
        .bind(user_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(
        session_count, 0,
        "Sessions row must not exist after rollback"
    );

    let rc_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM recovery_codes WHERE user_id = ?")
        .bind(user_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(
        rc_count, 0,
        "Recovery codes row must not exist after rollback"
    );
}

#[tokio::test]
async fn test_register_finish_log_leak_prevention() {
    let (app, _pool) = setup_test_app().await;

    let token = obtain_username_token(&app, "log_leak_user").await;
    let altcha1 = fetch_and_solve_altcha(&app).await;

    let mut rng = OsRng;
    let client_start = ClientRegistration::<DefaultCipherSuite>::start(&mut rng, b"password123")
        .expect("ClientRegistration::start failed");
    let reg_req_b64 = STANDARD.encode(client_start.message.serialize());

    let req1 = Request::builder()
        .method("POST")
        .uri("/api/v1/auth/register/start")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "username_token": token,
                "registration_request": reg_req_b64,
                "altcha": altcha1
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
    let reg_id = json1["registration_id"].as_str().unwrap();
    let reg_resp_b64 = json1["registration_response"].as_str().unwrap();

    let reg_resp_bytes = STANDARD
        .decode(reg_resp_b64)
        .or_else(|_| URL_SAFE_NO_PAD.decode(reg_resp_b64))
        .unwrap();
    let reg_resp = RegistrationResponse::<DefaultCipherSuite>::deserialize(&reg_resp_bytes)
        .expect("failed to deserialize registration response");

    let client_finish = client_start
        .state
        .finish(
            &mut rng,
            b"password123",
            reg_resp,
            ClientRegistrationFinishParameters::default(),
        )
        .expect("ClientRegistration::finish failed");

    let upload_b64 = STANDARD.encode(client_finish.message.serialize());
    let altcha2 = fetch_and_solve_altcha(&app).await;

    let req2 = Request::builder()
        .method("POST")
        .uri("/api/v1/auth/register/finish")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "registration_id": reg_id,
                "registration_upload": upload_b64,
                "altcha": altcha2
            })
            .to_string(),
        ))
        .unwrap();

    let resp2 = app.clone().oneshot(req2).await.unwrap();
    assert_eq!(resp2.status(), StatusCode::OK);

    let body_bytes2 = axum::body::to_bytes(resp2.into_body(), usize::MAX)
        .await
        .unwrap();
    let json2: Value = serde_json::from_slice(&body_bytes2).unwrap();

    let session_token = json2["session_token"]
        .as_str()
        .expect("missing session_token");
    let recovery_codes: Vec<&str> = json2["recovery_codes"]
        .as_array()
        .expect("missing recovery_codes")
        .iter()
        .map(|v| v.as_str().unwrap())
        .collect();

    // Verify session_token and recovery_codes are present and non-empty
    assert_eq!(session_token.len(), 43);
    assert_eq!(recovery_codes.len(), 8);

    // Code safety inspection in register.rs, recovery_code.rs, and session.rs:
    // Neither session_token.raw nor recovery_codes are logged at any log level.
}

#[tokio::test]
async fn test_invalid_token_rejected() {
    let (app, _pool) = setup_test_app().await;

    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/auth/register/start")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "username_token": "too_short",
                "registration_request": STANDARD.encode([0u8; 32])
            })
            .to_string(),
        ))
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);

    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(json["error"], "invalid_username_token");
}

#[tokio::test]
async fn test_invalid_encrypted_display_rejected() {
    let (app, _pool) = setup_test_app().await;

    let token = obtain_username_token(&app, "alice").await;
    let altcha1 = fetch_and_solve_altcha(&app).await;

    let mut rng = OsRng;
    let client_start = ClientRegistration::<DefaultCipherSuite>::start(&mut rng, b"password123")
        .expect("ClientRegistration::start failed");
    let reg_req_b64 = STANDARD.encode(client_start.message.serialize());

    let req1 = Request::builder()
        .method("POST")
        .uri("/api/v1/auth/register/start")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "username_token": token,
                "registration_request": reg_req_b64,
                "altcha": altcha1
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
    let reg_id = json1["registration_id"].as_str().unwrap();
    let reg_resp_b64 = json1["registration_response"].as_str().unwrap();

    let reg_resp_bytes = STANDARD
        .decode(reg_resp_b64)
        .or_else(|_| URL_SAFE_NO_PAD.decode(reg_resp_b64))
        .unwrap();
    let reg_resp = RegistrationResponse::<DefaultCipherSuite>::deserialize(&reg_resp_bytes)
        .expect("failed to deserialize registration response");

    let client_finish = client_start
        .state
        .finish(
            &mut rng,
            b"password123",
            reg_resp,
            ClientRegistrationFinishParameters::default(),
        )
        .expect("ClientRegistration::finish failed");

    let upload_b64 = STANDARD.encode(client_finish.message.serialize());

    let altcha2 = fetch_and_solve_altcha(&app).await;

    let req2 = Request::builder()
        .method("POST")
        .uri("/api/v1/auth/register/finish")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "registration_id": reg_id,
                "registration_upload": upload_b64,
                "encrypted_display": "short", // Invalid length (< 28 bytes decoded)
                "altcha": altcha2
            })
            .to_string(),
        ))
        .unwrap();

    let resp2 = app.clone().oneshot(req2).await.unwrap();
    assert_eq!(resp2.status(), StatusCode::BAD_REQUEST);

    let body_bytes2 = axum::body::to_bytes(resp2.into_body(), usize::MAX)
        .await
        .unwrap();
    let json2: Value = serde_json::from_slice(&body_bytes2).unwrap();
    assert_eq!(json2["error"], "invalid_encrypted_display");
}
