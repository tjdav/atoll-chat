mod common;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use serde_json::Value;
use std::collections::HashSet;
use tower::ServiceExt;

const EXPECTED_CAPABILITIES_KEYS: &[&str] = &[
    "version",
    "calling",
    "call_max_participants",
    "sessions_enabled",
    "max_sessions_per_room",
    "max_session_participants",
    "session_types",
    "model_hosting_enabled",
    "model_hosting_mode",
    "stt_models_base_url",
    "stt_default_model",
    "tts_models_base_url",
    "tts_default_model",
    "tts_models",
    "push_vapid_public_key",
    "websocket",
    "client_events_enabled",
    "altcha",
    "storage_backend",
    "storage_presign_supported",
    "storage_presign_max_ttl_seconds",
    "attachment_format",
    "attachment_chunk_size",
    "attachment_bucket_sizes",
    "attachment_accept_ranges",
    "username_oprf_enabled",
    "oprf_suite",
    "key_transparency_enabled",
    "link_preview_proxy_enabled",
    "safety_number_mode",
    "moderation_mode",
    "edit_window_seconds",
    "reactions_per_message",
    "sync_event_retention_days",
    "threading_enabled",
    "starred_items_per_user",
    "preferences_max_encrypted_bytes",
    "extension_proxy_enabled",
    "extension_proxy_max_request_bytes",
    "extension_proxy_max_response_bytes",
    "extension_proxy_supports_streaming",
    "extension_proxy_key",
];

#[tokio::test]
async fn test_capabilities_exact_key_set_enabled() {
    let (app, _pool) = common::setup_test_app().await;

    let req = Request::builder()
        .method("GET")
        .uri("/api/v1/capabilities")
        .body(Body::empty())
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_val: Value = serde_json::from_slice(&body_bytes).unwrap();
    let obj = json_val
        .as_object()
        .expect("response must be a JSON object");

    let actual_keys: HashSet<&str> = obj.keys().map(|k| k.as_str()).collect();
    let expected_keys: HashSet<&str> = EXPECTED_CAPABILITIES_KEYS.iter().copied().collect();

    let missing_keys: Vec<&&str> = expected_keys.difference(&actual_keys).collect();
    let extra_keys: Vec<&&str> = actual_keys.difference(&expected_keys).collect();

    assert!(
        missing_keys.is_empty(),
        "Capabilities response missing keys from §8.1: {:?}",
        missing_keys
    );
    assert!(
        extra_keys.is_empty(),
        "Capabilities response contains extra keys not in §8.1: {:?}",
        extra_keys
    );
    assert_eq!(actual_keys.len(), 42);
    assert_eq!(obj["client_events_enabled"], true);

    // Verify websocket capability nested object
    let ws = obj.get("websocket").expect("websocket object missing");
    assert!(ws["url"].is_string());
    assert_eq!(ws["protocol"], "pusher-v7");
    assert_eq!(ws["app_key"], "test-key");
    assert_eq!(ws["auth_endpoint"], "/ws/auth");

    // Verify flat fields are absent
    assert!(obj.get("websocket_url").is_none());
    assert!(obj.get("sockudo_app_key").is_none());
    assert!(obj.get("sockudo_channel_prefix").is_none());
    assert!(obj.get("sockudo_auth_endpoint").is_none());
}

#[tokio::test]
async fn test_capabilities_exact_key_set_disabled() {
    let (app, _pool, _altcha) = common::setup_test_app_with_custom_config(|c| {
        c.calling_enabled = false;
        c.sessions_enabled = false;
        c.model_hosting_enabled = false;
        c.push_enabled = false;
        c.key_transparency_enabled = false;
        c.link_preview_proxy_enabled = false;
        c.extension_proxy_enabled = false;
        c.altcha_enabled = false;
        c.username_oprf_enabled = false;
    })
    .await;

    let req = Request::builder()
        .method("GET")
        .uri("/api/v1/capabilities")
        .body(Body::empty())
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_val: Value = serde_json::from_slice(&body_bytes).unwrap();
    let obj = json_val
        .as_object()
        .expect("response must be a JSON object");

    let actual_keys: HashSet<&str> = obj.keys().map(|k| k.as_str()).collect();
    let expected_keys: HashSet<&str> = EXPECTED_CAPABILITIES_KEYS.iter().copied().collect();

    let missing_keys: Vec<&&str> = expected_keys.difference(&actual_keys).collect();
    let extra_keys: Vec<&&str> = actual_keys.difference(&expected_keys).collect();

    assert!(
        missing_keys.is_empty(),
        "Disabled capabilities response missing keys from §8.1: {:?}",
        missing_keys
    );
    assert!(
        extra_keys.is_empty(),
        "Disabled capabilities response contains extra keys not in §8.1: {:?}",
        extra_keys
    );
    assert_eq!(actual_keys.len(), 42);

    // Verify disabled shapes
    assert_eq!(obj["calling"], false);
    assert_eq!(obj["sessions_enabled"], false);
    assert_eq!(obj["session_types"], serde_json::json!([]));
    assert_eq!(obj["model_hosting_enabled"], false);
    assert_eq!(obj["tts_models"], serde_json::json!([]));
    assert_eq!(obj["push_vapid_public_key"], Value::Null);
    assert_eq!(obj["altcha"]["enabled"], false);
    assert_eq!(obj["key_transparency_enabled"], false);
    assert_eq!(obj["link_preview_proxy_enabled"], false);
    assert_eq!(obj["extension_proxy_enabled"], false);
    assert_eq!(obj["extension_proxy_key"], Value::Null);
}

#[tokio::test]
async fn test_capabilities_client_events_enabled_toggle() {
    let (app_true, _pool_true, _altcha_true) = common::setup_test_app_with_custom_config(|c| {
        c.websocket_enable_client_events = true;
    })
    .await;

    let req_true = Request::builder()
        .method("GET")
        .uri("/api/v1/capabilities")
        .body(Body::empty())
        .unwrap();

    let resp_true = app_true.oneshot(req_true).await.unwrap();
    assert_eq!(resp_true.status(), StatusCode::OK);
    let body_true = axum::body::to_bytes(resp_true.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_true: Value = serde_json::from_slice(&body_true).unwrap();
    assert_eq!(json_true["client_events_enabled"], true);

    let (app_false, _pool_false, _altcha_false) = common::setup_test_app_with_custom_config(|c| {
        c.websocket_enable_client_events = false;
    })
    .await;

    let req_false = Request::builder()
        .method("GET")
        .uri("/api/v1/capabilities")
        .body(Body::empty())
        .unwrap();

    let resp_false = app_false.oneshot(req_false).await.unwrap();
    assert_eq!(resp_false.status(), StatusCode::OK);
    let body_false = axum::body::to_bytes(resp_false.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_false: Value = serde_json::from_slice(&body_false).unwrap();
    assert_eq!(json_false["client_events_enabled"], false);
}

#[tokio::test]
async fn test_capabilities_custom_websocket_auth_path() {
    let (app, _pool, _altcha) = common::setup_test_app_with_custom_config(|c| {
        c.websocket_auth_path = "/custom-path/auth".to_string();
    })
    .await;

    let req = Request::builder()
        .method("GET")
        .uri("/api/v1/capabilities")
        .body(Body::empty())
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_val: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(json_val["websocket"]["auth_endpoint"], "/custom-path/auth");
}
