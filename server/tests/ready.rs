mod common;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use common::setup_test_app;
use serde_json::Value;
use tower::ServiceExt;

#[tokio::test]
async fn test_01_ready_endpoint_is_unauthenticated_and_returns_200_when_healthy() {
    let (app, _pool) = setup_test_app().await;

    let req = Request::builder()
        .method("GET")
        .uri("/ready")
        .body(Body::empty())
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body_bytes).unwrap();

    assert_eq!(json["status"], "ready");
    assert_eq!(json["checks"]["database"], "ok");
    assert_eq!(json["checks"]["oprf_key"], "ok");
    assert_eq!(json["checks"]["sockudo"], "skipped");
}

#[tokio::test]
async fn test_02_ready_endpoint_returns_503_when_database_closed() {
    let (app, pool) = setup_test_app().await;

    // Close database pool to simulate DB failure
    pool.close().await;

    let req = Request::builder()
        .method("GET")
        .uri("/ready")
        .body(Body::empty())
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::SERVICE_UNAVAILABLE);

    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body_bytes).unwrap();

    assert_eq!(json["status"], "not_ready");
    assert!(json["checks"]["database"]
        .as_str()
        .unwrap()
        .starts_with("failed"));
}
