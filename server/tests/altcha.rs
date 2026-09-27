mod common;

use axum::{
    body::Body,
    http::{header, Request, StatusCode},
};
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use common::{fetch_and_solve_altcha, setup_test_app, setup_test_app_with_config};
use opaque_ke::ClientRegistration;
use rand::rngs::OsRng;
use serde_json::{json, Value};
use server::altcha::AltchaConfig;
use server::opaque::DefaultCipherSuite;
use tower::ServiceExt;

#[tokio::test]
async fn challenge_endpoint_returns_valid_challenge() {
    let (app, _pool) = setup_test_app().await;

    let req = Request::builder()
        .method("GET")
        .uri("/api/v1/auth/register/challenge")
        .body(Body::empty())
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let val: Value = serde_json::from_slice(&body_bytes).unwrap();

    assert!(val.get("parameters").is_some());
    let params = &val["parameters"];
    assert_eq!(params["algorithm"], "PBKDF2/SHA-256");
    assert!(params.get("salt").is_some());
    assert!(params.get("nonce").is_some());
    assert_eq!(params["cost"], 100);
    assert!(val.get("signature").is_some());
}

#[tokio::test]
async fn challenge_endpoint_returns_404_when_disabled() {
    let (app, _pool, _config) = setup_test_app_with_config(false, "auto", 100).await;

    let req = Request::builder()
        .method("GET")
        .uri("/api/v1/auth/register/challenge")
        .body(Body::empty())
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);

    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let body: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(body["error"], "altcha_disabled");
}

#[tokio::test]
async fn register_start_requires_altcha_when_enabled() {
    let (app, _pool) = setup_test_app().await;

    let mut rng = OsRng;
    let client_start = ClientRegistration::<DefaultCipherSuite>::start(&mut rng, b"password123")
        .expect("ClientRegistration::start failed");
    let reg_req_b64 = STANDARD.encode(client_start.message.serialize());

    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/auth/register/start")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "username": "alice",
                "registration_request": reg_req_b64,
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
    assert_eq!(body["error"], "altcha_required");
}

#[tokio::test]
async fn register_start_rejects_invalid_altcha() {
    let (app, _pool) = setup_test_app().await;

    let mut rng = OsRng;
    let client_start = ClientRegistration::<DefaultCipherSuite>::start(&mut rng, b"password123")
        .expect("ClientRegistration::start failed");
    let reg_req_b64 = STANDARD.encode(client_start.message.serialize());

    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/auth/register/start")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "username": "alice",
                "registration_request": reg_req_b64,
                "altcha": "invalid_base64_payload_here",
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
    assert_eq!(body["error"], "invalid_altcha");
}

#[tokio::test]
async fn register_start_rejects_tampered_solution() {
    let (app, _pool) = setup_test_app().await;

    // Fetch challenge
    let req_ch = Request::builder()
        .method("GET")
        .uri("/api/v1/auth/register/challenge")
        .body(Body::empty())
        .unwrap();
    let resp_ch = app.clone().oneshot(req_ch).await.unwrap();
    let body_ch = axum::body::to_bytes(resp_ch.into_body(), usize::MAX)
        .await
        .unwrap();
    let mut challenge: altcha::Challenge = serde_json::from_slice(&body_ch).unwrap();

    // Tamper with challenge signature
    challenge.signature =
        Some("0000000000000000000000000000000000000000000000000000000000000000".to_string());

    let solve_res = altcha::solve_challenge(altcha::SolveChallengeOptions::new(&challenge))
        .unwrap()
        .unwrap();
    let tampered_payload = altcha::Payload {
        challenge,
        solution: solve_res,
    };
    let tampered_b64 = STANDARD.encode(serde_json::to_string(&tampered_payload).unwrap());

    let mut rng = OsRng;
    let client_start = ClientRegistration::<DefaultCipherSuite>::start(&mut rng, b"password123")
        .expect("ClientRegistration::start failed");
    let reg_req_b64 = STANDARD.encode(client_start.message.serialize());

    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/auth/register/start")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "username": "alice",
                "registration_request": reg_req_b64,
                "altcha": tampered_b64,
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
    assert_eq!(body["error"], "invalid_altcha");
}

#[tokio::test]
async fn registration_succeeds_with_valid_altcha() {
    let (app, _pool) = setup_test_app().await;

    let altcha_payload = fetch_and_solve_altcha(&app).await;

    let mut rng = OsRng;
    let client_start = ClientRegistration::<DefaultCipherSuite>::start(&mut rng, b"password123")
        .expect("ClientRegistration::start failed");
    let reg_req_b64 = STANDARD.encode(client_start.message.serialize());

    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/auth/register/start")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "username": "alice",
                "registration_request": reg_req_b64,
                "altcha": altcha_payload,
            })
            .to_string(),
        ))
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let body: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert!(body.get("registration_id").is_some());
    assert!(body.get("registration_response").is_some());
}

#[tokio::test]
async fn hmac_secret_persisted_in_instance_config() {
    let pool = common::setup_test_db().await;
    let config = server::config::Config {
        app_env: "development".to_string(),
        app_url: None,
        app_name: "Test".to_string(),
        log_level: "info".to_string(),
        server_bind: "127.0.0.1:0".to_string(),
        db_path: ":memory:".to_string(),
        db_busy_timeout_ms: 5000,
        opaque_oprf_key_path: "oprf.key".to_string(),
        altcha_enabled: true,
        altcha_hmac_secret: "auto".to_string(),
        altcha_algorithm: "PBKDF2/SHA-256".to_string(),
        altcha_cost: 100,
    };

    let altcha_config1 = AltchaConfig::from_env(&config, &pool).await.unwrap();
    assert!(!altcha_config1.hmac_secret.is_empty());

    // Query instance_config table directly
    let saved_secret: (String,) =
        sqlx::query_as("SELECT value FROM instance_config WHERE key = 'altcha_hmac_secret'")
            .fetch_one(&pool)
            .await
            .unwrap();

    assert_eq!(saved_secret.0, altcha_config1.hmac_secret);

    // Subsequent initialization reuses the same secret
    let altcha_config2 = AltchaConfig::from_env(&config, &pool).await.unwrap();
    assert_eq!(altcha_config2.hmac_secret, altcha_config1.hmac_secret);
}
