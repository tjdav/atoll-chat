mod common;

use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use common::{login_user, register_user, setup_test_app};
use serde_json::{json, Value};
use sqlx::SqlitePool;
use tower::ServiceExt;

async fn create_test_user(
    app: &axum::Router,
    pool: &SqlitePool,
    username: &str,
    client_id: &str,
) -> (String, String) {
    let has_users: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM users)")
        .fetch_one(pool)
        .await
        .unwrap();

    let invite_code = if has_users {
        let code = format!("INV_{}", username);
        sqlx::query(
            "INSERT INTO server_invites (id, code, max_uses, current_uses) VALUES (?, ?, 10, 0)",
        )
        .bind(format!("inv_id_{}", username))
        .bind(&code)
        .execute(pool)
        .await
        .unwrap();
        Some(code)
    } else {
        None
    };

    let user_id = register_user(app, username, "Password123!", invite_code.as_deref()).await;
    let (status, login_res) = login_user(app, username, "Password123!", client_id, None).await;
    if status != StatusCode::OK {
        panic!(
            "login_user failed for {}: status={}, res={:?}",
            username, status, login_res
        );
    }
    let token = login_res["session_token"].as_str().unwrap().to_string();

    (user_id, token)
}

#[tokio::test]
async fn test_empty_string_and_valid_unpadded_base64url_accepted() {
    let (app, pool) = setup_test_app().await;
    let (_user_a_id, token_a) =
        create_test_user(&app, &pool, "alice", "device_client_id_a_12345").await;

    // Create room
    let req_create = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({}).to_string()))
        .unwrap();
    let resp_create = app.clone().oneshot(req_create).await.unwrap();
    let body_c = axum::body::to_bytes(resp_create.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_c: Value = serde_json::from_slice(&body_c).unwrap();
    let room_id = json_c["id"].as_str().unwrap();

    // Empty string decodes to 0 bytes <= max_bytes -> valid
    let req_patch_empty = Request::builder()
        .method("PATCH")
        .uri(format!("/api/v1/rooms/{}", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "metadata": "" }).to_string()))
        .unwrap();

    let resp_patch_empty = app.clone().oneshot(req_patch_empty).await.unwrap();
    assert_eq!(resp_patch_empty.status(), StatusCode::OK);

    let body_e = axum::body::to_bytes(resp_patch_empty.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_e: Value = serde_json::from_slice(&body_e).unwrap();
    assert_eq!(json_e["metadata"], "");
}

#[tokio::test]
async fn test_invalid_base64url_rejected() {
    let (app, pool) = setup_test_app().await;
    let (_user_a_id, token_a) =
        create_test_user(&app, &pool, "alice", "device_client_id_a_12345").await;

    // Create room
    let req_create = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({}).to_string()))
        .unwrap();
    let resp_create = app.clone().oneshot(req_create).await.unwrap();
    let body_c = axum::body::to_bytes(resp_create.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_c: Value = serde_json::from_slice(&body_c).unwrap();
    let room_id = json_c["id"].as_str().unwrap();

    // Invalid base64url characters (e.g. +, /, or invalid symbols)
    let req_patch_inv = Request::builder()
        .method("PATCH")
        .uri(format!("/api/v1/rooms/{}", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({ "metadata": "not_valid_base64!@#$" }).to_string(),
        ))
        .unwrap();

    let resp_patch_inv = app.oneshot(req_patch_inv).await.unwrap();
    assert_eq!(resp_patch_inv.status(), StatusCode::BAD_REQUEST);

    let body_i = axum::body::to_bytes(resp_patch_inv.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_i: Value = serde_json::from_slice(&body_i).unwrap();
    assert_eq!(json_i["error"], "invalid_metadata");
}

#[tokio::test]
async fn test_exact_limit_and_exceeding_limit_413() {
    let (app, pool) = setup_test_app().await;
    let (_user_a_id, token_a) =
        create_test_user(&app, &pool, "alice", "device_client_id_a_12345").await;

    // Create room
    let req_create = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({}).to_string()))
        .unwrap();
    let resp_create = app.clone().oneshot(req_create).await.unwrap();
    let body_c = axum::body::to_bytes(resp_create.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_c: Value = serde_json::from_slice(&body_c).unwrap();
    let room_id = json_c["id"].as_str().unwrap();

    // Default max_room_metadata_bytes = 16384 (16 KB)
    // 1. Exact limit: 16384 raw bytes base64url encoded
    let exact_bytes = vec![0x42u8; 16384];
    let exact_encoded = URL_SAFE_NO_PAD.encode(&exact_bytes);

    let req_patch_exact = Request::builder()
        .method("PATCH")
        .uri(format!("/api/v1/rooms/{}", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "metadata": exact_encoded }).to_string()))
        .unwrap();

    let resp_patch_exact = app.clone().oneshot(req_patch_exact).await.unwrap();
    assert_eq!(resp_patch_exact.status(), StatusCode::OK);

    // 2. Exceeding limit: 16385 raw bytes base64url encoded -> 413 metadata_too_large
    let over_bytes = vec![0x42u8; 16385];
    let over_encoded = URL_SAFE_NO_PAD.encode(&over_bytes);

    let req_patch_over = Request::builder()
        .method("PATCH")
        .uri(format!("/api/v1/rooms/{}", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "metadata": over_encoded }).to_string()))
        .unwrap();

    let resp_patch_over = app.oneshot(req_patch_over).await.unwrap();
    assert_eq!(resp_patch_over.status(), StatusCode::PAYLOAD_TOO_LARGE);

    let body_o = axum::body::to_bytes(resp_patch_over.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_o: Value = serde_json::from_slice(&body_o).unwrap();
    assert_eq!(json_o["error"], "metadata_too_large");
    assert_eq!(json_o["details"]["limit"], 16384);
    assert_eq!(json_o["details"]["size"], 16385);
}

#[tokio::test]
async fn test_padded_and_unpadded_base64url_accepted() {
    let (app, pool) = setup_test_app().await;
    let (_user_a_id, token_a) =
        create_test_user(&app, &pool, "alice", "device_client_id_a_12345").await;

    // Create room
    let req_create = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({}).to_string()))
        .unwrap();
    let resp_create = app.clone().oneshot(req_create).await.unwrap();
    let body_c = axum::body::to_bytes(resp_create.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_c: Value = serde_json::from_slice(&body_c).unwrap();
    let room_id = json_c["id"].as_str().unwrap();

    // Padded base64url string ("aGVsbG8=" -> "hello")
    let padded = "aGVsbG8=";
    let req_patch_padded = Request::builder()
        .method("PATCH")
        .uri(format!("/api/v1/rooms/{}", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "metadata": padded }).to_string()))
        .unwrap();

    let resp_patch_padded = app.oneshot(req_patch_padded).await.unwrap();
    assert_eq!(resp_patch_padded.status(), StatusCode::OK);

    let body_p = axum::body::to_bytes(resp_patch_padded.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_p: Value = serde_json::from_slice(&body_p).unwrap();
    // Returns unpadded string ("aGVsbG8")
    assert_eq!(json_p["metadata"], "aGVsbG8");
}
