mod common;

use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use serde_json::{json, Value};
use tower::ServiceExt;

#[tokio::test]
async fn test_device_name_write_and_update() {
    let (app, pool) = common::setup_test_app().await;

    // Register User A
    common::register_user(&app, "alice", "Password123!", None).await;
    let (_, login_a) =
        common::login_user(&app, "alice", "Password123!", "client_device1_123456", None).await;
    let token_a = login_a["session_token"].as_str().unwrap();
    let device_id_a = login_a["device_id"].as_str().unwrap();

    let name1_b64 = URL_SAFE_NO_PAD.encode(vec![1u8; 32]);
    let name2_b64 = URL_SAFE_NO_PAD.encode(vec![2u8; 32]);

    // 1. Write creates a device name row
    let req = Request::builder()
        .method("PATCH")
        .uri(format!("/api/v1/users/me/devices/{device_id_a}"))
        .header(header::AUTHORIZATION, format!("Bearer {token_a}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({ "encrypted_device_name": name1_b64 }).to_string(),
        ))
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    assert_eq!(
        resp.headers()
            .get(header::CACHE_CONTROL)
            .unwrap()
            .to_str()
            .unwrap(),
        "no-store"
    );

    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let res: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(res["device_id"], device_id_a);
    assert_eq!(res["encrypted_device_name"], name1_b64);
    assert_eq!(res["user_seq"], 1);

    // 2. Second write advances user_seq
    let req = Request::builder()
        .method("PATCH")
        .uri(format!("/api/v1/users/me/devices/{device_id_a}"))
        .header(header::AUTHORIZATION, format!("Bearer {token_a}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({ "encrypted_device_name": name2_b64 }).to_string(),
        ))
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let res: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(res["encrypted_device_name"], name2_b64);
    assert_eq!(res["user_seq"], 2);

    // 3. Missing field returns 400 missing_field
    let req = Request::builder()
        .method("PATCH")
        .uri(format!("/api/v1/users/me/devices/{device_id_a}"))
        .header(header::AUTHORIZATION, format!("Bearer {token_a}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({}).to_string()))
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let err: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(err["error"], "missing_field");

    // 4. Old plaintext device_name field returns 400 field_renamed
    let req = Request::builder()
        .method("PATCH")
        .uri(format!("/api/v1/users/me/devices/{device_id_a}"))
        .header(header::AUTHORIZATION, format!("Bearer {token_a}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({ "device_name": "Alice iPhone" }).to_string(),
        ))
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let err: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(err["error"], "field_renamed");
    assert_eq!(err["details"]["old"], "device_name");
    assert_eq!(err["details"]["new"], "encrypted_device_name");

    // 5. Invalid ciphertext (too short) returns 400
    let short_b64 = URL_SAFE_NO_PAD.encode(vec![1u8; 10]);
    let req = Request::builder()
        .method("PATCH")
        .uri(format!("/api/v1/users/me/devices/{device_id_a}"))
        .header(header::AUTHORIZATION, format!("Bearer {token_a}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({ "encrypted_device_name": short_b64 }).to_string(),
        ))
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);

    // 6. Cross-user isolation: User B cannot rename User A's device
    sqlx::query(
        "INSERT INTO server_invites (id, code, max_uses, current_uses) VALUES ('inv_b', 'INVITEB12345678', 1, 0)",
    )
    .execute(&pool)
    .await
    .unwrap();

    common::register_user(&app, "bob", "Password123!", Some("INVITEB12345678")).await;
    let (_, login_b) =
        common::login_user(&app, "bob", "Password123!", "client_device2_123456", None).await;
    let token_b = login_b["session_token"].as_str().unwrap();

    let req = Request::builder()
        .method("PATCH")
        .uri(format!("/api/v1/users/me/devices/{device_id_a}"))
        .header(header::AUTHORIZATION, format!("Bearer {token_b}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({ "encrypted_device_name": name1_b64 }).to_string(),
        ))
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);
}
