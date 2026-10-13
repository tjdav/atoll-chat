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

    // Assert path items (48 path items total)
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
        "/api/v1/bots",
        "/api/v1/bots/me/commands/{id}/ack",
        "/api/v1/bots/me/messages",
        "/api/v1/bots/me/settings",
        "/api/v1/bots/{id}",
        "/api/v1/bots/{id}/avatar",
        "/api/v1/bots/{id}/keys",
        "/api/v1/bots/{id}/tokens",
        "/api/v1/bots/{id}/tokens/{token_id}",
        "/api/v1/rooms/{id}/bot-commands",
        "/api/v1/rooms/{id}/bot-messages",
        "/api/v1/rooms/{id}/bots",
        "/api/v1/rooms/{id}/bots/{bot_id}",
        "/api/v1/rooms/{id}/observer-stream",
        "/api/v1/rooms/{id}/publisher-key",
        "/api/v1/users/me/bots/{bot_id}/settings",
        "/api/v1/users/me/bots/{bot_id}/settings/{key}",
        "/api/v1/kt/user/{id}",
        "/api/v1/kt/bot/{id}",
        "/api/v1/kt/bot/{id}/history",
        "/api/v1/kt/snapshot",
        "/api/v1/admin/oprf/rotate",
        "/api/v1/admin/key-transparency",
        "/api/v1/admin/key-transparency/snapshot",
        "/api/v1/admin/rooms/{id}/sessions",
        "/api/v1/admin/models/reload",
        "/api/v1/admin/session-types/reload",
        "/api/v1/admin/extension-proxy/reload-blocklist",
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

    // Assert every authenticated user/bot path declares bearer_auth requirement
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
        ("/api/v1/bots", "post"),
        ("/api/v1/bots/{id}", "get"),
        ("/api/v1/bots/{id}", "patch"),
        ("/api/v1/bots/{id}", "delete"),
        ("/api/v1/bots/{id}/keys", "patch"),
        ("/api/v1/bots/{id}/avatar", "post"),
        ("/api/v1/bots/{id}/avatar", "delete"),
        ("/api/v1/bots/{id}/tokens", "get"),
        ("/api/v1/bots/{id}/tokens", "post"),
        ("/api/v1/bots/{id}/tokens/{token_id}", "delete"),
        ("/api/v1/rooms/{id}/bots", "get"),
        ("/api/v1/rooms/{id}/bots", "post"),
        ("/api/v1/rooms/{id}/bots/{bot_id}", "patch"),
        ("/api/v1/rooms/{id}/bots/{bot_id}", "delete"),
        ("/api/v1/rooms/{id}/bot-messages", "post"),
        ("/api/v1/rooms/{id}/bot-commands", "post"),
        ("/api/v1/bots/me/commands/{id}/ack", "post"),
        ("/api/v1/bots/me/messages", "post"),
        ("/api/v1/bots/me/settings", "get"),
        ("/api/v1/users/me/bots/{bot_id}/settings", "get"),
        ("/api/v1/users/me/bots/{bot_id}/settings/{key}", "patch"),
        ("/api/v1/users/me/bots/{bot_id}/settings/{key}", "delete"),
        ("/api/v1/rooms/{id}/publisher-key", "get"),
        ("/api/v1/rooms/{id}/publisher-key", "post"),
        ("/api/v1/rooms/{id}/observer-stream", "get"),
        ("/api/v1/kt/user/{id}", "get"),
        ("/api/v1/kt/bot/{id}", "get"),
        ("/api/v1/kt/bot/{id}/history", "get"),
        ("/api/v1/kt/snapshot", "get"),
        ("/api/v1/admin/oprf/rotate", "post"),
        ("/api/v1/admin/key-transparency", "get"),
        ("/api/v1/admin/key-transparency/snapshot", "post"),
        ("/api/v1/admin/rooms/{id}/sessions", "get"),
        ("/api/v1/admin/models/reload", "post"),
        ("/api/v1/admin/session-types/reload", "post"),
        ("/api/v1/admin/extension-proxy/reload-blocklist", "post"),
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

    // Assert POST /users/me/avatar and POST /bots/{id}/avatar use multipart/form-data
    for avatar_path in ["/api/v1/users/me/avatar", "/api/v1/bots/{id}/avatar"] {
        let avatar_req_body = &parsed["paths"][avatar_path]["post"]["requestBody"]["content"];
        assert!(
            avatar_req_body
                .as_object()
                .unwrap()
                .contains_key("multipart/form-data"),
            "avatar request body at {} missing multipart/form-data",
            avatar_path
        );
    }

    // Assert observer stream content type is text/event-stream
    let obs_resp_content = &parsed["paths"]["/api/v1/rooms/{id}/observer-stream"]["get"]
        ["responses"]["200"]["content"];
    assert!(
        obs_resp_content
            .as_object()
            .unwrap()
            .contains_key("text/event-stream"),
        "observer-stream response missing text/event-stream"
    );

    // Assert PATCH /users/me/bots/{bot_id}/settings/{key} operation description documents secret validation rules
    let patch_setting_desc = parsed["paths"]["/api/v1/users/me/bots/{bot_id}/settings/{key}"]
        ["patch"]["description"]
        .as_str()
        .unwrap();
    assert!(
        patch_setting_desc.contains("is_secret=true"),
        "patch setting description missing secret validation rule notes"
    );

    // Assert schemas contain user and bot domain types
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
        "CreateBotReq",
        "BotView",
        "PatchBotReq",
        "RotateBotKeysReq",
        "CreateTokenResp",
        "BotTokenItem",
        "ListTokensResp",
        "PostBotMessagesReq",
        "GetBotSettingsMeResp",
        "GetBotSettingsOwnerResp",
        "RoomBotView",
        "ListRoomBotsResp",
        "GrantBotReq",
        "PatchRoomBotReq",
        "PostBotCommandReq",
        "PostBotCommandResp",
        "PostBotMessageReq",
        "PostBotMessageResp",
        "BotSettingBotView",
        "BotSettingOwnerView",
        "PatchBotSettingRequest",
        "PublisherKeyResponse",
        "PublishPublisherKeyRequest",
        "UserKtResponse",
        "BotKtResponse",
        "BotKtHistoryEntry",
        "BotKtHistoryResponse",
        "KtSnapshotResponse",
        "KtTreeHead",
        "KtAuditorSignature",
        "RotateOprfRequest",
        "RotateOprfResponse",
        "KeyTransparencyStatsResponse",
        "SnapshotView",
        "RoomSessionView",
        "ModelReloadResponse",
        "SessionTypesReloadResponse",
        "SessionTypeAdminView",
        "ExtensionProxyBlocklistReloadResponse",
    ];

    for schema in &expected_schemas {
        assert!(
            schemas.contains_key(*schema),
            "missing expected schema {}",
            schema
        );
    }

    // Assert ciphertext and signature fields are documented as format: binary with spec section references
    let bot_msg_req_ct = &schemas["PostBotMessageReq"]["properties"]["ciphertext"];
    assert_eq!(bot_msg_req_ct["format"], "binary");
    let bot_msg_req_sig = &schemas["PostBotMessageReq"]["properties"]["signature"];
    assert_eq!(bot_msg_req_sig["format"], "binary");
    assert!(
        bot_msg_req_sig["description"]
            .as_str()
            .unwrap()
            .contains("§8.10"),
        "signature description missing §8.10 reference"
    );

    let pub_key_sig = &schemas["PublishPublisherKeyRequest"]["properties"]["signature"];
    assert_eq!(pub_key_sig["format"], "binary");
    assert!(
        pub_key_sig["description"]
            .as_str()
            .unwrap()
            .contains("§8.10"),
        "publisher key signature description missing §8.10 reference"
    );

    let bot_cmd_ct = &schemas["PostBotCommandReq"]["properties"]["ciphertext"];
    assert_eq!(bot_cmd_ct["format"], "binary");

    let bot_setting_val = &schemas["BotSettingBotView"]["properties"]["value_encrypted_bot"];
    assert_eq!(bot_setting_val["format"], "binary");
    assert!(
        bot_setting_val["description"]
            .as_str()
            .unwrap()
            .contains("§7.10"),
        "value_encrypted_bot description missing §7.10 reference"
    );

    // Assert KT public key and root hash fields are documented as format: binary with spec references
    let user_kt_pubkey = &schemas["UserKtResponse"]["properties"]["identity_pubkey"];
    assert_eq!(user_kt_pubkey["format"], "binary");
    assert!(
        user_kt_pubkey["description"]
            .as_str()
            .unwrap()
            .contains("§7.11"),
        "UserKtResponse identity_pubkey missing §7.11 reference"
    );

    let bot_kt_id_pubkey = &schemas["BotKtResponse"]["properties"]["bot_identity_pubkey"];
    assert_eq!(bot_kt_id_pubkey["format"], "binary");
    let bot_kt_cmd_pubkey = &schemas["BotKtResponse"]["properties"]["bot_command_pubkey"];
    assert_eq!(bot_kt_cmd_pubkey["format"], "binary");

    let kt_tree_head_root = &schemas["KtTreeHead"]["properties"]["root_hash"];
    assert_eq!(kt_tree_head_root["format"], "binary");
    assert!(
        kt_tree_head_root["description"]
            .as_str()
            .unwrap()
            .contains("§7.11"),
        "KtTreeHead root_hash missing §7.11 reference"
    );

    // Assert GET /kt/user/{id} operation description mentions username_token exclusion per §12
    let user_kt_desc = parsed["paths"]["/api/v1/kt/user/{id}"]["get"]["description"]
        .as_str()
        .unwrap();
    assert!(
        user_kt_desc.contains("username_token is excluded"),
        "user KT endpoint description missing username_token exclusion note"
    );

    // Assert GET /kt/snapshot response schema does NOT contain a signature field
    let snapshot_props = &schemas["KtSnapshotResponse"]["properties"]
        .as_object()
        .unwrap();
    assert!(
        !snapshot_props.contains_key("signature"),
        "KtSnapshotResponse unexpectedly contains a signature field"
    );

    // Assert admin KT snapshot reuses the same schema (SnapshotView)
    let admin_kt_snap_ref = parsed["paths"]["/api/v1/admin/key-transparency/snapshot"]["post"]
        ["responses"]["200"]["content"]["application/json"]["schema"]["$ref"]
        .as_str()
        .unwrap();
    assert_eq!(admin_kt_snap_ref, "#/components/schemas/SnapshotView");

    // Assert admin room sessions reuses the same schema (SessionListResponse)
    let admin_room_sess_ref = parsed["paths"]["/api/v1/admin/rooms/{id}/sessions"]["get"]
        ["responses"]["200"]["content"]["application/json"]["schema"]["$ref"]
        .as_str()
        .unwrap();
    assert_eq!(
        admin_room_sess_ref,
        "#/components/schemas/SessionListResponse"
    );

    // Assert POST /admin/oprf/rotate description mentions catastrophic nature and §5.8
    let oprf_rot_desc = parsed["paths"]["/api/v1/admin/oprf/rotate"]["post"]["description"]
        .as_str()
        .unwrap();
    assert!(
        oprf_rot_desc.contains("CATASTROPHIC OPERATOR OPERATION"),
        "OPRF rotate description missing catastrophic operation warning"
    );
    assert!(
        oprf_rot_desc.contains("§5.8"),
        "OPRF rotate description missing §5.8 reference"
    );

    // Assert POST /admin/session-types/reload description mentions §8.3.1
    let st_reload_desc = parsed["paths"]["/api/v1/admin/session-types/reload"]["post"]
        ["description"]
        .as_str()
        .unwrap();
    assert!(
        st_reload_desc.contains("§8.3.1"),
        "session types reload description missing §8.3.1 reference"
    );

    // Assert POST /admin/extension-proxy/reload-blocklist description mentions §8.3.2
    let bl_reload_desc = parsed["paths"]["/api/v1/admin/extension-proxy/reload-blocklist"]["post"]
        ["description"]
        .as_str()
        .unwrap();
    assert!(
        bl_reload_desc.contains("§8.3.2"),
        "blocklist reload description missing §8.3.2 reference"
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
