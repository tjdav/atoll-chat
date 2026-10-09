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

fn valid_bot_ct() -> String {
    // 32B ephemeral_pubkey + 12B nonce + 16B tag = 60 bytes minimum
    URL_SAFE_NO_PAD.encode([42u8; 64])
}

fn valid_client_ct() -> String {
    URL_SAFE_NO_PAD.encode([99u8; 32])
}

#[tokio::test]
async fn test_bot_settings_schema_and_xor_constraint() {
    let pool = common::setup_test_db().await;

    sqlx::query(
        "INSERT INTO users (id, username_token, opaque_registration, identity_pubkey) VALUES ('u_1', 'tok_1', X'1234', 'pk_1')",
    )
    .execute(&pool)
    .await
    .unwrap();

    sqlx::query(
        r#"
        INSERT INTO bot_accounts (id, display_name, owner_user_id, bot_identity_pubkey, bot_command_pubkey, identity_pubkey)
        VALUES ('b_1', 'Test Bot', 'u_1', 'pk_id', 'pk_cmd', 'pk_mls')
        "#,
    )
    .execute(&pool)
    .await
    .unwrap();

    // 1. Secret = 1 with value_encrypted_client NOT NULL must fail XOR check
    let err_secret_client = sqlx::query(
        "INSERT INTO bot_settings (bot_id, key, is_secret, value_encrypted_client, value_encrypted_bot, user_seq) VALUES ('b_1', 'k1', 1, 'client_val', 'bot_val', 1)",
    )
    .execute(&pool)
    .await;
    assert!(
        err_secret_client.is_err(),
        "is_secret=1 with value_encrypted_client NOT NULL must fail CHECK"
    );

    // 2. Secret = 0 with value_encrypted_client NULL must fail XOR check
    let err_non_secret_null = sqlx::query(
        "INSERT INTO bot_settings (bot_id, key, is_secret, value_encrypted_client, value_encrypted_bot, user_seq) VALUES ('b_1', 'k2', 0, NULL, 'bot_val', 1)",
    )
    .execute(&pool)
    .await;
    assert!(
        err_non_secret_null.is_err(),
        "is_secret=0 with value_encrypted_client NULL must fail CHECK"
    );

    // 3. Secret = 0 with value_encrypted_client NOT NULL succeeds
    sqlx::query(
        "INSERT INTO bot_settings (bot_id, key, is_secret, value_encrypted_client, value_encrypted_bot, user_seq) VALUES ('b_1', 'k3', 0, 'client_val', 'bot_val', 1)",
    )
    .execute(&pool)
    .await
    .unwrap();

    // 4. Secret = 1 with value_encrypted_client NULL succeeds
    sqlx::query(
        "INSERT INTO bot_settings (bot_id, key, is_secret, value_encrypted_client, value_encrypted_bot, user_seq) VALUES ('b_1', 'k4', 1, NULL, 'bot_val', 2)",
    )
    .execute(&pool)
    .await
    .unwrap();
}

#[tokio::test]
async fn test_patch_and_get_bot_settings_owner() {
    let (app, pool) = common::setup_test_app().await;
    let (user_token, _user_id) = common::create_test_user_and_session(&app, &pool).await;

    // Create a bot owned by user_id
    let req_create_bot = Request::builder()
        .method("POST")
        .uri("/api/v1/bots")
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "display_name": "Settings Bot",
                "bot_identity_pubkey": valid_pubkey(),
                "bot_command_pubkey": valid_pubkey(),
                "identity_pubkey": valid_pubkey(),
                "declared_scopes": ["post_message"]
            })
            .to_string(),
        ))
        .unwrap();

    let res_create_bot = app.clone().oneshot(req_create_bot).await.unwrap();
    assert_eq!(res_create_bot.status(), StatusCode::CREATED);
    let body_bot: Value = serde_json::from_slice(
        &axum::body::to_bytes(res_create_bot.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    let bot_id = body_bot["bot_id"].as_str().unwrap().to_string();

    // 1. PATCH non-secret setting
    let req_patch_1 = Request::builder()
        .method("PATCH")
        .uri(format!(
            "/api/v1/users/me/bots/{}/settings/webhook_url",
            bot_id
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "is_secret": false,
                "value_encrypted_bot": valid_bot_ct(),
                "value_encrypted_client": valid_client_ct()
            })
            .to_string(),
        ))
        .unwrap();

    let res_patch_1 = app.clone().oneshot(req_patch_1).await.unwrap();
    assert_eq!(res_patch_1.status(), StatusCode::OK);
    assert_eq!(
        res_patch_1.headers().get("cache-control").unwrap(),
        "no-store"
    );

    let body_patch_1: Value = serde_json::from_slice(
        &axum::body::to_bytes(res_patch_1.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(body_patch_1["key"], "webhook_url");
    assert_eq!(body_patch_1["is_secret"], false);
    assert_eq!(body_patch_1["value_encrypted_client"], valid_client_ct());
    assert_eq!(body_patch_1["user_seq"], 2); // 1 for device creation, 2 for bot setting write

    // 2. PATCH secret setting
    let req_patch_2 = Request::builder()
        .method("PATCH")
        .uri(format!(
            "/api/v1/users/me/bots/{}/settings/api_secret",
            bot_id
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "is_secret": true,
                "value_encrypted_bot": valid_bot_ct()
            })
            .to_string(),
        ))
        .unwrap();

    let res_patch_2 = app.clone().oneshot(req_patch_2).await.unwrap();
    assert_eq!(res_patch_2.status(), StatusCode::OK);

    // 3. GET /users/me/bots/:bot_id/settings
    let req_get = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/users/me/bots/{}/settings", bot_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .body(Body::empty())
        .unwrap();

    let res_get = app.clone().oneshot(req_get).await.unwrap();
    assert_eq!(res_get.status(), StatusCode::OK);
    assert_eq!(res_get.headers().get("cache-control").unwrap(), "no-store");

    let body_get: Value = serde_json::from_slice(
        &axum::body::to_bytes(res_get.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    let settings = body_get["settings"].as_array().unwrap();
    assert_eq!(settings.len(), 2);
    // Ordered by key ASC: "api_secret", "webhook_url"
    assert_eq!(settings[0]["key"], "api_secret");
    assert_eq!(settings[0]["is_secret"], true);
    assert!(settings[0]["value_encrypted_client"].is_null());

    assert_eq!(settings[1]["key"], "webhook_url");
    assert_eq!(settings[1]["is_secret"], false);
    assert_eq!(settings[1]["value_encrypted_client"], valid_client_ct());

    // 4. Non-owner authorization check
    let (other_token, _other_id) = common::create_test_user_and_session(&app, &pool).await;
    let req_other_get = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/users/me/bots/{}/settings", bot_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", other_token))
        .body(Body::empty())
        .unwrap();

    let res_other_get = app.clone().oneshot(req_other_get).await.unwrap();
    assert_eq!(res_other_get.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn test_patch_bot_settings_validation_matrix() {
    let (app, pool) = common::setup_test_app().await;
    let (user_token, _user_id) = common::create_test_user_and_session(&app, &pool).await;

    // Create a bot
    let req_create_bot = Request::builder()
        .method("POST")
        .uri("/api/v1/bots")
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "display_name": "Validation Bot",
                "bot_identity_pubkey": valid_pubkey(),
                "bot_command_pubkey": valid_pubkey(),
                "identity_pubkey": valid_pubkey(),
                "declared_scopes": ["post_message"]
            })
            .to_string(),
        ))
        .unwrap();

    let res_create_bot = app.clone().oneshot(req_create_bot).await.unwrap();
    let body_bot: Value = serde_json::from_slice(
        &axum::body::to_bytes(res_create_bot.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    let bot_id = body_bot["bot_id"].as_str().unwrap().to_string();

    // 1. is_secret = false with absent value_encrypted_client -> 400 client_ciphertext_required
    let req_missing_client = Request::builder()
        .method("PATCH")
        .uri(format!("/api/v1/users/me/bots/{}/settings/k1", bot_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "is_secret": false,
                "value_encrypted_bot": valid_bot_ct()
            })
            .to_string(),
        ))
        .unwrap();

    let res_missing_client = app.clone().oneshot(req_missing_client).await.unwrap();
    assert_eq!(res_missing_client.status(), StatusCode::BAD_REQUEST);
    let err_body: Value = serde_json::from_slice(
        &axum::body::to_bytes(res_missing_client.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(err_body["error"], "client_ciphertext_required");

    // 2. is_secret = true with present value_encrypted_client -> 400 client_ciphertext_forbidden
    let req_forbidden_client = Request::builder()
        .method("PATCH")
        .uri(format!("/api/v1/users/me/bots/{}/settings/k2", bot_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "is_secret": true,
                "value_encrypted_bot": valid_bot_ct(),
                "value_encrypted_client": valid_client_ct()
            })
            .to_string(),
        ))
        .unwrap();

    let res_forbidden_client = app.clone().oneshot(req_forbidden_client).await.unwrap();
    assert_eq!(res_forbidden_client.status(), StatusCode::BAD_REQUEST);
    let err_body2: Value = serde_json::from_slice(
        &axum::body::to_bytes(res_forbidden_client.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(err_body2["error"], "client_ciphertext_forbidden");

    // 3. value_encrypted_bot < 60 decoded bytes -> 400 invalid_value_encrypted_bot
    let short_ct = URL_SAFE_NO_PAD.encode([1u8; 10]);
    let req_short_bot_ct = Request::builder()
        .method("PATCH")
        .uri(format!("/api/v1/users/me/bots/{}/settings/k3", bot_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "is_secret": true,
                "value_encrypted_bot": short_ct
            })
            .to_string(),
        ))
        .unwrap();

    let res_short_bot_ct = app.clone().oneshot(req_short_bot_ct).await.unwrap();
    assert_eq!(res_short_bot_ct.status(), StatusCode::BAD_REQUEST);
    let err_body3: Value = serde_json::from_slice(
        &axum::body::to_bytes(res_short_bot_ct.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(err_body3["error"], "invalid_value_encrypted_bot");

    // 4. Malformed ephemeral_pubkey -> 400 invalid_ephemeral_pubkey
    let req_bad_epk = Request::builder()
        .method("PATCH")
        .uri(format!("/api/v1/users/me/bots/{}/settings/k4", bot_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "is_secret": true,
                "value_encrypted_bot": valid_bot_ct(),
                "ephemeral_pubkey": "not-valid-base64-or-too-short"
            })
            .to_string(),
        ))
        .unwrap();

    let res_bad_epk = app.clone().oneshot(req_bad_epk).await.unwrap();
    assert_eq!(res_bad_epk.status(), StatusCode::BAD_REQUEST);
    let err_body4: Value = serde_json::from_slice(
        &axum::body::to_bytes(res_bad_epk.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(err_body4["error"], "invalid_ephemeral_pubkey");

    // 5. Valid ephemeral_pubkey -> 200 OK
    let req_valid_epk = Request::builder()
        .method("PATCH")
        .uri(format!("/api/v1/users/me/bots/{}/settings/k5", bot_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "is_secret": true,
                "value_encrypted_bot": valid_bot_ct(),
                "ephemeral_pubkey": valid_pubkey()
            })
            .to_string(),
        ))
        .unwrap();

    let res_valid_epk = app.clone().oneshot(req_valid_epk).await.unwrap();
    assert_eq!(res_valid_epk.status(), StatusCode::OK);
}

#[tokio::test]
async fn test_patch_room_prefixed_keys_and_no_op_guard() {
    let (app, pool) = common::setup_test_app().await;
    let (user_token, user_id) = common::create_test_user_and_session(&app, &pool).await;

    // Create a bot
    let req_create_bot = Request::builder()
        .method("POST")
        .uri("/api/v1/bots")
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "display_name": "Prefix Bot",
                "bot_identity_pubkey": valid_pubkey(),
                "bot_command_pubkey": valid_pubkey(),
                "identity_pubkey": valid_pubkey(),
                "declared_scopes": ["post_message"]
            })
            .to_string(),
        ))
        .unwrap();

    let res_create_bot = app.clone().oneshot(req_create_bot).await.unwrap();
    let body_bot: Value = serde_json::from_slice(
        &axum::body::to_bytes(res_create_bot.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    let bot_id = body_bot["bot_id"].as_str().unwrap().to_string();

    let room_key = "room:r_999:theme_color";

    // 1. Write room-prefixed setting
    let req_write = Request::builder()
        .method("PATCH")
        .uri(format!(
            "/api/v1/users/me/bots/{}/settings/{}",
            bot_id, room_key
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "is_secret": false,
                "value_encrypted_bot": valid_bot_ct(),
                "value_encrypted_client": valid_client_ct()
            })
            .to_string(),
        ))
        .unwrap();

    let res_write = app.clone().oneshot(req_write).await.unwrap();
    assert_eq!(res_write.status(), StatusCode::OK);
    let body_write: Value = serde_json::from_slice(
        &axum::body::to_bytes(res_write.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    let initial_seq = body_write["user_seq"].as_i64().unwrap();

    // 2. Retry identical write -> No-op guard
    let req_noop = Request::builder()
        .method("PATCH")
        .uri(format!(
            "/api/v1/users/me/bots/{}/settings/{}",
            bot_id, room_key
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "is_secret": false,
                "value_encrypted_bot": valid_bot_ct(),
                "value_encrypted_client": valid_client_ct()
            })
            .to_string(),
        ))
        .unwrap();

    let res_noop = app.clone().oneshot(req_noop).await.unwrap();
    assert_eq!(res_noop.status(), StatusCode::OK);
    let body_noop: Value = serde_json::from_slice(
        &axum::body::to_bytes(res_noop.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    let noop_seq = body_noop["user_seq"].as_i64().unwrap();
    assert_eq!(noop_seq, initial_seq, "No-op write must not bump user_seq");

    // Verify user_seq table next_seq - 1 matches initial_seq
    let next_seq: i64 = sqlx::query_scalar("SELECT next_seq FROM user_seq WHERE user_id = ?")
        .bind(&user_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(next_seq - 1, initial_seq);
}

#[tokio::test]
async fn test_delete_bot_setting() {
    let (app, pool) = common::setup_test_app().await;
    let (user_token, _user_id) = common::create_test_user_and_session(&app, &pool).await;

    // Create a bot
    let req_create_bot = Request::builder()
        .method("POST")
        .uri("/api/v1/bots")
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "display_name": "Delete Bot",
                "bot_identity_pubkey": valid_pubkey(),
                "bot_command_pubkey": valid_pubkey(),
                "identity_pubkey": valid_pubkey(),
                "declared_scopes": ["post_message"]
            })
            .to_string(),
        ))
        .unwrap();

    let res_create_bot = app.clone().oneshot(req_create_bot).await.unwrap();
    let body_bot: Value = serde_json::from_slice(
        &axum::body::to_bytes(res_create_bot.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    let bot_id = body_bot["bot_id"].as_str().unwrap().to_string();

    // 1. DELETE non-existent setting -> 404 setting_not_found
    let req_del_missing = Request::builder()
        .method("DELETE")
        .uri(format!(
            "/api/v1/users/me/bots/{}/settings/missing_key",
            bot_id
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .body(Body::empty())
        .unwrap();

    let res_del_missing = app.clone().oneshot(req_del_missing).await.unwrap();
    assert_eq!(res_del_missing.status(), StatusCode::NOT_FOUND);

    // Write a setting
    let req_write = Request::builder()
        .method("PATCH")
        .uri(format!(
            "/api/v1/users/me/bots/{}/settings/to_delete",
            bot_id
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "is_secret": true,
                "value_encrypted_bot": valid_bot_ct()
            })
            .to_string(),
        ))
        .unwrap();

    let res_write = app.clone().oneshot(req_write).await.unwrap();
    assert_eq!(res_write.status(), StatusCode::OK);

    // 2. DELETE existing setting -> 204 No Content
    let req_del = Request::builder()
        .method("DELETE")
        .uri(format!(
            "/api/v1/users/me/bots/{}/settings/to_delete",
            bot_id
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .body(Body::empty())
        .unwrap();

    let res_del = app.clone().oneshot(req_del).await.unwrap();
    assert_eq!(res_del.status(), StatusCode::NO_CONTENT);
    assert_eq!(res_del.headers().get("cache-control").unwrap(), "no-store");

    // Verify setting is deleted from GET
    let req_get = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/users/me/bots/{}/settings", bot_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .body(Body::empty())
        .unwrap();

    let res_get = app.clone().oneshot(req_get).await.unwrap();
    let body_get: Value = serde_json::from_slice(
        &axum::body::to_bytes(res_get.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(body_get["settings"].as_array().unwrap().len(), 0);
}

#[tokio::test]
async fn test_get_bot_settings_for_bot() {
    let (app, pool) = common::setup_test_app().await;
    let (user_token, _user_id) = common::create_test_user_and_session(&app, &pool).await;

    // Create a bot
    let req_create_bot = Request::builder()
        .method("POST")
        .uri("/api/v1/bots")
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "display_name": "Bot Reader",
                "bot_identity_pubkey": valid_pubkey(),
                "bot_command_pubkey": valid_pubkey(),
                "identity_pubkey": valid_pubkey(),
                "declared_scopes": ["post_message"]
            })
            .to_string(),
        ))
        .unwrap();

    let res_create_bot = app.clone().oneshot(req_create_bot).await.unwrap();
    let body_bot: Value = serde_json::from_slice(
        &axum::body::to_bytes(res_create_bot.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    let bot_id = body_bot["bot_id"].as_str().unwrap().to_string();

    // Issue a bot token
    let req_token = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/bots/{}/tokens", bot_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .body(Body::empty())
        .unwrap();

    let res_token = app.clone().oneshot(req_token).await.unwrap();
    let body_token: Value = serde_json::from_slice(
        &axum::body::to_bytes(res_token.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    let bot_bearer_token = body_token["bot_token"].as_str().unwrap().to_string();

    // Write a non-secret and a secret setting as owner
    let req_w1 = Request::builder()
        .method("PATCH")
        .uri(format!(
            "/api/v1/users/me/bots/{}/settings/public_cfg",
            bot_id
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "is_secret": false,
                "value_encrypted_bot": valid_bot_ct(),
                "value_encrypted_client": valid_client_ct()
            })
            .to_string(),
        ))
        .unwrap();
    app.clone().oneshot(req_w1).await.unwrap();

    let req_w2 = Request::builder()
        .method("PATCH")
        .uri(format!(
            "/api/v1/users/me/bots/{}/settings/secret_token",
            bot_id
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "is_secret": true,
                "value_encrypted_bot": valid_bot_ct()
            })
            .to_string(),
        ))
        .unwrap();
    app.clone().oneshot(req_w2).await.unwrap();

    // GET /bots/me/settings as bot
    let req_bot_get = Request::builder()
        .method("GET")
        .uri("/api/v1/bots/me/settings")
        .header(
            header::AUTHORIZATION,
            format!("Bearer {}", bot_bearer_token),
        )
        .body(Body::empty())
        .unwrap();

    let res_bot_get = app.clone().oneshot(req_bot_get).await.unwrap();
    assert_eq!(res_bot_get.status(), StatusCode::OK);
    assert_eq!(
        res_bot_get.headers().get("cache-control").unwrap(),
        "no-store"
    );

    let body_bot_get: Value = serde_json::from_slice(
        &axum::body::to_bytes(res_bot_get.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    let bot_settings = body_bot_get["settings"].as_array().unwrap();
    assert_eq!(bot_settings.len(), 2);

    // Verify shape: key, value_encrypted_bot, is_secret, user_seq. No value_encrypted_client!
    assert_eq!(bot_settings[0]["key"], "public_cfg");
    assert_eq!(bot_settings[0]["value_encrypted_bot"], valid_bot_ct());
    assert_eq!(bot_settings[0]["is_secret"], false);
    assert!(bot_settings[0].get("value_encrypted_client").is_none());

    assert_eq!(bot_settings[1]["key"], "secret_token");
    assert_eq!(bot_settings[1]["value_encrypted_bot"], valid_bot_ct());
    assert_eq!(bot_settings[1]["is_secret"], true);
    assert!(bot_settings[1].get("value_encrypted_client").is_none());

    // Calling GET /bots/me/settings with a user token returns 403 forbidden
    let req_user_get_me = Request::builder()
        .method("GET")
        .uri("/api/v1/bots/me/settings")
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .body(Body::empty())
        .unwrap();

    let res_user_get_me = app.clone().oneshot(req_user_get_me).await.unwrap();
    assert_eq!(res_user_get_me.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn test_sync_response_integration() {
    let (app, pool) = common::setup_test_app().await;
    let (user_token, _user_id) = common::create_test_user_and_session(&app, &pool).await;

    // Create a bot
    let req_create_bot = Request::builder()
        .method("POST")
        .uri("/api/v1/bots")
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "display_name": "Sync Bot",
                "bot_identity_pubkey": valid_pubkey(),
                "bot_command_pubkey": valid_pubkey(),
                "identity_pubkey": valid_pubkey(),
                "declared_scopes": ["post_message"]
            })
            .to_string(),
        ))
        .unwrap();

    let res_create_bot = app.clone().oneshot(req_create_bot).await.unwrap();
    let body_bot: Value = serde_json::from_slice(
        &axum::body::to_bytes(res_create_bot.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    let bot_id = body_bot["bot_id"].as_str().unwrap().to_string();

    // Write a public and a secret setting
    let req_w1 = Request::builder()
        .method("PATCH")
        .uri(format!("/api/v1/users/me/bots/{}/settings/theme", bot_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "is_secret": false,
                "value_encrypted_bot": valid_bot_ct(),
                "value_encrypted_client": valid_client_ct()
            })
            .to_string(),
        ))
        .unwrap();
    app.clone().oneshot(req_w1).await.unwrap();

    let req_w2 = Request::builder()
        .method("PATCH")
        .uri(format!("/api/v1/users/me/bots/{}/settings/token", bot_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "is_secret": true,
                "value_encrypted_bot": valid_bot_ct()
            })
            .to_string(),
        ))
        .unwrap();
    app.clone().oneshot(req_w2).await.unwrap();

    // GET /users/me/sync?since_seq=0
    let req_sync = Request::builder()
        .method("GET")
        .uri("/api/v1/users/me/sync?since_seq=0")
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .body(Body::empty())
        .unwrap();

    let res_sync = app.clone().oneshot(req_sync).await.unwrap();
    assert_eq!(res_sync.status(), StatusCode::OK);

    let body_sync: Value = serde_json::from_slice(
        &axum::body::to_bytes(res_sync.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();

    let sync_bot_settings = body_sync["bot_settings"].as_array().unwrap();
    assert_eq!(sync_bot_settings.len(), 2);

    assert_eq!(sync_bot_settings[0]["bot_id"], bot_id);
    assert_eq!(sync_bot_settings[0]["key"], "theme");
    assert_eq!(sync_bot_settings[0]["is_secret"], false);
    assert_eq!(
        sync_bot_settings[0]["value_encrypted_client"],
        valid_client_ct()
    );

    assert_eq!(sync_bot_settings[1]["bot_id"], bot_id);
    assert_eq!(sync_bot_settings[1]["key"], "token");
    assert_eq!(sync_bot_settings[1]["is_secret"], true);
    assert!(sync_bot_settings[1]["value_encrypted_client"].is_null());

    let max_seq = body_sync["max_seq"].as_i64().unwrap();
    let last_setting_seq = sync_bot_settings[1]["user_seq"].as_i64().unwrap();
    assert!(
        max_seq >= last_setting_seq,
        "max_seq must reflect highest user_seq"
    );
}
