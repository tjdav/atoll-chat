use axum::body::Body;
use axum::http::{Request, StatusCode};
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use rand::rngs::OsRng;
use serde_json::{json, Value};
use server::config::Config;
use server::oprf::OprfKeys;
use server::AppState;
use std::sync::Arc;
use tower::ServiceExt;
use voprf::{OprfClient, Ristretto255};

async fn setup_test_app(config_override: impl FnOnce(&mut Config)) -> (axum::Router, AppState) {
    let mut config = Config::test_default();
    config_override(&mut config);
    let pool = sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap();
    sqlx::migrate!().run(&pool).await.unwrap();

    let setup = opaque_ke::ServerSetup::<server::DefaultCipherSuite>::new(&mut OsRng);
    let opaque_server = Arc::new(server::opaque::OpaqueServer { setup });

    let oprf_keys = OprfKeys::load(&opaque_server.setup).unwrap();
    let oprf_evaluator = Arc::new(server::oprf::OprfEvaluator::new(&oprf_keys));
    let oprf_audit = Arc::new(server::oprf::OprfAuditCounter::new());

    let config_arc = Arc::new(config);
    let storage = server::build_storage(&config_arc).expect("Failed to build storage");

    let session_types_state = server::sessions::init_session_types_state(
        config_arc.sessions_enabled,
        &config_arc.session_types_config_path,
        config_arc.server_max_session_participants,
        config_arc.server_max_sessions_per_room,
    );
    let session_types = Arc::new(server::sessions::SessionTypesStore::new(
        session_types_state,
    ));

    let state = AppState {
        pool,
        opaque_server,
        registration_store: Arc::new(server::registration::RegistrationStore::new()),
        login_store: Arc::new(server::login::LoginStore::new()),
        recovery_store: Arc::new(server::recovery::RecoveryStore::new()),
        altcha_config: Arc::new(server::AltchaConfig {
            enabled: false,
            hmac_secret: "auto".to_string(),
            algorithm: "PBKDF2/SHA-256".into(),
            cost: 100,
        }),
        config: config_arc.clone(),
        server_hard_max: Arc::new(server::ServerHardMax {
            file_size_bytes: 104_857_600,
            room_size: 1000,
            rooms_per_user: 500,
            devices_per_user: 20,
            keypackages_per_device: 50,
            message_size_bytes: 65536,
            attachment_retention_days: 365,
            call_max_participants: 50,
            reactions_per_message: 50,
        }),
        publisher: Arc::new(server::Publisher::new(server::SockudoConfig {
            http_base: "http://localhost:6001".into(),
            app_id: "chat".into(),
            app_key: "key".into(),
            app_secret: "secret".into(),
            enable_client_events: true,
        })),
        storage,
        backup_lock: Arc::new(tokio::sync::Mutex::new(())),
        oprf_rotation_lock: Arc::new(tokio::sync::Mutex::new(())),
        vapid_keys: None,
        push_delivery: None,
        oprf: oprf_evaluator,
        oprf_audit,
        link_preview_keys: None,
        session_types,
        models: std::sync::Arc::new(server::models::ModelStore::new(
            std::path::PathBuf::from("/tmp/stt"),
            std::path::PathBuf::from("/tmp/tts"),
        )),
    };

    let app = server::build_app(state.clone());
    (app, state)
}

fn generate_blinded_b64(input: &[u8]) -> String {
    let blind_result = OprfClient::<Ristretto255>::blind(input, &mut OsRng).unwrap();
    STANDARD.encode(blind_result.message.serialize())
}

#[tokio::test]
async fn test_1_valid_blind_request_succeeds() {
    let (app, _) = setup_test_app(|_| {}).await;
    let blinded_b64 = generate_blinded_b64(b"alice");

    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/oprf/blind")
        .header("Content-Type", "application/json")
        .body(Body::from(json!({ "blinded": blinded_b64 }).to_string()))
        .unwrap();

    let res = app.oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);

    let body_bytes = axum::body::to_bytes(res.into_body(), usize::MAX)
        .await
        .unwrap();
    let body_json: Value = serde_json::from_slice(&body_bytes).unwrap();

    let evaluated_str = body_json["evaluated"]
        .as_str()
        .expect("evaluated field present");
    let decoded = STANDARD.decode(evaluated_str).expect("valid base64");
    assert_eq!(decoded.len(), 32);
}

#[tokio::test]
async fn test_2_evaluation_is_deterministic() {
    let (app, _) = setup_test_app(|_| {}).await;
    let blinded_b64 = generate_blinded_b64(b"bob");

    let req1 = Request::builder()
        .method("POST")
        .uri("/api/v1/oprf/blind")
        .header("Content-Type", "application/json")
        .body(Body::from(json!({ "blinded": blinded_b64 }).to_string()))
        .unwrap();

    let res1 = app.clone().oneshot(req1).await.unwrap();
    let bytes1 = axum::body::to_bytes(res1.into_body(), usize::MAX)
        .await
        .unwrap();
    let json1: Value = serde_json::from_slice(&bytes1).unwrap();

    let req2 = Request::builder()
        .method("POST")
        .uri("/api/v1/oprf/blind")
        .header("Content-Type", "application/json")
        .body(Body::from(json!({ "blinded": blinded_b64 }).to_string()))
        .unwrap();

    let res2 = app.oneshot(req2).await.unwrap();
    let bytes2 = axum::body::to_bytes(res2.into_body(), usize::MAX)
        .await
        .unwrap();
    let json2: Value = serde_json::from_slice(&bytes2).unwrap();

    assert_eq!(json1["evaluated"], json2["evaluated"]);
}

#[tokio::test]
async fn test_3_different_inputs_produce_different_outputs() {
    let (app, _) = setup_test_app(|_| {}).await;
    let blinded1 = generate_blinded_b64(b"user_one");
    let blinded2 = generate_blinded_b64(b"user_two");

    let req1 = Request::builder()
        .method("POST")
        .uri("/api/v1/oprf/blind")
        .header("Content-Type", "application/json")
        .body(Body::from(json!({ "blinded": blinded1 }).to_string()))
        .unwrap();

    let res1 = app.clone().oneshot(req1).await.unwrap();
    let bytes1 = axum::body::to_bytes(res1.into_body(), usize::MAX)
        .await
        .unwrap();
    let json1: Value = serde_json::from_slice(&bytes1).unwrap();

    let req2 = Request::builder()
        .method("POST")
        .uri("/api/v1/oprf/blind")
        .header("Content-Type", "application/json")
        .body(Body::from(json!({ "blinded": blinded2 }).to_string()))
        .unwrap();

    let res2 = app.oneshot(req2).await.unwrap();
    let bytes2 = axum::body::to_bytes(res2.into_body(), usize::MAX)
        .await
        .unwrap();
    let json2: Value = serde_json::from_slice(&bytes2).unwrap();

    assert_ne!(json1["evaluated"], json2["evaluated"]);
}

#[tokio::test]
async fn test_4_missing_blinded_returns_400() {
    let (app, _) = setup_test_app(|_| {}).await;

    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/oprf/blind")
        .header("Content-Type", "application/json")
        .body(Body::from("{}"))
        .unwrap();

    let res = app.oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);

    let bytes = axum::body::to_bytes(res.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_val: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(json_val["error"], "missing_field");
    assert_eq!(json_val["details"]["field"], "blinded");
}

#[tokio::test]
async fn test_5_invalid_base64_returns_400() {
    let (app, _) = setup_test_app(|_| {}).await;

    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/oprf/blind")
        .header("Content-Type", "application/json")
        .body(Body::from(
            json!({ "blinded": "not-base64!!!" }).to_string(),
        ))
        .unwrap();

    let res = app.oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);

    let bytes = axum::body::to_bytes(res.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_val: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(json_val["error"], "invalid_blinded");
}

#[tokio::test]
async fn test_6_wrong_byte_length_returns_400() {
    let (app, _) = setup_test_app(|_| {}).await;
    let short_b64 = STANDARD.encode([0u8; 16]);

    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/oprf/blind")
        .header("Content-Type", "application/json")
        .body(Body::from(json!({ "blinded": short_b64 }).to_string()))
        .unwrap();

    let res = app.oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);

    let bytes = axum::body::to_bytes(res.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_val: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(json_val["error"], "invalid_blinded");
}

#[tokio::test]
async fn test_7_invalid_point_returns_400() {
    let (app, _) = setup_test_app(|_| {}).await;
    let zero_point_b64 = STANDARD.encode([0u8; 32]);

    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/oprf/blind")
        .header("Content-Type", "application/json")
        .body(Body::from(json!({ "blinded": zero_point_b64 }).to_string()))
        .unwrap();

    let res = app.oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);

    let bytes = axum::body::to_bytes(res.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_val: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(json_val["error"], "invalid_blinded");
}

#[tokio::test]
async fn test_8_and_9_endpoint_does_not_log_body_or_ip() {
    use std::sync::{Arc as StdArc, Mutex as StdMutex};

    #[derive(Clone, Default)]
    struct LogWriter(StdArc<StdMutex<Vec<u8>>>);
    impl std::io::Write for LogWriter {
        fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
            self.0.lock().unwrap().extend_from_slice(buf);
            Ok(buf.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    let logs = LogWriter::default();
    let logs_clone = logs.clone();

    let subscriber = tracing_subscriber::fmt::Subscriber::builder()
        .with_writer(move || logs_clone.clone())
        .finish();

    let _guard = tracing::subscriber::set_default(subscriber);

    let (app, _) = setup_test_app(|c| {
        c.trust_proxy = true;
    })
    .await;

    let secret_blinded = generate_blinded_b64(b"secret_username_privacy");
    let test_ip = "203.0.113.195";

    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/oprf/blind")
        .header("Content-Type", "application/json")
        .header("X-Forwarded-For", test_ip)
        .body(Body::from(json!({ "blinded": secret_blinded }).to_string()))
        .unwrap();

    let res = app.oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);

    let captured_log = String::from_utf8(logs.0.lock().unwrap().clone()).unwrap();

    assert!(
        !captured_log.contains(&secret_blinded),
        "FAIL: blinded body was logged: {}",
        captured_log
    );
    assert!(
        !captured_log.contains(test_ip),
        "FAIL: client IP was logged: {}",
        captured_log
    );
}

#[tokio::test]
async fn test_10_and_11_counter_increments_and_flush_writes_single_row() {
    let (app, state) = setup_test_app(|_| {}).await;
    let blinded = generate_blinded_b64(b"test_counter");

    for _ in 0..3 {
        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/oprf/blind")
            .header("Content-Type", "application/json")
            .body(Body::from(json!({ "blinded": blinded }).to_string()))
            .unwrap();
        let res = app.clone().oneshot(req).await.unwrap();
        assert_eq!(res.status(), StatusCode::OK);
    }

    assert_eq!(state.oprf_audit.counter(), 3);

    state.oprf_audit.set_last_flush_elapsed_secs(3601);

    state.oprf_audit.maybe_flush(&state.pool).await.unwrap();

    let row: (String, String) = sqlx::query_as("SELECT id, event FROM oprf_audit")
        .fetch_one(&state.pool)
        .await
        .unwrap();

    assert!(row.1.contains("blind_eval_hourly:count=3"));

    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM oprf_audit")
        .fetch_one(&state.pool)
        .await
        .unwrap();

    assert_eq!(count, 1);
}

#[tokio::test]
async fn test_12_rate_limit_per_minute() {
    let (app, _) = setup_test_app(|c| {
        c.rate_limits.oprf_blind_per_min = 2;
    })
    .await;
    let blinded = generate_blinded_b64(b"rl_min");

    for _ in 0..2 {
        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/oprf/blind")
            .header("Content-Type", "application/json")
            .body(Body::from(json!({ "blinded": blinded }).to_string()))
            .unwrap();
        let res = app.clone().oneshot(req).await.unwrap();
        assert_eq!(res.status(), StatusCode::OK);
    }

    let req3 = Request::builder()
        .method("POST")
        .uri("/api/v1/oprf/blind")
        .header("Content-Type", "application/json")
        .body(Body::from(json!({ "blinded": blinded }).to_string()))
        .unwrap();
    let res3 = app.oneshot(req3).await.unwrap();
    assert_eq!(res3.status(), StatusCode::TOO_MANY_REQUESTS);
}

#[tokio::test]
async fn test_13_rate_limit_per_hour() {
    let (app, _) = setup_test_app(|c| {
        c.rate_limits.oprf_blind_per_min = 100;
        c.rate_limits.oprf_blind_per_hour = 3;
    })
    .await;
    let blinded = generate_blinded_b64(b"rl_hour");

    for _ in 0..3 {
        let req = Request::builder()
            .method("POST")
            .uri("/api/v1/oprf/blind")
            .header("Content-Type", "application/json")
            .body(Body::from(json!({ "blinded": blinded }).to_string()))
            .unwrap();
        let res = app.clone().oneshot(req).await.unwrap();
        assert_eq!(res.status(), StatusCode::OK);
    }

    let req4 = Request::builder()
        .method("POST")
        .uri("/api/v1/oprf/blind")
        .header("Content-Type", "application/json")
        .body(Body::from(json!({ "blinded": blinded }).to_string()))
        .unwrap();
    let res4 = app.oneshot(req4).await.unwrap();
    assert_eq!(res4.status(), StatusCode::TOO_MANY_REQUESTS);
}

#[tokio::test]
async fn test_14_rate_limit_is_per_ip() {
    let (app, _) = setup_test_app(|c| {
        c.trust_proxy = true;
        c.rate_limits.oprf_blind_per_min = 1;
    })
    .await;
    let blinded = generate_blinded_b64(b"rl_ip");

    let req1 = Request::builder()
        .method("POST")
        .uri("/api/v1/oprf/blind")
        .header("Content-Type", "application/json")
        .header("X-Forwarded-For", "192.0.2.1")
        .body(Body::from(json!({ "blinded": blinded }).to_string()))
        .unwrap();
    let res1 = app.clone().oneshot(req1).await.unwrap();
    assert_eq!(res1.status(), StatusCode::OK);

    let req2 = Request::builder()
        .method("POST")
        .uri("/api/v1/oprf/blind")
        .header("Content-Type", "application/json")
        .header("X-Forwarded-For", "192.0.2.1")
        .body(Body::from(json!({ "blinded": blinded }).to_string()))
        .unwrap();
    let res2 = app.clone().oneshot(req2).await.unwrap();
    assert_eq!(res2.status(), StatusCode::TOO_MANY_REQUESTS);

    let req3 = Request::builder()
        .method("POST")
        .uri("/api/v1/oprf/blind")
        .header("Content-Type", "application/json")
        .header("X-Forwarded-For", "192.0.2.2")
        .body(Body::from(json!({ "blinded": blinded }).to_string()))
        .unwrap();
    let res3 = app.oneshot(req3).await.unwrap();
    assert_eq!(res3.status(), StatusCode::OK);
}

#[tokio::test]
async fn test_15_endpoint_returns_501_when_disabled() {
    let (app, _) = setup_test_app(|c| {
        c.username_oprf_enabled = false;
    })
    .await;
    let blinded = generate_blinded_b64(b"disabled");

    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/oprf/blind")
        .header("Content-Type", "application/json")
        .body(Body::from(json!({ "blinded": blinded }).to_string()))
        .unwrap();

    let res = app.oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::NOT_IMPLEMENTED);

    let bytes = axum::body::to_bytes(res.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_val: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(json_val["error"], "oprf_disabled");
}

#[tokio::test]
async fn test_16_capabilities_advertises_oprf() {
    let (app, _) = setup_test_app(|_| {}).await;

    let req = Request::builder()
        .method("GET")
        .uri("/api/v1/capabilities")
        .body(Body::empty())
        .unwrap();

    let res = app.oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);

    let bytes = axum::body::to_bytes(res.into_body(), usize::MAX)
        .await
        .unwrap();
    let json_val: Value = serde_json::from_slice(&bytes).unwrap();

    assert_eq!(json_val["username_oprf_enabled"], true);
    assert_eq!(json_val["oprf_suite"], "ristretto255-sha512");
}

#[tokio::test]
async fn test_17_full_round_trip_with_voprf_client() {
    let (app, state) = setup_test_app(|_| {}).await;
    let username = b"alice_test_roundtrip";

    let mut client_rng = OsRng;
    let blind_result = OprfClient::<Ristretto255>::blind(username, &mut client_rng).unwrap();
    let blinded_b64 = STANDARD.encode(blind_result.message.serialize());

    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/oprf/blind")
        .header("Content-Type", "application/json")
        .body(Body::from(json!({ "blinded": blinded_b64 }).to_string()))
        .unwrap();

    let res = app.oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);

    let bytes = axum::body::to_bytes(res.into_body(), usize::MAX)
        .await
        .unwrap();
    let response_json: Value = serde_json::from_slice(&bytes).unwrap();

    let eval_b64 = response_json["evaluated"].as_str().unwrap();
    let eval_bytes = STANDARD.decode(eval_b64).unwrap();
    let eval_element = voprf::EvaluationElement::<Ristretto255>::deserialize(&eval_bytes).unwrap();

    let client_token = blind_result
        .state
        .finalize(username, &eval_element)
        .unwrap();

    // Verify token matches server-side direct evaluation with state.oprf keys
    let manual_keys = OprfKeys::load(&state.opaque_server.setup).unwrap();
    let manual_deserialized_blinded =
        voprf::BlindedElement::<Ristretto255>::deserialize(&STANDARD.decode(&blinded_b64).unwrap())
            .unwrap();
    let direct_eval_element = manual_keys
        .username_server
        .blind_evaluate(&manual_deserialized_blinded);

    let server_side_token = blind_result
        .state
        .finalize(username, &direct_eval_element)
        .unwrap();

    assert_eq!(client_token.as_slice(), server_side_token.as_slice());
    assert_eq!(client_token.len(), 64);
}
