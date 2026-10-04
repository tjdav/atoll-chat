mod common;

use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use axum::Router;
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use flate2::write::GzEncoder;
use flate2::Compression;
use serde_json::Value;
use std::io::Write;
use tower::ServiceExt;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};
use x25519_dalek::{PublicKey, StaticSecret};

use server::link_preview::content_key::{
    decode_base64_flexible, decrypt_payload, encrypt_payload, ErrorPlaintext, RequestEnvelope,
    RequestPlaintext, ResponseEnvelope, ResponsePlaintext,
};

async fn login_and_get_token(app: &Router, username: &str, password: &str) -> String {
    let (status, res_json) =
        common::login_user(app, username, password, "client_123456789", None).await;
    assert_eq!(status, StatusCode::OK, "Login failed: {:?}", res_json);
    res_json["session_token"].as_str().unwrap().to_string()
}

#[tokio::test]
async fn test_link_preview_disabled_by_default() {
    let (app, pool) = common::setup_test_app().await;

    // 1. Check capabilities
    let req = Request::builder()
        .uri("/api/v1/capabilities")
        .body(Body::empty())
        .unwrap();

    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let body_bytes = axum::body::to_bytes(res.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_val: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(json_val["link_preview_proxy_enabled"], false);
    assert!(json_val["extension_proxy_key"].is_null());

    // 2. Register user & login -> attempt request -> 501
    common::register_user(&app, "disabled_user", "Password123!", None).await;
    let token = login_and_get_token(&app, "disabled_user", "Password123!").await;

    let audit_count_before: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM audit_log")
        .fetch_one(&pool)
        .await
        .unwrap();

    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/link-preview/proxy")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/octet-stream")
        .body(Body::from("{}"))
        .unwrap();

    let res = app.oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::NOT_IMPLEMENTED);
    let body_bytes = axum::body::to_bytes(res.into_body(), usize::MAX)
        .await
        .unwrap();
    let resp_json: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(resp_json["error"], "proxy_disabled");

    let audit_count_after: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM audit_log")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(audit_count_after, audit_count_before);
}

#[tokio::test]
async fn test_capabilities_enabled() {
    let (app, _pool, _altcha) = common::setup_test_app_with_custom_config(|c| {
        c.link_preview_proxy_enabled = true;
    })
    .await;

    let req = Request::builder()
        .uri("/api/v1/capabilities")
        .body(Body::empty())
        .unwrap();

    let res = app.oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let body_bytes = axum::body::to_bytes(res.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_val: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(json_val["link_preview_proxy_enabled"], true);
    assert!(json_val["extension_proxy_key"].is_string());
    let pubkey_str = json_val["extension_proxy_key"].as_str().unwrap();
    let pubkey_bytes = decode_base64_flexible(pubkey_str).unwrap();
    assert_eq!(pubkey_bytes.len(), 32);
}

#[tokio::test]
async fn test_unauthenticated_request() {
    let (app, _pool, _altcha) = common::setup_test_app_with_custom_config(|c| {
        c.link_preview_proxy_enabled = true;
    })
    .await;

    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/link-preview/proxy")
        .header(header::CONTENT_TYPE, "application/octet-stream")
        .body(Body::from("{}"))
        .unwrap();

    let res = app.oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn test_roundtrip_fetch_success() {
    let mock_server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/test.html"))
        .respond_with(ResponseTemplate::new(200).set_body_raw(
            "<html><head><title>Test Page</title></head></html>",
            "text/html",
        ))
        .mount(&mock_server)
        .await;

    let (app, pool, _altcha) = common::setup_test_app_with_custom_config(|c| {
        c.link_preview_proxy_enabled = true;
    })
    .await;

    // Read server public key from capabilities
    let req = Request::builder()
        .uri("/api/v1/capabilities")
        .body(Body::empty())
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    let body_bytes = axum::body::to_bytes(res.into_body(), usize::MAX)
        .await
        .unwrap();
    let cap_json: Value = serde_json::from_slice(&body_bytes).unwrap();
    let server_pubkey_bytes: [u8; 32] =
        decode_base64_flexible(cap_json["extension_proxy_key"].as_str().unwrap())
            .unwrap()
            .try_into()
            .unwrap();

    common::register_user(&app, "proxy_user1", "Password123!", None).await;
    let token = login_and_get_token(&app, "proxy_user1", "Password123!").await;

    // Client key generation
    let mut client_secret_bytes = [0u8; 32];
    rand::RngCore::fill_bytes(&mut rand::thread_rng(), &mut client_secret_bytes);
    let client_secret = StaticSecret::from(client_secret_bytes);
    let client_public = PublicKey::from(&client_secret);

    // ECDH & Content Key
    let server_pubkey = PublicKey::from(server_pubkey_bytes);
    let shared_secret = client_secret.diffie_hellman(&server_pubkey);
    let hk = hkdf::Hkdf::<sha2::Sha256>::new(None, shared_secret.as_bytes());
    let mut content_key = [0u8; 32];
    hk.expand(b"link-preview-content-key-v1", &mut content_key)
        .unwrap();

    let target_url = format!("{}/test.html", mock_server.uri());
    let req_plain = RequestPlaintext {
        url: target_url,
        request_id: Some("req-12345".to_string()),
    };
    let req_plain_bytes = serde_json::to_vec(&req_plain).unwrap();

    let mut nonce_bytes = [0u8; 12];
    rand::RngCore::fill_bytes(&mut rand::thread_rng(), &mut nonce_bytes);

    let ciphertext = encrypt_payload(&content_key, &nonce_bytes, &req_plain_bytes).unwrap();

    let req_env = RequestEnvelope {
        ephemeral_pubkey: BASE64.encode(client_public.as_bytes()),
        nonce: BASE64.encode(nonce_bytes),
        ciphertext: BASE64.encode(ciphertext),
    };

    let req_body = serde_json::to_vec(&req_env).unwrap();

    let audit_count_before: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM audit_log")
        .fetch_one(&pool)
        .await
        .unwrap();

    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/link-preview/proxy")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/octet-stream")
        .header("x-link-preview-allow-local", "true")
        .body(Body::from(req_body))
        .unwrap();

    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);

    let body_bytes = axum::body::to_bytes(res.into_body(), usize::MAX)
        .await
        .unwrap();
    let resp_env: ResponseEnvelope = serde_json::from_slice(&body_bytes).unwrap();

    let resp_nonce: [u8; 12] = decode_base64_flexible(&resp_env.nonce)
        .unwrap()
        .try_into()
        .unwrap();
    let resp_ciphertext = decode_base64_flexible(&resp_env.ciphertext).unwrap();

    let resp_plain_bytes = decrypt_payload(&content_key, &resp_nonce, &resp_ciphertext).unwrap();
    let resp_plain: ResponsePlaintext = serde_json::from_slice(&resp_plain_bytes).unwrap();

    assert_eq!(resp_plain.status, 200);
    assert!(resp_plain
        .headers
        .get("content-type")
        .unwrap()
        .contains("text/html"));
    let decoded_body = decode_base64_flexible(&resp_plain.body).unwrap();
    assert_eq!(
        String::from_utf8(decoded_body).unwrap(),
        "<html><head><title>Test Page</title></head></html>"
    );
    assert_eq!(resp_plain.request_id.as_deref(), Some("req-12345"));

    // Verify no audit log entry recorded by the link preview request
    let audit_count_after: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM audit_log")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(audit_count_after, audit_count_before);
}

#[tokio::test]
async fn test_ssrf_blocks_private_ips() {
    let (app, _pool, _altcha) = common::setup_test_app_with_custom_config(|c| {
        c.link_preview_proxy_enabled = true;
    })
    .await;

    // Read capabilities
    let req = Request::builder()
        .uri("/api/v1/capabilities")
        .body(Body::empty())
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    let body_bytes = axum::body::to_bytes(res.into_body(), usize::MAX)
        .await
        .unwrap();
    let cap_json: Value = serde_json::from_slice(&body_bytes).unwrap();
    let server_pubkey_bytes: [u8; 32] =
        decode_base64_flexible(cap_json["extension_proxy_key"].as_str().unwrap())
            .unwrap()
            .try_into()
            .unwrap();

    common::register_user(&app, "proxy_user2", "Password123!", None).await;
    let token = login_and_get_token(&app, "proxy_user2", "Password123!").await;

    let blocked_urls = [
        "https://127.0.0.1/test",
        "https://10.0.0.1/secret",
        "https://169.254.169.254/latest/meta-data/",
        "https://[::1]/internal",
    ];

    for blocked_url in blocked_urls {
        let mut client_secret_bytes = [0u8; 32];
        rand::RngCore::fill_bytes(&mut rand::thread_rng(), &mut client_secret_bytes);
        let client_secret = StaticSecret::from(client_secret_bytes);
        let client_public = PublicKey::from(&client_secret);

        let server_pubkey = PublicKey::from(server_pubkey_bytes);
        let shared_secret = client_secret.diffie_hellman(&server_pubkey);
        let hk = hkdf::Hkdf::<sha2::Sha256>::new(None, shared_secret.as_bytes());
        let mut content_key = [0u8; 32];
        hk.expand(b"link-preview-content-key-v1", &mut content_key)
            .unwrap();

        let req_plain = RequestPlaintext {
            url: blocked_url.to_string(),
            request_id: Some("req-ssrf".to_string()),
        };
        let req_plain_bytes = serde_json::to_vec(&req_plain).unwrap();

        let mut nonce_bytes = [0u8; 12];
        rand::RngCore::fill_bytes(&mut rand::thread_rng(), &mut nonce_bytes);

        let ciphertext = encrypt_payload(&content_key, &nonce_bytes, &req_plain_bytes).unwrap();

        let req_env = RequestEnvelope {
            ephemeral_pubkey: BASE64.encode(client_public.as_bytes()),
            nonce: BASE64.encode(nonce_bytes),
            ciphertext: BASE64.encode(ciphertext),
        };

        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/link-preview/proxy")
            .header(header::AUTHORIZATION, format!("Bearer {}", token))
            .header(header::CONTENT_TYPE, "application/octet-stream")
            .body(Body::from(serde_json::to_vec(&req_env).unwrap()))
            .unwrap();

        let res = app.clone().oneshot(req).await.unwrap();
        assert_eq!(res.status(), StatusCode::BAD_REQUEST);

        let body_bytes = axum::body::to_bytes(res.into_body(), usize::MAX)
            .await
            .unwrap();
        let resp_env: ResponseEnvelope = serde_json::from_slice(&body_bytes).unwrap();

        let resp_nonce: [u8; 12] = decode_base64_flexible(&resp_env.nonce)
            .unwrap()
            .try_into()
            .unwrap();
        let resp_ciphertext = decode_base64_flexible(&resp_env.ciphertext).unwrap();

        let err_plain_bytes = decrypt_payload(&content_key, &resp_nonce, &resp_ciphertext).unwrap();
        let err_plain: ErrorPlaintext = serde_json::from_slice(&err_plain_bytes).unwrap();

        assert_eq!(err_plain.error, "url_blocked");
        assert_eq!(err_plain.request_id.as_deref(), Some("req-ssrf"));
    }
}

#[tokio::test]
async fn test_ssrf_blocks_http_in_production() {
    let (app, _pool, _altcha) = common::setup_test_app_with_custom_config(|c| {
        c.app_env = "production".to_string();
        c.app_url = Some("https://localhost".to_string());
        c.link_preview_proxy_enabled = true;
    })
    .await;

    let req = Request::builder()
        .uri("/api/v1/capabilities")
        .body(Body::empty())
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    let body_bytes = axum::body::to_bytes(res.into_body(), usize::MAX)
        .await
        .unwrap();
    let cap_json: Value = serde_json::from_slice(&body_bytes).unwrap();
    let server_pubkey_bytes: [u8; 32] =
        decode_base64_flexible(cap_json["extension_proxy_key"].as_str().unwrap())
            .unwrap()
            .try_into()
            .unwrap();

    common::register_user(&app, "proxy_user3", "Password123!", None).await;
    let token = login_and_get_token(&app, "proxy_user3", "Password123!").await;

    let mut client_secret_bytes = [0u8; 32];
    rand::RngCore::fill_bytes(&mut rand::thread_rng(), &mut client_secret_bytes);
    let client_secret = StaticSecret::from(client_secret_bytes);
    let client_public = PublicKey::from(&client_secret);

    let server_pubkey = PublicKey::from(server_pubkey_bytes);
    let shared_secret = client_secret.diffie_hellman(&server_pubkey);
    let hk = hkdf::Hkdf::<sha2::Sha256>::new(None, shared_secret.as_bytes());
    let mut content_key = [0u8; 32];
    hk.expand(b"link-preview-content-key-v1", &mut content_key)
        .unwrap();

    let req_plain = RequestPlaintext {
        url: "http://example.com/test".to_string(),
        request_id: Some("req-http".to_string()),
    };
    let req_plain_bytes = serde_json::to_vec(&req_plain).unwrap();

    let mut nonce_bytes = [0u8; 12];
    rand::RngCore::fill_bytes(&mut rand::thread_rng(), &mut nonce_bytes);

    let ciphertext = encrypt_payload(&content_key, &nonce_bytes, &req_plain_bytes).unwrap();

    let req_env = RequestEnvelope {
        ephemeral_pubkey: BASE64.encode(client_public.as_bytes()),
        nonce: BASE64.encode(nonce_bytes),
        ciphertext: BASE64.encode(ciphertext),
    };

    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/link-preview/proxy")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/octet-stream")
        .body(Body::from(serde_json::to_vec(&req_env).unwrap()))
        .unwrap();

    let res = app.oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);

    let body_bytes = axum::body::to_bytes(res.into_body(), usize::MAX)
        .await
        .unwrap();
    let resp_env: ResponseEnvelope = serde_json::from_slice(&body_bytes).unwrap();

    let resp_nonce: [u8; 12] = decode_base64_flexible(&resp_env.nonce)
        .unwrap()
        .try_into()
        .unwrap();
    let resp_ciphertext = decode_base64_flexible(&resp_env.ciphertext).unwrap();

    let err_plain_bytes = decrypt_payload(&content_key, &resp_nonce, &resp_ciphertext).unwrap();
    let err_plain: ErrorPlaintext = serde_json::from_slice(&err_plain_bytes).unwrap();

    assert_eq!(err_plain.error, "url_blocked");
}

#[tokio::test]
async fn test_size_limit_exceeded() {
    let mock_server = MockServer::start().await;
    let large_body = vec![b'A'; 100]; // Small payload, but cap is 50 bytes

    Mock::given(method("GET"))
        .and(path("/large.html"))
        .respond_with(
            ResponseTemplate::new(200)
                .insert_header("content-type", "text/html")
                .set_body_bytes(large_body),
        )
        .mount(&mock_server)
        .await;

    let (app, _pool, _altcha) = common::setup_test_app_with_custom_config(|c| {
        c.link_preview_proxy_enabled = true;
        c.link_preview_proxy_max_bytes = 50; // Cap at 50 bytes
    })
    .await;

    let req = Request::builder()
        .uri("/api/v1/capabilities")
        .body(Body::empty())
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    let body_bytes = axum::body::to_bytes(res.into_body(), usize::MAX)
        .await
        .unwrap();
    let cap_json: Value = serde_json::from_slice(&body_bytes).unwrap();
    let server_pubkey_bytes: [u8; 32] =
        decode_base64_flexible(cap_json["extension_proxy_key"].as_str().unwrap())
            .unwrap()
            .try_into()
            .unwrap();

    common::register_user(&app, "proxy_user4", "Password123!", None).await;
    let token = login_and_get_token(&app, "proxy_user4", "Password123!").await;

    let mut client_secret_bytes = [0u8; 32];
    rand::RngCore::fill_bytes(&mut rand::thread_rng(), &mut client_secret_bytes);
    let client_secret = StaticSecret::from(client_secret_bytes);
    let client_public = PublicKey::from(&client_secret);

    let server_pubkey = PublicKey::from(server_pubkey_bytes);
    let shared_secret = client_secret.diffie_hellman(&server_pubkey);
    let hk = hkdf::Hkdf::<sha2::Sha256>::new(None, shared_secret.as_bytes());
    let mut content_key = [0u8; 32];
    hk.expand(b"link-preview-content-key-v1", &mut content_key)
        .unwrap();

    let target_url = format!("{}/large.html", mock_server.uri());
    let req_plain = RequestPlaintext {
        url: target_url,
        request_id: Some("req-large".to_string()),
    };

    let mut nonce_bytes = [0u8; 12];
    rand::RngCore::fill_bytes(&mut rand::thread_rng(), &mut nonce_bytes);

    let ciphertext = encrypt_payload(
        &content_key,
        &nonce_bytes,
        &serde_json::to_vec(&req_plain).unwrap(),
    )
    .unwrap();

    let req_env = RequestEnvelope {
        ephemeral_pubkey: BASE64.encode(client_public.as_bytes()),
        nonce: BASE64.encode(nonce_bytes),
        ciphertext: BASE64.encode(ciphertext),
    };

    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/link-preview/proxy")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/octet-stream")
        .header("x-link-preview-allow-local", "true")
        .body(Body::from(serde_json::to_vec(&req_env).unwrap()))
        .unwrap();

    let res = app.oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::BAD_GATEWAY);

    let body_bytes = axum::body::to_bytes(res.into_body(), usize::MAX)
        .await
        .unwrap();
    let resp_env: ResponseEnvelope = serde_json::from_slice(&body_bytes).unwrap();

    let resp_nonce: [u8; 12] = decode_base64_flexible(&resp_env.nonce)
        .unwrap()
        .try_into()
        .unwrap();
    let resp_ciphertext = decode_base64_flexible(&resp_env.ciphertext).unwrap();

    let err_plain_bytes = decrypt_payload(&content_key, &resp_nonce, &resp_ciphertext).unwrap();
    let err_plain: ErrorPlaintext = serde_json::from_slice(&err_plain_bytes).unwrap();

    assert_eq!(err_plain.error, "upstream_response_too_large");
}

#[tokio::test]
async fn test_gzip_bomb_exceeds_cap() {
    let mock_server = MockServer::start().await;

    let decompressed_data = vec![b'X'; 10000];
    let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
    encoder.write_all(&decompressed_data).unwrap();
    let gzip_bytes = encoder.finish().unwrap();

    Mock::given(method("GET"))
        .and(path("/gzip_bomb"))
        .respond_with(
            ResponseTemplate::new(200)
                .insert_header("content-type", "text/html")
                .insert_header("content-encoding", "gzip")
                .set_body_bytes(gzip_bytes),
        )
        .mount(&mock_server)
        .await;

    let (app, _pool, _altcha) = common::setup_test_app_with_custom_config(|c| {
        c.link_preview_proxy_enabled = true;
        c.link_preview_proxy_max_bytes = 500; // Cap at 500 bytes
    })
    .await;

    let req = Request::builder()
        .uri("/api/v1/capabilities")
        .body(Body::empty())
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    let body_bytes = axum::body::to_bytes(res.into_body(), usize::MAX)
        .await
        .unwrap();
    let cap_json: Value = serde_json::from_slice(&body_bytes).unwrap();
    let server_pubkey_bytes: [u8; 32] =
        decode_base64_flexible(cap_json["extension_proxy_key"].as_str().unwrap())
            .unwrap()
            .try_into()
            .unwrap();

    common::register_user(&app, "proxy_user5", "Password123!", None).await;
    let token = login_and_get_token(&app, "proxy_user5", "Password123!").await;

    let mut client_secret_bytes = [0u8; 32];
    rand::RngCore::fill_bytes(&mut rand::thread_rng(), &mut client_secret_bytes);
    let client_secret = StaticSecret::from(client_secret_bytes);
    let client_public = PublicKey::from(&client_secret);

    let server_pubkey = PublicKey::from(server_pubkey_bytes);
    let shared_secret = client_secret.diffie_hellman(&server_pubkey);
    let hk = hkdf::Hkdf::<sha2::Sha256>::new(None, shared_secret.as_bytes());
    let mut content_key = [0u8; 32];
    hk.expand(b"link-preview-content-key-v1", &mut content_key)
        .unwrap();

    let target_url = format!("{}/gzip_bomb", mock_server.uri());
    let req_plain = RequestPlaintext {
        url: target_url,
        request_id: Some("req-gzip".to_string()),
    };

    let mut nonce_bytes = [0u8; 12];
    rand::RngCore::fill_bytes(&mut rand::thread_rng(), &mut nonce_bytes);

    let ciphertext = encrypt_payload(
        &content_key,
        &nonce_bytes,
        &serde_json::to_vec(&req_plain).unwrap(),
    )
    .unwrap();

    let req_env = RequestEnvelope {
        ephemeral_pubkey: BASE64.encode(client_public.as_bytes()),
        nonce: BASE64.encode(nonce_bytes),
        ciphertext: BASE64.encode(ciphertext),
    };

    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/link-preview/proxy")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/octet-stream")
        .header("x-link-preview-allow-local", "true")
        .body(Body::from(serde_json::to_vec(&req_env).unwrap()))
        .unwrap();

    let res = app.oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::BAD_GATEWAY);

    let body_bytes = axum::body::to_bytes(res.into_body(), usize::MAX)
        .await
        .unwrap();
    let resp_env: ResponseEnvelope = serde_json::from_slice(&body_bytes).unwrap();

    let resp_nonce: [u8; 12] = decode_base64_flexible(&resp_env.nonce)
        .unwrap()
        .try_into()
        .unwrap();
    let resp_ciphertext = decode_base64_flexible(&resp_env.ciphertext).unwrap();

    let err_plain_bytes = decrypt_payload(&content_key, &resp_nonce, &resp_ciphertext).unwrap();
    let err_plain: ErrorPlaintext = serde_json::from_slice(&err_plain_bytes).unwrap();

    assert_eq!(err_plain.error, "upstream_response_too_large");
}

#[tokio::test]
async fn test_rate_limiting() {
    let mock_server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/rate.html"))
        .respond_with(
            ResponseTemplate::new(200)
                .insert_header("content-type", "text/html")
                .set_body_string("OK"),
        )
        .mount(&mock_server)
        .await;

    let (app, _pool, _altcha) = common::setup_test_app_with_custom_config(|c| {
        c.link_preview_proxy_enabled = true;
        c.rate_limits.rate_link_preview_per_min = 2; // Limit 2 per min
    })
    .await;

    let req = Request::builder()
        .uri("/api/v1/capabilities")
        .body(Body::empty())
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    let body_bytes = axum::body::to_bytes(res.into_body(), usize::MAX)
        .await
        .unwrap();
    let cap_json: Value = serde_json::from_slice(&body_bytes).unwrap();
    let server_pubkey_bytes: [u8; 32] =
        decode_base64_flexible(cap_json["extension_proxy_key"].as_str().unwrap())
            .unwrap()
            .try_into()
            .unwrap();

    common::register_user(&app, "proxy_user6", "Password123!", None).await;
    let token = login_and_get_token(&app, "proxy_user6", "Password123!").await;

    for i in 1..=3 {
        let mut client_secret_bytes = [0u8; 32];
        rand::RngCore::fill_bytes(&mut rand::thread_rng(), &mut client_secret_bytes);
        let client_secret = StaticSecret::from(client_secret_bytes);
        let client_public = PublicKey::from(&client_secret);

        let server_pubkey = PublicKey::from(server_pubkey_bytes);
        let shared_secret = client_secret.diffie_hellman(&server_pubkey);
        let hk = hkdf::Hkdf::<sha2::Sha256>::new(None, shared_secret.as_bytes());
        let mut content_key = [0u8; 32];
        hk.expand(b"link-preview-content-key-v1", &mut content_key)
            .unwrap();

        let req_plain = RequestPlaintext {
            url: format!("{}/rate.html", mock_server.uri()),
            request_id: Some(format!("req-{}", i)),
        };

        let mut nonce_bytes = [0u8; 12];
        rand::RngCore::fill_bytes(&mut rand::thread_rng(), &mut nonce_bytes);

        let ciphertext = encrypt_payload(
            &content_key,
            &nonce_bytes,
            &serde_json::to_vec(&req_plain).unwrap(),
        )
        .unwrap();

        let req_env = RequestEnvelope {
            ephemeral_pubkey: BASE64.encode(client_public.as_bytes()),
            nonce: BASE64.encode(nonce_bytes),
            ciphertext: BASE64.encode(ciphertext),
        };

        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/link-preview/proxy")
            .header(header::AUTHORIZATION, format!("Bearer {}", token))
            .header(header::CONTENT_TYPE, "application/octet-stream")
            .header("x-link-preview-allow-local", "true")
            .body(Body::from(serde_json::to_vec(&req_env).unwrap()))
            .unwrap();

        let res = app.clone().oneshot(req).await.unwrap();

        if i <= 2 {
            assert_eq!(res.status(), StatusCode::OK);
        } else {
            assert_eq!(res.status(), StatusCode::TOO_MANY_REQUESTS);
            assert!(res.headers().contains_key(header::RETRY_AFTER));
            let body_bytes = axum::body::to_bytes(res.into_body(), usize::MAX)
                .await
                .unwrap();
            let json_val: Value = serde_json::from_slice(&body_bytes).unwrap();
            assert_eq!(json_val["error"], "rate_limited");
        }
    }
}
