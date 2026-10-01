mod common;

use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use common::{login_user, register_user, setup_test_app};
use serde_json::Value;
use tower::ServiceExt;

#[tokio::test]
async fn test_admin_with_config_edit_can_rotate() {
    let (app, pool) = setup_test_app().await;

    let _owner_id = register_user(&app, "owner_rotate", "Password123!", None).await;
    let (status, login_val) = login_user(
        &app,
        "owner_rotate",
        "Password123!",
        "client_device_12345",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let token = login_val["session_token"].as_str().unwrap();

    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/admin/oprf/rotate")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            serde_json::json!({ "confirm": true }).to_string(),
        ))
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_val: Value = serde_json::from_slice(&bytes).unwrap();

    assert!(json_val["backup_path"].is_string());
    assert!(json_val["users_flagged"].is_number());
    assert_eq!(json_val["restart_required"], true);

    let audit_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM audit_log WHERE action = 'oprf.rotate' AND actor_id = ?",
    )
    .bind(login_val["user_id"].as_str().unwrap())
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(audit_count, 1);
}

#[tokio::test]
async fn test_missing_confirm_returns_400() {
    let (app, _) = setup_test_app().await;

    let _owner_id = register_user(&app, "owner_confirm", "Password123!", None).await;
    let (_, login_val) = login_user(
        &app,
        "owner_confirm",
        "Password123!",
        "client_device_12345",
        None,
    )
    .await;
    let token = login_val["session_token"].as_str().unwrap();

    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/admin/oprf/rotate")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from("{}"))
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);

    let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_val: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(json_val["error"], "confirmation_required");
}

#[tokio::test]
async fn test_confirm_false_returns_400() {
    let (app, _) = setup_test_app().await;

    let _owner_id = register_user(&app, "owner_false", "Password123!", None).await;
    let (_, login_val) = login_user(
        &app,
        "owner_false",
        "Password123!",
        "client_device_12345",
        None,
    )
    .await;
    let token = login_val["session_token"].as_str().unwrap();

    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/admin/oprf/rotate")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            serde_json::json!({ "confirm": false }).to_string(),
        ))
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn test_non_admin_returns_403() {
    let (app, pool) = setup_test_app().await;

    let _owner_id = register_user(&app, "owner_user", "Password123!", None).await;

    sqlx::query(
        "INSERT INTO server_invites (id, code, max_uses, current_uses) VALUES ('inv_rot', 'INVITE12', 1, 0)",
    )
    .execute(&pool)
    .await
    .unwrap();

    let _member_id = register_user(&app, "member_user", "Password123!", Some("INVITE12")).await;

    let (_, login_val) = login_user(
        &app,
        "member_user",
        "Password123!",
        "client_device_12345",
        None,
    )
    .await;
    let token = login_val["session_token"].as_str().unwrap();

    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/admin/oprf/rotate")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            serde_json::json!({ "confirm": true }).to_string(),
        ))
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn test_rate_limit_enforced() {
    let (app, _) = setup_test_app().await;

    let _owner_id = register_user(&app, "owner_rl", "Password123!", None).await;
    let (_, login_val) = login_user(
        &app,
        "owner_rl",
        "Password123!",
        "client_device_12345",
        None,
    )
    .await;
    let token = login_val["session_token"].as_str().unwrap();

    // First call -> 200
    let req1 = Request::builder()
        .method("POST")
        .uri("/api/v1/admin/oprf/rotate")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            serde_json::json!({ "confirm": true }).to_string(),
        ))
        .unwrap();

    let resp1 = app.clone().oneshot(req1).await.unwrap();
    assert_eq!(resp1.status(), StatusCode::OK);

    // Second call -> 429
    let req2 = Request::builder()
        .method("POST")
        .uri("/api/v1/admin/oprf/rotate")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            serde_json::json!({ "confirm": true }).to_string(),
        ))
        .unwrap();

    let resp2 = app.oneshot(req2).await.unwrap();
    assert_eq!(resp2.status(), StatusCode::TOO_MANY_REQUESTS);
}

#[tokio::test]
async fn test_cache_control_no_store_header_present() {
    let (app, _) = setup_test_app().await;

    let _owner_id = register_user(&app, "owner_cc", "Password123!", None).await;
    let (_, login_val) = login_user(
        &app,
        "owner_cc",
        "Password123!",
        "client_device_12345",
        None,
    )
    .await;
    let token = login_val["session_token"].as_str().unwrap();

    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/admin/oprf/rotate")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            serde_json::json!({ "confirm": true }).to_string(),
        ))
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    assert_eq!(
        resp.headers().get(header::CACHE_CONTROL).unwrap(),
        "no-store"
    );
}
