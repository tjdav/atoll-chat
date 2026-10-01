mod common;

use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use serde_json::{json, Value};
use tower::ServiceExt;

#[tokio::test]
async fn test_device_name_sync() {
    let (app, _pool) = common::setup_test_app().await;

    // Register Alice
    common::register_user(&app, "alice", "Password123!", None).await;

    let enc_name1 = URL_SAFE_NO_PAD.encode(vec![1u8; 32]);
    let enc_name2 = URL_SAFE_NO_PAD.encode(vec![2u8; 32]);

    // Login Device 1 with enc_name1
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

    // Login Device 2 with enc_name2
    let (_, login2) = common::login_user_with_device_name(
        &app,
        "alice",
        "Password123!",
        "client_device2_123456",
        None,
        Some(&enc_name2),
    )
    .await;
    let dev2_id = login2["device_id"].as_str().unwrap();

    // 1. Full sync (since_seq=0) returns both device names
    let req = Request::builder()
        .method("GET")
        .uri("/api/v1/users/me/sync?since_seq=0")
        .header(header::AUTHORIZATION, format!("Bearer {token1}"))
        .body(Body::empty())
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let sync_res: Value = serde_json::from_slice(&body_bytes).unwrap();

    let dev_state = sync_res["device_state"].as_array().unwrap();
    assert_eq!(dev_state.len(), 2);

    assert_eq!(dev_state[0]["device_id"], dev1_id);
    assert_eq!(dev_state[0]["encrypted_device_name"], enc_name1);
    assert_eq!(dev_state[0]["user_seq"], 1);

    assert_eq!(dev_state[1]["device_id"], dev2_id);
    assert_eq!(dev_state[1]["encrypted_device_name"], enc_name2);
    assert_eq!(dev_state[1]["user_seq"], 2);

    assert_eq!(sync_res["max_seq"], 2);

    // 2. Delta sync (since_seq=1) returns only second device
    let req = Request::builder()
        .method("GET")
        .uri("/api/v1/users/me/sync?since_seq=1")
        .header(header::AUTHORIZATION, format!("Bearer {token1}"))
        .body(Body::empty())
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let sync_res: Value = serde_json::from_slice(&body_bytes).unwrap();

    let dev_state = sync_res["device_state"].as_array().unwrap();
    assert_eq!(dev_state.len(), 1);
    assert_eq!(dev_state[0]["device_id"], dev2_id);
    assert_eq!(sync_res["max_seq"], 2);

    // 3. Rename Device 1 (allocates user_seq 3)
    let enc_name1_v2 = URL_SAFE_NO_PAD.encode(vec![3u8; 32]);
    let req = Request::builder()
        .method("PATCH")
        .uri(format!("/api/v1/users/me/devices/{dev1_id}"))
        .header(header::AUTHORIZATION, format!("Bearer {token1}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({ "encrypted_device_name": enc_name1_v2 }).to_string(),
        ))
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    // Delta sync (since_seq=2) returns updated Device 1
    let req = Request::builder()
        .method("GET")
        .uri("/api/v1/users/me/sync?since_seq=2")
        .header(header::AUTHORIZATION, format!("Bearer {token1}"))
        .body(Body::empty())
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let sync_res: Value = serde_json::from_slice(&body_bytes).unwrap();

    let dev_state = sync_res["device_state"].as_array().unwrap();
    assert_eq!(dev_state.len(), 1);
    assert_eq!(dev_state[0]["device_id"], dev1_id);
    assert_eq!(dev_state[0]["encrypted_device_name"], enc_name1_v2);
    assert_eq!(dev_state[0]["user_seq"], 3);
    assert_eq!(sync_res["max_seq"], 3);
}
