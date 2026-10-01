mod common;

use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use common::{login_user, obtain_username_token, register_user, setup_test_app};
use serde_json::Value;
use tower::ServiceExt;

const TEST_CLIENT_ID: &str = "client_id_123456789";

#[tokio::test]
async fn test_gdpr_export_and_deletion() {
    let (app, pool) = setup_test_app().await;

    // First user is owner
    let user_id = register_user(&app, "alice", "password123", None).await;
    let token = obtain_username_token(&app, "alice").await;

    // Create invite for second user
    sqlx::query(
        "INSERT INTO server_invites (id, code, max_uses, current_uses) VALUES ('inv_1', 'INVITE123', 1, 0)",
    )
    .execute(&pool)
    .await
    .unwrap();

    // Register second user bob and grant owner role so alice is not sole owner
    let user_b_id = register_user(&app, "bob", "password123", Some("INVITE123")).await;
    sqlx::query("INSERT INTO user_roles (user_id, role_id) VALUES (?, 'role_owner')")
        .bind(&user_b_id)
        .execute(&pool)
        .await
        .unwrap();

    let (_, login_body) = login_user(&app, "alice", "password123", TEST_CLIENT_ID, None).await;
    let session_token = login_body["session_token"].as_str().unwrap();

    // Export me
    let req_exp = Request::builder()
        .method("GET")
        .uri("/api/v1/users/me/export")
        .header(header::AUTHORIZATION, format!("Bearer {}", session_token))
        .body(Body::empty())
        .unwrap();

    let resp_exp = app.clone().oneshot(req_exp).await.unwrap();
    assert_eq!(resp_exp.status(), StatusCode::OK);

    let zip_bytes = axum::body::to_bytes(resp_exp.into_body(), usize::MAX)
        .await
        .unwrap();

    // Verify zip archive contents
    let cursor = std::io::Cursor::new(zip_bytes);
    let mut zip = zip::ZipArchive::new(cursor).unwrap();

    {
        let mut profile_file = zip.by_name("profile.json").unwrap();
        let profile_json: Value = serde_json::from_reader(&mut profile_file).unwrap();

        assert_eq!(profile_json["user_id"], user_id);
        assert_eq!(profile_json["username_token"], token);
        assert!(profile_json.get("username").is_none());
    }

    {
        let mut readme_file = zip.by_name("README.txt").unwrap();
        let mut readme_text = String::new();
        std::io::Read::read_to_string(&mut readme_file, &mut readme_text).unwrap();
        assert!(readme_text.contains("username_token"));
    }

    // Delete me
    let req_del = Request::builder()
        .method("DELETE")
        .uri("/api/v1/users/me")
        .header(header::AUTHORIZATION, format!("Bearer {}", session_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            serde_json::json!({ "confirm": "DELETE" }).to_string(),
        ))
        .unwrap();

    let resp_del = app.clone().oneshot(req_del).await.unwrap();
    assert_eq!(resp_del.status(), StatusCode::NO_CONTENT);

    // Verify user row in DB after deletion
    let (anon_token, deleted_at): (String, Option<String>) =
        sqlx::query_as("SELECT username_token, deleted_at FROM users WHERE id = ?")
            .bind(&user_id)
            .fetch_one(&pool)
            .await
            .unwrap();

    assert_ne!(anon_token, token);
    assert_eq!(anon_token.len(), 86);
    assert!(deleted_at.is_some());

    // Create invite for re-registering alice
    sqlx::query(
        "INSERT INTO server_invites (id, code, max_uses, current_uses) VALUES ('inv_2', 'INVITE456', 1, 0)",
    )
    .execute(&pool)
    .await
    .unwrap();

    // Re-registering "alice" (producing the same token) succeeds because the original token was replaced
    let user_id_2 = register_user(&app, "alice", "password123", Some("INVITE456")).await;
    assert_ne!(user_id_2, user_id);
}
