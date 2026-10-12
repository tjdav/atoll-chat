use server::openapi::ApiDoc;
use utoipa::OpenApi;

#[test]
fn test_openapi_doc_validity() {
    let doc = ApiDoc::openapi();
    let json_str = serde_json::to_string_pretty(&doc).unwrap();

    // Assert the JSON round-trips through serde
    let parsed: serde_json::Value = serde_json::from_str(&json_str).unwrap();

    // Assert metadata
    assert_eq!(parsed["info"]["title"], "Atoll Encrypted Chat API");
    assert_eq!(parsed["info"]["version"], "3.0.4");

    // Assert pilot paths exist
    let paths = parsed["paths"].as_object().unwrap();
    assert!(paths.contains_key("/api/v1/health"), "missing /health path");
    assert!(paths.contains_key("/api/v1/ready"), "missing /ready path");
    assert!(
        paths.contains_key("/api/v1/capabilities"),
        "missing /capabilities path"
    );
    assert!(
        paths.contains_key("/api/v1/users/me"),
        "missing /users/me path"
    );
    assert_eq!(paths.len(), 4, "expected exactly 4 pilot paths");
}

#[test]
fn test_openapi_cli_subcommand_out_flag() {
    let temp_dir = tempfile::tempdir().unwrap();
    let out_path = temp_dir.path().join("custom_openapi.json");

    server::openapi::generate_openapi_file(&out_path).unwrap();

    assert!(out_path.exists(), "out file was not created");

    let content = std::fs::read_to_string(&out_path).unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&content).unwrap();

    assert_eq!(parsed["info"]["title"], "Atoll Encrypted Chat API");
    assert_eq!(parsed["info"]["version"], "3.0.4");

    // Self-consistency check: file contents match ApiDoc::openapi() serialized
    let doc = ApiDoc::openapi();
    let doc_json = serde_json::to_string_pretty(&doc).unwrap();
    assert_eq!(
        content, doc_json,
        "file contents differ from ApiDoc::openapi() serialization"
    );
}

#[test]
fn test_openapi_cli_default_invocation() {
    let temp_dir = tempfile::tempdir().unwrap();

    // Save current working directory
    let orig_dir = std::env::current_dir().unwrap();

    // Change current directory to tempdir
    std::env::set_current_dir(temp_dir.path()).unwrap();

    let default_out = std::path::PathBuf::from("docs/openapi.json");
    let result = server::openapi::generate_openapi_file(&default_out);

    // Restore original working directory
    let _ = std::env::set_current_dir(&orig_dir);

    result.unwrap();

    let created_file = temp_dir.path().join("docs/openapi.json");
    assert!(
        created_file.exists(),
        "default invocation did not create docs/openapi.json"
    );

    let content = std::fs::read_to_string(&created_file).unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&content).unwrap();
    assert_eq!(parsed["info"]["title"], "Atoll Encrypted Chat API");
}
