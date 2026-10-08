use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use base64::Engine;
use serde_json::{json, Value};
use std::io::Write;
use tempfile::NamedTempFile;
use tower::ServiceExt;

mod common;
use common::{login_user, register_user, setup_test_app_with_custom_config};
use sqlx::SqlitePool;

async fn setup_session_app(types_file_path: &str) -> (axum::Router, SqlitePool) {
    let (app, pool, _) = setup_test_app_with_custom_config(|cfg| {
        cfg.sessions_enabled = true;
        cfg.session_types_config_path = types_file_path.to_string();
    })
    .await;
    (app, pool)
}

async fn upload_key_package(app: &axum::Router, token: &str, client_id: &str) {
    let kp_req = Request::builder()
        .method("POST")
        .uri("/api/v1/keypackages")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "packages": [{
                    "client_id": client_id,
                    "cipher_suite": 1,
                    "key_package_data": "dGVzdF9rZXlfcGFja2FnZQ=="
                }]
            })
            .to_string(),
        ))
        .unwrap();
    let resp = app.clone().oneshot(kp_req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED);
}

async fn create_room(app: &axum::Router, token: &str) -> String {
    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms")
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({}).to_string()))
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED);
    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body_bytes).unwrap();
    json["id"].as_str().unwrap().to_string()
}

fn create_temp_session_types_file() -> NamedTempFile {
    let mut file = NamedTempFile::new().unwrap();
    writeln!(
        file,
        r#"
[[session_type]]
type = "voice"
extension_id = "core.hangouts"
max_participants = 10
max_per_room = 5
"#
    )
    .unwrap();
    file
}

async fn create_and_join_session(
    app: &axum::Router,
    room_id: &str,
    token: &str,
    client_id: &str,
) -> String {
    let create_req = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/sessions", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({"extension_id": "core.hangouts", "session_type": "voice"}).to_string(),
        ))
        .unwrap();
    let resp = app.clone().oneshot(create_req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED);
    let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let s_res: Value = serde_json::from_slice(&bytes).unwrap();
    let session_id = s_res["id"].as_str().unwrap().to_string();

    let join_req = Request::builder()
        .method("POST")
        .uri(format!(
            "/api/v1/rooms/{}/sessions/{}/join",
            room_id, session_id
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({"client_id": client_id}).to_string()))
        .unwrap();
    let join_resp = app.clone().oneshot(join_req).await.unwrap();
    assert_eq!(join_resp.status(), StatusCode::OK);

    session_id
}

async fn join_session(
    app: &axum::Router,
    room_id: &str,
    session_id: &str,
    token: &str,
    client_id: &str,
) {
    let join_req = Request::builder()
        .method("POST")
        .uri(format!(
            "/api/v1/rooms/{}/sessions/{}/join",
            room_id, session_id
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({"client_id": client_id}).to_string()))
        .unwrap();
    let join_resp = app.clone().oneshot(join_req).await.unwrap();
    assert_eq!(join_resp.status(), StatusCode::OK);
}

#[tokio::test]
async fn test_unicast_happy_path_and_target_not_found() {
    let types_file = create_temp_session_types_file();
    let (app, _pool) = setup_session_app(types_file.path().to_str().unwrap()).await;

    // Register User A and User B
    let _u1_id = register_user(&app, "sig_uni_u1", "Password123!", None).await;
    let (login_status, login_a) =
        login_user(&app, "sig_uni_u1", "Password123!", "c_alice_00000001", None).await;
    assert_eq!(login_status, StatusCode::OK);
    let token_a = login_a["session_token"].as_str().unwrap().to_string();

    let invite_req = Request::builder()
        .method("POST")
        .uri("/api/v1/admin/invites")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({}).to_string()))
        .unwrap();
    let resp = app.clone().oneshot(invite_req).await.unwrap();
    let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let invite_code = serde_json::from_slice::<Value>(&bytes).unwrap()["code"]
        .as_str()
        .unwrap()
        .to_string();

    let u2_id = register_user(&app, "sig_uni_u2", "Password123!", Some(&invite_code)).await;
    let (_, login_b) =
        login_user(&app, "sig_uni_u2", "Password123!", "c_bob_0000000001", None).await;
    let token_b = login_b["session_token"].as_str().unwrap().to_string();
    upload_key_package(&app, &token_b, "c_bob_0000000001").await;

    let room_id = create_room(&app, &token_a).await;

    // Add B to room
    let add_req = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/members", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({"user_id": u2_id}).to_string()))
        .unwrap();
    app.clone().oneshot(add_req).await.unwrap();

    let session_id = create_and_join_session(&app, &room_id, &token_a, "c_alice_00000001").await;

    // Unicast before B joins session -> 404 target_not_found
    let sig_req = Request::builder()
        .method("POST")
        .uri(format!(
            "/api/v1/rooms/{}/sessions/{}/signal",
            room_id, session_id
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "sender_client_id": "c_alice_00000001",
                "target_client_id": "c_bob_0000000001",
                "envelope": "dGVzdF9lbnZlbG9wZV9ieXRlcw"
            })
            .to_string(),
        ))
        .unwrap();
    let resp = app.clone().oneshot(sig_req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let err_json: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(err_json["error"], "target_not_found");

    // B joins session
    join_session(&app, &room_id, &session_id, &token_b, "c_bob_0000000001").await;

    // Unicast from A to B -> 200 OK, delivered_to: 1
    let sig_req2 = Request::builder()
        .method("POST")
        .uri(format!(
            "/api/v1/rooms/{}/sessions/{}/signal",
            room_id, session_id
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "sender_client_id": "c_alice_00000001",
                "target_client_id": "c_bob_0000000001",
                "envelope": "dGVzdF9lbnZlbG9wZV9ieXRlcw"
            })
            .to_string(),
        ))
        .unwrap();
    let resp2 = app.clone().oneshot(sig_req2).await.unwrap();
    assert_eq!(resp2.status(), StatusCode::OK);
    let bytes2 = axum::body::to_bytes(resp2.into_body(), usize::MAX)
        .await
        .unwrap();
    let res_json: Value = serde_json::from_slice(&bytes2).unwrap();
    assert_eq!(res_json["delivered_to"], 1);
}

#[tokio::test]
async fn test_unicast_self_delivery() {
    let types_file = create_temp_session_types_file();
    let (app, _pool) = setup_session_app(types_file.path().to_str().unwrap()).await;

    let _u1_id = register_user(&app, "sig_self_u1", "Password123!", None).await;
    let (_, login_a1) = login_user(
        &app,
        "sig_self_u1",
        "Password123!",
        "c_alice_self0101",
        None,
    )
    .await;
    let token_a1 = login_a1["session_token"].as_str().unwrap().to_string();

    let (_, login_a2) = login_user(
        &app,
        "sig_self_u1",
        "Password123!",
        "c_alice_self0102",
        None,
    )
    .await;
    let token_a2 = login_a2["session_token"].as_str().unwrap().to_string();

    let room_id = create_room(&app, &token_a1).await;
    let session_id = create_and_join_session(&app, &room_id, &token_a1, "c_alice_self0101").await;
    join_session(&app, &room_id, &session_id, &token_a2, "c_alice_self0102").await;

    // Self-delivery: A's device 1 signals A's device 2 -> 200 OK, delivered_to: 1
    let sig_req = Request::builder()
        .method("POST")
        .uri(format!(
            "/api/v1/rooms/{}/sessions/{}/signal",
            room_id, session_id
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a1))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "sender_client_id": "c_alice_self0101",
                "target_client_id": "c_alice_self0102",
                "envelope": "dGVzdF9zZWxmX2RlbGl2ZXJ5X2VudmVsb3Bl"
            })
            .to_string(),
        ))
        .unwrap();
    let resp = app.clone().oneshot(sig_req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let res_json: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(res_json["delivered_to"], 1);
}

#[tokio::test]
async fn test_broadcast_happy_path_and_alone() {
    let types_file = create_temp_session_types_file();
    let (app, _pool) = setup_session_app(types_file.path().to_str().unwrap()).await;

    let _u1_id = register_user(&app, "sig_bc_u1", "Password123!", None).await;
    let (_, login_a) =
        login_user(&app, "sig_bc_u1", "Password123!", "c_alice_bc000001", None).await;
    let token_a = login_a["session_token"].as_str().unwrap().to_string();

    let invite_req = Request::builder()
        .method("POST")
        .uri("/api/v1/admin/invites")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({}).to_string()))
        .unwrap();
    let resp = app.clone().oneshot(invite_req).await.unwrap();
    let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let invite_code = serde_json::from_slice::<Value>(&bytes).unwrap()["code"]
        .as_str()
        .unwrap()
        .to_string();

    let u2_id = register_user(&app, "sig_bc_u2", "Password123!", Some(&invite_code)).await;
    let (_, login_b) =
        login_user(&app, "sig_bc_u2", "Password123!", "c_bob_bc00000001", None).await;
    let token_b = login_b["session_token"].as_str().unwrap().to_string();
    upload_key_package(&app, &token_b, "c_bob_bc00000001").await;

    let room_id = create_room(&app, &token_a).await;

    // Add B to room
    let add_req = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/members", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({"user_id": u2_id}).to_string()))
        .unwrap();
    app.clone().oneshot(add_req).await.unwrap();

    let session_id = create_and_join_session(&app, &room_id, &token_a, "c_alice_bc000001").await;

    // Broadcast when alone -> 202 Accepted, delivered_to: 0
    let bc_req1 = Request::builder()
        .method("POST")
        .uri(format!(
            "/api/v1/rooms/{}/sessions/{}/signal",
            room_id, session_id
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "sender_client_id": "c_alice_bc000001",
                "envelope": "dGVzdF9icm9hZGNhc3RfZW52ZWxvcGU"
            })
            .to_string(),
        ))
        .unwrap();
    let resp1 = app.clone().oneshot(bc_req1).await.unwrap();
    assert_eq!(resp1.status(), StatusCode::ACCEPTED);
    let bytes1 = axum::body::to_bytes(resp1.into_body(), usize::MAX)
        .await
        .unwrap();
    let res1: Value = serde_json::from_slice(&bytes1).unwrap();
    assert_eq!(res1["delivered_to"], 0);

    // B joins session
    join_session(&app, &room_id, &session_id, &token_b, "c_bob_bc00000001").await;

    // Broadcast with B in session -> 202 Accepted, delivered_to: 1
    let bc_req2 = Request::builder()
        .method("POST")
        .uri(format!(
            "/api/v1/rooms/{}/sessions/{}/signal",
            room_id, session_id
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "sender_client_id": "c_alice_bc000001",
                "envelope": "dGVzdF9icm9hZGNhc3RfZW52ZWxvcGU"
            })
            .to_string(),
        ))
        .unwrap();
    let resp2 = app.clone().oneshot(bc_req2).await.unwrap();
    assert_eq!(resp2.status(), StatusCode::ACCEPTED);
    let bytes2 = axum::body::to_bytes(resp2.into_body(), usize::MAX)
        .await
        .unwrap();
    let res2: Value = serde_json::from_slice(&bytes2).unwrap();
    assert_eq!(res2["delivered_to"], 1);
}

#[tokio::test]
async fn test_validation_and_authorization() {
    let types_file = create_temp_session_types_file();
    let (app, _pool) = setup_session_app(types_file.path().to_str().unwrap()).await;

    let _u1_id = register_user(&app, "sig_val_u1", "Password123!", None).await;
    let (_, login_a) =
        login_user(&app, "sig_val_u1", "Password123!", "c_alice_val00001", None).await;
    let token_a = login_a["session_token"].as_str().unwrap().to_string();

    let room_id = create_room(&app, &token_a).await;
    let session_id = create_and_join_session(&app, &room_id, &token_a, "c_alice_val00001").await;

    // 1. Invalid sender_client_id (unowned device) -> 400 invalid_client_id
    let req1 = Request::builder()
        .method("POST")
        .uri(format!(
            "/api/v1/rooms/{}/sessions/{}/signal",
            room_id, session_id
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "sender_client_id": "c_unowned_device",
                "envelope": "dGVzdF9lbnZlbG9wZQ"
            })
            .to_string(),
        ))
        .unwrap();
    let resp1 = app.clone().oneshot(req1).await.unwrap();
    assert_eq!(resp1.status(), StatusCode::BAD_REQUEST);

    // 2. Invalid base64 envelope -> 400 invalid_envelope
    let req2 = Request::builder()
        .method("POST")
        .uri(format!(
            "/api/v1/rooms/{}/sessions/{}/signal",
            room_id, session_id
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "sender_client_id": "c_alice_val00001",
                "envelope": "!!!invalid_base64!!!"
            })
            .to_string(),
        ))
        .unwrap();
    let resp2 = app.clone().oneshot(req2).await.unwrap();
    assert_eq!(resp2.status(), StatusCode::BAD_REQUEST);
    let bytes2 = axum::body::to_bytes(resp2.into_body(), usize::MAX)
        .await
        .unwrap();
    let err_json2: Value = serde_json::from_slice(&bytes2).unwrap();
    assert_eq!(err_json2["error"], "invalid_envelope");

    // 3. Oversized envelope > 64 KiB -> 400 invalid_envelope
    let oversized = "A".repeat(100_000);
    let req3 = Request::builder()
        .method("POST")
        .uri(format!(
            "/api/v1/rooms/{}/sessions/{}/signal",
            room_id, session_id
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "sender_client_id": "c_alice_val00001",
                "envelope": oversized
            })
            .to_string(),
        ))
        .unwrap();
    let resp3 = app.clone().oneshot(req3).await.unwrap();
    assert_eq!(resp3.status(), StatusCode::BAD_REQUEST);
    let bytes3 = axum::body::to_bytes(resp3.into_body(), usize::MAX)
        .await
        .unwrap();
    let err_json3: Value = serde_json::from_slice(&bytes3).unwrap();
    assert_eq!(err_json3["error"], "invalid_envelope");
}

#[tokio::test]
async fn test_disabled_mode_and_opacity_invariants() {
    let types_file = create_temp_session_types_file();
    let (app, pool, _) = setup_test_app_with_custom_config(|cfg| {
        cfg.sessions_enabled = false;
        cfg.session_types_config_path = types_file.path().to_str().unwrap().to_string();
    })
    .await;

    let _u1_id = register_user(&app, "sig_dis_u1", "Password123!", None).await;
    let (_, login_a) =
        login_user(&app, "sig_dis_u1", "Password123!", "c_alice_dis00001", None).await;
    let token = login_a["session_token"].as_str().unwrap().to_string();

    let room_id = create_room(&app, &token).await;

    // Disabled mode -> 501 sessions_disabled
    let req = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/sessions/s_dummy/signal", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "sender_client_id": "c_alice_dis00001",
                "envelope": "dGVzdF9lbnZlbG9wZQ"
            })
            .to_string(),
        ))
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_IMPLEMENTED);

    // Opacity invariant check: audit_log contains no signaling entries
    let count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM audit_log WHERE action LIKE '%signal%'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(count, 0, "Signals must NEVER be written to audit logs");
}

#[tokio::test]
async fn test_envelope_opacity_accepts_raw_bytes() {
    let types_file = create_temp_session_types_file();
    let (app, _pool) = setup_session_app(types_file.path().to_str().unwrap()).await;

    let _u1_id = register_user(&app, "sig_opa_u1", "Password123!", None).await;
    let (_, login_a) =
        login_user(&app, "sig_opa_u1", "Password123!", "c_alice_opa00001", None).await;
    let token_a = login_a["session_token"].as_str().unwrap().to_string();

    let room_id = create_room(&app, &token_a).await;
    let session_id = create_and_join_session(&app, &room_id, &token_a, "c_alice_opa00001").await;

    // Send arbitrary non-JSON, non-plaintext binary bytes as envelope
    let arbitrary_bytes = vec![0x00, 0xff, 0xfe, 0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xde];
    let arbitrary_envelope =
        base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(&arbitrary_bytes);

    let sig_req = Request::builder()
        .method("POST")
        .uri(format!(
            "/api/v1/rooms/{}/sessions/{}/signal",
            room_id, session_id
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "sender_client_id": "c_alice_opa00001",
                "envelope": arbitrary_envelope
            })
            .to_string(),
        ))
        .unwrap();
    let resp = app.clone().oneshot(sig_req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::ACCEPTED);
    let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let res_json: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(res_json["delivered_to"], 0);
}
