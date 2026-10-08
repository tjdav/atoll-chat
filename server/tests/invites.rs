mod common;

use axum::{
    body::Body,
    http::{header, Request, StatusCode},
};
use common::{login_user, register_user, setup_test_app, setup_test_app_with_config};
use serde_json::{json, Value};
use server::routes;
use sqlx::SqlitePool;
use std::sync::Arc;
use tower::ServiceExt;

const OWNER_CLIENT: &str = "client_owner_1234567";
const INVITER_CLIENT: &str = "client_inviter_123456";
const MEMBER_CLIENT: &str = "client_member_1234567";

async fn grant_role(pool: &SqlitePool, user_id: &str, role_name: &str) {
    let role_id: String = sqlx::query_scalar("SELECT id FROM roles WHERE name = ?")
        .bind(role_name)
        .fetch_one(pool)
        .await
        .unwrap();

    sqlx::query(
        "INSERT OR IGNORE INTO user_roles (user_id, role_id, granted_by) VALUES (?, ?, NULL)",
    )
    .bind(user_id)
    .bind(role_id)
    .execute(pool)
    .await
    .unwrap();
}

#[tokio::test]
async fn test_01_owner_can_create_invite() {
    let (app, pool) = setup_test_app().await;

    let _owner_id = register_user(&app, "owner", "password123", None).await;
    let (status, login_body) = login_user(&app, "owner", "password123", OWNER_CLIENT, None).await;
    assert_eq!(status, StatusCode::OK);
    let token = login_body["session_token"].as_str().unwrap();

    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/admin/invites")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({"max_uses": 5}).to_string()))
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let body: Value = serde_json::from_slice(&body_bytes).unwrap();

    let invite_id = body["id"].as_str().unwrap();
    let code = body["code"].as_str().unwrap();

    assert_eq!(body["max_uses"], 5);
    assert_eq!(body["current_uses"], 0);
    assert!(!code.is_empty());

    let (current_uses, max_uses): (i64, i64) =
        sqlx::query_as("SELECT current_uses, max_uses FROM server_invites WHERE id = ?")
            .bind(invite_id)
            .fetch_one(&pool)
            .await
            .unwrap();

    assert_eq!(current_uses, 0);
    assert_eq!(max_uses, 5);
}

#[tokio::test]
async fn test_02_inviter_can_create_invite_within_cap() {
    let (app, pool) = setup_test_app().await;

    register_user(&app, "owner", "password123", None).await;

    // Create an invite for inviter_user
    sqlx::query(
        "INSERT INTO server_invites (id, code, max_uses, current_uses) VALUES ('inv_init', 'INITCODE', 1, 0)",
    )
    .execute(&pool)
    .await
    .unwrap();

    let inviter_id = register_user(&app, "inviter_user", "password123", Some("INITCODE")).await;
    grant_role(&pool, &inviter_id, "inviter").await;

    let (status, login_body) =
        login_user(&app, "inviter_user", "password123", INVITER_CLIENT, None).await;
    assert_eq!(status, StatusCode::OK);
    let token = login_body["session_token"].as_str().unwrap();

    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/admin/invites")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({"max_uses": 5}).to_string()))
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
}

#[tokio::test]
async fn test_03_inviter_cannot_exceed_max_uses_cap() {
    let (app, pool) = setup_test_app().await;

    register_user(&app, "owner", "password123", None).await;

    sqlx::query(
        "INSERT INTO server_invites (id, code, max_uses, current_uses) VALUES ('inv_init', 'INITCODE', 1, 0)",
    )
    .execute(&pool)
    .await
    .unwrap();

    let inviter_id = register_user(&app, "inviter_user", "password123", Some("INITCODE")).await;
    grant_role(&pool, &inviter_id, "inviter").await;

    let (status, login_body) =
        login_user(&app, "inviter_user", "password123", INVITER_CLIENT, None).await;
    assert_eq!(status, StatusCode::OK);
    let token = login_body["session_token"].as_str().unwrap();

    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/admin/invites")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({"max_uses": 50}).to_string()))
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn test_04_member_cannot_create_invite() {
    let (app, pool) = setup_test_app().await;

    register_user(&app, "owner", "password123", None).await;

    sqlx::query(
        "INSERT INTO server_invites (id, code, max_uses, current_uses) VALUES ('inv_init', 'INITCODE', 1, 0)",
    )
    .execute(&pool)
    .await
    .unwrap();

    let member_id = register_user(&app, "member_user", "password123", Some("INITCODE")).await;
    grant_role(&pool, &member_id, "member").await;

    let (status, login_body) =
        login_user(&app, "member_user", "password123", MEMBER_CLIENT, None).await;
    assert_eq!(status, StatusCode::OK);
    let token = login_body["session_token"].as_str().unwrap();

    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/admin/invites")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({"max_uses": 1}).to_string()))
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn test_05_code_format_matches_crockford_base32() {
    let (app, _pool) = setup_test_app().await;

    register_user(&app, "owner", "password123", None).await;
    let (_, login_body) = login_user(&app, "owner", "password123", OWNER_CLIENT, None).await;
    let token = login_body["session_token"].as_str().unwrap();

    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/admin/invites")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({}).to_string()))
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let body: Value = serde_json::from_slice(&body_bytes).unwrap();
    let code = body["code"].as_str().unwrap();

    let alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
    assert_eq!(code.len(), 8);
    assert!(code.chars().all(|c| alphabet.contains(c)));
}

#[tokio::test]
async fn test_06_invite_without_expiry_never_expires() {
    let (app, _pool) = setup_test_app().await;

    register_user(&app, "owner", "password123", None).await;
    let (_, login_body) = login_user(&app, "owner", "password123", OWNER_CLIENT, None).await;
    let token = login_body["session_token"].as_str().unwrap();

    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/admin/invites")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({"expires_in_days": 0}).to_string()))
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let body: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert!(body["expires_at"].is_null());
}

#[tokio::test]
async fn test_07_invite_with_expiry_has_correct_date() {
    let (app, _pool) = setup_test_app().await;

    register_user(&app, "owner", "password123", None).await;
    let (_, login_body) = login_user(&app, "owner", "password123", OWNER_CLIENT, None).await;
    let token = login_body["session_token"].as_str().unwrap();

    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/admin/invites")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({"expires_in_days": 30}).to_string()))
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let body: Value = serde_json::from_slice(&body_bytes).unwrap();

    let expires_at_str = body["expires_at"].as_str().unwrap();
    let exp_dt = chrono::DateTime::parse_from_rfc3339(expires_at_str).unwrap();
    let expected = chrono::Utc::now() + chrono::Duration::days(30);

    let diff = (exp_dt.with_timezone(&chrono::Utc) - expected)
        .num_seconds()
        .abs();
    assert!(diff < 60, "Expiry difference {} exceeds tolerance", diff);
}

#[tokio::test]
async fn test_08_listing_filters_out_revoked_by_default() {
    let (app, _pool) = setup_test_app().await;

    register_user(&app, "owner", "password123", None).await;
    let (_, login_body) = login_user(&app, "owner", "password123", OWNER_CLIENT, None).await;
    let token = login_body["session_token"].as_str().unwrap();

    // Create 2 invites
    let req1 = Request::builder()
        .method("POST")
        .uri("/api/v1/admin/invites")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({}).to_string()))
        .unwrap();
    let resp1 = app.clone().oneshot(req1).await.unwrap();
    let body1: Value = serde_json::from_slice(
        &axum::body::to_bytes(resp1.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();

    let req2 = Request::builder()
        .method("POST")
        .uri("/api/v1/admin/invites")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({}).to_string()))
        .unwrap();
    let resp2 = app.clone().oneshot(req2).await.unwrap();
    let body2: Value = serde_json::from_slice(
        &axum::body::to_bytes(resp2.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();

    let id2 = body2["id"].as_str().unwrap();

    // Revoke second invite
    let del_req = Request::builder()
        .method("DELETE")
        .uri(format!("/api/v1/admin/invites/{id2}"))
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::empty())
        .unwrap();
    let del_resp = app.clone().oneshot(del_req).await.unwrap();
    assert_eq!(del_resp.status(), StatusCode::NO_CONTENT);

    // List invites without include_revoked
    let list_req = Request::builder()
        .method("GET")
        .uri("/api/v1/admin/invites")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::empty())
        .unwrap();
    let list_resp = app.clone().oneshot(list_req).await.unwrap();
    let list_body: Value = serde_json::from_slice(
        &axum::body::to_bytes(list_resp.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();

    let invites = list_body["invites"].as_array().unwrap();
    assert_eq!(invites.len(), 1);
    assert_eq!(invites[0]["id"], body1["id"]);
    assert!(invites[0].get("code").is_none());
}

#[tokio::test]
async fn test_09_listing_with_include_revoked_returns_both() {
    let (app, _pool) = setup_test_app().await;

    register_user(&app, "owner", "password123", None).await;
    let (_, login_body) = login_user(&app, "owner", "password123", OWNER_CLIENT, None).await;
    let token = login_body["session_token"].as_str().unwrap();

    // Create 2 invites
    let req1 = Request::builder()
        .method("POST")
        .uri("/api/v1/admin/invites")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({}).to_string()))
        .unwrap();
    let resp1 = app.clone().oneshot(req1).await.unwrap();
    let body1: Value = serde_json::from_slice(
        &axum::body::to_bytes(resp1.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();

    let req2 = Request::builder()
        .method("POST")
        .uri("/api/v1/admin/invites")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({}).to_string()))
        .unwrap();
    let resp2 = app.clone().oneshot(req2).await.unwrap();
    let body2: Value = serde_json::from_slice(
        &axum::body::to_bytes(resp2.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();

    let id2 = body2["id"].as_str().unwrap();

    // Revoke second invite
    let del_req = Request::builder()
        .method("DELETE")
        .uri(format!("/api/v1/admin/invites/{id2}"))
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::empty())
        .unwrap();
    app.clone().oneshot(del_req).await.unwrap();

    // List invites with include_revoked=true
    let list_req = Request::builder()
        .method("GET")
        .uri("/api/v1/admin/invites?include_revoked=true")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::empty())
        .unwrap();
    let list_resp = app.clone().oneshot(list_req).await.unwrap();
    let list_body: Value = serde_json::from_slice(
        &axum::body::to_bytes(list_resp.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();

    let invites = list_body["invites"].as_array().unwrap();
    assert_eq!(invites.len(), 2);
    let ids: Vec<&str> = invites.iter().map(|i| i["id"].as_str().unwrap()).collect();
    assert!(ids.contains(&body1["id"].as_str().unwrap()));
    assert!(ids.contains(&body2["id"].as_str().unwrap()));
}

#[tokio::test]
async fn test_10_limited_inviter_sees_only_their_own() {
    let (app, pool) = setup_test_app().await;

    register_user(&app, "owner", "password123", None).await;
    let (_, owner_login) = login_user(&app, "owner", "password123", OWNER_CLIENT, None).await;
    let owner_token = owner_login["session_token"].as_str().unwrap();

    // Owner creates an invite
    let owner_create_req = Request::builder()
        .method("POST")
        .uri("/api/v1/admin/invites")
        .header(header::AUTHORIZATION, format!("Bearer {owner_token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({}).to_string()))
        .unwrap();
    let owner_create_resp = app.clone().oneshot(owner_create_req).await.unwrap();
    let owner_inv_body: Value = serde_json::from_slice(
        &axum::body::to_bytes(owner_create_resp.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    let owner_inv_code = owner_inv_body["code"].as_str().unwrap();

    // Register inviter user using owner's invite
    let inviter_user_id =
        register_user(&app, "inviter_user", "password123", Some(owner_inv_code)).await;
    grant_role(&pool, &inviter_user_id, "inviter").await;

    let (_, inviter_login) =
        login_user(&app, "inviter_user", "password123", INVITER_CLIENT, None).await;
    let inviter_token = inviter_login["session_token"].as_str().unwrap();

    // Inviter creates an invite
    let inviter_create_req = Request::builder()
        .method("POST")
        .uri("/api/v1/admin/invites")
        .header(header::AUTHORIZATION, format!("Bearer {inviter_token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({"max_uses": 2}).to_string()))
        .unwrap();
    let inviter_create_resp = app.clone().oneshot(inviter_create_req).await.unwrap();
    let inviter_inv_body: Value = serde_json::from_slice(
        &axum::body::to_bytes(inviter_create_resp.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();

    // Inviter lists invites
    let list_req = Request::builder()
        .method("GET")
        .uri("/api/v1/admin/invites")
        .header(header::AUTHORIZATION, format!("Bearer {inviter_token}"))
        .body(Body::empty())
        .unwrap();
    let list_resp = app.clone().oneshot(list_req).await.unwrap();
    let list_body: Value = serde_json::from_slice(
        &axum::body::to_bytes(list_resp.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();

    let invites = list_body["invites"].as_array().unwrap();
    assert_eq!(invites.len(), 1);
    assert_eq!(invites[0]["id"], inviter_inv_body["id"]);
}

#[tokio::test]
async fn test_11_revoking_an_invite_succeeds() {
    let (app, _pool) = setup_test_app().await;

    register_user(&app, "owner", "password123", None).await;
    let (_, login_body) = login_user(&app, "owner", "password123", OWNER_CLIENT, None).await;
    let token = login_body["session_token"].as_str().unwrap();

    let create_req = Request::builder()
        .method("POST")
        .uri("/api/v1/admin/invites")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({}).to_string()))
        .unwrap();
    let create_resp = app.clone().oneshot(create_req).await.unwrap();
    let inv_body: Value = serde_json::from_slice(
        &axum::body::to_bytes(create_resp.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    let id = inv_body["id"].as_str().unwrap();

    let del_req = Request::builder()
        .method("DELETE")
        .uri(format!("/api/v1/admin/invites/{id}"))
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::empty())
        .unwrap();
    let del_resp = app.clone().oneshot(del_req).await.unwrap();
    assert_eq!(del_resp.status(), StatusCode::NO_CONTENT);
}

#[tokio::test]
async fn test_12_revoking_an_already_revoked_invite_returns_409() {
    let (app, _pool) = setup_test_app().await;

    register_user(&app, "owner", "password123", None).await;
    let (_, login_body) = login_user(&app, "owner", "password123", OWNER_CLIENT, None).await;
    let token = login_body["session_token"].as_str().unwrap();

    let create_req = Request::builder()
        .method("POST")
        .uri("/api/v1/admin/invites")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({}).to_string()))
        .unwrap();
    let create_resp = app.clone().oneshot(create_req).await.unwrap();
    let inv_body: Value = serde_json::from_slice(
        &axum::body::to_bytes(create_resp.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    let id = inv_body["id"].as_str().unwrap();

    // First revoke
    let del_req1 = Request::builder()
        .method("DELETE")
        .uri(format!("/api/v1/admin/invites/{id}"))
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::empty())
        .unwrap();
    let del_resp1 = app.clone().oneshot(del_req1).await.unwrap();
    assert_eq!(del_resp1.status(), StatusCode::NO_CONTENT);

    // Second revoke
    let del_req2 = Request::builder()
        .method("DELETE")
        .uri(format!("/api/v1/admin/invites/{id}"))
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::empty())
        .unwrap();
    let del_resp2 = app.clone().oneshot(del_req2).await.unwrap();
    assert_eq!(del_resp2.status(), StatusCode::CONFLICT);
}

#[tokio::test]
async fn test_13_limited_inviter_cannot_revoke_another_users_invite() {
    let (app, pool) = setup_test_app().await;

    register_user(&app, "owner", "password123", None).await;
    let (_, owner_login) = login_user(&app, "owner", "password123", OWNER_CLIENT, None).await;
    let owner_token = owner_login["session_token"].as_str().unwrap();

    // Owner creates an invite
    let owner_create_req = Request::builder()
        .method("POST")
        .uri("/api/v1/admin/invites")
        .header(header::AUTHORIZATION, format!("Bearer {owner_token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({}).to_string()))
        .unwrap();
    let owner_create_resp = app.clone().oneshot(owner_create_req).await.unwrap();
    let owner_inv_body: Value = serde_json::from_slice(
        &axum::body::to_bytes(owner_create_resp.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    let owner_inv_id = owner_inv_body["id"].as_str().unwrap();
    let owner_inv_code = owner_inv_body["code"].as_str().unwrap();

    // Register inviter user
    let inviter_user_id =
        register_user(&app, "inviter_user", "password123", Some(owner_inv_code)).await;
    grant_role(&pool, &inviter_user_id, "inviter").await;

    let (_, inviter_login) =
        login_user(&app, "inviter_user", "password123", INVITER_CLIENT, None).await;
    let inviter_token = inviter_login["session_token"].as_str().unwrap();

    // Inviter attempts to revoke owner's invite
    let del_req = Request::builder()
        .method("DELETE")
        .uri(format!("/api/v1/admin/invites/{owner_inv_id}"))
        .header(header::AUTHORIZATION, format!("Bearer {inviter_token}"))
        .body(Body::empty())
        .unwrap();
    let del_resp = app.clone().oneshot(del_req).await.unwrap();
    assert_eq!(del_resp.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn test_14_public_code_validation_returns_valid_for_fresh_code() {
    let (app, _pool) = setup_test_app().await;

    register_user(&app, "owner", "password123", None).await;
    let (_, owner_login) = login_user(&app, "owner", "password123", OWNER_CLIENT, None).await;
    let owner_token = owner_login["session_token"].as_str().unwrap();

    let create_req = Request::builder()
        .method("POST")
        .uri("/api/v1/admin/invites")
        .header(header::AUTHORIZATION, format!("Bearer {owner_token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({"max_uses": 5}).to_string()))
        .unwrap();
    let create_resp = app.clone().oneshot(create_req).await.unwrap();
    let inv_body: Value = serde_json::from_slice(
        &axum::body::to_bytes(create_resp.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    let code = inv_body["code"].as_str().unwrap();

    let val_req = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/invites/{code}"))
        .body(Body::empty())
        .unwrap();
    let val_resp = app.clone().oneshot(val_req).await.unwrap();
    assert_eq!(val_resp.status(), StatusCode::OK);

    let val_body: Value = serde_json::from_slice(
        &axum::body::to_bytes(val_resp.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(val_body["valid"], true);
    assert_eq!(val_body["remaining_uses"], 5);
}

#[tokio::test]
async fn test_15_public_code_validation_returns_invalid_for_expired_code() {
    let (app, pool) = setup_test_app().await;

    sqlx::query(
        "INSERT INTO server_invites (id, code, max_uses, current_uses, expires_at) VALUES ('inv_exp', 'EXP12345', 5, 0, datetime('now', '-1 day'))",
    )
    .execute(&pool)
    .await
    .unwrap();

    let val_req = Request::builder()
        .method("GET")
        .uri("/api/v1/invites/EXP12345")
        .body(Body::empty())
        .unwrap();
    let val_resp = app.clone().oneshot(val_req).await.unwrap();
    assert_eq!(val_resp.status(), StatusCode::OK);

    let val_body: Value = serde_json::from_slice(
        &axum::body::to_bytes(val_resp.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(val_body["valid"], false);
    assert_eq!(val_body["reason"], "expired");
}

#[tokio::test]
async fn test_16_public_code_validation_returns_invalid_for_revoked_code() {
    let (app, pool) = setup_test_app().await;

    sqlx::query(
        "INSERT INTO server_invites (id, code, max_uses, current_uses, revoked_at) VALUES ('inv_rev', 'REV12345', 5, 0, datetime('now'))",
    )
    .execute(&pool)
    .await
    .unwrap();

    let val_req = Request::builder()
        .method("GET")
        .uri("/api/v1/invites/REV12345")
        .body(Body::empty())
        .unwrap();
    let val_resp = app.clone().oneshot(val_req).await.unwrap();
    assert_eq!(val_resp.status(), StatusCode::OK);

    let val_body: Value = serde_json::from_slice(
        &axum::body::to_bytes(val_resp.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(val_body["valid"], false);
    assert_eq!(val_body["reason"], "revoked");
}

#[tokio::test]
async fn test_17_public_code_validation_returns_invalid_for_exhausted_code() {
    let (app, pool) = setup_test_app().await;

    sqlx::query(
        "INSERT INTO server_invites (id, code, max_uses, current_uses) VALUES ('inv_exh', 'EXH12345', 1, 1)",
    )
    .execute(&pool)
    .await
    .unwrap();

    let val_req = Request::builder()
        .method("GET")
        .uri("/api/v1/invites/EXH12345")
        .body(Body::empty())
        .unwrap();
    let val_resp = app.clone().oneshot(val_req).await.unwrap();
    assert_eq!(val_resp.status(), StatusCode::OK);

    let val_body: Value = serde_json::from_slice(
        &axum::body::to_bytes(val_resp.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(val_body["valid"], false);
    assert_eq!(val_body["reason"], "exhausted");
}

#[tokio::test]
async fn test_18_public_code_validation_returns_invalid_for_unknown_code() {
    let (app, _pool) = setup_test_app().await;

    let val_req = Request::builder()
        .method("GET")
        .uri("/api/v1/invites/UNKNOWN1")
        .body(Body::empty())
        .unwrap();
    let val_resp = app.clone().oneshot(val_req).await.unwrap();
    assert_eq!(val_resp.status(), StatusCode::OK);

    let val_body: Value = serde_json::from_slice(
        &axum::body::to_bytes(val_resp.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(val_body["valid"], false);
    assert_eq!(val_body["reason"], "not_found");
}

#[tokio::test]
async fn test_19_consuming_an_invite_increments_current_uses() {
    let (app, pool) = setup_test_app().await;

    register_user(&app, "owner", "password123", None).await;

    sqlx::query(
        "INSERT INTO server_invites (id, code, max_uses, current_uses) VALUES ('inv_test', 'TESTCODE', 5, 0)",
    )
    .execute(&pool)
    .await
    .unwrap();

    register_user(&app, "user2", "password123", Some("TESTCODE")).await;

    let current_uses: i64 =
        sqlx::query_scalar("SELECT current_uses FROM server_invites WHERE id = 'inv_test'")
            .fetch_one(&pool)
            .await
            .unwrap();

    assert_eq!(current_uses, 1);
}

#[tokio::test]
async fn test_20_two_concurrent_registrations_with_max_uses_1_one_succeeds() {
    let (app, pool) = setup_test_app().await;

    register_user(&app, "owner", "password123", None).await;

    sqlx::query(
        "INSERT INTO server_invites (id, code, max_uses, current_uses) VALUES ('inv_single', 'SINGLE12', 1, 0)",
    )
    .execute(&pool)
    .await
    .unwrap();

    let app1 = app.clone();
    let app2 = app.clone();

    let h1 = tokio::spawn(async move {
        register_user(&app1, "user_a", "password123", Some("SINGLE12")).await
    });

    let h2 = tokio::spawn(async move {
        register_user(&app2, "user_b", "password123", Some("SINGLE12")).await
    });

    let res1 = h1.await;
    let res2 = h2.await;

    let successes = vec![res1.is_ok(), res2.is_ok()]
        .into_iter()
        .filter(|&x| x)
        .count();
    assert_eq!(successes, 1, "Expected exactly one registration to succeed");
}

#[tokio::test]
async fn test_21_rate_limit_on_invite_creation_is_enforced() {
    let (_app, pool, altcha_config) = setup_test_app_with_config(true, "auto", 100).await;

    let temp_dir = tempfile::tempdir().expect("Failed to create tempdir");
    let key_path = temp_dir.path().join("oprf.key");
    let opaque_server = std::sync::Arc::new(
        server::OpaqueServer::load_or_generate(&key_path).expect("OpaqueServer"),
    );
    let registration_store = std::sync::Arc::new(server::RegistrationStore::new());
    let login_store = std::sync::Arc::new(server::LoginStore::new());

    let cfg = server::Config {
        opaque_oprf_key_path: key_path.to_str().unwrap().to_string(),
        altcha_enabled: true,
        altcha_hmac_secret: "auto".to_string(),
        altcha_cost: 100,
        rate_limits: server::config::RateLimitConfig {
            invite_create_hourly: 2,
            ..server::Config::test_default().rate_limits
        },
        cleanup_enabled: true,
        cleanup_startup_delay_secs: 30,
        ..server::Config::test_default()
    };
    let cfg_arc = std::sync::Arc::new(cfg);
    let server_hard_max = std::sync::Arc::new(server::ServerHardMax {
        file_size_bytes: 104_857_600,
        room_size: 1000,
        rooms_per_user: 500,
        devices_per_user: 20,
        keypackages_per_device: 50,
        message_size_bytes: 65536,
        attachment_retention_days: 365,
        call_max_participants: 50,
        reactions_per_message: 50,
        room_metadata_bytes: cfg_arc.server_max_room_metadata_bytes,
        edit_window_seconds: cfg_arc.server_max_edit_window_seconds,
    });

    let sockudo_config = server::SockudoConfig {
        http_base: "http://localhost:6001".to_string(),
        app_id: "chat".to_string(),
        app_key: "test-key".to_string(),
        app_secret: "test-secret".to_string(),
        enable_client_events: true,
    };
    let storage = server::build_storage(&cfg_arc).expect("Failed to build storage");
    let publisher = std::sync::Arc::new(server::Publisher::new(sockudo_config));

    let oprf_keys = server::oprf::OprfKeys::load(&opaque_server.setup).unwrap();
    let oprf = std::sync::Arc::new(server::oprf::OprfEvaluator::new(&oprf_keys));
    let oprf_audit = std::sync::Arc::new(server::oprf::OprfAuditCounter::new());

    let session_types_state = server::sessions::init_session_types_state(
        cfg_arc.sessions_enabled,
        &cfg_arc.session_types_config_path,
        cfg_arc.server_max_session_participants,
        cfg_arc.server_max_sessions_per_room,
    );
    let session_types = Arc::new(server::sessions::SessionTypesStore::new(
        session_types_state,
    ));

    let state = server::AppState {
        pool: pool.clone(),
        opaque_server,
        registration_store,
        login_store,
        recovery_store: Arc::new(server::RecoveryStore::new()),
        altcha_config,
        config: cfg_arc,
        server_hard_max,
        publisher,
        storage,
        backup_lock: Arc::new(tokio::sync::Mutex::new(())),
        oprf_rotation_lock: Arc::new(tokio::sync::Mutex::new(())),
        vapid_keys: None,
        push_delivery: None,
        oprf,
        oprf_audit,
        link_preview_keys: None,
        session_types,
        models: std::sync::Arc::new(server::models::ModelStore::new(
            std::path::PathBuf::from("/tmp/stt"),
            std::path::PathBuf::from("/tmp/tts"),
        )),
        occupancy: server::sessions::OccupancyStore::new(),
        call_occupancy: server::calls::CallOccupancyStore::new(),
        extension_proxy_blocklist: std::sync::Arc::new(
            server::extensions_proxy::blocklist::DomainBlocklistStore::new(Default::default()),
        ),
    };

    let app = axum::Router::new()
        .route(
            "/api/v1/oprf/blind",
            axum::routing::post(routes::oprf::blind),
        )
        .route(
            "/api/v1/auth/register/challenge",
            axum::routing::get(routes::register::register_challenge),
        )
        .route(
            "/api/v1/auth/register/start",
            axum::routing::post(routes::register::register_start),
        )
        .route(
            "/api/v1/auth/register/finish",
            axum::routing::post(routes::register::register_finish),
        )
        .route(
            "/api/v1/auth/login/start",
            axum::routing::post(routes::login::login_start),
        )
        .route(
            "/api/v1/auth/login/finish",
            axum::routing::post(routes::login::login_finish),
        )
        .route(
            "/api/v1/admin/invites",
            axum::routing::post(routes::invites::create_invite_handler)
                .get(routes::invites::list_invites_handler),
        )
        .with_state(state);

    register_user(&app, "owner", "password123", None).await;
    let (_, login_body) = login_user(&app, "owner", "password123", OWNER_CLIENT, None).await;
    let token = login_body["session_token"].as_str().unwrap();

    // 1st create
    let req1 = Request::builder()
        .method("POST")
        .uri("/api/v1/admin/invites")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({}).to_string()))
        .unwrap();
    let resp1 = app.clone().oneshot(req1).await.unwrap();
    assert_eq!(resp1.status(), StatusCode::OK);

    // 2nd create
    let req2 = Request::builder()
        .method("POST")
        .uri("/api/v1/admin/invites")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({}).to_string()))
        .unwrap();
    let resp2 = app.clone().oneshot(req2).await.unwrap();
    assert_eq!(resp2.status(), StatusCode::OK);

    // 3rd create -> Rate Limited (429)
    let req3 = Request::builder()
        .method("POST")
        .uri("/api/v1/admin/invites")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({}).to_string()))
        .unwrap();
    let resp3 = app.clone().oneshot(req3).await.unwrap();
    assert_eq!(resp3.status(), StatusCode::TOO_MANY_REQUESTS);

    let body_bytes = axum::body::to_bytes(resp3.into_body(), usize::MAX)
        .await
        .unwrap();
    let body: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(body["error"], "rate_limited");
    assert!(body["details"]["reset_at"].is_string());
}
