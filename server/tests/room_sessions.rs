mod common;

use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use common::{login_user, register_user, setup_test_app_with_custom_config};
use serde_json::{json, Value};
use server::audit::{action, AuditFilter};
use sqlx::SqlitePool;
use std::io::Write;
use tempfile::NamedTempFile;
use tower::ServiceExt;

fn create_temp_session_types_file() -> NamedTempFile {
    let mut file = NamedTempFile::new().unwrap();
    let content = r#"
    [[session_type]]
    type = "voice"
    extension_id = "core.hangouts"
    max_participants = 12
    max_per_room = 3

    [[session_type]]
    type = "watch"
    extension_id = "core.watch"
    max_participants = 10
    max_per_room = 2
    "#;
    file.write_all(content.as_bytes()).unwrap();
    file
}

async fn setup_session_app(types_file_path: &str) -> (axum::Router, SqlitePool) {
    let (app, pool, _) = setup_test_app_with_custom_config(|cfg| {
        cfg.sessions_enabled = true;
        cfg.session_types_config_path = types_file_path.to_string();
    })
    .await;
    (app, pool)
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

#[tokio::test]
async fn test_room_sessions_crud_happy_path() {
    let types_file = create_temp_session_types_file();
    let (app, pool) = setup_session_app(types_file.path().to_str().unwrap()).await;

    let _u1_id = register_user(&app, "sess_user1", "Password123!", None).await;
    let (status, login_res) = login_user(
        &app,
        "sess_user1",
        "Password123!",
        "client_sess_1_12345",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let token = login_res["session_token"].as_str().unwrap().to_string();

    let room_id = create_room(&app, &token).await;

    // 1. Create Session
    let create_req = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/sessions", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "extension_id": "core.hangouts",
                "session_type": "voice",
                "metadata": null,
                "max_participants": 8
            })
            .to_string(),
        ))
        .unwrap();

    let resp = app.clone().oneshot(create_req).await.unwrap();
    let status = resp.status();
    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    if status != StatusCode::CREATED {
        panic!(
            "create session failed: status={}, body={}",
            status,
            String::from_utf8_lossy(&body_bytes)
        );
    }
    let create_res: Value = serde_json::from_slice(&body_bytes).unwrap();

    let session_id = create_res["id"].as_str().unwrap().to_string();
    assert_eq!(create_res["extension_id"], "core.hangouts");
    assert_eq!(create_res["session_type"], "voice");
    assert_eq!(create_res["metadata_version"], 1);
    assert_eq!(create_res["position"], 0);
    assert_eq!(create_res["participant_count"], 0);

    // Verify audit log for create
    let entries = server::audit::list(
        &pool,
        AuditFilter {
            action: Some(action::SESSION_CREATE.to_string()),
            ..Default::default()
        },
        1,
        10,
    )
    .await
    .unwrap();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].target_id, Some(session_id.clone()));

    // 2. List Sessions
    let list_req = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/rooms/{}/sessions", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .body(Body::empty())
        .unwrap();

    let resp = app.clone().oneshot(list_req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let list_res: Value = serde_json::from_slice(&body_bytes).unwrap();
    let sessions = list_res["sessions"].as_array().unwrap();
    assert_eq!(sessions.len(), 1);
    assert_eq!(sessions[0]["id"], session_id);
    assert_eq!(sessions[0]["participant_count"], 0);

    // 3. Patch Session (Metadata change)
    let patch_req = Request::builder()
        .method("PATCH")
        .uri(format!("/api/v1/rooms/{}/sessions/{}", room_id, session_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "metadata": "eyJ0ZXN0IjoxfQ=="
            })
            .to_string(),
        ))
        .unwrap();

    let resp = app.clone().oneshot(patch_req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let patch_res: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(patch_res["metadata"], "eyJ0ZXN0IjoxfQ==");
    assert_eq!(patch_res["metadata_version"], 2);

    // 4. Patch Session No-op
    let noop_req = Request::builder()
        .method("PATCH")
        .uri(format!("/api/v1/rooms/{}/sessions/{}", room_id, session_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "metadata": "eyJ0ZXN0IjoxfQ==",
                "position": 0
            })
            .to_string(),
        ))
        .unwrap();

    let resp = app.clone().oneshot(noop_req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    // 5. Delete Session
    let del_req = Request::builder()
        .method("DELETE")
        .uri(format!("/api/v1/rooms/{}/sessions/{}", room_id, session_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .body(Body::empty())
        .unwrap();

    let resp = app.clone().oneshot(del_req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::NO_CONTENT);

    // Verify audit log for delete
    let entries = server::audit::list(
        &pool,
        AuditFilter {
            action: Some(action::SESSION_DELETE.to_string()),
            ..Default::default()
        },
        1,
        10,
    )
    .await
    .unwrap();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].target_id, Some(session_id.clone()));

    // Verify room has 0 sessions
    let list_req2 = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/rooms/{}/sessions", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .body(Body::empty())
        .unwrap();

    let resp = app.clone().oneshot(list_req2).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let list_res2: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(list_res2["sessions"].as_array().unwrap().len(), 0);
}

#[tokio::test]
async fn test_room_sessions_validation_and_caps() {
    let types_file = create_temp_session_types_file();
    let (app, _pool) = setup_session_app(types_file.path().to_str().unwrap()).await;

    let _u1_id = register_user(&app, "val_user1", "Password123!", None).await;
    let (status, login_res) = login_user(
        &app,
        "val_user1",
        "Password123!",
        "client_val_1_12345",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let token = login_res["session_token"].as_str().unwrap().to_string();

    let room_id = create_room(&app, &token).await;

    // Unknown session type
    let req = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/sessions", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "extension_id": "core.hangouts",
                "session_type": "nonexistent"
            })
            .to_string(),
        ))
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);

    // Invalid session type regex
    let req = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/sessions", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "extension_id": "core.hangouts",
                "session_type": "Voice"
            })
            .to_string(),
        ))
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);

    // max_participants > type max_participants (12)
    let req = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/sessions", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "extension_id": "core.hangouts",
                "session_type": "voice",
                "max_participants": 999
            })
            .to_string(),
        ))
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);

    // Invalid base64 metadata
    let req = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/sessions", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "extension_id": "core.hangouts",
                "session_type": "voice",
                "metadata": "!!!not_base64!!!"
            })
            .to_string(),
        ))
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);

    // Create max_per_room (3 for voice)
    for _ in 0..3 {
        let req = Request::builder()
            .method("POST")
            .uri(format!("/api/v1/rooms/{}/sessions", room_id))
            .header(header::AUTHORIZATION, format!("Bearer {}", token))
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(
                json!({
                    "extension_id": "core.hangouts",
                    "session_type": "voice"
                })
                .to_string(),
            ))
            .unwrap();
        let resp = app.clone().oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::CREATED);
    }

    // 4th voice session fails with 409
    let req = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/sessions", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "extension_id": "core.hangouts",
                "session_type": "voice"
            })
            .to_string(),
        ))
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::CONFLICT);
}

#[tokio::test]
async fn test_room_sessions_position_resequencing() {
    let types_file = create_temp_session_types_file();
    let (app, _pool) = setup_session_app(types_file.path().to_str().unwrap()).await;

    let _u1_id = register_user(&app, "pos_user1", "Password123!", None).await;
    let (status, login_res) = login_user(
        &app,
        "pos_user1",
        "Password123!",
        "client_pos_1_12345",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let token = login_res["session_token"].as_str().unwrap().to_string();

    let room_id = create_room(&app, &token).await;

    // Create S0 (voice), S1 (voice), S2 (watch)
    let s0_id = {
        let req = Request::builder()
            .method("POST")
            .uri(format!("/api/v1/rooms/{}/sessions", room_id))
            .header(header::AUTHORIZATION, format!("Bearer {}", token))
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(
                json!({"extension_id": "core.hangouts", "session_type": "voice"}).to_string(),
            ))
            .unwrap();
        let resp = app.clone().oneshot(req).await.unwrap();
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let res: Value = serde_json::from_slice(&bytes).unwrap();
        res["id"].as_str().unwrap().to_string()
    };

    let s1_id = {
        let req = Request::builder()
            .method("POST")
            .uri(format!("/api/v1/rooms/{}/sessions", room_id))
            .header(header::AUTHORIZATION, format!("Bearer {}", token))
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(
                json!({"extension_id": "core.hangouts", "session_type": "voice"}).to_string(),
            ))
            .unwrap();
        let resp = app.clone().oneshot(req).await.unwrap();
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let res: Value = serde_json::from_slice(&bytes).unwrap();
        res["id"].as_str().unwrap().to_string()
    };

    let s2_id = {
        let req = Request::builder()
            .method("POST")
            .uri(format!("/api/v1/rooms/{}/sessions", room_id))
            .header(header::AUTHORIZATION, format!("Bearer {}", token))
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(
                json!({"extension_id": "core.watch", "session_type": "watch"}).to_string(),
            ))
            .unwrap();
        let resp = app.clone().oneshot(req).await.unwrap();
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let res: Value = serde_json::from_slice(&bytes).unwrap();
        res["id"].as_str().unwrap().to_string()
    };

    // Verify initial positions [0, 1, 2]
    let list_req = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/rooms/{}/sessions", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .body(Body::empty())
        .unwrap();
    let resp = app.clone().oneshot(list_req).await.unwrap();
    let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let list_res: Value = serde_json::from_slice(&bytes).unwrap();
    let sessions = list_res["sessions"].as_array().unwrap();
    assert_eq!(sessions[0]["id"], s0_id);
    assert_eq!(sessions[0]["position"], 0);
    assert_eq!(sessions[1]["id"], s1_id);
    assert_eq!(sessions[1]["position"], 1);
    assert_eq!(sessions[2]["id"], s2_id);
    assert_eq!(sessions[2]["position"], 2);

    // Create S3 (watch) inserted at explicit position 1
    let s3_id = {
        let req = Request::builder()
            .method("POST")
            .uri(format!("/api/v1/rooms/{}/sessions", room_id))
            .header(header::AUTHORIZATION, format!("Bearer {}", token))
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(
                json!({
                    "extension_id": "core.watch",
                    "session_type": "watch",
                    "position": 1
                })
                .to_string(),
            ))
            .unwrap();
        let resp = app.clone().oneshot(req).await.unwrap();
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let res: Value = serde_json::from_slice(&bytes).unwrap();
        res["id"].as_str().unwrap().to_string()
    };

    // Positions should now be [s0_id: 0, s3_id: 1, s1_id: 2, s2_id: 3]
    let list_req = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/rooms/{}/sessions", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .body(Body::empty())
        .unwrap();
    let resp = app.clone().oneshot(list_req).await.unwrap();
    let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let list_res: Value = serde_json::from_slice(&bytes).unwrap();
    let sessions = list_res["sessions"].as_array().unwrap();
    assert_eq!(sessions[0]["id"], s0_id);
    assert_eq!(sessions[0]["position"], 0);
    assert_eq!(sessions[1]["id"], s3_id);
    assert_eq!(sessions[1]["position"], 1);
    assert_eq!(sessions[2]["id"], s1_id);
    assert_eq!(sessions[2]["position"], 2);
    assert_eq!(sessions[3]["id"], s2_id);
    assert_eq!(sessions[3]["position"], 3);

    // Delete session S3 at position 1
    let del_req = Request::builder()
        .method("DELETE")
        .uri(format!("/api/v1/rooms/{}/sessions/{}", room_id, s3_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .body(Body::empty())
        .unwrap();
    let resp = app.clone().oneshot(del_req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::NO_CONTENT);

    // Remaining positions should be dense [s0_id: 0, s1_id: 1, s2_id: 2]
    let list_req = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/rooms/{}/sessions", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .body(Body::empty())
        .unwrap();
    let resp = app.clone().oneshot(list_req).await.unwrap();
    let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let list_res: Value = serde_json::from_slice(&bytes).unwrap();
    let sessions = list_res["sessions"].as_array().unwrap();
    assert_eq!(sessions.len(), 3);
    assert_eq!(sessions[0]["id"], s0_id);
    assert_eq!(sessions[0]["position"], 0);
    assert_eq!(sessions[1]["id"], s1_id);
    assert_eq!(sessions[1]["position"], 1);
    assert_eq!(sessions[2]["id"], s2_id);
    assert_eq!(sessions[2]["position"], 2);
}

#[tokio::test]
async fn test_room_sessions_permissions() {
    let types_file = create_temp_session_types_file();
    let (app, _pool) = setup_session_app(types_file.path().to_str().unwrap()).await;

    // User A (Owner)
    let _u1_id = register_user(&app, "perm_user1", "Password123!", None).await;
    let (_, login_a) = login_user(
        &app,
        "perm_user1",
        "Password123!",
        "client_perm_1_12345",
        None,
    )
    .await;
    let token_a = login_a["session_token"].as_str().unwrap().to_string();

    // Create invite code for User B
    let invite_req = Request::builder()
        .method("POST")
        .uri("/api/v1/admin/invites")
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({}).to_string()))
        .unwrap();
    let resp = app.clone().oneshot(invite_req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let invite_res: Value = serde_json::from_slice(&bytes).unwrap();
    let invite_code = invite_res["code"].as_str().unwrap();

    // User B (Member)
    let u2_id = register_user(&app, "perm_user2", "Password123!", Some(invite_code)).await;
    let (_, login_b) = login_user(
        &app,
        "perm_user2",
        "Password123!",
        "client_perm_2_12345",
        None,
    )
    .await;
    let token_b = login_b["session_token"].as_str().unwrap().to_string();

    let room_id = create_room(&app, &token_a).await;

    // Owner adds User B as member
    let add_req = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/members", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({"user_id": u2_id}).to_string()))
        .unwrap();
    let resp = app.clone().oneshot(add_req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED);

    // User B creates a session S_B
    let create_req = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/sessions", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_b))
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
    let s_b_res: Value = serde_json::from_slice(&bytes).unwrap();
    let s_b_id = s_b_res["id"].as_str().unwrap().to_string();

    // Owner creates a session S_A
    let create_req2 = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/sessions", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({"extension_id": "core.hangouts", "session_type": "voice"}).to_string(),
        ))
        .unwrap();
    let resp = app.clone().oneshot(create_req2).await.unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED);
    let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let s_a_res: Value = serde_json::from_slice(&bytes).unwrap();
    let s_a_id = s_a_res["id"].as_str().unwrap().to_string();

    // User B attempts to patch User A's session -> 403 Forbidden
    let patch_req = Request::builder()
        .method("PATCH")
        .uri(format!("/api/v1/rooms/{}/sessions/{}", room_id, s_a_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_b))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({"position": 0}).to_string()))
        .unwrap();
    let resp = app.clone().oneshot(patch_req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);

    // User B attempts to delete User A's session -> 403 Forbidden
    let del_req = Request::builder()
        .method("DELETE")
        .uri(format!("/api/v1/rooms/{}/sessions/{}", room_id, s_a_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_b))
        .body(Body::empty())
        .unwrap();
    let resp = app.clone().oneshot(del_req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);

    // Room Owner (User A) deletes User B's session -> succeeds 204
    let del_req2 = Request::builder()
        .method("DELETE")
        .uri(format!("/api/v1/rooms/{}/sessions/{}", room_id, s_b_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token_a))
        .body(Body::empty())
        .unwrap();
    let resp = app.clone().oneshot(del_req2).await.unwrap();
    assert_eq!(resp.status(), StatusCode::NO_CONTENT);
}

#[tokio::test]
async fn test_room_sessions_disabled_mode() {
    let types_file = create_temp_session_types_file();
    let (app, _pool, _) = setup_test_app_with_custom_config(|cfg| {
        cfg.sessions_enabled = false;
        cfg.session_types_config_path = types_file.path().to_str().unwrap().to_string();
    })
    .await;

    let _u1_id = register_user(&app, "dis_user1", "Password123!", None).await;
    let (status, login_res) = login_user(
        &app,
        "dis_user1",
        "Password123!",
        "client_dis_1_12345",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let token = login_res["session_token"].as_str().unwrap().to_string();

    let room_id = create_room(&app, &token).await;

    // Create returns 501
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
    assert_eq!(resp.status(), StatusCode::NOT_IMPLEMENTED);

    // List returns 200 OK
    let list_req = Request::builder()
        .method("GET")
        .uri(format!("/api/v1/rooms/{}/sessions", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .body(Body::empty())
        .unwrap();
    let resp = app.clone().oneshot(list_req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
}

#[tokio::test]
async fn test_room_deletion_cascade() {
    let types_file = create_temp_session_types_file();
    let (app, pool) = setup_session_app(types_file.path().to_str().unwrap()).await;

    let _u1_id = register_user(&app, "casc_user1", "Password123!", None).await;
    let (_, login_res) = login_user(
        &app,
        "casc_user1",
        "Password123!",
        "client_casc_1_12345",
        None,
    )
    .await;
    let token = login_res["session_token"].as_str().unwrap().to_string();

    let room_id = create_room(&app, &token).await;

    // Create a session in room
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

    // Delete room
    let del_room_req = Request::builder()
        .method("DELETE")
        .uri(format!("/api/v1/rooms/{}", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", token))
        .body(Body::empty())
        .unwrap();
    let resp = app.clone().oneshot(del_room_req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::NO_CONTENT);

    // Verify room_sessions table no longer contains rows for this room
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM room_sessions WHERE room_id = ?")
        .bind(&room_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 0);
}
