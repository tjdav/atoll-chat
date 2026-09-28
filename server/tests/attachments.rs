mod common;

use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use common::{login_user, register_user, setup_test_app};
use serde_json::Value;
use sha2::{Digest, Sha256};
use tower::ServiceExt;

#[tokio::test]
async fn test_01_upload_64kb_blob_succeeds() {
    let (app, _pool) = setup_test_app().await;

    let user_a = register_user(&app, "alice", "password123", None).await;
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

    // 64 KB blob
    let blob = vec![0x42u8; 65536];
    let mut hasher = Sha256::new();
    hasher.update(&blob);
    let blob_id = hex::encode(hasher.finalize());

    let nonce_prefix = BASE64.encode([1, 2, 3, 4, 5, 6, 7]);

    let req_upload = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/attachments", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header("X-Claimed-Id", &blob_id)
        .header("X-Plaintext-Size", "60000")
        .header("X-Encrypted-Size", "60016")
        .header("X-Chunk-Size", "65536")
        .header("X-Chunk-Count", "1")
        .header("X-Nonce-Prefix", &nonce_prefix)
        .header("X-Base-Counter", "0")
        .header("X-Content-Type", "image/jpeg")
        .header(header::CONTENT_TYPE, "application/octet-stream")
        .body(Body::from(blob))
        .unwrap();

    let resp_upload = app.clone().oneshot(req_upload).await.unwrap();
    assert_eq!(resp_upload.status(), StatusCode::CREATED);

    let up_bytes = axum::body::to_bytes(resp_upload.into_body(), usize::MAX)
        .await
        .unwrap();
    let up_json: Value = serde_json::from_slice(&up_bytes).unwrap();

    assert_eq!(up_json["id"], blob_id);
    assert_eq!(up_json["padded_size"], 65536);
    assert_eq!(up_json["content_type"], "image/jpeg");
    assert_eq!(up_json["uploader_id"], user_a);
}

#[tokio::test]
async fn test_02_upload_to_non_member_room_returns_404() {
    let (app, pool) = setup_test_app().await;

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

    // Register Bob (not a member)
    sqlx::query(
        "INSERT INTO server_invites (id, code, max_uses, current_uses) VALUES ('inv_1', 'INVITE123', 1, 0)",
    )
    .execute(&pool)
    .await
    .unwrap();

    let _user_b = register_user(&app, "bob", "password123", Some("INVITE123")).await;
    let (_, login_b) = login_user(&app, "bob", "password123", "client_b_123456789", None).await;
    let token_b = login_b["session_token"].as_str().unwrap();

    let blob = vec![0x42u8; 65536];
    let mut hasher = Sha256::new();
    hasher.update(&blob);
    let blob_id = hex::encode(hasher.finalize());
    let nonce_prefix = BASE64.encode([1, 2, 3, 4, 5, 6, 7]);

    let req_upload = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/attachments", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_b))
        .header("X-Claimed-Id", &blob_id)
        .header("X-Plaintext-Size", "60000")
        .header("X-Encrypted-Size", "60016")
        .header("X-Chunk-Size", "65536")
        .header("X-Chunk-Count", "1")
        .header("X-Nonce-Prefix", &nonce_prefix)
        .header("X-Base-Counter", "0")
        .header(header::CONTENT_TYPE, "application/octet-stream")
        .body(Body::from(blob))
        .unwrap();

    let resp_upload = app.clone().oneshot(req_upload).await.unwrap();
    assert_eq!(resp_upload.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn test_03_hash_mismatch_returns_400() {
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
    let fake_id = "0".repeat(64);
    let nonce_prefix = BASE64.encode([1, 2, 3, 4, 5, 6, 7]);

    let req_upload = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/attachments", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header("X-Claimed-Id", &fake_id)
        .header("X-Plaintext-Size", "60000")
        .header("X-Encrypted-Size", "60016")
        .header("X-Chunk-Size", "65536")
        .header("X-Chunk-Count", "1")
        .header("X-Nonce-Prefix", &nonce_prefix)
        .header("X-Base-Counter", "0")
        .header(header::CONTENT_TYPE, "application/octet-stream")
        .body(Body::from(blob))
        .unwrap();

    let resp_upload = app.clone().oneshot(req_upload).await.unwrap();
    assert_eq!(resp_upload.status(), StatusCode::BAD_REQUEST);

    let err_bytes = axum::body::to_bytes(resp_upload.into_body(), usize::MAX)
        .await
        .unwrap();
    let err_json: Value = serde_json::from_slice(&err_bytes).unwrap();
    assert_eq!(err_json["error"], "hash_mismatch");
}

#[tokio::test]
async fn test_04_invalid_bucket_size_returns_413() {
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

    // 100 KB blob (not in default bucket sizes)
    let blob = vec![0x42u8; 100_000];
    let mut hasher = Sha256::new();
    hasher.update(&blob);
    let blob_id = hex::encode(hasher.finalize());
    let nonce_prefix = BASE64.encode([1, 2, 3, 4, 5, 6, 7]);

    let req_upload = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/attachments", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header("X-Claimed-Id", &blob_id)
        .header("X-Plaintext-Size", "60000")
        .header("X-Encrypted-Size", "60016")
        .header("X-Chunk-Size", "65536")
        .header("X-Chunk-Count", "1")
        .header("X-Nonce-Prefix", &nonce_prefix)
        .header("X-Base-Counter", "0")
        .header(header::CONTENT_TYPE, "application/octet-stream")
        .body(Body::from(blob))
        .unwrap();

    let resp_upload = app.clone().oneshot(req_upload).await.unwrap();
    assert_eq!(resp_upload.status(), StatusCode::PAYLOAD_TOO_LARGE);

    let err_bytes = axum::body::to_bytes(resp_upload.into_body(), usize::MAX)
        .await
        .unwrap();
    let err_json: Value = serde_json::from_slice(&err_bytes).unwrap();
    assert_eq!(err_json["error"], "invalid_bucket_size");
}

#[tokio::test]
async fn test_05_idempotent_reupload_returns_same_id() {
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
    let mut hasher = Sha256::new();
    hasher.update(&blob);
    let blob_id = hex::encode(hasher.finalize());
    let nonce_prefix = BASE64.encode([1, 2, 3, 4, 5, 6, 7]);

    for _ in 0..2 {
        let req_upload = Request::builder()
            .method("POST")
            .uri(format!("/api/v1/rooms/{}/attachments", room_id))
            .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
            .header("X-Claimed-Id", &blob_id)
            .header("X-Plaintext-Size", "60000")
            .header("X-Encrypted-Size", "60016")
            .header("X-Chunk-Size", "65536")
            .header("X-Chunk-Count", "1")
            .header("X-Nonce-Prefix", &nonce_prefix)
            .header("X-Base-Counter", "0")
            .header(header::CONTENT_TYPE, "application/octet-stream")
            .body(Body::from(blob.clone()))
            .unwrap();

        let resp_upload = app.clone().oneshot(req_upload).await.unwrap();
        assert_eq!(resp_upload.status(), StatusCode::CREATED);
        let up_bytes = axum::body::to_bytes(resp_upload.into_body(), usize::MAX)
            .await
            .unwrap();
        let up_json: Value = serde_json::from_slice(&up_bytes).unwrap();
        assert_eq!(up_json["id"], blob_id);
    }
}

#[tokio::test]
async fn test_06_download_and_headers() {
    let (app, pool) = setup_test_app().await;

    let _user_a = register_user(&app, "alice", "password123", None).await;
    let (_, login_a) = login_user(&app, "alice", "password123", "client_a_123456789", None).await;
    let token_a = login_a["session_token"].as_str().unwrap();

    // Create invite for Bob
    sqlx::query(
        "INSERT INTO server_invites (id, code, max_uses, current_uses) VALUES ('inv_1', 'INVITE123', 1, 0)",
    )
    .execute(&pool)
    .await
    .unwrap();

    let user_b = register_user(&app, "bob", "password123", Some("INVITE123")).await;
    let (_, login_b) = login_user(&app, "bob", "password123", "client_b_123456789", None).await;
    let token_b = login_b["session_token"].as_str().unwrap();

    // Create room & add Bob
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

    let req_add = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/members", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(format!("{{\"user_id\":\"{}\"}}", user_b)))
        .unwrap();

    let resp_add = app.clone().oneshot(req_add).await.unwrap();
    assert_eq!(resp_add.status(), StatusCode::CREATED);

    // Upload
    let blob = vec![0x55u8; 65536];
    let mut hasher = Sha256::new();
    hasher.update(&blob);
    let blob_id = hex::encode(hasher.finalize());
    let nonce_prefix = BASE64.encode([1, 2, 3, 4, 5, 6, 7]);

    let req_upload = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/attachments", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header("X-Claimed-Id", &blob_id)
        .header("X-Plaintext-Size", "60000")
        .header("X-Encrypted-Size", "60016")
        .header("X-Chunk-Size", "65536")
        .header("X-Chunk-Count", "1")
        .header("X-Nonce-Prefix", &nonce_prefix)
        .header("X-Base-Counter", "0")
        .header("X-Content-Type", "image/png")
        .header(header::CONTENT_TYPE, "application/octet-stream")
        .body(Body::from(blob.clone()))
        .unwrap();

    let resp_upload = app.clone().oneshot(req_upload).await.unwrap();
    assert_eq!(resp_upload.status(), StatusCode::CREATED);

    // Download by Bob
    let req_dl = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/attachments/{}", blob_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_b))
        .body(Body::empty())
        .unwrap();

    let resp_dl = app.clone().oneshot(req_dl).await.unwrap();
    assert_eq!(resp_dl.status(), StatusCode::OK);

    assert_eq!(
        resp_dl.headers().get(header::CONTENT_TYPE).unwrap(),
        "application/octet-stream"
    );
    assert_eq!(
        resp_dl.headers().get(header::ETAG).unwrap(),
        &format!("\"{}\"", blob_id)
    );
    assert_eq!(
        resp_dl.headers().get("X-Attachment-Content-Type").unwrap(),
        "image/png"
    );

    let dl_bytes = axum::body::to_bytes(resp_dl.into_body(), usize::MAX)
        .await
        .unwrap();
    assert_eq!(dl_bytes.as_ref(), blob.as_slice());

    // ETag 304 test
    let req_304 = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/attachments/{}", blob_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_b))
        .header(header::IF_NONE_MATCH, format!("\"{}\"", blob_id))
        .body(Body::empty())
        .unwrap();

    let resp_304 = app.clone().oneshot(req_304).await.unwrap();
    assert_eq!(resp_304.status(), StatusCode::NOT_MODIFIED);

    // Range test returns 416
    let req_range = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/attachments/{}", blob_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_b))
        .header(header::RANGE, "bytes=0-1023")
        .body(Body::empty())
        .unwrap();

    let resp_range = app.clone().oneshot(req_range).await.unwrap();
    assert_eq!(resp_range.status(), StatusCode::RANGE_NOT_SATISFIABLE);
}

#[tokio::test]
async fn test_07_delete_attachment_permissions() {
    let (app, pool) = setup_test_app().await;

    let _user_a = register_user(&app, "alice", "password123", None).await;
    let (_, login_a) = login_user(&app, "alice", "password123", "client_a_123456789", None).await;
    let token_a = login_a["session_token"].as_str().unwrap();

    sqlx::query(
        "INSERT INTO server_invites (id, code, max_uses, current_uses) VALUES ('inv_1', 'INVITE123', 1, 0)",
    )
    .execute(&pool)
    .await
    .unwrap();

    let user_b = register_user(&app, "bob", "password123", Some("INVITE123")).await;
    let (_, login_b) = login_user(&app, "bob", "password123", "client_b_123456789", None).await;
    let token_b = login_b["session_token"].as_str().unwrap();

    // Create room & add Bob
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

    let req_add = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/members", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(format!("{{\"user_id\":\"{}\"}}", user_b)))
        .unwrap();

    let _ = app.clone().oneshot(req_add).await.unwrap();

    // Upload by Alice
    let blob = vec![0x77u8; 65536];
    let mut hasher = Sha256::new();
    hasher.update(&blob);
    let blob_id = hex::encode(hasher.finalize());
    let nonce_prefix = BASE64.encode([1, 2, 3, 4, 5, 6, 7]);

    let req_upload = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/attachments", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header("X-Claimed-Id", &blob_id)
        .header("X-Plaintext-Size", "60000")
        .header("X-Encrypted-Size", "60016")
        .header("X-Chunk-Size", "65536")
        .header("X-Chunk-Count", "1")
        .header("X-Nonce-Prefix", &nonce_prefix)
        .header("X-Base-Counter", "0")
        .header(header::CONTENT_TYPE, "application/octet-stream")
        .body(Body::from(blob))
        .unwrap();

    let _ = app.clone().oneshot(req_upload).await.unwrap();

    // Bob tries to delete Alice's attachment -> 403
    let req_del_b = Request::builder()
        .method("DELETE")
        .uri(format!("/api/v1/attachments/{}", blob_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_b))
        .body(Body::empty())
        .unwrap();

    let resp_del_b = app.clone().oneshot(req_del_b).await.unwrap();
    assert_eq!(resp_del_b.status(), StatusCode::FORBIDDEN);

    // Alice deletes -> 204
    let req_del_a = Request::builder()
        .method("DELETE")
        .uri(format!("/api/v1/attachments/{}", blob_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();

    let resp_del_a = app.clone().oneshot(req_del_a).await.unwrap();
    assert_eq!(resp_del_a.status(), StatusCode::NO_CONTENT);

    // Download now returns 404
    let req_dl_404 = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/attachments/{}", blob_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();

    let resp_dl_404 = app.clone().oneshot(req_dl_404).await.unwrap();
    assert_eq!(resp_dl_404.status(), StatusCode::NOT_FOUND);
}
