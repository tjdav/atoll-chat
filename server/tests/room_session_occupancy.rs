use axum::body::Body;
use axum::http::{header, Request, StatusCode};
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

[[session_type]]
type = "screen_share"
extension_id = "core.hangouts"
max_participants = 2
max_per_room = 5
"#
    )
    .unwrap();
    file
}

#[tokio::test]
async fn test_join_happy_path_and_roster() {
    let types_file = create_temp_session_types_file();
    let (app, _pool) = setup_session_app(types_file.path().to_str().unwrap()).await;

    let _u1_id = register_user(&app, "join_u1", "Password123!", None).await;
    let (status, login_a) =
        login_user(&app, "join_u1", "Password123!", "client_alice_1001", None).await;
    assert_eq!(status, StatusCode::OK);
    let token_a = login_a["session_token"].as_str().unwrap().to_string();

    let room_id = create_room(&app, &token_a).await;

    // Create session
    let create_req = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/sessions", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
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

    // User A joins session
    let join_req = Request::builder()
        .method("POST")
        .uri(format!(
            "/api/v1/rooms/{}/sessions/{}/join",
            room_id, session_id
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({"client_id": "client_alice_1001"}).to_string(),
        ))
        .unwrap();
    let resp = app.clone().oneshot(join_req).await.unwrap();
    let join_status = resp.status();
    let join_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    println!(
        "join status: {:?}, body: {:?}",
        join_status,
        String::from_utf8_lossy(&join_bytes)
    );
    assert_eq!(join_status, StatusCode::OK);

    let join_res: Value = serde_json::from_slice(&join_bytes).unwrap();
    let roster = join_res["roster"].as_array().unwrap();
    assert_eq!(roster.len(), 1);
    assert_eq!(
        roster[0]["client_ids"].as_array().unwrap()[0],
        "client_alice_1001"
    );
    assert!(join_res["media_config"]["ice_servers"].is_array());

    // Fetch roster endpoint
    let roster_req = Request::builder()
        .method("GET")
        .uri(format!(
            "/api/v1/rooms/{}/sessions/{}/roster",
            room_id, session_id
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();
    let resp = app.clone().oneshot(roster_req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let roster_res: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(roster_res["roster"].as_array().unwrap().len(), 1);

    // List sessions shows participant_count: 1
    let list_req = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/rooms/{}/sessions", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();
    let resp = app.clone().oneshot(list_req).await.unwrap();
    let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let list_res: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(list_res["sessions"][0]["participant_count"], 1);
}

#[tokio::test]
async fn test_multi_device_and_multi_user_join() {
    let types_file = create_temp_session_types_file();
    let (app, _pool) = setup_session_app(types_file.path().to_str().unwrap()).await;

    let u1_id = register_user(&app, "multi_u1", "Password123!", None).await;
    let (_, login_a1) =
        login_user(&app, "multi_u1", "Password123!", "client_alice_1001", None).await;
    let token_a = login_a1["session_token"].as_str().unwrap().to_string();

    let (_, login_a2) =
        login_user(&app, "multi_u1", "Password123!", "client_alice_1002", None).await;
    let token_a2 = login_a2["session_token"].as_str().unwrap().to_string();

    // User B
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
    let invite_res: Value = serde_json::from_slice(&bytes).unwrap();
    let invite_code = invite_res["code"].as_str().unwrap();

    let u2_id = register_user(&app, "multi_u2", "Password123!", Some(invite_code)).await;
    let (_, login_b) =
        login_user(&app, "multi_u2", "Password123!", "client_bob_000100", None).await;
    let token_b = login_b["session_token"].as_str().unwrap().to_string();

    upload_key_package(&app, &token_b, "client_bob_000100").await;

    let room_id = create_room(&app, &token_a).await;

    // Add User B to room
    let add_req = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/members", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({"user_id": u2_id}).to_string()))
        .unwrap();
    app.clone().oneshot(add_req).await.unwrap();

    // Create session
    let create_req = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/sessions", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({"extension_id": "core.hangouts", "session_type": "voice"}).to_string(),
        ))
        .unwrap();
    let resp = app.clone().oneshot(create_req).await.unwrap();
    let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let s_res: Value = serde_json::from_slice(&bytes).unwrap();
    let session_id = s_res["id"].as_str().unwrap().to_string();

    // User A joins device 1
    let join_a1 = Request::builder()
        .method("POST")
        .uri(format!(
            "/api/v1/rooms/{}/sessions/{}/join",
            room_id, session_id
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({"client_id": "client_alice_1001"}).to_string(),
        ))
        .unwrap();
    app.clone().oneshot(join_a1).await.unwrap();

    // User A joins device 2
    let join_a2 = Request::builder()
        .method("POST")
        .uri(format!(
            "/api/v1/rooms/{}/sessions/{}/join",
            room_id, session_id
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a2))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({"client_id": "client_alice_1002"}).to_string(),
        ))
        .unwrap();
    let resp = app.clone().oneshot(join_a2).await.unwrap();
    let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let res: Value = serde_json::from_slice(&bytes).unwrap();
    let roster = res["roster"].as_array().unwrap();
    assert_eq!(roster.len(), 1); // 1 distinct user
    let cids = roster[0]["client_ids"].as_array().unwrap();
    assert_eq!(cids.len(), 2);

    // User B joins
    let join_b = Request::builder()
        .method("POST")
        .uri(format!(
            "/api/v1/rooms/{}/sessions/{}/join",
            room_id, session_id
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_b))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({"client_id": "client_bob_000100"}).to_string(),
        ))
        .unwrap();
    let resp = app.clone().oneshot(join_b).await.unwrap();
    let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let res: Value = serde_json::from_slice(&bytes).unwrap();
    let roster = res["roster"].as_array().unwrap();
    assert_eq!(roster.len(), 2); // 2 distinct users

    // Roster is sorted by user_id ASC
    let expected_u0 = if u1_id < u2_id { &u1_id } else { &u2_id };
    assert_eq!(&roster[0]["user_id"], expected_u0);
}

#[tokio::test]
async fn test_participant_cap_enforcement() {
    let types_file = create_temp_session_types_file();
    let (app, _pool) = setup_session_app(types_file.path().to_str().unwrap()).await;

    // User A
    let _u1_id = register_user(&app, "cap_u1", "Password123!", None).await;
    let (_, login_a) = login_user(&app, "cap_u1", "Password123!", "client_user_a0001", None).await;
    let token_a = login_a["session_token"].as_str().unwrap().to_string();

    let room_id = create_room(&app, &token_a).await;

    // Create User B and User C
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

    let u2_id = register_user(&app, "cap_u2", "Password123!", Some(&invite_code)).await;
    let (_, login_b) = login_user(&app, "cap_u2", "Password123!", "client_user_b0001", None).await;
    let token_b = login_b["session_token"].as_str().unwrap().to_string();
    upload_key_package(&app, &token_b, "client_user_b0001").await;

    let invite_req2 = Request::builder()
        .method("POST")
        .uri("/api/v1/admin/invites")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({}).to_string()))
        .unwrap();
    let resp2 = app.clone().oneshot(invite_req2).await.unwrap();
    let bytes2 = axum::body::to_bytes(resp2.into_body(), usize::MAX)
        .await
        .unwrap();
    let invite_code2 = serde_json::from_slice::<Value>(&bytes2).unwrap()["code"]
        .as_str()
        .unwrap()
        .to_string();

    let u3_id = register_user(&app, "cap_u3", "Password123!", Some(&invite_code2)).await;
    let (_, login_c) = login_user(&app, "cap_u3", "Password123!", "client_user_c0001", None).await;
    let token_c = login_c["session_token"].as_str().unwrap().to_string();
    upload_key_package(&app, &token_c, "client_user_c0001").await;

    // Add B and C to room
    for (name, uid) in [("B", &u2_id), ("C", &u3_id)] {
        let add_req = Request::builder()
            .method("POST")
            .uri(format!("/api/v1/rooms/{}/members", room_id))
            .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(json!({"user_id": uid}).to_string()))
            .unwrap();
        let add_resp = app.clone().oneshot(add_req).await.unwrap();
        let status = add_resp.status();
        let bytes = axum::body::to_bytes(add_resp.into_body(), usize::MAX)
            .await
            .unwrap();
        println!(
            "add_member for {}: status {:?}, body: {:?}",
            name,
            status,
            String::from_utf8_lossy(&bytes)
        );
        assert_eq!(status, StatusCode::CREATED);
    }

    // Create screen_share session (max_participants = 2)
    let create_req = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/sessions", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({"extension_id": "core.hangouts", "session_type": "screen_share"}).to_string(),
        ))
        .unwrap();
    let resp = app.clone().oneshot(create_req).await.unwrap();
    let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let session_id = serde_json::from_slice::<Value>(&bytes).unwrap()["id"]
        .as_str()
        .unwrap()
        .to_string();

    // A joins (1/2)
    let j_a = Request::builder()
        .method("POST")
        .uri(format!(
            "/api/v1/rooms/{}/sessions/{}/join",
            room_id, session_id
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({"client_id": "client_user_a0001"}).to_string(),
        ))
        .unwrap();
    assert_eq!(
        app.clone().oneshot(j_a).await.unwrap().status(),
        StatusCode::OK
    );

    // B joins (2/2)
    let j_b = Request::builder()
        .method("POST")
        .uri(format!(
            "/api/v1/rooms/{}/sessions/{}/join",
            room_id, session_id
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_b))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({"client_id": "client_user_b0001"}).to_string(),
        ))
        .unwrap();
    assert_eq!(
        app.clone().oneshot(j_b).await.unwrap().status(),
        StatusCode::OK
    );

    // C tries to join -> 409 Conflict (session_full)
    let j_c = Request::builder()
        .method("POST")
        .uri(format!(
            "/api/v1/rooms/{}/sessions/{}/join",
            room_id, session_id
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_c))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({"client_id": "client_user_c0001"}).to_string(),
        ))
        .unwrap();
    assert_eq!(
        app.clone().oneshot(j_c).await.unwrap().status(),
        StatusCode::CONFLICT
    );
}

#[tokio::test]
async fn test_leave_and_heartbeat() {
    let types_file = create_temp_session_types_file();
    let (app, _pool) = setup_session_app(types_file.path().to_str().unwrap()).await;

    let _u1_id = register_user(&app, "lh_u1", "Password123!", None).await;
    let (_, login_a) = login_user(&app, "lh_u1", "Password123!", "client_user_lh101", None).await;
    let token_a = login_a["session_token"].as_str().unwrap().to_string();

    let room_id = create_room(&app, &token_a).await;

    // Create session
    let create_req = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/sessions", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({"extension_id": "core.hangouts", "session_type": "voice"}).to_string(),
        ))
        .unwrap();
    let resp = app.clone().oneshot(create_req).await.unwrap();
    let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let session_id = serde_json::from_slice::<Value>(&bytes).unwrap()["id"]
        .as_str()
        .unwrap()
        .to_string();

    // Heartbeat before joining -> 403 Forbidden (not_a_participant)
    let hb_req = Request::builder()
        .method("POST")
        .uri(format!(
            "/api/v1/rooms/{}/sessions/{}/heartbeat",
            room_id, session_id
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({"client_id": "client_user_lh101"}).to_string(),
        ))
        .unwrap();
    assert_eq!(
        app.clone().oneshot(hb_req).await.unwrap().status(),
        StatusCode::FORBIDDEN
    );

    // Join
    let join_req = Request::builder()
        .method("POST")
        .uri(format!(
            "/api/v1/rooms/{}/sessions/{}/join",
            room_id, session_id
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({"client_id": "client_user_lh101"}).to_string(),
        ))
        .unwrap();
    assert_eq!(
        app.clone().oneshot(join_req).await.unwrap().status(),
        StatusCode::OK
    );

    // Heartbeat after joining -> 204 No Content
    let hb_req2 = Request::builder()
        .method("POST")
        .uri(format!(
            "/api/v1/rooms/{}/sessions/{}/heartbeat",
            room_id, session_id
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({"client_id": "client_user_lh101"}).to_string(),
        ))
        .unwrap();
    assert_eq!(
        app.clone().oneshot(hb_req2).await.unwrap().status(),
        StatusCode::NO_CONTENT
    );

    // Leave
    let leave_req = Request::builder()
        .method("POST")
        .uri(format!(
            "/api/v1/rooms/{}/sessions/{}/leave",
            room_id, session_id
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({"client_id": "client_user_lh101"}).to_string(),
        ))
        .unwrap();
    assert_eq!(
        app.clone().oneshot(leave_req).await.unwrap().status(),
        StatusCode::NO_CONTENT
    );

    // Roster endpoint after leave -> 403 Forbidden (not_a_participant)
    let roster_req = Request::builder()
        .method("GET")
        .uri(format!(
            "/api/v1/rooms/{}/sessions/{}/roster",
            room_id, session_id
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();
    assert_eq!(
        app.clone().oneshot(roster_req).await.unwrap().status(),
        StatusCode::FORBIDDEN
    );
}

#[tokio::test]
async fn test_disabled_mode() {
    let types_file = create_temp_session_types_file();
    let (app, _pool, _) = setup_test_app_with_custom_config(|cfg| {
        cfg.sessions_enabled = false;
        cfg.session_types_config_path = types_file.path().to_str().unwrap().to_string();
    })
    .await;

    let _u1_id = register_user(&app, "dis_u1", "Password123!", None).await;
    let (_, login_res) =
        login_user(&app, "dis_u1", "Password123!", "client_user_dis01", None).await;
    let token = login_res["session_token"].as_str().unwrap().to_string();

    let room_id = create_room(&app, &token).await;

    // Join returns 501
    let join_req = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/sessions/s_dummy/join", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({"client_id": "client_user_dis01"}).to_string(),
        ))
        .unwrap();
    assert_eq!(
        app.clone().oneshot(join_req).await.unwrap().status(),
        StatusCode::NOT_IMPLEMENTED
    );

    // Leave returns 501
    let leave_req = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/sessions/s_dummy/leave", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({"client_id": "client_user_dis01"}).to_string(),
        ))
        .unwrap();
    assert_eq!(
        app.clone().oneshot(leave_req).await.unwrap().status(),
        StatusCode::NOT_IMPLEMENTED
    );

    // Heartbeat returns 501
    let hb_req = Request::builder()
        .method("POST")
        .uri(format!(
            "/api/v1/rooms/{}/sessions/s_dummy/heartbeat",
            room_id
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({"client_id": "client_user_dis01"}).to_string(),
        ))
        .unwrap();
    assert_eq!(
        app.clone().oneshot(hb_req).await.unwrap().status(),
        StatusCode::NOT_IMPLEMENTED
    );

    // Roster returns 403 (not_a_participant) per §8.7.13
    let roster_req = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/rooms/{}/sessions/s_dummy/roster", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .body(Body::empty())
        .unwrap();
    assert_eq!(
        app.clone().oneshot(roster_req).await.unwrap().status(),
        StatusCode::FORBIDDEN
    );
}

#[tokio::test]
async fn test_privacy_invariants() {
    let types_file = create_temp_session_types_file();
    let (app, pool) = setup_session_app(types_file.path().to_str().unwrap()).await;

    let _u1_id = register_user(&app, "priv_u1", "Password123!", None).await;
    let (_, login_a) = login_user(&app, "priv_u1", "Password123!", "client_user_prv01", None).await;
    let token_a = login_a["session_token"].as_str().unwrap().to_string();

    let room_id = create_room(&app, &token_a).await;

    // Create session
    let create_req = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/sessions", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({"extension_id": "core.hangouts", "session_type": "voice"}).to_string(),
        ))
        .unwrap();
    let resp = app.clone().oneshot(create_req).await.unwrap();
    let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let session_id = serde_json::from_slice::<Value>(&bytes).unwrap()["id"]
        .as_str()
        .unwrap()
        .to_string();

    // Join
    let join_req = Request::builder()
        .method("POST")
        .uri(format!(
            "/api/v1/rooms/{}/sessions/{}/join",
            room_id, session_id
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({"client_id": "client_user_prv01"}).to_string(),
        ))
        .unwrap();
    app.clone().oneshot(join_req).await.unwrap();

    // Leave
    let leave_req = Request::builder()
        .method("POST")
        .uri(format!(
            "/api/v1/rooms/{}/sessions/{}/leave",
            room_id, session_id
        ))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({"client_id": "client_user_prv01"}).to_string(),
        ))
        .unwrap();
    app.clone().oneshot(leave_req).await.unwrap();

    // Verify audit logs contain NO join, leave, or heartbeat actions
    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM audit_log WHERE action LIKE '%join%' OR action LIKE '%leave%' OR action LIKE '%heartbeat%' OR action LIKE '%occupancy%'"
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        count, 0,
        "Occupancy actions must NEVER be written to audit logs"
    );
}
