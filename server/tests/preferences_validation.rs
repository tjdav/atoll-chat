mod common;

use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use serde_json::{json, Value};
use tower::ServiceExt;

#[tokio::test]
async fn test_preference_key_validation() {
    let (app, _) = common::setup_test_app().await;

    common::register_user(&app, "alice", "Password123!", None).await;
    let (_, login_res) =
        common::login_user(&app, "alice", "Password123!", "client_device1_123456", None).await;
    let token = login_res["session_token"].as_str().unwrap();

    let long_key = "a".repeat(129);
    let invalid_keys = vec![
        "INVALID_UPPER",
        "has%20spaces",
        "has%2Fslash",
        "1starts-with-digit",
        &long_key,
    ];

    for key in invalid_keys {
        let req = Request::builder()
            .method("PATCH")
            .uri(format!("/api/v1/users/me/preferences/{key}"))
            .header(header::AUTHORIZATION, format!("Bearer {token}"))
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(json!({ "value": "test" }).to_string()))
            .unwrap();

        let resp = app.clone().oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);

        let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let res: Value = serde_json::from_slice(&body_bytes).unwrap();
        assert_eq!(res["error"], "invalid_key");
    }

    let valid_keys = vec!["theme", "theme:sub", "my-pref", "my_pref", "a:b:c"];

    for key in valid_keys {
        let req = Request::builder()
            .method("PATCH")
            .uri(format!("/api/v1/users/me/preferences/{key}"))
            .header(header::AUTHORIZATION, format!("Bearer {token}"))
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(json!({ "value": "test" }).to_string()))
            .unwrap();

        let resp = app.clone().oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
    }
}

#[tokio::test]
async fn test_preference_reserved_keys() {
    let (app, _) = common::setup_test_app().await;

    common::register_user(&app, "alice", "Password123!", None).await;
    let (_, login_res) =
        common::login_user(&app, "alice", "Password123!", "client_device1_123456", None).await;
    let token = login_res["session_token"].as_str().unwrap();

    let reserved_keys = vec!["room_order", "_internal", "_private:setting"];

    for key in reserved_keys {
        // PATCH reserved key
        let req = Request::builder()
            .method("PATCH")
            .uri(format!("/api/v1/users/me/preferences/{key}"))
            .header(header::AUTHORIZATION, format!("Bearer {token}"))
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(json!({ "value": "test" }).to_string()))
            .unwrap();

        let resp = app.clone().oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);

        let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let res: Value = serde_json::from_slice(&body_bytes).unwrap();
        assert_eq!(res["error"], "reserved_key");
        assert_eq!(res["details"]["key"], key);

        // DELETE reserved key
        let req = Request::builder()
            .method("DELETE")
            .uri(format!("/api/v1/users/me/preferences/{key}"))
            .header(header::AUTHORIZATION, format!("Bearer {token}"))
            .body(Body::empty())
            .unwrap();

        let resp = app.clone().oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);

        let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let res: Value = serde_json::from_slice(&body_bytes).unwrap();
        assert_eq!(res["error"], "reserved_key");
        assert_eq!(res["details"]["key"], key);

        // GET reserved key -> 404
        let req = Request::builder()
            .method("GET")
            .uri(format!("/api/v1/users/me/preferences/{key}"))
            .header(header::AUTHORIZATION, format!("Bearer {token}"))
            .body(Body::empty())
            .unwrap();

        let resp = app.clone().oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::NOT_FOUND);

        let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let res: Value = serde_json::from_slice(&body_bytes).unwrap();
        assert_eq!(res["error"], "preference_not_found");
    }
}

#[tokio::test]
async fn test_preference_value_size_and_missing_field() {
    let (app, _) = common::setup_test_app().await;

    common::register_user(&app, "alice", "Password123!", None).await;
    let (_, login_res) =
        common::login_user(&app, "alice", "Password123!", "client_device1_123456", None).await;
    let token = login_res["session_token"].as_str().unwrap();

    // 1. Missing value field
    let req = Request::builder()
        .method("PATCH")
        .uri("/api/v1/users/me/preferences/theme")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({}).to_string()))
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);

    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let res: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(res["error"], "missing_field");
    assert_eq!(res["details"]["field"], "value");

    // 2. Exactly 64 KB value serialized
    // "a..." with quotes is serialized size. "a" * (65536 - 2) = 65534 chars -> + 2 quotes = 65536 bytes.
    let exact_64k_str = "a".repeat(65_534);
    let req = Request::builder()
        .method("PATCH")
        .uri("/api/v1/users/me/preferences/exact-size")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "value": exact_64k_str }).to_string()))
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    // 3. 64 KB + 1 byte value
    let too_large_str = "a".repeat(65_535); // 65535 chars + 2 quotes = 65537 bytes
    let req = Request::builder()
        .method("PATCH")
        .uri("/api/v1/users/me/preferences/large-size")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "value": too_large_str }).to_string()))
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::PAYLOAD_TOO_LARGE);

    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let res: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(res["error"], "value_too_large");
    assert_eq!(res["details"]["limit"], 65536);
    assert_eq!(res["details"]["size"], 65537);
}
