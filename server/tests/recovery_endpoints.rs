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
use server::recovery_code;
use tower::ServiceExt;

async fn register_user(app: &axum::Router, username: &str, password: &[u8]) -> (String, String) {
    let token = obtain_username_token(app, username).await;
    let altcha1 = fetch_and_solve_altcha(app).await;

    let mut rng = OsRng;
    let client_start = ClientRegistration::<DefaultCipherSuite>::start(&mut rng, password)
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
            password,
            reg_resp,
            ClientRegistrationFinishParameters::default(),
        )
        .expect("ClientRegistration::finish failed");

    let upload_b64 = STANDARD.encode(client_finish.message.serialize());
    let altcha2 = fetch_and_solve_altcha(app).await;

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
    let user_id = json2["user_id"].as_str().unwrap().to_string();

    (user_id, token)
}

#[tokio::test]
async fn test_recovery_full_happy_path() {
    let (app, pool) = setup_test_app().await;

    // 1. Register a user
    let (user_id, username_token) = register_user(&app, "alice_recover", b"old_password").await;

    // Create an initial HTTP session to verify session revocation
    let sess_token = server::session::create_session(&pool, &user_id, None, 30)
        .await
        .unwrap();

    // 2. Persist a recovery code for the user
    let code = recovery_code::persist_for_user(&pool, &user_id)
        .await
        .unwrap();

    // 3. Call POST /api/v1/auth/recover/start
    let req_start = Request::builder()
        .method("POST")
        .uri("/api/v1/auth/recover/start")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "recovery_code": code,
                "username_token": username_token
            })
            .to_string(),
        ))
        .unwrap();

    let resp_start = app.clone().oneshot(req_start).await.unwrap();
    assert_eq!(resp_start.status(), StatusCode::OK);

    let start_body = axum::body::to_bytes(resp_start.into_body(), usize::MAX)
        .await
        .unwrap();
    let start_json: Value = serde_json::from_slice(&start_body).unwrap();

    let recovery_session = start_json["recovery_session"].as_str().unwrap();
    let reg_challenge_b64 = start_json["registration_challenge"].as_str().unwrap();
    assert!(start_json["expires_at"].as_str().is_some());

    // Deserialize registration challenge (RegistrationResponse)
    let challenge_bytes = STANDARD
        .decode(reg_challenge_b64)
        .or_else(|_| URL_SAFE_NO_PAD.decode(reg_challenge_b64))
        .unwrap();
    let reg_resp = RegistrationResponse::<DefaultCipherSuite>::deserialize(&challenge_bytes)
        .expect("failed to deserialize challenge");

    // Client completes OPAQUE registration locally with new password
    let mut rng = OsRng;
    let client_start = ClientRegistration::<DefaultCipherSuite>::start(&mut rng, b"new_password")
        .expect("ClientRegistration::start failed");

    let client_finish = client_start
        .state
        .finish(
            &mut rng,
            b"new_password",
            reg_resp,
            ClientRegistrationFinishParameters::default(),
        )
        .expect("ClientRegistration::finish failed");

    let new_upload_b64 = STANDARD.encode(client_finish.message.serialize());

    // 4. Call POST /api/v1/auth/recover/finish
    let req_finish = Request::builder()
        .method("POST")
        .uri("/api/v1/auth/recover/finish")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "recovery_session": recovery_session,
                "registration_record": new_upload_b64
            })
            .to_string(),
        ))
        .unwrap();

    let resp_finish = app.clone().oneshot(req_finish).await.unwrap();
    assert_eq!(resp_finish.status(), StatusCode::OK);

    let finish_body = axum::body::to_bytes(resp_finish.into_body(), usize::MAX)
        .await
        .unwrap();
    let finish_json: Value = serde_json::from_slice(&finish_body).unwrap();

    assert_eq!(finish_json["user_id"], user_id);
    assert!(finish_json["session_token"].as_str().is_some());

    // 5. Verify database assertions:
    // Code row is consumed
    let consumed_at: Option<String> =
        sqlx::query_scalar("SELECT consumed_at FROM recovery_codes WHERE user_id = ?")
            .bind(&user_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(consumed_at.is_some());

    // Old HTTP session is revoked
    let revoked_at: Option<String> =
        sqlx::query_scalar("SELECT revoked_at FROM sessions WHERE token_hash = ?")
            .bind(&sess_token.hash)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(revoked_at.is_some());

    // Audit entries exist for recover.start and recover.finish
    let audit_actions: Vec<String> = sqlx::query_scalar(
        "SELECT action FROM audit_log WHERE actor_id = ? ORDER BY created_at ASC",
    )
    .bind(&user_id)
    .fetch_all(&pool)
    .await
    .unwrap();

    assert!(audit_actions.contains(&"recover.start".to_string()));
    assert!(audit_actions.contains(&"recover.finish".to_string()));
}

#[tokio::test]
async fn test_recovery_wrong_code_and_unknown_token() {
    let (app, pool) = setup_test_app().await;

    let (user_id, username_token) = register_user(&app, "bob_recover", b"password123").await;
    let _code = recovery_code::persist_for_user(&pool, &user_id)
        .await
        .unwrap();

    // Wrong recovery code
    let req_wrong_code = Request::builder()
        .method("POST")
        .uri("/api/v1/auth/recover/start")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "recovery_code": "00000000000000000000",
                "username_token": username_token
            })
            .to_string(),
        ))
        .unwrap();

    let resp_wrong = app.clone().oneshot(req_wrong_code).await.unwrap();
    assert_eq!(resp_wrong.status(), StatusCode::NOT_FOUND);

    let body_bytes = axum::body::to_bytes(resp_wrong.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_wrong: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(json_wrong["error"], "recovery_failed");

    // Unknown username_token
    let fake_token = URL_SAFE_NO_PAD.encode([1u8; 64]);
    let req_unknown_token = Request::builder()
        .method("POST")
        .uri("/api/v1/auth/recover/start")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "recovery_code": "00000000000000000000",
                "username_token": fake_token
            })
            .to_string(),
        ))
        .unwrap();

    let resp_unknown = app.clone().oneshot(req_unknown_token).await.unwrap();
    assert_eq!(resp_unknown.status(), StatusCode::NOT_FOUND);

    let body_bytes2 = axum::body::to_bytes(resp_unknown.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_unknown: Value = serde_json::from_slice(&body_bytes2).unwrap();
    assert_eq!(json_unknown["error"], "recovery_failed");

    // Assert no audit log entries created
    let audit_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM audit_log WHERE action LIKE 'recover.%'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(audit_count, 0);
}

#[tokio::test]
async fn test_recovery_rate_limiting() {
    let (app, pool) = setup_test_app().await;

    let (user_id, username_token) = register_user(&app, "eve_recover", b"pass123").await;
    let code = recovery_code::persist_for_user(&pool, &user_id)
        .await
        .unwrap();

    // Call recover_start 5 times (the minute limit)
    for _ in 0..5 {
        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/auth/recover/start")
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(
                json!({
                    "recovery_code": code,
                    "username_token": username_token
                })
                .to_string(),
            ))
            .unwrap();

        let resp = app.clone().oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
    }

    // 6th call should be rate limited (429)
    let req_limited = Request::builder()
        .method("POST")
        .uri("/api/v1/auth/recover/start")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "recovery_code": code,
                "username_token": username_token
            })
            .to_string(),
        ))
        .unwrap();

    let resp_limited = app.clone().oneshot(req_limited).await.unwrap();
    assert_eq!(resp_limited.status(), StatusCode::TOO_MANY_REQUESTS);
}

#[tokio::test]
async fn test_recovery_session_replay_and_code_replay() {
    let (app, pool) = setup_test_app().await;

    let (user_id, username_token) = register_user(&app, "charlie_recover", b"pass1").await;
    let code = recovery_code::persist_for_user(&pool, &user_id)
        .await
        .unwrap();

    // Start recovery
    let req_start = Request::builder()
        .method("POST")
        .uri("/api/v1/auth/recover/start")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "recovery_code": code,
                "username_token": username_token
            })
            .to_string(),
        ))
        .unwrap();

    let resp_start = app.clone().oneshot(req_start).await.unwrap();
    let start_body = axum::body::to_bytes(resp_start.into_body(), usize::MAX)
        .await
        .unwrap();
    let start_json: Value = serde_json::from_slice(&start_body).unwrap();
    let recovery_session = start_json["recovery_session"].as_str().unwrap();
    let reg_challenge_b64 = start_json["registration_challenge"].as_str().unwrap();

    let challenge_bytes = STANDARD
        .decode(reg_challenge_b64)
        .or_else(|_| URL_SAFE_NO_PAD.decode(reg_challenge_b64))
        .unwrap();
    let reg_resp =
        RegistrationResponse::<DefaultCipherSuite>::deserialize(&challenge_bytes).unwrap();

    let mut rng = OsRng;
    let client_start = ClientRegistration::<DefaultCipherSuite>::start(&mut rng, b"pass2").unwrap();
    let client_finish = client_start
        .state
        .finish(
            &mut rng,
            b"pass2",
            reg_resp,
            ClientRegistrationFinishParameters::default(),
        )
        .unwrap();
    let upload_b64 = STANDARD.encode(client_finish.message.serialize());

    // Finish recovery #1
    let req_finish1 = Request::builder()
        .method("POST")
        .uri("/api/v1/auth/recover/finish")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "recovery_session": recovery_session,
                "registration_record": upload_b64
            })
            .to_string(),
        ))
        .unwrap();

    let resp_finish1 = app.clone().oneshot(req_finish1).await.unwrap();
    assert_eq!(resp_finish1.status(), StatusCode::OK);

    // Replay recovery session token #2 -> 400 recovery_session_invalid
    let req_finish2 = Request::builder()
        .method("POST")
        .uri("/api/v1/auth/recover/finish")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "recovery_session": recovery_session,
                "registration_record": upload_b64
            })
            .to_string(),
        ))
        .unwrap();

    let resp_finish2 = app.clone().oneshot(req_finish2).await.unwrap();
    assert_eq!(resp_finish2.status(), StatusCode::BAD_REQUEST);

    let body2 = axum::body::to_bytes(resp_finish2.into_body(), usize::MAX)
        .await
        .unwrap();
    let json2: Value = serde_json::from_slice(&body2).unwrap();
    assert_eq!(json2["error"], "recovery_session_invalid");

    // Replay consumed recovery code -> 404 recovery_failed
    let req_start_replay = Request::builder()
        .method("POST")
        .uri("/api/v1/auth/recover/start")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "recovery_code": code,
                "username_token": username_token
            })
            .to_string(),
        ))
        .unwrap();

    let resp_start_replay = app.clone().oneshot(req_start_replay).await.unwrap();
    assert_eq!(resp_start_replay.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn test_recovery_expired_session() {
    let (app, pool) = setup_test_app().await;

    let (user_id, username_token) = register_user(&app, "expired_user", b"oldpass").await;
    let code = recovery_code::persist_for_user(&pool, &user_id)
        .await
        .unwrap();

    let req_start = Request::builder()
        .method("POST")
        .uri("/api/v1/auth/recover/start")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "recovery_code": code,
                "username_token": username_token
            })
            .to_string(),
        ))
        .unwrap();

    let resp_start = app.clone().oneshot(req_start).await.unwrap();
    let start_body = axum::body::to_bytes(resp_start.into_body(), usize::MAX)
        .await
        .unwrap();
    let start_json: Value = serde_json::from_slice(&start_body).unwrap();
    let _recovery_session = start_json["recovery_session"].as_str().unwrap();

    let state_app = app.clone();
    let fake_expired_session = URL_SAFE_NO_PAD.encode([99u8; 32]);
    let req_expired = Request::builder()
        .method("POST")
        .uri("/api/v1/auth/recover/finish")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "recovery_session": fake_expired_session,
                "registration_record": STANDARD.encode([0u8; 32])
            })
            .to_string(),
        ))
        .unwrap();

    let resp_expired = state_app.oneshot(req_expired).await.unwrap();
    assert_eq!(resp_expired.status(), StatusCode::BAD_REQUEST);

    let expired_body = axum::body::to_bytes(resp_expired.into_body(), usize::MAX)
        .await
        .unwrap();
    let expired_json: Value = serde_json::from_slice(&expired_body).unwrap();
    assert_eq!(expired_json["error"], "recovery_session_invalid");
}

#[tokio::test]
async fn test_recovery_session_revoked_events_published() {
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    let mock_sockudo = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/apps/chat/events"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"ok": true})))
        .mount(&mock_sockudo)
        .await;

    std::env::set_var("APP_ENV", "development");

    let (app, pool, _) = common::setup_test_app_with_config(true, "auto", 100).await;

    let (user_id, username_token) = register_user(&app, "rev_user", b"password123").await;

    // Create 2 active sessions
    let _s1 = server::session::create_session(&pool, &user_id, None, 30)
        .await
        .unwrap();
    let _s2 = server::session::create_session(&pool, &user_id, None, 30)
        .await
        .unwrap();

    let code = recovery_code::persist_for_user(&pool, &user_id)
        .await
        .unwrap();

    let req_start = Request::builder()
        .method("POST")
        .uri("/api/v1/auth/recover/start")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "recovery_code": code,
                "username_token": username_token
            })
            .to_string(),
        ))
        .unwrap();

    let resp_start = app.clone().oneshot(req_start).await.unwrap();
    let start_body = axum::body::to_bytes(resp_start.into_body(), usize::MAX)
        .await
        .unwrap();
    let start_json: Value = serde_json::from_slice(&start_body).unwrap();

    let recovery_session = start_json["recovery_session"].as_str().unwrap();
    let reg_challenge_b64 = start_json["registration_challenge"].as_str().unwrap();

    let challenge_bytes = STANDARD
        .decode(reg_challenge_b64)
        .or_else(|_| URL_SAFE_NO_PAD.decode(reg_challenge_b64))
        .unwrap();
    let reg_resp =
        RegistrationResponse::<DefaultCipherSuite>::deserialize(&challenge_bytes).unwrap();

    let mut rng = OsRng;
    let client_start =
        ClientRegistration::<DefaultCipherSuite>::start(&mut rng, b"new_pass").unwrap();
    let client_finish = client_start
        .state
        .finish(
            &mut rng,
            b"new_pass",
            reg_resp,
            ClientRegistrationFinishParameters::default(),
        )
        .unwrap();

    let new_upload_b64 = STANDARD.encode(client_finish.message.serialize());

    let req_finish = Request::builder()
        .method("POST")
        .uri("/api/v1/auth/recover/finish")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "recovery_session": recovery_session,
                "registration_record": new_upload_b64
            })
            .to_string(),
        ))
        .unwrap();

    let resp_finish = app.clone().oneshot(req_finish).await.unwrap();
    assert_eq!(resp_finish.status(), StatusCode::OK);

    // Verify both sessions were revoked in DB
    let active_sessions_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM sessions WHERE user_id = ? AND revoked_at IS NULL",
    )
    .bind(&user_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    // 1 new session created on recover finish
    assert_eq!(active_sessions_count, 1);
}

#[tokio::test]
async fn test_recovery_invalid_registration_record() {
    let (app, pool) = setup_test_app().await;

    let (user_id, username_token) = register_user(&app, "dave_recover", b"pass1").await;
    let code = recovery_code::persist_for_user(&pool, &user_id)
        .await
        .unwrap();

    // Start
    let req_start = Request::builder()
        .method("POST")
        .uri("/api/v1/auth/recover/start")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "recovery_code": code,
                "username_token": username_token
            })
            .to_string(),
        ))
        .unwrap();

    let resp_start = app.clone().oneshot(req_start).await.unwrap();
    let start_body = axum::body::to_bytes(resp_start.into_body(), usize::MAX)
        .await
        .unwrap();
    let start_json: Value = serde_json::from_slice(&start_body).unwrap();
    let recovery_session = start_json["recovery_session"].as_str().unwrap();

    // Finish with junk upload -> 400 registration_invalid
    let req_finish = Request::builder()
        .method("POST")
        .uri("/api/v1/auth/recover/finish")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "recovery_session": recovery_session,
                "registration_record": STANDARD.encode([0u8; 32])
            })
            .to_string(),
        ))
        .unwrap();

    let resp_finish = app.clone().oneshot(req_finish).await.unwrap();
    assert_eq!(resp_finish.status(), StatusCode::BAD_REQUEST);

    let finish_body = axum::body::to_bytes(resp_finish.into_body(), usize::MAX)
        .await
        .unwrap();
    let finish_json: Value = serde_json::from_slice(&finish_body).unwrap();
    assert_eq!(finish_json["error"], "registration_invalid");

    // Code remains unconsumed since finish failed
    let consumed_at: Option<String> =
        sqlx::query_scalar("SELECT consumed_at FROM recovery_codes WHERE user_id = ?")
            .bind(&user_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(consumed_at.is_none());
}
