mod common;

use axum::{
    body::Body,
    http::{header, Request, StatusCode},
};
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use common::{login_user, register_user, setup_test_app};
use serde_json::{json, Value};
use server::altcha::AltchaConfig;
use server::config::Config;
use server::login::LoginStore;
use server::opaque::OpaqueServer;
use server::registration::RegistrationStore;
use server::routes;
use server::AppState;
use std::sync::Arc;
use tower::ServiceExt;

const CLIENT_A: &str = "client_a_123456789";
const CLIENT_B: &str = "client_b_123456789";

fn dummy_kp_b64() -> String {
    STANDARD.encode(b"dummy_key_package_data_for_test")
}

#[tokio::test]
async fn test_01_upload_single_package() {
    let (app, pool) = setup_test_app().await;

    let user_id = register_user(&app, "alice", "password123", None).await;
    let (_, login_body) = login_user(&app, "alice", "password123", CLIENT_A, None).await;
    let token = login_body["session_token"].as_str().unwrap();

    let req_payload = json!({
        "packages": [
            {
                "client_id": CLIENT_A,
                "cipher_suite": 1,
                "key_package_data": dummy_kp_b64(),
                "is_last_resort": false
            }
        ]
    });

    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/keypackages")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(req_payload.to_string()))
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED);

    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let body: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(body["uploaded"], 1);
    assert_eq!(body["unconsumed_count"], 1);

    let count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM key_packages WHERE user_id = ? AND consumed = 0")
            .bind(&user_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(count, 1);
}

#[tokio::test]
async fn test_02_upload_multiple_packages() {
    let (app, _pool) = setup_test_app().await;

    register_user(&app, "alice", "password123", None).await;
    let (_, login_body) = login_user(&app, "alice", "password123", CLIENT_A, None).await;
    let token = login_body["session_token"].as_str().unwrap();

    let packages: Vec<Value> = (0..5)
        .map(|_| {
            json!({
                "client_id": CLIENT_A,
                "cipher_suite": 1,
                "key_package_data": dummy_kp_b64(),
                "is_last_resort": false
            })
        })
        .collect();

    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/keypackages")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "packages": packages }).to_string()))
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED);

    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let body: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(body["uploaded"], 5);
    assert_eq!(body["unconsumed_count"], 5);
}

#[tokio::test]
async fn test_03_upload_batch_cap() {
    let (app, _pool) = setup_test_app().await;

    register_user(&app, "alice", "password123", None).await;
    let (_, login_body) = login_user(&app, "alice", "password123", CLIENT_A, None).await;
    let token = login_body["session_token"].as_str().unwrap();

    let packages: Vec<Value> = (0..51)
        .map(|_| {
            json!({
                "client_id": CLIENT_A,
                "cipher_suite": 1,
                "key_package_data": dummy_kp_b64(),
                "is_last_resort": false
            })
        })
        .collect();

    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/keypackages")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "packages": packages }).to_string()))
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn test_04_upload_rejects_empty_batch() {
    let (app, _pool) = setup_test_app().await;

    register_user(&app, "alice", "password123", None).await;
    let (_, login_body) = login_user(&app, "alice", "password123", CLIENT_A, None).await;
    let token = login_body["session_token"].as_str().unwrap();

    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/keypackages")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "packages": [] }).to_string()))
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn test_05_upload_rejects_unknown_client_id() {
    let (app, _pool) = setup_test_app().await;

    register_user(&app, "alice", "password123", None).await;
    let (_, login_body) = login_user(&app, "alice", "password123", CLIENT_A, None).await;
    let token = login_body["session_token"].as_str().unwrap();

    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/keypackages")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "packages": [
                    {
                        "client_id": CLIENT_B, // Not registered to user
                        "cipher_suite": 1,
                        "key_package_data": dummy_kp_b64(),
                        "is_last_resort": false
                    }
                ]
            })
            .to_string(),
        ))
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);

    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let body: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(body["error"], "unknown_client_id");
}

#[tokio::test]
async fn test_06_upload_quota_per_device() {
    let (app, pool) = setup_test_app().await;

    register_user(&app, "alice", "password123", None).await;
    let (_, login_body) = login_user(&app, "alice", "password123", CLIENT_A, None).await;
    let token = login_body["session_token"].as_str().unwrap();

    // Set instance limit keypackages_per_device = 5
    sqlx::query("INSERT OR REPLACE INTO instance_limits (key, value) VALUES ('keypackages_per_device', '5')")
        .execute(&pool)
        .await
        .unwrap();

    // Upload 5 packages
    let pkgs_5: Vec<Value> = (0..5)
        .map(|_| {
            json!({
                "client_id": CLIENT_A,
                "cipher_suite": 1,
                "key_package_data": dummy_kp_b64()
            })
        })
        .collect();

    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/keypackages")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "packages": pkgs_5 }).to_string()))
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED);

    // Try uploading 1 more -> 409 quota_exceeded
    let req2 = Request::builder()
        .method("POST")
        .uri("/api/v1/keypackages")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "packages": [
                    {
                        "client_id": CLIENT_A,
                        "cipher_suite": 1,
                        "key_package_data": dummy_kp_b64()
                    }
                ]
            })
            .to_string(),
        ))
        .unwrap();

    let resp2 = app.clone().oneshot(req2).await.unwrap();
    assert_eq!(resp2.status(), StatusCode::CONFLICT);

    let body_bytes = axum::body::to_bytes(resp2.into_body(), usize::MAX)
        .await
        .unwrap();
    let body: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(body["error"], "quota_exceeded");
}

#[tokio::test]
async fn test_07_upload_quota_per_device_is_independent() {
    let (app, pool) = setup_test_app().await;

    register_user(&app, "alice", "password123", None).await;
    login_user(&app, "alice", "password123", CLIENT_A, None).await;
    let (_, login_body_b) = login_user(&app, "alice", "password123", CLIENT_B, None).await;
    let token = login_body_b["session_token"].as_str().unwrap();

    sqlx::query("INSERT OR REPLACE INTO instance_limits (key, value) VALUES ('keypackages_per_device', '5')")
        .execute(&pool)
        .await
        .unwrap();

    // Upload 5 for CLIENT_A and 5 for CLIENT_B in one request
    let mut packages = Vec::new();
    for _ in 0..5 {
        packages.push(json!({
            "client_id": CLIENT_A,
            "cipher_suite": 1,
            "key_package_data": dummy_kp_b64()
        }));
        packages.push(json!({
            "client_id": CLIENT_B,
            "cipher_suite": 1,
            "key_package_data": dummy_kp_b64()
        }));
    }

    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/keypackages")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "packages": packages }).to_string()))
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED);

    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let body: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(body["uploaded"], 10);
    assert_eq!(body["unconsumed_count"], 10);
}

#[tokio::test]
async fn test_08_upload_quota_clamps_to_server_max() {
    let pool = common::setup_test_db().await;

    let temp_dir = tempfile::tempdir().expect("Failed to create tempdir");
    let key_path = temp_dir.path().join("oprf.key");
    let opaque_server = Arc::new(OpaqueServer::load_or_generate(&key_path).unwrap());
    let registration_store = Arc::new(RegistrationStore::new());
    let login_store = Arc::new(LoginStore::new());

    let config = Config {
        opaque_oprf_key_path: key_path.to_str().unwrap().to_string(),
        altcha_enabled: true,
        altcha_hmac_secret: "auto".to_string(),
        altcha_cost: 100,
        cleanup_enabled: true,
        cleanup_startup_delay_secs: 30,
        ..Config::test_default()
    };

    let altcha_config = Arc::new(AltchaConfig::from_env(&config, &pool).await.unwrap());
    let config_arc = Arc::new(config);

    // Set server hard max = 50 for keypackages_per_device
    let server_hard_max = Arc::new(server::ServerHardMax {
        file_size_bytes: config_arc.max_file_size_bytes as i64,
        room_size: 1000,
        rooms_per_user: 500,
        devices_per_user: 20,
        keypackages_per_device: 50,
        message_size_bytes: 65536,
        attachment_retention_days: 365,
        call_max_participants: 50,
    });

    let sockudo_config = server::SockudoConfig {
        http_base: "http://localhost:6001".to_string(),
        app_id: "chat".to_string(),
        app_key: "test-key".to_string(),
        app_secret: "test-secret".to_string(),
        enable_client_events: true,
    };
    let storage = server::build_storage(&config_arc).expect("Failed to build storage");
    let publisher = Arc::new(server::Publisher::new(sockudo_config));

    let oprf_keys = server::oprf::OprfKeys::load(&opaque_server.setup).unwrap();
    let oprf = Arc::new(server::oprf::OprfEvaluator::new(&oprf_keys));
    let oprf_audit = Arc::new(server::oprf::OprfAuditCounter::new());

    let state = AppState {
        pool: pool.clone(),
        opaque_server,
        registration_store,
        login_store,
        altcha_config,
        config: config_arc,
        server_hard_max,
        publisher,
        storage,
        backup_lock: Arc::new(tokio::sync::Mutex::new(())),
        vapid_keys: None,
        push_delivery: None,
        oprf,
        oprf_audit,
    };

    let app = axum::Router::new()
        .route(
            "/api/v1/auth/register/challenge",
            axum::routing::get(routes::register::register_challenge),
        )
        .route(
            "/api/v1/auth/register/start",
            axum::routing::post(routes::register::register_start),
        )
        .route(
            "/api/v1/auth/register/finish",
            axum::routing::post(routes::register::register_finish),
        )
        .route(
            "/api/v1/auth/login/start",
            axum::routing::post(routes::login::login_start),
        )
        .route(
            "/api/v1/auth/login/finish",
            axum::routing::post(routes::login::login_finish),
        )
        .route(
            "/api/v1/keypackages",
            axum::routing::post(routes::key_packages::upload),
        )
        .with_state(state);

    register_user(&app, "alice", "password123", None).await;
    let (_, login_body) = login_user(&app, "alice", "password123", CLIENT_A, None).await;
    let token = login_body["session_token"].as_str().unwrap();

    // Set instance limit to 100 (exceeds server max 50)
    sqlx::query("INSERT OR REPLACE INTO instance_limits (key, value) VALUES ('keypackages_per_device', '100')")
        .execute(&pool)
        .await
        .unwrap();

    // Upload 50 packages -> success
    let pkgs_50: Vec<Value> = (0..50)
        .map(|_| {
            json!({
                "client_id": CLIENT_A,
                "cipher_suite": 1,
                "key_package_data": dummy_kp_b64()
            })
        })
        .collect();

    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/keypackages")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "packages": pkgs_50 }).to_string()))
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED);

    // Upload 1 more -> 409 because 50 is clamped hard max
    let req2 = Request::builder()
        .method("POST")
        .uri("/api/v1/keypackages")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "packages": [
                    {
                        "client_id": CLIENT_A,
                        "cipher_suite": 1,
                        "key_package_data": dummy_kp_b64()
                    }
                ]
            })
            .to_string(),
        ))
        .unwrap();

    let resp2 = app.clone().oneshot(req2).await.unwrap();
    assert_eq!(resp2.status(), StatusCode::CONFLICT);
}

#[tokio::test]
async fn test_09_upload_rejects_invalid_base64() {
    let (app, _pool) = setup_test_app().await;

    register_user(&app, "alice", "password123", None).await;
    let (_, login_body) = login_user(&app, "alice", "password123", CLIENT_A, None).await;
    let token = login_body["session_token"].as_str().unwrap();

    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/keypackages")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "packages": [
                    {
                        "client_id": CLIENT_A,
                        "cipher_suite": 1,
                        "key_package_data": "not base64!!!"
                    }
                ]
            })
            .to_string(),
        ))
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn test_10_upload_rejects_too_large_payload() {
    let (app, _pool) = setup_test_app().await;

    register_user(&app, "alice", "password123", None).await;
    let (_, login_body) = login_user(&app, "alice", "password123", CLIENT_A, None).await;
    let token = login_body["session_token"].as_str().unwrap();

    let large_data = vec![0u8; 65537];
    let large_b64 = STANDARD.encode(large_data);

    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/keypackages")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "packages": [
                    {
                        "client_id": CLIENT_A,
                        "cipher_suite": 1,
                        "key_package_data": large_b64
                    }
                ]
            })
            .to_string(),
        ))
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn test_11_upload_rejects_invalid_cipher_suite() {
    let (app, _pool) = setup_test_app().await;

    register_user(&app, "alice", "password123", None).await;
    let (_, login_body) = login_user(&app, "alice", "password123", CLIENT_A, None).await;
    let token = login_body["session_token"].as_str().unwrap();

    for cs in [0, 300] {
        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/keypackages")
            .header(header::AUTHORIZATION, format!("Bearer {}", token))
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(
                json!({
                    "packages": [
                        {
                            "client_id": CLIENT_A,
                            "cipher_suite": cs,
                            "key_package_data": dummy_kp_b64()
                        }
                    ]
                })
                .to_string(),
            ))
            .unwrap();

        let resp = app.clone().oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    }
}

#[tokio::test]
async fn test_12_upload_rejects_too_small_client_id() {
    let (app, _pool) = setup_test_app().await;

    register_user(&app, "alice", "password123", None).await;
    let (_, login_body) = login_user(&app, "alice", "password123", CLIENT_A, None).await;
    let token = login_body["session_token"].as_str().unwrap();

    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/keypackages")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "packages": [
                    {
                        "client_id": "abc",
                        "cipher_suite": 1,
                        "key_package_data": dummy_kp_b64()
                    }
                ]
            })
            .to_string(),
        ))
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn test_13_upload_rejects_control_characters_in_client_id() {
    let (app, _pool) = setup_test_app().await;

    register_user(&app, "alice", "password123", None).await;
    let (_, login_body) = login_user(&app, "alice", "password123", CLIENT_A, None).await;
    let token = login_body["session_token"].as_str().unwrap();

    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/keypackages")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "packages": [
                    {
                        "client_id": "abc_1234567890\ndef",
                        "cipher_suite": 1,
                        "key_package_data": dummy_kp_b64()
                    }
                ]
            })
            .to_string(),
        ))
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn test_14_upload_stores_is_last_resort_correctly() {
    let (app, pool) = setup_test_app().await;

    let user_id = register_user(&app, "alice", "password123", None).await;
    let (_, login_body) = login_user(&app, "alice", "password123", CLIENT_A, None).await;
    let token = login_body["session_token"].as_str().unwrap();

    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/keypackages")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "packages": [
                    {
                        "client_id": CLIENT_A,
                        "cipher_suite": 1,
                        "key_package_data": dummy_kp_b64(),
                        "is_last_resort": true
                    }
                ]
            })
            .to_string(),
        ))
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED);

    let is_last_resort: i64 =
        sqlx::query_scalar("SELECT is_last_resort FROM key_packages WHERE user_id = ?")
            .bind(&user_id)
            .fetch_one(&pool)
            .await
            .unwrap();

    assert_eq!(is_last_resort, 1);
}

#[tokio::test]
async fn test_15_count_returns_correct_total_and_by_client() {
    let (app, _pool) = setup_test_app().await;

    register_user(&app, "alice", "password123", None).await;
    login_user(&app, "alice", "password123", CLIENT_A, None).await;
    let (_, login_body_b) = login_user(&app, "alice", "password123", CLIENT_B, None).await;
    let token = login_body_b["session_token"].as_str().unwrap();

    let mut packages = Vec::new();
    for _ in 0..3 {
        packages.push(json!({
            "client_id": CLIENT_A,
            "cipher_suite": 1,
            "key_package_data": dummy_kp_b64()
        }));
    }
    for _ in 0..2 {
        packages.push(json!({
            "client_id": CLIENT_B,
            "cipher_suite": 1,
            "key_package_data": dummy_kp_b64()
        }));
    }

    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/keypackages")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "packages": packages }).to_string()))
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED);

    let req_count = Request::builder()
        .method("GET")
        .uri("/api/v1/keypackages/count")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .body(Body::empty())
        .unwrap();

    let resp_count = app.clone().oneshot(req_count).await.unwrap();
    assert_eq!(resp_count.status(), StatusCode::OK);

    let body_bytes = axum::body::to_bytes(resp_count.into_body(), usize::MAX)
        .await
        .unwrap();
    let body: Value = serde_json::from_slice(&body_bytes).unwrap();

    assert_eq!(body["total"], 5);
    assert_eq!(body["by_client"][CLIENT_A], 3);
    assert_eq!(body["by_client"][CLIENT_B], 2);
}

#[tokio::test]
async fn test_16_count_excludes_consumed() {
    let (app, pool) = setup_test_app().await;

    let target_id = register_user(&app, "alice", "password123", None).await;
    let (_, login_a) = login_user(&app, "alice", "password123", CLIENT_A, None).await;
    let token_a = login_a["session_token"].as_str().unwrap();

    sqlx::query(
        "INSERT INTO server_invites (id, code, max_uses, current_uses) VALUES ('inv_1', 'INVITE123', 1, 0)",
    )
    .execute(&pool)
    .await
    .unwrap();

    register_user(&app, "bob", "password123", Some("INVITE123")).await;
    let (_, login_b) = login_user(&app, "bob", "password123", CLIENT_B, None).await;
    let token_b = login_b["session_token"].as_str().unwrap();

    // Alice uploads 3 packages
    let pkgs: Vec<Value> = (0..3)
        .map(|_| {
            json!({
                "client_id": CLIENT_A,
                "cipher_suite": 1,
                "key_package_data": dummy_kp_b64()
            })
        })
        .collect();

    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/keypackages")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "packages": pkgs }).to_string()))
        .unwrap();

    app.clone().oneshot(req).await.unwrap();

    // Bob claims one of Alice's packages
    let req_claim = Request::builder()
        .method("POST")
        .uri("/api/v1/keypackages/claim")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_b))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "user_id": target_id }).to_string()))
        .unwrap();

    let resp_claim = app.clone().oneshot(req_claim).await.unwrap();
    assert_eq!(resp_claim.status(), StatusCode::OK);

    // Alice checks count -> returns 2
    let req_count = Request::builder()
        .method("GET")
        .uri("/api/v1/keypackages/count")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();

    let resp_count = app.clone().oneshot(req_count).await.unwrap();
    assert_eq!(resp_count.status(), StatusCode::OK);

    let body_bytes = axum::body::to_bytes(resp_count.into_body(), usize::MAX)
        .await
        .unwrap();
    let body: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(body["total"], 2);
}

#[tokio::test]
async fn test_17_count_is_zero_for_fresh_user() {
    let (app, _pool) = setup_test_app().await;

    register_user(&app, "alice", "password123", None).await;
    let (_, login_a) = login_user(&app, "alice", "password123", CLIENT_A, None).await;
    let token_a = login_a["session_token"].as_str().unwrap();

    let req_count = Request::builder()
        .method("GET")
        .uri("/api/v1/keypackages/count")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();

    let resp_count = app.clone().oneshot(req_count).await.unwrap();
    assert_eq!(resp_count.status(), StatusCode::OK);

    let body_bytes = axum::body::to_bytes(resp_count.into_body(), usize::MAX)
        .await
        .unwrap();
    let body: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(body["total"], 0);
    assert!(body["by_client"].as_object().unwrap().is_empty());
}

#[tokio::test]
async fn test_18_claim_returns_oldest_package() {
    let (app, pool) = setup_test_app().await;

    let target_id = register_user(&app, "alice", "password123", None).await;
    let (_, login_a) = login_user(&app, "alice", "password123", CLIENT_A, None).await;
    let token_a = login_a["session_token"].as_str().unwrap();

    sqlx::query(
        "INSERT INTO server_invites (id, code, max_uses, current_uses) VALUES ('inv_1', 'INVITE123', 1, 0)",
    )
    .execute(&pool)
    .await
    .unwrap();

    register_user(&app, "bob", "password123", Some("INVITE123")).await;
    let (_, login_b) = login_user(&app, "bob", "password123", CLIENT_B, None).await;
    let token_b = login_b["session_token"].as_str().unwrap();

    // Upload 3 packages sequentially
    for i in 1..=3 {
        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/keypackages")
            .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(
                json!({
                    "packages": [
                        {
                            "client_id": CLIENT_A,
                            "cipher_suite": i,
                            "key_package_data": dummy_kp_b64()
                        }
                    ]
                })
                .to_string(),
            ))
            .unwrap();

        let resp = app.clone().oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::CREATED);
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }

    // Get the oldest package ID directly from DB
    let oldest_id: String = sqlx::query_scalar(
        "SELECT id FROM key_packages WHERE user_id = ? ORDER BY created_at ASC, id ASC LIMIT 1",
    )
    .bind(&target_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    // Bob claims
    let req_claim = Request::builder()
        .method("POST")
        .uri("/api/v1/keypackages/claim")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_b))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "user_id": target_id }).to_string()))
        .unwrap();

    let resp_claim = app.clone().oneshot(req_claim).await.unwrap();
    assert_eq!(resp_claim.status(), StatusCode::OK);

    let body_bytes = axum::body::to_bytes(resp_claim.into_body(), usize::MAX)
        .await
        .unwrap();
    let claimed: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(claimed["id"], oldest_id);
    assert_eq!(claimed["cipher_suite"], 1);
}

#[tokio::test]
async fn test_19_claim_marks_package_consumed() {
    let (app, pool) = setup_test_app().await;

    let target_id = register_user(&app, "alice", "password123", None).await;
    let (_, login_a) = login_user(&app, "alice", "password123", CLIENT_A, None).await;
    let token_a = login_a["session_token"].as_str().unwrap();

    sqlx::query(
        "INSERT INTO server_invites (id, code, max_uses, current_uses) VALUES ('inv_1', 'INVITE123', 1, 0)",
    )
    .execute(&pool)
    .await
    .unwrap();

    register_user(&app, "bob", "password123", Some("INVITE123")).await;
    let (_, login_b) = login_user(&app, "bob", "password123", CLIENT_B, None).await;
    let token_b = login_b["session_token"].as_str().unwrap();

    // Upload 1 package
    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/keypackages")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "packages": [
                    {
                        "client_id": CLIENT_A,
                        "cipher_suite": 1,
                        "key_package_data": dummy_kp_b64()
                    }
                ]
            })
            .to_string(),
        ))
        .unwrap();

    app.clone().oneshot(req).await.unwrap();

    // Claim
    let req_claim = Request::builder()
        .method("POST")
        .uri("/api/v1/keypackages/claim")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_b))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "user_id": target_id }).to_string()))
        .unwrap();

    let resp_claim = app.clone().oneshot(req_claim).await.unwrap();
    assert_eq!(resp_claim.status(), StatusCode::OK);

    let body_bytes = axum::body::to_bytes(resp_claim.into_body(), usize::MAX)
        .await
        .unwrap();
    let claimed: Value = serde_json::from_slice(&body_bytes).unwrap();
    let pkg_id = claimed["id"].as_str().unwrap();

    // Assert consumed = 1 and consumed_at IS NOT NULL
    let (consumed, consumed_at): (i64, Option<String>) =
        sqlx::query_as("SELECT consumed, consumed_at FROM key_packages WHERE id = ?")
            .bind(pkg_id)
            .fetch_one(&pool)
            .await
            .unwrap();

    assert_eq!(consumed, 1);
    assert!(consumed_at.is_some());
}

#[tokio::test]
async fn test_20_claim_from_empty_pool_returns_404() {
    let (app, pool) = setup_test_app().await;

    let target_id = register_user(&app, "alice", "password123", None).await;

    sqlx::query(
        "INSERT INTO server_invites (id, code, max_uses, current_uses) VALUES ('inv_1', 'INVITE123', 1, 0)",
    )
    .execute(&pool)
    .await
    .unwrap();

    register_user(&app, "bob", "password123", Some("INVITE123")).await;
    let (_, login_b) = login_user(&app, "bob", "password123", CLIENT_B, None).await;
    let token_b = login_b["session_token"].as_str().unwrap();

    // Bob claims for Alice who has no packages
    let req_claim = Request::builder()
        .method("POST")
        .uri("/api/v1/keypackages/claim")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_b))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "user_id": target_id }).to_string()))
        .unwrap();

    let resp_claim = app.clone().oneshot(req_claim).await.unwrap();
    assert_eq!(resp_claim.status(), StatusCode::NOT_FOUND);

    let body_bytes = axum::body::to_bytes(resp_claim.into_body(), usize::MAX)
        .await
        .unwrap();
    let body: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(body["error"], "no_packages_available");
}

#[tokio::test]
async fn test_21_claim_for_unknown_user_returns_404() {
    let (app, _pool) = setup_test_app().await;

    register_user(&app, "alice", "password123", None).await;
    let (_, login_a) = login_user(&app, "alice", "password123", CLIENT_A, None).await;
    let token_a = login_a["session_token"].as_str().unwrap();

    let req_claim = Request::builder()
        .method("POST")
        .uri("/api/v1/keypackages/claim")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({ "user_id": "non_existent_user_id" }).to_string(),
        ))
        .unwrap();

    let resp_claim = app.clone().oneshot(req_claim).await.unwrap();
    assert_eq!(resp_claim.status(), StatusCode::NOT_FOUND);

    let body_bytes = axum::body::to_bytes(resp_claim.into_body(), usize::MAX)
        .await
        .unwrap();
    let body: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(body["error"], "user_not_found");
}

#[tokio::test]
async fn test_22_claim_for_deleted_user_returns_404() {
    let (app, pool) = setup_test_app().await;

    let target_id = register_user(&app, "alice", "password123", None).await;
    let (_, login_a) = login_user(&app, "alice", "password123", CLIENT_A, None).await;
    let token_a = login_a["session_token"].as_str().unwrap();

    sqlx::query(
        "INSERT INTO server_invites (id, code, max_uses, current_uses) VALUES ('inv_1', 'INVITE123', 1, 0)",
    )
    .execute(&pool)
    .await
    .unwrap();

    register_user(&app, "bob", "password123", Some("INVITE123")).await;
    let (_, login_b) = login_user(&app, "bob", "password123", CLIENT_B, None).await;
    let token_b = login_b["session_token"].as_str().unwrap();

    // Alice uploads a package
    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/keypackages")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "packages": [
                    {
                        "client_id": CLIENT_A,
                        "cipher_suite": 1,
                        "key_package_data": dummy_kp_b64()
                    }
                ]
            })
            .to_string(),
        ))
        .unwrap();

    app.clone().oneshot(req).await.unwrap();

    // Delete Alice's user account
    sqlx::query("UPDATE users SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?")
        .bind(&target_id)
        .execute(&pool)
        .await
        .unwrap();

    // Bob tries to claim for Alice -> 404 user_not_found
    let req_claim = Request::builder()
        .method("POST")
        .uri("/api/v1/keypackages/claim")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_b))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "user_id": target_id }).to_string()))
        .unwrap();

    let resp_claim = app.clone().oneshot(req_claim).await.unwrap();
    assert_eq!(resp_claim.status(), StatusCode::NOT_FOUND);

    let body_bytes = axum::body::to_bytes(resp_claim.into_body(), usize::MAX)
        .await
        .unwrap();
    let body: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(body["error"], "user_not_found");
}

#[tokio::test]
async fn test_23_two_claims_return_different_packages() {
    let (app, pool) = setup_test_app().await;

    let target_id = register_user(&app, "alice", "password123", None).await;
    let (_, login_a) = login_user(&app, "alice", "password123", CLIENT_A, None).await;
    let token_a = login_a["session_token"].as_str().unwrap();

    sqlx::query(
        "INSERT INTO server_invites (id, code, max_uses, current_uses) VALUES ('inv_1', 'INVITE123', 1, 0)",
    )
    .execute(&pool)
    .await
    .unwrap();

    register_user(&app, "bob", "password123", Some("INVITE123")).await;
    let (_, login_b) = login_user(&app, "bob", "password123", CLIENT_B, None).await;
    let token_b = login_b["session_token"].as_str().unwrap();

    // Upload 2 packages
    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/keypackages")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "packages": [
                    {
                        "client_id": CLIENT_A,
                        "cipher_suite": 1,
                        "key_package_data": dummy_kp_b64()
                    },
                    {
                        "client_id": CLIENT_A,
                        "cipher_suite": 2,
                        "key_package_data": dummy_kp_b64()
                    }
                ]
            })
            .to_string(),
        ))
        .unwrap();

    app.clone().oneshot(req).await.unwrap();

    // Claim 1
    let req_claim1 = Request::builder()
        .method("POST")
        .uri("/api/v1/keypackages/claim")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_b))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "user_id": target_id }).to_string()))
        .unwrap();

    let resp1 = app.clone().oneshot(req_claim1).await.unwrap();
    assert_eq!(resp1.status(), StatusCode::OK);
    let bytes1 = axum::body::to_bytes(resp1.into_body(), usize::MAX)
        .await
        .unwrap();
    let json1: Value = serde_json::from_slice(&bytes1).unwrap();

    // Claim 2
    let req_claim2 = Request::builder()
        .method("POST")
        .uri("/api/v1/keypackages/claim")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_b))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "user_id": target_id }).to_string()))
        .unwrap();

    let resp2 = app.clone().oneshot(req_claim2).await.unwrap();
    assert_eq!(resp2.status(), StatusCode::OK);
    let bytes2 = axum::body::to_bytes(resp2.into_body(), usize::MAX)
        .await
        .unwrap();
    let json2: Value = serde_json::from_slice(&bytes2).unwrap();

    assert_ne!(json1["id"], json2["id"]);
}

#[tokio::test]
async fn test_24_concurrent_claims_return_different_packages() {
    let (app, pool) = setup_test_app().await;

    let target_id = register_user(&app, "alice", "password123", None).await;
    let (_, login_a) = login_user(&app, "alice", "password123", CLIENT_A, None).await;
    let token_a = login_a["session_token"].as_str().unwrap();

    sqlx::query(
        "INSERT INTO server_invites (id, code, max_uses, current_uses) VALUES ('inv_1', 'INVITE123', 1, 0)",
    )
    .execute(&pool)
    .await
    .unwrap();

    register_user(&app, "bob", "password123", Some("INVITE123")).await;
    let (_, login_b) = login_user(&app, "bob", "password123", CLIENT_B, None).await;
    let token_b = login_b["session_token"].as_str().unwrap();

    // Upload 2 packages
    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/keypackages")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "packages": [
                    {
                        "client_id": CLIENT_A,
                        "cipher_suite": 1,
                        "key_package_data": dummy_kp_b64()
                    },
                    {
                        "client_id": CLIENT_A,
                        "cipher_suite": 2,
                        "key_package_data": dummy_kp_b64()
                    }
                ]
            })
            .to_string(),
        ))
        .unwrap();

    app.clone().oneshot(req).await.unwrap();

    // Perform two claims concurrently
    let app1 = app.clone();
    let app2 = app.clone();
    let token_b1 = token_b.to_string();
    let token_b2 = token_b.to_string();
    let target_id1 = target_id.clone();
    let target_id2 = target_id.clone();

    let task1 = tokio::spawn(async move {
        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/keypackages/claim")
            .header(header::AUTHORIZATION, format!("Bearer {}", token_b1))
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(json!({ "user_id": target_id1 }).to_string()))
            .unwrap();
        app1.oneshot(req).await.unwrap()
    });

    let task2 = tokio::spawn(async move {
        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/keypackages/claim")
            .header(header::AUTHORIZATION, format!("Bearer {}", token_b2))
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(json!({ "user_id": target_id2 }).to_string()))
            .unwrap();
        app2.oneshot(req).await.unwrap()
    });

    let (resp1, resp2) = tokio::join!(task1, task2);
    let r1 = resp1.unwrap();
    let r2 = resp2.unwrap();

    assert_eq!(r1.status(), StatusCode::OK);
    assert_eq!(r2.status(), StatusCode::OK);

    let b1 = axum::body::to_bytes(r1.into_body(), usize::MAX)
        .await
        .unwrap();
    let b2 = axum::body::to_bytes(r2.into_body(), usize::MAX)
        .await
        .unwrap();

    let json1: Value = serde_json::from_slice(&b1).unwrap();
    let json2: Value = serde_json::from_slice(&b2).unwrap();

    assert_ne!(json1["id"], json2["id"]);
}

#[tokio::test]
async fn test_25_concurrent_claims_on_single_package() {
    let (app, pool) = setup_test_app().await;

    let target_id = register_user(&app, "alice", "password123", None).await;
    let (_, login_a) = login_user(&app, "alice", "password123", CLIENT_A, None).await;
    let token_a = login_a["session_token"].as_str().unwrap();

    sqlx::query(
        "INSERT INTO server_invites (id, code, max_uses, current_uses) VALUES ('inv_1', 'INVITE123', 1, 0)",
    )
    .execute(&pool)
    .await
    .unwrap();

    register_user(&app, "bob", "password123", Some("INVITE123")).await;
    let (_, login_b) = login_user(&app, "bob", "password123", CLIENT_B, None).await;
    let token_b = login_b["session_token"].as_str().unwrap();

    // Upload 1 package
    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/keypackages")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "packages": [
                    {
                        "client_id": CLIENT_A,
                        "cipher_suite": 1,
                        "key_package_data": dummy_kp_b64()
                    }
                ]
            })
            .to_string(),
        ))
        .unwrap();

    app.clone().oneshot(req).await.unwrap();

    let app1 = app.clone();
    let app2 = app.clone();
    let token_b1 = token_b.to_string();
    let token_b2 = token_b.to_string();
    let target_id1 = target_id.clone();
    let target_id2 = target_id.clone();

    let task1 = tokio::spawn(async move {
        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/keypackages/claim")
            .header(header::AUTHORIZATION, format!("Bearer {}", token_b1))
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(json!({ "user_id": target_id1 }).to_string()))
            .unwrap();
        app1.oneshot(req).await.unwrap()
    });

    let task2 = tokio::spawn(async move {
        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/keypackages/claim")
            .header(header::AUTHORIZATION, format!("Bearer {}", token_b2))
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(json!({ "user_id": target_id2 }).to_string()))
            .unwrap();
        app2.oneshot(req).await.unwrap()
    });

    let (resp1, resp2) = tokio::join!(task1, task2);
    let r1 = resp1.unwrap();
    let r2 = resp2.unwrap();

    let statuses = [r1.status(), r2.status()];
    assert!(statuses.contains(&StatusCode::OK));
    assert!(statuses.contains(&StatusCode::NOT_FOUND));
}

#[tokio::test]
async fn test_26_last_resort_package_can_be_claimed_multiple_times() {
    let (app, pool) = setup_test_app().await;

    let target_id = register_user(&app, "alice", "password123", None).await;
    let (_, login_a) = login_user(&app, "alice", "password123", CLIENT_A, None).await;
    let token_a = login_a["session_token"].as_str().unwrap();

    sqlx::query(
        "INSERT INTO server_invites (id, code, max_uses, current_uses) VALUES ('inv_1', 'INVITE123', 1, 0)",
    )
    .execute(&pool)
    .await
    .unwrap();

    register_user(&app, "bob", "password123", Some("INVITE123")).await;
    let (_, login_b) = login_user(&app, "bob", "password123", CLIENT_B, None).await;
    let token_b = login_b["session_token"].as_str().unwrap();

    // Alice uploads 1 last-resort package
    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/keypackages")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "packages": [
                    {
                        "client_id": CLIENT_A,
                        "cipher_suite": 1,
                        "key_package_data": dummy_kp_b64(),
                        "is_last_resort": true
                    }
                ]
            })
            .to_string(),
        ))
        .unwrap();

    app.clone().oneshot(req).await.unwrap();

    // Claim twice
    for _ in 0..2 {
        let req_claim = Request::builder()
            .method("POST")
            .uri("/api/v1/keypackages/claim")
            .header(header::AUTHORIZATION, format!("Bearer {}", token_b))
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(json!({ "user_id": target_id }).to_string()))
            .unwrap();

        let resp_claim = app.clone().oneshot(req_claim).await.unwrap();
        assert_eq!(resp_claim.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(resp_claim.into_body(), usize::MAX)
            .await
            .unwrap();
        let body: Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(body["is_last_resort"], true);
    }

    // Query DB: consumed remains 0
    let consumed: i64 = sqlx::query_scalar("SELECT consumed FROM key_packages WHERE user_id = ?")
        .bind(&target_id)
        .fetch_one(&pool)
        .await
        .unwrap();

    assert_eq!(consumed, 0);
}

#[tokio::test]
async fn test_27_last_resort_fallback_non_last_resort_preferred() {
    let (app, pool) = setup_test_app().await;

    let target_id = register_user(&app, "alice", "password123", None).await;
    let (_, login_a) = login_user(&app, "alice", "password123", CLIENT_A, None).await;
    let token_a = login_a["session_token"].as_str().unwrap();

    sqlx::query(
        "INSERT INTO server_invites (id, code, max_uses, current_uses) VALUES ('inv_1', 'INVITE123', 1, 0)",
    )
    .execute(&pool)
    .await
    .unwrap();

    register_user(&app, "bob", "password123", Some("INVITE123")).await;
    let (_, login_b) = login_user(&app, "bob", "password123", CLIENT_B, None).await;
    let token_b = login_b["session_token"].as_str().unwrap();

    // Alice uploads 1 last-resort package
    let req1 = Request::builder()
        .method("POST")
        .uri("/api/v1/keypackages")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "packages": [
                    {
                        "client_id": CLIENT_A,
                        "cipher_suite": 1,
                        "key_package_data": dummy_kp_b64(),
                        "is_last_resort": true
                    }
                ]
            })
            .to_string(),
        ))
        .unwrap();
    app.clone().oneshot(req1).await.unwrap();

    tokio::time::sleep(std::time::Duration::from_millis(10)).await;

    // Alice uploads 1 normal package later
    let req2 = Request::builder()
        .method("POST")
        .uri("/api/v1/keypackages")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "packages": [
                    {
                        "client_id": CLIENT_A,
                        "cipher_suite": 2,
                        "key_package_data": dummy_kp_b64(),
                        "is_last_resort": false
                    }
                ]
            })
            .to_string(),
        ))
        .unwrap();
    app.clone().oneshot(req2).await.unwrap();

    // Bob claims -> must return normal package (cipher_suite 2, is_last_resort false)
    let req_claim = Request::builder()
        .method("POST")
        .uri("/api/v1/keypackages/claim")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_b))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "user_id": target_id }).to_string()))
        .unwrap();

    let resp_claim = app.clone().oneshot(req_claim).await.unwrap();
    assert_eq!(resp_claim.status(), StatusCode::OK);

    let bytes = axum::body::to_bytes(resp_claim.into_body(), usize::MAX)
        .await
        .unwrap();
    let body: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(body["is_last_resort"], false);
    assert_eq!(body["cipher_suite"], 2);
}

#[tokio::test]
async fn test_28_rate_limit_per_minute_is_enforced() {
    let pool = common::setup_test_db().await;

    let temp_dir = tempfile::tempdir().expect("Failed to create tempdir");
    let key_path = temp_dir.path().join("oprf.key");
    let opaque_server = Arc::new(OpaqueServer::load_or_generate(&key_path).unwrap());
    let registration_store = Arc::new(RegistrationStore::new());
    let login_store = Arc::new(LoginStore::new());

    let config = Config {
        opaque_oprf_key_path: key_path.to_str().unwrap().to_string(),
        altcha_enabled: true,
        altcha_hmac_secret: "auto".to_string(),
        altcha_cost: 100,
        rate_limits: server::config::RateLimitConfig {
            kp_claim_per_min: 2,
            ..Config::test_default().rate_limits
        },
        cleanup_enabled: true,
        cleanup_startup_delay_secs: 30,
        ..Config::test_default()
    };

    let altcha_config = Arc::new(AltchaConfig::from_env(&config, &pool).await.unwrap());
    let config_arc = Arc::new(config);

    let sockudo_config = server::SockudoConfig {
        http_base: "http://localhost:6001".to_string(),
        app_id: "chat".to_string(),
        app_key: "test-key".to_string(),
        app_secret: "test-secret".to_string(),
        enable_client_events: true,
    };
    let storage = server::build_storage(&config_arc).expect("Failed to build storage");
    let publisher = Arc::new(server::Publisher::new(sockudo_config));

    let oprf_keys = server::oprf::OprfKeys::load(&opaque_server.setup).unwrap();
    let oprf = Arc::new(server::oprf::OprfEvaluator::new(&oprf_keys));
    let oprf_audit = Arc::new(server::oprf::OprfAuditCounter::new());

    let state = AppState {
        pool: pool.clone(),
        opaque_server,
        registration_store,
        login_store,
        altcha_config,
        config: config_arc,
        server_hard_max: Arc::new(server::ServerHardMax::default()),
        publisher,
        storage,
        backup_lock: Arc::new(tokio::sync::Mutex::new(())),
        vapid_keys: None,
        push_delivery: None,
        oprf,
        oprf_audit,
    };

    let app = axum::Router::new()
        .route(
            "/api/v1/auth/register/challenge",
            axum::routing::get(routes::register::register_challenge),
        )
        .route(
            "/api/v1/auth/register/start",
            axum::routing::post(routes::register::register_start),
        )
        .route(
            "/api/v1/auth/register/finish",
            axum::routing::post(routes::register::register_finish),
        )
        .route(
            "/api/v1/auth/login/start",
            axum::routing::post(routes::login::login_start),
        )
        .route(
            "/api/v1/auth/login/finish",
            axum::routing::post(routes::login::login_finish),
        )
        .route(
            "/api/v1/keypackages",
            axum::routing::post(routes::key_packages::upload),
        )
        .route(
            "/api/v1/keypackages/claim",
            axum::routing::post(routes::key_packages::claim),
        )
        .with_state(state);

    let target_id = register_user(&app, "alice", "password123", None).await;
    let (_, login_a) = login_user(&app, "alice", "password123", CLIENT_A, None).await;
    let token_a = login_a["session_token"].as_str().unwrap();

    sqlx::query(
        "INSERT INTO server_invites (id, code, max_uses, current_uses) VALUES ('inv_1', 'INVITE123', 1, 0)",
    )
    .execute(&pool)
    .await
    .unwrap();

    register_user(&app, "bob", "password123", Some("INVITE123")).await;
    let (_, login_b) = login_user(&app, "bob", "password123", CLIENT_B, None).await;
    let token_b = login_b["session_token"].as_str().unwrap();

    // Alice uploads 10 packages
    let pkgs: Vec<Value> = (0..10)
        .map(|_| {
            json!({
                "client_id": CLIENT_A,
                "cipher_suite": 1,
                "key_package_data": dummy_kp_b64()
            })
        })
        .collect();

    let req_upload = Request::builder()
        .method("POST")
        .uri("/api/v1/keypackages")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "packages": pkgs }).to_string()))
        .unwrap();
    app.clone().oneshot(req_upload).await.unwrap();

    // Bob claims twice (limit is 2)
    for _ in 0..2 {
        let req_claim = Request::builder()
            .method("POST")
            .uri("/api/v1/keypackages/claim")
            .header(header::AUTHORIZATION, format!("Bearer {}", token_b))
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(json!({ "user_id": target_id }).to_string()))
            .unwrap();

        let resp_claim = app.clone().oneshot(req_claim).await.unwrap();
        assert_eq!(resp_claim.status(), StatusCode::OK);
    }

    // 3rd claim -> HTTP 429 Too Many Requests
    let req_claim3 = Request::builder()
        .method("POST")
        .uri("/api/v1/keypackages/claim")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_b))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "user_id": target_id }).to_string()))
        .unwrap();

    let resp_claim3 = app.clone().oneshot(req_claim3).await.unwrap();
    assert_eq!(resp_claim3.status(), StatusCode::TOO_MANY_REQUESTS);

    let bytes = axum::body::to_bytes(resp_claim3.into_body(), usize::MAX)
        .await
        .unwrap();
    let body: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(body["error"], "rate_limited");
    assert!(body["details"]["reset_at"].is_string());
}

#[tokio::test]
async fn test_29_rate_limit_is_per_user_not_global() {
    let pool = common::setup_test_db().await;

    let temp_dir = tempfile::tempdir().expect("Failed to create tempdir");
    let key_path = temp_dir.path().join("oprf.key");
    let opaque_server = Arc::new(OpaqueServer::load_or_generate(&key_path).unwrap());
    let registration_store = Arc::new(RegistrationStore::new());
    let login_store = Arc::new(LoginStore::new());

    let config = Config {
        opaque_oprf_key_path: key_path.to_str().unwrap().to_string(),
        altcha_enabled: true,
        altcha_hmac_secret: "auto".to_string(),
        altcha_cost: 100,
        rate_limits: server::config::RateLimitConfig {
            kp_claim_per_min: 2,
            ..Config::test_default().rate_limits
        },
        cleanup_enabled: true,
        cleanup_startup_delay_secs: 30,
        ..Config::test_default()
    };

    let altcha_config = Arc::new(AltchaConfig::from_env(&config, &pool).await.unwrap());
    let config_arc = Arc::new(config);

    let sockudo_config = server::SockudoConfig {
        http_base: "http://localhost:6001".to_string(),
        app_id: "chat".to_string(),
        app_key: "test-key".to_string(),
        app_secret: "test-secret".to_string(),
        enable_client_events: true,
    };
    let storage = server::build_storage(&config_arc).expect("Failed to build storage");
    let publisher = Arc::new(server::Publisher::new(sockudo_config));

    let oprf_keys = server::oprf::OprfKeys::load(&opaque_server.setup).unwrap();
    let oprf = Arc::new(server::oprf::OprfEvaluator::new(&oprf_keys));
    let oprf_audit = Arc::new(server::oprf::OprfAuditCounter::new());

    let state = AppState {
        pool: pool.clone(),
        opaque_server,
        registration_store,
        login_store,
        altcha_config,
        config: config_arc,
        server_hard_max: Arc::new(server::ServerHardMax::default()),
        publisher,
        storage,
        backup_lock: Arc::new(tokio::sync::Mutex::new(())),
        vapid_keys: None,
        push_delivery: None,
        oprf,
        oprf_audit,
    };

    let app = axum::Router::new()
        .route(
            "/api/v1/auth/register/challenge",
            axum::routing::get(routes::register::register_challenge),
        )
        .route(
            "/api/v1/auth/register/start",
            axum::routing::post(routes::register::register_start),
        )
        .route(
            "/api/v1/auth/register/finish",
            axum::routing::post(routes::register::register_finish),
        )
        .route(
            "/api/v1/auth/login/start",
            axum::routing::post(routes::login::login_start),
        )
        .route(
            "/api/v1/auth/login/finish",
            axum::routing::post(routes::login::login_finish),
        )
        .route(
            "/api/v1/keypackages",
            axum::routing::post(routes::key_packages::upload),
        )
        .route(
            "/api/v1/keypackages/claim",
            axum::routing::post(routes::key_packages::claim),
        )
        .with_state(state);

    let target_id = register_user(&app, "alice", "password123", None).await;
    let (_, login_a) = login_user(&app, "alice", "password123", CLIENT_A, None).await;
    let token_a = login_a["session_token"].as_str().unwrap();

    sqlx::query(
        "INSERT INTO server_invites (id, code, max_uses, current_uses) VALUES ('inv_1', 'INVITE123', 2, 0)",
    )
    .execute(&pool)
    .await
    .unwrap();

    register_user(&app, "bob", "password123", Some("INVITE123")).await;
    let (_, login_b) = login_user(&app, "bob", "password123", CLIENT_B, None).await;
    let token_b = login_b["session_token"].as_str().unwrap();

    register_user(&app, "charlie", "password123", Some("INVITE123")).await;
    let (_, login_c) = login_user(&app, "charlie", "password123", "client_c_123456789", None).await;
    let token_c = login_c["session_token"].as_str().unwrap();

    // Alice uploads 10 packages
    let pkgs: Vec<Value> = (0..10)
        .map(|_| {
            json!({
                "client_id": CLIENT_A,
                "cipher_suite": 1,
                "key_package_data": dummy_kp_b64()
            })
        })
        .collect();

    let req_upload = Request::builder()
        .method("POST")
        .uri("/api/v1/keypackages")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "packages": pkgs }).to_string()))
        .unwrap();
    app.clone().oneshot(req_upload).await.unwrap();

    // Bob claims 2 times -> hits limit
    for _ in 0..2 {
        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/keypackages/claim")
            .header(header::AUTHORIZATION, format!("Bearer {}", token_b))
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(json!({ "user_id": target_id }).to_string()))
            .unwrap();
        app.clone().oneshot(req).await.unwrap();
    }

    // Bob 3rd claim -> 429
    let req_bob = Request::builder()
        .method("POST")
        .uri("/api/v1/keypackages/claim")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_b))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "user_id": target_id }).to_string()))
        .unwrap();
    let resp_bob = app.clone().oneshot(req_bob).await.unwrap();
    assert_eq!(resp_bob.status(), StatusCode::TOO_MANY_REQUESTS);

    // Charlie claims -> 200 OK (Charlie's limit is separate)
    let req_charlie = Request::builder()
        .method("POST")
        .uri("/api/v1/keypackages/claim")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_c))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "user_id": target_id }).to_string()))
        .unwrap();
    let resp_charlie = app.clone().oneshot(req_charlie).await.unwrap();
    assert_eq!(resp_charlie.status(), StatusCode::OK);
}

#[tokio::test]
async fn test_30_claim_does_not_consume_packages_for_claiming_user() {
    let (app, pool) = setup_test_app().await;

    let user_a_id = register_user(&app, "alice", "password123", None).await;
    let (_, login_a) = login_user(&app, "alice", "password123", CLIENT_A, None).await;
    let token_a = login_a["session_token"].as_str().unwrap();

    sqlx::query(
        "INSERT INTO server_invites (id, code, max_uses, current_uses) VALUES ('inv_1', 'INVITE123', 1, 0)",
    )
    .execute(&pool)
    .await
    .unwrap();

    register_user(&app, "bob", "password123", Some("INVITE123")).await;
    let (_, login_b) = login_user(&app, "bob", "password123", CLIENT_B, None).await;
    let token_b = login_b["session_token"].as_str().unwrap();

    // Alice uploads 3 packages
    let pkgs_a: Vec<Value> = (0..3)
        .map(|_| {
            json!({
                "client_id": CLIENT_A,
                "cipher_suite": 1,
                "key_package_data": dummy_kp_b64()
            })
        })
        .collect();
    let req_a = Request::builder()
        .method("POST")
        .uri("/api/v1/keypackages")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "packages": pkgs_a }).to_string()))
        .unwrap();
    app.clone().oneshot(req_a).await.unwrap();

    // Bob uploads 3 packages
    let pkgs_b: Vec<Value> = (0..3)
        .map(|_| {
            json!({
                "client_id": CLIENT_B,
                "cipher_suite": 1,
                "key_package_data": dummy_kp_b64()
            })
        })
        .collect();
    let req_b = Request::builder()
        .method("POST")
        .uri("/api/v1/keypackages")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_b))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "packages": pkgs_b }).to_string()))
        .unwrap();
    app.clone().oneshot(req_b).await.unwrap();

    // Bob claims 1 for Alice
    let req_claim = Request::builder()
        .method("POST")
        .uri("/api/v1/keypackages/claim")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_b))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "user_id": user_a_id }).to_string()))
        .unwrap();
    app.clone().oneshot(req_claim).await.unwrap();

    // Alice count -> 2
    let req_count_a = Request::builder()
        .method("GET")
        .uri("/api/v1/keypackages/count")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();
    let resp_a = app.clone().oneshot(req_count_a).await.unwrap();
    let bytes_a = axum::body::to_bytes(resp_a.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_a: Value = serde_json::from_slice(&bytes_a).unwrap();
    assert_eq!(json_a["total"], 2);

    // Bob count -> 3
    let req_count_b = Request::builder()
        .method("GET")
        .uri("/api/v1/keypackages/count")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_b))
        .body(Body::empty())
        .unwrap();
    let resp_b = app.clone().oneshot(req_count_b).await.unwrap();
    let bytes_b = axum::body::to_bytes(resp_b.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_b: Value = serde_json::from_slice(&bytes_b).unwrap();
    assert_eq!(json_b["total"], 3);
}
