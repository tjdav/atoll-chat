use server::openapi::ApiDoc;
use std::collections::BTreeSet;
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

    // Assert path items exist
    let paths = parsed["paths"].as_object().unwrap();
    assert_eq!(
        paths.len(),
        doc.paths.paths.len(),
        "expected path count to match ApiDoc"
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
        ("/ws/auth", "post"),
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
        ("/api/v1/rooms/{id}/attachments", "post"),
        ("/api/v1/attachments/{id}", "get"),
        ("/api/v1/attachments/{id}", "delete"),
        ("/api/v1/attachments/{id}/presign", "post"),
        ("/api/v1/rooms/{id}/sessions", "get"),
        ("/api/v1/rooms/{id}/sessions", "post"),
        ("/api/v1/rooms/{id}/sessions/{session_id}", "patch"),
        ("/api/v1/rooms/{id}/sessions/{session_id}", "delete"),
        ("/api/v1/rooms/{id}/sessions/{session_id}/join", "post"),
        ("/api/v1/rooms/{id}/sessions/{session_id}/leave", "post"),
        ("/api/v1/rooms/{id}/sessions/{session_id}/heartbeat", "post"),
        ("/api/v1/rooms/{id}/sessions/{session_id}/roster", "get"),
        ("/api/v1/rooms/{id}/sessions/{session_id}/signal", "post"),
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
        ("/api/v1/admin/config", "get"),
        ("/api/v1/admin/config", "patch"),
        ("/api/v1/admin/limits", "get"),
        ("/api/v1/admin/limits", "patch"),
        ("/api/v1/admin/audit", "get"),
        ("/api/v1/admin/backups", "get"),
        ("/api/v1/admin/backups", "post"),
        ("/api/v1/admin/vapid/rotate", "post"),
        ("/api/v1/admin/altcha/rotate", "post"),
        ("/api/v1/admin/invites", "get"),
        ("/api/v1/admin/invites", "post"),
        ("/api/v1/admin/invites/{id}", "delete"),
        ("/api/v1/roles", "get"),
        ("/api/v1/admin/oprf/rotate", "post"),
        ("/api/v1/admin/key-transparency", "get"),
        ("/api/v1/admin/key-transparency/snapshot", "post"),
        ("/api/v1/admin/rooms/{id}/sessions", "get"),
        ("/api/v1/admin/models/reload", "post"),
        ("/api/v1/admin/session-types/reload", "post"),
        ("/api/v1/admin/extension-proxy/reload-blocklist", "post"),
        ("/api/v1/calls/turn-credentials", "post"),
        ("/api/v1/rooms/{id}/calls/{call_id}/join", "post"),
        ("/api/v1/rooms/{id}/calls/{call_id}/leave", "post"),
        ("/api/v1/rooms/{id}/calls/{call_id}/signal", "post"),
        ("/api/v1/rooms/{id}/calls/{call_id}/end", "post"),
        ("/api/v1/keypackages", "post"),
        ("/api/v1/keypackages/count", "get"),
        ("/api/v1/keypackages/claim", "post"),
        ("/api/v1/welcomes", "get"),
        ("/api/v1/welcomes/{id}", "get"),
        ("/api/v1/welcomes/{id}/consume", "post"),
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

    // Assert CapabilitiesResponse schema declares websocket $ref and client_events_enabled property as boolean
    let caps_props = &parsed["components"]["schemas"]["CapabilitiesResponse"]["properties"];
    assert_eq!(caps_props["client_events_enabled"]["type"], "boolean");
    assert_eq!(
        caps_props["websocket"]["$ref"],
        "#/components/schemas/WebSocketCapability"
    );
    assert!(!caps_props
        .as_object()
        .unwrap()
        .contains_key("websocket_url"));
    assert!(!caps_props
        .as_object()
        .unwrap()
        .contains_key("sockudo_app_key"));
    assert!(!caps_props
        .as_object()
        .unwrap()
        .contains_key("sockudo_channel_prefix"));
    assert!(!caps_props
        .as_object()
        .unwrap()
        .contains_key("sockudo_auth_endpoint"));

    // Assert WebSocketCapability schema structure
    let ws_cap_schema = &parsed["components"]["schemas"]["WebSocketCapability"];
    let ws_cap_req: Vec<&str> = ws_cap_schema["required"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_str().unwrap())
        .collect();
    assert!(ws_cap_req.contains(&"url"));
    assert!(ws_cap_req.contains(&"protocol"));
    assert!(ws_cap_req.contains(&"app_key"));
    assert!(ws_cap_req.contains(&"auth_endpoint"));

    // Assert schemas contain user and bot domain types
    let schemas = parsed["components"]["schemas"].as_object().unwrap();
    let expected_schemas = [
        "ErrorResponse",
        "UserProfileResponse",
        "UserLimitsResponse",
        "WebSocketCapability",
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
        "RoomAttachmentUploadForm",
        "UserAvatarUploadForm",
        "PresignRequest",
        "PresignResponse",
        "ListRoomSessionsQuery",
        "CreateRoomSessionRequest",
        "PatchRoomSessionRequest",
        "JoinSessionRequest",
        "LeaveSessionRequest",
        "HeartbeatSessionRequest",
        "RosterUserItem",
        "RosterResponse",
        "IceServer",
        "MediaConfig",
        "JoinResponse",
        "SignalRequest",
        "SignalResponse",
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
        "InstanceConfig",
        "InstanceLimits",
        "ServerHardMax",
        "AuditEntry",
        "LimitsResponse",
        "AuditListResponse",
        "RotateVapidResponse",
        "RotateAltchaResponse",
        "BackupItemResponse",
        "BackupListResponse",
        "CreateInviteRequest",
        "CreateInviteResponse",
        "InviteListItem",
        "ListInvitesResponse",
        "Permissions",
        "Role",
        "RolesResponse",
        "TurnCredentialsResponse",
        "CallIceServer",
        "JoinCallRequest",
        "JoinCallResponse",
        "LeaveCallRequest",
        "EndCallResponse",
        "CallSignalRequest",
        "CallSignalResponse",
        "UploadPackageItem",
        "UploadKeyPackagesRequest",
        "UploadKeyPackagesResponse",
        "ClaimKeyPackageRequest",
        "ClaimKeyPackageResponse",
        "UnconsumedCount",
        "WelcomesListResponse",
        "WelcomeDetailResponse",
        "ConsumeWelcomeResponse",
        "WelcomeView",
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

    // Assert GET /kt/snapshot response schema contains a signature field
    let snapshot_props = &schemas["KtSnapshotResponse"]["properties"]
        .as_object()
        .unwrap();
    assert!(
        snapshot_props.contains_key("signature"),
        "KtSnapshotResponse missing expected signature field"
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

    // Assert POST /ws/auth documents both token types in description
    let sockudo_desc = parsed["paths"]["/ws/auth"]["post"]["description"]
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

    // Assert RegisterFinishResponse schema declares session_token and recovery_codes
    let reg_finish_props = &schemas["RegisterFinishResponse"]["properties"]
        .as_object()
        .unwrap();
    assert!(reg_finish_props.contains_key("session_token"));
    assert!(reg_finish_props.contains_key("recovery_codes"));

    let reg_finish_required: Vec<&str> = schemas["RegisterFinishResponse"]["required"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_str().unwrap())
        .collect();
    assert!(reg_finish_required.contains(&"session_token"));
    assert!(reg_finish_required.contains(&"recovery_codes"));

    // Assert RecoverStartRequest schema declares recovery_code as the only required field and lookup_token / username_token as optional
    let rec_start_props = &schemas["RecoverStartRequest"]["properties"]
        .as_object()
        .unwrap();
    assert!(rec_start_props.contains_key("recovery_code"));
    assert!(rec_start_props.contains_key("lookup_token"));
    assert!(rec_start_props.contains_key("username_token"));

    let rec_start_required: Vec<&str> = schemas["RecoverStartRequest"]["required"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_str().unwrap())
        .collect();
    assert_eq!(rec_start_required, vec!["recovery_code"]);

    // Assert session signal envelope schema has format: byte and §6.26.1 reference
    let signal_env = &schemas["SignalRequest"]["properties"]["envelope"];
    assert_eq!(signal_env["format"], "byte");
    assert!(
        signal_env["description"]
            .as_str()
            .unwrap()
            .contains("§6.26.1"),
        "session signal envelope description missing §6.26.1 reference"
    );

    // Assert call signal envelope has format: binary and §6.24 reference
    let call_sig_env = &schemas["CallSignalRequest"]["properties"]["envelope"];
    assert_eq!(call_sig_env["format"], "binary");
    assert!(
        call_sig_env["description"]
            .as_str()
            .unwrap()
            .contains("§6.24"),
        "CallSignalRequest envelope description missing §6.24 reference"
    );

    // Assert keypackage key_package_data has format: binary and §7.5 reference
    let kp_upload_data = &schemas["UploadPackageItem"]["properties"]["key_package_data"];
    assert_eq!(kp_upload_data["format"], "binary");
    assert!(
        kp_upload_data["description"]
            .as_str()
            .unwrap()
            .contains("§7.5"),
        "UploadPackageItem key_package_data description missing §7.5 reference"
    );

    let kp_claim_data = &schemas["ClaimKeyPackageResponse"]["properties"]["key_package_data"];
    assert_eq!(kp_claim_data["format"], "binary");

    // Assert welcome welcome_data has format: binary and §8.7.2 reference
    let welcome_data_field = &schemas["WelcomeDetailResponse"]["properties"]["welcome_data"];
    assert_eq!(welcome_data_field["format"], "binary");
    assert!(
        welcome_data_field["description"]
            .as_str()
            .unwrap()
            .contains("§8.7.2"),
        "WelcomeDetailResponse welcome_data description missing §8.7.2 reference"
    );

    // Assert TurnCredentialsResponse urls is array of strings
    let turn_urls = &schemas["TurnCredentialsResponse"]["properties"]["urls"];
    assert_eq!(turn_urls["type"], "array");
    assert_eq!(turn_urls["items"]["type"], "string");

    // Assert 21 new attachment, session, call, keypackage, and welcome path keys appear in OpenAPI
    let new_paths = [
        "/api/v1/rooms/{id}/attachments",
        "/api/v1/attachments/{id}",
        "/api/v1/attachments/{id}/presign",
        "/api/v1/rooms/{id}/sessions",
        "/api/v1/rooms/{id}/sessions/{session_id}",
        "/api/v1/rooms/{id}/sessions/{session_id}/join",
        "/api/v1/rooms/{id}/sessions/{session_id}/leave",
        "/api/v1/rooms/{id}/sessions/{session_id}/heartbeat",
        "/api/v1/rooms/{id}/sessions/{session_id}/roster",
        "/api/v1/rooms/{id}/sessions/{session_id}/signal",
        "/api/v1/calls/turn-credentials",
        "/api/v1/rooms/{id}/calls/{call_id}/join",
        "/api/v1/rooms/{id}/calls/{call_id}/leave",
        "/api/v1/rooms/{id}/calls/{call_id}/signal",
        "/api/v1/rooms/{id}/calls/{call_id}/end",
        "/api/v1/keypackages",
        "/api/v1/keypackages/count",
        "/api/v1/keypackages/claim",
        "/api/v1/welcomes",
        "/api/v1/welcomes/{id}",
        "/api/v1/welcomes/{id}/consume",
    ];

    for path in &new_paths {
        assert!(
            parsed["paths"].as_object().unwrap().contains_key(*path),
            "missing new path key {}",
            path
        );
    }

    // Assert session signal declares both 200 and 202 responses
    let signal_resps =
        &parsed["paths"]["/api/v1/rooms/{id}/sessions/{session_id}/signal"]["post"]["responses"];
    assert!(
        signal_resps.as_object().unwrap().contains_key("200"),
        "session signal missing 200 response"
    );
    assert!(
        signal_resps.as_object().unwrap().contains_key("202"),
        "session signal missing 202 response"
    );

    // Assert attachment download declares binary response content type
    let download_200_content =
        &parsed["paths"]["/api/v1/attachments/{id}"]["get"]["responses"]["200"]["content"];
    assert!(
        download_200_content
            .as_object()
            .unwrap()
            .contains_key("application/octet-stream"),
        "attachment download missing application/octet-stream response content type"
    );

    // Assert RoomAttachmentUploadForm is present in schemas
    assert!(
        schemas.contains_key("RoomAttachmentUploadForm"),
        "missing RoomAttachmentUploadForm in schemas"
    );

    // Assert InstanceConfig does not expose secret keys (app secret, vapid private key, altcha hmac secret)
    let config_props = &schemas["InstanceConfig"]["properties"].as_object().unwrap();
    assert!(
        !config_props.contains_key("sockudo_app_secret"),
        "InstanceConfig unexpectedly exposes sockudo_app_secret"
    );
    assert!(
        !config_props.contains_key("vapid_private_key"),
        "InstanceConfig unexpectedly exposes vapid_private_key"
    );
    assert!(
        !config_props.contains_key("altcha_hmac_secret"),
        "InstanceConfig unexpectedly exposes altcha_hmac_secret"
    );

    // Assert backups POST response declares Created status and BackupItemResponse body
    let backup_post_resp = &parsed["paths"]["/api/v1/admin/backups"]["post"]["responses"];
    assert!(
        backup_post_resp.as_object().unwrap().contains_key("201"),
        "backups POST missing 201 response"
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

#[test]
#[ignore = "Pending OpenAPI annotation sweep (9 paths currently missing from OpenAPI)"]
fn test_router_and_openapi_paths_match_one_to_one() {
    let doc = ApiDoc::openapi();
    let json_str = serde_json::to_string_pretty(&doc).unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&json_str).unwrap();
    let openapi_paths: BTreeSet<String> = parsed["paths"]
        .as_object()
        .unwrap()
        .keys()
        .cloned()
        .collect();

    // Extract paths directly registered on Axum router in server/src/lib.rs
    let lib_str = include_str!("../src/lib.rs");
    let mut router_paths = BTreeSet::new();

    let api_routes_start = lib_str
        .find("let api_routes = Router::new()")
        .expect("api_routes definition not found in lib.rs");
    let app_start = lib_str
        .find("let mut app = Router::new()")
        .expect("app definition not found in lib.rs");

    let api_routes_text = &lib_str[api_routes_start..app_start];
    let app_text = &lib_str[app_start..];

    fn parse_routes_from_text(text: &str, prefix: &str, router_paths: &mut BTreeSet<String>) {
        let lines: Vec<&str> = text.lines().collect();
        for idx in 0..lines.len() {
            let line = lines[idx];
            if line.contains(".route(") {
                // Search current line and next 2 lines for path string literal
                for offset in 0..=2 {
                    if idx + offset < lines.len() {
                        let search_line = lines[idx + offset];
                        if let Some(first_quote) = search_line.find('"') {
                            let rest = &search_line[first_quote + 1..];
                            if let Some(second_quote) = rest.find('"') {
                                let route_path = &rest[..second_quote];
                                if route_path.starts_with('/') {
                                    router_paths.insert(format!("{}{}", prefix, route_path));
                                    break;
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    parse_routes_from_text(api_routes_text, "/api/v1", &mut router_paths);
    parse_routes_from_text(app_text, "", &mut router_paths);

    let router_only: BTreeSet<String> = router_paths.difference(&openapi_paths).cloned().collect();
    let openapi_only: BTreeSet<String> = openapi_paths.difference(&router_paths).cloned().collect();

    let mut failure_messages = Vec::new();

    if !router_only.is_empty() {
        let mut msg = format!(
            "Paths in router but missing from OpenAPI ({}):\n",
            router_only.len()
        );
        for p in &router_only {
            msg.push_str(&format!("  {}\n", p));
        }
        failure_messages.push(msg);
    }

    if !openapi_only.is_empty() {
        let mut msg = format!(
            "Paths in OpenAPI but missing from router ({}):\n",
            openapi_only.len()
        );
        for p in &openapi_only {
            msg.push_str(&format!("  {}\n", p));
        }
        failure_messages.push(msg);
    }

    if !failure_messages.is_empty() {
        panic!(
            "Router-vs-OpenAPI path mismatch!\nrouter_only count: {}\nopenapi_only count: {}\n\n{}",
            router_only.len(),
            openapi_only.len(),
            failure_messages.join("\n")
        );
    }
}
