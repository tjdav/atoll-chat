mod common;

use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use axum::Router;
use serde_json::{json, Value};
use server::openapi::ApiDoc;
use sqlx::SqlitePool;
use tower::ServiceExt;
use utoipa::OpenApi;

struct TestFixture {
    app: Router,
    _pool: SqlitePool,
    alice_token: String,
    alice_id: String,
    _bob_token: String,
    _bob_id: String,
    room_id: String,
    _message_id: String,
    bot_id: String,
    bot_token: String,
}

async fn setup_contract_test_fixture() -> TestFixture {
    let (app, pool) = common::setup_test_app().await;

    // 1. Create Alice user and session
    let (alice_token, alice_id) = common::create_test_user_and_session(&app, &pool).await;

    // Insert device for Alice so message submissions pass device check
    let client_id = "client_alice_1";
    sqlx::query(
        "INSERT INTO devices (id, user_id, client_id, platform, created_at) VALUES ('dev_alice', ?, ?, 'web', CURRENT_TIMESTAMP)",
    )
    .bind(&alice_id)
    .bind(client_id)
    .execute(&pool)
    .await
    .unwrap();

    // 2. Create Bob user and session
    let (bob_token, bob_id) = common::create_test_user_and_session(&app, &pool).await;

    // 3. Create Room (by Alice)
    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/rooms")
        .header(header::AUTHORIZATION, format!("Bearer {}", alice_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({ "name": "Contract Test Room" }).to_string(),
        ))
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED);
    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let room_json: Value = serde_json::from_slice(&body_bytes).unwrap();
    let room_id = room_json["id"].as_str().unwrap().to_string();

    // 4. Add Bob to Room
    sqlx::query("INSERT INTO room_members (room_id, user_id, role) VALUES (?, ?, 'member')")
        .bind(&room_id)
        .bind(&bob_id)
        .execute(&pool)
        .await
        .unwrap();

    // 5. Post Message in Room (by Alice)
    let req = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/messages", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", alice_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "sender_client_id": client_id,
                "epoch": 0,
                "content_type": "application",
                "ciphertext": "Y29udHJhY3RfdGVzdF9tZXNzYWdl",
                "transcript_hash": serde_json::Value::Null,
                "reply_to": serde_json::Value::Null,
                "target_user_ids": serde_json::Value::Null
            })
            .to_string(),
        ))
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    let status = resp.status();
    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    if status != StatusCode::CREATED {
        panic!(
            "Post message failed with status {}: {}",
            status,
            String::from_utf8_lossy(&body_bytes)
        );
    }
    let msg_json: Value = serde_json::from_slice(&body_bytes).unwrap();
    let message_id = msg_json["message_id"].as_str().unwrap().to_string();

    // 6. Create Bot (by Alice)
    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/bots")
        .header(header::AUTHORIZATION, format!("Bearer {}", alice_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "display_name": "Contract Bot",
                "bot_identity_pubkey": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
                "bot_command_pubkey": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
                "identity_pubkey": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
                "declared_scopes": ["post_message", "read_commands"]
            })
            .to_string(),
        ))
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    let status = resp.status();
    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    if status != StatusCode::CREATED {
        panic!(
            "Create bot failed with status {}: {}",
            status,
            String::from_utf8_lossy(&body_bytes)
        );
    }
    let bot_json: Value = serde_json::from_slice(&body_bytes).unwrap();
    let bot_id = bot_json["bot_id"].as_str().unwrap().to_string();
    let bot_token = bot_json["bot_token"].as_str().unwrap().to_string();

    // 7. Grant Bot to Room
    let req = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/rooms/{}/bots", room_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", alice_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "bot_id": bot_id,
                "scopes": ["post_message", "read_commands"],
                "operators": serde_json::Value::Null
            })
            .to_string(),
        ))
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    let status = resp.status();
    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    if status != StatusCode::CREATED {
        panic!(
            "Grant bot failed with status {}: {}",
            status,
            String::from_utf8_lossy(&body_bytes)
        );
    }

    // 8. Set Bot Setting (by Alice)
    let req = Request::builder()
        .method("PATCH")
        .uri(format!("/api/v1/users/me/bots/{}/settings/contract_key", bot_id))
        .header(header::AUTHORIZATION, format!("Bearer {}", alice_token))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "is_secret": false,
                "value_encrypted_bot": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
                "value_encrypted_client": "Y2xpZW50X3ZhbHVl"
            })
            .to_string(),
        ))
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    // 9. Insert KT Log Entry for Alice, and insert Snapshot
    sqlx::query(
        "INSERT INTO key_transparency_log (leaf_index, user_id, username_token, identity_pubkey, leaf_hash) VALUES ((SELECT COALESCE(MAX(leaf_index), 0) + 1 FROM key_transparency_log), ?, 'tok_alice', 'pk_alice', X'0000000000000000000000000000000000000000000000000000000000000000')",
    )
    .bind(&alice_id)
    .execute(&pool)
    .await
    .unwrap();

    let tree_size: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM key_transparency_log")
        .fetch_one(&pool)
        .await
        .unwrap();

    sqlx::query(
        "INSERT INTO key_transparency_snapshots (id, tree_size, root_hash, signature, created_at) VALUES ('snap_1', ?, X'0000000000000000000000000000000000000000000000000000000000000000', NULL, CURRENT_TIMESTAMP)",
    )
    .bind(tree_size)
    .execute(&pool)
    .await
    .unwrap();

    TestFixture {
        app,
        _pool: pool,
        alice_token,
        alice_id,
        _bob_token: bob_token,
        _bob_id: bob_id,
        room_id,
        _message_id: message_id,
        bot_id,
        bot_token,
    }
}

fn dereference_schema(doc: &Value, schema: &Value) -> Value {
    if let Some(ref_str) = schema.get("$ref").and_then(|r| r.as_str()) {
        if let Some(component_name) = ref_str.strip_prefix("#/components/schemas/") {
            if let Some(target) = doc["components"]["schemas"].get(component_name) {
                return dereference_schema(doc, target);
            }
        }
    }

    if let Some(obj) = schema.as_object() {
        let mut new_obj = serde_json::Map::new();
        for (k, v) in obj {
            if k == "properties" {
                if let Some(props) = v.as_object() {
                    let mut new_props = serde_json::Map::new();
                    for (pk, pv) in props {
                        new_props.insert(pk.clone(), dereference_schema(doc, pv));
                    }
                    new_obj.insert(k.clone(), Value::Object(new_props));
                } else {
                    new_obj.insert(k.clone(), dereference_schema(doc, v));
                }
            } else if k == "items" {
                new_obj.insert(k.clone(), dereference_schema(doc, v));
            } else if k == "allOf" || k == "oneOf" || k == "anyOf" {
                if let Some(arr) = v.as_array() {
                    let new_arr: Vec<Value> = arr
                        .iter()
                        .map(|item| dereference_schema(doc, item))
                        .collect();
                    new_obj.insert(k.clone(), Value::Array(new_arr));
                } else {
                    new_obj.insert(k.clone(), dereference_schema(doc, v));
                }
            } else {
                new_obj.insert(k.clone(), v.clone());
            }
        }
        return Value::Object(new_obj);
    }

    schema.clone()
}

fn extract_response_schema(doc: &Value, path: &str, method: &str, status: &str) -> Value {
    let method_obj = doc["paths"]
        .get(path)
        .and_then(|p| p.get(method))
        .unwrap_or_else(|| panic!("OpenAPI document missing operation {} {}", method, path));

    let resp_obj = method_obj["responses"].get(status).unwrap_or_else(|| {
        panic!(
            "OpenAPI operation {} {} missing status {}",
            method, path, status
        )
    });

    let raw_schema = resp_obj["content"]["application/json"]["schema"].clone();
    assert!(
        !raw_schema.is_null(),
        "OpenAPI operation {} {} status {} missing application/json schema",
        method,
        path,
        status
    );

    dereference_schema(doc, &raw_schema)
}

fn extract_error_schema(doc: &Value, path: &str, method: &str, status: &str) -> Value {
    let method_obj = doc["paths"].get(path).and_then(|p| p.get(method));

    if let Some(op) = method_obj {
        if let Some(resp) = op["responses"].get(status) {
            if let Some(schema) = resp
                .get("content")
                .and_then(|c| c.get("application/json"))
                .and_then(|j| j.get("schema"))
            {
                if !schema.is_null() {
                    return dereference_schema(doc, schema);
                }
            }
        }
    }

    // Fall back to ErrorResponse schema from components
    let err_schema = &doc["components"]["schemas"]["ErrorResponse"];
    assert!(
        !err_schema.is_null(),
        "ErrorResponse component schema missing from OpenAPI doc"
    );
    dereference_schema(doc, err_schema)
}

enum AuthType {
    None,
    UserAlice,
    BotToken,
}

struct EndpointDescriptor {
    name: &'static str,
    method: &'static str,
    openapi_path: &'static str,
    request_uri_builder: fn(&TestFixture) -> String,
    auth: AuthType,
    expected_status: StatusCode,
}

#[tokio::test]
async fn test_responses_match_openapi_schemas() {
    let fixture = setup_contract_test_fixture().await;
    let doc = ApiDoc::openapi();
    let doc_value = serde_json::to_value(&doc).expect("ApiDoc serializable to Value");

    let endpoints = vec![
        EndpointDescriptor {
            name: "GET /api/v1/capabilities",
            method: "get",
            openapi_path: "/api/v1/capabilities",
            request_uri_builder: |_| "/api/v1/capabilities".to_string(),
            auth: AuthType::None,
            expected_status: StatusCode::OK,
        },
        EndpointDescriptor {
            name: "GET /api/v1/users/me",
            method: "get",
            openapi_path: "/api/v1/users/me",
            request_uri_builder: |_| "/api/v1/users/me".to_string(),
            auth: AuthType::UserAlice,
            expected_status: StatusCode::OK,
        },
        EndpointDescriptor {
            name: "GET /api/v1/users/me/sync",
            method: "get",
            openapi_path: "/api/v1/users/me/sync",
            request_uri_builder: |_| "/api/v1/users/me/sync?since_seq=0".to_string(),
            auth: AuthType::UserAlice,
            expected_status: StatusCode::OK,
        },
        EndpointDescriptor {
            name: "GET /api/v1/rooms",
            method: "get",
            openapi_path: "/api/v1/rooms",
            request_uri_builder: |_| "/api/v1/rooms".to_string(),
            auth: AuthType::UserAlice,
            expected_status: StatusCode::OK,
        },
        EndpointDescriptor {
            name: "GET /api/v1/rooms/{id}",
            method: "get",
            openapi_path: "/api/v1/rooms/{id}",
            request_uri_builder: |fix| format!("/api/v1/rooms/{}", fix.room_id),
            auth: AuthType::UserAlice,
            expected_status: StatusCode::OK,
        },
        EndpointDescriptor {
            name: "GET /api/v1/rooms/{id}/members",
            method: "get",
            openapi_path: "/api/v1/rooms/{id}/members",
            request_uri_builder: |fix| format!("/api/v1/rooms/{}/members", fix.room_id),
            auth: AuthType::UserAlice,
            expected_status: StatusCode::OK,
        },
        EndpointDescriptor {
            name: "GET /api/v1/rooms/{id}/messages",
            method: "get",
            openapi_path: "/api/v1/rooms/{id}/messages",
            request_uri_builder: |fix| format!("/api/v1/rooms/{}/messages", fix.room_id),
            auth: AuthType::UserAlice,
            expected_status: StatusCode::OK,
        },
        EndpointDescriptor {
            name: "GET /api/v1/bots/{id}",
            method: "get",
            openapi_path: "/api/v1/bots/{id}",
            request_uri_builder: |fix| format!("/api/v1/bots/{}", fix.bot_id),
            auth: AuthType::UserAlice,
            expected_status: StatusCode::OK,
        },
        EndpointDescriptor {
            name: "GET /api/v1/bots/me/settings",
            method: "get",
            openapi_path: "/api/v1/bots/me/settings",
            request_uri_builder: |_| "/api/v1/bots/me/settings".to_string(),
            auth: AuthType::BotToken,
            expected_status: StatusCode::OK,
        },
        EndpointDescriptor {
            name: "GET /api/v1/kt/user/{id}",
            method: "get",
            openapi_path: "/api/v1/kt/user/{id}",
            request_uri_builder: |fix| format!("/api/v1/kt/user/{}", fix.alice_id),
            auth: AuthType::UserAlice,
            expected_status: StatusCode::OK,
        },
        EndpointDescriptor {
            name: "GET /api/v1/kt/bot/{id}",
            method: "get",
            openapi_path: "/api/v1/kt/bot/{id}",
            request_uri_builder: |fix| format!("/api/v1/kt/bot/{}", fix.bot_id),
            auth: AuthType::UserAlice,
            expected_status: StatusCode::OK,
        },
        EndpointDescriptor {
            name: "GET /api/v1/kt/snapshot",
            method: "get",
            openapi_path: "/api/v1/kt/snapshot",
            request_uri_builder: |_| "/api/v1/kt/snapshot".to_string(),
            auth: AuthType::UserAlice,
            expected_status: StatusCode::OK,
        },
    ];

    for ep in &endpoints {
        let uri = (ep.request_uri_builder)(&fixture);
        let mut req_builder = Request::builder()
            .method(ep.method.to_uppercase().as_str())
            .uri(&uri);

        match ep.auth {
            AuthType::None => {}
            AuthType::UserAlice => {
                req_builder = req_builder.header(
                    header::AUTHORIZATION,
                    format!("Bearer {}", fixture.alice_token),
                );
            }
            AuthType::BotToken => {
                req_builder = req_builder.header(
                    header::AUTHORIZATION,
                    format!("Bearer {}", fixture.bot_token),
                );
            }
        }

        let req = req_builder.body(Body::empty()).unwrap();
        let resp = fixture.app.clone().oneshot(req).await.unwrap();

        assert_eq!(
            resp.status(),
            ep.expected_status,
            "Endpoint {} expected status {} but got {}",
            ep.name,
            ep.expected_status,
            resp.status()
        );

        let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let body_json: Value = serde_json::from_slice(&body_bytes).unwrap_or_else(|e| {
            panic!(
                "Endpoint {} response body is not valid JSON: {}\nBody text: {}",
                ep.name,
                e,
                String::from_utf8_lossy(&body_bytes)
            )
        });

        let status_str = ep.expected_status.as_u16().to_string();
        let schema = extract_response_schema(&doc_value, ep.openapi_path, ep.method, &status_str);

        let validator = jsonschema::validator_for(&schema).unwrap_or_else(|e| {
            panic!(
                "Failed to compile JSON Schema for endpoint {}: {}",
                ep.name, e
            )
        });

        let errors: Vec<String> = validator
            .iter_errors(&body_json)
            .map(|e| e.to_string())
            .collect();
        if !errors.is_empty() {
            panic!(
                "Contract test validation failed for endpoint {}!\nPath: {}\nValidation Errors:\n  - {}",
                ep.name,
                ep.openapi_path,
                errors.join("\n  - ")
            );
        }
    }
}

#[tokio::test]
async fn test_error_responses_match_openapi_schemas() {
    let fixture = setup_contract_test_fixture().await;
    let doc = ApiDoc::openapi();
    let doc_value = serde_json::to_value(&doc).expect("ApiDoc serializable to Value");

    struct ErrorEndpointDescriptor {
        name: &'static str,
        method: &'static str,
        openapi_path: &'static str,
        uri: &'static str,
        auth_header: Option<String>,
        expected_status: StatusCode,
    }

    let error_endpoints = vec![
        ErrorEndpointDescriptor {
            name: "GET /users/me unauthorized (401)",
            method: "get",
            openapi_path: "/api/v1/users/me",
            uri: "/api/v1/users/me",
            auth_header: None,
            expected_status: StatusCode::UNAUTHORIZED,
        },
        ErrorEndpointDescriptor {
            name: "GET /rooms/{id} non-existent room (404)",
            method: "get",
            openapi_path: "/api/v1/rooms/{id}",
            uri: "/api/v1/rooms/room_non_existent_id",
            auth_header: Some(format!("Bearer {}", fixture.alice_token)),
            expected_status: StatusCode::NOT_FOUND,
        },
        ErrorEndpointDescriptor {
            name: "GET /bots/{id} non-existent bot (404)",
            method: "get",
            openapi_path: "/api/v1/bots/{id}",
            uri: "/api/v1/bots/b_non_existent_id",
            auth_header: Some(format!("Bearer {}", fixture.alice_token)),
            expected_status: StatusCode::NOT_FOUND,
        },
    ];

    for ep in &error_endpoints {
        let mut req_builder = Request::builder()
            .method(ep.method.to_uppercase().as_str())
            .uri(ep.uri);

        if let Some(ref auth) = ep.auth_header {
            req_builder = req_builder.header(header::AUTHORIZATION, auth);
        }

        let req = req_builder.body(Body::empty()).unwrap();
        let resp = fixture.app.clone().oneshot(req).await.unwrap();

        assert_eq!(
            resp.status(),
            ep.expected_status,
            "Error test {} expected status {} but got {}",
            ep.name,
            ep.expected_status,
            resp.status()
        );

        let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let body_json: Value = serde_json::from_slice(&body_bytes).unwrap_or_else(|e| {
            panic!(
                "Error test {} response body is not valid JSON: {}\nBody: {}",
                ep.name,
                e,
                String::from_utf8_lossy(&body_bytes)
            )
        });

        let status_str = ep.expected_status.as_u16().to_string();
        let schema = extract_error_schema(&doc_value, ep.openapi_path, ep.method, &status_str);

        let validator = jsonschema::validator_for(&schema).unwrap_or_else(|e| {
            panic!("Failed to compile error JSON Schema for {}: {}", ep.name, e)
        });

        let errors: Vec<String> = validator
            .iter_errors(&body_json)
            .map(|e| e.to_string())
            .collect();
        if !errors.is_empty() {
            panic!(
                "Error response contract validation failed for {}!\nPath: {}\nValidation Errors:\n  - {}",
                ep.name,
                ep.openapi_path,
                errors.join("\n  - ")
            );
        }
    }
}

#[tokio::test]
async fn test_intentional_drift_sanity_check() {
    let fixture = setup_contract_test_fixture().await;
    let doc = ApiDoc::openapi();
    let mut doc_value = serde_json::to_value(&doc).expect("ApiDoc serializable to Value");

    // Fetch actual GET /api/v1/capabilities response
    let req = Request::builder()
        .method("GET")
        .uri("/api/v1/capabilities")
        .body(Body::empty())
        .unwrap();

    let resp = fixture.app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let body_json: Value = serde_json::from_slice(&body_bytes).unwrap();

    // 1. Valid original schema check
    let schema = extract_response_schema(&doc_value, "/api/v1/capabilities", "get", "200");
    let validator = jsonschema::validator_for(&schema).unwrap();
    let errors: Vec<String> = validator
        .iter_errors(&body_json)
        .map(|e| e.to_string())
        .collect();
    assert!(
        errors.is_empty(),
        "Capabilities response must pass original schema validation: {:?}",
        errors
    );

    // 2. Introduce artificial drift into the test-local OpenAPI doc:
    // Declare a mandatory field "non_existent_required_field" in CapabilitiesResponse schema that runtime does NOT produce
    if let Some(caps_schema) = doc_value["components"]["schemas"].get_mut("CapabilitiesResponse") {
        if let Some(req_arr) = caps_schema["required"].as_array_mut() {
            req_arr.push(json!("non_existent_required_field"));
        }
        if let Some(props_obj) = caps_schema["properties"].as_object_mut() {
            props_obj.insert(
                "non_existent_required_field".to_string(),
                json!({ "type": "string" }),
            );
        }
    }

    // 3. Verify validation now FAILS due to missing required field
    let modified_schema = extract_response_schema(&doc_value, "/api/v1/capabilities", "get", "200");
    let validator_drift = jsonschema::validator_for(&modified_schema).unwrap();

    let drift_errors: Vec<String> = validator_drift
        .iter_errors(&body_json)
        .map(|e| e.to_string())
        .collect();
    assert!(
        !drift_errors.is_empty(),
        "Sanity check failed: validation should have detected missing required field drift"
    );
}
