use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use serde_json::Value;
use tower::ServiceExt;

mod common;

fn valid_pubkey(seed: u8) -> String {
    URL_SAFE_NO_PAD.encode([seed; 32])
}

#[tokio::test]
async fn test_kt_bot_endpoints_and_command_key_consistency() {
    let (app, pool) = common::setup_test_app().await;

    let (user_token, _user_id) = common::create_test_user_and_session(&app, &pool).await;

    let bot_id_pk = valid_pubkey(10);
    let bot_cmd_pk = valid_pubkey(20);
    let bot_mls_pk = valid_pubkey(30);

    // 1. Create bot via POST /bots
    let req_create_bot = Request::builder()
        .method("POST")
        .uri("/api/v1/bots")
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            serde_json::to_string(&serde_json::json!({
                "display_name": "KT Consistency Bot",
                "bot_identity_pubkey": bot_id_pk,
                "bot_command_pubkey": bot_cmd_pk,
                "identity_pubkey": bot_mls_pk,
                "declared_scopes": ["post_message", "read_commands"]
            }))
            .unwrap(),
        ))
        .unwrap();

    let resp_bot = app.clone().oneshot(req_create_bot).await.unwrap();
    assert_eq!(resp_bot.status(), StatusCode::CREATED);
    let bot_body: Value = serde_json::from_slice(
        &axum::body::to_bytes(resp_bot.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    let bot_id = bot_body["bot_id"].as_str().unwrap().to_string();

    // 2. Fetch GET /kt/bot/:id
    let req_kt = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/kt/bot/{}", bot_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .body(Body::empty())
        .unwrap();

    let resp_kt = app.clone().oneshot(req_kt).await.unwrap();
    assert_eq!(resp_kt.status(), StatusCode::OK);
    assert_eq!(
        resp_kt.headers().get(header::CACHE_CONTROL).unwrap(),
        "no-store"
    );

    let kt_body: Value = serde_json::from_slice(
        &axum::body::to_bytes(resp_kt.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();

    assert_eq!(kt_body["bot_id"], bot_id);
    assert!(kt_body["leaf_index"].is_number());
    assert_eq!(kt_body["bot_identity_pubkey"], bot_id_pk);
    assert_eq!(
        kt_body["bot_command_pubkey"], bot_cmd_pk,
        "bot_command_pubkey in KT response MUST match bot_accounts"
    );
    assert_eq!(kt_body["identity_pubkey"], bot_mls_pk);
    assert!(kt_body["inclusion_proof"].is_array());
    assert!(kt_body["tree_head"].is_object());

    // Verify against DB bot_accounts table directly
    let db_cmd_pk: String =
        sqlx::query_scalar("SELECT bot_command_pubkey FROM bot_accounts WHERE id = ?")
            .bind(&bot_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(kt_body["bot_command_pubkey"], db_cmd_pk);

    // 3. Fetch GET /kt/bot/:id/history
    let req_hist = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/kt/bot/{}/history", bot_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .body(Body::empty())
        .unwrap();

    let resp_hist = app.clone().oneshot(req_hist).await.unwrap();
    assert_eq!(resp_hist.status(), StatusCode::OK);

    let hist_cache_control = resp_hist.headers().get(header::CACHE_CONTROL).unwrap();
    assert_eq!(hist_cache_control, "no-store");

    let hist_body: Value = serde_json::from_slice(
        &axum::body::to_bytes(resp_hist.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();

    assert_eq!(hist_body["bot_id"], bot_id);
    let entries = hist_body["entries"].as_array().unwrap();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0]["bot_command_pubkey"], bot_cmd_pk);
    assert_eq!(entries[0]["bot_identity_pubkey"], bot_id_pk);
    assert_eq!(entries[0]["identity_pubkey"], bot_mls_pk);

    // 4. Test non-existent bot -> 404 bot_not_found
    let req_missing = Request::builder()
        .method("GET")
        .uri("/api/v1/kt/bot/b_missing")
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .body(Body::empty())
        .unwrap();

    let resp_missing = app.clone().oneshot(req_missing).await.unwrap();
    assert_eq!(resp_missing.status(), StatusCode::NOT_FOUND);

    let req_missing_hist = Request::builder()
        .method("GET")
        .uri("/api/v1/kt/bot/b_missing/history")
        .header(header::AUTHORIZATION, format!("Bearer {}", user_token))
        .body(Body::empty())
        .unwrap();

    let resp_missing_hist = app.clone().oneshot(req_missing_hist).await.unwrap();
    assert_eq!(resp_missing_hist.status(), StatusCode::NOT_FOUND);
}
