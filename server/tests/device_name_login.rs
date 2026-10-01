mod common;

use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use serde_json::Value;
use tower::ServiceExt;

#[tokio::test]
async fn test_login_device_name_integration() {
    let (app, _pool) = common::setup_test_app().await;

    common::register_user(&app, "alice", "Password123!", None).await;

    let enc_name1 = URL_SAFE_NO_PAD.encode(vec![10u8; 32]);
    let enc_name2 = URL_SAFE_NO_PAD.encode(vec![20u8; 32]);

    // 1. Login with encrypted_device_name writes the name row
    let (_, login1) = common::login_user_with_device_name(
        &app,
        "alice",
        "Password123!",
        "client_device1_123456",
        None,
        Some(&enc_name1),
    )
    .await;
    let token1 = login1["session_token"].as_str().unwrap();
    let dev1_id = login1["device_id"].as_str().unwrap();

    // GET /users/me/devices returns encrypted_device_name
    let req = Request::builder()
        .method("GET")
        .uri("/api/v1/users/me/devices")
        .header(header::AUTHORIZATION, format!("Bearer {token1}"))
        .body(Body::empty())
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let res: Value = serde_json::from_slice(&body_bytes).unwrap();
    let devs = res["devices"].as_array().unwrap();
    assert_eq!(devs.len(), 1);
    assert_eq!(devs[0]["id"], dev1_id);
    assert_eq!(devs[0]["encrypted_device_name"], enc_name1);

    // 2. Second login with same client_id and new encrypted_device_name updates the name
    let (_, login2) = common::login_user_with_device_name(
        &app,
        "alice",
        "Password123!",
        "client_device1_123456",
        None,
        Some(&enc_name2),
    )
    .await;
    let token2 = login2["session_token"].as_str().unwrap();

    let req = Request::builder()
        .method("GET")
        .uri("/api/v1/users/me/devices")
        .header(header::AUTHORIZATION, format!("Bearer {token2}"))
        .body(Body::empty())
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let res: Value = serde_json::from_slice(&body_bytes).unwrap();
    let devs = res["devices"].as_array().unwrap();
    assert_eq!(devs.len(), 1);
    assert_eq!(devs[0]["encrypted_device_name"], enc_name2);

    // 3. Login without encrypted_device_name leaves name null for a new device
    let (_, login3) =
        common::login_user(&app, "alice", "Password123!", "client_device2_123456", None).await;
    let token3 = login3["session_token"].as_str().unwrap();
    let dev2_id = login3["device_id"].as_str().unwrap();

    let req = Request::builder()
        .method("GET")
        .uri("/api/v1/users/me/devices")
        .header(header::AUTHORIZATION, format!("Bearer {token3}"))
        .body(Body::empty())
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let res: Value = serde_json::from_slice(&body_bytes).unwrap();
    let devs = res["devices"].as_array().unwrap();
    assert_eq!(devs.len(), 2);

    let dev2 = devs.iter().find(|d| d["id"] == dev2_id).unwrap();
    assert!(dev2["encrypted_device_name"].is_null());
}
