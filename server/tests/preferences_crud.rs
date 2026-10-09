mod common;

use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use serde_json::{json, Value};
use tower::ServiceExt;

#[tokio::test]
async fn test_preference_crud_lifecycle() {
    let (app, _) = common::setup_test_app().await;

    // Register user
    let _user_id = common::register_user(&app, "alice", "Password123!", None).await;
    let (status, login_res) =
        common::login_user(&app, "alice", "Password123!", "client_device1_123456", None).await;
    assert_eq!(status, StatusCode::OK);
    let token = login_res["session_token"].as_str().unwrap();

    use base64::engine::general_purpose::URL_SAFE_NO_PAD;
    use base64::Engine;

    let dark_b64 = URL_SAFE_NO_PAD.encode(b"dark");
    let light_b64 = URL_SAFE_NO_PAD.encode(b"light");

    // 1. Write preference
    let req = Request::builder()
        .method("PATCH")
        .uri("/api/v1/users/me/preferences/theme")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "value": dark_b64 }).to_string()))
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    assert_eq!(
        resp.headers().get(header::CACHE_CONTROL).unwrap(),
        "no-store"
    );

    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let res: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(res["key"], "theme");
    assert_eq!(res["value"], dark_b64);
    assert_eq!(res["user_seq"], 2);

    // 2. Read preference back
    let req = Request::builder()
        .method("GET")
        .uri("/api/v1/users/me/preferences/theme")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::empty())
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    assert_eq!(
        resp.headers().get(header::CACHE_CONTROL).unwrap(),
        "no-store"
    );

    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let res: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(res["key"], "theme");
    assert_eq!(res["value"], dark_b64);
    assert_eq!(res["user_seq"], 2);

    // 3. Second write advances user_seq
    let req = Request::builder()
        .method("PATCH")
        .uri("/api/v1/users/me/preferences/theme")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "value": light_b64 }).to_string()))
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let res: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(res["value"], light_b64);
    assert_eq!(res["user_seq"], 3);

    // 4. Read unknown key returns 404
    let req = Request::builder()
        .method("GET")
        .uri("/api/v1/users/me/preferences/nonexistent")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::empty())
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);

    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let res: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(res["error"], "preference_not_found");

    // 5. Delete preference
    let req = Request::builder()
        .method("DELETE")
        .uri("/api/v1/users/me/preferences/theme")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::empty())
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::NO_CONTENT);
    assert_eq!(
        resp.headers().get(header::CACHE_CONTROL).unwrap(),
        "no-store"
    );

    // Read again returns 404
    let req = Request::builder()
        .method("GET")
        .uri("/api/v1/users/me/preferences/theme")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::empty())
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);

    // 6. Delete unknown key returns 404
    let req = Request::builder()
        .method("DELETE")
        .uri("/api/v1/users/me/preferences/theme")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::empty())
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn test_preference_json_types() {
    use base64::engine::general_purpose::URL_SAFE_NO_PAD;
    use base64::Engine;

    let (app, _) = common::setup_test_app().await;

    common::register_user(&app, "alice", "Password123!", None).await;
    let (_, login_res) =
        common::login_user(&app, "alice", "Password123!", "client_device1_123456", None).await;
    let token = login_res["session_token"].as_str().unwrap();

    let test_cases = vec![
        ("str-key", URL_SAFE_NO_PAD.encode(b"hello_world")),
        ("num-key", URL_SAFE_NO_PAD.encode(b"42")),
        ("bool-key", URL_SAFE_NO_PAD.encode(b"true")),
        ("null-key", URL_SAFE_NO_PAD.encode(b"null")),
        ("array-key", URL_SAFE_NO_PAD.encode(b"[1,2]")),
        ("object-key", URL_SAFE_NO_PAD.encode(b"{\"font_size\":14}")),
    ];

    for (key, val) in test_cases {
        let req = Request::builder()
            .method("PATCH")
            .uri(format!("/api/v1/users/me/preferences/{key}"))
            .header(header::AUTHORIZATION, format!("Bearer {token}"))
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(json!({ "value": val }).to_string()))
            .unwrap();

        let resp = app.clone().oneshot(req).await.unwrap();
        let status = resp.status();
        let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        if status != StatusCode::OK {
            panic!(
                "PATCH failed for key={}: status={}, body={}",
                key,
                status,
                String::from_utf8_lossy(&body_bytes)
            );
        }

        let res: Value = serde_json::from_slice(&body_bytes).unwrap();
        assert_eq!(res["key"], key);
        assert_eq!(res["value"], val);

        // GET and verify
        let req = Request::builder()
            .method("GET")
            .uri(format!("/api/v1/users/me/preferences/{key}"))
            .header(header::AUTHORIZATION, format!("Bearer {token}"))
            .body(Body::empty())
            .unwrap();

        let resp = app.clone().oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let res: Value = serde_json::from_slice(&body_bytes).unwrap();
        assert_eq!(res["value"], val);
    }
}

#[tokio::test]
async fn test_preference_cross_user_isolation() {
    use base64::engine::general_purpose::URL_SAFE_NO_PAD;
    use base64::Engine;

    let (app, pool) = common::setup_test_app().await;

    // Register User A
    common::register_user(&app, "alice", "Password123!", None).await;
    let (_, login_a) =
        common::login_user(&app, "alice", "Password123!", "client_device1_123456", None).await;
    let token_a = login_a["session_token"].as_str().unwrap();

    // Create server invite for User B
    sqlx::query(
        "INSERT INTO server_invites (id, code, max_uses, current_uses) VALUES ('inv_pref_b', 'INVITEPREFB123', 1, 0)",
    )
    .execute(&pool)
    .await
    .unwrap();

    // Register User B with invite
    common::register_user(&app, "bob", "Password123!", Some("INVITEPREFB123")).await;
    let (_, login_b) =
        common::login_user(&app, "bob", "Password123!", "client_device2_123456", None).await;
    let token_b = login_b["session_token"].as_str().unwrap();

    let dark_b64 = URL_SAFE_NO_PAD.encode(b"dark");
    let light_b64 = URL_SAFE_NO_PAD.encode(b"light");

    // User A writes theme=dark
    let req = Request::builder()
        .method("PATCH")
        .uri("/api/v1/users/me/preferences/theme")
        .header(header::AUTHORIZATION, format!("Bearer {token_a}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "value": dark_b64 }).to_string()))
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    // User B reads theme -> 404
    let req = Request::builder()
        .method("GET")
        .uri("/api/v1/users/me/preferences/theme")
        .header(header::AUTHORIZATION, format!("Bearer {token_b}"))
        .body(Body::empty())
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);

    // User B writes theme=light
    let req = Request::builder()
        .method("PATCH")
        .uri("/api/v1/users/me/preferences/theme")
        .header(header::AUTHORIZATION, format!("Bearer {token_b}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({ "value": light_b64 }).to_string()))
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    // User A reads theme -> still "dark"
    let req = Request::builder()
        .method("GET")
        .uri("/api/v1/users/me/preferences/theme")
        .header(header::AUTHORIZATION, format!("Bearer {token_a}"))
        .body(Body::empty())
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let res: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(res["value"], dark_b64);
}
