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
async fn test_bot_schema_and_constraints() {
    let pool = common::setup_test_db().await;

    sqlx::query(
        "INSERT INTO users (id, username_token, opaque_registration, identity_pubkey) VALUES ('u_1', 'tok_1', X'1234', 'pk_1')",
    )
    .execute(&pool)
    .await
    .unwrap();

    // 1. Assert bot_accounts pubkey NOT NULL constraint
    let err_null_pubkey = sqlx::query(
        "INSERT INTO bot_accounts (id, display_name, owner_user_id) VALUES ('b_err', 'Err Bot', 'u_1')",
    )
    .execute(&pool)
    .await;
    assert!(
        err_null_pubkey.is_err(),
        "Null pubkey must fail NOT NULL constraint"
    );

    // 2. Assert key_transparency_log XOR constraint (Phase 16 regression check)
    let err_kt_xor = sqlx::query(
        "INSERT INTO key_transparency_log (user_id, bot_id, identity_pubkey) VALUES ('u_1', 'b_1', 'pk')",
    )
    .execute(&pool)
    .await;
    assert!(
        err_kt_xor.is_err(),
        "Both user_id and bot_id set must fail XOR check"
    );

    // 3. Assert bot_declared_scopes out-of-vocabulary CHECK constraint
    sqlx::query(
        r#"
        INSERT INTO bot_accounts (id, display_name, owner_user_id, bot_identity_pubkey, bot_command_pubkey, identity_pubkey)
        VALUES ('b_test_scope', 'Test Bot', 'u_1', 'pk1', 'pk2', 'pk3')
        "#,
    )
    .execute(&pool)
    .await
    .unwrap();

    let err_scope_check = sqlx::query(
        "INSERT INTO bot_declared_scopes (bot_id, scope) VALUES ('b_test_scope', 'invalid_scope')",
    )
    .execute(&pool)
    .await;
    assert!(
        err_scope_check.is_err(),
        "Invalid scope in bot_declared_scopes must fail CHECK"
    );
}

#[tokio::test]
async fn test_bot_crud_and_events() {
    let (app, pool) = common::setup_test_app().await;
    let (user_token, user_id) = common::create_test_user_and_session(&app, &pool).await;

    // 1. POST /bots — Missing scope dependency
    let req_bad_scope = Request::builder()
        .method("POST")
        .uri("/api/v1/bots")
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "display_name": "Test Bot",
                "bot_identity_pubkey": valid_pubkey(),
                "bot_command_pubkey": valid_pubkey(),
                "identity_pubkey": valid_pubkey(),
                "declared_scopes": ["post_reaction"] // Missing read_content
            })
            .to_string(),
        ))
        .unwrap();

    let res_bad_scope = app.clone().oneshot(req_bad_scope).await.unwrap();
    assert_eq!(res_bad_scope.status(), StatusCode::BAD_REQUEST);

    // 2. POST /bots — Happy path
    let req_create = Request::builder()
        .method("POST")
        .uri("/api/v1/bots")
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "display_name": "Relay Bot",
                "bot_identity_pubkey": valid_pubkey(),
                "bot_command_pubkey": valid_pubkey(),
                "identity_pubkey": valid_pubkey(),
                "declared_scopes": ["post_message", "read_content"]
            })
            .to_string(),
        ))
        .unwrap();

    let res_create = app.clone().oneshot(req_create).await.unwrap();
    assert_eq!(res_create.status(), StatusCode::CREATED);

    let body_create: Value = serde_json::from_slice(
        &axum::body::to_bytes(res_create.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();

    let bot_id = body_create["bot_id"].as_str().unwrap().to_string();
    let initial_bot_token = body_create["bot_token"].as_str().unwrap().to_string();
    assert_eq!(body_create["owner_user_id"], user_id);
    assert_eq!(body_create["display_name"], "Relay Bot");

    // 3. GET /bots/:id — By owner
    let req_get = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/bots/{}", bot_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .body(Body::empty())
        .unwrap();

    let res_get = app.clone().oneshot(req_get).await.unwrap();
    assert_eq!(res_get.status(), StatusCode::OK);
    let body_get: Value = serde_json::from_slice(
        &axum::body::to_bytes(res_get.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(body_get["bot_id"], bot_id);
    assert!(body_get.get("bot_token").is_none());

    // 4. GET /bots/:id — Authenticate as bot using bot token
    let req_get_bot_token = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/bots/{}", bot_id))
        .header(
            header::AUTHORIZATION,
            format!("Bearer {}", initial_bot_token),
        )
        .body(Body::empty())
        .unwrap();

    let res_get_bot_token = app.clone().oneshot(req_get_bot_token).await.unwrap();
    assert_eq!(res_get_bot_token.status(), StatusCode::OK);

    // 5. GET /bots/:id — Non-owner user returns 403
    let (other_token, _) = common::create_test_user_and_session(&app, &pool).await;
    let req_get_other = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/bots/{}", bot_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", other_token))
        .body(Body::empty())
        .unwrap();

    let res_get_other = app.clone().oneshot(req_get_other).await.unwrap();
    assert_eq!(res_get_other.status(), StatusCode::FORBIDDEN);

    // 6. PATCH /bots/:id — Rename bot
    let req_patch = Request::builder()
        .method("PATCH")
        .uri(format!("/api/v1/bots/{}", bot_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({ "display_name": "Updated Relay Bot" }).to_string(),
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
    assert_eq!(body_patch["display_name"], "Updated Relay Bot");

    // 7. DELETE /bots/:id — Soft-delete
    let req_delete = Request::builder()
        .method("DELETE")
        .uri(format!("/api/v1/bots/{}", bot_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .body(Body::empty())
        .unwrap();

    let res_delete = app.clone().oneshot(req_delete).await.unwrap();
    assert_eq!(res_delete.status(), StatusCode::NO_CONTENT);

    // Subsequent GET should return 404
    let req_get_deleted = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/bots/{}", bot_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .body(Body::empty())
        .unwrap();

    let res_get_deleted = app.clone().oneshot(req_get_deleted).await.unwrap();
    assert_eq!(res_get_deleted.status(), StatusCode::NOT_FOUND);

    // Revoked token should return 401
    let req_token_revoked = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/bots/{}", bot_id))
        .header(
            header::AUTHORIZATION,
            format!("Bearer {}", initial_bot_token),
        )
        .body(Body::empty())
        .unwrap();

    let res_token_revoked = app.clone().oneshot(req_token_revoked).await.unwrap();
    assert_eq!(res_token_revoked.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn test_bot_tokens_and_rate_limits() {
    let (app, pool) = common::setup_test_app().await;
    let (user_token, _) = common::create_test_user_and_session(&app, &pool).await;

    // Create a bot first
    let req_create = Request::builder()
        .method("POST")
        .uri("/api/v1/bots")
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "display_name": "Token Bot",
                "bot_identity_pubkey": valid_pubkey(),
                "bot_command_pubkey": valid_pubkey(),
                "identity_pubkey": valid_pubkey(),
                "declared_scopes": ["post_message"]
            })
            .to_string(),
        ))
        .unwrap();

    let res_create = app.clone().oneshot(req_create).await.unwrap();
    let body_create: Value = serde_json::from_slice(
        &axum::body::to_bytes(res_create.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    let bot_id = body_create["bot_id"].as_str().unwrap().to_string();

    // POST /bots/:id/tokens — Issue new token
    let req_new_token = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/bots/{}/tokens", bot_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .body(Body::empty())
        .unwrap();

    let res_new_token = app.clone().oneshot(req_new_token).await.unwrap();
    assert_eq!(res_new_token.status(), StatusCode::CREATED);
    let body_token: Value = serde_json::from_slice(
        &axum::body::to_bytes(res_new_token.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();

    let new_token_id = body_token["token_id"].as_str().unwrap().to_string();
    let new_bot_token = body_token["bot_token"].as_str().unwrap().to_string();

    // Verify token works
    let req_auth = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/bots/{}", bot_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", new_bot_token))
        .body(Body::empty())
        .unwrap();

    let res_auth = app.clone().oneshot(req_auth).await.unwrap();
    assert_eq!(res_auth.status(), StatusCode::OK);

    // DELETE /bots/:id/tokens/:token_id — Revoke token
    let req_revoke = Request::builder()
        .method("DELETE")
        .uri(format!("/api/v1/bots/{}/tokens/{}", bot_id, new_token_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .body(Body::empty())
        .unwrap();

    let res_revoke = app.clone().oneshot(req_revoke).await.unwrap();
    assert_eq!(res_revoke.status(), StatusCode::NO_CONTENT);

    // Verify revoked token returns 401
    let req_auth_revoked = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/bots/{}", bot_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", new_bot_token))
        .body(Body::empty())
        .unwrap();

    let res_auth_revoked = app.clone().oneshot(req_auth_revoked).await.unwrap();
    assert_eq!(res_auth_revoked.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn test_bot_creation_rate_limit() {
    let (app, pool) = common::setup_test_app().await;
    let (user_token, _) = common::create_test_user_and_session(&app, &pool).await;

    // RATE_BOT_CREATE_PER_HOUR default is 5
    for i in 0..5 {
        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/bots")
            .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(
                json!({
                    "display_name": format!("Bot {}", i),
                    "bot_identity_pubkey": valid_pubkey(),
                    "bot_command_pubkey": valid_pubkey(),
                    "identity_pubkey": valid_pubkey(),
                    "declared_scopes": ["post_message"]
                })
                .to_string(),
            ))
            .unwrap();

        let res = app.clone().oneshot(req).await.unwrap();
        assert_eq!(res.status(), StatusCode::CREATED);
    }

    // 6th create attempt should fail with 429
    let req_over_limit = Request::builder()
        .method("POST")
        .uri("/api/v1/bots")
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "display_name": "Over Limit Bot",
                "bot_identity_pubkey": valid_pubkey(),
                "bot_command_pubkey": valid_pubkey(),
                "identity_pubkey": valid_pubkey(),
                "declared_scopes": ["post_message"]
            })
            .to_string(),
        ))
        .unwrap();

    let res_over_limit = app.clone().oneshot(req_over_limit).await.unwrap();
    assert_eq!(res_over_limit.status(), StatusCode::TOO_MANY_REQUESTS);
}
