mod common;

use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use common::{login_user, register_user, setup_test_app};
use serde_json::Value;
use tower::ServiceExt;

#[tokio::test]
async fn test_vapid_rotation_generates_new_keys() {
    let (_, pool) = setup_test_app().await;

    let init_res = server::push::vapid::rotate_vapid_keys(&pool, None)
        .await
        .unwrap();
    let initial_pub = init_res.public_key;

    let rot_res = server::push::vapid::rotate_vapid_keys(&pool, None)
        .await
        .unwrap();
    let rotated_pub = rot_res.public_key;

    assert_ne!(initial_pub, rotated_pub);
}

#[tokio::test]
async fn test_vapid_rotation_revokes_subscriptions() {
    let (app, pool) = setup_test_app().await;

    let uid = register_user(&app, "alice_push", "Password123!", None).await;
    let (status, login_val) = login_user(
        &app,
        "alice_push",
        "Password123!",
        "client_device_12345",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let token = login_val["session_token"].as_str().unwrap();

    for i in 1..=3 {
        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/users/me/push-subscriptions")
            .header(header::AUTHORIZATION, format!("Bearer {}", token))
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(
                serde_json::json!({
                    "platform": "web",
                    "endpoint": format!("https://push.example.com/sub/{}", i),
                    "p256dh": "BNcRDR3K3fT15C_1A_B_C_D_E_F_G_H_I_J_K_L_M_N_O_P_Q_R_S_T_U_V_W_X_Y_Z",
                    "auth": "tI_J_K_L_M_N_O_P",
                    "browser_id": format!("browser_{}", i)
                })
                .to_string(),
            ))
            .unwrap();
        let resp = app.clone().oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::CREATED);
    }

    let rot_res = server::push::vapid::rotate_vapid_keys(&pool, Some(&uid))
        .await
        .unwrap();
    assert_eq!(rot_res.subscriptions_revoked, 3);

    let active_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM push_subscriptions WHERE user_id = ? AND revoked_at IS NULL",
    )
    .bind(&uid)
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(active_count, 0);

    let audit_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM audit_log WHERE action = 'vapid.rotate' AND actor_id = ?",
    )
    .bind(&uid)
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(audit_count, 1);
}

#[tokio::test]
async fn test_altcha_rotation() {
    let (_, pool) = setup_test_app().await;

    let secret_before: String =
        sqlx::query_scalar("SELECT value FROM instance_config WHERE key = 'altcha_hmac_secret'")
            .fetch_one(&pool)
            .await
            .unwrap();

    server::altcha::rotate_hmac_secret(&pool, None)
        .await
        .unwrap();

    let secret_after: String =
        sqlx::query_scalar("SELECT value FROM instance_config WHERE key = 'altcha_hmac_secret'")
            .fetch_one(&pool)
            .await
            .unwrap();

    assert_ne!(secret_before, secret_after);

    let audit_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM audit_log WHERE action = 'altcha.rotate' AND actor_id IS NULL",
    )
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(audit_count, 1);
}

#[tokio::test]
async fn test_oprf_rotation_aborts_without_confirm() {
    let res = server::cli::run_rotate_oprf(false).await;
    assert!(res.is_err());
}

#[tokio::test]
async fn test_oprf_rotation_flags_users_and_invalidates_login() {
    let (app, pool) = setup_test_app().await;

    register_user(&app, "bob_oprf", "Password123!", None).await;

    let (status_before, login_val_before) = login_user(
        &app,
        "bob_oprf",
        "Password123!",
        "client_device_12345",
        None,
    )
    .await;
    assert_eq!(status_before, StatusCode::OK);
    let session_token = login_val_before["session_token"].as_str().unwrap();

    let temp_dir = std::env::temp_dir().join(format!("test_oprf_rot_{}", ulid::Ulid::new()));
    std::fs::create_dir_all(&temp_dir).unwrap();
    let oprf_path = temp_dir.join("oprf.key");

    let _ = server::opaque::OpaqueServer::load_or_generate(&oprf_path).unwrap();

    let config = server::Config {
        opaque_oprf_key_path: oprf_path.to_str().unwrap().to_string(),
        ..server::Config::test_default()
    };

    let rot_res = server::opaque::rotate_oprf_key(&pool, &config, None)
        .await
        .unwrap();

    assert!(rot_res.backup_path.exists());
    assert_eq!(rot_res.users_affected, 1);

    let flag: i64 =
        sqlx::query_scalar("SELECT requires_reregistration FROM users WHERE username = 'bob_oprf'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(flag, 1);

    // Login fails with 409 reregistration_required
    let (status_after, body_after) = login_user(
        &app,
        "bob_oprf",
        "Password123!",
        "client_device_12345",
        None,
    )
    .await;
    assert_eq!(status_after, StatusCode::CONFLICT);
    assert_eq!(body_after["error"], "reregistration_required");

    // Existing session remains valid
    let me_req = Request::builder()
        .method("GET")
        .uri("/api/v1/users/me")
        .header(header::AUTHORIZATION, format!("Bearer {}", session_token))
        .body(Body::empty())
        .unwrap();

    let me_resp = app.clone().oneshot(me_req).await.unwrap();
    assert_eq!(me_resp.status(), StatusCode::OK);

    let body_bytes = axum::body::to_bytes(me_resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let me_json: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(me_json["username"], "bob_oprf");
}
