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

    // Assert pilot and user domain paths exist (20 path items total)
    let paths = parsed["paths"].as_object().unwrap();
    let expected_paths = [
        "/api/v1/health",
        "/api/v1/ready",
        "/api/v1/capabilities",
        "/api/v1/auth/logout",
        "/api/v1/users/lookup",
        "/api/v1/users/me",
        "/api/v1/users/me/avatar",
        "/api/v1/users/me/devices",
        "/api/v1/users/me/devices/{id}",
        "/api/v1/users/me/export",
        "/api/v1/users/me/preferences/{key}",
        "/api/v1/users/me/push-subscriptions",
        "/api/v1/users/me/push-subscriptions/{id}",
        "/api/v1/users/me/read-state",
        "/api/v1/users/me/room-order",
        "/api/v1/users/me/sessions",
        "/api/v1/users/me/sessions/{id}",
        "/api/v1/users/me/starred-items",
        "/api/v1/users/me/starred-items/{item_id}",
        "/api/v1/users/me/sync",
    ];

    for path_str in &expected_paths {
        assert!(
            paths.contains_key(*path_str),
            "missing expected path {}",
            path_str
        );
    }
    assert_eq!(
        paths.len(),
        expected_paths.len(),
        "expected exactly {} path items",
        expected_paths.len()
    );

    // Assert bearer security scheme exists in components
    let security_schemes = &parsed["components"]["securitySchemes"];
    assert_eq!(
        security_schemes["bearer_auth"]["scheme"], "bearer",
        "missing or invalid bearer_auth scheme"
    );

    // Assert every authenticated user path declares bearer_auth requirement
    let authenticated_paths = [
        ("/api/v1/auth/logout", "post"),
        ("/api/v1/users/lookup", "post"),
        ("/api/v1/users/me", "get"),
        ("/api/v1/users/me", "patch"),
        ("/api/v1/users/me", "delete"),
        ("/api/v1/users/me/avatar", "post"),
        ("/api/v1/users/me/devices", "get"),
        ("/api/v1/users/me/devices/{id}", "patch"),
        ("/api/v1/users/me/devices/{id}", "delete"),
        ("/api/v1/users/me/export", "get"),
        ("/api/v1/users/me/preferences/{key}", "get"),
        ("/api/v1/users/me/preferences/{key}", "patch"),
        ("/api/v1/users/me/preferences/{key}", "delete"),
        ("/api/v1/users/me/push-subscriptions", "get"),
        ("/api/v1/users/me/push-subscriptions", "post"),
        ("/api/v1/users/me/push-subscriptions/{id}", "delete"),
        ("/api/v1/users/me/read-state", "post"),
        ("/api/v1/users/me/room-order", "patch"),
        ("/api/v1/users/me/sessions", "get"),
        ("/api/v1/users/me/sessions/{id}", "delete"),
        ("/api/v1/users/me/starred-items", "get"),
        ("/api/v1/users/me/starred-items", "post"),
        ("/api/v1/users/me/starred-items/{item_id}", "delete"),
        ("/api/v1/users/me/sync", "get"),
    ];

    for (path, method) in &authenticated_paths {
        let op = &parsed["paths"][path][method];
        let sec = op["security"]
            .as_array()
            .unwrap_or_else(|| panic!("security array missing for {} {}", method, path));
        let has_bearer = sec
            .iter()
            .any(|item| item.as_object().unwrap().contains_key("bearer_auth"));
        assert!(
            has_bearer,
            "missing bearer_auth requirement for {} {}",
            method, path
        );
    }

    // Assert POST /users/me/avatar is documented with a multipart/form-data request body
    let avatar_req_body =
        &parsed["paths"]["/api/v1/users/me/avatar"]["post"]["requestBody"]["content"];
    assert!(
        avatar_req_body
            .as_object()
            .unwrap()
            .contains_key("multipart/form-data"),
        "POST /users/me/avatar request body missing multipart/form-data"
    );

    // Assert GET /users/me/export is documented with application/zip binary response
    let export_resp =
        &parsed["paths"]["/api/v1/users/me/export"]["get"]["responses"]["200"]["content"];
    assert!(
        export_resp
            .as_object()
            .unwrap()
            .contains_key("application/zip"),
        "GET /users/me/export response missing application/zip"
    );

    // Assert schemas contain shared error type and user domain types
    let schemas = parsed["components"]["schemas"].as_object().unwrap();
    let expected_schemas = [
        "ErrorResponse",
        "UserProfileResponse",
        "UserLimitsResponse",
        "UserLookupRequest",
        "UserLookupResponse",
        "PatchUserProfileRequest",
        "DeleteAccountRequest",
        "DeviceResponse",
        "ListDevicesResponse",
        "UpdateDeviceNameRequest",
        "DeviceStateRow",
        "SessionResponseItem",
        "SessionListResponse",
        "LogoutRequest",
        "RegisterSubscriptionBody",
        "PushSubscriptionListResponse",
        "PushSubscriptionView",
        "WriteReadStateRequest",
        "ReadStateRow",
        "PatchRoomOrderRequest",
        "RoomOrderSyncState",
        "WritePreferenceRequest",
        "PreferenceRow",
        "ListStarredItemsResponse",
        "StarRequest",
        "StarredItemView",
        "StarredItemRow",
        "StarredItemCursor",
        "AttachmentView",
        "UserAvatarUploadForm",
        "BotSettingSyncRow",
        "SyncResponse",
    ];

    for schema in &expected_schemas {
        assert!(
            schemas.contains_key(*schema),
            "missing expected schema {}",
            schema
        );
    }

    // Assert ciphertext fields in PreferenceRow are documented with base64url format and description
    let pref_value_schema = &schemas["PreferenceRow"]["properties"]["value"];
    assert_eq!(
        pref_value_schema["format"], "binary",
        "PreferenceRow.value format must be binary"
    );
    let pref_desc = pref_value_schema["description"].as_str().unwrap();
    assert!(
        pref_desc.contains("base64url"),
        "PreferenceRow.value description missing base64url"
    );
    assert!(
        pref_desc.contains("§6.29"),
        "PreferenceRow.value description missing §6.29 reference"
    );
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
