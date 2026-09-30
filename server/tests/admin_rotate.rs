mod common;

use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use common::{login_user, register_user, setup_test_app};
use serde_json::Value;
use tower::ServiceExt;

#[tokio::test]
async fn test_admin_rotate_vapid_and_altcha_endpoints() {
    let (app, _) = setup_test_app().await;

    // Register owner
    let _owner_id = register_user(&app, "admin_owner", "Password123!", None).await;
    let (status, login_val) = login_user(
        &app,
        "admin_owner",
        "Password123!",
        "client_device_12345",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let owner_token = login_val["session_token"].as_str().unwrap();

    // Register member user (non-admin)
    let inv_req = Request::builder()
        .method("POST")
        .uri("/api/v1/admin/invites")
        .header(header::AUTHORIZATION, format!("Bearer {}", owner_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(serde_json::json!({}).to_string()))
        .unwrap();
    let inv_resp = app.clone().oneshot(inv_req).await.unwrap();
    assert_eq!(inv_resp.status(), StatusCode::OK);
    let inv_bytes = axum::body::to_bytes(inv_resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let inv_json: Value = serde_json::from_slice(&inv_bytes).unwrap();
    let code = inv_json["code"].as_str().unwrap();

    let _member_id = register_user(&app, "regular_member", "Password123!", Some(code)).await;
    let (status_m, login_m) = login_user(
        &app,
        "regular_member",
        "Password123!",
        "client_device_67890",
        None,
    )
    .await;
    assert_eq!(status_m, StatusCode::OK);
    let member_token = login_m["session_token"].as_str().unwrap();

    // 1. Non-admin forbidden for VAPID rotate
    let req_v_forbidden = Request::builder()
        .method("POST")
        .uri("/api/v1/admin/vapid/rotate")
        .header(header::AUTHORIZATION, format!("Bearer {}", member_token))
        .body(Body::empty())
        .unwrap();
    let resp_v_forbidden = app.clone().oneshot(req_v_forbidden).await.unwrap();
    assert_eq!(resp_v_forbidden.status(), StatusCode::FORBIDDEN);

    // 2. Non-admin forbidden for ALTCHA rotate
    let req_a_forbidden = Request::builder()
        .method("POST")
        .uri("/api/v1/admin/altcha/rotate")
        .header(header::AUTHORIZATION, format!("Bearer {}", member_token))
        .body(Body::empty())
        .unwrap();
    let resp_a_forbidden = app.clone().oneshot(req_a_forbidden).await.unwrap();
    assert_eq!(resp_a_forbidden.status(), StatusCode::FORBIDDEN);

    // 3. Admin success for VAPID rotate
    let req_v_ok = Request::builder()
        .method("POST")
        .uri("/api/v1/admin/vapid/rotate")
        .header(header::AUTHORIZATION, format!("Bearer {}", owner_token))
        .body(Body::empty())
        .unwrap();
    let resp_v_ok = app.clone().oneshot(req_v_ok).await.unwrap();
    assert_eq!(resp_v_ok.status(), StatusCode::OK);
    let v_bytes = axum::body::to_bytes(resp_v_ok.into_body(), usize::MAX)
        .await
        .unwrap();
    let v_json: Value = serde_json::from_slice(&v_bytes).unwrap();
    assert!(v_json["public_key"].is_string());

    // 4. Admin success for ALTCHA rotate
    let req_a_ok = Request::builder()
        .method("POST")
        .uri("/api/v1/admin/altcha/rotate")
        .header(header::AUTHORIZATION, format!("Bearer {}", owner_token))
        .body(Body::empty())
        .unwrap();
    let resp_a_ok = app.clone().oneshot(req_a_ok).await.unwrap();
    assert_eq!(resp_a_ok.status(), StatusCode::OK);
    let a_bytes = axum::body::to_bytes(resp_a_ok.into_body(), usize::MAX)
        .await
        .unwrap();
    let a_json: Value = serde_json::from_slice(&a_bytes).unwrap();
    assert_eq!(a_json["ok"], true);

    // 5. Verify no OPRF rotate admin endpoint exists
    let req_oprf = Request::builder()
        .method("POST")
        .uri("/api/v1/admin/oprf/rotate")
        .header(header::AUTHORIZATION, format!("Bearer {}", owner_token))
        .body(Body::empty())
        .unwrap();
    let resp_oprf = app.clone().oneshot(req_oprf).await.unwrap();
    assert_eq!(resp_oprf.status(), StatusCode::NOT_FOUND);
}
