use server::models::run_models_fetch;
use server::models::run_models_verify;
use sha2::{Digest, Sha256};
use std::fs::{self, File};
use std::io::Write;
use tokio::sync::Mutex;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

static TEST_MUTEX: Mutex<()> = Mutex::const_new(());

struct EnvGuard {
    stt_orig: Option<String>,
    tts_orig: Option<String>,
    app_env_orig: Option<String>,
}

impl EnvGuard {
    fn new(stt_path: &std::path::Path, tts_path: &std::path::Path) -> Self {
        let stt_orig = std::env::var("STT_MODELS_PATH").ok();
        let tts_orig = std::env::var("TTS_MODELS_PATH").ok();
        let app_env_orig = std::env::var("APP_ENV").ok();

        std::env::set_var("STT_MODELS_PATH", stt_path);
        std::env::set_var("TTS_MODELS_PATH", tts_path);

        Self {
            stt_orig,
            tts_orig,
            app_env_orig,
        }
    }
}

impl Drop for EnvGuard {
    fn drop(&mut self) {
        match &self.stt_orig {
            Some(v) => std::env::set_var("STT_MODELS_PATH", v),
            None => std::env::remove_var("STT_MODELS_PATH"),
        }
        match &self.tts_orig {
            Some(v) => std::env::set_var("TTS_MODELS_PATH", v),
            None => std::env::remove_var("TTS_MODELS_PATH"),
        }
        match &self.app_env_orig {
            Some(v) => std::env::set_var("APP_ENV", v),
            None => std::env::remove_var("APP_ENV"),
        }
    }
}

fn setup_test_models_dir() -> (tempfile::TempDir, std::path::PathBuf, std::path::PathBuf) {
    let temp_dir = tempfile::tempdir().unwrap();
    let stt_path = temp_dir.path().join("stt");
    let tts_path = temp_dir.path().join("tts");
    fs::create_dir_all(&stt_path).unwrap();
    fs::create_dir_all(&tts_path).unwrap();
    (temp_dir, stt_path, tts_path)
}

fn write_file(path: &std::path::Path, content: &[u8]) {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).unwrap();
    }
    let mut f = File::create(path).unwrap();
    f.write_all(content).unwrap();
}

fn sha256_hex(data: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data);
    format!("{:x}", hasher.finalize())
}

#[tokio::test]
async fn test_models_verify_all_ok() {
    let _guard = TEST_MUTEX.lock().await;
    let (_temp, stt_path, tts_path) = setup_test_models_dir();

    let stt_content = b"stt model content";
    let stt_hash = sha256_hex(stt_content);
    let stt_file_path = stt_path.join("moonshine-tiny/1/model.onnx");
    write_file(&stt_file_path, stt_content);

    let stt_manifest_json = serde_json::json!({
        "schema_version": 1,
        "models": [
            {
                "id": "moonshine-tiny",
                "version": 1,
                "size_bytes": stt_content.len(),
                "files": [
                    {
                        "name": "model.onnx",
                        "size_bytes": stt_content.len(),
                        "sha256": stt_hash
                    }
                ]
            }
        ]
    });
    write_file(
        &stt_path.join("manifest.json"),
        stt_manifest_json.to_string().as_bytes(),
    );

    let tts_manifest_json = serde_json::json!({
        "schema_version": 1,
        "models": []
    });
    write_file(
        &tts_path.join("manifest.json"),
        tts_manifest_json.to_string().as_bytes(),
    );

    let _env = EnvGuard::new(&stt_path, &tts_path);

    let code = run_models_verify(false, "all", false).unwrap();
    assert_eq!(code, 0);

    let code_json = run_models_verify(true, "stt", true).unwrap();
    assert_eq!(code_json, 0);
}

#[tokio::test]
async fn test_models_verify_size_and_hash_mismatch_and_missing() {
    let _guard = TEST_MUTEX.lock().await;
    let (_temp, stt_path, tts_path) = setup_test_models_dir();

    let stt_content = b"correct content";
    let stt_hash = sha256_hex(stt_content);

    // Write corrupted file (wrong size and wrong hash)
    let corrupted_file_path = stt_path.join("moonshine-tiny/1/model.onnx");
    write_file(&corrupted_file_path, b"wrong size content");

    let stt_manifest_json = serde_json::json!({
        "schema_version": 1,
        "models": [
            {
                "id": "moonshine-tiny",
                "version": 1,
                "size_bytes": stt_content.len(),
                "files": [
                    {
                        "name": "model.onnx",
                        "size_bytes": stt_content.len(),
                        "sha256": stt_hash
                    },
                    {
                        "name": "missing.json",
                        "size_bytes": 10,
                        "sha256": "0000000000000000000000000000000000000000000000000000000000000000"
                    }
                ]
            }
        ]
    });
    write_file(
        &stt_path.join("manifest.json"),
        stt_manifest_json.to_string().as_bytes(),
    );

    let tts_manifest_json = serde_json::json!({
        "schema_version": 1,
        "models": []
    });
    write_file(
        &tts_path.join("manifest.json"),
        tts_manifest_json.to_string().as_bytes(),
    );

    let _env = EnvGuard::new(&stt_path, &tts_path);

    let code = run_models_verify(false, "all", false).unwrap();
    assert_eq!(code, 1);
}

#[tokio::test]
async fn test_models_verify_hash_mismatch() {
    let _guard = TEST_MUTEX.lock().await;
    let (_temp, stt_path, tts_path) = setup_test_models_dir();

    let file_path = stt_path.join("moonshine-tiny/1/model.onnx");
    let actual_content = b"same size diff content!";
    write_file(&file_path, actual_content);

    let fake_hash = "1111111111111111111111111111111111111111111111111111111111111111";

    let stt_manifest_json = serde_json::json!({
        "schema_version": 1,
        "models": [
            {
                "id": "moonshine-tiny",
                "version": 1,
                "size_bytes": actual_content.len(),
                "files": [
                    {
                        "name": "model.onnx",
                        "size_bytes": actual_content.len(),
                        "sha256": fake_hash
                    }
                ]
            }
        ]
    });
    write_file(
        &stt_path.join("manifest.json"),
        stt_manifest_json.to_string().as_bytes(),
    );

    let tts_manifest_json = serde_json::json!({
        "schema_version": 1,
        "models": []
    });
    write_file(
        &tts_path.join("manifest.json"),
        tts_manifest_json.to_string().as_bytes(),
    );

    let _env = EnvGuard::new(&stt_path, &tts_path);

    let code = run_models_verify(false, "stt", false).unwrap();
    assert_eq!(code, 1);
}

#[tokio::test]
async fn test_models_verify_missing_manifest_returns_exit_code_2() {
    let _guard = TEST_MUTEX.lock().await;
    let (_temp, stt_path, tts_path) = setup_test_models_dir();

    let _env = EnvGuard::new(&stt_path, &tts_path);

    let code = run_models_verify(false, "all", false).unwrap();
    assert_eq!(code, 2);
}

#[tokio::test]
async fn test_models_fetch_success_and_skip_present() {
    let _guard = TEST_MUTEX.lock().await;
    let mock_server = MockServer::start().await;
    let (_temp, stt_path, tts_path) = setup_test_models_dir();

    let content1 = b"file1 content string";
    let hash1 = sha256_hex(content1);

    let content2 = b"file2 content string";
    let hash2 = sha256_hex(content2);

    let stt_manifest_json = serde_json::json!({
        "schema_version": 1,
        "models": [
            {
                "id": "model-one",
                "version": 1,
                "size_bytes": content1.len(),
                "files": [
                    { "name": "f1.bin", "size_bytes": content1.len(), "sha256": hash1 },
                    { "name": "f2.bin", "size_bytes": content2.len(), "sha256": hash2 }
                ]
            }
        ]
    });
    write_file(
        &stt_path.join("manifest.json"),
        stt_manifest_json.to_string().as_bytes(),
    );

    let tts_manifest_json = serde_json::json!({
        "schema_version": 1,
        "models": []
    });
    write_file(
        &tts_path.join("manifest.json"),
        tts_manifest_json.to_string().as_bytes(),
    );

    // Pre-create f1.bin so it gets skipped as already_present
    let f1_path = stt_path.join("model-one/1/f1.bin");
    write_file(&f1_path, content1);

    // Mock f2.bin on mock server
    Mock::given(method("HEAD"))
        .and(path("/stt/v1/model-one/1/f1.bin"))
        .respond_with(ResponseTemplate::new(200))
        .mount(&mock_server)
        .await;

    Mock::given(method("GET"))
        .and(path("/stt/v1/model-one/1/f2.bin"))
        .respond_with(ResponseTemplate::new(200).set_body_bytes(content2.to_vec()))
        .mount(&mock_server)
        .await;

    std::env::set_var("STT_MODELS_PATH", &stt_path);
    std::env::set_var("TTS_MODELS_PATH", &tts_path);
    std::env::set_var("APP_ENV", "development");

    let code = run_models_fetch(&mock_server.uri(), "stt", false, 2, false)
        .await
        .unwrap();
    assert_eq!(code, 0);

    let f2_path = stt_path.join("model-one/1/f2.bin");
    assert!(f2_path.exists());
    assert_eq!(fs::read(&f2_path).unwrap(), content2);
}

#[tokio::test]
async fn test_models_fetch_force_redownload() {
    let _guard = TEST_MUTEX.lock().await;
    let mock_server = MockServer::start().await;
    let (_temp, stt_path, tts_path) = setup_test_models_dir();

    let content = b"fresh content from origin";
    let hash = sha256_hex(content);

    let stt_manifest_json = serde_json::json!({
        "schema_version": 1,
        "models": [
            {
                "id": "model-one",
                "version": 1,
                "size_bytes": content.len(),
                "files": [
                    { "name": "f1.bin", "size_bytes": content.len(), "sha256": hash }
                ]
            }
        ]
    });
    write_file(
        &stt_path.join("manifest.json"),
        stt_manifest_json.to_string().as_bytes(),
    );
    write_file(
        &tts_path.join("manifest.json"),
        serde_json::json!({"schema_version": 1, "models": []})
            .to_string()
            .as_bytes(),
    );

    let f1_path = stt_path.join("model-one/1/f1.bin");
    write_file(&f1_path, content);

    Mock::given(method("GET"))
        .and(path("/stt/v1/model-one/1/f1.bin"))
        .respond_with(ResponseTemplate::new(200).set_body_bytes(content.to_vec()))
        .expect(1)
        .mount(&mock_server)
        .await;

    std::env::set_var("STT_MODELS_PATH", &stt_path);
    std::env::set_var("TTS_MODELS_PATH", &tts_path);
    std::env::set_var("APP_ENV", "development");

    let code = run_models_fetch(&mock_server.uri(), "stt", true, 1, true)
        .await
        .unwrap();
    assert_eq!(code, 0);
}

#[tokio::test]
async fn test_models_fetch_hash_mismatch_cleans_up_temp_file() {
    let _guard = TEST_MUTEX.lock().await;
    let mock_server = MockServer::start().await;
    let (_temp, stt_path, tts_path) = setup_test_models_dir();

    let bad_content = b"corrupt content";
    let expected_hash = "0000000000000000000000000000000000000000000000000000000000000000";

    let stt_manifest_json = serde_json::json!({
        "schema_version": 1,
        "models": [
            {
                "id": "model-one",
                "version": 1,
                "size_bytes": bad_content.len(),
                "files": [
                    { "name": "f1.bin", "size_bytes": bad_content.len(), "sha256": expected_hash }
                ]
            }
        ]
    });
    write_file(
        &stt_path.join("manifest.json"),
        stt_manifest_json.to_string().as_bytes(),
    );
    write_file(
        &tts_path.join("manifest.json"),
        serde_json::json!({"schema_version": 1, "models": []})
            .to_string()
            .as_bytes(),
    );

    Mock::given(method("GET"))
        .and(path("/stt/v1/model-one/1/f1.bin"))
        .respond_with(ResponseTemplate::new(200).set_body_bytes(bad_content.to_vec()))
        .mount(&mock_server)
        .await;

    std::env::set_var("STT_MODELS_PATH", &stt_path);
    std::env::set_var("TTS_MODELS_PATH", &tts_path);
    std::env::set_var("APP_ENV", "development");

    let code = run_models_fetch(&mock_server.uri(), "stt", false, 1, false)
        .await
        .unwrap();
    assert_eq!(code, 1);

    let f1_path = stt_path.join("model-one/1/f1.bin");
    assert!(!f1_path.exists());

    // Verify no temp file left behind
    let dir = stt_path.join("model-one/1");
    if dir.exists() {
        let entries = fs::read_dir(&dir).unwrap();
        assert_eq!(entries.count(), 0);
    }
}

#[tokio::test]
async fn test_models_fetch_url_validation_rejects_kind_path() {
    let _guard = TEST_MUTEX.lock().await;
    let (_temp, stt_path, tts_path) = setup_test_models_dir();
    std::env::set_var("STT_MODELS_PATH", &stt_path);
    std::env::set_var("TTS_MODELS_PATH", &tts_path);

    let code = run_models_fetch("https://models.example.com/stt/v1/", "all", false, 1, false)
        .await
        .unwrap();
    assert_eq!(code, 2);
}

#[tokio::test]
async fn test_models_fetch_partial_failure_non_atomic() {
    let _guard = TEST_MUTEX.lock().await;
    let mock_server = MockServer::start().await;
    let (_temp, stt_path, tts_path) = setup_test_models_dir();

    let content1 = b"ok content";
    let hash1 = sha256_hex(content1);

    let stt_manifest_json = serde_json::json!({
        "schema_version": 1,
        "models": [
            {
                "id": "m1",
                "version": 1,
                "size_bytes": content1.len(),
                "files": [
                    { "name": "ok.bin", "size_bytes": content1.len(), "sha256": hash1 },
                    { "name": "fail.bin", "size_bytes": 100, "sha256": "0000000000000000000000000000000000000000000000000000000000000000" }
                ]
            }
        ]
    });
    write_file(
        &stt_path.join("manifest.json"),
        stt_manifest_json.to_string().as_bytes(),
    );
    write_file(
        &tts_path.join("manifest.json"),
        serde_json::json!({"schema_version": 1, "models": []})
            .to_string()
            .as_bytes(),
    );

    Mock::given(method("GET"))
        .and(path("/stt/v1/m1/1/ok.bin"))
        .respond_with(ResponseTemplate::new(200).set_body_bytes(content1.to_vec()))
        .mount(&mock_server)
        .await;

    Mock::given(method("GET"))
        .and(path("/stt/v1/m1/1/fail.bin"))
        .respond_with(ResponseTemplate::new(404))
        .mount(&mock_server)
        .await;

    std::env::set_var("STT_MODELS_PATH", &stt_path);
    std::env::set_var("TTS_MODELS_PATH", &tts_path);
    std::env::set_var("APP_ENV", "development");

    let code = run_models_fetch(&mock_server.uri(), "stt", false, 1, false)
        .await
        .unwrap();
    assert_eq!(code, 1);

    // ok.bin exists despite fail.bin failure
    let ok_path = stt_path.join("m1/1/ok.bin");
    assert!(ok_path.exists());
}
