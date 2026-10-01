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

async fn do_delete_with_body(
    app: &Router,
    uri: &str,
    token: &str,
    body: &Value,
) -> (StatusCode, Value) {
    let req = Request::builder()
        .method("DELETE")
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

async fn create_room(app: &Router, token: &str) -> String {
    let (status, body) = do_post(app, "/api/v1/rooms", token, &json!({})).await;
    assert_eq!(status, StatusCode::CREATED);
    body["id"].as_str().unwrap().to_string()
}

#[tokio::test]
async fn test_01_adding_member_with_welcome_data_creates_welcome() {
    let (app, pool) = setup_test_app().await;
    let (_user_a, token_a, _) = create_test_user_with_device(&app, &pool, "user_a").await;
    let (user_b, token_b, _) = create_test_user_with_device(&app, &pool, "user_b").await;

    let room_id = create_room(&app, &token_a).await;

    let welcome_b64 = BASE64.encode(b"welcome blob data");

    let (add_status, _) = do_post(
        &app,
        &format!("/api/v1/rooms/{room_id}/members"),
        &token_a,
        &json!({
            "user_id": user_b,
            "welcome_data": welcome_b64,
        }),
    )
    .await;

    assert_eq!(add_status, StatusCode::CREATED);

    let (welcomes_status, body) = do_get(&app, "/api/v1/welcomes", &token_b).await;
    assert_eq!(welcomes_status, StatusCode::OK);
    let welcomes = body["welcomes"].as_array().unwrap();
    assert_eq!(welcomes.len(), 1);
    assert_eq!(welcomes[0]["room_id"], room_id);
    assert_eq!(welcomes[0]["recipient_user_id"], user_b);
    assert_eq!(welcomes[0]["consumed"], false);
}

#[tokio::test]
async fn test_02_adding_without_welcome_data_does_not_create_welcome() {
    let (app, pool) = setup_test_app().await;
    let (_user_a, token_a, _) = create_test_user_with_device(&app, &pool, "user_a").await;
    let (user_b, token_b, _) = create_test_user_with_device(&app, &pool, "user_b").await;

    let room_id = create_room(&app, &token_a).await;

    let (add_status, _) = do_post(
        &app,
        &format!("/api/v1/rooms/{room_id}/members"),
        &token_a,
        &json!({
            "user_id": user_b,
        }),
    )
    .await;

    assert_eq!(add_status, StatusCode::CREATED);

    let (_, body) = do_get(&app, "/api/v1/welcomes", &token_b).await;
    let welcomes = body["welcomes"].as_array().unwrap();
    assert!(welcomes.is_empty());
}

#[tokio::test]
async fn test_03_target_with_no_devices_returns_400() {
    let (app, pool) = setup_test_app().await;
    let (_user_a, token_a, _) = create_test_user_with_device(&app, &pool, "user_a").await;

    // Register user B without creating a device
    let user_b_id = ulid::Ulid::new().to_string();
    sqlx::query("INSERT INTO users (id, username_token, opaque_registration, identity_pubkey) VALUES (?, 'token_b_1234567890123456789012345678901234567890123456789012345678901234567890123456789012', 'reg', 'pub')")
        .bind(&user_b_id)
        .execute(&pool)
        .await
        .unwrap();

    let room_id = create_room(&app, &token_a).await;
    let welcome_b64 = BASE64.encode(b"welcome blob data");

    let (status, body) = do_post(
        &app,
        &format!("/api/v1/rooms/{room_id}/members"),
        &token_a,
        &json!({
            "user_id": user_b_id,
            "welcome_data": welcome_b64,
        }),
    )
    .await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["error"], "target_has_no_device");
}

#[tokio::test]
async fn test_04_list_returns_only_current_user_welcomes() {
    let (app, pool) = setup_test_app().await;
    let (_user_a, token_a, _) = create_test_user_with_device(&app, &pool, "user_a").await;
    let (user_b, token_b, _) = create_test_user_with_device(&app, &pool, "user_b").await;
    let (user_c, token_c, _) = create_test_user_with_device(&app, &pool, "user_c").await;

    let room_id = create_room(&app, &token_a).await;
    let welcome_b64 = BASE64.encode(b"welcome blob data");

    let _ = do_post(
        &app,
        &format!("/api/v1/rooms/{room_id}/members"),
        &token_a,
        &json!({
            "user_id": user_b,
            "welcome_data": welcome_b64,
        }),
    )
    .await;

    let _ = do_post(
        &app,
        &format!("/api/v1/rooms/{room_id}/members"),
        &token_a,
        &json!({
            "user_id": user_c,
            "welcome_data": welcome_b64,
        }),
    )
    .await;

    let (_, body_b) = do_get(&app, "/api/v1/welcomes", &token_b).await;
    let list_b = body_b["welcomes"].as_array().unwrap();
    assert_eq!(list_b.len(), 1);
    assert_eq!(list_b[0]["recipient_user_id"], user_b);

    let (_, body_c) = do_get(&app, "/api/v1/welcomes", &token_c).await;
    let list_c = body_c["welcomes"].as_array().unwrap();
    assert_eq!(list_c.len(), 1);
    assert_eq!(list_c[0]["recipient_user_id"], user_c);
}

#[tokio::test]
async fn test_05_fetching_welcome_returns_ciphertext() {
    let (app, pool) = setup_test_app().await;
    let (_user_a, token_a, _) = create_test_user_with_device(&app, &pool, "user_a").await;
    let (user_b, token_b, _) = create_test_user_with_device(&app, &pool, "user_b").await;

    let room_id = create_room(&app, &token_a).await;
    let raw_data = b"raw welcome ciphertext payload";
    let welcome_b64 = BASE64.encode(raw_data);

    let _ = do_post(
        &app,
        &format!("/api/v1/rooms/{room_id}/members"),
        &token_a,
        &json!({
            "user_id": user_b,
            "welcome_data": welcome_b64,
        }),
    )
    .await;

    let (_, list_body) = do_get(&app, "/api/v1/welcomes", &token_b).await;
    let welcome_id = list_body["welcomes"][0]["id"].as_str().unwrap();

    let (get_status, get_body) =
        do_get(&app, &format!("/api/v1/welcomes/{welcome_id}"), &token_b).await;
    assert_eq!(get_status, StatusCode::OK);
    assert_eq!(get_body["id"], welcome_id);
    assert_eq!(get_body["welcome_data"], welcome_b64);
}

#[tokio::test]
async fn test_06_consuming_welcome_marks_consumed() {
    let (app, pool) = setup_test_app().await;
    let (_user_a, token_a, _) = create_test_user_with_device(&app, &pool, "user_a").await;
    let (user_b, token_b, _) = create_test_user_with_device(&app, &pool, "user_b").await;

    let room_id = create_room(&app, &token_a).await;
    let welcome_b64 = BASE64.encode(b"welcome blob data");

    let _ = do_post(
        &app,
        &format!("/api/v1/rooms/{room_id}/members"),
        &token_a,
        &json!({
            "user_id": user_b,
            "welcome_data": welcome_b64,
        }),
    )
    .await;

    let (_, list_body) = do_get(&app, "/api/v1/welcomes", &token_b).await;
    let welcome_id = list_body["welcomes"][0]["id"].as_str().unwrap();

    let (consume_status, consume_body) = do_post(
        &app,
        &format!("/api/v1/welcomes/{welcome_id}/consume"),
        &token_b,
        &json!({}),
    )
    .await;

    assert_eq!(consume_status, StatusCode::OK);
    assert_eq!(consume_body["consumed"], true);

    let (_, list_after_body) = do_get(&app, "/api/v1/welcomes", &token_b).await;
    let list_arr = list_after_body["welcomes"].as_array().unwrap();
    assert!(list_arr.is_empty());
}

#[tokio::test]
async fn test_07_consuming_twice_returns_409() {
    let (app, pool) = setup_test_app().await;
    let (_user_a, token_a, _) = create_test_user_with_device(&app, &pool, "user_a").await;
    let (user_b, token_b, _) = create_test_user_with_device(&app, &pool, "user_b").await;

    let room_id = create_room(&app, &token_a).await;
    let welcome_b64 = BASE64.encode(b"welcome blob data");

    let _ = do_post(
        &app,
        &format!("/api/v1/rooms/{room_id}/members"),
        &token_a,
        &json!({
            "user_id": user_b,
            "welcome_data": welcome_b64,
        }),
    )
    .await;

    let (_, list_body) = do_get(&app, "/api/v1/welcomes", &token_b).await;
    let welcome_id = list_body["welcomes"][0]["id"].as_str().unwrap();

    let _ = do_post(
        &app,
        &format!("/api/v1/welcomes/{welcome_id}/consume"),
        &token_b,
        &json!({}),
    )
    .await;

    let (status, body) = do_post(
        &app,
        &format!("/api/v1/welcomes/{welcome_id}/consume"),
        &token_b,
        &json!({}),
    )
    .await;

    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(body["error"], "already_consumed");
}

#[tokio::test]
async fn test_08_fetching_another_user_welcome_returns_404() {
    let (app, pool) = setup_test_app().await;
    let (_user_a, token_a, _) = create_test_user_with_device(&app, &pool, "user_a").await;
    let (user_b, token_b, _) = create_test_user_with_device(&app, &pool, "user_b").await;
    let (_user_c, token_c, _) = create_test_user_with_device(&app, &pool, "user_c").await;

    let room_id = create_room(&app, &token_a).await;
    let welcome_b64 = BASE64.encode(b"welcome blob data");

    let _ = do_post(
        &app,
        &format!("/api/v1/rooms/{room_id}/members"),
        &token_a,
        &json!({
            "user_id": user_b,
            "welcome_data": welcome_b64,
        }),
    )
    .await;

    let (_, list_body) = do_get(&app, "/api/v1/welcomes", &token_b).await;
    let welcome_id = list_body["welcomes"][0]["id"].as_str().unwrap();

    let (status, body) = do_get(&app, &format!("/api/v1/welcomes/{welcome_id}"), &token_c).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body["error"], "welcome_not_found");
}

#[tokio::test]
async fn test_09_consuming_another_user_welcome_returns_404() {
    let (app, pool) = setup_test_app().await;
    let (_user_a, token_a, _) = create_test_user_with_device(&app, &pool, "user_a").await;
    let (user_b, token_b, _) = create_test_user_with_device(&app, &pool, "user_b").await;
    let (_user_c, token_c, _) = create_test_user_with_device(&app, &pool, "user_c").await;

    let room_id = create_room(&app, &token_a).await;
    let welcome_b64 = BASE64.encode(b"welcome blob data");

    let _ = do_post(
        &app,
        &format!("/api/v1/rooms/{room_id}/members"),
        &token_a,
        &json!({
            "user_id": user_b,
            "welcome_data": welcome_b64,
        }),
    )
    .await;

    let (_, list_body) = do_get(&app, "/api/v1/welcomes", &token_b).await;
    let welcome_id = list_body["welcomes"][0]["id"].as_str().unwrap();

    let (status, body) = do_post(
        &app,
        &format!("/api/v1/welcomes/{welcome_id}/consume"),
        &token_c,
        &json!({}),
    )
    .await;

    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body["error"], "welcome_not_found");
}

#[tokio::test]
async fn test_10_cascade_on_room_delete() {
    let (app, pool) = setup_test_app().await;
    let (_user_a, token_a, _) = create_test_user_with_device(&app, &pool, "user_a").await;
    let (user_b, _token_b, _) = create_test_user_with_device(&app, &pool, "user_b").await;

    let room_id = create_room(&app, &token_a).await;
    let welcome_b64 = BASE64.encode(b"welcome blob data");

    let _ = do_post(
        &app,
        &format!("/api/v1/rooms/{room_id}/members"),
        &token_a,
        &json!({
            "user_id": user_b,
            "welcome_data": welcome_b64,
        }),
    )
    .await;

    let count_before: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM welcomes WHERE room_id = ?")
        .bind(&room_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count_before, 1);

    let (del_status, _) = do_delete(&app, &format!("/api/v1/rooms/{room_id}"), &token_a).await;
    assert_eq!(del_status, StatusCode::NO_CONTENT);

    let count_after: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM welcomes WHERE room_id = ?")
        .bind(&room_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count_after, 0);
}

#[tokio::test]
async fn test_11_cascade_on_user_delete() {
    let (app, pool) = setup_test_app().await;
    let (_user_a, token_a, _) = create_test_user_with_device(&app, &pool, "user_a").await;
    let (user_b, token_b, _) = create_test_user_with_device(&app, &pool, "user_b").await;

    let room_id = create_room(&app, &token_a).await;
    let welcome_b64 = BASE64.encode(b"welcome blob data");

    let _ = do_post(
        &app,
        &format!("/api/v1/rooms/{room_id}/members"),
        &token_a,
        &json!({
            "user_id": user_b,
            "welcome_data": welcome_b64,
        }),
    )
    .await;

    let (del_status, _) = do_delete_with_body(
        &app,
        "/api/v1/users/me",
        &token_b,
        &json!({"confirm": "DELETE"}),
    )
    .await;
    assert_eq!(del_status, StatusCode::NO_CONTENT);

    let count_after: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM welcomes WHERE recipient_user_id = ?")
            .bind(&user_b)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(count_after, 0);
}
