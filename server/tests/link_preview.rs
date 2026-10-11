mod common;

use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use axum::Router;
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use flate2::write::GzEncoder;
use flate2::Compression;
use serde_json::Value;
use std::fs;
use std::io::Write;
use std::sync::{Arc, Mutex};
use tempfile::tempdir;
use tower::ServiceExt;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};
use x25519_dalek::{PublicKey, StaticSecret};

use server::link_preview::content_key::{
    decode_base64_flexible, decrypt_payload, encrypt_payload, ErrorPlaintext, RequestEnvelope,
    RequestPlaintext, ResponseEnvelope, ResponsePlaintext,
};
use server::proxy_common::content_key::ProxyKeys;

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
    assert!(json_val.get("link_preview_proxy_key").is_none());

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
async fn test_capabilities_matrix_and_field_absence() {
    // 1. Link preview enabled only
    let (app1, _pool, _altcha) = common::setup_test_app_with_custom_config(|c| {
        c.link_preview_proxy_enabled = true;
        c.extension_proxy_enabled = false;
    })
    .await;

    let req = Request::builder()
        .uri("/api/v1/capabilities")
        .body(Body::empty())
        .unwrap();
    let res = app1.oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let body_bytes = axum::body::to_bytes(res.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_val1: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(json_val1["link_preview_proxy_enabled"], true);
    assert_eq!(json_val1["extension_proxy_enabled"], false);
    assert!(json_val1["extension_proxy_key"].is_string());
    assert!(json_val1.get("link_preview_proxy_key").is_none());
    let key1 = json_val1["extension_proxy_key"].as_str().unwrap();
    assert_eq!(decode_base64_flexible(key1).unwrap().len(), 32);

    // 2. Extension proxy enabled only
    let (app2, _pool, _altcha) = common::setup_test_app_with_custom_config(|c| {
        c.link_preview_proxy_enabled = false;
        c.extension_proxy_enabled = true;
    })
    .await;

    let req = Request::builder()
        .uri("/api/v1/capabilities")
        .body(Body::empty())
        .unwrap();
    let res = app2.oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let body_bytes = axum::body::to_bytes(res.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_val2: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(json_val2["link_preview_proxy_enabled"], false);
    assert_eq!(json_val2["extension_proxy_enabled"], true);
    assert!(json_val2["extension_proxy_key"].is_string());
    assert!(json_val2.get("link_preview_proxy_key").is_none());
    let key2 = json_val2["extension_proxy_key"].as_str().unwrap();
    assert_eq!(decode_base64_flexible(key2).unwrap().len(), 32);

    // 3. Both disabled
    let (app3, _pool, _altcha) = common::setup_test_app_with_custom_config(|c| {
        c.link_preview_proxy_enabled = false;
        c.extension_proxy_enabled = false;
    })
    .await;

    let req = Request::builder()
        .uri("/api/v1/capabilities")
        .body(Body::empty())
        .unwrap();
    let res = app3.oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let body_bytes = axum::body::to_bytes(res.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_val3: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(json_val3["link_preview_proxy_enabled"], false);
    assert_eq!(json_val3["extension_proxy_enabled"], false);
    assert!(json_val3["extension_proxy_key"].is_null());
    assert!(json_val3.get("link_preview_proxy_key").is_none());
}

#[tokio::test]
async fn test_shared_key_file_loading_permissions_and_replacement() {
    let dir = tempdir().unwrap();
    let key_file_path = dir.path().join("link-preview.key");
    let key_file_str = key_file_path.to_str().unwrap().to_string();

    // 1. First initialization: loads/generates new key file
    let keys1 = ProxyKeys::load_or_generate(&key_file_str).unwrap();
    assert_eq!(keys1.public_key_base64.len(), 44);

    // Verify Unix permissions 0600 on generated file
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let metadata = fs::metadata(&key_file_path).unwrap();
        let permissions = metadata.permissions();
        assert_eq!(permissions.mode() & 0o777, 0o600);
    }

    // 2. Re-load from existing file: produces identical keypair
    let keys2 = ProxyKeys::load_or_generate(&key_file_str).unwrap();
    assert_eq!(keys1.public_key_base64, keys2.public_key_base64);

    // 3. Replace key file with new secret: loads new keypair
    let mut new_secret_bytes = [0u8; 32];
    rand::RngCore::fill_bytes(&mut rand::thread_rng(), &mut new_secret_bytes);
    fs::write(&key_file_path, new_secret_bytes).unwrap();

    let keys3 = ProxyKeys::load_or_generate(&key_file_str).unwrap();
    assert_ne!(keys1.public_key_base64, keys3.public_key_base64);
}

#[tokio::test]
async fn test_malformed_key_file_fails_startup() {
    let dir = tempdir().unwrap();
    let key_file_path = dir.path().join("bad_length.key");
    fs::write(&key_file_path, [0u8; 16]).unwrap(); // Wrong length (16 != 32)

    let res = ProxyKeys::load_or_generate(key_file_path.to_str().unwrap());
    assert!(res.is_err());
    let err_msg = res.err().unwrap().to_string();
    assert!(err_msg.contains("Invalid proxy key length"));
}

#[test]
fn test_hkdf_info_separation_and_replay_prevention() {
    let mut server_secret_bytes = [0u8; 32];
    rand::RngCore::fill_bytes(&mut rand::thread_rng(), &mut server_secret_bytes);
    let server_secret = StaticSecret::from(server_secret_bytes);
    let server_public = PublicKey::from(&server_secret);

    let mut client_secret_bytes = [0u8; 32];
    rand::RngCore::fill_bytes(&mut rand::thread_rng(), &mut client_secret_bytes);
    let client_secret = StaticSecret::from(client_secret_bytes);

    // Shared ECDH secret
    let shared_secret = client_secret.diffie_hellman(&server_public);
    let hk = hkdf::Hkdf::<sha2::Sha256>::new(None, shared_secret.as_bytes());

    // Link preview content key
    let mut lp_content_key = [0u8; 32];
    hk.expand(b"link-preview-content-key-v1", &mut lp_content_key)
        .unwrap();

    // Extension proxy content key
    let mut ep_content_key = [0u8; 32];
    hk.expand(b"extension-proxy-content-key-v1", &mut ep_content_key)
        .unwrap();

    // 1. Assert content keys differ despite identical ECDH shared secret
    assert_ne!(lp_content_key, ep_content_key);

    // 2. Replay prevention: encrypt for link preview, attempt decrypt with extension key
    let plaintext = b"secret link preview query";
    let nonce = [7u8; 12];
    let lp_ciphertext = encrypt_payload(&lp_content_key, &nonce, plaintext).unwrap();

    let decrypt_res = decrypt_payload(&ep_content_key, &nonce, &lp_ciphertext);
    assert!(
        decrypt_res.is_err(),
        "Extension proxy key must NOT decrypt link preview ciphertext"
    );

    // 3. Reverse: encrypt for extension proxy, attempt decrypt with link preview key
    let ep_ciphertext = encrypt_payload(&ep_content_key, &nonce, plaintext).unwrap();
    let decrypt_res_rev = decrypt_payload(&lp_content_key, &nonce, &ep_ciphertext);
    assert!(
        decrypt_res_rev.is_err(),
        "Link preview key must NOT decrypt extension proxy ciphertext"
    );
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
async fn test_envelope_error_conditions() {
    let (app, _pool, _altcha) = common::setup_test_app_with_custom_config(|c| {
        c.link_preview_proxy_enabled = true;
    })
    .await;

    common::register_user(&app, "proxy_err_user", "Password123!", None).await;
    let token = login_and_get_token(&app, "proxy_err_user", "Password123!").await;

    // 1. Missing / invalid ephemeral_pubkey
    let bad_pubkey_env = RequestEnvelope {
        ephemeral_pubkey: BASE64.encode([0u8; 16]), // 16 bytes != 32
        nonce: BASE64.encode([0u8; 12]),
        ciphertext: BASE64.encode([0u8; 16]),
    };
    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/link-preview/proxy")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/octet-stream")
        .body(Body::from(serde_json::to_vec(&bad_pubkey_env).unwrap()))
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);

    // 2. Malformed nonce (length != 12)
    let bad_nonce_env = RequestEnvelope {
        ephemeral_pubkey: BASE64.encode([0u8; 32]),
        nonce: BASE64.encode([0u8; 8]), // 8 bytes != 12
        ciphertext: BASE64.encode([0u8; 16]),
    };
    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/link-preview/proxy")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/octet-stream")
        .body(Body::from(serde_json::to_vec(&bad_nonce_env).unwrap()))
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);

    // 3. Malformed ciphertext (invalid base64 / corrupt payload)
    let bad_ct_env = RequestEnvelope {
        ephemeral_pubkey: BASE64.encode([0u8; 32]),
        nonce: BASE64.encode([0u8; 12]),
        ciphertext: BASE64.encode([0u8; 32]), // Random bytes that fail AES-GCM decryption
    };
    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/link-preview/proxy")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/octet-stream")
        .body(Body::from(serde_json::to_vec(&bad_ct_env).unwrap()))
        .unwrap();
    let res = app.oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn test_proxy_log_opacity() {
    let mock_server = MockServer::start().await;
    let secret_body_content = "TOP_SECRET_PAGE_CONTENT_998877";
    Mock::given(method("GET"))
        .and(path("/secret.html"))
        .respond_with(ResponseTemplate::new(200).set_body_raw(
            format!("<html><body>{}</body></html>", secret_body_content),
            "text/html",
        ))
        .mount(&mock_server)
        .await;

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

    common::register_user(&app, "opacity_user", "Password123!", None).await;
    let token = login_and_get_token(&app, "opacity_user", "Password123!").await;

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

    let secret_url_path = "secret.html?token=SUPER_SECRET_URL_PARAM_776655";
    let target_url = format!("{}/{}", mock_server.uri(), secret_url_path);
    let req_plain = RequestPlaintext {
        url: target_url.clone(),
        request_id: Some("req-opacity".to_string()),
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

    let log_buf = Arc::new(Mutex::new(Vec::new()));
    let log_buf_clone = log_buf.clone();
    let subscriber = tracing_subscriber::fmt()
        .with_writer(move || {
            struct LockWriter(Arc<Mutex<Vec<u8>>>);
            impl std::io::Write for LockWriter {
                fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
                    self.0.lock().unwrap().extend_from_slice(buf);
                    Ok(buf.len())
                }
                fn flush(&mut self) -> std::io::Result<()> {
                    Ok(())
                }
            }
            LockWriter(log_buf_clone.clone())
        })
        .with_max_level(tracing::Level::TRACE)
        .finish();

    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/link-preview/proxy")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/octet-stream")
        .header("x-link-preview-allow-local", "true")
        .body(Body::from(serde_json::to_vec(&req_env).unwrap()))
        .unwrap();

    let res =
        tracing::subscriber::with_default(subscriber, || async { app.oneshot(req).await.unwrap() })
            .await;

    assert_eq!(res.status(), StatusCode::OK);

    let logs = String::from_utf8(log_buf.lock().unwrap().clone()).unwrap();
    assert!(
        !logs.contains("SUPER_SECRET_URL_PARAM_776655"),
        "Plaintext URL query param must NOT appear in server logs!"
    );
    assert!(
        !logs.contains(secret_body_content),
        "Plaintext response body content must NOT appear in server logs!"
    );
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
