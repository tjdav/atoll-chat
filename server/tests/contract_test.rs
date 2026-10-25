mod common;

use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use axum::Router;
use serde_json::{json, Value};
use server::openapi::ApiDoc;
use sqlx::SqlitePool;
use tower::ServiceExt;
use utoipa::OpenApi;

fn openapi_doc() -> Value {
    serde_json::to_value(ApiDoc::openapi()).expect("ApiDoc serializes")
}

fn extract_response_schema(doc: &Value, path: &str, method: &str, status: u16) -> (String, Value) {
    let status_str = status.to_string();
    let method_lc = method.to_lowercase();

    let responses = &doc["paths"][path][&method_lc]["responses"];
    let response_obj = &responses[&status_str];
    if response_obj.is_null() {
        panic!(
            "Missing response definition in OpenAPI for path: '{}', method: '{}', status: '{}'",
            path, method, status
        );
    }

    let schema_ref = &response_obj["content"]["application/json"]["schema"];
    if schema_ref.is_null() {
        panic!(
            "Missing JSON schema for path: '{}', method: '{}', status: '{}'",
            path, method, status
        );
    }

    if let Some(ref_str) = schema_ref["$ref"].as_str() {
        let prefix = "#/components/schemas/";
        if let Some(component_name) = ref_str.strip_prefix(prefix) {
            let component_schema = &doc["components"]["schemas"][component_name];
            if component_schema.is_null() {
                panic!("Referenced component schema '{}' not found", component_name);
            }
            (component_name.to_string(), component_schema.clone())
        } else {
            panic!("Unsupported $ref format: '{}'", ref_str);
        }
    } else {
        ("inline".to_string(), schema_ref.clone())
    }
}

fn validate(doc: &Value, value: &Value, schema: &Value) -> Result<(), String> {
    let mut full_schema = schema.clone();
    if let Some(obj) = full_schema.as_object_mut() {
        if let Some(components) = doc.get("components") {
            obj.insert("components".to_string(), components.clone());
        }
        if !obj.contains_key("allOf") && !obj.contains_key("oneOf") && !obj.contains_key("anyOf") {
            obj.insert("additionalProperties".to_string(), Value::Bool(false));
        }
    }

    let validator = jsonschema::validator_for(&full_schema)
        .map_err(|e| format!("Schema compile error: {}", e))?;
    let mut errors = validator.iter_errors(value);
    if let Some(err) = errors.next() {
        return Err(format!("path '{}': {}", err.instance_path, err));
    }
    Ok(())
}

struct ContractFixture {
    app: Router,
    _pool: SqlitePool,
    alice_token: String,
    _bob_token: String,
    room_id: String,
    _message_id: String,
    bot_id: String,
    bot_token: String,
    alice_user_id: String,
}

async fn setup_contract_test_fixture() -> ContractFixture {
    let (app, pool) = common::setup_test_app().await;

    let (alice_token, alice_user_id) = common::create_test_user_and_session(&app, &pool).await;
    let (bob_token, _bob_user_id) = common::create_test_user_and_session(&app, &pool).await;

    // Register a device for Alice
    sqlx::query(
        "INSERT INTO devices (id, user_id, client_id, platform) VALUES ('dev_1', ?, 'client_msg_1', 'web')",
    )
    .bind(&alice_user_id)
    .execute(&pool)
    .await
    .unwrap();

    // Create a room with Alice
    let req_room = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms")
        .header(header::CONTENT_TYPE, "application/json")
        .header(header::AUTHORIZATION, format!("Bearer {}", alice_token))
        .body(Body::from(
            json!({ "name": "Contract Test Room" }).to_string(),
        ))
        .unwrap();

    let resp_room = app.clone().oneshot(req_room).await.unwrap();
    assert_eq!(resp_room.status(), StatusCode::CREATED);
    let room_body: Value = serde_json::from_slice(
        &axum::body::to_bytes(resp_room.into_body(), usize::MAX)
            .await
            .unwrap(),
    )
    .unwrap();
    let room_id = room_body["id"]
        .as_str()
        .unwrap_or_else(|| panic!("room_body: {:?}", room_body))
        .to_string();

    // Post a message in the room
    let req_msg = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/messages", room_id))
        .header(header::CONTENT_TYPE, "application/json")
        .header(header::AUTHORIZATION, format!("Bearer {}", alice_token))
        .body(Body::from(
            json!({
                "sender_client_id": "client_msg_1",
                "epoch": 0,
                "content_type": "application",
                "ciphertext": "dGVzdCBjaXBoZXJ0ZXh0"
            })
            .to_string(),
        ))
        .unwrap();

    let resp_msg = app.clone().oneshot(req_msg).await.unwrap();
    let status_msg = resp_msg.status();
    let body_msg_bytes = axum::body::to_bytes(resp_msg.into_body(), usize::MAX)
        .await
        .unwrap();
    let msg_body: Value = serde_json::from_slice(&body_msg_bytes).unwrap();
    if status_msg != StatusCode::CREATED && status_msg != StatusCode::OK {
        panic!(
            "post message failed: status {}, body: {}",
            status_msg, msg_body
        );
    }
    let message_id = msg_body["id"]
        .as_str()
        .or_else(|| msg_body["message_id"].as_str())
        .unwrap_or("msg_1")
        .to_string();

    // Create a bot for Alice
    let pk_b64 = "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE";
    let req_bot = Request::builder()
        .method("POST")
        .uri("/api/v1/bots")
        .header(header::CONTENT_TYPE, "application/json")
        .header(header::AUTHORIZATION, format!("Bearer {}", alice_token))
        .body(Body::from(
            json!({
                "display_name": "ContractBot",
                "bot_identity_pubkey": pk_b64,
                "bot_command_pubkey": pk_b64,
                "identity_pubkey": pk_b64,
                "declared_scopes": ["post_message", "read_content"]
            })
            .to_string(),
        ))
        .unwrap();

    let resp_bot = app.clone().oneshot(req_bot).await.unwrap();
    let status_bot = resp_bot.status();
    let body_bot_bytes = axum::body::to_bytes(resp_bot.into_body(), usize::MAX)
        .await
        .unwrap();
    let bot_body: Value = serde_json::from_slice(&body_bot_bytes).unwrap();
    if status_bot != StatusCode::OK && status_bot != StatusCode::CREATED {
        panic!(
            "create bot failed: status {}, body: {}",
            status_bot, bot_body
        );
    }
    let bot_id = bot_body["bot_id"]
        .as_str()
        .or_else(|| bot_body["id"].as_str())
        .unwrap()
        .to_string();

    // Grant bot to room
    let req_grant = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/bots", room_id))
        .header(header::CONTENT_TYPE, "application/json")
        .header(header::AUTHORIZATION, format!("Bearer {}", alice_token))
        .body(Body::from(
            json!({
                "bot_id": bot_id,
                "scopes": ["post_message", "read_content"]
            })
            .to_string(),
        ))
        .unwrap();
    let resp_grant = app.clone().oneshot(req_grant).await.unwrap();
    let status_grant = resp_grant.status();
    let body_grant_bytes = axum::body::to_bytes(resp_grant.into_body(), usize::MAX)
        .await
        .unwrap();
    if status_grant != StatusCode::OK
        && status_grant != StatusCode::CREATED
        && status_grant != StatusCode::NO_CONTENT
    {
        let grant_body: Value = serde_json::from_slice(&body_grant_bytes).unwrap_or(json!({}));
        panic!(
            "grant bot failed: status {}, body: {}",
            status_grant, grant_body
        );
    }

    // Create token for bot
    let req_token = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/bots/{}/tokens", bot_id))
        .header(header::CONTENT_TYPE, "application/json")
        .header(header::AUTHORIZATION, format!("Bearer {}", alice_token))
        .body(Body::from(json!({ "label": "test_token" }).to_string()))
        .unwrap();

    let resp_token = app.clone().oneshot(req_token).await.unwrap();
    let status_token = resp_token.status();
    let body_token_bytes = axum::body::to_bytes(resp_token.into_body(), usize::MAX)
        .await
        .unwrap();
    let token_body: Value = serde_json::from_slice(&body_token_bytes).unwrap_or_else(|_| {
        let text = String::from_utf8_lossy(&body_token_bytes);
        panic!(
            "create token failed: status {}, text: {}",
            status_token, text
        );
    });
    if status_token != StatusCode::OK && status_token != StatusCode::CREATED {
        panic!(
            "create token failed: status {}, body: {}",
            status_token, token_body
        );
    }
    let bot_token = token_body["bot_token"]
        .as_str()
        .or_else(|| token_body["token"].as_str())
        .unwrap()
        .to_string();

    // Populate Key Transparency entries in DB for user (bot leaf was already appended at index 0 during bot creation)
    let leaf_hash_user = vec![1u8; 32];

    let max_idx: i64 =
        sqlx::query_scalar("SELECT COALESCE(MAX(leaf_index), -1) FROM key_transparency_log")
            .fetch_one(&pool)
            .await
            .unwrap();

    sqlx::query(
        "INSERT INTO key_transparency_log (leaf_index, user_id, username_token, identity_pubkey, leaf_hash) VALUES (?, ?, 'tok_alice', 'pk_alice', ?)",
    )
    .bind(max_idx + 1)
    .bind(&alice_user_id)
    .bind(&leaf_hash_user)
    .execute(&pool)
    .await
    .unwrap();

    let root_hash = vec![3u8; 32];
    sqlx::query(
        "INSERT INTO key_transparency_snapshots (id, tree_size, root_hash, signature, created_at) VALUES ('snap_1', 2, ?, X'0000', CURRENT_TIMESTAMP)",
    )
    .bind(&root_hash)
    .execute(&pool)
    .await
    .unwrap();

    ContractFixture {
        app,
        _pool: pool,
        alice_token,
        _bob_token: bob_token,
        room_id,
        _message_id: message_id,
        bot_id,
        bot_token,
        alice_user_id,
    }
}

enum AuthMode {
    None,
    UserTokenAlice,
    BotToken,
}

#[tokio::test]
async fn test_responses_match_openapi_schemas() {
    let fixture = setup_contract_test_fixture().await;
    let doc = openapi_doc();

    let descriptors = vec![
        (
            "capabilities",
            "GET",
            "/api/v1/capabilities",
            vec![],
            "",
            AuthMode::None,
            200,
        ),
        (
            "user_me",
            "GET",
            "/api/v1/users/me",
            vec![],
            "",
            AuthMode::UserTokenAlice,
            200,
        ),
        (
            "user_sync",
            "GET",
            "/api/v1/users/me/sync",
            vec![],
            "?since_seq=0",
            AuthMode::UserTokenAlice,
            200,
        ),
        (
            "room_list",
            "GET",
            "/api/v1/rooms",
            vec![],
            "",
            AuthMode::UserTokenAlice,
            200,
        ),
        (
            "room_get",
            "GET",
            "/api/v1/rooms/{id}",
            vec![("{id}", fixture.room_id.as_str())],
            "",
            AuthMode::UserTokenAlice,
            200,
        ),
        (
            "room_members",
            "GET",
            "/api/v1/rooms/{id}/members",
            vec![("{id}", fixture.room_id.as_str())],
            "",
            AuthMode::UserTokenAlice,
            200,
        ),
        (
            "room_messages",
            "GET",
            "/api/v1/rooms/{id}/messages",
            vec![("{id}", fixture.room_id.as_str())],
            "",
            AuthMode::UserTokenAlice,
            200,
        ),
        (
            "bot_get",
            "GET",
            "/api/v1/bots/{id}",
            vec![("{id}", fixture.bot_id.as_str())],
            "",
            AuthMode::UserTokenAlice,
            200,
        ),
        (
            "bot_settings_me",
            "GET",
            "/api/v1/bots/me/settings",
            vec![],
            "",
            AuthMode::BotToken,
            200,
        ),
        (
            "kt_user",
            "GET",
            "/api/v1/kt/user/{id}",
            vec![("{id}", fixture.alice_user_id.as_str())],
            "",
            AuthMode::UserTokenAlice,
            200,
        ),
        (
            "kt_bot",
            "GET",
            "/api/v1/kt/bot/{id}",
            vec![("{id}", fixture.bot_id.as_str())],
            "",
            AuthMode::UserTokenAlice,
            200,
        ),
        (
            "kt_snapshot",
            "GET",
            "/api/v1/kt/snapshot",
            vec![],
            "",
            AuthMode::UserTokenAlice,
            200,
        ),
    ];

    let mut failures = Vec::new();

    for (name, method, openapi_path, params, query_suffix, auth_mode, expected_status) in
        descriptors
    {
        let mut actual_uri = openapi_path.to_string();
        for (param_key, param_val) in params {
            actual_uri = actual_uri.replace(param_key, param_val);
        }
        actual_uri.push_str(query_suffix);

        let mut req_builder = Request::builder().method(method).uri(&actual_uri);

        match auth_mode {
            AuthMode::None => {}
            AuthMode::UserTokenAlice => {
                req_builder = req_builder.header(
                    header::AUTHORIZATION,
                    format!("Bearer {}", fixture.alice_token),
                );
            }
            AuthMode::BotToken => {
                req_builder = req_builder.header(
                    header::AUTHORIZATION,
                    format!("Bearer {}", fixture.bot_token),
                );
            }
        }

        let req = req_builder.body(Body::empty()).unwrap();
        let resp = fixture.app.clone().oneshot(req).await.unwrap();
        let status = resp.status();

        let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let body_json: Value = match serde_json::from_slice(&body_bytes) {
            Ok(v) => v,
            Err(e) => {
                failures.push(format!(
                    "[{}] Failed to parse JSON response body for '{}': {}",
                    name, actual_uri, e
                ));
                continue;
            }
        };

        if status.as_u16() != expected_status {
            panic!(
                "Endpoint [{}] '{}' returned status {} expected {}, body: {}",
                name, actual_uri, status, expected_status, body_json
            );
        }

        let (schema_name, schema) =
            extract_response_schema(&doc, openapi_path, method, expected_status);

        if let Err(err) = validate(&doc, &body_json, &schema) {
            failures.push(format!(
                "Endpoint [{}] path '{}' (schema '{}') mismatch: {}",
                name, actual_uri, schema_name, err
            ));
        }
    }

    if !failures.is_empty() {
        panic!(
            "Contract test schema validation failures ({}/12):\n{}",
            failures.len(),
            failures.join("\n")
        );
    }
}

#[tokio::test]
async fn test_error_responses_match_openapi_schemas() {
    let fixture = setup_contract_test_fixture().await;
    let doc = openapi_doc();

    let (_, error_schema) = (
        "ErrorResponse",
        &doc["components"]["schemas"]["ErrorResponse"],
    );

    let error_cases = vec![
        (
            "not_found_room",
            "GET",
            "/api/v1/rooms/nonexistent-room-id",
            AuthMode::UserTokenAlice,
            404,
        ),
        (
            "unauthorized_me",
            "GET",
            "/api/v1/users/me",
            AuthMode::None,
            401,
        ),
        (
            "bad_request_room",
            "POST",
            "/api/v1/rooms/invalid-id/retention/preview",
            AuthMode::UserTokenAlice,
            400,
        ),
    ];

    let mut failures = Vec::new();

    for (name, method, uri, auth_mode, expected_status) in error_cases {
        let mut req_builder = Request::builder().method(method).uri(uri);

        match auth_mode {
            AuthMode::None => {}
            AuthMode::UserTokenAlice => {
                req_builder = req_builder.header(
                    header::AUTHORIZATION,
                    format!("Bearer {}", fixture.alice_token),
                );
            }
            AuthMode::BotToken => {
                req_builder = req_builder.header(
                    header::AUTHORIZATION,
                    format!("Bearer {}", fixture.bot_token),
                );
            }
        }

        let (body, content_type_header) = if method == "POST" {
            (
                Body::from(json!({ "invalid_field": true }).to_string()),
                true,
            )
        } else {
            (Body::empty(), false)
        };

        if content_type_header {
            req_builder = req_builder.header(header::CONTENT_TYPE, "application/json");
        }

        let req = req_builder.body(body).unwrap();
        let resp = fixture.app.clone().oneshot(req).await.unwrap();
        let status = resp.status();

        let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let body_json: Value = match serde_json::from_slice(&body_bytes) {
            Ok(v) => v,
            Err(e) => {
                failures.push(format!(
                    "[{}] Failed to parse JSON error response body for '{}': {}",
                    name, uri, e
                ));
                continue;
            }
        };

        if status.as_u16() != expected_status {
            panic!(
                "Error endpoint [{}] '{}' returned status {} expected {}, body: {}",
                name, uri, status, expected_status, body_json
            );
        }

        if let Err(err) = validate(&doc, &body_json, error_schema) {
            failures.push(format!(
                "Error endpoint [{}] path '{}' mismatch against ErrorResponse: {}",
                name, uri, err
            ));
        }
    }

    if !failures.is_empty() {
        panic!(
            "Contract error test schema validation failures ({}/{}):\n{}",
            failures.len(),
            3,
            failures.join("\n")
        );
    }
}
