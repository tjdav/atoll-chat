use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use axum::Router;
use sha2::{Digest, Sha256};
use sqlx::SqlitePool;
use tower::ServiceExt;
use wiremock::{
    matchers::{method, path},
    Mock, MockServer, ResponseTemplate,
};

mod common;
use common::{login_user, obtain_username_token, register_user, setup_test_app};

async fn setup_test_app_with_sockudo_mock() -> (Router, SqlitePool, MockServer) {
    let mock_server = MockServer::start().await;

    Mock::given(method("POST"))
        .and(path("/apps/chat/events"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({"ok": true})))
        .mount(&mock_server)
        .await;

    let (app, pool, _) = common::setup_test_app_with_custom_config(|cfg| {
        cfg.sockudo_url = mock_server.uri();
    })
    .await;

    (app, pool, mock_server)
}

fn create_multipart_body(
    boundary: &str,
    file_bytes: &[u8],
    claimed_id: &str,
    content_type: &str,
    extra_file_part: bool,
) -> Vec<u8> {
    let mut body = Vec::new();

    // Field: file
    body.extend_from_slice(format!("--{}\r\n", boundary).as_bytes());
    body.extend_from_slice(
        b"Content-Disposition: form-data; name=\"file\"; filename=\"avatar.png\"\r\n",
    );
    body.extend_from_slice(b"Content-Type: application/octet-stream\r\n\r\n");
    body.extend_from_slice(file_bytes);
    body.extend_from_slice(b"\r\n");

    if extra_file_part {
        body.extend_from_slice(format!("--{}\r\n", boundary).as_bytes());
        body.extend_from_slice(
            b"Content-Disposition: form-data; name=\"file\"; filename=\"avatar2.png\"\r\n",
        );
        body.extend_from_slice(b"Content-Type: application/octet-stream\r\n\r\n");
        body.extend_from_slice(file_bytes);
        body.extend_from_slice(b"\r\n");
    }

    // Field: claimed_id
    body.extend_from_slice(format!("--{}\r\n", boundary).as_bytes());
    body.extend_from_slice(b"Content-Disposition: form-data; name=\"claimed_id\"\r\n\r\n");
    body.extend_from_slice(claimed_id.as_bytes());
    body.extend_from_slice(b"\r\n");

    // Field: plaintext_size
    body.extend_from_slice(format!("--{}\r\n", boundary).as_bytes());
    body.extend_from_slice(b"Content-Disposition: form-data; name=\"plaintext_size\"\r\n\r\n");
    body.extend_from_slice(file_bytes.len().to_string().as_bytes());
    body.extend_from_slice(b"\r\n");

    // Field: encrypted_size
    body.extend_from_slice(format!("--{}\r\n", boundary).as_bytes());
    body.extend_from_slice(b"Content-Disposition: form-data; name=\"encrypted_size\"\r\n\r\n");
    body.extend_from_slice(file_bytes.len().to_string().as_bytes());
    body.extend_from_slice(b"\r\n");

    // Field: chunk_size
    body.extend_from_slice(format!("--{}\r\n", boundary).as_bytes());
    body.extend_from_slice(b"Content-Disposition: form-data; name=\"chunk_size\"\r\n\r\n");
    body.extend_from_slice(b"16384\r\n");

    // Field: chunk_count
    body.extend_from_slice(format!("--{}\r\n", boundary).as_bytes());
    body.extend_from_slice(b"Content-Disposition: form-data; name=\"chunk_count\"\r\n\r\n");
    body.extend_from_slice(b"4\r\n");

    // Field: nonce_prefix
    body.extend_from_slice(format!("--{}\r\n", boundary).as_bytes());
    body.extend_from_slice(b"Content-Disposition: form-data; name=\"nonce_prefix\"\r\n\r\n");
    body.extend_from_slice(b"AQIDBAUGBw==\r\n");

    // Field: base_counter
    body.extend_from_slice(format!("--{}\r\n", boundary).as_bytes());
    body.extend_from_slice(b"Content-Disposition: form-data; name=\"base_counter\"\r\n\r\n");
    body.extend_from_slice(b"0\r\n");

    // Field: content_type
    body.extend_from_slice(format!("--{}\r\n", boundary).as_bytes());
    body.extend_from_slice(b"Content-Disposition: form-data; name=\"content_type\"\r\n\r\n");
    body.extend_from_slice(content_type.as_bytes());
    body.extend_from_slice(b"\r\n");

    body.extend_from_slice(format!("--{}--\r\n", boundary).as_bytes());
    body
}

#[tokio::test]
async fn test_user_avatar_upload_happy_path() {
    let (app, pool, mock_server) = setup_test_app_with_sockudo_mock().await;

    let user_id = register_user(&app, "user1", "Password123!", None).await;
    let (_, login) = login_user(&app, "user1", "Password123!", "client_123456789", None).await;
    let token = login["session_token"].as_str().unwrap();

    let initial_sockudo_reqs = mock_server.received_requests().await.unwrap().len();

    let blob_bytes = vec![0x42u8; 65536]; // 65536 bytes (exact bucket size)
    let mut hasher = Sha256::new();
    hasher.update(&blob_bytes);
    let claimed_id = hex::encode(hasher.finalize());

    let boundary = "------------------------boundary123";
    let body_bytes = create_multipart_body(boundary, &blob_bytes, &claimed_id, "image/png", false);

    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/users/me/avatar")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(
            header::CONTENT_TYPE,
            format!("multipart/form-data; boundary={}", boundary),
        )
        .body(Body::from(body_bytes))
        .unwrap();

    let res = app.clone().oneshot(req).await.unwrap();
    let status = res.status();
    let cache_control = res.headers().get(header::CACHE_CONTROL).cloned();
    let res_body = axum::body::to_bytes(res.into_body(), usize::MAX)
        .await
        .unwrap();
    if status != StatusCode::CREATED {
        panic!(
            "Upload failed with status {}: {}",
            status,
            String::from_utf8_lossy(&res_body)
        );
    }
    assert_eq!(cache_control.unwrap(), "no-store");
    let view: server::attachments::AttachmentView = serde_json::from_slice(&res_body).unwrap();
    assert_eq!(view.id, claimed_id);
    assert!(view.room_id.is_none());
    assert_eq!(view.uploader_id, user_id);

    // Verify retrievable via GET /api/v1/attachments/{id}
    let get_req = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/attachments/{}", claimed_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .body(Body::empty())
        .unwrap();

    let get_res = app.clone().oneshot(get_req).await.unwrap();
    assert_eq!(get_res.status(), StatusCode::OK);
    let downloaded_bytes = axum::body::to_bytes(get_res.into_body(), usize::MAX)
        .await
        .unwrap();
    assert_eq!(downloaded_bytes.as_ref(), blob_bytes.as_slice());

    // Assert database state directly
    let db_row: (Option<String>, String) =
        sqlx::query_as("SELECT room_id, uploader_id FROM attachments WHERE id = ?")
            .bind(&claimed_id)
            .fetch_one(&pool)
            .await
            .unwrap();

    assert!(db_row.0.is_none());
    assert_eq!(db_row.1, user_id);

    // Verify zero new Sockudo event calls were made during/after avatar upload
    let final_sockudo_reqs = mock_server.received_requests().await.unwrap().len();
    assert_eq!(final_sockudo_reqs, initial_sockudo_reqs);

    // Verify no audit log entries were created for avatar upload
    let audit_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM audit_log WHERE action = 'avatar.upload' OR action = 'attachment.upload'")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(audit_count, 0);
}

#[tokio::test]
async fn test_user_avatar_upload_opaque_payload() {
    let (app, pool) = setup_test_app().await;

    let user_id = register_user(&app, "user1", "Password123!", None).await;
    let (_, login) = login_user(&app, "user1", "Password123!", "client_123456789", None).await;
    let token = login["session_token"].as_str().unwrap();

    // Arbitrary bytes that are neither valid C2SP ciphertext nor a valid image format
    // Must match a valid bucket size (e.g., 65,536 bytes)
    let blob_bytes = [0xDE, 0xAD, 0xBE, 0xEF].repeat(16384); // 65,536 bytes
    let mut hasher = Sha256::new();
    hasher.update(&blob_bytes);
    let claimed_id = hex::encode(hasher.finalize());

    let boundary = "------------------------boundary123";
    let body_bytes = create_multipart_body(
        boundary,
        &blob_bytes,
        &claimed_id,
        "application/octet-stream",
        false,
    );

    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/users/me/avatar")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(
            header::CONTENT_TYPE,
            format!("multipart/form-data; boundary={}", boundary),
        )
        .body(Body::from(body_bytes))
        .unwrap();

    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::CREATED);
    let res_body = axum::body::to_bytes(res.into_body(), usize::MAX)
        .await
        .unwrap();
    let view: server::attachments::AttachmentView = serde_json::from_slice(&res_body).unwrap();
    assert_eq!(view.id, claimed_id);
    assert!(view.room_id.is_none());
    assert_eq!(view.uploader_id, user_id);

    // Assert database row matches request
    let db_row: (Option<String>, String) =
        sqlx::query_as("SELECT room_id, uploader_id FROM attachments WHERE id = ?")
            .bind(&claimed_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(db_row.0.is_none());
    assert_eq!(db_row.1, user_id);
}

#[tokio::test]
async fn test_user_avatar_upload_profile_version_non_mutation() {
    let (app, pool, mock_server) = setup_test_app_with_sockudo_mock().await;

    let user_id = register_user(&app, "user1", "Password123!", None).await;
    let (_, login) = login_user(&app, "user1", "Password123!", "client_123456789", None).await;
    let token = login["session_token"].as_str().unwrap();

    let initial_sockudo_reqs = mock_server.received_requests().await.unwrap().len();

    // Read initial users.profile and users.profile_version before upload
    let (initial_profile, initial_profile_version): (Option<String>, i64) =
        sqlx::query_as("SELECT profile, profile_version FROM users WHERE id = ?")
            .bind(&user_id)
            .fetch_one(&pool)
            .await
            .unwrap();

    let blob_bytes = vec![0x55u8; 65536]; // Exact bucket size
    let mut hasher = Sha256::new();
    hasher.update(&blob_bytes);
    let claimed_id = hex::encode(hasher.finalize());

    let boundary = "------------------------boundary123";
    let body_bytes = create_multipart_body(boundary, &blob_bytes, &claimed_id, "image/png", false);

    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/users/me/avatar")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(
            header::CONTENT_TYPE,
            format!("multipart/form-data; boundary={}", boundary),
        )
        .body(Body::from(body_bytes))
        .unwrap();

    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::CREATED);

    // Read users.profile and users.profile_version after upload
    let (after_profile, after_profile_version): (Option<String>, i64) =
        sqlx::query_as("SELECT profile, profile_version FROM users WHERE id = ?")
            .bind(&user_id)
            .fetch_one(&pool)
            .await
            .unwrap();

    assert_eq!(after_profile, initial_profile);
    assert_eq!(after_profile_version, initial_profile_version);

    // Assert zero new user.updated or any other Sockudo events were published
    let final_sockudo_reqs = mock_server.received_requests().await.unwrap().len();
    assert_eq!(final_sockudo_reqs, initial_sockudo_reqs);
}

#[tokio::test]
async fn test_user_avatar_upload_cross_user_visibility() {
    let (app, pool) = setup_test_app().await;

    let user_a_id = register_user(&app, "usera", "Password123!", None).await;
    let (_, login_a) = login_user(&app, "usera", "Password123!", "client_a_123456789", None).await;
    let token_a = login_a["session_token"].as_str().unwrap();

    sqlx::query(
        "INSERT INTO server_invites (id, code, max_uses, current_uses) VALUES ('inv_1', 'INVITE123', 1, 0)",
    )
    .execute(&pool)
    .await
    .unwrap();

    let user_b_id = register_user(&app, "userb", "Password123!", Some("INVITE123")).await;
    let (_, login_b) = login_user(&app, "userb", "Password123!", "client_b_123456789", None).await;
    let token_b = login_b["session_token"].as_str().unwrap();

    // User A uploads avatar
    let blob_bytes = vec![0x77u8; 65536]; // Exact bucket size
    let mut hasher = Sha256::new();
    hasher.update(&blob_bytes);
    let avatar_id = hex::encode(hasher.finalize());

    let boundary = "------------------------boundary123";
    let body_bytes = create_multipart_body(boundary, &blob_bytes, &avatar_id, "image/png", false);

    let req_avatar = Request::builder()
        .method("POST")
        .uri("/api/v1/users/me/avatar")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(
            header::CONTENT_TYPE,
            format!("multipart/form-data; boundary={}", boundary),
        )
        .body(Body::from(body_bytes))
        .unwrap();

    let res_avatar = app.clone().oneshot(req_avatar).await.unwrap();
    assert_eq!(res_avatar.status(), StatusCode::CREATED);

    // 1. User B performs lookup on User A
    let token_a_lookup = obtain_username_token(&app, "usera").await;
    let req_lookup = Request::builder()
        .method("POST")
        .uri("/api/v1/users/lookup")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_b))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            serde_json::json!({ "username_token": token_a_lookup }).to_string(),
        ))
        .unwrap();

    let res_lookup = app.clone().oneshot(req_lookup).await.unwrap();
    assert_eq!(res_lookup.status(), StatusCode::OK);
    let lookup_body_bytes = axum::body::to_bytes(res_lookup.into_body(), usize::MAX)
        .await
        .unwrap();
    let lookup_str = String::from_utf8_lossy(&lookup_body_bytes);
    assert!(!lookup_str.contains(&avatar_id));

    let lookup_json: serde_json::Value = serde_json::from_slice(&lookup_body_bytes).unwrap();
    assert_eq!(lookup_json["user_id"], user_a_id);
    assert!(lookup_json.get("avatar_file_id").is_none());
    assert!(lookup_json.get("avatar_attachment_id").is_none());

    // 2. User A creates a room and invites User B (or User B joins)
    let req_create_room = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from("{}"))
        .unwrap();

    let res_create_room = app.clone().oneshot(req_create_room).await.unwrap();
    assert_eq!(res_create_room.status(), StatusCode::CREATED);
    let room_body_bytes = axum::body::to_bytes(res_create_room.into_body(), usize::MAX)
        .await
        .unwrap();
    let room_json: serde_json::Value = serde_json::from_slice(&room_body_bytes).unwrap();
    let room_id = room_json["id"].as_str().unwrap();

    // Add User B to the room
    sqlx::query("INSERT INTO room_members (room_id, user_id, role, joined_at) VALUES (?, ?, 'member', 1000)")
        .bind(room_id)
        .bind(&user_b_id)
        .execute(&pool)
        .await
        .unwrap();

    // User B fetches room members list
    let req_members = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/rooms/{}/members", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_b))
        .body(Body::empty())
        .unwrap();

    let res_members = app.clone().oneshot(req_members).await.unwrap();
    assert_eq!(res_members.status(), StatusCode::OK);
    let members_body_bytes = axum::body::to_bytes(res_members.into_body(), usize::MAX)
        .await
        .unwrap();
    let members_str = String::from_utf8_lossy(&members_body_bytes);
    assert!(!members_str.contains(&avatar_id));

    let members_json: serde_json::Value = serde_json::from_slice(&members_body_bytes).unwrap();
    let members_arr = members_json["members"].as_array().unwrap();
    assert_eq!(members_arr.len(), 2);
    for m in members_arr {
        assert_eq!(m["type"], "user");
        assert!(m.get("avatar_file_id").is_none());
        assert!(m.get("avatar_attachment_id").is_none());
    }

    // 3. User B calls GET /users/me
    let req_me = Request::builder()
        .method("GET")
        .uri("/api/v1/users/me")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_b))
        .body(Body::empty())
        .unwrap();

    let res_me = app.clone().oneshot(req_me).await.unwrap();
    assert_eq!(res_me.status(), StatusCode::OK);
    let me_body_bytes = axum::body::to_bytes(res_me.into_body(), usize::MAX)
        .await
        .unwrap();
    let me_str = String::from_utf8_lossy(&me_body_bytes);
    assert!(!me_str.contains(&avatar_id));
}

#[tokio::test]
async fn test_user_avatar_upload_s3_backend() {
    let mock_s3 = MockServer::start().await;
    Mock::given(method("PUT"))
        .respond_with(ResponseTemplate::new(200))
        .mount(&mock_s3)
        .await;

    let (app, pool, _) = common::setup_test_app_with_custom_config(|cfg| {
        cfg.storage_backend = "s3".to_string();
        cfg.s3_endpoint = Some(mock_s3.uri());
        cfg.s3_region = "us-east-1".to_string();
        cfg.s3_bucket = Some("test-bucket".to_string());
        cfg.s3_access_key_id = Some("minioadmin".to_string());
        cfg.s3_secret_access_key = Some("minioadmin".to_string());
        cfg.s3_path_style = true;
    })
    .await;

    let user_id = register_user(&app, "user1", "Password123!", None).await;
    let (_, login) = login_user(&app, "user1", "Password123!", "client_123456789", None).await;
    let token = login["session_token"].as_str().unwrap();

    let blob_bytes = vec![0x33u8; 65536];
    let mut hasher = Sha256::new();
    hasher.update(&blob_bytes);
    let claimed_id = hex::encode(hasher.finalize());

    let boundary = "------------------------boundary123";
    let body_bytes = create_multipart_body(boundary, &blob_bytes, &claimed_id, "image/png", false);

    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/users/me/avatar")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(
            header::CONTENT_TYPE,
            format!("multipart/form-data; boundary={}", boundary),
        )
        .body(Body::from(body_bytes))
        .unwrap();

    let res = app.oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::CREATED);
    let res_body = axum::body::to_bytes(res.into_body(), usize::MAX)
        .await
        .unwrap();
    let view: server::attachments::AttachmentView = serde_json::from_slice(&res_body).unwrap();
    assert_eq!(view.id, claimed_id);
    assert_eq!(view.storage_backend, "s3");

    // Assert S3 mock received a PUT request for the expected storage key
    let s3_reqs = mock_s3.received_requests().await.unwrap();
    assert!(!s3_reqs.is_empty());
    assert_eq!(s3_reqs[0].method, "PUT");
    assert!(s3_reqs[0].url.path().contains(&claimed_id));

    // Assert database row is written with storage_backend = 's3'
    let db_row: (String, String) =
        sqlx::query_as("SELECT storage_backend, uploader_id FROM attachments WHERE id = ?")
            .bind(&claimed_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(db_row.0, "s3");
    assert_eq!(db_row.1, user_id);
}

#[tokio::test]
async fn test_user_avatar_upload_size_limit() {
    let (app, pool) = setup_test_app().await;

    let user_id = register_user(&app, "user1", "Password123!", None).await;
    let (_, login) = login_user(&app, "user1", "Password123!", "client_123456789", None).await;
    let token = login["session_token"].as_str().unwrap();

    // Set user max_file_size_bytes to 512 bytes
    sqlx::query("UPDATE users SET max_file_size_bytes = 512 WHERE id = ?")
        .bind(&user_id)
        .execute(&pool)
        .await
        .unwrap();

    let blob_bytes = vec![0x42u8; 65536]; // 65536 > 512
    let mut hasher = Sha256::new();
    hasher.update(&blob_bytes);
    let claimed_id = hex::encode(hasher.finalize());

    let boundary = "------------------------boundary123";
    let body_bytes = create_multipart_body(boundary, &blob_bytes, &claimed_id, "image/png", false);

    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/users/me/avatar")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(
            header::CONTENT_TYPE,
            format!("multipart/form-data; boundary={}", boundary),
        )
        .body(Body::from(body_bytes))
        .unwrap();

    let res = app.oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::PAYLOAD_TOO_LARGE);
    let res_body = axum::body::to_bytes(res.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: serde_json::Value = serde_json::from_slice(&res_body).unwrap();
    assert_eq!(json["error"], "file_too_large");
}

#[tokio::test]
async fn test_user_avatar_upload_unauthenticated() {
    let (app, _pool) = setup_test_app().await;

    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/users/me/avatar")
        .header(header::CONTENT_TYPE, "multipart/form-data; boundary=xyz")
        .body(Body::empty())
        .unwrap();

    let res = app.oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn test_user_avatar_upload_wrong_content_type() {
    let (app, _pool) = setup_test_app().await;

    register_user(&app, "user1", "Password123!", None).await;
    let (_, login) = login_user(&app, "user1", "Password123!", "client_123456789", None).await;
    let token = login["session_token"].as_str().unwrap();

    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/users/me/avatar")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from("{}"))
        .unwrap();

    let res = app.oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::UNSUPPORTED_MEDIA_TYPE);
}

#[tokio::test]
async fn test_user_avatar_upload_multiple_file_parts() {
    let (app, _pool) = setup_test_app().await;

    register_user(&app, "user1", "Password123!", None).await;
    let (_, login) = login_user(&app, "user1", "Password123!", "client_123456789", None).await;
    let token = login["session_token"].as_str().unwrap();

    let blob_bytes = vec![0x42u8; 65536];
    let mut hasher = Sha256::new();
    hasher.update(&blob_bytes);
    let claimed_id = hex::encode(hasher.finalize());

    let boundary = "------------------------boundary123";
    let body_bytes = create_multipart_body(boundary, &blob_bytes, &claimed_id, "image/png", true);

    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/users/me/avatar")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(
            header::CONTENT_TYPE,
            format!("multipart/form-data; boundary={}", boundary),
        )
        .body(Body::from(body_bytes))
        .unwrap();

    let res = app.oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);
    let res_body = axum::body::to_bytes(res.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: serde_json::Value = serde_json::from_slice(&res_body).unwrap();
    assert_eq!(json["error"], "invalid_request");
}

#[tokio::test]
async fn test_user_avatar_upload_coexistence_with_room_attachment() {
    let (app, pool) = setup_test_app().await;

    register_user(&app, "user1", "Password123!", None).await;
    let (_, login) = login_user(&app, "user1", "Password123!", "client_123456789", None).await;
    let token = login["session_token"].as_str().unwrap();

    // 1. Create a room
    let create_room_req = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from("{}"))
        .unwrap();

    let create_room_res = app.clone().oneshot(create_room_req).await.unwrap();
    assert_eq!(create_room_res.status(), StatusCode::CREATED);
    let room_body = axum::body::to_bytes(create_room_res.into_body(), usize::MAX)
        .await
        .unwrap();
    let room_json: serde_json::Value = serde_json::from_slice(&room_body).unwrap();
    let room_id = room_json["id"].as_str().unwrap();

    // 2. Upload room attachment
    let room_blob = vec![0x11u8; 65536];
    let mut hasher = Sha256::new();
    hasher.update(&room_blob);
    let room_claimed_id = hex::encode(hasher.finalize());

    let boundary = "------------------------boundary123";
    let room_body_bytes =
        create_multipart_body(boundary, &room_blob, &room_claimed_id, "image/png", false);

    let room_att_req = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/attachments", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(
            header::CONTENT_TYPE,
            format!("multipart/form-data; boundary={}", boundary),
        )
        .body(Body::from(room_body_bytes))
        .unwrap();

    let room_att_res = app.clone().oneshot(room_att_req).await.unwrap();
    assert_eq!(room_att_res.status(), StatusCode::CREATED);

    // 3. Upload user avatar
    let avatar_blob = vec![0x22u8; 65536];
    let mut hasher = Sha256::new();
    hasher.update(&avatar_blob);
    let avatar_claimed_id = hex::encode(hasher.finalize());

    let avatar_body_bytes = create_multipart_body(
        boundary,
        &avatar_blob,
        &avatar_claimed_id,
        "image/png",
        false,
    );

    let avatar_att_req = Request::builder()
        .method("POST")
        .uri("/api/v1/users/me/avatar")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(
            header::CONTENT_TYPE,
            format!("multipart/form-data; boundary={}", boundary),
        )
        .body(Body::from(avatar_body_bytes))
        .unwrap();

    let avatar_att_res = app.clone().oneshot(avatar_att_req).await.unwrap();
    assert_eq!(avatar_att_res.status(), StatusCode::CREATED);

    // 4. Verify both exist in DB with expected room_id values
    let room_att_row: (Option<String>,) =
        sqlx::query_as("SELECT room_id FROM attachments WHERE id = ?")
            .bind(&room_claimed_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(room_att_row.0.as_deref(), Some(room_id));

    let avatar_att_row: (Option<String>,) =
        sqlx::query_as("SELECT room_id FROM attachments WHERE id = ?")
            .bind(&avatar_claimed_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(avatar_att_row.0.is_none());
}
