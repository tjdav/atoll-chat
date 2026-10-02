use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use sha2::{Digest, Sha256};
use tower::ServiceExt;

mod common;
use common::{login_user, register_user, setup_test_app};

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
    let mock_server = wiremock::MockServer::start().await;
    wiremock::Mock::given(wiremock::matchers::method("POST"))
        .respond_with(wiremock::ResponseTemplate::new(200))
        .mount(&mock_server)
        .await;

    let (app, pool) = setup_test_app().await;

    let user_id = register_user(&app, "user1", "Password123!", None).await;
    let (_, login) = login_user(&app, "user1", "Password123!", "client_123456789", None).await;
    let token = login["session_token"].as_str().unwrap();

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

    // Verify no Sockudo calls were made
    assert_eq!(mock_server.received_requests().await.unwrap().len(), 0);

    // Verify no audit log entries were created for avatar upload
    let audit_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM audit_log WHERE action = 'avatar.upload' OR action = 'attachment.upload'")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(audit_count, 0);
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
