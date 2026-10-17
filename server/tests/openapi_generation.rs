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

    // Assert path items (68 path items total across all domains)
    let paths = parsed["paths"].as_object().unwrap();
    let expected_paths = [
        "/health",
        "/ready",
        "/api/v1/capabilities",
        "/api/v1/auth/register/challenge",
        "/api/v1/auth/register/start",
        "/api/v1/auth/register/finish",
        "/api/v1/auth/login/start",
        "/api/v1/auth/login/finish",
        "/api/v1/auth/recover/start",
        "/api/v1/auth/recover/finish",
        "/api/v1/auth/logout",
        "/api/v1/invites/{code}",
        "/api/v1/oprf/blind",
        "/api/v1/link-preview/proxy",
        "/api/v1/extensions/proxy",
        "/models/stt/v1/{model_id}/{version}/{filename}",
        "/models/tts/v1/{model_id}/{version}/{filename}",
        "/models/manifest.json",
        "/sockudo/auth",
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
        "/api/v1/bots/me/operator-queue",
        "/api/v1/bots/me/settings",
        "/api/v1/bots/me/sync",
        "/api/v1/bots/{id}",
        "/api/v1/bots/{id}/avatar",
        "/api/v1/bots/{id}/keys",
        "/api/v1/bots/{id}/operator-queue",
        "/api/v1/bots/{id}/operator-queue/{request_id}",
        "/api/v1/bots/{id}/operator-queue/{request_id}/respond",
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

    // Assert unauthenticated public/auth endpoints omit security requirement
    let unauthenticated_paths = [
        ("/health", "get"),
        ("/ready", "get"),
        ("/api/v1/capabilities", "get"),
        ("/api/v1/auth/register/challenge", "get"),
        ("/api/v1/auth/register/start", "post"),
        ("/api/v1/auth/register/finish", "post"),
        ("/api/v1/auth/login/start", "post"),
        ("/api/v1/auth/login/finish", "post"),
        ("/api/v1/auth/recover/start", "post"),
        ("/api/v1/auth/recover/finish", "post"),
        ("/api/v1/invites/{code}", "get"),
        ("/api/v1/oprf/blind", "post"),
        ("/models/stt/v1/{model_id}/{version}/{filename}", "get"),
        ("/models/tts/v1/{model_id}/{version}/{filename}", "get"),
        ("/models/manifest.json", "get"),
    ];

    for (path, method) in &unauthenticated_paths {
        let op = &parsed["paths"][path][method];
        assert!(
            op.get("security").is_none(),
            "unauthenticated path {} {} unexpectedly has security attribute",
            method,
            path
        );
    }

    // Assert every authenticated user/bot/public path declares bearer_auth requirement
    let authenticated_paths = [
        ("/api/v1/auth/logout", "post"),
        ("/api/v1/link-preview/proxy", "post"),
        ("/api/v1/extensions/proxy", "post"),
        ("/sockudo/auth", "post"),
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

    // Assert POST /sockudo/auth documents both token types in description
    let sockudo_desc = parsed["paths"]["/sockudo/auth"]["post"]["description"]
        .as_str()
        .unwrap();
    assert!(
        sockudo_desc.contains("user session tokens") && sockudo_desc.contains("bot tokens"),
        "Sockudo auth description missing token types statement"
    );

    // Assert model serving endpoints document binary response content type
    let stt_200_content = &parsed["paths"]["/models/stt/v1/{model_id}/{version}/{filename}"]["get"]
        ["responses"]["200"]["content"];
    assert!(
        stt_200_content
            .as_object()
            .unwrap()
            .contains_key("application/octet-stream"),
        "STT model serving missing application/octet-stream response content type"
    );

    // Assert POST /oprf/blind documents request and response shapes
    let oprf_req = &schemas["OprfBlindRequest"]["properties"]["blinded"];
    assert_eq!(oprf_req["format"], "byte");
    let oprf_resp = &schemas["OprfBlindResponse"]["properties"]["evaluated"];
    assert_eq!(oprf_resp["format"], "byte");

    // Assert POST /link-preview/proxy request envelope ephemeral_pubkey and nonce fields are format: byte
    let lp_req_pubkey = &schemas["RequestEnvelope"]["properties"]["ephemeral_pubkey"];
    assert_eq!(lp_req_pubkey["format"], "byte");
    let lp_req_nonce = &schemas["RequestEnvelope"]["properties"]["nonce"];
    assert_eq!(lp_req_nonce["format"], "byte");
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

#[test]
fn test_router_and_openapi_paths_match_one_to_one() {
    let doc = ApiDoc::openapi();
    let json_str = serde_json::to_string_pretty(&doc).unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&json_str).unwrap();
    let openapi_paths: std::collections::BTreeSet<String> = parsed["paths"]
        .as_object()
        .unwrap()
        .keys()
        .cloned()
        .collect();

    // Assert /sockudo/auth is present and /api/v1/sockudo/auth is absent
    assert!(
        openapi_paths.contains("/sockudo/auth"),
        "OpenAPI missing /sockudo/auth"
    );
    assert!(
        !openapi_paths.contains("/api/v1/sockudo/auth"),
        "OpenAPI unexpectedly contains non-spec /api/v1/sockudo/auth"
    );

    // Assert spec-mandated paths (§8.1, §8.3) are present in OpenAPI
    let spec_mandated_paths = [
        "/health",
        "/ready",
        "/api/v1/oprf/blind",
        "/sockudo/auth",
        "/api/v1/admin/rooms/{id}/sessions",
    ];
    for spec_path in &spec_mandated_paths {
        assert!(
            openapi_paths.contains(*spec_path),
            "OpenAPI missing spec-mandated path {}",
            spec_path
        );
    }

    // Extract paths directly registered on Axum router in server/src/lib.rs
    let lib_str = include_str!("../src/lib.rs");
    let mut router_paths = std::collections::BTreeSet::new();

    let mut in_api_routes = false;
    let mut in_root_app = false;

    let lines: Vec<&str> = lib_str.lines().collect();
    for idx in 0..lines.len() {
        let line = lines[idx];
        if line.contains("let api_routes = Router::new()") {
            in_api_routes = true;
            in_root_app = false;
        } else if line.contains("let mut app = Router::new()")
            || line.contains("if hosting_mode.registers_routes()")
        {
            in_api_routes = false;
            in_root_app = true;
        }

        if line.contains(".route(") {
            for offset in 0..=2 {
                if idx + offset < lines.len() {
                    let search_line = lines[idx + offset];
                    if let Some(first_quote) = search_line.find('"') {
                        let rest = &search_line[first_quote + 1..];
                        if let Some(second_quote) = rest.find('"') {
                            let route_path = &rest[..second_quote];
                            if route_path.starts_with('/') {
                                if in_api_routes {
                                    router_paths.insert(format!("/api/v1{}", route_path));
                                } else if in_root_app {
                                    router_paths.insert(route_path.to_string());
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // Assert every OpenAPI path is a registered router path
    for openapi_path in &openapi_paths {
        assert!(
            router_paths.contains(openapi_path),
            "OpenAPI path {} is not a registered router path in server/src/lib.rs",
            openapi_path
        );
    }
}
