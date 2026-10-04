use axum::http::{header, StatusCode};
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use flate2::write::GzEncoder;
use flate2::Compression;
use serde_json::{json, Value};
use std::io::Write;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};
use x25519_dalek::{PublicKey, StaticSecret};

use server::extensions_proxy::validate::{ExtensionErrorPlaintext, ExtensionResponsePlaintext};
use server::proxy_common::content_key::{
    decode_base64_flexible, decrypt_payload, derive_content_key, encrypt_payload, RequestEnvelope,
    ResponseEnvelope,
};

mod common;
use common::{register_user, setup_test_app_with_custom_config};

fn helper_encrypt_request(server_pubkey_b64: &str, payload_json: &Value) -> (Vec<u8>, [u8; 32]) {
    let server_pubkey_bytes = decode_base64_flexible(server_pubkey_b64).unwrap();
    let mut array = [0u8; 32];
    array.copy_from_slice(&server_pubkey_bytes);

    let mut ephemeral_bytes = [0u8; 32];
    rand::RngCore::fill_bytes(&mut rand::thread_rng(), &mut ephemeral_bytes);
    let ephemeral_secret = StaticSecret::from(ephemeral_bytes);
    let ephemeral_public = PublicKey::from(&ephemeral_secret);

    let content_key =
        derive_content_key(&ephemeral_secret, &array, b"extension-proxy-content-key-v1").unwrap();

    let plaintext_bytes = serde_json::to_vec(payload_json).unwrap();
    let mut req_nonce = [0u8; 12];
    rand::RngCore::fill_bytes(&mut rand::thread_rng(), &mut req_nonce);

    let ciphertext_bytes = encrypt_payload(&content_key, &req_nonce, &plaintext_bytes).unwrap();

    let req_env = RequestEnvelope {
        ephemeral_pubkey: BASE64.encode(ephemeral_public.as_bytes()),
        nonce: BASE64.encode(req_nonce),
        ciphertext: BASE64.encode(ciphertext_bytes),
    };

    (serde_json::to_vec(&req_env).unwrap(), content_key)
}

fn helper_decrypt_response<T: serde::de::DeserializeOwned>(
    body_bytes: &[u8],
    content_key: &[u8; 32],
) -> T {
    let resp_env: ResponseEnvelope = serde_json::from_slice(body_bytes).unwrap();
    let nonce_bytes = decode_base64_flexible(&resp_env.nonce).unwrap();
    let mut array_nonce = [0u8; 12];
    array_nonce.copy_from_slice(&nonce_bytes);

    let ciphertext_bytes = decode_base64_flexible(&resp_env.ciphertext).unwrap();
    let plaintext_bytes = decrypt_payload(content_key, &array_nonce, &ciphertext_bytes).unwrap();

    serde_json::from_slice(&plaintext_bytes).unwrap()
}

#[tokio::test]
async fn test_extension_proxy_disabled_by_default() {
    let (app, _pool, _) = setup_test_app_with_custom_config(|c| {
        c.extension_proxy_enabled = false;
        c.link_preview_proxy_enabled = false;
    })
    .await;

    let _user_id = register_user(&app, "alice", "Password123!", None).await;
    let (login_status, login_json) =
        common::login_user(&app, "alice", "Password123!", "client_123456789", None).await;
    assert_eq!(login_status, StatusCode::OK);
    let token = login_json["session_token"].as_str().unwrap();

    let req = axum::http::Request::builder()
        .method("POST")
        .uri("/api/v1/extensions/proxy")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/octet-stream")
        .body(axum::body::Body::from(vec![0u8; 10]))
        .unwrap();

    let resp = tower::ServiceExt::oneshot(app, req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_IMPLEMENTED);
    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_val: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(json_val["error"], "proxy_disabled");
}

#[tokio::test]
async fn test_extension_proxy_unauthenticated() {
    let (app, _pool, _) = setup_test_app_with_custom_config(|c| {
        c.extension_proxy_enabled = true;
        c.link_preview_proxy_enabled = true;
    })
    .await;

    let req = axum::http::Request::builder()
        .method("POST")
        .uri("/api/v1/extensions/proxy")
        .header(header::CONTENT_TYPE, "application/octet-stream")
        .body(axum::body::Body::from(vec![0u8; 10]))
        .unwrap();

    let resp = tower::ServiceExt::oneshot(app, req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn test_roundtrip_get_success() {
    let mock_server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/feed.xml"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_raw("<rss>hello</rss>", "application/xml")
                .append_header("etag", "\"12345\""),
        )
        .mount(&mock_server)
        .await;

    let (app, _pool, _) = setup_test_app_with_custom_config(|c| {
        c.extension_proxy_enabled = true;
        c.link_preview_proxy_enabled = true;
    })
    .await;

    let _user_id = register_user(&app, "bob", "Password123!", None).await;
    let (_, login_json) =
        common::login_user(&app, "bob", "Password123!", "client_123456789", None).await;
    let token = login_json["session_token"].as_str().unwrap();

    let cap_req = axum::http::Request::builder()
        .method("GET")
        .uri("/api/v1/capabilities")
        .body(axum::body::Body::empty())
        .unwrap();
    let cap_resp = tower::ServiceExt::oneshot(app.clone(), cap_req)
        .await
        .unwrap();
    let cap_bytes = axum::body::to_bytes(cap_resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let cap_json: Value = serde_json::from_slice(&cap_bytes).unwrap();
    let server_pubkey_b64 = cap_json["link_preview_proxy_key"].as_str().unwrap();

    let target_url = format!("{}/feed.xml", mock_server.uri());
    let req_payload = json!({
        "url": target_url,
        "method": "GET",
        "headers": {
            "Accept": "application/xml"
        },
        "extension_id": "com.example.rss",
        "request_id": "req_100"
    });

    let (body_bytes, content_key) = helper_encrypt_request(server_pubkey_b64, &req_payload);

    let req = axum::http::Request::builder()
        .method("POST")
        .uri("/api/v1/extensions/proxy")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/octet-stream")
        .header("x-extension-proxy-allow-local", "true")
        .body(axum::body::Body::from(body_bytes))
        .unwrap();

    let resp = tower::ServiceExt::oneshot(app, req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let resp_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let resp_plain: ExtensionResponsePlaintext = helper_decrypt_response(&resp_bytes, &content_key);

    assert_eq!(resp_plain.status, 200);
    assert_eq!(resp_plain.request_id, "req_100");
    assert_eq!(
        resp_plain.headers.get("content-type").unwrap(),
        "application/xml"
    );
    assert_eq!(resp_plain.headers.get("etag").unwrap(), "\"12345\"");

    let decoded_body = BASE64.decode(&resp_plain.body).unwrap();
    assert_eq!(String::from_utf8(decoded_body).unwrap(), "<rss>hello</rss>");
}

#[tokio::test]
async fn test_roundtrip_head_success() {
    let mock_server = MockServer::start().await;
    Mock::given(method("HEAD"))
        .and(path("/check"))
        .respond_with(ResponseTemplate::new(200).append_header("content-type", "text/plain"))
        .mount(&mock_server)
        .await;

    let (app, _pool, _) = setup_test_app_with_custom_config(|c| {
        c.extension_proxy_enabled = true;
        c.link_preview_proxy_enabled = true;
    })
    .await;

    let _user_id = register_user(&app, "head_user", "Password123!", None).await;
    let (_, login_json) =
        common::login_user(&app, "head_user", "Password123!", "client_123456789", None).await;
    let token = login_json["session_token"].as_str().unwrap();

    let cap_req = axum::http::Request::builder()
        .method("GET")
        .uri("/api/v1/capabilities")
        .body(axum::body::Body::empty())
        .unwrap();
    let cap_resp = tower::ServiceExt::oneshot(app.clone(), cap_req)
        .await
        .unwrap();
    let cap_json: Value = serde_json::from_slice(
        &axum::body::to_bytes(cap_resp.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    let server_pubkey_b64 = cap_json["link_preview_proxy_key"].as_str().unwrap();

    let target_url = format!("{}/check", mock_server.uri());
    let req_payload = json!({
        "url": target_url,
        "method": "HEAD",
        "extension_id": "com.example.head",
        "request_id": "req_head_1"
    });

    let (body_bytes, content_key) = helper_encrypt_request(server_pubkey_b64, &req_payload);

    let req = axum::http::Request::builder()
        .method("POST")
        .uri("/api/v1/extensions/proxy")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/octet-stream")
        .header("x-extension-proxy-allow-local", "true")
        .body(axum::body::Body::from(body_bytes))
        .unwrap();

    let resp = tower::ServiceExt::oneshot(app, req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let resp_plain: ExtensionResponsePlaintext = helper_decrypt_response(
        &axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap(),
        &content_key,
    );

    assert_eq!(resp_plain.status, 200);
    assert_eq!(resp_plain.request_id, "req_head_1");
    assert_eq!(resp_plain.body, "");
}

#[tokio::test]
async fn test_roundtrip_post_success() {
    let mock_server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/submit"))
        .respond_with(
            ResponseTemplate::new(201)
                .set_body_string("{\"created\":true}")
                .append_header("content-type", "application/json"),
        )
        .mount(&mock_server)
        .await;

    let (app, _pool, _) = setup_test_app_with_custom_config(|c| {
        c.extension_proxy_enabled = true;
        c.link_preview_proxy_enabled = true;
    })
    .await;

    let _user_id = register_user(&app, "post_user", "Password123!", None).await;
    let (_, login_json) =
        common::login_user(&app, "post_user", "Password123!", "client_123456789", None).await;
    let token = login_json["session_token"].as_str().unwrap();

    let cap_req = axum::http::Request::builder()
        .method("GET")
        .uri("/api/v1/capabilities")
        .body(axum::body::Body::empty())
        .unwrap();
    let cap_resp = tower::ServiceExt::oneshot(app.clone(), cap_req)
        .await
        .unwrap();
    let cap_json: Value = serde_json::from_slice(
        &axum::body::to_bytes(cap_resp.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    let server_pubkey_b64 = cap_json["link_preview_proxy_key"].as_str().unwrap();

    let target_url = format!("{}/api/submit", mock_server.uri());
    let req_payload = json!({
        "url": target_url,
        "method": "POST",
        "body": "hello world",
        "extension_id": "com.example.post",
        "request_id": "req_post_1"
    });

    let (body_bytes, content_key) = helper_encrypt_request(server_pubkey_b64, &req_payload);

    let req = axum::http::Request::builder()
        .method("POST")
        .uri("/api/v1/extensions/proxy")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/octet-stream")
        .header("x-extension-proxy-allow-local", "true")
        .body(axum::body::Body::from(body_bytes))
        .unwrap();

    let resp = tower::ServiceExt::oneshot(app, req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let resp_plain: ExtensionResponsePlaintext = helper_decrypt_response(
        &axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap(),
        &content_key,
    );

    assert_eq!(resp_plain.status, 201);
    let decoded_body = BASE64.decode(&resp_plain.body).unwrap();
    assert_eq!(
        String::from_utf8(decoded_body).unwrap(),
        "{\"created\":true}"
    );
}

#[tokio::test]
async fn test_method_and_header_rejections() {
    let (app, _pool, _) = setup_test_app_with_custom_config(|c| {
        c.extension_proxy_enabled = true;
        c.link_preview_proxy_enabled = true;
    })
    .await;

    let _user_id = register_user(&app, "rej_user", "Password123!", None).await;
    let (_, login_json) =
        common::login_user(&app, "rej_user", "Password123!", "client_123456789", None).await;
    let token = login_json["session_token"].as_str().unwrap();

    let cap_req = axum::http::Request::builder()
        .method("GET")
        .uri("/api/v1/capabilities")
        .body(axum::body::Body::empty())
        .unwrap();
    let cap_resp = tower::ServiceExt::oneshot(app.clone(), cap_req)
        .await
        .unwrap();
    let cap_json: Value = serde_json::from_slice(
        &axum::body::to_bytes(cap_resp.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    let server_pubkey_b64 = cap_json["link_preview_proxy_key"].as_str().unwrap();

    // 1. Method PUT rejected
    let req_payload1 = json!({
        "url": "https://example.com/item",
        "method": "PUT",
        "extension_id": "ext1",
        "request_id": "req_put"
    });
    let (body1, key1) = helper_encrypt_request(server_pubkey_b64, &req_payload1);
    let req1 = axum::http::Request::builder()
        .method("POST")
        .uri("/api/v1/extensions/proxy")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/octet-stream")
        .body(axum::body::Body::from(body1))
        .unwrap();
    let resp1 = tower::ServiceExt::oneshot(app.clone(), req1).await.unwrap();
    assert_eq!(resp1.status(), StatusCode::BAD_REQUEST);
    let err1: ExtensionErrorPlaintext = helper_decrypt_response(
        &axum::body::to_bytes(resp1.into_body(), usize::MAX)
            .await
            .unwrap(),
        &key1,
    );
    assert_eq!(err1.error, "method_not_allowed");

    // 2. Authorization header rejected
    let req_payload2 = json!({
        "url": "https://example.com/item",
        "method": "GET",
        "headers": {
            "Authorization": "Bearer token123"
        },
        "extension_id": "ext1",
        "request_id": "req_auth"
    });
    let (body2, key2) = helper_encrypt_request(server_pubkey_b64, &req_payload2);
    let req2 = axum::http::Request::builder()
        .method("POST")
        .uri("/api/v1/extensions/proxy")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/octet-stream")
        .body(axum::body::Body::from(body2))
        .unwrap();
    let resp2 = tower::ServiceExt::oneshot(app.clone(), req2).await.unwrap();
    assert_eq!(resp2.status(), StatusCode::BAD_REQUEST);
    let err2: ExtensionErrorPlaintext = helper_decrypt_response(
        &axum::body::to_bytes(resp2.into_body(), usize::MAX)
            .await
            .unwrap(),
        &key2,
    );
    assert_eq!(err2.error, "header_not_allowed");

    // 3. Cookie header rejected
    let req_payload3 = json!({
        "url": "https://example.com/item",
        "method": "GET",
        "headers": {
            "Cookie": "session=123"
        },
        "extension_id": "ext1",
        "request_id": "req_cookie"
    });
    let (body3, key3) = helper_encrypt_request(server_pubkey_b64, &req_payload3);
    let req3 = axum::http::Request::builder()
        .method("POST")
        .uri("/api/v1/extensions/proxy")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/octet-stream")
        .body(axum::body::Body::from(body3))
        .unwrap();
    let resp3 = tower::ServiceExt::oneshot(app.clone(), req3).await.unwrap();
    assert_eq!(resp3.status(), StatusCode::BAD_REQUEST);
    let err3: ExtensionErrorPlaintext = helper_decrypt_response(
        &axum::body::to_bytes(resp3.into_body(), usize::MAX)
            .await
            .unwrap(),
        &key3,
    );
    assert_eq!(err3.error, "header_not_allowed");

    // 4. Non-allowlisted header rejected
    let req_payload4 = json!({
        "url": "https://example.com/item",
        "method": "GET",
        "headers": {
            "X-Custom-Header": "custom_value"
        },
        "extension_id": "ext1",
        "request_id": "req_custom"
    });
    let (body4, key4) = helper_encrypt_request(server_pubkey_b64, &req_payload4);
    let req4 = axum::http::Request::builder()
        .method("POST")
        .uri("/api/v1/extensions/proxy")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/octet-stream")
        .body(axum::body::Body::from(body4))
        .unwrap();
    let resp4 = tower::ServiceExt::oneshot(app.clone(), req4).await.unwrap();
    assert_eq!(resp4.status(), StatusCode::BAD_REQUEST);
    let err4: ExtensionErrorPlaintext = helper_decrypt_response(
        &axum::body::to_bytes(resp4.into_body(), usize::MAX)
            .await
            .unwrap(),
        &key4,
    );
    assert_eq!(err4.error, "header_not_allowed");
}

#[tokio::test]
async fn test_url_validation_and_ssrf() {
    let (app, _pool, _) = setup_test_app_with_custom_config(|c| {
        c.extension_proxy_enabled = true;
        c.link_preview_proxy_enabled = true;
    })
    .await;

    let _user_id = register_user(&app, "ssrf_user", "Password123!", None).await;
    let (_, login_json) =
        common::login_user(&app, "ssrf_user", "Password123!", "client_123456789", None).await;
    let token = login_json["session_token"].as_str().unwrap();

    let cap_req = axum::http::Request::builder()
        .method("GET")
        .uri("/api/v1/capabilities")
        .body(axum::body::Body::empty())
        .unwrap();
    let cap_resp = tower::ServiceExt::oneshot(app.clone(), cap_req)
        .await
        .unwrap();
    let cap_json: Value = serde_json::from_slice(
        &axum::body::to_bytes(cap_resp.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    let server_pubkey_b64 = cap_json["link_preview_proxy_key"].as_str().unwrap();

    // 1. http:// rejected when app_env is production
    let (prod_app, _pool, _) = setup_test_app_with_custom_config(|c| {
        c.app_env = "production".to_string();
        c.app_url = Some("https://localhost:8080".to_string());
        c.extension_proxy_enabled = true;
        c.link_preview_proxy_enabled = true;
    })
    .await;
    let _prod_uid = register_user(&prod_app, "ssrf_prod", "Password123!", None).await;
    let (_, prod_login) = common::login_user(
        &prod_app,
        "ssrf_prod",
        "Password123!",
        "client_123456789",
        None,
    )
    .await;
    let prod_token = prod_login["session_token"].as_str().unwrap();

    let req_payload1 = json!({
        "url": "http://example.com/feed",
        "method": "GET",
        "extension_id": "ext1",
        "request_id": "req_http"
    });
    let (body1, key1) = helper_encrypt_request(server_pubkey_b64, &req_payload1);
    let req1 = axum::http::Request::builder()
        .method("POST")
        .uri("/api/v1/extensions/proxy")
        .header(header::AUTHORIZATION, format!("Bearer {}", prod_token))
        .header(header::CONTENT_TYPE, "application/octet-stream")
        .body(axum::body::Body::from(body1))
        .unwrap();
    let resp1 = tower::ServiceExt::oneshot(prod_app, req1).await.unwrap();
    assert_eq!(resp1.status(), StatusCode::BAD_REQUEST);
    let err1: ExtensionErrorPlaintext = helper_decrypt_response(
        &axum::body::to_bytes(resp1.into_body(), usize::MAX)
            .await
            .unwrap(),
        &key1,
    );
    assert_eq!(err1.error, "url_blocked");

    // 2. Loopback rejected (127.0.0.1) without allow local header
    let req_payload2 = json!({
        "url": "https://127.0.0.1/feed",
        "method": "GET",
        "extension_id": "ext1",
        "request_id": "req_loopback"
    });
    let (body2, key2) = helper_encrypt_request(server_pubkey_b64, &req_payload2);
    let req2 = axum::http::Request::builder()
        .method("POST")
        .uri("/api/v1/extensions/proxy")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/octet-stream")
        .body(axum::body::Body::from(body2))
        .unwrap();
    let resp2 = tower::ServiceExt::oneshot(app.clone(), req2).await.unwrap();
    assert_eq!(resp2.status(), StatusCode::BAD_REQUEST);
    let err2: ExtensionErrorPlaintext = helper_decrypt_response(
        &axum::body::to_bytes(resp2.into_body(), usize::MAX)
            .await
            .unwrap(),
        &key2,
    );
    assert_eq!(err2.error, "url_blocked");

    // 3. AWS metadata rejected (169.254.169.254)
    let req_payload3 = json!({
        "url": "https://169.254.169.254/latest/meta-data/",
        "method": "GET",
        "extension_id": "ext1",
        "request_id": "req_aws"
    });
    let (body3, key3) = helper_encrypt_request(server_pubkey_b64, &req_payload3);
    let req3 = axum::http::Request::builder()
        .method("POST")
        .uri("/api/v1/extensions/proxy")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/octet-stream")
        .body(axum::body::Body::from(body3))
        .unwrap();
    let resp3 = tower::ServiceExt::oneshot(app.clone(), req3).await.unwrap();
    assert_eq!(resp3.status(), StatusCode::BAD_REQUEST);
    let err3: ExtensionErrorPlaintext = helper_decrypt_response(
        &axum::body::to_bytes(resp3.into_body(), usize::MAX)
            .await
            .unwrap(),
        &key3,
    );
    assert_eq!(err3.error, "url_blocked");
}

#[tokio::test]
async fn test_redirect_policy_get_and_post() {
    let mock_server = MockServer::start().await;

    // GET target
    Mock::given(method("GET"))
        .and(path("/final-get"))
        .respond_with(ResponseTemplate::new(200).set_body_string("final_get_data"))
        .mount(&mock_server)
        .await;

    // GET 302 redirect
    Mock::given(method("GET"))
        .and(path("/redirect-get"))
        .respond_with(ResponseTemplate::new(302).append_header("location", "/final-get"))
        .mount(&mock_server)
        .await;

    // POST 301 redirect
    Mock::given(method("POST"))
        .and(path("/redirect-post-301"))
        .respond_with(ResponseTemplate::new(301).append_header("location", "/final-post"))
        .mount(&mock_server)
        .await;

    let (app, _pool, _) = setup_test_app_with_custom_config(|c| {
        c.extension_proxy_enabled = true;
        c.link_preview_proxy_enabled = true;
    })
    .await;

    let _user_id = register_user(&app, "redir_user", "Password123!", None).await;
    let (_, login_json) =
        common::login_user(&app, "redir_user", "Password123!", "client_123456789", None).await;
    let token = login_json["session_token"].as_str().unwrap();

    let cap_req = axum::http::Request::builder()
        .method("GET")
        .uri("/api/v1/capabilities")
        .body(axum::body::Body::empty())
        .unwrap();
    let cap_resp = tower::ServiceExt::oneshot(app.clone(), cap_req)
        .await
        .unwrap();
    let cap_json: Value = serde_json::from_slice(
        &axum::body::to_bytes(cap_resp.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    let server_pubkey_b64 = cap_json["link_preview_proxy_key"].as_str().unwrap();

    // 1. GET 302 follows
    let target_url_get = format!("{}/redirect-get", mock_server.uri());
    let req_payload1 = json!({
        "url": target_url_get,
        "method": "GET",
        "extension_id": "ext_redir",
        "request_id": "req_redir_1"
    });
    let (body1, key1) = helper_encrypt_request(server_pubkey_b64, &req_payload1);
    let req1 = axum::http::Request::builder()
        .method("POST")
        .uri("/api/v1/extensions/proxy")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/octet-stream")
        .header("x-extension-proxy-allow-local", "true")
        .body(axum::body::Body::from(body1))
        .unwrap();
    let resp1 = tower::ServiceExt::oneshot(app.clone(), req1).await.unwrap();
    assert_eq!(resp1.status(), StatusCode::OK);
    let resp_plain1: ExtensionResponsePlaintext = helper_decrypt_response(
        &axum::body::to_bytes(resp1.into_body(), usize::MAX)
            .await
            .unwrap(),
        &key1,
    );
    assert_eq!(resp_plain1.status, 200);
    assert_eq!(
        String::from_utf8(BASE64.decode(&resp_plain1.body).unwrap()).unwrap(),
        "final_get_data"
    );

    // 2. POST 301 returned to client without following
    let target_url_post_301 = format!("{}/redirect-post-301", mock_server.uri());
    let req_payload2 = json!({
        "url": target_url_post_301,
        "method": "POST",
        "body": "post payload",
        "extension_id": "ext_redir",
        "request_id": "req_redir_2"
    });
    let (body2, key2) = helper_encrypt_request(server_pubkey_b64, &req_payload2);
    let req2 = axum::http::Request::builder()
        .method("POST")
        .uri("/api/v1/extensions/proxy")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/octet-stream")
        .header("x-extension-proxy-allow-local", "true")
        .body(axum::body::Body::from(body2))
        .unwrap();
    let resp2 = tower::ServiceExt::oneshot(app.clone(), req2).await.unwrap();
    assert_eq!(resp2.status(), StatusCode::OK);
    let resp_plain2: ExtensionResponsePlaintext = helper_decrypt_response(
        &axum::body::to_bytes(resp2.into_body(), usize::MAX)
            .await
            .unwrap(),
        &key2,
    );
    assert_eq!(resp_plain2.status, 301);
    assert_eq!(resp_plain2.headers.get("location").unwrap(), "/final-post");
}

#[tokio::test]
async fn test_gzip_decompression_and_bomb() {
    let raw_content = "compressed text ".repeat(100);
    let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
    encoder.write_all(raw_content.as_bytes()).unwrap();
    let compressed_bytes = encoder.finish().unwrap();

    let mock_server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/gzip-doc"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_bytes(compressed_bytes)
                .append_header("content-encoding", "gzip")
                .append_header("content-type", "text/plain"),
        )
        .mount(&mock_server)
        .await;

    let (app, _pool, _) = setup_test_app_with_custom_config(|c| {
        c.extension_proxy_enabled = true;
        c.link_preview_proxy_enabled = true;
        c.extension_proxy_max_response_bytes = 50; // Cap small to trigger gzip bomb rejection
    })
    .await;

    let _user_id = register_user(&app, "gzip_user", "Password123!", None).await;
    let (_, login_json) =
        common::login_user(&app, "gzip_user", "Password123!", "client_123456789", None).await;
    let token = login_json["session_token"].as_str().unwrap();

    let cap_req = axum::http::Request::builder()
        .method("GET")
        .uri("/api/v1/capabilities")
        .body(axum::body::Body::empty())
        .unwrap();
    let cap_resp = tower::ServiceExt::oneshot(app.clone(), cap_req)
        .await
        .unwrap();
    let cap_json: Value = serde_json::from_slice(
        &axum::body::to_bytes(cap_resp.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    let server_pubkey_b64 = cap_json["link_preview_proxy_key"].as_str().unwrap();

    let target_url = format!("{}/gzip-doc", mock_server.uri());
    let req_payload = json!({
        "url": target_url,
        "method": "GET",
        "extension_id": "ext_gzip",
        "request_id": "req_gzip_1"
    });
    let (body_bytes, content_key) = helper_encrypt_request(server_pubkey_b64, &req_payload);

    let req = axum::http::Request::builder()
        .method("POST")
        .uri("/api/v1/extensions/proxy")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/octet-stream")
        .header("x-extension-proxy-allow-local", "true")
        .body(axum::body::Body::from(body_bytes))
        .unwrap();

    let resp = tower::ServiceExt::oneshot(app, req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_GATEWAY);

    let err: ExtensionErrorPlaintext = helper_decrypt_response(
        &axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap(),
        &content_key,
    );
    assert_eq!(err.error, "upstream_response_too_large");
}

#[tokio::test]
async fn test_request_body_size_limit_before_decryption() {
    let (app, _pool, _) = setup_test_app_with_custom_config(|c| {
        c.extension_proxy_enabled = true;
        c.link_preview_proxy_enabled = true;
        c.extension_proxy_max_request_bytes = 100; // Cap request body at 100 bytes
    })
    .await;

    let _user_id = register_user(&app, "huge_user", "Password123!", None).await;
    let (_, login_json) =
        common::login_user(&app, "huge_user", "Password123!", "client_123456789", None).await;
    let token = login_json["session_token"].as_str().unwrap();

    let req = axum::http::Request::builder()
        .method("POST")
        .uri("/api/v1/extensions/proxy")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/octet-stream")
        .body(axum::body::Body::from(vec![0u8; 200])) // 200 > 100 bytes
        .unwrap();

    let resp = tower::ServiceExt::oneshot(app, req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::PAYLOAD_TOO_LARGE);

    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_val: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(json_val["error"], "request_too_large");
}

#[tokio::test]
async fn test_extension_proxy_capabilities() {
    // 1. When disabled
    let (app_disabled, _, _) = setup_test_app_with_custom_config(|c| {
        c.extension_proxy_enabled = false;
        c.link_preview_proxy_enabled = false;
    })
    .await;

    let req = axum::http::Request::builder()
        .method("GET")
        .uri("/api/v1/capabilities")
        .body(axum::body::Body::empty())
        .unwrap();
    let resp = tower::ServiceExt::oneshot(app_disabled, req).await.unwrap();
    let json_val: Value = serde_json::from_slice(
        &axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();

    assert_eq!(json_val["extension_proxy_enabled"], false);
    assert_eq!(json_val["extension_proxy_key"], Value::Null);
    assert_eq!(json_val["extension_proxy_supports_streaming"], false);

    // 2. When enabled
    let (app_enabled, _, _) = setup_test_app_with_custom_config(|c| {
        c.extension_proxy_enabled = true;
        c.link_preview_proxy_enabled = true;
        c.extension_proxy_max_request_bytes = 262144;
        c.extension_proxy_max_response_bytes = 10485760;
    })
    .await;

    let req2 = axum::http::Request::builder()
        .method("GET")
        .uri("/api/v1/capabilities")
        .body(axum::body::Body::empty())
        .unwrap();
    let resp2 = tower::ServiceExt::oneshot(app_enabled, req2).await.unwrap();
    let json_val2: Value = serde_json::from_slice(
        &axum::body::to_bytes(resp2.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();

    assert_eq!(json_val2["extension_proxy_enabled"], true);
    assert_eq!(json_val2["extension_proxy_max_request_bytes"], 262144);
    assert_eq!(json_val2["extension_proxy_max_response_bytes"], 10485760);
    assert_eq!(json_val2["extension_proxy_supports_streaming"], false);
    assert!(json_val2["extension_proxy_key"].is_string());
}

#[tokio::test]
async fn test_blocklist_config_and_file_loading() {
    let temp_dir = tempfile::tempdir().unwrap();
    let file_path = temp_dir.path().join("deny.txt");
    std::fs::write(
        &file_path,
        "# Comment line\n\n  \n  Deny-File.Org  \nmalformed..domain\n  good-domain.com  \n",
    )
    .unwrap();

    let env_domains = "  Example.Com , , sub.test.net , invalid..domain ";
    let blocklist = server::extensions_proxy::blocklist::load_blocklist(
        env_domains,
        file_path.to_str().unwrap(),
    )
    .unwrap();

    assert_eq!(blocklist.len(), 4);
    assert!(blocklist.is_blocked("example.com"));
    assert!(blocklist.is_blocked("api.example.com"));
    assert!(blocklist.is_blocked("sub.test.net"));
    assert!(blocklist.is_blocked("deny-file.org"));
    assert!(blocklist.is_blocked("good-domain.com"));
    assert!(!blocklist.is_blocked("notexample.com"));
    assert!(!blocklist.is_blocked("allowed.org"));
}

#[tokio::test]
async fn test_blocklist_enforcement_and_order_of_checks() {
    let (app, _pool, _) = setup_test_app_with_custom_config(|c| {
        c.extension_proxy_enabled = true;
        c.link_preview_proxy_enabled = true;
        c.extension_proxy_deny_domains = "deny-me.com, 127.0.0.1".to_string();
    })
    .await;

    let _user_id = register_user(&app, "block_user", "Password123!", None).await;
    let (_, login_json) =
        common::login_user(&app, "block_user", "Password123!", "client_123456789", None).await;
    let token = login_json["session_token"].as_str().unwrap();

    let cap_req = axum::http::Request::builder()
        .method("GET")
        .uri("/api/v1/capabilities")
        .body(axum::body::Body::empty())
        .unwrap();
    let cap_resp = tower::ServiceExt::oneshot(app.clone(), cap_req)
        .await
        .unwrap();
    let cap_json: Value = serde_json::from_slice(
        &axum::body::to_bytes(cap_resp.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    let server_pubkey_b64 = cap_json["extension_proxy_key"].as_str().unwrap();

    // 1. Exact match on blocked domain
    let req_payload1 = json!({
        "url": "https://deny-me.com/path",
        "method": "GET",
        "extension_id": "ext_block",
        "request_id": "req_b1"
    });
    let (body1, key1) = helper_encrypt_request(server_pubkey_b64, &req_payload1);
    let req1 = axum::http::Request::builder()
        .method("POST")
        .uri("/api/v1/extensions/proxy")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/octet-stream")
        .body(axum::body::Body::from(body1))
        .unwrap();
    let resp1 = tower::ServiceExt::oneshot(app.clone(), req1).await.unwrap();
    assert_eq!(resp1.status(), StatusCode::BAD_REQUEST);

    let err1: ExtensionErrorPlaintext = helper_decrypt_response(
        &axum::body::to_bytes(resp1.into_body(), usize::MAX)
            .await
            .unwrap(),
        &key1,
    );
    assert_eq!(err1.error, "domain_blocked");
    assert_eq!(err1.message, "Domain is blocked by the operator");
    assert!(!err1.message.contains("deny-me.com")); // Conceals domain in response

    // 2. Subdomain match on blocked domain
    let req_payload2 = json!({
        "url": "https://api.sub.deny-me.com/path",
        "method": "GET",
        "extension_id": "ext_block",
        "request_id": "req_b2"
    });
    let (body2, key2) = helper_encrypt_request(server_pubkey_b64, &req_payload2);
    let req2 = axum::http::Request::builder()
        .method("POST")
        .uri("/api/v1/extensions/proxy")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/octet-stream")
        .body(axum::body::Body::from(body2))
        .unwrap();
    let resp2 = tower::ServiceExt::oneshot(app.clone(), req2).await.unwrap();
    assert_eq!(resp2.status(), StatusCode::BAD_REQUEST);

    let err2: ExtensionErrorPlaintext = helper_decrypt_response(
        &axum::body::to_bytes(resp2.into_body(), usize::MAX)
            .await
            .unwrap(),
        &key2,
    );
    assert_eq!(err2.error, "domain_blocked");

    // 3. SSRF guard check takes precedence before blocklist check: 127.0.0.1 returns url_blocked
    let req_payload3 = json!({
        "url": "https://127.0.0.1/path",
        "method": "GET",
        "extension_id": "ext_block",
        "request_id": "req_b3"
    });
    let (body3, key3) = helper_encrypt_request(server_pubkey_b64, &req_payload3);
    let req3 = axum::http::Request::builder()
        .method("POST")
        .uri("/api/v1/extensions/proxy")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/octet-stream")
        .body(axum::body::Body::from(body3))
        .unwrap();
    let resp3 = tower::ServiceExt::oneshot(app.clone(), req3).await.unwrap();
    assert_eq!(resp3.status(), StatusCode::BAD_REQUEST);

    let err3: ExtensionErrorPlaintext = helper_decrypt_response(
        &axum::body::to_bytes(resp3.into_body(), usize::MAX)
            .await
            .unwrap(),
        &key3,
    );
    assert_eq!(err3.error, "url_blocked");
}

#[tokio::test]
async fn test_admin_reload_blocklist_endpoint() {
    let temp_dir = tempfile::tempdir().unwrap();
    let file_path = temp_dir.path().join("reload_deny.txt");
    std::fs::write(&file_path, "blocked1.com\n").unwrap();

    let (app, pool, _) = setup_test_app_with_custom_config(|c| {
        c.extension_proxy_enabled = true;
        c.link_preview_proxy_enabled = true;
        c.extension_proxy_deny_domains_path = file_path.to_str().unwrap().to_string();
    })
    .await;

    // 1st registered user becomes owner during bootstrap
    let _owner_id = register_user(&app, "owner_user", "Password123!", None).await;

    let test_cfg = server::Config::test_default();

    // 2nd registered user gets default member role (non-admin)
    let invite1 = server::create_invite(&pool, &_owner_id, Default::default(), &test_cfg)
        .await
        .unwrap();
    let _member_id = register_user(&app, "member_user", "Password123!", Some(&invite1.code)).await;
    let (_, member_login) = common::login_user(
        &app,
        "member_user",
        "Password123!",
        "client_member_123",
        None,
    )
    .await;
    let member_token = member_login["session_token"].as_str().unwrap();

    // 3rd registered user promoted to admin
    let invite2 = server::create_invite(&pool, &_owner_id, Default::default(), &test_cfg)
        .await
        .unwrap();
    let admin_id = register_user(&app, "admin_user", "Password123!", Some(&invite2.code)).await;
    server::roles::grant_role(&pool, &admin_id, "admin", None)
        .await
        .unwrap();
    let (admin_status, admin_login) =
        common::login_user(&app, "admin_user", "Password123!", "client_admin_123", None).await;
    assert_eq!(
        admin_status,
        StatusCode::OK,
        "admin login failed: {:?}",
        admin_login
    );
    let admin_token = admin_login["session_token"].as_str().unwrap();

    // 1. Non-admin member reload fails with 403
    let req_member = axum::http::Request::builder()
        .method("POST")
        .uri("/api/v1/admin/extension-proxy/reload-blocklist")
        .header(header::AUTHORIZATION, format!("Bearer {}", member_token))
        .body(axum::body::Body::empty())
        .unwrap();
    let resp_member = tower::ServiceExt::oneshot(app.clone(), req_member)
        .await
        .unwrap();
    assert_eq!(resp_member.status(), StatusCode::FORBIDDEN);

    // 2. Admin reload succeeds
    let req_admin = axum::http::Request::builder()
        .method("POST")
        .uri("/api/v1/admin/extension-proxy/reload-blocklist")
        .header(header::AUTHORIZATION, format!("Bearer {}", admin_token))
        .body(axum::body::Body::empty())
        .unwrap();
    let resp_admin = tower::ServiceExt::oneshot(app.clone(), req_admin)
        .await
        .unwrap();
    assert_eq!(resp_admin.status(), StatusCode::OK);
    let reload_json: Value = serde_json::from_slice(
        &axum::body::to_bytes(resp_admin.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(reload_json["reloaded"], true);
    assert_eq!(reload_json["suffix_count"], 1);

    // 3. Update file content and reload again
    std::fs::write(&file_path, "blocked1.com\nblocked2.com\n").unwrap();

    let req_admin2 = axum::http::Request::builder()
        .method("POST")
        .uri("/api/v1/admin/extension-proxy/reload-blocklist")
        .header(header::AUTHORIZATION, format!("Bearer {}", admin_token))
        .body(axum::body::Body::empty())
        .unwrap();
    let resp_admin2 = tower::ServiceExt::oneshot(app.clone(), req_admin2)
        .await
        .unwrap();
    assert_eq!(resp_admin2.status(), StatusCode::OK);
    let reload_json2: Value = serde_json::from_slice(
        &axum::body::to_bytes(resp_admin2.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(reload_json2["suffix_count"], 2);

    // 4. Missing file error returns 400 blocklist_file_not_found
    std::fs::remove_file(&file_path).unwrap();

    let req_admin3 = axum::http::Request::builder()
        .method("POST")
        .uri("/api/v1/admin/extension-proxy/reload-blocklist")
        .header(header::AUTHORIZATION, format!("Bearer {}", admin_token))
        .body(axum::body::Body::empty())
        .unwrap();
    let resp_admin3 = tower::ServiceExt::oneshot(app, req_admin3).await.unwrap();
    assert_eq!(resp_admin3.status(), StatusCode::BAD_REQUEST);
    let err_json: Value = serde_json::from_slice(
        &axum::body::to_bytes(resp_admin3.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(err_json["error"], "blocklist_file_not_found");
}

#[tokio::test]
async fn test_hourly_audit_aggregation_logic() {
    let (app, pool, _) = setup_test_app_with_custom_config(|c| {
        c.extension_proxy_enabled = true;
        c.link_preview_proxy_enabled = true;
    })
    .await;

    let user_id = register_user(&app, "audit_user", "Password123!", None).await;

    let boundary = "2026-10-04-12";
    let key1 = format!("extension_proxy:{}:rss_ext:hour:{}", user_id, boundary);
    let key2 = format!("extension_proxy:{}:weather_ext:hour:{}", user_id, boundary);

    // Insert rate limit counts for closed hour window directly
    sqlx::query(
        "INSERT INTO rate_limits (key, window_start, count) VALUES (?, CURRENT_TIMESTAMP, 42)",
    )
    .bind(&key1)
    .execute(&pool)
    .await
    .unwrap();

    sqlx::query(
        "INSERT INTO rate_limits (key, window_start, count) VALUES (?, CURRENT_TIMESTAMP, 15)",
    )
    .bind(&key2)
    .execute(&pool)
    .await
    .unwrap();

    // Trigger aggregation for boundary
    let written =
        server::extensions_proxy::audit_task::aggregate_extension_proxy_audit_for_boundary(
            &pool, boundary,
        )
        .await
        .unwrap();

    assert_eq!(written, 2);

    // Verify audit_log entries
    let entries = server::audit::list(
        &pool,
        server::audit::AuditFilter {
            actor_id: Some(user_id.clone()),
            action: Some("extension.proxy_request".to_string()),
            ..Default::default()
        },
        1,
        10,
    )
    .await
    .unwrap();

    assert_eq!(entries.len(), 2);
    let counts: Vec<u64> = entries
        .iter()
        .map(|e| {
            e.metadata.as_ref().unwrap()["request_count"]
                .as_u64()
                .unwrap()
        })
        .collect();
    assert!(counts.contains(&42));
    assert!(counts.contains(&15));
}
