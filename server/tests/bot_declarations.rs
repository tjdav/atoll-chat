use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use serde_json::{json, Value};
use tower::ServiceExt;

mod common;

fn valid_pubkey() -> String {
    URL_SAFE_NO_PAD.encode([7u8; 32])
}

#[tokio::test]
async fn test_bot_declarations_validation_matrix() {
    let (app, pool) = common::setup_test_app().await;

    // Helper closure to send POST /bots with a fresh user session (to avoid rate limits)
    let send_post_req = |app: axum::Router, token: String, decl: Value| async move {
        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/bots")
            .header(header::AUTHORIZATION, format!("Bearer {}", token))
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(
                json!({
                    "display_name": "Decl Bot",
                    "bot_identity_pubkey": valid_pubkey(),
                    "bot_command_pubkey": valid_pubkey(),
                    "identity_pubkey": valid_pubkey(),
                    "declared_scopes": ["post_message"],
                    "declarations": decl
                })
                .to_string(),
            ))
            .unwrap();
        app.oneshot(req).await.unwrap()
    };

    let get_token = |app: &axum::Router, pool: &sqlx::SqlitePool| {
        let app = app.clone();
        let pool = pool.clone();
        async move { common::create_test_user_and_session(&app, &pool).await.0 }
    };

    // 1. Valid declarations
    let tok = get_token(&app, &pool).await;
    let res = send_post_req(
        app.clone(),
        tok,
        json!({
            "schema_version": 1,
            "commands": [{"name": "ping", "description": "Ping command"}],
            "settings": [{"key": "mode", "type": "string"}]
        }),
    )
    .await;
    assert_eq!(res.status(), StatusCode::CREATED);

    // 2. Non-object declarations -> 400 invalid_declarations
    let tok = get_token(&app, &pool).await;
    let res = send_post_req(app.clone(), tok, json!("not_an_object")).await;
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);

    // 3. Missing schema_version -> 400 invalid_declarations
    let tok = get_token(&app, &pool).await;
    let res = send_post_req(
        app.clone(),
        tok,
        json!({
            "commands": [],
            "settings": []
        }),
    )
    .await;
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);

    // 4. Non-integer schema_version -> 400 invalid_declarations
    let tok = get_token(&app, &pool).await;
    let res = send_post_req(
        app.clone(),
        tok,
        json!({
            "schema_version": "1",
            "commands": [],
            "settings": []
        }),
    )
    .await;
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);

    // 5. Unsupported schema_version -> 400 unsupported_schema_version
    let tok = get_token(&app, &pool).await;
    let res = send_post_req(
        app.clone(),
        tok,
        json!({
            "schema_version": 2,
            "commands": [],
            "settings": []
        }),
    )
    .await;
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);

    // 6. Non-array commands -> 400 invalid_declarations
    let tok = get_token(&app, &pool).await;
    let res = send_post_req(
        app.clone(),
        tok,
        json!({
            "schema_version": 1,
            "commands": "not_an_array",
            "settings": []
        }),
    )
    .await;
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);

    // 7. Non-array settings -> 400 invalid_declarations
    let tok = get_token(&app, &pool).await;
    let res = send_post_req(
        app.clone(),
        tok,
        json!({
            "schema_version": 1,
            "commands": [],
            "settings": {}
        }),
    )
    .await;
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);

    // 8. Unknown top-level fields accepted and arbitrary nested content opaque
    let tok = get_token(&app, &pool).await;
    let res = send_post_req(
        app.clone(),
        tok,
        json!({
            "schema_version": 1,
            "commands": [{"arbitrary_key": {"deeply": ["nested", 123, true]}}],
            "settings": [],
            "unknown_extra_field": "accepted_and_ignored"
        }),
    )
    .await;
    assert_eq!(res.status(), StatusCode::CREATED);

    // 9. Bounded size limit > 256 KiB -> 413 declarations_too_large
    let tok = get_token(&app, &pool).await;
    let huge_string = "a".repeat(260 * 1024);
    let res = send_post_req(
        app.clone(),
        tok,
        json!({
            "schema_version": 1,
            "commands": [huge_string],
            "settings": []
        }),
    )
    .await;
    assert_eq!(res.status(), StatusCode::PAYLOAD_TOO_LARGE);
}

#[tokio::test]
async fn test_bot_declarations_crud_and_patch() {
    let (app, pool) = common::setup_test_app().await;
    let (user_token, user_id) = common::create_test_user_and_session(&app, &pool).await;

    // 1. POST /bots without declarations -> stores NULL
    let req_no_decl = Request::builder()
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

    let res_no_decl = app.clone().oneshot(req_no_decl).await.unwrap();
    assert_eq!(res_no_decl.status(), StatusCode::CREATED);
    let body_no_decl: Value = serde_json::from_slice(
        &axum::body::to_bytes(res_no_decl.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    let bot_id = body_no_decl["bot_id"].as_str().unwrap().to_string();
    assert!(body_no_decl["declarations"].is_null());

    // 2. GET /bots/:id -> returns declarations: null
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

    // 3. PATCH /bots/:id with empty payload -> 400 no_fields_to_update
    let req_patch_empty = Request::builder()
        .method("PATCH")
        .uri(format!("/api/v1/bots/{}", bot_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({}).to_string()))
        .unwrap();

    let res_patch_empty = app.clone().oneshot(req_patch_empty).await.unwrap();
    assert_eq!(res_patch_empty.status(), StatusCode::BAD_REQUEST);

    // 4. PATCH /bots/:id with valid declarations
    let decl_payload = json!({
        "schema_version": 1,
        "commands": [{"name": "echo", "description": "Echo back"}],
        "settings": []
    });

    let req_patch = Request::builder()
        .method("PATCH")
        .uri(format!("/api/v1/bots/{}", bot_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({ "declarations": decl_payload }).to_string(),
        ))
        .unwrap();

    let res_patch = app.clone().oneshot(req_patch).await.unwrap();
    assert_eq!(res_patch.status(), StatusCode::OK);
    let body_patch: Value = serde_json::from_slice(
        &axum::body::to_bytes(res_patch.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(body_patch["declarations"], decl_payload);

    // Verify audit entry created with correct metadata (and NO declarations content)
    let audit_row = sqlx::query(
        "SELECT action, target_type, target_id, metadata FROM audit_log WHERE action = 'bot.declaration_update'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();

    let action: String = sqlx::Row::get(&audit_row, "action");
    let target_type: Option<String> = sqlx::Row::get(&audit_row, "target_type");
    let target_id: Option<String> = sqlx::Row::get(&audit_row, "target_id");
    let metadata_str: Option<String> = sqlx::Row::get(&audit_row, "metadata");

    assert_eq!(action, "bot.declaration_update");
    assert_eq!(target_type.as_deref(), Some("bot"));
    assert_eq!(target_id.as_deref(), Some(bot_id.as_str()));

    let raw_meta = metadata_str.unwrap();
    let metadata_val: Value = serde_json::from_str(&raw_meta).unwrap();
    assert_eq!(metadata_val, json!({ "bot_id": bot_id, "room_id": null }));
    assert!(
        !raw_meta.contains("echo"),
        "Audit metadata MUST NOT contain declarations contents"
    );

    // 5. No-op PATCH with identical declarations -> 200 OK without writing new audit row
    let audit_count_before: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM audit_log WHERE action = 'bot.declaration_update'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();

    let req_noop = Request::builder()
        .method("PATCH")
        .uri(format!("/api/v1/bots/{}", bot_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({ "declarations": decl_payload }).to_string(),
        ))
        .unwrap();

    let res_noop = app.clone().oneshot(req_noop).await.unwrap();
    assert_eq!(res_noop.status(), StatusCode::OK);

    let audit_count_after: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM audit_log WHERE action = 'bot.declaration_update'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        audit_count_before, audit_count_after,
        "No-op guard must suppress duplicate audit log"
    );

    // 6. Clear declarations with null
    let req_clear = Request::builder()
        .method("PATCH")
        .uri(format!("/api/v1/bots/{}", bot_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "declarations": null }).to_string()))
        .unwrap();

    let res_clear = app.clone().oneshot(req_clear).await.unwrap();
    assert_eq!(res_clear.status(), StatusCode::OK);
    let body_clear: Value = serde_json::from_slice(
        &axum::body::to_bytes(res_clear.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    assert!(body_clear["declarations"].is_null());

    // 7. GDPR export assertion
    // Set declarations again so we can verify export
    let req_set_again = Request::builder()
        .method("PATCH")
        .uri(format!("/api/v1/bots/{}", bot_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({ "declarations": decl_payload }).to_string(),
        ))
        .unwrap();
    let _ = app.clone().oneshot(req_set_again).await.unwrap();

    let zip_bytes = server::gdpr::build_export(&pool, &user_id).await.unwrap();
    let cursor = std::io::Cursor::new(zip_bytes);
    let mut archive = zip::ZipArchive::new(cursor).unwrap();

    let decl_file = archive.by_name("bot_declarations.json");
    assert!(
        decl_file.is_ok(),
        "GDPR export must contain bot_declarations.json"
    );

    let mut file = decl_file.unwrap();
    let mut content = String::new();
    std::io::Read::read_to_string(&mut file, &mut content).unwrap();

    let exported_list: Value = serde_json::from_str(&content).unwrap();
    assert!(exported_list.is_array());
    assert_eq!(exported_list[0]["bot_id"], bot_id);
    assert_eq!(exported_list[0]["declarations"], decl_payload);
}
