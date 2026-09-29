use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use axum::Router;
use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use base64::Engine;
use opaque_ke::{
    ClientLogin, ClientLoginFinishParameters, ClientRegistration,
    ClientRegistrationFinishParameters, CredentialResponse, RegistrationResponse,
};
use rand::rngs::OsRng;
use serde_json::{json, Value};
use server::altcha::AltchaConfig;
use server::config::Config;
use server::login::LoginStore;
use server::opaque::{DefaultCipherSuite, OpaqueServer};
use server::registration::RegistrationStore;
use server::AppState;
use sqlx::{sqlite::SqlitePoolOptions, SqlitePool};
use std::sync::Arc;
use tower::ServiceExt;

pub async fn setup_test_db() -> SqlitePool {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .expect("Failed to connect to in-memory DB");

    sqlx::migrate!()
        .run(&pool)
        .await
        .expect("Failed to run migrations on test DB");

    pool
}

#[allow(dead_code)]
pub async fn setup_test_app() -> (Router, SqlitePool) {
    let (app, pool, _) = setup_test_app_with_config(true, "auto", 100).await;
    (app, pool)
}

#[allow(dead_code)]
pub async fn setup_test_app_with_config(
    enabled: bool,
    hmac_secret: &str,
    cost: u32,
) -> (Router, SqlitePool, Arc<AltchaConfig>) {
    let pool = setup_test_db().await;

    let temp_dir = tempfile::tempdir().expect("Failed to create tempdir");
    let key_path = temp_dir.path().join("oprf.key");
    let opaque_server =
        Arc::new(OpaqueServer::load_or_generate(&key_path).expect("Failed to create OpaqueServer"));
    let registration_store = Arc::new(RegistrationStore::new());
    let login_store = Arc::new(LoginStore::new());

    let config = Config {
        opaque_oprf_key_path: key_path.to_str().unwrap().to_string(),
        altcha_enabled: enabled,
        altcha_hmac_secret: hmac_secret.to_string(),
        altcha_cost: cost,
        cleanup_enabled: true,
        cleanup_startup_delay_secs: 30,
        ..Config::test_default()
    };

    let altcha_config = Arc::new(
        AltchaConfig::from_env(&config, &pool)
            .await
            .expect("Failed to init AltchaConfig"),
    );

    let config_arc = Arc::new(config);

    let server_hard_max = Arc::new(server::ServerHardMax {
        file_size_bytes: config_arc.max_file_size_bytes as i64,
        room_size: 1000,
        rooms_per_user: 500,
        devices_per_user: config_arc.server_max_devices_per_user as i64,
        keypackages_per_device: 50,
        message_size_bytes: 65536,
        attachment_retention_days: 365,
        call_max_participants: 50,
    });

    let sockudo_config = server::SockudoConfig {
        http_base: "http://localhost:6001".to_string(),
        app_id: "chat".to_string(),
        app_key: "test-key".to_string(),
        app_secret: "test-secret".to_string(),
        enable_client_events: true,
    };
    let publisher = Arc::new(server::Publisher::new(sockudo_config));

    let state = AppState {
        pool: pool.clone(),
        opaque_server,
        registration_store,
        login_store,
        altcha_config: altcha_config.clone(),
        config: config_arc,
        server_hard_max,
        publisher,
    };

    let app = server::build_app(state);

    (app, pool, altcha_config)
}

#[allow(dead_code)]
pub fn solve_test_challenge(challenge: &altcha::Challenge) -> String {
    let solution = altcha::solve_challenge(altcha::SolveChallengeOptions::new(challenge))
        .expect("solve should not fail")
        .expect("solution should be found");
    let payload = altcha::Payload {
        challenge: challenge.clone(),
        solution,
    };
    let json = serde_json::to_string(&payload).unwrap();
    STANDARD.encode(json)
}

#[allow(dead_code)]
pub async fn fetch_and_solve_altcha(app: &Router) -> String {
    let req = Request::builder()
        .method("GET")
        .uri("/api/v1/auth/register/challenge")
        .body(Body::empty())
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let challenge: altcha::Challenge = serde_json::from_slice(&body_bytes).unwrap();
    solve_test_challenge(&challenge)
}

#[allow(dead_code)]
pub async fn register_user(
    app: &Router,
    username: &str,
    password: &str,
    invite_code: Option<&str>,
) -> String {
    let altcha1 = fetch_and_solve_altcha(app).await;

    let mut rng = OsRng;
    let client_start =
        ClientRegistration::<DefaultCipherSuite>::start(&mut rng, password.as_bytes())
            .expect("ClientRegistration::start failed");

    let reg_req_b64 = STANDARD.encode(client_start.message.serialize());

    let req1 = Request::builder()
        .method("POST")
        .uri("/api/v1/auth/register/start")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "username": username,
                "registration_request": reg_req_b64,
                "altcha": altcha1,
            })
            .to_string(),
        ))
        .unwrap();

    let resp1 = app.clone().oneshot(req1).await.unwrap();
    assert_eq!(resp1.status(), StatusCode::OK);
    let body_bytes1 = axum::body::to_bytes(resp1.into_body(), usize::MAX)
        .await
        .unwrap();
    let json1: Value = serde_json::from_slice(&body_bytes1).unwrap();

    let reg_id = json1["registration_id"].as_str().unwrap();
    let reg_resp_b64 = json1["registration_response"].as_str().unwrap();

    let reg_resp_bytes = STANDARD
        .decode(reg_resp_b64)
        .or_else(|_| URL_SAFE_NO_PAD.decode(reg_resp_b64))
        .unwrap();
    let reg_resp = RegistrationResponse::<DefaultCipherSuite>::deserialize(&reg_resp_bytes)
        .expect("failed to deserialize registration response");

    let client_finish = client_start
        .state
        .finish(
            &mut rng,
            password.as_bytes(),
            reg_resp,
            ClientRegistrationFinishParameters::default(),
        )
        .expect("ClientRegistration::finish failed");

    let upload_b64 = STANDARD.encode(client_finish.message.serialize());

    let altcha2 = fetch_and_solve_altcha(app).await;

    let req2 = Request::builder()
        .method("POST")
        .uri("/api/v1/auth/register/finish")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "registration_id": reg_id,
                "registration_upload": upload_b64,
                "invite_code": invite_code,
                "altcha": altcha2,
            })
            .to_string(),
        ))
        .unwrap();

    let resp2 = app.clone().oneshot(req2).await.unwrap();
    assert_eq!(resp2.status(), StatusCode::OK);
    let body_bytes2 = axum::body::to_bytes(resp2.into_body(), usize::MAX)
        .await
        .unwrap();
    let json2: Value = serde_json::from_slice(&body_bytes2).unwrap();

    json2["user_id"].as_str().unwrap().to_string()
}

#[allow(dead_code)]
pub async fn login_user(
    app: &Router,
    username: &str,
    password: &str,
    client_id: &str,
    identity_pubkey: Option<&str>,
) -> (StatusCode, Value) {
    login_user_with_device_name(app, username, password, client_id, identity_pubkey, None).await
}

#[allow(dead_code)]
pub async fn login_user_with_device_name(
    app: &Router,
    username: &str,
    password: &str,
    client_id: &str,
    identity_pubkey: Option<&str>,
    device_name: Option<&str>,
) -> (StatusCode, Value) {
    let mut rng = OsRng;
    let client_start = ClientLogin::<DefaultCipherSuite>::start(&mut rng, password.as_bytes())
        .expect("ClientLogin::start failed");

    let cred_req_b64 = STANDARD.encode(client_start.message.serialize());

    let req1 = Request::builder()
        .method("POST")
        .uri("/api/v1/auth/login/start")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "username": username,
                "credential_request": cred_req_b64,
                "client_id": client_id,
            })
            .to_string(),
        ))
        .unwrap();

    let resp1 = app.clone().oneshot(req1).await.unwrap();
    let status1 = resp1.status();
    let body_bytes1 = axum::body::to_bytes(resp1.into_body(), usize::MAX)
        .await
        .unwrap();
    let json1: Value = serde_json::from_slice(&body_bytes1).unwrap_or(json!({}));

    if status1 != StatusCode::OK {
        return (status1, json1);
    }

    let login_id = json1["login_id"].as_str().unwrap();
    let cred_resp_b64 = json1["credential_response"].as_str().unwrap();

    let cred_resp_bytes = STANDARD
        .decode(cred_resp_b64)
        .or_else(|_| URL_SAFE_NO_PAD.decode(cred_resp_b64))
        .unwrap();
    let cred_resp = CredentialResponse::<DefaultCipherSuite>::deserialize(&cred_resp_bytes)
        .expect("failed to deserialize credential_response");

    let client_finish_res = client_start.state.finish(
        &mut rng,
        password.as_bytes(),
        cred_resp,
        ClientLoginFinishParameters::default(),
    );

    let client_finish = match client_finish_res {
        Ok(cf) => cf,
        Err(_) => {
            // Client finish failed (e.g. wrong password)
            // Send invalid finalization message to server
            let dummy_finalization = STANDARD.encode([0u8; 32]);
            let req2 = Request::builder()
                .method("POST")
                .uri("/api/v1/auth/login/finish")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    json!({
                        "login_id": login_id,
                        "credential_finalization": dummy_finalization,
                        "identity_pubkey": identity_pubkey,
                        "device_name": device_name,
                    })
                    .to_string(),
                ))
                .unwrap();

            let resp2 = app.clone().oneshot(req2).await.unwrap();
            let status2 = resp2.status();
            let body_bytes2 = axum::body::to_bytes(resp2.into_body(), usize::MAX)
                .await
                .unwrap();
            let json2: Value = serde_json::from_slice(&body_bytes2).unwrap_or(json!({}));
            return (status2, json2);
        }
    };

    let cred_fin_b64 = STANDARD.encode(client_finish.message.serialize());

    let req2 = Request::builder()
        .method("POST")
        .uri("/api/v1/auth/login/finish")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({
                "login_id": login_id,
                "credential_finalization": cred_fin_b64,
                "identity_pubkey": identity_pubkey,
                "device_name": device_name,
            })
            .to_string(),
        ))
        .unwrap();

    let resp2 = app.clone().oneshot(req2).await.unwrap();
    let status2 = resp2.status();
    let body_bytes2 = axum::body::to_bytes(resp2.into_body(), usize::MAX)
        .await
        .unwrap();
    let json2: Value = serde_json::from_slice(&body_bytes2).unwrap_or(json!({}));

    (status2, json2)
}
