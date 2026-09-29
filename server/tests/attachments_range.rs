mod common;

use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use common::{login_user, register_user, setup_test_app};
use serde_json::Value;
use sha2::{Digest, Sha256};
use tower::ServiceExt;

async fn upload_test_blob(
    app: &axum::Router,
    token: &str,
    room_id: &str,
    blob: Vec<u8>,
    content_type: &str,
) -> String {
    let mut hasher = Sha256::new();
    hasher.update(&blob);
    let blob_id = hex::encode(hasher.finalize());

    let chunk_size = 16384;
    let chunk_count = blob.len().div_ceil(chunk_size);
    let nonce_prefix = BASE64.encode([1, 2, 3, 4, 5, 6, 7]);

    let req = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/attachments", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header("X-Claimed-Id", &blob_id)
        .header(
            "X-Plaintext-Size",
            (blob.len() - 16 * chunk_count).to_string(),
        )
        .header("X-Encrypted-Size", blob.len().to_string())
        .header("X-Chunk-Size", chunk_size.to_string())
        .header("X-Chunk-Count", chunk_count.to_string())
        .header("X-Nonce-Prefix", &nonce_prefix)
        .header("X-Base-Counter", "0")
        .header("X-Content-Type", content_type)
        .header(header::CONTENT_TYPE, "application/octet-stream")
        .body(Body::from(blob))
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED);
    blob_id
}

#[tokio::test]
async fn test_01_full_download_has_accept_ranges() {
    let (app, _pool) = setup_test_app().await;

    let _user_a = register_user(&app, "alice", "password123", None).await;
    let (_, login_a) = login_user(&app, "alice", "password123", "client_a_123456789", None).await;
    let token_a = login_a["session_token"].as_str().unwrap();

    // Create room
    let req_create = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from("{}"))
        .unwrap();

    let resp_create = app.clone().oneshot(req_create).await.unwrap();
    let body_bytes = axum::body::to_bytes(resp_create.into_body(), usize::MAX)
        .await
        .unwrap();
    let room_json: Value = serde_json::from_slice(&body_bytes).unwrap();
    let room_id = room_json["id"].as_str().unwrap();

    let blob = vec![0x42u8; 65536];
    let blob_id = upload_test_blob(&app, token_a, room_id, blob, "video/mp4").await;

    // GET full download
    let req_dl = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/attachments/{}", blob_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();

    let resp_dl = app.clone().oneshot(req_dl).await.unwrap();
    assert_eq!(resp_dl.status(), StatusCode::OK);

    assert_eq!(
        resp_dl.headers().get(header::ACCEPT_RANGES).unwrap(),
        "bytes"
    );
}

#[tokio::test]
async fn test_02_range_bytes_0_1023_returns_206() {
    let (app, _pool) = setup_test_app().await;

    let _user_a = register_user(&app, "alice", "password123", None).await;
    let (_, login_a) = login_user(&app, "alice", "password123", "client_a_123456789", None).await;
    let token_a = login_a["session_token"].as_str().unwrap();

    let req_create = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from("{}"))
        .unwrap();

    let resp_create = app.clone().oneshot(req_create).await.unwrap();
    let body_bytes = axum::body::to_bytes(resp_create.into_body(), usize::MAX)
        .await
        .unwrap();
    let room_json: Value = serde_json::from_slice(&body_bytes).unwrap();
    let room_id = room_json["id"].as_str().unwrap();

    // 64 KB blob with distinct pattern
    let blob: Vec<u8> = (0..65536).map(|i| (i % 256) as u8).collect();
    let blob_id = upload_test_blob(&app, token_a, room_id, blob.clone(), "video/mp4").await;

    let req_range = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/attachments/{}", blob_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::RANGE, "bytes=0-1023")
        .body(Body::empty())
        .unwrap();

    let resp_range = app.clone().oneshot(req_range).await.unwrap();
    assert_eq!(resp_range.status(), StatusCode::PARTIAL_CONTENT);

    assert_eq!(
        resp_range.headers().get(header::CONTENT_RANGE).unwrap(),
        "bytes 0-1023/65536"
    );
    assert_eq!(
        resp_range.headers().get(header::CONTENT_LENGTH).unwrap(),
        "1024"
    );

    let range_bytes = axum::body::to_bytes(resp_range.into_body(), usize::MAX)
        .await
        .unwrap();
    assert_eq!(range_bytes.len(), 1024);
    assert_eq!(range_bytes.as_ref(), &blob[0..1024]);
}

#[tokio::test]
async fn test_03_range_bytes_1024_returns_tail() {
    let (app, _pool) = setup_test_app().await;

    let _user_a = register_user(&app, "alice", "password123", None).await;
    let (_, login_a) = login_user(&app, "alice", "password123", "client_a_123456789", None).await;
    let token_a = login_a["session_token"].as_str().unwrap();

    let req_create = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from("{}"))
        .unwrap();

    let resp_create = app.clone().oneshot(req_create).await.unwrap();
    let body_bytes = axum::body::to_bytes(resp_create.into_body(), usize::MAX)
        .await
        .unwrap();
    let room_json: Value = serde_json::from_slice(&body_bytes).unwrap();
    let room_id = room_json["id"].as_str().unwrap();

    let blob: Vec<u8> = (0..65536).map(|i| (i % 256) as u8).collect();
    let blob_id = upload_test_blob(&app, token_a, room_id, blob.clone(), "video/mp4").await;

    let req_range = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/attachments/{}", blob_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::RANGE, "bytes=1024-")
        .body(Body::empty())
        .unwrap();

    let resp_range = app.clone().oneshot(req_range).await.unwrap();
    assert_eq!(resp_range.status(), StatusCode::PARTIAL_CONTENT);

    assert_eq!(
        resp_range.headers().get(header::CONTENT_RANGE).unwrap(),
        "bytes 1024-65535/65536"
    );
    assert_eq!(
        resp_range.headers().get(header::CONTENT_LENGTH).unwrap(),
        "64512"
    );

    let range_bytes = axum::body::to_bytes(resp_range.into_body(), usize::MAX)
        .await
        .unwrap();
    assert_eq!(range_bytes.len(), 64512);
    assert_eq!(range_bytes.as_ref(), &blob[1024..65536]);
}

#[tokio::test]
async fn test_04_range_suffix_1024_returns_last_1024_bytes() {
    let (app, _pool) = setup_test_app().await;

    let _user_a = register_user(&app, "alice", "password123", None).await;
    let (_, login_a) = login_user(&app, "alice", "password123", "client_a_123456789", None).await;
    let token_a = login_a["session_token"].as_str().unwrap();

    let req_create = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from("{}"))
        .unwrap();

    let resp_create = app.clone().oneshot(req_create).await.unwrap();
    let body_bytes = axum::body::to_bytes(resp_create.into_body(), usize::MAX)
        .await
        .unwrap();
    let room_json: Value = serde_json::from_slice(&body_bytes).unwrap();
    let room_id = room_json["id"].as_str().unwrap();

    let blob: Vec<u8> = (0..65536).map(|i| (i % 256) as u8).collect();
    let blob_id = upload_test_blob(&app, token_a, room_id, blob.clone(), "video/mp4").await;

    let req_range = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/attachments/{}", blob_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::RANGE, "bytes=-1024")
        .body(Body::empty())
        .unwrap();

    let resp_range = app.clone().oneshot(req_range).await.unwrap();
    assert_eq!(resp_range.status(), StatusCode::PARTIAL_CONTENT);

    assert_eq!(
        resp_range.headers().get(header::CONTENT_RANGE).unwrap(),
        "bytes 64512-65535/65536"
    );

    let range_bytes = axum::body::to_bytes(resp_range.into_body(), usize::MAX)
        .await
        .unwrap();
    assert_eq!(range_bytes.len(), 1024);
    assert_eq!(range_bytes.as_ref(), &blob[64512..65536]);
}

#[tokio::test]
async fn test_05_range_beyond_file_size_is_clipped() {
    let (app, _pool) = setup_test_app().await;

    let _user_a = register_user(&app, "alice", "password123", None).await;
    let (_, login_a) = login_user(&app, "alice", "password123", "client_a_123456789", None).await;
    let token_a = login_a["session_token"].as_str().unwrap();

    let req_create = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from("{}"))
        .unwrap();

    let resp_create = app.clone().oneshot(req_create).await.unwrap();
    let body_bytes = axum::body::to_bytes(resp_create.into_body(), usize::MAX)
        .await
        .unwrap();
    let room_json: Value = serde_json::from_slice(&body_bytes).unwrap();
    let room_id = room_json["id"].as_str().unwrap();

    let blob = vec![0x42u8; 65536];
    let blob_id = upload_test_blob(&app, token_a, room_id, blob, "video/mp4").await;

    let req_range = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/attachments/{}", blob_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::RANGE, "bytes=0-999999")
        .body(Body::empty())
        .unwrap();

    let resp_range = app.clone().oneshot(req_range).await.unwrap();
    assert_eq!(resp_range.status(), StatusCode::PARTIAL_CONTENT);

    assert_eq!(
        resp_range.headers().get(header::CONTENT_RANGE).unwrap(),
        "bytes 0-65535/65536"
    );
}

#[tokio::test]
async fn test_06_range_start_beyond_file_size_returns_416() {
    let (app, _pool) = setup_test_app().await;

    let _user_a = register_user(&app, "alice", "password123", None).await;
    let (_, login_a) = login_user(&app, "alice", "password123", "client_a_123456789", None).await;
    let token_a = login_a["session_token"].as_str().unwrap();

    let req_create = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from("{}"))
        .unwrap();

    let resp_create = app.clone().oneshot(req_create).await.unwrap();
    let body_bytes = axum::body::to_bytes(resp_create.into_body(), usize::MAX)
        .await
        .unwrap();
    let room_json: Value = serde_json::from_slice(&body_bytes).unwrap();
    let room_id = room_json["id"].as_str().unwrap();

    let blob = vec![0x42u8; 65536];
    let blob_id = upload_test_blob(&app, token_a, room_id, blob, "video/mp4").await;

    let req_range = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/attachments/{}", blob_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::RANGE, "bytes=999999-")
        .body(Body::empty())
        .unwrap();

    let resp_range = app.clone().oneshot(req_range).await.unwrap();
    assert_eq!(resp_range.status(), StatusCode::RANGE_NOT_SATISFIABLE);

    assert_eq!(
        resp_range.headers().get(header::CONTENT_RANGE).unwrap(),
        "bytes */65536"
    );
}

#[tokio::test]
async fn test_07_malformed_range_returns_416() {
    let (app, _pool) = setup_test_app().await;

    let _user_a = register_user(&app, "alice", "password123", None).await;
    let (_, login_a) = login_user(&app, "alice", "password123", "client_a_123456789", None).await;
    let token_a = login_a["session_token"].as_str().unwrap();

    let req_create = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from("{}"))
        .unwrap();

    let resp_create = app.clone().oneshot(req_create).await.unwrap();
    let body_bytes = axum::body::to_bytes(resp_create.into_body(), usize::MAX)
        .await
        .unwrap();
    let room_json: Value = serde_json::from_slice(&body_bytes).unwrap();
    let room_id = room_json["id"].as_str().unwrap();

    let blob = vec![0x42u8; 65536];
    let blob_id = upload_test_blob(&app, token_a, room_id, blob, "video/mp4").await;

    let req_range = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/attachments/{}", blob_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::RANGE, "bytes=abc-def")
        .body(Body::empty())
        .unwrap();

    let resp_range = app.clone().oneshot(req_range).await.unwrap();
    assert_eq!(resp_range.status(), StatusCode::RANGE_NOT_SATISFIABLE);
}

#[tokio::test]
async fn test_08_multiple_ranges_return_416() {
    let (app, _pool) = setup_test_app().await;

    let _user_a = register_user(&app, "alice", "password123", None).await;
    let (_, login_a) = login_user(&app, "alice", "password123", "client_a_123456789", None).await;
    let token_a = login_a["session_token"].as_str().unwrap();

    let req_create = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from("{}"))
        .unwrap();

    let resp_create = app.clone().oneshot(req_create).await.unwrap();
    let body_bytes = axum::body::to_bytes(resp_create.into_body(), usize::MAX)
        .await
        .unwrap();
    let room_json: Value = serde_json::from_slice(&body_bytes).unwrap();
    let room_id = room_json["id"].as_str().unwrap();

    let blob = vec![0x42u8; 65536];
    let blob_id = upload_test_blob(&app, token_a, room_id, blob, "video/mp4").await;

    let req_range = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/attachments/{}", blob_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::RANGE, "bytes=0-100,200-300")
        .body(Body::empty())
        .unwrap();

    let resp_range = app.clone().oneshot(req_range).await.unwrap();
    assert_eq!(resp_range.status(), StatusCode::RANGE_NOT_SATISFIABLE);
}

#[tokio::test]
async fn test_09_non_bytes_unit_returns_416() {
    let (app, _pool) = setup_test_app().await;

    let _user_a = register_user(&app, "alice", "password123", None).await;
    let (_, login_a) = login_user(&app, "alice", "password123", "client_a_123456789", None).await;
    let token_a = login_a["session_token"].as_str().unwrap();

    let req_create = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from("{}"))
        .unwrap();

    let resp_create = app.clone().oneshot(req_create).await.unwrap();
    let body_bytes = axum::body::to_bytes(resp_create.into_body(), usize::MAX)
        .await
        .unwrap();
    let room_json: Value = serde_json::from_slice(&body_bytes).unwrap();
    let room_id = room_json["id"].as_str().unwrap();

    let blob = vec![0x42u8; 65536];
    let blob_id = upload_test_blob(&app, token_a, room_id, blob, "video/mp4").await;

    let req_range = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/attachments/{}", blob_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::RANGE, "items=0-100")
        .body(Body::empty())
        .unwrap();

    let resp_range = app.clone().oneshot(req_range).await.unwrap();
    assert_eq!(resp_range.status(), StatusCode::RANGE_NOT_SATISFIABLE);
}

#[tokio::test]
async fn test_10_range_request_returns_correct_x_attachment_headers() {
    let (app, _pool) = setup_test_app().await;

    let _user_a = register_user(&app, "alice", "password123", None).await;
    let (_, login_a) = login_user(&app, "alice", "password123", "client_a_123456789", None).await;
    let token_a = login_a["session_token"].as_str().unwrap();

    let req_create = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from("{}"))
        .unwrap();

    let resp_create = app.clone().oneshot(req_create).await.unwrap();
    let body_bytes = axum::body::to_bytes(resp_create.into_body(), usize::MAX)
        .await
        .unwrap();
    let room_json: Value = serde_json::from_slice(&body_bytes).unwrap();
    let room_id = room_json["id"].as_str().unwrap();

    let blob = vec![0x42u8; 65536];
    let blob_id = upload_test_blob(&app, token_a, room_id, blob, "video/mp4").await;

    let req_range = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/attachments/{}", blob_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::RANGE, "bytes=0-1023")
        .body(Body::empty())
        .unwrap();

    let resp_range = app.clone().oneshot(req_range).await.unwrap();
    assert_eq!(resp_range.status(), StatusCode::PARTIAL_CONTENT);

    assert_eq!(
        resp_range.headers().get("X-Attachment-Chunk-Size").unwrap(),
        "16384"
    );
    assert_eq!(
        resp_range
            .headers()
            .get("X-Attachment-Chunk-Count")
            .unwrap(),
        "4"
    );
    assert!(resp_range
        .headers()
        .get("X-Attachment-Nonce-Prefix")
        .is_some());
    assert_eq!(
        resp_range
            .headers()
            .get("X-Attachment-Base-Counter")
            .unwrap(),
        "0"
    );
}

#[tokio::test]
async fn test_11_range_request_with_if_none_match_returns_304() {
    let (app, _pool) = setup_test_app().await;

    let _user_a = register_user(&app, "alice", "password123", None).await;
    let (_, login_a) = login_user(&app, "alice", "password123", "client_a_123456789", None).await;
    let token_a = login_a["session_token"].as_str().unwrap();

    let req_create = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from("{}"))
        .unwrap();

    let resp_create = app.clone().oneshot(req_create).await.unwrap();
    let body_bytes = axum::body::to_bytes(resp_create.into_body(), usize::MAX)
        .await
        .unwrap();
    let room_json: Value = serde_json::from_slice(&body_bytes).unwrap();
    let room_id = room_json["id"].as_str().unwrap();

    let blob = vec![0x42u8; 65536];
    let blob_id = upload_test_blob(&app, token_a, room_id, blob, "video/mp4").await;

    let req_304 = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/attachments/{}", blob_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::RANGE, "bytes=0-1023")
        .header(header::IF_NONE_MATCH, format!("\"{}\"", blob_id))
        .body(Body::empty())
        .unwrap();

    let resp_304 = app.clone().oneshot(req_304).await.unwrap();
    assert_eq!(resp_304.status(), StatusCode::NOT_MODIFIED);
}

#[tokio::test]
async fn test_12_range_request_by_non_member_returns_404() {
    let (app, pool) = setup_test_app().await;

    let _user_a = register_user(&app, "alice", "password123", None).await;
    let (_, login_a) = login_user(&app, "alice", "password123", "client_a_123456789", None).await;
    let token_a = login_a["session_token"].as_str().unwrap();

    let req_create = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from("{}"))
        .unwrap();

    let resp_create = app.clone().oneshot(req_create).await.unwrap();
    let body_bytes = axum::body::to_bytes(resp_create.into_body(), usize::MAX)
        .await
        .unwrap();
    let room_json: Value = serde_json::from_slice(&body_bytes).unwrap();
    let room_id = room_json["id"].as_str().unwrap();

    let blob = vec![0x42u8; 65536];
    let blob_id = upload_test_blob(&app, token_a, room_id, blob, "video/mp4").await;

    // Register Bob (non-member)
    sqlx::query(
        "INSERT INTO server_invites (id, code, max_uses, current_uses) VALUES ('inv_1', 'INVITE123', 1, 0)",
    )
    .execute(&pool)
    .await
    .unwrap();

    let _user_b = register_user(&app, "bob", "password123", Some("INVITE123")).await;
    let (_, login_b) = login_user(&app, "bob", "password123", "client_b_123456789", None).await;
    let token_b = login_b["session_token"].as_str().unwrap();

    let req_range = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/attachments/{}", blob_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_b))
        .header(header::RANGE, "bytes=0-1023")
        .body(Body::empty())
        .unwrap();

    let resp_range = app.clone().oneshot(req_range).await.unwrap();
    assert_eq!(resp_range.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn test_13_range_request_on_unknown_id_returns_404() {
    let (app, _pool) = setup_test_app().await;

    let _user_a = register_user(&app, "alice", "password123", None).await;
    let (_, login_a) = login_user(&app, "alice", "password123", "client_a_123456789", None).await;
    let token_a = login_a["session_token"].as_str().unwrap();

    let fake_id = "0".repeat(64);

    let req_range = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/attachments/{}", fake_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::RANGE, "bytes=0-1023")
        .body(Body::empty())
        .unwrap();

    let resp_range = app.clone().oneshot(req_range).await.unwrap();
    assert_eq!(resp_range.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn test_14_cross_chunk_range() {
    let (app, _pool) = setup_test_app().await;

    let _user_a = register_user(&app, "alice", "password123", None).await;
    let (_, login_a) = login_user(&app, "alice", "password123", "client_a_123456789", None).await;
    let token_a = login_a["session_token"].as_str().unwrap();

    let req_create = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from("{}"))
        .unwrap();

    let resp_create = app.clone().oneshot(req_create).await.unwrap();
    let body_bytes = axum::body::to_bytes(resp_create.into_body(), usize::MAX)
        .await
        .unwrap();
    let room_json: Value = serde_json::from_slice(&body_bytes).unwrap();
    let room_id = room_json["id"].as_str().unwrap();

    // 524,288 bytes (512 KB blob, fits in bucket 524288)
    let blob: Vec<u8> = (0..524288).map(|i| (i % 256) as u8).collect();
    let blob_id = upload_test_blob(&app, token_a, room_id, blob.clone(), "video/mp4").await;

    // Range spanning across chunk boundaries e.g. 60000-70000
    let req_range = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/attachments/{}", blob_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::RANGE, "bytes=60000-70000")
        .body(Body::empty())
        .unwrap();

    let resp_range = app.clone().oneshot(req_range).await.unwrap();
    assert_eq!(resp_range.status(), StatusCode::PARTIAL_CONTENT);

    let range_bytes = axum::body::to_bytes(resp_range.into_body(), usize::MAX)
        .await
        .unwrap();
    assert_eq!(range_bytes.len(), 10001);
    assert_eq!(range_bytes.as_ref(), &blob[60000..=70000]);
}

#[tokio::test]
async fn test_15_seeking_pattern() {
    let (app, _pool) = setup_test_app().await;

    let _user_a = register_user(&app, "alice", "password123", None).await;
    let (_, login_a) = login_user(&app, "alice", "password123", "client_a_123456789", None).await;
    let token_a = login_a["session_token"].as_str().unwrap();

    let req_create = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from("{}"))
        .unwrap();

    let resp_create = app.clone().oneshot(req_create).await.unwrap();
    let body_bytes = axum::body::to_bytes(resp_create.into_body(), usize::MAX)
        .await
        .unwrap();
    let room_json: Value = serde_json::from_slice(&body_bytes).unwrap();
    let room_id = room_json["id"].as_str().unwrap();

    // 524,288 bytes (512 KB blob)
    let blob: Vec<u8> = (0..524288).map(|i| (i % 256) as u8).collect();
    let blob_id = upload_test_blob(&app, token_a, room_id, blob.clone(), "video/mp4").await;

    // Simulate seeking to 25%, 50%, 75%
    let positions = [(131072, 132095), (262144, 263167), (393216, 394239)];

    for (start, end) in positions {
        let req_range = Request::builder()
            .method("GET")
            .uri(format!("/api/v1/attachments/{}", blob_id))
            .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
            .header(header::RANGE, format!("bytes={}-{}", start, end))
            .body(Body::empty())
            .unwrap();

        let resp_range = app.clone().oneshot(req_range).await.unwrap();
        assert_eq!(resp_range.status(), StatusCode::PARTIAL_CONTENT);

        let range_bytes = axum::body::to_bytes(resp_range.into_body(), usize::MAX)
            .await
            .unwrap();
        assert_eq!(range_bytes.len(), 1024);
        assert_eq!(range_bytes.as_ref(), &blob[start..=end]);
    }
}
