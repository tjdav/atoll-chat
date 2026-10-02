use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use axum::Router;
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use serde_json::{json, Value};
use sqlx::SqlitePool;
use tower::ServiceExt;

mod common;
use common::{login_user, register_user, setup_test_app};

async fn create_test_user_with_device(
    app: &Router,
    pool: &SqlitePool,
    prefix: &str,
) -> (String, String, String) {
    let username = format!("{}_user", prefix);
    let password = "Password123!";
    let client_id = format!("{}_client_12345678", prefix);

    let has_users: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM users)")
        .fetch_one(pool)
        .await
        .unwrap();

    let invite_code = if has_users {
        let code = format!("INV_{}", prefix);
        sqlx::query(
            "INSERT INTO server_invites (id, code, max_uses, current_uses) VALUES (?, ?, 10, 0)",
        )
        .bind(format!("inv_id_{}", prefix))
        .bind(&code)
        .execute(pool)
        .await
        .unwrap();
        Some(code)
    } else {
        None
    };

    let user_id = register_user(app, &username, password, invite_code.as_deref()).await;
    let (status, login_res) = login_user(app, &username, password, &client_id, None).await;

    if status != StatusCode::OK {
        panic!(
            "login_user failed for {}: status={}, res={:?}",
            username, status, login_res
        );
    }

    let token = login_res["session_token"].as_str().unwrap().to_string();

    (user_id, token, client_id)
}

async fn do_get(app: &Router, uri: &str, token: &str) -> (StatusCode, Value) {
    let req = Request::builder()
        .method("GET")
        .uri(uri)
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::empty())
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    let status = resp.status();
    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body_bytes).unwrap_or(json!({}));
    (status, json)
}

async fn do_post(app: &Router, uri: &str, token: &str, body: &Value) -> (StatusCode, Value) {
    let req = Request::builder()
        .method("POST")
        .uri(uri)
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(body.to_string()))
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    let status = resp.status();
    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body_bytes).unwrap_or(json!({}));
    (status, json)
}

async fn do_delete(app: &Router, uri: &str, token: &str) -> (StatusCode, Value) {
    let req = Request::builder()
        .method("DELETE")
        .uri(uri)
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::empty())
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    let status = resp.status();
    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: Value = serde_json::from_slice(&body_bytes).unwrap_or(json!({}));
    (status, json)
}

async fn create_room(app: &Router, token: &str) -> String {
    let (status, body) = do_post(app, "/api/v1/rooms", token, &json!({})).await;
    assert_eq!(status, StatusCode::CREATED);
    body["id"].as_str().unwrap().to_string()
}

async fn add_member(app: &Router, token: &str, room_id: &str, user_id: &str) {
    let (status, _) = do_post(
        app,
        &format!("/api/v1/rooms/{room_id}/members"),
        token,
        &json!({ "user_id": user_id }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
}

async fn submit_app_message(app: &Router, token: &str, room_id: &str, client_id: &str) -> String {
    let ct_b64 = BASE64.encode(b"hello world");
    let (status, body) = do_post(
        app,
        &format!("/api/v1/rooms/{room_id}/messages"),
        token,
        &json!({
            "sender_client_id": client_id,
            "epoch": 0,
            "content_type": "application",
            "ciphertext": ct_b64,
        }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    body["message_id"].as_str().unwrap().to_string()
}

#[tokio::test]
async fn test_01_sender_can_delete_own_message() {
    let (app, pool) = setup_test_app().await;
    let (_user_a, token_a, client_id_a) = create_test_user_with_device(&app, &pool, "del1_a").await;
    let room_id = create_room(&app, &token_a).await;
    let msg_id = submit_app_message(&app, &token_a, &room_id, &client_id_a).await;

    let (status, _) = do_delete(
        &app,
        &format!("/api/v1/rooms/{room_id}/messages/{msg_id}"),
        &token_a,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
}

#[tokio::test]
async fn test_02_deletion_sets_deleted_at() {
    let (app, pool) = setup_test_app().await;
    let (_user_a, token_a, client_id_a) = create_test_user_with_device(&app, &pool, "del2_a").await;
    let room_id = create_room(&app, &token_a).await;
    let msg_id = submit_app_message(&app, &token_a, &room_id, &client_id_a).await;

    let _ = do_delete(
        &app,
        &format!("/api/v1/rooms/{room_id}/messages/{msg_id}"),
        &token_a,
    )
    .await;

    let deleted_at: Option<String> =
        sqlx::query_scalar("SELECT deleted_at FROM room_messages WHERE id = ?")
            .bind(&msg_id)
            .fetch_one(&pool)
            .await
            .unwrap();

    assert!(deleted_at.is_some());
}

#[tokio::test]
async fn test_03_deleted_message_appears_in_list_messages_with_deleted_at_set() {
    let (app, pool) = setup_test_app().await;
    let (_user_a, token_a, client_id_a) = create_test_user_with_device(&app, &pool, "del3_a").await;
    let room_id = create_room(&app, &token_a).await;
    let msg_id = submit_app_message(&app, &token_a, &room_id, &client_id_a).await;

    let _ = do_delete(
        &app,
        &format!("/api/v1/rooms/{room_id}/messages/{msg_id}"),
        &token_a,
    )
    .await;

    let (status, body) = do_get(&app, &format!("/api/v1/rooms/{room_id}/messages"), &token_a).await;
    assert_eq!(status, StatusCode::OK);
    let msgs = body["messages"].as_array().unwrap();
    assert_eq!(msgs.len(), 1);
    assert_eq!(msgs[0]["id"], msg_id);
    assert!(!msgs[0]["deleted_at"].is_null());
}

#[tokio::test]
async fn test_04_ciphertext_returns_404_for_deleted_messages() {
    let (app, pool) = setup_test_app().await;
    let (_user_a, token_a, client_id_a) = create_test_user_with_device(&app, &pool, "del4_a").await;
    let room_id = create_room(&app, &token_a).await;
    let msg_id = submit_app_message(&app, &token_a, &room_id, &client_id_a).await;

    let _ = do_delete(
        &app,
        &format!("/api/v1/rooms/{room_id}/messages/{msg_id}"),
        &token_a,
    )
    .await;

    let (status, body) = do_get(
        &app,
        &format!("/api/v1/rooms/{room_id}/messages/{msg_id}/ciphertext"),
        &token_a,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body["error"], "message_deleted");
}

#[tokio::test]
async fn test_05_deleting_twice_returns_409() {
    let (app, pool) = setup_test_app().await;
    let (_user_a, token_a, client_id_a) = create_test_user_with_device(&app, &pool, "del5_a").await;
    let room_id = create_room(&app, &token_a).await;
    let msg_id = submit_app_message(&app, &token_a, &room_id, &client_id_a).await;

    let (status1, _) = do_delete(
        &app,
        &format!("/api/v1/rooms/{room_id}/messages/{msg_id}"),
        &token_a,
    )
    .await;
    assert_eq!(status1, StatusCode::NO_CONTENT);

    let (status2, body2) = do_delete(
        &app,
        &format!("/api/v1/rooms/{room_id}/messages/{msg_id}"),
        &token_a,
    )
    .await;
    assert_eq!(status2, StatusCode::CONFLICT);
    assert_eq!(body2["error"], "already_deleted");
}

#[tokio::test]
async fn test_06_owner_can_delete_another_users_message() {
    let (app, pool) = setup_test_app().await;
    let (_user_a, token_a, _) = create_test_user_with_device(&app, &pool, "del6_a").await;
    let (user_b, token_b, client_id_b) = create_test_user_with_device(&app, &pool, "del6_b").await;

    let room_id = create_room(&app, &token_a).await;
    add_member(&app, &token_a, &room_id, &user_b).await;

    let msg_id = submit_app_message(&app, &token_b, &room_id, &client_id_b).await;

    let (status, _) = do_delete(
        &app,
        &format!("/api/v1/rooms/{room_id}/messages/{msg_id}"),
        &token_a,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
}

#[tokio::test]
async fn test_07_moderator_can_delete_in_discord_mode() {
    let (app, pool) = setup_test_app().await;
    let (_user_a, token_a, _) = create_test_user_with_device(&app, &pool, "del7_a").await;
    let (user_b, token_b, _) = create_test_user_with_device(&app, &pool, "del7_b").await;
    let (user_c, token_c, client_id_c) = create_test_user_with_device(&app, &pool, "del7_c").await;

    // Set moderation_mode to discord
    sqlx::query(
        "INSERT INTO instance_config (key, value) VALUES ('moderation_mode', 'discord') ON CONFLICT(key) DO UPDATE SET value = 'discord'",
    )
    .execute(&pool)
    .await
    .unwrap();

    let room_id = create_room(&app, &token_a).await;
    add_member(&app, &token_a, &room_id, &user_b).await;
    add_member(&app, &token_a, &room_id, &user_c).await;

    // A promotes B to moderator
    let (promote_status, _) = do_post(
        &app,
        &format!("/api/v1/rooms/{room_id}/members/{user_b}/promote"),
        &token_a,
        &json!({}),
    )
    .await;
    assert_eq!(promote_status, StatusCode::NO_CONTENT);

    // C submits a message
    let msg_id = submit_app_message(&app, &token_c, &room_id, &client_id_c).await;

    // B (moderator) deletes C's message
    let (status, _) = do_delete(
        &app,
        &format!("/api/v1/rooms/{room_id}/messages/{msg_id}"),
        &token_b,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
}

#[tokio::test]
async fn test_08_moderator_cannot_delete_in_messenger_mode() {
    let (app, pool) = setup_test_app().await;
    let (_user_a, token_a, _) = create_test_user_with_device(&app, &pool, "del8_a").await;
    let (user_b, token_b, _) = create_test_user_with_device(&app, &pool, "del8_b").await;
    let (user_c, token_c, client_id_c) = create_test_user_with_device(&app, &pool, "del8_c").await;

    let room_id = create_room(&app, &token_a).await;
    add_member(&app, &token_a, &room_id, &user_b).await;
    add_member(&app, &token_a, &room_id, &user_c).await;

    // Manually set B's role to moderator in SQL
    sqlx::query("UPDATE room_members SET role = 'moderator' WHERE room_id = ? AND user_id = ?")
        .bind(&room_id)
        .bind(&user_b)
        .execute(&pool)
        .await
        .unwrap();

    // C submits message
    let msg_id = submit_app_message(&app, &token_c, &room_id, &client_id_c).await;

    // B attempts to delete C's message in messenger mode
    let (status, body) = do_delete(
        &app,
        &format!("/api/v1/rooms/{room_id}/messages/{msg_id}"),
        &token_b,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(body["error"], "forbidden");
}

#[tokio::test]
async fn test_09_regular_member_cannot_delete_another_users_message() {
    let (app, pool) = setup_test_app().await;
    let (_user_a, token_a, _) = create_test_user_with_device(&app, &pool, "del9_a").await;
    let (user_b, token_b, _) = create_test_user_with_device(&app, &pool, "del9_b").await;
    let (user_c, token_c, client_id_c) = create_test_user_with_device(&app, &pool, "del9_c").await;

    let room_id = create_room(&app, &token_a).await;
    add_member(&app, &token_a, &room_id, &user_b).await;
    add_member(&app, &token_a, &room_id, &user_c).await;

    let msg_id = submit_app_message(&app, &token_c, &room_id, &client_id_c).await;

    let (status, body) = do_delete(
        &app,
        &format!("/api/v1/rooms/{room_id}/messages/{msg_id}"),
        &token_b,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(body["error"], "forbidden");
}

#[tokio::test]
async fn test_10_non_member_cannot_delete() {
    let (app, pool) = setup_test_app().await;
    let (_user_a, token_a, client_id_a) =
        create_test_user_with_device(&app, &pool, "del10_a").await;
    let (_user_c, token_c, _) = create_test_user_with_device(&app, &pool, "del10_c").await;

    let room_id = create_room(&app, &token_a).await;
    let msg_id = submit_app_message(&app, &token_a, &room_id, &client_id_a).await;

    let (status, body) = do_delete(
        &app,
        &format!("/api/v1/rooms/{room_id}/messages/{msg_id}"),
        &token_c,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body["error"], "room_not_found");
}

#[tokio::test]
async fn test_11_unknown_message_id_returns_404() {
    let (app, pool) = setup_test_app().await;
    let (_user_a, token_a, _) = create_test_user_with_device(&app, &pool, "del11_a").await;

    let room_id = create_room(&app, &token_a).await;

    let (status, body) = do_delete(
        &app,
        &format!("/api/v1/rooms/{room_id}/messages/fake_msg_123"),
        &token_a,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body["error"], "message_not_found");
}

#[tokio::test]
async fn test_12_message_from_another_room_is_not_deletable() {
    let (app, pool) = setup_test_app().await;
    let (_user_a, token_a, client_id_a) =
        create_test_user_with_device(&app, &pool, "del12_a").await;

    let room_id_1 = create_room(&app, &token_a).await;
    let room_id_2 = create_room(&app, &token_a).await;

    let msg_id_1 = submit_app_message(&app, &token_a, &room_id_1, &client_id_a).await;

    let (status, body) = do_delete(
        &app,
        &format!("/api/v1/rooms/{room_id_2}/messages/{msg_id_1}"),
        &token_a,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body["error"], "message_not_found");
}

#[tokio::test]
async fn test_13_deletion_does_not_accelerate_retention() {
    let (app, pool) = setup_test_app().await;
    let (_user_a, token_a, client_id_a) =
        create_test_user_with_device(&app, &pool, "del13_a").await;

    let room_id = create_room(&app, &token_a).await;
    let msg_id = submit_app_message(&app, &token_a, &room_id, &client_id_a).await;

    let _ = do_delete(
        &app,
        &format!("/api/v1/rooms/{room_id}/messages/{msg_id}"),
        &token_a,
    )
    .await;

    // Run cleanup jobs
    use server::CleanupJob;
    std::env::set_var("APP_ENV", "development");
    let config = std::sync::Arc::new(server::Config::from_env().unwrap());
    let reg_store = std::sync::Arc::new(server::RegistrationStore::new());
    let login_store = std::sync::Arc::new(server::LoginStore::new());
    let storage = server::build_storage(&config).unwrap();
    let server_max = std::sync::Arc::new(server::ServerHardMax {
        file_size_bytes: config.max_file_size_bytes as i64,
        room_size: 1000,
        rooms_per_user: 500,
        devices_per_user: config.server_max_devices_per_user as i64,
        keypackages_per_device: 50,
        message_size_bytes: 65536,
        attachment_retention_days: 365,
        call_max_participants: 50,
        reactions_per_message: 50,
    });
    let ctx = server::CleanupContext {
        pool: &pool,
        config: &config,
        registration_store: &reg_store,
        login_store: &login_store,
        storage: &storage,
        server_max: &server_max,
    };
    let job = server::cleanup::welcomes::WelcomesJob;
    let _ = job.run(&ctx).await;

    // Assert row is still present in database
    let exists: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM room_messages WHERE id = ?)")
            .bind(&msg_id)
            .fetch_one(&pool)
            .await
            .unwrap();

    assert!(exists);
}

#[tokio::test]
async fn test_14_room_delete_cascades_deleted_messages() {
    let (app, pool) = setup_test_app().await;
    let (_user_a, token_a, client_id_a) =
        create_test_user_with_device(&app, &pool, "del14_a").await;

    let room_id = create_room(&app, &token_a).await;
    let msg_id = submit_app_message(&app, &token_a, &room_id, &client_id_a).await;

    let _ = do_delete(
        &app,
        &format!("/api/v1/rooms/{room_id}/messages/{msg_id}"),
        &token_a,
    )
    .await;

    // Delete room
    let (del_status, _) = do_delete(&app, &format!("/api/v1/rooms/{room_id}"), &token_a).await;
    assert_eq!(del_status, StatusCode::NO_CONTENT);

    // Assert message row is cascaded/deleted
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM room_messages WHERE room_id = ?")
        .bind(&room_id)
        .fetch_one(&pool)
        .await
        .unwrap();

    assert_eq!(count, 0);
}
