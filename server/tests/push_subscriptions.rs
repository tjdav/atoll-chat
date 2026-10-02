mod common;

use axum::{
    body::Body,
    http::{header, Request, StatusCode},
};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use common::{login_user, login_user_with_device_name, register_user, setup_test_app};
use serde_json::{json, Value};
use tower::ServiceExt;

const CLIENT_A: &str = "client_a_123456789";
const CLIENT_B: &str = "client_b_123456789";

#[tokio::test]
async fn test_register_web_subscription() {
    let (app, _pool) = setup_test_app().await;
    register_user(&app, "web_user", "password123", None).await;
    let (_, login_body) = login_user(&app, "web_user", "password123", CLIENT_A, None).await;
    let token = login_body["session_token"].as_str().unwrap();

    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/users/me/push-subscriptions")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "platform": "web",
                "endpoint": "https://fcm.googleapis.com/fcm/send/test123",
                "p256dh": "dGVzdA",
                "auth": "dGVzdA",
                "browser_id": "browser-1",
                "user_agent": "Mozilla/5.0"
            })
            .to_string(),
        ))
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED);

    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let body: Value = serde_json::from_slice(&body_bytes).unwrap();

    assert!(body["id"].is_string());
    assert_eq!(body["platform"], "web");
    assert_eq!(body["browser_id"], "browser-1");
    assert!(body.get("endpoint").is_none());
    assert!(body.get("p256dh").is_none());
    assert!(body.get("auth").is_none());
    assert!(body.get("push_token").is_none());
}

#[tokio::test]
async fn test_register_ios_subscription() {
    let (app, _pool) = setup_test_app().await;
    register_user(&app, "ios_user", "password123", None).await;
    let (_, login_body) = login_user(&app, "ios_user", "password123", CLIENT_A, None).await;
    let token = login_body["session_token"].as_str().unwrap();

    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/users/me/push-subscriptions")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "platform": "ios",
                "push_token": "apns-token-hex-123456"
            })
            .to_string(),
        ))
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED);

    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let body: Value = serde_json::from_slice(&body_bytes).unwrap();

    assert_eq!(body["platform"], "ios");
    assert!(body.get("push_token").is_none());
}

#[tokio::test]
async fn test_register_invalid_platform() {
    let (app, _pool) = setup_test_app().await;
    register_user(&app, "invalid_plat_user", "password123", None).await;
    let (_, login_body) =
        login_user(&app, "invalid_plat_user", "password123", CLIENT_A, None).await;
    let token = login_body["session_token"].as_str().unwrap();

    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/users/me/push-subscriptions")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "platform": "linux",
                "endpoint": "https://example.com"
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

    assert_eq!(body["error"], "invalid_platform");
    assert_eq!(body["details"]["received"], "linux");
}

#[tokio::test]
async fn test_register_web_missing_endpoint() {
    let (app, _pool) = setup_test_app().await;
    register_user(&app, "no_ep_user", "password123", None).await;
    let (_, login_body) = login_user(&app, "no_ep_user", "password123", CLIENT_A, None).await;
    let token = login_body["session_token"].as_str().unwrap();

    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/users/me/push-subscriptions")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "platform": "web",
                "p256dh": "dGVzdA",
                "auth": "dGVzdA",
                "browser_id": "b1"
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

    assert_eq!(body["error"], "missing_field");
    assert_eq!(body["details"]["field"], "endpoint");
}

#[tokio::test]
async fn test_register_ios_missing_push_token() {
    let (app, _pool) = setup_test_app().await;
    register_user(&app, "no_token_user", "password123", None).await;
    let (_, login_body) = login_user(&app, "no_token_user", "password123", CLIENT_A, None).await;
    let token = login_body["session_token"].as_str().unwrap();

    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/users/me/push-subscriptions")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "platform": "ios"
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

    assert_eq!(body["error"], "missing_field");
    assert_eq!(body["details"]["field"], "push_token");
}

#[tokio::test]
async fn test_reregister_same_browser_id_updates() {
    let (app, _pool) = setup_test_app().await;
    register_user(&app, "rereg_user", "password123", None).await;
    let (_, login_body) = login_user(&app, "rereg_user", "password123", CLIENT_A, None).await;
    let token = login_body["session_token"].as_str().unwrap();

    let req1 = Request::builder()
        .method("POST")
        .uri("/api/v1/users/me/push-subscriptions")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "platform": "web",
                "endpoint": "https://fcm.googleapis.com/fcm/send/old_endpoint",
                "p256dh": "key1",
                "auth": "auth1",
                "browser_id": "browser-same"
            })
            .to_string(),
        ))
        .unwrap();

    let resp1 = app.clone().oneshot(req1).await.unwrap();
    assert_eq!(resp1.status(), StatusCode::CREATED);
    let bytes1 = axum::body::to_bytes(resp1.into_body(), usize::MAX)
        .await
        .unwrap();
    let body1: Value = serde_json::from_slice(&bytes1).unwrap();
    let id1 = body1["id"].as_str().unwrap().to_string();

    let req2 = Request::builder()
        .method("POST")
        .uri("/api/v1/users/me/push-subscriptions")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "platform": "web",
                "endpoint": "https://fcm.googleapis.com/fcm/send/new_endpoint",
                "p256dh": "key2",
                "auth": "auth2",
                "browser_id": "browser-same"
            })
            .to_string(),
        ))
        .unwrap();

    let resp2 = app.clone().oneshot(req2).await.unwrap();
    assert_eq!(resp2.status(), StatusCode::CREATED);
    let bytes2 = axum::body::to_bytes(resp2.into_body(), usize::MAX)
        .await
        .unwrap();
    let body2: Value = serde_json::from_slice(&bytes2).unwrap();
    let id2 = body2["id"].as_str().unwrap().to_string();

    assert_eq!(id1, id2);

    let list_req = Request::builder()
        .method("GET")
        .uri("/api/v1/users/me/push-subscriptions")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::empty())
        .unwrap();

    let list_resp = app.clone().oneshot(list_req).await.unwrap();
    let list_bytes = axum::body::to_bytes(list_resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let list_body: Value = serde_json::from_slice(&list_bytes).unwrap();
    let subs = list_body["subscriptions"].as_array().unwrap();
    assert_eq!(subs.len(), 1);
}

#[tokio::test]
async fn test_reregister_different_browser_id_creates_new_row() {
    let (app, _pool) = setup_test_app().await;
    register_user(&app, "multi_browser_user", "password123", None).await;
    let (_, login_body) =
        login_user(&app, "multi_browser_user", "password123", CLIENT_A, None).await;
    let token = login_body["session_token"].as_str().unwrap();

    let req1 = Request::builder()
        .method("POST")
        .uri("/api/v1/users/me/push-subscriptions")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "platform": "web",
                "endpoint": "https://fcm.googleapis.com/fcm/send/ep1",
                "p256dh": "k1",
                "auth": "a1",
                "browser_id": "browser-a"
            })
            .to_string(),
        ))
        .unwrap();

    let resp1 = app.clone().oneshot(req1).await.unwrap();
    let bytes1 = axum::body::to_bytes(resp1.into_body(), usize::MAX)
        .await
        .unwrap();
    let body1: Value = serde_json::from_slice(&bytes1).unwrap();

    let req2 = Request::builder()
        .method("POST")
        .uri("/api/v1/users/me/push-subscriptions")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "platform": "web",
                "endpoint": "https://fcm.googleapis.com/fcm/send/ep2",
                "p256dh": "k2",
                "auth": "a2",
                "browser_id": "browser-b"
            })
            .to_string(),
        ))
        .unwrap();

    let resp2 = app.clone().oneshot(req2).await.unwrap();
    let bytes2 = axum::body::to_bytes(resp2.into_body(), usize::MAX)
        .await
        .unwrap();
    let body2: Value = serde_json::from_slice(&bytes2).unwrap();

    assert_ne!(body1["id"].as_str().unwrap(), body2["id"].as_str().unwrap());

    let list_req = Request::builder()
        .method("GET")
        .uri("/api/v1/users/me/push-subscriptions")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::empty())
        .unwrap();

    let list_resp = app.clone().oneshot(list_req).await.unwrap();
    let list_bytes = axum::body::to_bytes(list_resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let list_body: Value = serde_json::from_slice(&list_bytes).unwrap();
    let subs = list_body["subscriptions"].as_array().unwrap();
    assert_eq!(subs.len(), 2);
}

#[tokio::test]
async fn test_list_subscriptions_returns_non_secrets_and_excludes_revoked() {
    let (app, pool) = setup_test_app().await;
    let _user_a_id = register_user(&app, "user_list_a", "password123", None).await;

    sqlx::query("INSERT INTO server_invites (id, code, max_uses, current_uses) VALUES ('inv_list_b', 'INITCODE', 1, 0)")
        .execute(&pool)
        .await
        .unwrap();

    register_user(&app, "user_list_b", "password123", Some("INITCODE")).await;

    let (_, login_a) = login_user(&app, "user_list_a", "password123", CLIENT_A, None).await;
    let token1 = login_a["session_token"].as_str().unwrap();

    let (_, login_b) = login_user(&app, "user_list_b", "password123", CLIENT_B, None).await;
    let token2 = login_b["session_token"].as_str().unwrap();

    let req_a = Request::builder()
        .method("POST")
        .uri("/api/v1/users/me/push-subscriptions")
        .header(header::AUTHORIZATION, format!("Bearer {token1}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "platform": "web",
                "endpoint": "https://fcm.googleapis.com/fcm/send/secret_ep",
                "p256dh": "secret_key",
                "auth": "secret_auth",
                "browser_id": "b-secret"
            })
            .to_string(),
        ))
        .unwrap();

    let resp_a = app.clone().oneshot(req_a).await.unwrap();
    let bytes_a = axum::body::to_bytes(resp_a.into_body(), usize::MAX)
        .await
        .unwrap();
    let body_a: Value = serde_json::from_slice(&bytes_a).unwrap();
    let sub_id_a = body_a["id"].as_str().unwrap().to_string();

    let list_req_b = Request::builder()
        .method("GET")
        .uri("/api/v1/users/me/push-subscriptions")
        .header(header::AUTHORIZATION, format!("Bearer {token2}"))
        .body(Body::empty())
        .unwrap();

    let list_resp_b = app.clone().oneshot(list_req_b).await.unwrap();
    let list_bytes_b = axum::body::to_bytes(list_resp_b.into_body(), usize::MAX)
        .await
        .unwrap();
    let list_body_b: Value = serde_json::from_slice(&list_bytes_b).unwrap();
    assert_eq!(list_body_b["subscriptions"].as_array().unwrap().len(), 0);

    let list_req_a = Request::builder()
        .method("GET")
        .uri("/api/v1/users/me/push-subscriptions")
        .header(header::AUTHORIZATION, format!("Bearer {token1}"))
        .body(Body::empty())
        .unwrap();

    let list_resp_a = app.clone().oneshot(list_req_a).await.unwrap();
    let list_bytes_a = axum::body::to_bytes(list_resp_a.into_body(), usize::MAX)
        .await
        .unwrap();
    let list_body_a: Value = serde_json::from_slice(&list_bytes_a).unwrap();
    let subs_a = list_body_a["subscriptions"].as_array().unwrap();
    assert_eq!(subs_a.len(), 1);
    assert_eq!(subs_a[0]["id"], sub_id_a);
    assert!(subs_a[0].get("endpoint").is_none());
    assert!(subs_a[0].get("p256dh").is_none());
    assert!(subs_a[0].get("auth").is_none());

    // Revoke
    let del_req = Request::builder()
        .method("DELETE")
        .uri(format!("/api/v1/users/me/push-subscriptions/{sub_id_a}"))
        .header(header::AUTHORIZATION, format!("Bearer {token1}"))
        .body(Body::empty())
        .unwrap();

    let del_resp = app.clone().oneshot(del_req).await.unwrap();
    assert_eq!(del_resp.status(), StatusCode::NO_CONTENT);

    let list_req_a2 = Request::builder()
        .method("GET")
        .uri("/api/v1/users/me/push-subscriptions")
        .header(header::AUTHORIZATION, format!("Bearer {token1}"))
        .body(Body::empty())
        .unwrap();

    let list_resp_a2 = app.clone().oneshot(list_req_a2).await.unwrap();
    let list_bytes_a2 = axum::body::to_bytes(list_resp_a2.into_body(), usize::MAX)
        .await
        .unwrap();
    let list_body_a2: Value = serde_json::from_slice(&list_bytes_a2).unwrap();
    assert_eq!(list_body_a2["subscriptions"].as_array().unwrap().len(), 0);

    // Revoke twice -> 404
    let del_req2 = Request::builder()
        .method("DELETE")
        .uri(format!("/api/v1/users/me/push-subscriptions/{sub_id_a}"))
        .header(header::AUTHORIZATION, format!("Bearer {token1}"))
        .body(Body::empty())
        .unwrap();

    let del_resp2 = app.clone().oneshot(del_req2).await.unwrap();
    assert_eq!(del_resp2.status(), StatusCode::NOT_FOUND);

    // Revoke as another user -> 404
    let del_req_other = Request::builder()
        .method("DELETE")
        .uri(format!("/api/v1/users/me/push-subscriptions/{sub_id_a}"))
        .header(header::AUTHORIZATION, format!("Bearer {token2}"))
        .body(Body::empty())
        .unwrap();

    let del_resp_other = app.clone().oneshot(del_req_other).await.unwrap();
    assert_eq!(del_resp_other.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn test_device_revocation_deletes_linked_subscriptions() {
    let (app, _pool) = setup_test_app().await;
    register_user(&app, "cascade_user", "password123", None).await;
    let valid_dev_name = URL_SAFE_NO_PAD.encode([0u8; 32]);
    let (_, login_1) = login_user_with_device_name(
        &app,
        "cascade_user",
        "password123",
        CLIENT_A,
        None,
        Some(&valid_dev_name),
    )
    .await;
    let token1 = login_1["session_token"].as_str().unwrap();
    let device_id_1 = login_1["device_id"].as_str().unwrap();

    let req_linked = Request::builder()
        .method("POST")
        .uri("/api/v1/users/me/push-subscriptions")
        .header(header::AUTHORIZATION, format!("Bearer {token1}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "platform": "ios",
                "push_token": "token-1",
                "device_id": device_id_1
            })
            .to_string(),
        ))
        .unwrap();

    let resp_linked = app.clone().oneshot(req_linked).await.unwrap();
    assert_eq!(resp_linked.status(), StatusCode::CREATED);

    let req_unlinked = Request::builder()
        .method("POST")
        .uri("/api/v1/users/me/push-subscriptions")
        .header(header::AUTHORIZATION, format!("Bearer {token1}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "platform": "web",
                "endpoint": "https://example.com/unlinked",
                "p256dh": "k",
                "auth": "a",
                "browser_id": "b-unlinked"
            })
            .to_string(),
        ))
        .unwrap();

    let resp_unlinked = app.clone().oneshot(req_unlinked).await.unwrap();
    assert_eq!(resp_unlinked.status(), StatusCode::CREATED);

    let (_, login_2) = login_user_with_device_name(
        &app,
        "cascade_user",
        "password123",
        CLIENT_B,
        None,
        Some(&valid_dev_name),
    )
    .await;
    let token2 = login_2["session_token"].as_str().unwrap();

    let del_dev_req = Request::builder()
        .method("DELETE")
        .uri(format!("/api/v1/users/me/devices/{device_id_1}"))
        .header(header::AUTHORIZATION, format!("Bearer {token2}"))
        .body(Body::empty())
        .unwrap();

    let del_dev_resp = app.clone().oneshot(del_dev_req).await.unwrap();
    assert_eq!(del_dev_resp.status(), StatusCode::NO_CONTENT);

    let list_req = Request::builder()
        .method("GET")
        .uri("/api/v1/users/me/push-subscriptions")
        .header(header::AUTHORIZATION, format!("Bearer {token2}"))
        .body(Body::empty())
        .unwrap();

    let list_resp = app.clone().oneshot(list_req).await.unwrap();
    let list_bytes = axum::body::to_bytes(list_resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let list_body: Value = serde_json::from_slice(&list_bytes).unwrap();
    let subs = list_body["subscriptions"].as_array().unwrap();
    assert_eq!(subs.len(), 1);
    assert_eq!(subs[0]["browser_id"], "b-unlinked");
}

#[tokio::test]
async fn test_capabilities_push_fields() {
    let (app, _pool) = setup_test_app().await;

    let req = Request::builder()
        .method("GET")
        .uri("/api/v1/capabilities")
        .body(Body::empty())
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let body: Value = serde_json::from_slice(&body_bytes).unwrap();

    assert_eq!(body["push_enabled"], true);
    assert!(body["push_vapid_public_key"].is_string());
}
