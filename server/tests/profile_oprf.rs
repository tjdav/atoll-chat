mod common;

use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use base64::Engine;
use common::{login_user, register_user, setup_test_app};
use serde_json::{json, Value};
use tower::ServiceExt;

const TEST_CLIENT_ID: &str = "client_id_123456789";

fn valid_disp() -> String {
    URL_SAFE_NO_PAD.encode([0u8; 32])
}

#[tokio::test]
async fn test_profile_update_and_renamed_fields() {
    let (app, _pool) = setup_test_app().await;

    register_user(&app, "alice", "password123", None).await;
    let (_, login_body) = login_user(&app, "alice", "password123", TEST_CLIENT_ID, None).await;
    let session_token = login_body["session_token"].as_str().unwrap();

    let dummy_profile = STANDARD.encode(b"dummy profile data");
    let disp = valid_disp();

    // Patch encrypted_display and profile
    let req = Request::builder()
        .method("PATCH")
        .uri("/api/v1/users/me")
        .header(header::AUTHORIZATION, format!("Bearer {}", session_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "encrypted_display": disp,
                "profile": dummy_profile
            })
            .to_string(),
        ))
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body_bytes).unwrap();

    assert_eq!(json["encrypted_display"], disp);
    assert_eq!(json["profile"], dummy_profile);
    assert_eq!(json["profile_version"], 2);

    // Patch old field name display_name returns 400 field_renamed
    let req_old_disp = Request::builder()
        .method("PATCH")
        .uri("/api/v1/users/me")
        .header(header::AUTHORIZATION, format!("Bearer {}", session_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "display_name": "Alice"
            })
            .to_string(),
        ))
        .unwrap();

    let resp_old_disp = app.clone().oneshot(req_old_disp).await.unwrap();
    assert_eq!(resp_old_disp.status(), StatusCode::BAD_REQUEST);

    let body_bytes_old = axum::body::to_bytes(resp_old_disp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_old: Value = serde_json::from_slice(&body_bytes_old).unwrap();
    assert_eq!(json_old["error"], "field_renamed");
    assert_eq!(json_old["details"]["old"], "display_name");
    assert_eq!(json_old["details"]["new"], "encrypted_display");

    // Patch old field name profile_blob returns 400 field_renamed
    let req_old_prof = Request::builder()
        .method("PATCH")
        .uri("/api/v1/users/me")
        .header(header::AUTHORIZATION, format!("Bearer {}", session_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "profile_blob": dummy_profile
            })
            .to_string(),
        ))
        .unwrap();

    let resp_old_prof = app.clone().oneshot(req_old_prof).await.unwrap();
    assert_eq!(resp_old_prof.status(), StatusCode::BAD_REQUEST);

    let body_bytes_old_prof = axum::body::to_bytes(resp_old_prof.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_old_prof: Value = serde_json::from_slice(&body_bytes_old_prof).unwrap();
    assert_eq!(json_old_prof["error"], "field_renamed");
    assert_eq!(json_old_prof["details"]["old"], "profile_blob");
    assert_eq!(json_old_prof["details"]["new"], "profile");
}

#[tokio::test]
async fn test_clearing_encrypted_display() {
    let (app, _pool) = setup_test_app().await;

    register_user(&app, "alice", "password123", None).await;
    let (_, login_body) = login_user(&app, "alice", "password123", TEST_CLIENT_ID, None).await;
    let session_token = login_body["session_token"].as_str().unwrap();

    let disp = valid_disp();

    // Set display
    let req1 = Request::builder()
        .method("PATCH")
        .uri("/api/v1/users/me")
        .header(header::AUTHORIZATION, format!("Bearer {}", session_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "encrypted_display": disp }).to_string()))
        .unwrap();

    let resp1 = app.clone().oneshot(req1).await.unwrap();
    assert_eq!(resp1.status(), StatusCode::OK);

    // Clear display with empty string
    let req2 = Request::builder()
        .method("PATCH")
        .uri("/api/v1/users/me")
        .header(header::AUTHORIZATION, format!("Bearer {}", session_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "encrypted_display": "" }).to_string()))
        .unwrap();

    let resp2 = app.clone().oneshot(req2).await.unwrap();
    assert_eq!(resp2.status(), StatusCode::OK);

    let body_bytes2 = axum::body::to_bytes(resp2.into_body(), usize::MAX)
        .await
        .unwrap();
    let json2: Value = serde_json::from_slice(&body_bytes2).unwrap();
    assert!(json2["encrypted_display"].is_null());
}
