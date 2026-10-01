mod common;

use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use common::{register_user, setup_test_app};
use serde_json::{json, Value};
use tower::ServiceExt;

fn valid_disp() -> String {
    URL_SAFE_NO_PAD.encode([0u8; 32])
}

#[tokio::test]
async fn test_01_valid_token_authenticates() {
    let (app, _pool) = setup_test_app().await;

    let user_id = register_user(&app, "alice", "Password123!", None).await;
    let (status, login_res) =
        common::login_user(&app, "alice", "Password123!", "device_client_123456", None).await;
    assert_eq!(status, StatusCode::OK);
    let token = login_res["session_token"].as_str().unwrap();

    let req = Request::builder()
        .method("GET")
        .uri("/api/v1/users/me")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .body(Body::empty())
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body_bytes).unwrap();

    assert_eq!(json["id"], user_id);
    assert!(json["username_token"].is_string());
    assert_eq!(json["is_owner"], true);
}

#[tokio::test]
async fn test_02_missing_authorization_header_returns_401() {
    let (app, _pool) = setup_test_app().await;

    let req = Request::builder()
        .method("GET")
        .uri("/api/v1/users/me")
        .body(Body::empty())
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);

    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(json["error"], "unauthorized");
}

#[tokio::test]
async fn test_03_malformed_authorization_header_returns_401() {
    let (app, _pool) = setup_test_app().await;

    // NotBearer
    let req1 = Request::builder()
        .method("GET")
        .uri("/api/v1/users/me")
        .header(header::AUTHORIZATION, "NotBearer abc")
        .body(Body::empty())
        .unwrap();

    let resp1 = app.clone().oneshot(req1).await.unwrap();
    assert_eq!(resp1.status(), StatusCode::UNAUTHORIZED);

    // Bearer without token
    let req2 = Request::builder()
        .method("GET")
        .uri("/api/v1/users/me")
        .header(header::AUTHORIZATION, "Bearer ")
        .body(Body::empty())
        .unwrap();

    let resp2 = app.oneshot(req2).await.unwrap();
    assert_eq!(resp2.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn test_04_invalid_token_returns_401() {
    let (app, _pool) = setup_test_app().await;

    let req = Request::builder()
        .method("GET")
        .uri("/api/v1/users/me")
        .header(header::AUTHORIZATION, "Bearer invalid_random_token_string")
        .body(Body::empty())
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);

    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(json["error"], "unauthorized");
}

#[tokio::test]
async fn test_05_revoked_token_returns_401() {
    let (app, pool) = setup_test_app().await;

    register_user(&app, "alice", "Password123!", None).await;
    let (status, login_res) =
        common::login_user(&app, "alice", "Password123!", "device_client_123456", None).await;
    assert_eq!(status, StatusCode::OK);
    let token = login_res["session_token"].as_str().unwrap();

    // Revoke the session via database
    sqlx::query("UPDATE sessions SET revoked_at = CURRENT_TIMESTAMP")
        .execute(&pool)
        .await
        .unwrap();

    let req = Request::builder()
        .method("GET")
        .uri("/api/v1/users/me")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .body(Body::empty())
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn test_06_expired_token_returns_401() {
    let (app, pool) = setup_test_app().await;

    register_user(&app, "alice", "Password123!", None).await;
    let (status, login_res) =
        common::login_user(&app, "alice", "Password123!", "device_client_123456", None).await;
    assert_eq!(status, StatusCode::OK);
    let token = login_res["session_token"].as_str().unwrap();

    // Set expires_at to past
    sqlx::query("UPDATE sessions SET expires_at = datetime('now', '-1 day')")
        .execute(&pool)
        .await
        .unwrap();

    let req = Request::builder()
        .method("GET")
        .uri("/api/v1/users/me")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .body(Body::empty())
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn test_07_disabled_user_is_rejected_and_session_revoked() {
    let (app, pool) = setup_test_app().await;

    let user_id = register_user(&app, "alice", "Password123!", None).await;
    let (status, login_res) =
        common::login_user(&app, "alice", "Password123!", "device_client_123456", None).await;
    assert_eq!(status, StatusCode::OK);
    let token = login_res["session_token"].as_str().unwrap();

    // Set disabled_at on user row
    sqlx::query("UPDATE users SET disabled_at = CURRENT_TIMESTAMP WHERE id = ?")
        .bind(&user_id)
        .execute(&pool)
        .await
        .unwrap();

    let req = Request::builder()
        .method("GET")
        .uri("/api/v1/users/me")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .body(Body::empty())
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);

    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(json["error"], "account_disabled");

    // Assert the session row now has revoked_at set
    let revoked_at: Option<String> =
        sqlx::query_scalar("SELECT revoked_at FROM sessions WHERE user_id = ?")
            .bind(&user_id)
            .fetch_one(&pool)
            .await
            .unwrap();

    assert!(revoked_at.is_some());
}

#[tokio::test]
async fn test_08_patch_users_me_updates_display_name() {
    let (app, _pool) = setup_test_app().await;

    register_user(&app, "alice", "Password123!", None).await;
    let (status, login_res) =
        common::login_user(&app, "alice", "Password123!", "device_client_123456", None).await;
    assert_eq!(status, StatusCode::OK);
    let token = login_res["session_token"].as_str().unwrap();

    let disp = valid_disp();

    let req = Request::builder()
        .method("PATCH")
        .uri("/api/v1/users/me")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "encrypted_display": disp }).to_string()))
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body_bytes).unwrap();

    assert_eq!(json["encrypted_display"], disp);
    assert_eq!(json["profile_version"], 2);
}

#[tokio::test]
async fn test_09_patch_users_me_rejects_username_changes() {
    let (app, _pool) = setup_test_app().await;

    register_user(&app, "alice", "Password123!", None).await;
    let (status, login_res) =
        common::login_user(&app, "alice", "Password123!", "device_client_123456", None).await;
    assert_eq!(status, StatusCode::OK);
    let token = login_res["session_token"].as_str().unwrap();

    let req = Request::builder()
        .method("PATCH")
        .uri("/api/v1/users/me")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({ "username_token": "newname" }).to_string(),
        ))
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);

    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(json["error"], "username_immutable");
}

#[tokio::test]
async fn test_10_patch_users_me_validates_display_name_length() {
    let (app, _pool) = setup_test_app().await;

    register_user(&app, "alice", "Password123!", None).await;
    let (status, login_res) =
        common::login_user(&app, "alice", "Password123!", "device_client_123456", None).await;
    assert_eq!(status, StatusCode::OK);
    let token = login_res["session_token"].as_str().unwrap();

    // Invalid length encrypted_display (short)
    let req1 = Request::builder()
        .method("PATCH")
        .uri("/api/v1/users/me")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({ "encrypted_display": "short" }).to_string(),
        ))
        .unwrap();

    let resp1 = app.clone().oneshot(req1).await.unwrap();
    assert_eq!(resp1.status(), StatusCode::BAD_REQUEST);

    // Empty string display name -> treats as null
    let req2 = Request::builder()
        .method("PATCH")
        .uri("/api/v1/users/me")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({ "encrypted_display": "   " }).to_string(),
        ))
        .unwrap();

    let resp2 = app.oneshot(req2).await.unwrap();
    assert_eq!(resp2.status(), StatusCode::OK);

    let body_bytes2 = axum::body::to_bytes(resp2.into_body(), usize::MAX)
        .await
        .unwrap();
    let json2: Value = serde_json::from_slice(&body_bytes2).unwrap();
    assert!(json2["encrypted_display"].is_null());
}

#[tokio::test]
async fn test_11_get_users_me_sessions_lists_active_sessions() {
    let (app, _pool) = setup_test_app().await;

    register_user(&app, "alice", "Password123!", None).await;

    // Login A
    let (status_a, login_a) =
        common::login_user(&app, "alice", "Password123!", "device_client_111111", None).await;
    assert_eq!(status_a, StatusCode::OK);
    let token_a = login_a["session_token"].as_str().unwrap();

    // Login B
    let (status_b, _login_b) =
        common::login_user(&app, "alice", "Password123!", "device_client_222222", None).await;
    assert_eq!(status_b, StatusCode::OK);

    let req = Request::builder()
        .method("GET")
        .uri("/api/v1/users/me/sessions")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body_bytes).unwrap();

    let sessions = json["sessions"].as_array().unwrap();
    assert_eq!(sessions.len(), 2);

    let current_count = sessions.iter().filter(|s| s["is_current"] == true).count();
    assert_eq!(current_count, 1);
}

#[tokio::test]
async fn test_12_delete_users_me_sessions_id_revokes_another_session() {
    let (app, _pool) = setup_test_app().await;

    register_user(&app, "alice", "Password123!", None).await;

    // Login A
    let (status_a, login_a) =
        common::login_user(&app, "alice", "Password123!", "device_client_111111", None).await;
    assert_eq!(status_a, StatusCode::OK);
    let token_a = login_a["session_token"].as_str().unwrap();

    // Login B
    let (status_b, login_b) =
        common::login_user(&app, "alice", "Password123!", "device_client_222222", None).await;
    assert_eq!(status_b, StatusCode::OK);
    let token_b = login_b["session_token"].as_str().unwrap();

    // List sessions via token A to get session B's ID
    let req_list = Request::builder()
        .method("GET")
        .uri("/api/v1/users/me/sessions")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();

    let resp_list = app.clone().oneshot(req_list).await.unwrap();
    let body_bytes = axum::body::to_bytes(resp_list.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_list: Value = serde_json::from_slice(&body_bytes).unwrap();

    let sessions = json_list["sessions"].as_array().unwrap();
    let session_b_id = sessions.iter().find(|s| s["is_current"] == false).unwrap()["id"]
        .as_str()
        .unwrap();

    // Delete session B targeting session_b_id
    let req_del = Request::builder()
        .method("DELETE")
        .uri(format!("/api/v1/users/me/sessions/{}", session_b_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();

    let resp_del = app.clone().oneshot(req_del).await.unwrap();
    assert_eq!(resp_del.status(), StatusCode::NO_CONTENT);

    // Attempt to use token B
    let req_b = Request::builder()
        .method("GET")
        .uri("/api/v1/users/me")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_b))
        .body(Body::empty())
        .unwrap();

    let resp_b = app.oneshot(req_b).await.unwrap();
    assert_eq!(resp_b.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn test_13_delete_users_me_sessions_id_rejects_revoking_current_session() {
    let (app, _pool) = setup_test_app().await;

    register_user(&app, "alice", "Password123!", None).await;

    let (status, login_res) =
        common::login_user(&app, "alice", "Password123!", "device_client_111111", None).await;
    assert_eq!(status, StatusCode::OK);
    let token = login_res["session_token"].as_str().unwrap();

    // List sessions to get current session ID
    let req_list = Request::builder()
        .method("GET")
        .uri("/api/v1/users/me/sessions")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .body(Body::empty())
        .unwrap();

    let resp_list = app.clone().oneshot(req_list).await.unwrap();
    let body_bytes = axum::body::to_bytes(resp_list.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_list: Value = serde_json::from_slice(&body_bytes).unwrap();

    let current_session_id = json_list["sessions"][0]["id"].as_str().unwrap();

    // Call DELETE with current session ID
    let req_del = Request::builder()
        .method("DELETE")
        .uri(format!("/api/v1/users/me/sessions/{}", current_session_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .body(Body::empty())
        .unwrap();

    let resp_del = app.oneshot(req_del).await.unwrap();
    assert_eq!(resp_del.status(), StatusCode::BAD_REQUEST);

    let body_bytes_del = axum::body::to_bytes(resp_del.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_del: Value = serde_json::from_slice(&body_bytes_del).unwrap();
    assert_eq!(json_del["error"], "cannot_revoke_current_session");
}

#[tokio::test]
async fn test_14_delete_users_me_sessions_id_returns_404_for_unknown_session() {
    let (app, _pool) = setup_test_app().await;

    register_user(&app, "alice", "Password123!", None).await;

    let (status, login_res) =
        common::login_user(&app, "alice", "Password123!", "device_client_111111", None).await;
    assert_eq!(status, StatusCode::OK);
    let token = login_res["session_token"].as_str().unwrap();

    let req_del = Request::builder()
        .method("DELETE")
        .uri("/api/v1/users/me/sessions/unknown_session_id_999")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .body(Body::empty())
        .unwrap();

    let resp_del = app.oneshot(req_del).await.unwrap();
    assert_eq!(resp_del.status(), StatusCode::NOT_FOUND);

    let body_bytes = axum::body::to_bytes(resp_del.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(json["error"], "session_not_found");
}

#[tokio::test]
async fn test_15_delete_users_me_sessions_id_returns_404_for_another_user_session() {
    let (app, pool) = setup_test_app().await;

    // Register User A
    let _user_a_id = register_user(&app, "alice", "Password123!", None).await;

    // Insert invite code for User B
    sqlx::query(
        "INSERT INTO server_invites (id, code, max_uses, current_uses) VALUES ('inv_1', 'INVITE123', 1, 0)",
    )
    .execute(&pool)
    .await
    .unwrap();

    // Register User B
    let _user_b_id = register_user(&app, "bob", "Password123!", Some("INVITE123")).await;

    // Login User A
    let (status_a, login_a) =
        common::login_user(&app, "alice", "Password123!", "device_client_111111", None).await;
    assert_eq!(status_a, StatusCode::OK);
    let token_a = login_a["session_token"].as_str().unwrap();

    // Login User B
    let (status_b, login_b) =
        common::login_user(&app, "bob", "Password123!", "device_client_222222", None).await;
    assert_eq!(status_b, StatusCode::OK);
    let token_b = login_b["session_token"].as_str().unwrap();

    // Get User B session ID using User B token
    let req_list_b = Request::builder()
        .method("GET")
        .uri("/api/v1/users/me/sessions")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_b))
        .body(Body::empty())
        .unwrap();

    let resp_list_b = app.clone().oneshot(req_list_b).await.unwrap();
    let body_bytes_b = axum::body::to_bytes(resp_list_b.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_b: Value = serde_json::from_slice(&body_bytes_b).unwrap();
    let session_b_id = json_b["sessions"][0]["id"].as_str().unwrap();

    // User A attempts to delete User B's session
    let req_del = Request::builder()
        .method("DELETE")
        .uri(format!("/api/v1/users/me/sessions/{}", session_b_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();

    let resp_del = app.oneshot(req_del).await.unwrap();
    assert_eq!(resp_del.status(), StatusCode::NOT_FOUND);

    let body_bytes = axum::body::to_bytes(resp_del.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(json["error"], "session_not_found");
}

#[tokio::test]
async fn test_16_post_auth_logout_revokes_current_session() {
    let (app, _pool) = setup_test_app().await;

    register_user(&app, "alice", "Password123!", None).await;

    let (status, login_res) =
        common::login_user(&app, "alice", "Password123!", "device_client_111111", None).await;
    assert_eq!(status, StatusCode::OK);
    let token = login_res["session_token"].as_str().unwrap();

    // Logout
    let req_logout = Request::builder()
        .method("POST")
        .uri("/api/v1/auth/logout")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .body(Body::empty())
        .unwrap();

    let resp_logout = app.clone().oneshot(req_logout).await.unwrap();
    assert_eq!(resp_logout.status(), StatusCode::NO_CONTENT);

    // Reuse token -> 401
    let req_me = Request::builder()
        .method("GET")
        .uri("/api/v1/users/me")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .body(Body::empty())
        .unwrap();

    let resp_me = app.oneshot(req_me).await.unwrap();
    assert_eq!(resp_me.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn test_17_post_auth_logout_with_all_sessions_true_revokes_all_sessions() {
    let (app, _pool) = setup_test_app().await;

    register_user(&app, "alice", "Password123!", None).await;

    // Login A, B, C
    let (_, login_a) =
        common::login_user(&app, "alice", "Password123!", "device_client_111111", None).await;
    let token_a = login_a["session_token"].as_str().unwrap();

    let (_, login_b) =
        common::login_user(&app, "alice", "Password123!", "device_client_222222", None).await;
    let token_b = login_b["session_token"].as_str().unwrap();

    let (_, login_c) =
        common::login_user(&app, "alice", "Password123!", "device_client_333333", None).await;
    let token_c = login_c["session_token"].as_str().unwrap();

    // Call logout with token_a and all_sessions=true
    let req_logout = Request::builder()
        .method("POST")
        .uri("/api/v1/auth/logout")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "all_sessions": true }).to_string()))
        .unwrap();

    let resp_logout = app.clone().oneshot(req_logout).await.unwrap();
    assert_eq!(resp_logout.status(), StatusCode::NO_CONTENT);

    // Attempt to use tokens B and C -> both return 401
    let req_b = Request::builder()
        .method("GET")
        .uri("/api/v1/users/me")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_b))
        .body(Body::empty())
        .unwrap();

    let resp_b = app.clone().oneshot(req_b).await.unwrap();
    assert_eq!(resp_b.status(), StatusCode::UNAUTHORIZED);

    let req_c = Request::builder()
        .method("GET")
        .uri("/api/v1/users/me")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_c))
        .body(Body::empty())
        .unwrap();

    let resp_c = app.oneshot(req_c).await.unwrap();
    assert_eq!(resp_c.status(), StatusCode::UNAUTHORIZED);
}
