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
