mod common;

use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use common::{register_user, setup_test_app};
use serde_json::{json, Value};
use tower::ServiceExt;

async fn setup_owner_and_member() -> (axum::Router, sqlx::SqlitePool, String, String, String) {
    let (app, pool) = setup_test_app().await;

    // Owner registration writes bootstrap.owner audit entry
    let owner_id = register_user(&app, "owner_user", "Password123!", None).await;
    let (status, login_res) = common::login_user(
        &app,
        "owner_user",
        "Password123!",
        "owner_device_client_1",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let owner_token = login_res["session_token"].as_str().unwrap().to_string();

    // Create invite
    let req_invite = Request::builder()
        .method("POST")
        .uri("/api/v1/admin/invites")
        .header(header::AUTHORIZATION, format!("Bearer {}", owner_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "max_uses": 1 }).to_string()))
        .unwrap();

    let resp_invite = app.clone().oneshot(req_invite).await.unwrap();
    let body_bytes = axum::body::to_bytes(resp_invite.into_body(), usize::MAX)
        .await
        .unwrap();
    let invite_json: Value = serde_json::from_slice(&body_bytes).unwrap();
    let invite_code = invite_json["code"].as_str().unwrap();

    // Register member
    let _member_id = register_user(&app, "member_user", "Password123!", Some(invite_code)).await;
    let (status_m, login_res_m) = common::login_user(
        &app,
        "member_user",
        "Password123!",
        "member_device_client_1",
        None,
    )
    .await;
    assert_eq!(status_m, StatusCode::OK);
    let member_token = login_res_m["session_token"].as_str().unwrap().to_string();

    (app, pool, owner_id, owner_token, member_token)
}

#[tokio::test]
async fn test_01_config_update_writes_audit_entry() {
    let (app, _pool, _owner_id, owner_token, _member_token) = setup_owner_and_member().await;

    // Update config
    let req_patch = Request::builder()
        .method("PATCH")
        .uri("/api/v1/admin/config")
        .header(header::AUTHORIZATION, format!("Bearer {}", owner_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({ "moderation_mode": "discord" }).to_string(),
        ))
        .unwrap();

    let resp_patch = app.clone().oneshot(req_patch).await.unwrap();
    assert_eq!(resp_patch.status(), StatusCode::OK);

    // Read audit log
    let req_audit = Request::builder()
        .method("GET")
        .uri("/api/v1/admin/audit?action=config.update")
        .header(header::AUTHORIZATION, format!("Bearer {}", owner_token))
        .body(Body::empty())
        .unwrap();

    let resp_audit = app.oneshot(req_audit).await.unwrap();
    assert_eq!(resp_audit.status(), StatusCode::OK);

    let body_bytes = axum::body::to_bytes(resp_audit.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body_bytes).unwrap();

    let entries = json["entries"].as_array().unwrap();
    assert!(!entries.is_empty());
    assert_eq!(entries[0]["action"], "config.update");
    assert_eq!(entries[0]["metadata"]["key"], "moderation_mode");
    assert_eq!(entries[0]["metadata"]["value"], "discord");
}

#[tokio::test]
async fn test_02_limits_update_writes_audit_entry() {
    let (app, _pool, _owner_id, owner_token, _member_token) = setup_owner_and_member().await;

    let valid_limits = json!({
        "file_size_bytes": 52428800,
        "room_size": 50,
        "rooms_per_user": 20,
        "devices_per_user": 5,
        "keypackages_per_device": 10,
        "message_size_bytes": 8192,
        "attachment_retention_days": 30,
        "call_max_participants": 4
    });

    let req_patch = Request::builder()
        .method("PATCH")
        .uri("/api/v1/admin/limits")
        .header(header::AUTHORIZATION, format!("Bearer {}", owner_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(valid_limits.to_string()))
        .unwrap();

    let resp_patch = app.clone().oneshot(req_patch).await.unwrap();
    assert_eq!(resp_patch.status(), StatusCode::OK);

    let req_audit = Request::builder()
        .method("GET")
        .uri("/api/v1/admin/audit?action=limits.update")
        .header(header::AUTHORIZATION, format!("Bearer {}", owner_token))
        .body(Body::empty())
        .unwrap();

    let resp_audit = app.oneshot(req_audit).await.unwrap();
    assert_eq!(resp_audit.status(), StatusCode::OK);

    let body_bytes = axum::body::to_bytes(resp_audit.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body_bytes).unwrap();

    let entries = json["entries"].as_array().unwrap();
    assert!(!entries.is_empty());
    assert_eq!(entries[0]["action"], "limits.update");
    assert_eq!(entries[0]["metadata"]["file_size_bytes"], 52428800);
}

#[tokio::test]
async fn test_03_secret_update_audit_entry_has_no_value_in_metadata() {
    let (_app, pool, owner_id, _owner_token, _member_token) = setup_owner_and_member().await;

    // Call set_secret directly
    server::config_ops::set_secret(
        &pool,
        "altcha_hmac_secret",
        "supersecret123",
        Some(&owner_id),
    )
    .await
    .unwrap();

    let entries = server::audit::list(
        &pool,
        server::audit::AuditFilter {
            action: Some("secret.update".to_string()),
            ..Default::default()
        },
        1,
        10,
    )
    .await
    .unwrap();

    assert_eq!(entries.len(), 1);
    let entry = &entries[0];
    assert_eq!(entry.action, "secret.update");

    let meta = entry.metadata.as_ref().unwrap();
    assert_eq!(meta["key"], "altcha_hmac_secret");
    assert!(meta.get("value").is_none());
}

#[tokio::test]
async fn test_04_invite_creation_and_device_revocation_write_audit_entries() {
    let (app, pool, owner_id, _owner_token, member_token) = setup_owner_and_member().await;

    // Login second device for member
    let (status, _login_res) = common::login_user(
        &app,
        "member_user",
        "Password123!",
        "member_device_client_2",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    // Get device list for member to find device_2 id
    let req_devs = Request::builder()
        .method("GET")
        .uri("/api/v1/users/me/devices")
        .header(header::AUTHORIZATION, format!("Bearer {}", member_token))
        .body(Body::empty())
        .unwrap();

    let resp_devs = app.clone().oneshot(req_devs).await.unwrap();
    let body_bytes = axum::body::to_bytes(resp_devs.into_body(), usize::MAX)
        .await
        .unwrap();
    let devs_json: Value = serde_json::from_slice(&body_bytes).unwrap();
    let dev2_id = devs_json["devices"]
        .as_array()
        .unwrap()
        .iter()
        .find(|d| d["client_id"] == "member_device_client_2")
        .unwrap()["id"]
        .as_str()
        .unwrap();

    // Revoke device_2
    let req_rev = Request::builder()
        .method("DELETE")
        .uri(format!("/api/v1/users/me/devices/{}", dev2_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", member_token))
        .body(Body::empty())
        .unwrap();

    let resp_rev = app.clone().oneshot(req_rev).await.unwrap();
    assert_eq!(resp_rev.status(), StatusCode::NO_CONTENT);

    // Read audit entries
    let entries = server::audit::list(
        &pool,
        server::audit::AuditFilter {
            action: Some("device.revoke".to_string()),
            ..Default::default()
        },
        1,
        10,
    )
    .await
    .unwrap();

    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].target_id.as_deref(), Some(dev2_id));

    // Verify invite creation entry exists for owner
    let invite_entries = server::audit::list(
        &pool,
        server::audit::AuditFilter {
            actor_id: Some(owner_id),
            action: Some("invite.create".to_string()),
            ..Default::default()
        },
        1,
        10,
    )
    .await
    .unwrap();

    assert!(!invite_entries.is_empty());
}

#[tokio::test]
async fn test_05_audit_list_filtering_and_pagination() {
    let (app, _pool, owner_id, owner_token, _member_token) = setup_owner_and_member().await;

    // Filter by actor_id
    let req = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/admin/audit?actor_id={}", owner_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", owner_token))
        .body(Body::empty())
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body_bytes).unwrap();
    let entries = json["entries"].as_array().unwrap();
    assert!(!entries.is_empty());

    // Filter by action
    let req2 = Request::builder()
        .method("GET")
        .uri("/api/v1/admin/audit?action=bootstrap.owner")
        .header(header::AUTHORIZATION, format!("Bearer {}", owner_token))
        .body(Body::empty())
        .unwrap();

    let resp2 = app.clone().oneshot(req2).await.unwrap();
    assert_eq!(resp2.status(), StatusCode::OK);

    let body_bytes2 = axum::body::to_bytes(resp2.into_body(), usize::MAX)
        .await
        .unwrap();
    let json2: Value = serde_json::from_slice(&body_bytes2).unwrap();
    let entries2 = json2["entries"].as_array().unwrap();
    assert_eq!(entries2.len(), 1);
    assert_eq!(entries2[0]["action"], "bootstrap.owner");
}

#[tokio::test]
async fn test_06_non_admin_cannot_read_audit_log() {
    let (app, _pool, _owner_id, _owner_token, member_token) = setup_owner_and_member().await;

    let req = Request::builder()
        .method("GET")
        .uri("/api/v1/admin/audit")
        .header(header::AUTHORIZATION, format!("Bearer {}", member_token))
        .body(Body::empty())
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);
}
