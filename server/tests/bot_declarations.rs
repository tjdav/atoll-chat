use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use serde_json::{json, Value};
use tower::ServiceExt;

mod common;

fn valid_pubkey() -> String {
    URL_SAFE_NO_PAD.encode([9u8; 32])
}

async fn create_test_room(app: &axum::Router, user_token: &str, moderation_mode: &str) -> String {
    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms")
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "name": "Bot Room",
                "moderation_mode": moderation_mode
            })
            .to_string(),
        ))
        .unwrap();

    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::CREATED);
    let body: Value = serde_json::from_slice(
        &axum::body::to_bytes(res.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();

    body["id"].as_str().unwrap().to_string()
}

#[tokio::test]
async fn test_declarations_validation_matrix() {
    let (app, pool) = common::setup_test_app().await;

    // 1. Valid declarations
    let (u1_token, _) = common::create_test_user_and_session(&app, &pool).await;
    let req_valid = Request::builder()
        .method("POST")
        .uri("/api/v1/bots")
        .header(header::AUTHORIZATION, format!("Bearer {}", u1_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "display_name": "Valid Decl Bot",
                "bot_identity_pubkey": valid_pubkey(),
                "bot_command_pubkey": valid_pubkey(),
                "identity_pubkey": valid_pubkey(),
                "declared_scopes": ["post_message"],
                "declarations": {
                    "schema_version": 1,
                    "commands": [],
                    "settings": []
                }
            })
            .to_string(),
        ))
        .unwrap();

    let res_valid = app.clone().oneshot(req_valid).await.unwrap();
    assert_eq!(res_valid.status(), StatusCode::CREATED);
    let body_valid: Value = serde_json::from_slice(
        &axum::body::to_bytes(res_valid.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(body_valid["declarations"]["schema_version"], 1);

    // 2. Non-object declarations -> 400 invalid_declarations
    let req_non_obj = Request::builder()
        .method("POST")
        .uri("/api/v1/bots")
        .header(header::AUTHORIZATION, format!("Bearer {}", u1_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "display_name": "Bad Bot 1",
                "bot_identity_pubkey": valid_pubkey(),
                "bot_command_pubkey": valid_pubkey(),
                "identity_pubkey": valid_pubkey(),
                "declared_scopes": ["post_message"],
                "declarations": "not_an_object"
            })
            .to_string(),
        ))
        .unwrap();

    let res_non_obj = app.clone().oneshot(req_non_obj).await.unwrap();
    assert_eq!(res_non_obj.status(), StatusCode::BAD_REQUEST);

    // 3. Missing schema_version -> 400 invalid_declarations
    let req_missing_ver = Request::builder()
        .method("POST")
        .uri("/api/v1/bots")
        .header(header::AUTHORIZATION, format!("Bearer {}", u1_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "display_name": "Bad Bot 2",
                "bot_identity_pubkey": valid_pubkey(),
                "bot_command_pubkey": valid_pubkey(),
                "identity_pubkey": valid_pubkey(),
                "declared_scopes": ["post_message"],
                "declarations": {
                    "commands": [],
                    "settings": []
                }
            })
            .to_string(),
        ))
        .unwrap();

    let res_missing_ver = app.clone().oneshot(req_missing_ver).await.unwrap();
    assert_eq!(res_missing_ver.status(), StatusCode::BAD_REQUEST);

    // 4. Unsupported schema_version -> 400 unsupported_schema_version
    let (u2_token, _) = common::create_test_user_and_session(&app, &pool).await;
    let req_bad_ver = Request::builder()
        .method("POST")
        .uri("/api/v1/bots")
        .header(header::AUTHORIZATION, format!("Bearer {}", u2_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "display_name": "Bad Bot 3",
                "bot_identity_pubkey": valid_pubkey(),
                "bot_command_pubkey": valid_pubkey(),
                "identity_pubkey": valid_pubkey(),
                "declared_scopes": ["post_message"],
                "declarations": {
                    "schema_version": 2,
                    "commands": [],
                    "settings": []
                }
            })
            .to_string(),
        ))
        .unwrap();

    let res_bad_ver = app.clone().oneshot(req_bad_ver).await.unwrap();
    assert_eq!(res_bad_ver.status(), StatusCode::BAD_REQUEST);
    let body_bad_ver: Value = serde_json::from_slice(
        &axum::body::to_bytes(res_bad_ver.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(body_bad_ver["error"], "unsupported_schema_version");

    // 5. commands not array -> 400 invalid_declarations
    let req_commands_not_array = Request::builder()
        .method("POST")
        .uri("/api/v1/bots")
        .header(header::AUTHORIZATION, format!("Bearer {}", u2_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "display_name": "Bad Bot 4",
                "bot_identity_pubkey": valid_pubkey(),
                "bot_command_pubkey": valid_pubkey(),
                "identity_pubkey": valid_pubkey(),
                "declared_scopes": ["post_message"],
                "declarations": {
                    "schema_version": 1,
                    "commands": "not_an_array",
                    "settings": []
                }
            })
            .to_string(),
        ))
        .unwrap();

    let res_cmd_arr = app.clone().oneshot(req_commands_not_array).await.unwrap();
    assert_eq!(res_cmd_arr.status(), StatusCode::BAD_REQUEST);

    // 6. settings not array -> 400 invalid_declarations
    let req_settings_not_array = Request::builder()
        .method("POST")
        .uri("/api/v1/bots")
        .header(header::AUTHORIZATION, format!("Bearer {}", u2_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "display_name": "Bad Bot 5",
                "bot_identity_pubkey": valid_pubkey(),
                "bot_command_pubkey": valid_pubkey(),
                "identity_pubkey": valid_pubkey(),
                "declared_scopes": ["post_message"],
                "declarations": {
                    "schema_version": 1,
                    "commands": [],
                    "settings": "not_an_array"
                }
            })
            .to_string(),
        ))
        .unwrap();

    let res_set_arr = app.clone().oneshot(req_settings_not_array).await.unwrap();
    assert_eq!(res_set_arr.status(), StatusCode::BAD_REQUEST);

    // 7. Unknown top-level fields accepted
    let (u3_token, _) = common::create_test_user_and_session(&app, &pool).await;
    let req_unknown_fields = Request::builder()
        .method("POST")
        .uri("/api/v1/bots")
        .header(header::AUTHORIZATION, format!("Bearer {}", u3_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "display_name": "Extra Fields Bot",
                "bot_identity_pubkey": valid_pubkey(),
                "bot_command_pubkey": valid_pubkey(),
                "identity_pubkey": valid_pubkey(),
                "declared_scopes": ["post_message"],
                "declarations": {
                    "schema_version": 1,
                    "commands": [],
                    "settings": [],
                    "extra_field": "accepted"
                }
            })
            .to_string(),
        ))
        .unwrap();

    let res_unknown = app.clone().oneshot(req_unknown_fields).await.unwrap();
    assert_eq!(res_unknown.status(), StatusCode::CREATED);

    // 8. Size limit > 256 KiB -> 413 declarations_too_large
    let huge_string = "a".repeat(260 * 1024);
    let req_too_large = Request::builder()
        .method("POST")
        .uri("/api/v1/bots")
        .header(header::AUTHORIZATION, format!("Bearer {}", u3_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "display_name": "Huge Bot",
                "bot_identity_pubkey": valid_pubkey(),
                "bot_command_pubkey": valid_pubkey(),
                "identity_pubkey": valid_pubkey(),
                "declared_scopes": ["post_message"],
                "declarations": {
                    "schema_version": 1,
                    "commands": [huge_string],
                    "settings": []
                }
            })
            .to_string(),
        ))
        .unwrap();

    let res_too_large = app.clone().oneshot(req_too_large).await.unwrap();
    assert_eq!(res_too_large.status(), StatusCode::PAYLOAD_TOO_LARGE);
}

#[tokio::test]
async fn test_bot_declarations_crud_patch_and_audit() {
    let (app, pool) = common::setup_test_app().await;
    let (user_token, _) = common::create_test_user_and_session(&app, &pool).await;

    // 1. Create bot without declarations -> null in GET
    let req_create_no_decl = Request::builder()
        .method("POST")
        .uri("/api/v1/bots")
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "display_name": "No Decl Bot",
                "bot_identity_pubkey": valid_pubkey(),
                "bot_command_pubkey": valid_pubkey(),
                "identity_pubkey": valid_pubkey(),
                "declared_scopes": ["post_message"]
            })
            .to_string(),
        ))
        .unwrap();

    let res_create = app.clone().oneshot(req_create_no_decl).await.unwrap();
    assert_eq!(res_create.status(), StatusCode::CREATED);
    let body_create: Value = serde_json::from_slice(
        &axum::body::to_bytes(res_create.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();

    let bot_id = body_create["bot_id"].as_str().unwrap().to_string();
    assert!(body_create["declarations"].is_null());

    // GET /bots/:id confirms declarations is null
    let req_get1 = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/bots/{}", bot_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .body(Body::empty())
        .unwrap();

    let res_get1 = app.clone().oneshot(req_get1).await.unwrap();
    assert_eq!(res_get1.status(), StatusCode::OK);
    let body_get1: Value = serde_json::from_slice(
        &axum::body::to_bytes(res_get1.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    assert!(body_get1["declarations"].is_null());

    // 2. PATCH /bots/:id with empty body -> 400 no_fields_to_update
    let req_patch_empty = Request::builder()
        .method("PATCH")
        .uri(format!("/api/v1/bots/{}", bot_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({}).to_string()))
        .unwrap();

    let res_patch_empty = app.clone().oneshot(req_patch_empty).await.unwrap();
    assert_eq!(res_patch_empty.status(), StatusCode::BAD_REQUEST);

    // Grant bot to a room to test room channel publishing
    let room_id = create_test_room(&app, &user_token, "messenger").await;

    let req_grant = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/bots", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "bot_id": bot_id,
                "scopes": ["post_message"]
            })
            .to_string(),
        ))
        .unwrap();

    let res_grant = app.clone().oneshot(req_grant).await.unwrap();
    assert_eq!(res_grant.status(), StatusCode::CREATED);

    // 3. PATCH /bots/:id updating declarations
    let new_declarations = json!({
        "schema_version": 1,
        "commands": [{
            "name": "echo",
            "description": "Echo back message"
        }],
        "settings": [{
            "key": "prefix",
            "type": "string"
        }]
    });

    let req_patch_decl = Request::builder()
        .method("PATCH")
        .uri(format!("/api/v1/bots/{}", bot_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({ "declarations": new_declarations }).to_string(),
        ))
        .unwrap();

    let res_patch_decl = app.clone().oneshot(req_patch_decl).await.unwrap();
    assert_eq!(res_patch_decl.status(), StatusCode::OK);
    let body_patch_decl: Value = serde_json::from_slice(
        &axum::body::to_bytes(res_patch_decl.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(body_patch_decl["declarations"], new_declarations);

    // Verify audit log entry for declaration_update
    let audit_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM audit_log WHERE action = 'bot.declaration_update' AND target_id = ?",
    )
    .bind(&bot_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(audit_count, 1);

    // 4. No-op guard: sending same declarations does NOT create another audit row or publish event
    let req_patch_noop = Request::builder()
        .method("PATCH")
        .uri(format!("/api/v1/bots/{}", bot_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({ "declarations": new_declarations }).to_string(),
        ))
        .unwrap();

    let res_patch_noop = app.clone().oneshot(req_patch_noop).await.unwrap();
    assert_eq!(res_patch_noop.status(), StatusCode::OK);

    let audit_count_after_noop: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM audit_log WHERE action = 'bot.declaration_update' AND target_id = ?",
    )
    .bind(&bot_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(audit_count_after_noop, 1); // No new audit row

    // 5. Clear declarations via null
    let req_patch_clear = Request::builder()
        .method("PATCH")
        .uri(format!("/api/v1/bots/{}", bot_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "declarations": null }).to_string()))
        .unwrap();

    let res_patch_clear = app.clone().oneshot(req_patch_clear).await.unwrap();
    let status = res_patch_clear.status();
    let body_bytes = axum::body::to_bytes(res_patch_clear.into_body(), usize::MAX)
        .await
        .unwrap();
    if status != StatusCode::OK {
        panic!(
            "res_patch_clear failed with status {}: {}",
            status,
            String::from_utf8_lossy(&body_bytes)
        );
    }
    let body_clear: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert!(body_clear["declarations"].is_null());

    let audit_count_after_clear: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM audit_log WHERE action = 'bot.declaration_update' AND target_id = ?",
    )
    .bind(&bot_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(audit_count_after_clear, 2);
}

#[tokio::test]
async fn test_bot_declarations_gdpr_export_and_deletion() {
    let (app, pool) = common::setup_test_app().await;
    let (user_token, user_id) = common::create_test_user_and_session(&app, &pool).await;

    // Create a bot with declarations
    let decl = json!({
        "schema_version": 1,
        "commands": [{"name": "test"}],
        "settings": []
    });

    let req_create = Request::builder()
        .method("POST")
        .uri("/api/v1/bots")
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "display_name": "GDPR Bot",
                "bot_identity_pubkey": valid_pubkey(),
                "bot_command_pubkey": valid_pubkey(),
                "identity_pubkey": valid_pubkey(),
                "declared_scopes": ["post_message"],
                "declarations": decl
            })
            .to_string(),
        ))
        .unwrap();

    let res_create = app.clone().oneshot(req_create).await.unwrap();
    assert_eq!(res_create.status(), StatusCode::CREATED);

    // Export user data
    let export_bytes = server::gdpr::build_export(&pool, &user_id).await.unwrap();
    let mut zip = zip::ZipArchive::new(std::io::Cursor::new(export_bytes)).unwrap();

    let mut bot_accounts_file = zip.by_name("bot_accounts.json").unwrap();
    let mut contents = String::new();
    std::io::Read::read_to_string(&mut bot_accounts_file, &mut contents).unwrap();
    let exported_bots: Value = serde_json::from_str(&contents).unwrap();

    assert!(exported_bots.is_array());
    assert_eq!(exported_bots[0]["display_name"], "GDPR Bot");
    assert_eq!(exported_bots[0]["declarations"], decl);

    // Delete user account (anonymise)
    server::gdpr::anonymise_user(&pool, &user_id).await.unwrap();

    // Verify bot_accounts row was deleted
    let bot_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM bot_accounts WHERE owner_user_id = ?")
            .bind(&user_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(bot_count, 0);
}
