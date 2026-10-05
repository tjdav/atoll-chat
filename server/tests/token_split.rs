mod common;

use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use base64::Engine;
use common::{
    fetch_and_solve_altcha, login_user, obtain_username_token, register_user, setup_test_app,
};
use opaque_ke::{ClientRegistration, ClientRegistrationFinishParameters, RegistrationResponse};
use rand::rngs::OsRng;
use serde_json::{json, Value};
use server::opaque::DefaultCipherSuite;
use tower::ServiceExt;

const TEST_CLIENT_ID: &str = "client_id_123456789";

fn valid_encrypted_display() -> String {
    // 32 zero bytes encoded as unpadded base64url (valid 28-284 bytes range)
    URL_SAFE_NO_PAD.encode([0u8; 32])
}

#[tokio::test]
async fn test_token_split_registration() {
    let (app, pool) = setup_test_app().await;

    let lookup_token = obtain_username_token(&app, "alice").await;
    let altcha1 = fetch_and_solve_altcha(&app).await;

    let mut rng = OsRng;
    let client_start = ClientRegistration::<DefaultCipherSuite>::start(&mut rng, b"password123")
        .expect("ClientRegistration::start failed");
    let reg_req_b64 = STANDARD.encode(client_start.message.serialize());

    let disp = valid_encrypted_display();

    // 1. Request containing raw "token" field must be rejected with 400 Bad Request
    let req_rejected = Request::builder()
        .method("POST")
        .uri("/api/v1/auth/register/start")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "token": lookup_token,
                "lookup_token": lookup_token,
                "registration_request": reg_req_b64,
                "altcha": altcha1
            })
            .to_string(),
        ))
        .unwrap();

    let resp_rejected = app.clone().oneshot(req_rejected).await.unwrap();
    assert_eq!(resp_rejected.status(), StatusCode::BAD_REQUEST);

    // 2. Registration start using lookup_token field succeeds
    let req1 = Request::builder()
        .method("POST")
        .uri("/api/v1/auth/register/start")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "lookup_token": lookup_token,
                "registration_request": reg_req_b64,
                "altcha": fetch_and_solve_altcha(&app).await
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

    // 3. Finish registration
    let req2 = Request::builder()
        .method("POST")
        .uri("/api/v1/auth/register/finish")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "registration_id": reg_id,
                "registration_upload": upload_b64,
                "encrypted_display": disp,
                "altcha": fetch_and_solve_altcha(&app).await
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
    assert_eq!(json2["username_token"], lookup_token);

    // Confirm stored in DB
    let stored_token: String =
        sqlx::query_scalar("SELECT username_token FROM users WHERE username_token = ?")
            .bind(&lookup_token)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(stored_token, lookup_token);
}

#[tokio::test]
async fn test_token_split_login_and_dummy_record() {
    let (app, _pool) = setup_test_app().await;

    let _user_id = register_user(&app, "alice", "password123", None).await;

    // 1. Successful login for known user
    let (status_ok, body_ok) = login_user(&app, "alice", "password123", TEST_CLIENT_ID, None).await;
    assert_eq!(status_ok, StatusCode::OK);
    assert!(body_ok["session_token"].is_string());

    // 2. Unknown lookup_token uses dummy record: login_start returns 200, login_finish returns 401
    let unknown_lookup_token = obtain_username_token(&app, "bob").await;

    let mut rng = OsRng;
    let client_start_unk =
        opaque_ke::ClientLogin::<DefaultCipherSuite>::start(&mut rng, b"password123")
            .expect("ClientLogin::start failed");
    let cred_req_unk_b64 = STANDARD.encode(client_start_unk.message.serialize());

    let req_start_unk = Request::builder()
        .method("POST")
        .uri("/api/v1/auth/login/start")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "lookup_token": unknown_lookup_token,
                "credential_request": cred_req_unk_b64,
                "client_id": TEST_CLIENT_ID,
            })
            .to_string(),
        ))
        .unwrap();

    let resp_start_unk = app.clone().oneshot(req_start_unk).await.unwrap();
    assert_eq!(resp_start_unk.status(), StatusCode::OK);

    let body_bytes_unk = axum::body::to_bytes(resp_start_unk.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_start_unk: Value = serde_json::from_slice(&body_bytes_unk).unwrap();
    let login_id_unk = json_start_unk["login_id"].as_str().unwrap();

    let req_finish_unk = Request::builder()
        .method("POST")
        .uri("/api/v1/auth/login/finish")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "login_id": login_id_unk,
                "credential_finalization": STANDARD.encode([0u8; 32]),
            })
            .to_string(),
        ))
        .unwrap();

    let resp_finish_unk = app.clone().oneshot(req_finish_unk).await.unwrap();
    assert_eq!(resp_finish_unk.status(), StatusCode::UNAUTHORIZED);

    let finish_bytes_unk = axum::body::to_bytes(resp_finish_unk.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_finish_unk: Value = serde_json::from_slice(&finish_bytes_unk).unwrap();
    assert_eq!(json_finish_unk["error"], "invalid_credentials");

    // 3. Login start rejecting raw "token" field
    let req_token_rejected = Request::builder()
        .method("POST")
        .uri("/api/v1/auth/login/start")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "token": unknown_lookup_token,
                "lookup_token": unknown_lookup_token,
                "credential_request": STANDARD.encode([0u8; 32]),
                "client_id": TEST_CLIENT_ID,
            })
            .to_string(),
        ))
        .unwrap();

    let resp_token_rejected = app.clone().oneshot(req_token_rejected).await.unwrap();
    assert_eq!(resp_token_rejected.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn test_token_split_lookup() {
    let (app, _pool) = setup_test_app().await;

    let user_id = register_user(&app, "alice", "password123", None).await;
    let (_, login_body) = login_user(&app, "alice", "password123", TEST_CLIENT_ID, None).await;
    let session_token = login_body["session_token"].as_str().unwrap();

    let alice_lookup_token = obtain_username_token(&app, "alice").await;
    let bob_lookup_token = obtain_username_token(&app, "bob").await;

    // 1. Lookup found using lookup_token
    let req_found = Request::builder()
        .method("POST")
        .uri("/api/v1/users/lookup")
        .header(header::AUTHORIZATION, format!("Bearer {}", session_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({ "lookup_token": alice_lookup_token }).to_string(),
        ))
        .unwrap();

    let resp_found = app.clone().oneshot(req_found).await.unwrap();
    assert_eq!(resp_found.status(), StatusCode::OK);

    let body_found_bytes = axum::body::to_bytes(resp_found.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_found: Value = serde_json::from_slice(&body_found_bytes).unwrap();
    assert_eq!(json_found["user_id"], user_id);

    // 2. Lookup missing using unknown lookup_token
    let req_missing = Request::builder()
        .method("POST")
        .uri("/api/v1/users/lookup")
        .header(header::AUTHORIZATION, format!("Bearer {}", session_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({ "lookup_token": bob_lookup_token }).to_string(),
        ))
        .unwrap();

    let resp_missing = app.clone().oneshot(req_missing).await.unwrap();
    assert_eq!(resp_missing.status(), StatusCode::NOT_FOUND);

    // 3. Lookup rejecting raw "token" field
    let req_rej = Request::builder()
        .method("POST")
        .uri("/api/v1/users/lookup")
        .header(header::AUTHORIZATION, format!("Bearer {}", session_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "token": alice_lookup_token,
                "lookup_token": alice_lookup_token,
            })
            .to_string(),
        ))
        .unwrap();

    let resp_rej = app.clone().oneshot(req_rej).await.unwrap();
    assert_eq!(resp_rej.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn test_encrypted_display_opacity() {
    let (app, _pool) = setup_test_app().await;

    let disp = valid_encrypted_display();

    let user_id = register_user(&app, "alice", "password123", None).await;

    let (_, login_body) = login_user(&app, "alice", "password123", TEST_CLIENT_ID, None).await;
    let session_token = login_body["session_token"].as_str().unwrap();

    // Patch encrypted_display
    let req_patch = Request::builder()
        .method("PATCH")
        .uri("/api/v1/users/me")
        .header(header::AUTHORIZATION, format!("Bearer {}", session_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "encrypted_display": disp }).to_string()))
        .unwrap();

    let resp_patch = app.clone().oneshot(req_patch).await.unwrap();
    assert_eq!(resp_patch.status(), StatusCode::OK);

    let patch_bytes = axum::body::to_bytes(resp_patch.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_patch: Value = serde_json::from_slice(&patch_bytes).unwrap();
    assert_eq!(json_patch["encrypted_display"], disp);

    // GET /users/me returns encrypted_display verbatim
    let req_me = Request::builder()
        .method("GET")
        .uri("/api/v1/users/me")
        .header(header::AUTHORIZATION, format!("Bearer {}", session_token))
        .body(Body::empty())
        .unwrap();

    let resp_me = app.clone().oneshot(req_me).await.unwrap();
    assert_eq!(resp_me.status(), StatusCode::OK);

    let me_bytes = axum::body::to_bytes(resp_me.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_me: Value = serde_json::from_slice(&me_bytes).unwrap();
    assert_eq!(json_me["encrypted_display"], disp);

    // Lookup returns encrypted_display verbatim
    let alice_lookup_token = obtain_username_token(&app, "alice").await;
    let req_lookup = Request::builder()
        .method("POST")
        .uri("/api/v1/users/lookup")
        .header(header::AUTHORIZATION, format!("Bearer {}", session_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({ "lookup_token": alice_lookup_token }).to_string(),
        ))
        .unwrap();

    let resp_lookup = app.clone().oneshot(req_lookup).await.unwrap();
    assert_eq!(resp_lookup.status(), StatusCode::OK);

    let lookup_bytes = axum::body::to_bytes(resp_lookup.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_lookup: Value = serde_json::from_slice(&lookup_bytes).unwrap();
    assert_eq!(json_lookup["user_id"], user_id);
    assert_eq!(json_lookup["encrypted_display"], disp);
}
