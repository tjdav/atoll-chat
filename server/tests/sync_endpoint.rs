mod common;

use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use common::{login_user, register_user, setup_test_app};
use serde_json::{json, Value};

use server::sockudo::SockudoConfig;
use server::sync::UserEventEnvelope;
use server::Publisher;
use tower::ServiceExt;

#[tokio::test]
async fn test_sync_endpoint_validation_and_response() {
    let (app, _pool) = setup_test_app().await;

    let _user_id = register_user(&app, "syncuser1", "Password123!", None).await;
    let (status, login_res) = login_user(
        &app,
        "syncuser1",
        "Password123!",
        "client_sync_1_12345",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let token_a = login_res["session_token"].as_str().unwrap();

    // 1. Missing since_seq returns 400
    let req = Request::builder()
        .method("GET")
        .uri("/api/v1/users/me/sync")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let body: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(body["error"], "invalid_since_seq");

    // 2. Negative since_seq returns 400
    let req = Request::builder()
        .method("GET")
        .uri("/api/v1/users/me/sync?since_seq=-1")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let body: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(body["error"], "invalid_since_seq");

    // Malformed since_seq returns 400
    let req = Request::builder()
        .method("GET")
        .uri("/api/v1/users/me/sync?since_seq=abc")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);

    // 3. since_seq=0 returns empty arrays
    let req = Request::builder()
        .method("GET")
        .uri("/api/v1/users/me/sync?since_seq=0")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    // 7. Cache-Control header is no-store
    let cache_control = resp
        .headers()
        .get("cache-control")
        .unwrap()
        .to_str()
        .unwrap();
    assert_eq!(cache_control, "no-store");

    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let body: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(body["read_state"], json!([]));
    assert_eq!(body["user_preferences"], json!([]));
    assert_eq!(body["device_state"], json!([]));
    assert_eq!(body["starred_items"], json!([]));

    // 4. max_seq reflects device creation user_seq
    assert_eq!(body["max_seq"], 1);

    // 5. full_resync_required is false
    assert_eq!(body["full_resync_required"], false);

    // Check with non-zero since_seq
    let req = Request::builder()
        .method("GET")
        .uri("/api/v1/users/me/sync?since_seq=15")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let body: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(body["max_seq"], 15);

    // 6. Unauthenticated request returns 401
    let req = Request::builder()
        .method("GET")
        .uri("/api/v1/users/me/sync?since_seq=0")
        .body(Body::empty())
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn test_user_event_envelope_serialization() {
    let payload = json!({
        "room_id": "room_123",
        "read_up_to_seq": 42
    });

    let envelope = UserEventEnvelope::new("read.sync", 10, payload.clone());

    assert_eq!(envelope.event_type, "read.sync");
    assert_eq!(envelope.user_seq, 10);
    assert_eq!(envelope.payload, payload);

    let json_str = serde_json::to_string(&envelope).unwrap();
    let deserialized: UserEventEnvelope = serde_json::from_str(&json_str).unwrap();

    assert_eq!(deserialized.event_type, "read.sync");
    assert_eq!(deserialized.user_seq, 10);
    assert_eq!(deserialized.payload, payload);

    // Test publisher signature for private-user channel
    let config = SockudoConfig {
        http_base: "http://127.0.0.1:9000".to_string(),
        app_id: "app1".to_string(),
        app_key: "key1".to_string(),
        app_secret: "secret1".to_string(),
        enable_client_events: false,
    };
    let publisher = Publisher::new(config);
    let auth_sig = publisher.sign_channel_auth("1234.5678", "private-user-usr_01");
    assert!(auth_sig.starts_with("key1:"));
}
