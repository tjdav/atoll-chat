use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use serde_json::Value;
use tower::ServiceExt;

mod common;

#[tokio::test]
async fn test_key_transparency_log_schema_xor_check_and_bot_accounts() {
    let (app, pool) = common::setup_test_app().await;

    // 1. Both user_id and bot_id set -> Should fail XOR CHECK
    let err_both = sqlx::query(
        "INSERT INTO key_transparency_log (user_id, bot_id, identity_pubkey) VALUES ('u_1', 'b_1', 'pk_1')",
    )
    .execute(&pool)
    .await;
    assert!(
        err_both.is_err(),
        "Inserting both user_id and bot_id must fail XOR CHECK"
    );

    // 2. Neither user_id nor bot_id set -> Should fail XOR CHECK
    let err_neither =
        sqlx::query("INSERT INTO key_transparency_log (identity_pubkey) VALUES ('pk_1')")
            .execute(&pool)
            .await;
    assert!(
        err_neither.is_err(),
        "Inserting neither user_id nor bot_id must fail XOR CHECK"
    );

    // 3. User leaf insert directly -> bot_id and command_pubkey are NULL
    let user_id = common::register_user(&app, "schema_user1", "Pass123456!", None).await;
    let user_row: (Option<String>, Option<String>) =
        sqlx::query_as("SELECT bot_id, command_pubkey FROM key_transparency_log WHERE user_id = ?")
            .bind(&user_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(user_row.0.is_none());
    assert!(user_row.1.is_none());

    // 4. Bot accounts table schema with NOT NULL pubkeys
    sqlx::query(
        r#"
        INSERT INTO bot_accounts (id, display_name, owner_user_id, bot_identity_pubkey, bot_command_pubkey, identity_pubkey)
        VALUES ('b_null_pubkeys', 'Null Bot', ?, 'pk_id_1', 'pk_cmd_1', 'pk_mls_1')
        "#,
    )
    .bind(&user_id)
    .execute(&pool)
    .await
    .unwrap();

    sqlx::query(
        r#"
        INSERT INTO bot_accounts (id, display_name, owner_user_id, bot_identity_pubkey, bot_command_pubkey, identity_pubkey)
        VALUES ('b_full_pubkeys', 'Full Bot', ?, 'b_id_pk', 'b_cmd_pk', 'id_pk')
        "#,
    )
    .bind(&user_id)
    .execute(&pool)
    .await
    .unwrap();

    let bot_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM bot_accounts")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(bot_count, 2);

    // 5. Bot leaf insert directly into key_transparency_log
    sqlx::query(
        r#"
        INSERT INTO key_transparency_log (bot_id, command_pubkey, identity_pubkey)
        VALUES ('b_full_pubkeys', 'b_cmd_pk', 'id_pk')
        "#,
    )
    .execute(&pool)
    .await
    .unwrap();

    let bot_leaf_row: (Option<String>, Option<String>, Option<String>) = sqlx::query_as(
        "SELECT user_id, username_token, command_pubkey FROM key_transparency_log WHERE bot_id = 'b_full_pubkeys'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(bot_leaf_row.0.is_none());
    assert!(bot_leaf_row.1.is_none());
    assert_eq!(bot_leaf_row.2.unwrap(), "b_cmd_pk");
}

#[tokio::test]
async fn test_get_user_kt_endpoint() {
    let (app, pool) = common::setup_test_app().await;

    // Register user 1 (alice) and user 2 (bob)
    let user1_id = common::register_user(&app, "kt_alice", "Pass123456!", None).await;

    let invite = server::invites::create_invite(
        &pool,
        &user1_id,
        server::invites::CreateInviteOptions::default(),
        &server::Config::test_default(),
    )
    .await
    .unwrap();

    let _user2_id = common::register_user(&app, "kt_bob", "Pass123456!", Some(&invite.code)).await;

    // Login as Bob to fetch Alice's KT entry
    let (status, login_res) =
        common::login_user(&app, "kt_bob", "Pass123456!", "client_1_123456789", None).await;
    assert_eq!(status, StatusCode::OK);
    let bob_token = login_res["session_token"].as_str().unwrap();

    // 1. Unauthenticated request -> 401
    let req_unauth = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/kt/user/{}", user1_id))
        .body(Body::empty())
        .unwrap();

    let resp_unauth = app.clone().oneshot(req_unauth).await.unwrap();
    assert_eq!(resp_unauth.status(), StatusCode::UNAUTHORIZED);

    // 2. Fetch non-existent user -> 404
    let req_missing = Request::builder()
        .method("GET")
        .uri("/api/v1/kt/user/u_nonexistent")
        .header(header::AUTHORIZATION, format!("Bearer {}", bob_token))
        .body(Body::empty())
        .unwrap();

    let resp_missing = app.clone().oneshot(req_missing).await.unwrap();
    assert_eq!(resp_missing.status(), StatusCode::NOT_FOUND);

    // 3. Any authenticated user (Bob) can fetch Alice's KT entry
    let req_alice = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/kt/user/{}", user1_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", bob_token))
        .body(Body::empty())
        .unwrap();

    let resp_alice = app.clone().oneshot(req_alice).await.unwrap();
    assert_eq!(resp_alice.status(), StatusCode::OK);

    let cache_control = resp_alice.headers().get(header::CACHE_CONTROL).unwrap();
    assert_eq!(cache_control, "no-store");

    let body_alice: Value = serde_json::from_slice(
        &axum::body::to_bytes(resp_alice.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();

    assert_eq!(body_alice["user_id"], user1_id);
    assert_eq!(body_alice["leaf_index"], 1);
    assert!(body_alice["identity_pubkey"].is_string());
    assert!(body_alice["inclusion_proof"].is_array());
    assert!(body_alice["tree_head"].is_object());
    assert_eq!(body_alice["auditor_signatures"], serde_json::json!([]));

    // CRITICAL SECURITY INVARIANT: Assert username_token is NOT in the JSON response keys
    let obj = body_alice.as_object().unwrap();
    assert!(
        !obj.contains_key("username_token"),
        "username_token MUST be excluded from GET /kt/user/:id response per §12 and §14.6"
    );

    // 4. Inclusion proof verification against tree_head
    let tree_head = &body_alice["tree_head"];
    let tree_size = tree_head["tree_size"].as_u64().unwrap() as usize;
    let root_hash_b64 = tree_head["root_hash"].as_str().unwrap();
    let root_hash_bytes = URL_SAFE_NO_PAD.decode(root_hash_b64).unwrap();
    assert_eq!(root_hash_bytes.len(), 32);

    let mut expected_root = [0u8; 32];
    expected_root.copy_from_slice(&root_hash_bytes);

    let proof_strs = body_alice["inclusion_proof"].as_array().unwrap();
    let proof_hashes: Vec<[u8; 32]> = proof_strs
        .iter()
        .map(|s| {
            let b = URL_SAFE_NO_PAD.decode(s.as_str().unwrap()).unwrap();
            let mut arr = [0u8; 32];
            arr.copy_from_slice(&b);
            arr
        })
        .collect();

    // Query username_token and identity_pubkey from DB to calculate target leaf hash
    let (u_token, i_pubkey): (String, String) = sqlx::query_as(
        "SELECT username_token, identity_pubkey FROM key_transparency_log WHERE user_id = ?",
    )
    .bind(&user1_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    let leaf_hash = server::key_transparency::leaf_hash(&u_token, &i_pubkey);

    let is_valid = server::key_transparency::verify_inclusion_proof(
        &leaf_hash,
        0, // 0-based index in tree
        tree_size,
        &proof_hashes,
        &expected_root,
    )
    .unwrap();

    assert!(
        is_valid,
        "Inclusion proof must verify successfully against tree_head root_hash"
    );
}

#[tokio::test]
async fn test_get_user_kt_endpoint_disabled_flag() {
    let (app_disabled, _pool_disabled, _) = common::setup_test_app_with_custom_config(|c| {
        c.key_transparency_enabled = false;
    })
    .await;

    let dis_user = common::register_user(&app_disabled, "dis_user", "Pass123456!", None).await;
    let (status_dis, login_dis) = common::login_user(
        &app_disabled,
        "dis_user",
        "Pass123456!",
        "client_1_123456789",
        None,
    )
    .await;
    assert_eq!(status_dis, StatusCode::OK);
    let dis_token = login_dis["session_token"].as_str().unwrap();

    let req_disabled = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/kt/user/{}", dis_user))
        .header(header::AUTHORIZATION, format!("Bearer {}", dis_token))
        .body(Body::empty())
        .unwrap();

    let resp_disabled = app_disabled.oneshot(req_disabled).await.unwrap();
    assert_eq!(resp_disabled.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn test_get_kt_snapshot_endpoint() {
    let (app, _pool) = common::setup_test_app().await;

    let _user_id = common::register_user(&app, "snap_user", "Pass123456!", None).await;
    let (status, login_res) =
        common::login_user(&app, "snap_user", "Pass123456!", "client_1_123456789", None).await;
    assert_eq!(status, StatusCode::OK);
    let token = login_res["session_token"].as_str().unwrap();

    // 1. Unauthenticated request -> 401
    let req_unauth = Request::builder()
        .method("GET")
        .uri("/api/v1/kt/snapshot")
        .body(Body::empty())
        .unwrap();

    let resp_unauth = app.clone().oneshot(req_unauth).await.unwrap();
    assert_eq!(resp_unauth.status(), StatusCode::UNAUTHORIZED);

    // 2. Request when no snapshot exists -> 404
    let req_nosnap = Request::builder()
        .method("GET")
        .uri("/api/v1/kt/snapshot")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .body(Body::empty())
        .unwrap();

    let resp_nosnap = app.clone().oneshot(req_nosnap).await.unwrap();
    assert_eq!(resp_nosnap.status(), StatusCode::NOT_FOUND);

    // 3. Create snapshot via admin endpoint or internal helper
    let req_create_snap = Request::builder()
        .method("POST")
        .uri("/api/v1/admin/key-transparency/snapshot")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .body(Body::empty())
        .unwrap();

    let resp_create = app.clone().oneshot(req_create_snap).await.unwrap();
    assert_eq!(resp_create.status(), StatusCode::OK);

    // 4. GET /kt/snapshot returns 200 OK
    let req_snap = Request::builder()
        .method("GET")
        .uri("/api/v1/kt/snapshot")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .body(Body::empty())
        .unwrap();

    let resp_snap = app.clone().oneshot(req_snap).await.unwrap();
    assert_eq!(resp_snap.status(), StatusCode::OK);

    let cache_control = resp_snap.headers().get(header::CACHE_CONTROL).unwrap();
    assert_eq!(cache_control, "no-store");

    let body_snap: Value = serde_json::from_slice(
        &axum::body::to_bytes(resp_snap.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();

    assert_eq!(body_snap["tree_size"], 1);
    assert!(body_snap["root_hash"].is_string());
    assert!(body_snap["created_at"].is_string());

    // CRITICAL SPEC INVARIANT (§8.11.3): Assert signature is NOT in the JSON response keys
    let obj = body_snap.as_object().unwrap();
    assert!(
        !obj.contains_key("signature"),
        "signature field MUST NOT be in GET /kt/snapshot response per §8.11.3"
    );
    assert!(
        !obj.contains_key("id"),
        "id field MUST NOT be in GET /kt/snapshot response per §8.11.3"
    );
}

#[tokio::test]
async fn test_get_kt_snapshot_endpoint_disabled_flag() {
    let (app_disabled, _pool_disabled, _) = common::setup_test_app_with_custom_config(|c| {
        c.key_transparency_enabled = false;
    })
    .await;

    let _dis_user =
        common::register_user(&app_disabled, "dis_snap_user", "Pass123456!", None).await;
    let (status_dis, login_dis) = common::login_user(
        &app_disabled,
        "dis_snap_user",
        "Pass123456!",
        "client_1_123456789",
        None,
    )
    .await;
    assert_eq!(status_dis, StatusCode::OK);
    let dis_token = login_dis["session_token"].as_str().unwrap();

    let req_disabled = Request::builder()
        .method("GET")
        .uri("/api/v1/kt/snapshot")
        .header(header::AUTHORIZATION, format!("Bearer {}", dis_token))
        .body(Body::empty())
        .unwrap();

    let resp_disabled = app_disabled.oneshot(req_disabled).await.unwrap();
    assert_eq!(resp_disabled.status(), StatusCode::NOT_FOUND);
}
