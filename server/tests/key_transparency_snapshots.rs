use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use ed25519_dalek::{Signature, Verifier};
use server::audit::{action, AuditFilter};
use server::config::Config;
use server::db;
use server::key_transparency::signing::KeyTransparencyKeys;
use server::opaque::OpaqueServer;
use server::roles;
use server::sockudo::{Publisher, SockudoConfig};
use server::AppState;
use std::path::Path;
use std::sync::Arc;
use tempfile::tempdir;
use tokio::sync::Mutex;

static TEST_MUTEX: Mutex<()> = Mutex::const_new(());

struct TestEnv {
    state: AppState,
    _dir: tempfile::TempDir,
}

async fn setup_test_app() -> TestEnv {
    let dir = tempdir().unwrap();
    let db_path = dir.path().join("test.db");
    let oprf_key_path = dir.path().join("oprf.key");
    let storage_dir = dir.path().join("storage");

    std::env::set_var("APP_ENV", "development");
    std::env::set_var("DATABASE_URL", format!("sqlite:{}", db_path.display()));
    std::env::set_var("DB_PATH", db_path.to_str().unwrap());
    std::env::set_var("STORAGE_FS_PATH", storage_dir.to_str().unwrap());
    std::env::set_var("KEY_TRANSPARENCY_ENABLED", "true");
    std::env::set_var("OPAQUE_OPRF_KEY_PATH", oprf_key_path.to_str().unwrap());

    let mut config = Config::from_env().unwrap();
    config.key_transparency_enabled = true;
    config.opaque_oprf_key_path = oprf_key_path.to_str().unwrap().to_string();

    let pool = db::init_pool(&config).await.unwrap();
    let opaque_server =
        Arc::new(OpaqueServer::load_or_generate(Path::new(&config.opaque_oprf_key_path)).unwrap());
    let sockudo_config = SockudoConfig::load_or_initialize(&pool, &config)
        .await
        .unwrap();
    let publisher = Arc::new(Publisher::new(sockudo_config));

    let storage = server::build_storage(&config).unwrap();
    let registration_store = Arc::new(server::registration::RegistrationStore::new());
    let login_store = Arc::new(server::login::LoginStore::new());
    let recovery_store = Arc::new(server::recovery::RecoveryStore::new());
    let altcha_config = Arc::new(
        server::altcha::AltchaConfig::from_env(&config, &pool)
            .await
            .unwrap(),
    );
    let server_hard_max = Arc::new(server::ServerHardMax {
        file_size_bytes: 10 * 1024 * 1024,
        room_size: 1000,
        rooms_per_user: 500,
        devices_per_user: 10,
        keypackages_per_device: 50,
        message_size_bytes: 65536,
        attachment_retention_days: 365,
        call_max_participants: 50,
        reactions_per_message: 50,
    });

    let oprf_keys = server::oprf::OprfKeys::load(&opaque_server.setup).unwrap();
    let oprf_evaluator = Arc::new(server::oprf::OprfEvaluator::new(&oprf_keys));
    let oprf_audit = Arc::new(server::oprf::OprfAuditCounter::new());

    let state = AppState {
        pool,
        opaque_server,
        registration_store,
        login_store,
        recovery_store,
        altcha_config,
        config: Arc::new(config),
        server_hard_max,
        publisher,
        storage,
        backup_lock: Arc::new(tokio::sync::Mutex::new(())),
        oprf_rotation_lock: Arc::new(tokio::sync::Mutex::new(())),
        vapid_keys: None,
        push_delivery: None,
        oprf: oprf_evaluator,
        oprf_audit,
    };

    TestEnv { state, _dir: dir }
}

async fn create_dummy_user(pool: &sqlx::SqlitePool, user_id: &str, role: &str) {
    sqlx::query(
        "INSERT INTO users (id, username_token, opaque_registration, identity_pubkey, disabled_at, deleted_at) VALUES (?, ?, X'00', ?, NULL, NULL)"
    )
    .bind(user_id)
    .bind(format!("token_{}", user_id))
    .bind(format!("pubkey_{}", user_id))
    .execute(pool)
    .await
    .unwrap();

    roles::grant_role(pool, user_id, role, None).await.unwrap();
}

async fn create_log_entry(pool: &sqlx::SqlitePool, user_id: &str, token: &str, pubkey: &str) {
    sqlx::query(
        "INSERT INTO key_transparency_log (user_id, username_token, identity_pubkey) VALUES (?, ?, ?)"
    )
    .bind(user_id)
    .bind(token)
    .bind(pubkey)
    .execute(pool)
    .await
    .unwrap();
}

#[tokio::test]
async fn test_snapshot_creation_and_signature_verification() {
    let _lock = TEST_MUTEX.lock().await;
    let env = setup_test_app().await;

    create_dummy_user(&env.state.pool, "admin1", "owner").await;
    create_dummy_user(&env.state.pool, "user1", "member").await;

    create_log_entry(&env.state.pool, "admin1", "token_admin1", "pubkey_admin1").await;
    create_log_entry(&env.state.pool, "user1", "token_user1", "pubkey_user1").await;

    let snapshot = server::key_transparency::create_snapshot(
        &env.state.pool,
        &env.state.opaque_server,
        &env.state.publisher,
        &env.state.config,
        Some("admin1"),
    )
    .await
    .unwrap();

    assert_eq!(snapshot.tree_size, 2);

    let kt_keys = KeyTransparencyKeys::derive(&env.state.opaque_server.setup).unwrap();
    let root_bytes = URL_SAFE_NO_PAD.decode(&snapshot.root_hash).unwrap();
    let sig_bytes = URL_SAFE_NO_PAD.decode(&snapshot.signature).unwrap();

    let mut root_hash = [0u8; 32];
    root_hash.copy_from_slice(&root_bytes);

    let sig = Signature::from_slice(&sig_bytes).unwrap();
    let signing_input =
        server::key_transparency::format_signing_input(snapshot.tree_size as u64, &root_hash);

    assert!(kt_keys.verifying_key.verify(&signing_input, &sig).is_ok());

    // Verify audit log write
    let audit_entries = server::audit::list(
        &env.state.pool,
        AuditFilter {
            action: Some(action::KT_SNAPSHOT.to_string()),
            ..Default::default()
        },
        1,
        10,
    )
    .await
    .unwrap();

    assert_eq!(audit_entries.len(), 1);
    assert_eq!(audit_entries[0].actor_id, Some("admin1".to_string()));
    assert_eq!(audit_entries[0].metadata.as_ref().unwrap()["tree_size"], 2);

    // Verify user sequence increment for event fanout
    let user_seq: i64 = sqlx::query_scalar("SELECT next_seq FROM user_seq WHERE user_id = 'user1'")
        .fetch_one(&env.state.pool)
        .await
        .unwrap();
    assert_eq!(user_seq, 2); // allocated 1, next_seq = 2
}

#[tokio::test]
async fn test_snapshot_creation_disabled_flag() {
    let _lock = TEST_MUTEX.lock().await;
    let mut env = setup_test_app().await;

    let mut config = (*env.state.config).clone();
    config.key_transparency_enabled = false;
    env.state.config = Arc::new(config);

    let err = server::key_transparency::create_snapshot(
        &env.state.pool,
        &env.state.opaque_server,
        &env.state.publisher,
        &env.state.config,
        None,
    )
    .await
    .unwrap_err();

    assert!(matches!(
        err,
        server::key_transparency::SnapshotError::Disabled
    ));
}

#[tokio::test]
async fn test_snapshot_idempotency() {
    let _lock = TEST_MUTEX.lock().await;
    let env = setup_test_app().await;

    create_dummy_user(&env.state.pool, "admin1", "owner").await;
    create_log_entry(&env.state.pool, "admin1", "token_admin1", "pubkey_admin1").await;

    let snap1 = server::key_transparency::create_snapshot(
        &env.state.pool,
        &env.state.opaque_server,
        &env.state.publisher,
        &env.state.config,
        Some("admin1"),
    )
    .await
    .unwrap();

    let snap2 = server::key_transparency::create_snapshot(
        &env.state.pool,
        &env.state.opaque_server,
        &env.state.publisher,
        &env.state.config,
        Some("admin1"),
    )
    .await
    .unwrap();

    assert_ne!(snap1.id, snap2.id);
    assert_eq!(snap1.tree_size, snap2.tree_size);
    assert_eq!(snap1.root_hash, snap2.root_hash);

    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM key_transparency_snapshots")
        .fetch_one(&env.state.pool)
        .await
        .unwrap();
    assert_eq!(count, 2);
}

#[tokio::test]
async fn test_cli_snapshot_and_verify() {
    let _lock = TEST_MUTEX.lock().await;
    let env = setup_test_app().await;

    create_dummy_user(&env.state.pool, "user1", "member").await;
    create_log_entry(&env.state.pool, "user1", "token_user1", "pubkey_user1").await;

    // Create snapshot
    let snapshot = server::key_transparency::create_snapshot(
        &env.state.pool,
        &env.state.opaque_server,
        &env.state.publisher,
        &env.state.config,
        None,
    )
    .await
    .unwrap();

    assert_eq!(snapshot.tree_size, 1);

    // Verify via CLI logic helper
    let exit_code = server::cli::run_kt_verify(None).await.unwrap();
    assert_eq!(exit_code, 0);

    // Add another log entry so there are unverified leaves
    create_log_entry(&env.state.pool, "user1", "token_user2", "pubkey_user2").await;

    let exit_code2 = server::cli::run_kt_verify(None).await.unwrap();
    assert_eq!(exit_code2, 0);
}
