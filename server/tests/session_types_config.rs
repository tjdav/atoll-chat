mod common;

use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use common::{login_user, register_user, setup_test_app, setup_test_app_with_custom_config};
use serde_json::{json, Value};
use server::audit::{action, AuditFilter};
use server::sessions::{
    parse_and_validate_toml, SessionType, SessionTypesConfig, SessionTypesState, SessionTypesStore,
};
use std::io::Write;
use std::sync::Arc;
use tempfile::NamedTempFile;
use tower::ServiceExt;

#[test]
fn test_parse_empty_toml() {
    let contents = "";
    let cfg = parse_and_validate_toml(contents, 50, 25).unwrap();
    assert!(cfg.types.is_empty());
}

#[test]
fn test_parse_valid_single_type() {
    let contents = r#"
    [[session_type]]
    type = "voice"
    extension_id = "core.hangouts"
    max_participants = 12
    max_per_room = 3
    "#;
    let cfg = parse_and_validate_toml(contents, 50, 25).unwrap();
    assert_eq!(cfg.types.len(), 1);
    let st = cfg.get("voice").unwrap();
    assert_eq!(st.r#type, "voice");
    assert_eq!(st.extension_id, "core.hangouts");
    assert_eq!(st.max_participants, 12);
    assert_eq!(st.max_per_room, 3);
}

#[test]
fn test_parse_invalid_type_regex() {
    let contents = r#"
    [[session_type]]
    type = "Voice"
    extension_id = "core.hangouts"
    max_participants = 12
    max_per_room = 3
    "#;
    let err = parse_and_validate_toml(contents, 50, 25).unwrap_err();
    let err_str = err.to_string();
    assert!(err_str.contains("Voice"), "got: {}", err_str);
}

#[test]
fn test_parse_duplicate_type() {
    let contents = r#"
    [[session_type]]
    type = "voice"
    extension_id = "core.hangouts"
    max_participants = 12
    max_per_room = 3

    [[session_type]]
    type = "voice"
    extension_id = "core.hangouts2"
    max_participants = 10
    max_per_room = 2
    "#;
    let err = parse_and_validate_toml(contents, 50, 25).unwrap_err();
    let err_str = err.to_string();
    assert!(
        err_str.contains("duplicate session type"),
        "got: {}",
        err_str
    );
}

#[test]
fn test_parse_zero_max_participants() {
    let contents = r#"
    [[session_type]]
    type = "voice"
    extension_id = "core.hangouts"
    max_participants = 0
    max_per_room = 3
    "#;
    let err = parse_and_validate_toml(contents, 50, 25).unwrap_err();
    let err_str = err.to_string();
    assert!(
        err_str.contains("max_participants must be >= 1"),
        "got: {}",
        err_str
    );
}

#[test]
fn test_parse_exceeds_server_max_participants() {
    let contents = r#"
    [[session_type]]
    type = "voice"
    extension_id = "core.hangouts"
    max_participants = 60
    max_per_room = 3
    "#;
    let err = parse_and_validate_toml(contents, 50, 25).unwrap_err();
    let err_str = err.to_string();
    assert!(
        err_str.contains("exceeds server hard max"),
        "got: {}",
        err_str
    );
}

#[test]
fn test_parse_exceeds_server_max_per_room() {
    let contents = r#"
    [[session_type]]
    type = "voice"
    extension_id = "core.hangouts"
    max_participants = 12
    max_per_room = 30
    "#;
    let err = parse_and_validate_toml(contents, 50, 25).unwrap_err();
    let err_str = err.to_string();
    assert!(
        err_str.contains("exceeds server hard max"),
        "got: {}",
        err_str
    );
}

#[tokio::test]
async fn test_concurrency_reads_and_reloads() {
    let mut initial_cfg = SessionTypesConfig::default();
    initial_cfg.types.insert(
        "v1".to_string(),
        SessionType {
            r#type: "v1".to_string(),
            extension_id: "ext".to_string(),
            max_participants: 10,
            max_per_room: 2,
        },
    );

    let store = Arc::new(SessionTypesStore::new(SessionTypesState {
        declared_enabled: true,
        allowlist_loaded: true,
        config: initial_cfg,
    }));

    let mut handles = Vec::new();

    // Reader threads
    for _ in 0..10 {
        let store_clone = store.clone();
        handles.push(tokio::spawn(async move {
            for _ in 0..1000 {
                let all = store_clone.all();
                let len = all.len();
                assert!(len == 1 || len == 2, "observed unexpected len: {}", len);
            }
        }));
    }

    // Writer / Swapper thread
    let store_clone = store.clone();
    handles.push(tokio::spawn(async move {
        let mut second_cfg = SessionTypesConfig::default();
        second_cfg.types.insert(
            "v1".to_string(),
            SessionType {
                r#type: "v1".to_string(),
                extension_id: "ext".to_string(),
                max_participants: 10,
                max_per_room: 2,
            },
        );
        second_cfg.types.insert(
            "v2".to_string(),
            SessionType {
                r#type: "v2".to_string(),
                extension_id: "ext".to_string(),
                max_participants: 20,
                max_per_room: 4,
            },
        );

        for i in 0..500 {
            if i % 2 == 0 {
                store_clone.swap(SessionTypesState {
                    declared_enabled: true,
                    allowlist_loaded: true,
                    config: second_cfg.clone(),
                });
            } else {
                let mut single_cfg = SessionTypesConfig::default();
                single_cfg.types.insert(
                    "v1".to_string(),
                    SessionType {
                        r#type: "v1".to_string(),
                        extension_id: "ext".to_string(),
                        max_participants: 10,
                        max_per_room: 2,
                    },
                );
                store_clone.swap(SessionTypesState {
                    declared_enabled: true,
                    allowlist_loaded: true,
                    config: single_cfg,
                });
            }
            tokio::task::yield_now().await;
        }
    }));

    for h in handles {
        h.await.unwrap();
    }
}

#[tokio::test]
async fn test_capabilities_response_with_valid_session_types() {
    let mut file = NamedTempFile::new().unwrap();
    write!(
        file,
        r#"
        [[session_type]]
        type = "watch"
        extension_id = "com.example.watch-together"
        max_participants = 20
        max_per_room = 5

        [[session_type]]
        type = "voice"
        extension_id = "core.hangouts"
        max_participants = 12
        max_per_room = 3
        "#
    )
    .unwrap();
    let file_path = file.path().to_str().unwrap().to_string();

    let (app, _, _) = setup_test_app_with_custom_config(|cfg| {
        cfg.sessions_enabled = true;
        cfg.session_types_config_path = file_path;
        cfg.server_max_sessions_per_room = 25;
        cfg.server_max_session_participants = 50;
    })
    .await;

    let req = Request::builder()
        .method("GET")
        .uri("/api/v1/capabilities")
        .body(Body::empty())
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body_bytes).unwrap();

    assert_eq!(json["sessions_enabled"], true);
    assert_eq!(json["max_sessions_per_room"], 25);
    assert_eq!(json["max_session_participants"], 50);

    let session_types = json["session_types"].as_array().unwrap();
    assert_eq!(session_types.len(), 2);
    // Sorted by type ascending: "voice", then "watch"
    assert_eq!(session_types[0]["type"], "voice");
    assert_eq!(session_types[0]["extension_id"], "core.hangouts");
    assert_eq!(session_types[0]["max_participants"], 12);
    assert!(session_types[0].get("max_per_room").is_none());

    assert_eq!(session_types[1]["type"], "watch");
    assert_eq!(
        session_types[1]["extension_id"],
        "com.example.watch-together"
    );
    assert_eq!(session_types[1]["max_participants"], 20);
    assert!(session_types[1].get("max_per_room").is_none());
}

#[tokio::test]
async fn test_capabilities_response_when_sessions_disabled_by_env() {
    let (app, _, _) = setup_test_app_with_custom_config(|cfg| {
        cfg.sessions_enabled = false;
    })
    .await;

    let req = Request::builder()
        .method("GET")
        .uri("/api/v1/capabilities")
        .body(Body::empty())
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body_bytes).unwrap();

    assert_eq!(json["sessions_enabled"], false);
    assert_eq!(json["session_types"], json!([]));
}

#[tokio::test]
async fn test_capabilities_response_when_config_file_missing_at_startup() {
    let (app, _, _) = setup_test_app_with_custom_config(|cfg| {
        cfg.sessions_enabled = true;
        cfg.session_types_config_path = "/tmp/non_existent_session_types_file.toml".to_string();
    })
    .await;

    let req = Request::builder()
        .method("GET")
        .uri("/api/v1/capabilities")
        .body(Body::empty())
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body_bytes).unwrap();

    assert_eq!(json["sessions_enabled"], false);
    assert_eq!(json["session_types"], json!([]));
}

#[tokio::test]
async fn test_admin_reload_success_path() {
    let mut file = NamedTempFile::new().unwrap();
    write!(
        file,
        r#"
        [[session_type]]
        type = "voice"
        extension_id = "core.hangouts"
        max_participants = 12
        max_per_room = 3
        "#
    )
    .unwrap();
    let file_path = file.path().to_str().unwrap().to_string();

    let (app, pool, _) = setup_test_app_with_custom_config(|cfg| {
        cfg.sessions_enabled = true;
        cfg.session_types_config_path = file_path.clone();
    })
    .await;

    register_user(&app, "owner", "password123", None).await;
    let (_, login_body) =
        login_user(&app, "owner", "password123", "client_owner_123456", None).await;
    let token = login_body["session_token"].as_str().unwrap();

    // Now rewrite the file with new config
    let mut file_write = std::fs::File::create(&file_path).unwrap();
    write!(
        file_write,
        r#"
        [[session_type]]
        type = "video"
        extension_id = "com.example.video"
        max_participants = 8
        max_per_room = 2
        "#
    )
    .unwrap();

    let req_reload = Request::builder()
        .method("POST")
        .uri("/api/v1/admin/session-types/reload")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::empty())
        .unwrap();

    let resp_reload = app.clone().oneshot(req_reload).await.unwrap();
    assert_eq!(resp_reload.status(), StatusCode::OK);

    let body_bytes = axum::body::to_bytes(resp_reload.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body_bytes).unwrap();

    assert_eq!(json["reloaded"], true);
    let session_types = json["session_types"].as_array().unwrap();
    assert_eq!(session_types.len(), 1);
    assert_eq!(session_types[0]["type"], "video");
    assert_eq!(session_types[0]["extension_id"], "com.example.video");
    assert_eq!(session_types[0]["max_participants"], 8);
    assert_eq!(session_types[0]["max_per_room"], 2);

    // Verify audit log entry
    let audit_entries = server::audit::list(
        &pool,
        AuditFilter {
            action: Some(action::SESSION_TYPES_RELOAD.to_string()),
            ..Default::default()
        },
        1,
        10,
    )
    .await
    .unwrap();

    assert_eq!(audit_entries.len(), 1);
    assert_eq!(audit_entries[0].action, "session_types.reload");
    assert_eq!(
        audit_entries[0].metadata.as_ref().unwrap()["types_count"],
        1
    );

    // Verify GET /capabilities reflects the update
    let req_cap = Request::builder()
        .method("GET")
        .uri("/api/v1/capabilities")
        .body(Body::empty())
        .unwrap();

    let resp_cap = app.oneshot(req_cap).await.unwrap();
    assert_eq!(resp_cap.status(), StatusCode::OK);

    let cap_bytes = axum::body::to_bytes(resp_cap.into_body(), usize::MAX)
        .await
        .unwrap();
    let cap_json: Value = serde_json::from_slice(&cap_bytes).unwrap();
    assert_eq!(cap_json["sessions_enabled"], true);
    assert_eq!(cap_json["session_types"][0]["type"], "video");
}

#[tokio::test]
async fn test_admin_reload_invalid_config_file_returns_400_and_retains_previous() {
    let mut file = NamedTempFile::new().unwrap();
    write!(
        file,
        r#"
        [[session_type]]
        type = "voice"
        extension_id = "core.hangouts"
        max_participants = 12
        max_per_room = 3
        "#
    )
    .unwrap();
    let file_path = file.path().to_str().unwrap().to_string();

    let (app, pool, _) = setup_test_app_with_custom_config(|cfg| {
        cfg.sessions_enabled = true;
        cfg.session_types_config_path = file_path.clone();
    })
    .await;

    register_user(&app, "owner", "password123", None).await;
    let (_, login_body) =
        login_user(&app, "owner", "password123", "client_owner_123456", None).await;
    let token = login_body["session_token"].as_str().unwrap();

    // Corrupt the TOML file
    let mut file_write = std::fs::File::create(&file_path).unwrap();
    write!(
        file_write,
        r#"
        [[session_type]]
        type = "invalid_type_because_of_0_participants"
        extension_id = "core.hangouts"
        max_participants = 0
        max_per_room = 3
        "#
    )
    .unwrap();

    let req_reload = Request::builder()
        .method("POST")
        .uri("/api/v1/admin/session-types/reload")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::empty())
        .unwrap();

    let resp_reload = app.clone().oneshot(req_reload).await.unwrap();
    assert_eq!(resp_reload.status(), StatusCode::BAD_REQUEST);

    let body_bytes = axum::body::to_bytes(resp_reload.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body_bytes).unwrap();

    assert_eq!(json["error"], "invalid_session_types_config");
    assert_eq!(json["message"], "Validation failed");
    assert!(json["details"]["reason"]
        .as_str()
        .unwrap()
        .contains("max_participants must be >= 1"));

    // Verify no audit log entry was written
    let audit_entries = server::audit::list(
        &pool,
        AuditFilter {
            action: Some(action::SESSION_TYPES_RELOAD.to_string()),
            ..Default::default()
        },
        1,
        10,
    )
    .await
    .unwrap();
    assert!(audit_entries.is_empty());

    // Verify GET /capabilities still returns the previous config ("voice")
    let req_cap = Request::builder()
        .method("GET")
        .uri("/api/v1/capabilities")
        .body(Body::empty())
        .unwrap();

    let resp_cap = app.oneshot(req_cap).await.unwrap();
    let cap_bytes = axum::body::to_bytes(resp_cap.into_body(), usize::MAX)
        .await
        .unwrap();
    let cap_json: Value = serde_json::from_slice(&cap_bytes).unwrap();
    assert_eq!(cap_json["sessions_enabled"], true);
    assert_eq!(cap_json["session_types"][0]["type"], "voice");
}

#[tokio::test]
async fn test_admin_reload_missing_config_file_returns_400() {
    let (app, _, _) = setup_test_app_with_custom_config(|cfg| {
        cfg.sessions_enabled = true;
        cfg.session_types_config_path = "/tmp/non_existent_file_path.toml".to_string();
    })
    .await;

    register_user(&app, "owner", "password123", None).await;
    let (_, login_body) =
        login_user(&app, "owner", "password123", "client_owner_123456", None).await;
    let token = login_body["session_token"].as_str().unwrap();

    let req_reload = Request::builder()
        .method("POST")
        .uri("/api/v1/admin/session-types/reload")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::empty())
        .unwrap();

    let resp_reload = app.oneshot(req_reload).await.unwrap();
    assert_eq!(resp_reload.status(), StatusCode::BAD_REQUEST);

    let body_bytes = axum::body::to_bytes(resp_reload.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body_bytes).unwrap();

    assert_eq!(json["error"], "session_types_config_missing");
    assert_eq!(json["message"], "Configuration file missing");
    assert_eq!(json["details"]["path"], "/tmp/non_existent_file_path.toml");
}

#[tokio::test]
async fn test_admin_reload_permissions() {
    let (app, pool) = setup_test_app().await;

    register_user(&app, "owner", "password123", None).await;

    // Create an invite for member
    sqlx::query(
        "INSERT INTO server_invites (id, code, max_uses, current_uses) VALUES ('inv_1', 'INV123', 1, 0)",
    )
    .execute(&pool)
    .await
    .unwrap();

    register_user(&app, "member", "password123", Some("INV123")).await;
    let (_, member_login) =
        login_user(&app, "member", "password123", "client_member_123456", None).await;
    let member_token = member_login["session_token"].as_str().unwrap();

    // Unauthenticated -> 401
    let req_unauth = Request::builder()
        .method("POST")
        .uri("/api/v1/admin/session-types/reload")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::empty())
        .unwrap();

    let resp_unauth = app.clone().oneshot(req_unauth).await.unwrap();
    assert_eq!(resp_unauth.status(), StatusCode::UNAUTHORIZED);

    // Non-admin member -> 403
    let req_member = Request::builder()
        .method("POST")
        .uri("/api/v1/admin/session-types/reload")
        .header(header::AUTHORIZATION, format!("Bearer {member_token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::empty())
        .unwrap();

    let resp_member = app.oneshot(req_member).await.unwrap();
    assert_eq!(resp_member.status(), StatusCode::FORBIDDEN);
}
