mod common;

use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use axum::response::Response;
use common::{login_user, register_user, setup_test_app_with_custom_config};
use serde_json::Value;
use server::audit::{action, AuditFilter};
use std::fs;
use tempfile::TempDir;
use tower::ServiceExt;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

fn create_temp_model_dirs() -> (TempDir, TempDir, TempDir) {
    let storage_dir = TempDir::new().unwrap();
    let stt_dir = TempDir::new().unwrap();
    let tts_dir = TempDir::new().unwrap();
    (storage_dir, stt_dir, tts_dir)
}

fn write_stt_manifest(stt_path: &std::path::Path, content: &str) {
    fs::write(stt_path.join("manifest.json"), content).unwrap();
}

fn write_tts_manifest(tts_path: &std::path::Path, content: &str) {
    fs::write(tts_path.join("manifest.json"), content).unwrap();
}

#[tokio::test]
async fn test_startup_validation_external_mode_missing_url() {
    let (storage_dir, stt_dir, tts_dir) = create_temp_model_dirs();

    let res = std::panic::catch_unwind(|| {
        tokio::runtime::Runtime::new().unwrap().block_on(async {
            let _ = setup_test_app_with_custom_config(|cfg| {
                cfg.model_hosting_enabled = true;
                cfg.model_hosting_mode = "external".to_string();
                cfg.model_external_base_url = None;
                cfg.model_storage_path = storage_dir.path().to_path_buf();
                cfg.stt_models_path = stt_dir.path().to_path_buf();
                cfg.tts_models_path = tts_dir.path().to_path_buf();
            })
            .await;
        });
    });
    assert!(res.is_err());
}

#[tokio::test]
async fn test_startup_validation_external_mode_production_http() {
    let (storage_dir, stt_dir, tts_dir) = create_temp_model_dirs();

    let res = std::panic::catch_unwind(|| {
        tokio::runtime::Runtime::new().unwrap().block_on(async {
            let _ = setup_test_app_with_custom_config(|cfg| {
                cfg.app_env = "production".to_string();
                cfg.model_hosting_enabled = true;
                cfg.model_hosting_mode = "external".to_string();
                cfg.model_external_base_url = Some("http://models.example.com".to_string());
                cfg.model_storage_path = storage_dir.path().to_path_buf();
                cfg.stt_models_path = stt_dir.path().to_path_buf();
                cfg.tts_models_path = tts_dir.path().to_path_buf();
            })
            .await;
        });
    });
    assert!(res.is_err());
}

#[tokio::test]
async fn test_external_mode_capabilities_and_unregistered_routes() {
    let mock_server = MockServer::start().await;

    let external_manifest = serde_json::json!({
        "stt": {
            "schema_version": 1,
            "models": []
        },
        "tts": {
            "schema_version": 1,
            "models": [
                {
                    "id": "supertonic-3",
                    "version": 1,
                    "size_bytes": 100,
                    "languages": ["en-US"],
                    "voices": [{"id": "v1", "language": "en-US", "gender": "neutral"}],
                    "files": [
                        {"name": "model.onnx", "size_bytes": 100, "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"}
                    ]
                }
            ]
        }
    });

    Mock::given(method("GET"))
        .and(path("/manifest.json"))
        .respond_with(ResponseTemplate::new(200).set_body_json(&external_manifest))
        .expect(1)
        .mount(&mock_server)
        .await;

    let (storage_dir, stt_dir, tts_dir) = create_temp_model_dirs();
    let ext_url = mock_server.uri();

    let (app, _, _) = setup_test_app_with_custom_config(|cfg| {
        cfg.model_hosting_enabled = true;
        cfg.model_hosting_mode = "external".to_string();
        cfg.model_external_base_url = Some(ext_url.clone());
        cfg.model_storage_path = storage_dir.path().to_path_buf();
        cfg.stt_models_path = stt_dir.path().to_path_buf();
        cfg.tts_models_path = tts_dir.path().to_path_buf();
    })
    .await;

    // 1. GET /models/manifest.json should return 404 (unregistered route)
    let res: Response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/models/manifest.json")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::NOT_FOUND);

    // 2. GET /models/stt/v1/moonshine-tiny/1/model.onnx should return 404 (unregistered route)
    let res: Response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/models/stt/v1/moonshine-tiny/1/model.onnx")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::NOT_FOUND);

    // 3. GET /api/v1/capabilities should return external base URLs and cached tts_models
    let res: Response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/v1/capabilities")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let body_bytes = axum::body::to_bytes(res.into_body(), usize::MAX)
        .await
        .unwrap();
    let cap_json: Value = serde_json::from_slice(&body_bytes).unwrap();

    assert_eq!(cap_json["model_hosting_mode"], "external");
    assert_eq!(
        cap_json["stt_models_base_url"],
        format!("{}/stt/v1/", mock_server.uri())
    );
    assert_eq!(
        cap_json["tts_models_base_url"],
        format!("{}/tts/v1/", mock_server.uri())
    );

    let tts_models = cap_json["tts_models"].as_array().unwrap();
    assert_eq!(tts_models.len(), 1);
    assert_eq!(tts_models[0]["id"], "supertonic-3");

    // 4. Subsequent capabilities call uses cached manifest without hitting mock server again
    let res: Response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/v1/capabilities")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
}

#[tokio::test]
async fn test_external_mode_admin_reload() {
    let mock_server = MockServer::start().await;

    let initial_manifest = serde_json::json!({
        "stt": {"schema_version": 1, "models": []},
        "tts": {"schema_version": 1, "models": []}
    });

    Mock::given(method("GET"))
        .and(path("/manifest.json"))
        .respond_with(ResponseTemplate::new(200).set_body_json(&initial_manifest))
        .expect(2) // Initial capabilities fetch + admin reload
        .mount(&mock_server)
        .await;

    let (storage_dir, stt_dir, tts_dir) = create_temp_model_dirs();
    let ext_url = mock_server.uri();

    let (app, pool, _) = setup_test_app_with_custom_config(|cfg| {
        cfg.model_hosting_enabled = true;
        cfg.model_hosting_mode = "external".to_string();
        cfg.model_external_base_url = Some(ext_url.clone());
        cfg.model_storage_path = storage_dir.path().to_path_buf();
        cfg.stt_models_path = stt_dir.path().to_path_buf();
        cfg.tts_models_path = tts_dir.path().to_path_buf();
    })
    .await;

    register_user(&app, "owner", "password123", None).await;
    let (_, login_body) = login_user(&app, "owner", "password123", "client_owner_123", None).await;
    let token = login_body["session_token"].as_str().unwrap().to_string();

    // 1. Initial capabilities call populates cache
    let _res: Response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/v1/capabilities")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    // 2. Admin reload forces re-fetch
    let res: Response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/admin/models/reload")
                .header(header::AUTHORIZATION, format!("Bearer {}", token))
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(res.status(), StatusCode::OK);
    let body_bytes = axum::body::to_bytes(res.into_body(), usize::MAX)
        .await
        .unwrap();
    let reload_json: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(reload_json["reloaded"], true);

    // Verify audit log
    let audit_entries = server::audit::list(
        &pool,
        AuditFilter {
            action: Some(action::MODEL_MANIFEST_RELOAD.to_string()),
            ..Default::default()
        },
        1,
        10,
    )
    .await
    .unwrap();

    let reload_entry = audit_entries.first().unwrap();
    assert_eq!(reload_entry.metadata.as_ref().unwrap()["mode"], "external");
}

#[tokio::test]
async fn test_proxy_mode_cache_hit_and_miss() {
    let mock_server = MockServer::start().await;

    let file_bytes = b"proxy model content test 12345";
    use sha2::{Digest, Sha256};
    let sha256_hex = format!("{:x}", Sha256::digest(file_bytes));

    let stt_manifest = format!(
        r#"{{
        "schema_version": 1,
        "models": [
            {{
                "id": "moonshine-tiny",
                "version": 1,
                "size_bytes": {},
                "files": [
                    {{ "name": "model.onnx", "size_bytes": {}, "sha256": "{}" }}
                ]
            }}
        ]
    }}"#,
        file_bytes.len(),
        file_bytes.len(),
        sha256_hex
    );

    // Upstream file serving mock
    Mock::given(method("GET"))
        .and(path("/stt/v1/moonshine-tiny/1/model.onnx"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_raw(file_bytes.to_vec(), "application/octet-stream"),
        )
        .expect(1) // Cache miss fetches exactly once
        .mount(&mock_server)
        .await;

    let (storage_dir, stt_dir, tts_dir) = create_temp_model_dirs();
    write_stt_manifest(stt_dir.path(), &stt_manifest);
    write_tts_manifest(tts_dir.path(), r#"{"schema_version": 1, "models": []}"#);

    let ext_url = mock_server.uri();

    let (app, _, _) = setup_test_app_with_custom_config(|cfg| {
        cfg.model_hosting_enabled = true;
        cfg.model_hosting_mode = "proxy".to_string();
        cfg.model_external_base_url = Some(ext_url.clone());
        cfg.model_storage_path = storage_dir.path().to_path_buf();
        cfg.stt_models_path = stt_dir.path().to_path_buf();
        cfg.tts_models_path = tts_dir.path().to_path_buf();
    })
    .await;

    // 1. GET /models/manifest.json serves local manifest
    let res: Response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/models/manifest.json")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);

    // 2. First request to uncached file triggers proxy fetch miss
    let res: Response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/models/stt/v1/moonshine-tiny/1/model.onnx")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let downloaded_bytes = axum::body::to_bytes(res.into_body(), usize::MAX)
        .await
        .unwrap();
    assert_eq!(downloaded_bytes.as_ref(), file_bytes);

    // Verify file is now saved locally
    let cached_file_path = stt_dir.path().join("moonshine-tiny/1/model.onnx");
    assert!(cached_file_path.exists());

    // 3. Second request served from local cache without contacting mock server again
    let res: Response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/models/stt/v1/moonshine-tiny/1/model.onnx")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
}

#[tokio::test]
async fn test_proxy_mode_size_mismatch() {
    let mock_server = MockServer::start().await;

    // Upstream serves 5 bytes, manifest claims 100 bytes
    Mock::given(method("GET"))
        .and(path("/stt/v1/moonshine-tiny/1/model.onnx"))
        .respond_with(ResponseTemplate::new(200).set_body_bytes(b"12345".to_vec()))
        .expect(1)
        .mount(&mock_server)
        .await;

    let stt_manifest = r#"{
        "schema_version": 1,
        "models": [
            {
                "id": "moonshine-tiny",
                "version": 1,
                "size_bytes": 100,
                "files": [
                    { "name": "model.onnx", "size_bytes": 100, "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" }
                ]
            }
        ]
    }"#;

    let (storage_dir, stt_dir, tts_dir) = create_temp_model_dirs();
    write_stt_manifest(stt_dir.path(), stt_manifest);
    write_tts_manifest(tts_dir.path(), r#"{"schema_version": 1, "models": []}"#);

    let ext_url = mock_server.uri();

    let (app, _, _) = setup_test_app_with_custom_config(|cfg| {
        cfg.model_hosting_enabled = true;
        cfg.model_hosting_mode = "proxy".to_string();
        cfg.model_external_base_url = Some(ext_url.clone());
        cfg.model_storage_path = storage_dir.path().to_path_buf();
        cfg.stt_models_path = stt_dir.path().to_path_buf();
        cfg.tts_models_path = tts_dir.path().to_path_buf();
    })
    .await;

    let res: Response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/models/stt/v1/moonshine-tiny/1/model.onnx")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(res.status(), StatusCode::BAD_GATEWAY);
    let body_bytes = axum::body::to_bytes(res.into_body(), usize::MAX)
        .await
        .unwrap();
    let err_json: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(err_json["error"], "model_fetch_failed");
    assert_eq!(err_json["details"]["upstream"], mock_server.uri());

    // Verify temp file cleaned up and target file does not exist
    let target_file_path = stt_dir.path().join("moonshine-tiny/1/model.onnx");
    assert!(!target_file_path.exists());
}
