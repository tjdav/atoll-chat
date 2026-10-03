mod common;

use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use common::{login_user, register_user, setup_test_app_with_custom_config};
use serde_json::{json, Value};
use server::audit::{action, AuditFilter};
use server::models::manifest::parse_and_validate_manifest;
use std::fs;
use tempfile::TempDir;
use tower::ServiceExt;

fn create_temp_model_dirs() -> (TempDir, TempDir) {
    let stt_dir = TempDir::new().unwrap();
    let tts_dir = TempDir::new().unwrap();
    (stt_dir, tts_dir)
}

fn write_stt_manifest(stt_path: &std::path::Path, content: &str) {
    fs::write(stt_path.join("manifest.json"), content).unwrap();
}

fn write_tts_manifest(tts_path: &std::path::Path, content: &str) {
    fs::write(tts_path.join("manifest.json"), content).unwrap();
}

#[test]
fn test_parse_valid_manifest() {
    let content = r#"{
        "schema_version": 1,
        "models": [
            {
                "id": "moonshine-tiny",
                "version": 1,
                "size_bytes": 41943040,
                "files": [
                    { "name": "model.onnx", "size_bytes": 41943040, "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" }
                ]
            }
        ]
    }"#;

    let manifest = parse_and_validate_manifest(content).unwrap();
    assert_eq!(manifest.schema_version, 1);
    assert_eq!(manifest.models.len(), 1);
    assert_eq!(manifest.models[0].id, "moonshine-tiny");
}

#[test]
fn test_parse_manifest_duplicate_id() {
    let content = r#"{
        "schema_version": 1,
        "models": [
            {
                "id": "moonshine-tiny",
                "version": 1,
                "size_bytes": 100,
                "files": [{ "name": "a.onnx", "size_bytes": 100, "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" }]
            },
            {
                "id": "moonshine-tiny",
                "version": 2,
                "size_bytes": 100,
                "files": [{ "name": "b.onnx", "size_bytes": 100, "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" }]
            }
        ]
    }"#;

    let err = parse_and_validate_manifest(content).unwrap_err();
    assert!(err.to_string().contains("duplicate model id"));
}

#[test]
fn test_parse_manifest_path_traversal_filename() {
    let content = r#"{
        "schema_version": 1,
        "models": [
            {
                "id": "moonshine-tiny",
                "version": 1,
                "size_bytes": 100,
                "files": [{ "name": "../etc/passwd", "size_bytes": 100, "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" }]
            }
        ]
    }"#;

    let err = parse_and_validate_manifest(content).unwrap_err();
    assert!(err.to_string().contains("invalid filename"));
}

#[test]
fn test_parse_manifest_bad_sha256() {
    let content = r#"{
        "schema_version": 1,
        "models": [
            {
                "id": "moonshine-tiny",
                "version": 1,
                "size_bytes": 100,
                "files": [{ "name": "model.onnx", "size_bytes": 100, "sha256": "not_a_sha256" }]
            }
        ]
    }"#;

    let err = parse_and_validate_manifest(content).unwrap_err();
    assert!(err.to_string().contains("invalid sha256"));
}

#[tokio::test]
async fn test_manifest_load_and_file_serving_with_headers() {
    let (stt_dir, tts_dir) = create_temp_model_dirs();

    let stt_manifest = r#"{
        "schema_version": 1,
        "models": [
            {
                "id": "moonshine-tiny",
                "version": 1,
                "size_bytes": 11,
                "files": [
                    { "name": "model.onnx", "size_bytes": 11, "sha256": "a591a6d40bf420404a011733cfb7b190d62c65bf0bcda32b57b277d9ad9f146e" }
                ]
            }
        ]
    }"#;
    write_stt_manifest(stt_dir.path(), stt_manifest);

    let tts_manifest = r#"{
        "schema_version": 1,
        "models": [
            {
                "id": "supertonic-3",
                "version": 1,
                "size_bytes": 22,
                "files": [
                    { "name": "voice.onnx", "size_bytes": 22, "sha256": "709e80c88487a2411e1ee4dfb80cb33250b73187c3e533d3ed000b4625515cbe" }
                ]
            }
        ]
    }"#;
    write_tts_manifest(tts_dir.path(), tts_manifest);

    let stt_file_dir = stt_dir.path().join("moonshine-tiny/1");
    fs::create_dir_all(&stt_file_dir).unwrap();
    fs::write(stt_file_dir.join("model.onnx"), "Hello World").unwrap();

    let tts_file_dir = tts_dir.path().join("supertonic-3/1");
    fs::create_dir_all(&tts_file_dir).unwrap();
    fs::write(tts_file_dir.join("voice.onnx"), "Supertonic Voice Audio").unwrap();

    let voices_json = r#"{
        "languages": ["en-US", "ja-JP"],
        "voices": [
            { "id": "en-US-natural", "language": "en-US", "gender": "neutral" }
        ]
    }"#;
    fs::write(tts_file_dir.join("voices.json"), voices_json).unwrap();

    let (app, _, _) = setup_test_app_with_custom_config(|cfg| {
        cfg.model_hosting_enabled = true;
        cfg.model_hosting_mode = "local".to_string();
        cfg.stt_models_path = stt_dir.path().to_path_buf();
        cfg.tts_models_path = tts_dir.path().to_path_buf();
    })
    .await;

    // Test GET /capabilities
    let req_cap = Request::builder()
        .method("GET")
        .uri("/api/v1/capabilities")
        .body(Body::empty())
        .unwrap();

    let resp_cap = app.clone().oneshot(req_cap).await.unwrap();
    assert_eq!(resp_cap.status(), StatusCode::OK);
    let cap_bytes = axum::body::to_bytes(resp_cap.into_body(), usize::MAX)
        .await
        .unwrap();
    let cap_json: Value = serde_json::from_slice(&cap_bytes).unwrap();

    assert_eq!(cap_json["model_hosting_enabled"], true);
    assert_eq!(cap_json["model_hosting_mode"], "local");
    assert_eq!(
        cap_json["stt_models_base_url"],
        "http://localhost:8080/models/stt/v1/"
    );
    assert_eq!(
        cap_json["tts_models_base_url"],
        "http://localhost:8080/models/tts/v1/"
    );
    assert_eq!(cap_json["tts_models"][0]["id"], "supertonic-3");
    assert_eq!(
        cap_json["tts_models"][0]["languages"],
        json!(["en-US", "ja-JP"])
    );
    assert_eq!(
        cap_json["tts_models"][0]["voices"][0]["id"],
        "en-US-natural"
    );

    // Test GET /models/manifest.json
    let req_man = Request::builder()
        .method("GET")
        .uri("/models/manifest.json")
        .body(Body::empty())
        .unwrap();

    let resp_man = app.clone().oneshot(req_man).await.unwrap();
    assert_eq!(resp_man.status(), StatusCode::OK);
    assert_eq!(
        resp_man.headers().get(header::CACHE_CONTROL).unwrap(),
        "public, max-age=3600"
    );
    assert_eq!(
        resp_man.headers().get(header::CONTENT_TYPE).unwrap(),
        "application/json"
    );

    let man_bytes = axum::body::to_bytes(resp_man.into_body(), usize::MAX)
        .await
        .unwrap();
    let man_json: Value = serde_json::from_slice(&man_bytes).unwrap();
    assert_eq!(man_json["stt"]["models"][0]["id"], "moonshine-tiny");
    assert_eq!(man_json["tts"]["models"][0]["id"], "supertonic-3");

    // Test GET /models/stt/v1/moonshine-tiny/1/model.onnx
    let req_file = Request::builder()
        .method("GET")
        .uri("/models/stt/v1/moonshine-tiny/1/model.onnx")
        .body(Body::empty())
        .unwrap();

    let resp_file = app.clone().oneshot(req_file).await.unwrap();
    assert_eq!(resp_file.status(), StatusCode::OK);
    assert_eq!(
        resp_file.headers().get(header::CACHE_CONTROL).unwrap(),
        "public, max-age=31536000, immutable"
    );
    assert_eq!(
        resp_file.headers().get(header::CONTENT_TYPE).unwrap(),
        "application/octet-stream"
    );
    assert_eq!(
        resp_file.headers().get(header::ETAG).unwrap(),
        "\"a591a6d40bf420404a011733cfb7b190d62c65bf0bcda32b57b277d9ad9f146e\""
    );

    let file_bytes = axum::body::to_bytes(resp_file.into_body(), usize::MAX)
        .await
        .unwrap();
    assert_eq!(std::str::from_utf8(&file_bytes).unwrap(), "Hello World");

    // Test If-None-Match (304 Not Modified)
    let req_304 = Request::builder()
        .method("GET")
        .uri("/models/stt/v1/moonshine-tiny/1/model.onnx")
        .header(
            header::IF_NONE_MATCH,
            "\"a591a6d40bf420404a011733cfb7b190d62c65bf0bcda32b57b277d9ad9f146e\"",
        )
        .body(Body::empty())
        .unwrap();

    let resp_304 = app.clone().oneshot(req_304).await.unwrap();
    assert_eq!(resp_304.status(), StatusCode::NOT_MODIFIED);
    let body_304 = axum::body::to_bytes(resp_304.into_body(), usize::MAX)
        .await
        .unwrap();
    assert!(body_304.is_empty());

    // Test Single Range request (206 Partial Content)
    let req_range = Request::builder()
        .method("GET")
        .uri("/models/stt/v1/moonshine-tiny/1/model.onnx")
        .header(header::RANGE, "bytes=0-4")
        .body(Body::empty())
        .unwrap();

    let resp_range = app.clone().oneshot(req_range).await.unwrap();
    assert_eq!(resp_range.status(), StatusCode::PARTIAL_CONTENT);
    assert_eq!(
        resp_range.headers().get(header::CONTENT_RANGE).unwrap(),
        "bytes 0-4/11"
    );
    let range_bytes = axum::body::to_bytes(resp_range.into_body(), usize::MAX)
        .await
        .unwrap();
    assert_eq!(std::str::from_utf8(&range_bytes).unwrap(), "Hello");

    // Test Multi-range request (416 Range Not Satisfiable)
    let req_multi = Request::builder()
        .method("GET")
        .uri("/models/stt/v1/moonshine-tiny/1/model.onnx")
        .header(header::RANGE, "bytes=0-2,4-6")
        .body(Body::empty())
        .unwrap();

    let resp_multi = app.clone().oneshot(req_multi).await.unwrap();
    assert_eq!(resp_multi.status(), StatusCode::RANGE_NOT_SATISFIABLE);
}

#[tokio::test]
async fn test_path_traversal_rejection() {
    let (stt_dir, tts_dir) = create_temp_model_dirs();
    let (app, _, _) = setup_test_app_with_custom_config(|cfg| {
        cfg.model_hosting_enabled = true;
        cfg.stt_models_path = stt_dir.path().to_path_buf();
        cfg.tts_models_path = tts_dir.path().to_path_buf();
    })
    .await;

    let req = Request::builder()
        .method("GET")
        .uri("/models/stt/v1/moonshine-tiny/1/..%2F..%2Fetc%2Fpasswd")
        .body(Body::empty())
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn test_admin_reload_workflow() {
    let (stt_dir, tts_dir) = create_temp_model_dirs();

    let initial_stt = r#"{
        "schema_version": 1,
        "models": [
            {
                "id": "moonshine-tiny",
                "version": 1,
                "size_bytes": 100,
                "files": [{ "name": "model.onnx", "size_bytes": 100, "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" }]
            }
        ]
    }"#;
    write_stt_manifest(stt_dir.path(), initial_stt);

    let initial_tts = r#"{
        "schema_version": 1,
        "models": []
    }"#;
    write_tts_manifest(tts_dir.path(), initial_tts);

    let (app, pool, _) = setup_test_app_with_custom_config(|cfg| {
        cfg.model_hosting_enabled = true;
        cfg.stt_models_path = stt_dir.path().to_path_buf();
        cfg.tts_models_path = tts_dir.path().to_path_buf();
    })
    .await;

    register_user(&app, "owner", "password123", None).await;
    let (_, login_body) = login_user(&app, "owner", "password123", "client_owner_123", None).await;
    let token = login_body["session_token"].as_str().unwrap();

    // Update STT manifest to include a second model
    let updated_stt = r#"{
        "schema_version": 1,
        "models": [
            {
                "id": "moonshine-tiny",
                "version": 1,
                "size_bytes": 100,
                "files": [{ "name": "model.onnx", "size_bytes": 100, "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" }]
            },
            {
                "id": "whisper-small",
                "version": 1,
                "size_bytes": 200,
                "files": [{ "name": "model.onnx", "size_bytes": 200, "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" }]
            }
        ]
    }"#;
    write_stt_manifest(stt_dir.path(), updated_stt);

    let req_reload = Request::builder()
        .method("POST")
        .uri("/api/v1/admin/models/reload")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::empty())
        .unwrap();

    let resp_reload = app.clone().oneshot(req_reload).await.unwrap();
    assert_eq!(resp_reload.status(), StatusCode::OK);

    let reload_bytes = axum::body::to_bytes(resp_reload.into_body(), usize::MAX)
        .await
        .unwrap();
    let reload_json: Value = serde_json::from_slice(&reload_bytes).unwrap();
    assert_eq!(reload_json["reloaded"], true);
    assert_eq!(reload_json["stt_models"], 2);
    assert_eq!(reload_json["tts_models"], 0);

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

    assert_eq!(audit_entries.len(), 1);
    assert_eq!(audit_entries[0].metadata.as_ref().unwrap()["stt_models"], 2);
}

#[tokio::test]
async fn test_rate_limiting_downloads() {
    let (stt_dir, tts_dir) = create_temp_model_dirs();

    let stt_manifest = r#"{
        "schema_version": 1,
        "models": [
            {
                "id": "moonshine-tiny",
                "version": 1,
                "size_bytes": 11,
                "files": [
                    { "name": "model.onnx", "size_bytes": 11, "sha256": "a591a6d40bf420404a011733cfb7b190d62c65bf0bcda32b57b277d9ad9f146e" }
                ]
            }
        ]
    }"#;
    write_stt_manifest(stt_dir.path(), stt_manifest);
    write_tts_manifest(tts_dir.path(), r#"{"schema_version": 1, "models": []}"#);

    let stt_file_dir = stt_dir.path().join("moonshine-tiny/1");
    fs::create_dir_all(&stt_file_dir).unwrap();
    fs::write(stt_file_dir.join("model.onnx"), "Hello World").unwrap();

    let (app, _, _) = setup_test_app_with_custom_config(|cfg| {
        cfg.model_hosting_enabled = true;
        cfg.stt_models_path = stt_dir.path().to_path_buf();
        cfg.tts_models_path = tts_dir.path().to_path_buf();
        cfg.rate_limits.rate_model_download_per_min = 2;
    })
    .await;

    for i in 1..=2 {
        let req = Request::builder()
            .method("GET")
            .uri("/models/stt/v1/moonshine-tiny/1/model.onnx")
            .body(Body::empty())
            .unwrap();

        let resp = app.clone().oneshot(req).await.unwrap();
        assert_eq!(
            resp.status(),
            StatusCode::OK,
            "Request {} should succeed",
            i
        );
    }

    let req_exceed = Request::builder()
        .method("GET")
        .uri("/models/stt/v1/moonshine-tiny/1/model.onnx")
        .body(Body::empty())
        .unwrap();

    let resp_exceed = app.oneshot(req_exceed).await.unwrap();
    assert_eq!(resp_exceed.status(), StatusCode::TOO_MANY_REQUESTS);
    assert!(resp_exceed.headers().contains_key(header::RETRY_AFTER));
}
