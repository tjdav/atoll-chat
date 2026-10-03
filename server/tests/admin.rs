mod common;

use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use common::{register_user, setup_test_app};
use serde_json::{json, Value};
use tower::ServiceExt;

async fn setup_owner_and_member() -> (axum::Router, sqlx::SqlitePool, String, String) {
    let (app, pool) = setup_test_app().await;

    // First registered user becomes owner
    let _owner_id = register_user(&app, "owner_user", "Password123!", None).await;
    let (status, login_res) = common::login_user(
        &app,
        "owner_user",
        "Password123!",
        "owner_device_client_1",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let owner_token = login_res["session_token"].as_str().unwrap().to_string();

    // Create an invite for member
    let req_invite = Request::builder()
        .method("POST")
        .uri("/api/v1/admin/invites")
        .header(header::AUTHORIZATION, format!("Bearer {}", owner_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "max_uses": 1 }).to_string()))
        .unwrap();

    let resp_invite = app.clone().oneshot(req_invite).await.unwrap();
    let body_bytes = axum::body::to_bytes(resp_invite.into_body(), usize::MAX)
        .await
        .unwrap();
    let invite_json: Value = serde_json::from_slice(&body_bytes).unwrap();
    let invite_code = invite_json["code"].as_str().unwrap();

    // Register second user (member)
    let _member_id = register_user(&app, "member_user", "Password123!", Some(invite_code)).await;
    let (status_m, login_res_m) = common::login_user(
        &app,
        "member_user",
        "Password123!",
        "member_device_client_1",
        None,
    )
    .await;
    assert_eq!(status_m, StatusCode::OK);
    let member_token = login_res_m["session_token"].as_str().unwrap().to_string();

    (app, pool, owner_token, member_token)
}

#[tokio::test]
async fn test_01_owner_can_read_config() {
    let (app, _pool, owner_token, _member_token) = setup_owner_and_member().await;

    let req = Request::builder()
        .method("GET")
        .uri("/api/v1/admin/config")
        .header(header::AUTHORIZATION, format!("Bearer {}", owner_token))
        .body(Body::empty())
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body_bytes).unwrap();

    assert!(json.get("moderation_mode").is_some());
    assert!(json.get("altcha_enabled").is_some());
    assert!(json.get("safety_number_mode").is_some());
    assert!(json.get("push_enabled").is_some());
}

#[tokio::test]
async fn test_02_owner_can_update_moderation_mode() {
    let (app, _pool, owner_token, _member_token) = setup_owner_and_member().await;

    let req = Request::builder()
        .method("PATCH")
        .uri("/api/v1/admin/config")
        .header(header::AUTHORIZATION, format!("Bearer {}", owner_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({ "moderation_mode": "discord" }).to_string(),
        ))
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body_bytes).unwrap();

    assert_eq!(json["moderation_mode"], "discord");
}

#[tokio::test]
async fn test_03_member_cannot_read_config() {
    let (app, _pool, _owner_token, member_token) = setup_owner_and_member().await;

    let req = Request::builder()
        .method("GET")
        .uri("/api/v1/admin/config")
        .header(header::AUTHORIZATION, format!("Bearer {}", member_token))
        .body(Body::empty())
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);

    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(json["error"], "forbidden");
}

#[tokio::test]
async fn test_04_member_cannot_update_config() {
    let (app, _pool, _owner_token, member_token) = setup_owner_and_member().await;

    let req = Request::builder()
        .method("PATCH")
        .uri("/api/v1/admin/config")
        .header(header::AUTHORIZATION, format!("Bearer {}", member_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({ "moderation_mode": "discord" }).to_string(),
        ))
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn test_05_invalid_moderation_mode_value_returns_400() {
    let (app, _pool, owner_token, _member_token) = setup_owner_and_member().await;

    let req = Request::builder()
        .method("PATCH")
        .uri("/api/v1/admin/config")
        .header(header::AUTHORIZATION, format!("Bearer {}", owner_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({ "moderation_mode": "invalid_mode" }).to_string(),
        ))
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);

    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(json["error"], "invalid_config_value");
}

#[tokio::test]
async fn test_06_setting_secret_key_via_config_patch_returns_400() {
    let (app, _pool, owner_token, _member_token) = setup_owner_and_member().await;

    let req = Request::builder()
        .method("PATCH")
        .uri("/api/v1/admin/config")
        .header(header::AUTHORIZATION, format!("Bearer {}", owner_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({ "altcha_hmac_secret": "newsecret" }).to_string(),
        ))
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);

    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(json["error"], "invalid_config_key");
}

#[tokio::test]
async fn test_07_owner_can_read_limits() {
    let (app, _pool, owner_token, _member_token) = setup_owner_and_member().await;

    let req = Request::builder()
        .method("GET")
        .uri("/api/v1/admin/limits")
        .header(header::AUTHORIZATION, format!("Bearer {}", owner_token))
        .body(Body::empty())
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body_bytes).unwrap();

    assert!(json.get("file_size_bytes").is_some());
    assert!(json.get("room_size").is_some());
    assert!(json.get("server_hard_max").is_some());
}

#[tokio::test]
async fn test_08_owner_can_update_limits() {
    let (app, _pool, owner_token, _member_token) = setup_owner_and_member().await;

    let valid_limits = json!({
        "file_size_bytes": 52428800,
        "room_size": 50,
        "rooms_per_user": 20,
        "devices_per_user": 5,
        "keypackages_per_device": 10,
        "message_size_bytes": 8192,
        "attachment_retention_days": 30,
        "call_max_participants": 4,
        "reactions_per_message": 50
    });

    let req = Request::builder()
        .method("PATCH")
        .uri("/api/v1/admin/limits")
        .header(header::AUTHORIZATION, format!("Bearer {}", owner_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(valid_limits.to_string()))
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body_bytes).unwrap();

    assert_eq!(json["file_size_bytes"], 52428800);
    assert_eq!(json["room_size"], 50);
}

#[tokio::test]
async fn test_09_limits_exceeding_server_hard_max_returns_400() {
    let (app, _pool, owner_token, _member_token) = setup_owner_and_member().await;

    let excessive_limits = json!({
        "file_size_bytes": 999999999,
        "room_size": 100,
        "rooms_per_user": 50,
        "devices_per_user": 10,
        "keypackages_per_device": 20,
        "message_size_bytes": 16384,
        "attachment_retention_days": 0,
        "call_max_participants": 8,
        "reactions_per_message": 50
    });

    let req = Request::builder()
        .method("PATCH")
        .uri("/api/v1/admin/limits")
        .header(header::AUTHORIZATION, format!("Bearer {}", owner_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(excessive_limits.to_string()))
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);

    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(json["error"], "exceeds_server_max");
}

#[tokio::test]
async fn test_10_limits_below_minimum_returns_400() {
    let (app, _pool, owner_token, _member_token) = setup_owner_and_member().await;

    let below_min_limits = json!({
        "file_size_bytes": 100,
        "room_size": 100,
        "rooms_per_user": 50,
        "devices_per_user": 10,
        "keypackages_per_device": 20,
        "message_size_bytes": 16384,
        "attachment_retention_days": 0,
        "call_max_participants": 8,
        "reactions_per_message": 50
    });

    let req = Request::builder()
        .method("PATCH")
        .uri("/api/v1/admin/limits")
        .header(header::AUTHORIZATION, format!("Bearer {}", owner_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(below_min_limits.to_string()))
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);

    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(json["error"], "below_minimum");
}

#[tokio::test]
async fn test_11_patch_limits_missing_fields_returns_400() {
    let (app, _pool, owner_token, _member_token) = setup_owner_and_member().await;

    let partial_limits = json!({
        "file_size_bytes": 52428800
    });

    let req = Request::builder()
        .method("PATCH")
        .uri("/api/v1/admin/limits")
        .header(header::AUTHORIZATION, format!("Bearer {}", owner_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(partial_limits.to_string()))
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}
