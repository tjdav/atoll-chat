mod common;

use axum::{
    body::Body,
    http::{header, Request, StatusCode},
    Router,
};
use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use base64::Engine;
use common::setup_test_app;
use opaque_ke::{ClientRegistration, ClientRegistrationFinishParameters, RegistrationResponse};
use rand::rngs::OsRng;
use serde_json::{json, Value};
use server::opaque::DefaultCipherSuite;
use server::roles;
use tower::ServiceExt;

async fn do_register(
    app: &Router,
    username: &str,
    password: &str,
    invite_code: Option<&str>,
) -> (StatusCode, Value) {
    let mut rng = OsRng;
    let client_start =
        ClientRegistration::<DefaultCipherSuite>::start(&mut rng, password.as_bytes())
            .expect("ClientRegistration::start failed");

    let reg_req_b64 = STANDARD.encode(client_start.message.serialize());

    let req1 = Request::builder()
        .method("POST")
        .uri("/api/v1/auth/register/start")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "username": username,
                "registration_request": reg_req_b64,
            })
            .to_string(),
        ))
        .unwrap();

    let resp1 = app.clone().oneshot(req1).await.unwrap();
    let status1 = resp1.status();
    let body_bytes1 = axum::body::to_bytes(resp1.into_body(), usize::MAX)
        .await
        .unwrap();
    let json1: Value = serde_json::from_slice(&body_bytes1).unwrap_or(json!({}));

    if status1 != StatusCode::OK {
        return (status1, json1);
    }

    let reg_id = json1["registration_id"]
        .as_str()
        .expect("missing registration_id");
    let reg_resp_b64 = json1["registration_response"]
        .as_str()
        .expect("missing registration_response");

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
            password.as_bytes(),
            reg_resp,
            ClientRegistrationFinishParameters::default(),
        )
        .expect("ClientRegistration::finish failed");

    let upload_b64 = STANDARD.encode(client_finish.message.serialize());

    let req2 = Request::builder()
        .method("POST")
        .uri("/api/v1/auth/register/finish")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "registration_id": reg_id,
                "registration_upload": upload_b64,
                "invite_code": invite_code,
            })
            .to_string(),
        ))
        .unwrap();

    let resp2 = app.clone().oneshot(req2).await.unwrap();
    let status2 = resp2.status();
    let body_bytes2 = axum::body::to_bytes(resp2.into_body(), usize::MAX)
        .await
        .unwrap();
    let json2: Value = serde_json::from_slice(&body_bytes2).unwrap_or(json!({}));

    (status2, json2)
}

#[tokio::test]
async fn bootstrap_registration_succeeds_without_invite() {
    let (app, pool) = setup_test_app().await;

    // Initially no users
    assert!(!roles::has_any_users(&pool).await.unwrap());

    let (status, body) = do_register(&app, "alice", "password123", None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["username"], "alice");
    assert_eq!(body["is_owner"], true);

    let user_id = body["user_id"].as_str().expect("missing user_id");

    // Check that user exists with owner role
    let has_owner = roles::user_has_permission(&pool, user_id, "*")
        .await
        .unwrap();
    assert!(has_owner);
}

#[tokio::test]
async fn second_user_requires_invite() {
    let (app, pool) = setup_test_app().await;

    // First user succeeds as owner
    let (status1, _) = do_register(&app, "alice", "password123", None).await;
    assert_eq!(status1, StatusCode::OK);

    // Second registration without invite fails with 403
    let (status2, body2) = do_register(&app, "bob", "password456", None).await;
    assert_eq!(status2, StatusCode::FORBIDDEN);
    assert_eq!(body2["error"], "invalid or expired invite");

    // Insert valid invite row directly into DB
    sqlx::query(
        "INSERT INTO server_invites (id, code, max_uses, current_uses) VALUES ('inv1', 'INVITE123', 1, 0)",
    )
    .execute(&pool)
    .await
    .unwrap();

    // Retry second registration with invite code
    let (status3, body3) = do_register(&app, "bob", "password456", Some("INVITE123")).await;
    assert_eq!(status3, StatusCode::OK);
    assert_eq!(body3["username"], "bob");
    assert_eq!(body3["is_owner"], false);

    // Assert current_uses incremented to 1
    let current_uses: i64 =
        sqlx::query_scalar("SELECT current_uses FROM server_invites WHERE code = 'INVITE123'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(current_uses, 1);
}

#[tokio::test]
async fn expired_invite_is_rejected() {
    let (app, pool) = setup_test_app().await;

    // First user
    do_register(&app, "alice", "password123", None).await;

    // Insert expired invite (expires_at in past)
    sqlx::query(
        "INSERT INTO server_invites (id, code, max_uses, current_uses, expires_at) VALUES ('inv_exp', 'EXPIRED123', 1, 0, datetime('now', '-1 day'))",
    )
    .execute(&pool)
    .await
    .unwrap();

    let (status, body) = do_register(&app, "bob", "password456", Some("EXPIRED123")).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(body["error"], "invalid or expired invite");
}

#[tokio::test]
async fn revoked_invite_is_rejected() {
    let (app, pool) = setup_test_app().await;

    // First user
    do_register(&app, "alice", "password123", None).await;

    // Insert revoked invite
    sqlx::query(
        "INSERT INTO server_invites (id, code, max_uses, current_uses, revoked_at) VALUES ('inv_rev', 'REVOKED123', 1, 0, datetime('now'))",
    )
    .execute(&pool)
    .await
    .unwrap();

    let (status, body) = do_register(&app, "bob", "password456", Some("REVOKED123")).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(body["error"], "invalid or expired invite");
}

#[tokio::test]
async fn exhausted_invite_is_rejected() {
    let (app, pool) = setup_test_app().await;

    // First user
    do_register(&app, "alice", "password123", None).await;

    // Insert exhausted invite (max_uses = 1, current_uses = 1)
    sqlx::query(
        "INSERT INTO server_invites (id, code, max_uses, current_uses) VALUES ('inv_exh', 'EXHAUSTED123', 1, 1)",
    )
    .execute(&pool)
    .await
    .unwrap();

    let (status, body) = do_register(&app, "bob", "password456", Some("EXHAUSTED123")).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(body["error"], "invalid or expired invite");
}

#[tokio::test]
async fn duplicate_username_returns_409() {
    let (app, _pool) = setup_test_app().await;

    // First registration for alice
    let (status1, _) = do_register(&app, "alice", "password123", None).await;
    assert_eq!(status1, StatusCode::OK);

    // Second registration attempt for alice
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
                "username": "Alice", // case insensitive duplicate
                "registration_request": reg_req_b64,
            })
            .to_string(),
        ))
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::CONFLICT);

    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let body: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(body["error"], "username taken");
}

#[tokio::test]
async fn invalid_registration_id_returns_400() {
    let (app, _pool) = setup_test_app().await;

    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/auth/register/finish")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "registration_id": "nonexistent_id",
                "registration_upload": STANDARD.encode(b"dummy"),
                "invite_code": null,
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
    assert_eq!(body["error"], "unknown or expired registration_id");
}

#[tokio::test]
async fn username_validation() {
    let (app, _pool) = setup_test_app().await;

    let long_username = "a".repeat(33);
    let invalid_usernames = vec!["a", "has spaces", "has/slash", "ab", long_username.as_str()];

    for invalid_un in invalid_usernames {
        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/auth/register/start")
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(
                json!({
                    "username": invalid_un,
                    "registration_request": STANDARD.encode(b"dummy_req"),
                })
                .to_string(),
            ))
            .unwrap();

        let resp = app.clone().oneshot(req).await.unwrap();
        assert_eq!(
            resp.status(),
            StatusCode::BAD_REQUEST,
            "Username '{}' should have failed validation",
            invalid_un
        );
    }
}
