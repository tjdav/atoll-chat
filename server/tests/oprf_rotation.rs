mod common;

use base64::Engine;
use common::{register_user, setup_test_app};

#[tokio::test]
async fn test_oprf_rotation_flags_non_deleted_users() {
    let (app, pool) = setup_test_app().await;

    let _u1 = register_user(&app, "user_one", "Password123!", None).await;

    sqlx::query(
        "INSERT INTO server_invites (id, code, max_uses, current_uses) VALUES ('inv_r1', 'INVITE1', 10, 0)",
    )
    .execute(&pool)
    .await
    .unwrap();

    let _u2 = register_user(&app, "user_two", "Password123!", Some("INVITE1")).await;
    let _u3 = register_user(&app, "user_three", "Password123!", Some("INVITE1")).await;

    let temp_dir = std::env::temp_dir().join(format!("test_oprf_flags_{}", ulid::Ulid::new()));
    std::fs::create_dir_all(&temp_dir).unwrap();
    let key_path = temp_dir.join("oprf.key");
    let _server = server::OpaqueServer::load_or_generate(&key_path).unwrap();

    let config = server::Config {
        opaque_oprf_key_path: key_path.to_str().unwrap().to_string(),
        ..server::Config::test_default()
    };
    let outcome = server::oprf::rotation::rotate_oprf_key(&pool, &config)
        .await
        .unwrap();

    assert_eq!(outcome.users_flagged, 3);

    let flagged_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM users WHERE requires_reregistration = 1")
            .fetch_one(&pool)
            .await
            .unwrap();

    assert_eq!(flagged_count, 3);
}

#[tokio::test]
async fn test_oprf_rotation_does_not_flag_deleted_users() {
    let (app, pool) = setup_test_app().await;

    let u1 = register_user(&app, "active_user", "Password123!", None).await;

    sqlx::query(
        "INSERT INTO server_invites (id, code, max_uses, current_uses) VALUES ('inv_r2', 'INVITE2', 10, 0)",
    )
    .execute(&pool)
    .await
    .unwrap();

    let u2 = register_user(&app, "deleted_user", "Password123!", Some("INVITE2")).await;

    sqlx::query("UPDATE users SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?")
        .bind(&u2)
        .execute(&pool)
        .await
        .unwrap();

    let temp_dir = std::env::temp_dir().join(format!("test_oprf_del_{}", ulid::Ulid::new()));
    std::fs::create_dir_all(&temp_dir).unwrap();
    let key_path = temp_dir.join("oprf.key");
    let _server = server::OpaqueServer::load_or_generate(&key_path).unwrap();

    let config = server::Config {
        opaque_oprf_key_path: key_path.to_str().unwrap().to_string(),
        ..server::Config::test_default()
    };
    let outcome = server::oprf::rotation::rotate_oprf_key(&pool, &config)
        .await
        .unwrap();

    assert_eq!(outcome.users_flagged, 1);

    let u1_flag: i64 = sqlx::query_scalar("SELECT requires_reregistration FROM users WHERE id = ?")
        .bind(&u1)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(u1_flag, 1);

    let u2_flag: i64 = sqlx::query_scalar("SELECT requires_reregistration FROM users WHERE id = ?")
        .bind(&u2)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(u2_flag, 0);
}

#[tokio::test]
async fn test_oprf_rotation_creates_backup_file_matching_original() {
    let temp_dir = std::env::temp_dir().join(format!("test_oprf_bak_{}", ulid::Ulid::new()));
    std::fs::create_dir_all(&temp_dir).unwrap();
    let key_path = temp_dir.join("oprf.key");

    let _server = server::OpaqueServer::load_or_generate(&key_path).unwrap();
    let original_bytes = std::fs::read(&key_path).unwrap();

    let pool = common::setup_test_db().await;
    let config = server::Config {
        opaque_oprf_key_path: key_path.to_str().unwrap().to_string(),
        ..server::Config::test_default()
    };

    let outcome = server::oprf::rotation::rotate_oprf_key(&pool, &config)
        .await
        .unwrap();

    assert!(outcome.backup_path.exists());
    let backup_bytes = std::fs::read(&outcome.backup_path).unwrap();
    assert_eq!(original_bytes, backup_bytes);

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let perm = std::fs::metadata(&outcome.backup_path)
            .unwrap()
            .permissions();
        assert_eq!(perm.mode() & 0o777, 0o600);
    }
}

#[tokio::test]
async fn test_oprf_rotation_replaces_server_setup_file() {
    let temp_dir = std::env::temp_dir().join(format!("test_oprf_replace_{}", ulid::Ulid::new()));
    std::fs::create_dir_all(&temp_dir).unwrap();
    let key_path = temp_dir.join("oprf.key");

    let _server = server::OpaqueServer::load_or_generate(&key_path).unwrap();
    let original_bytes = std::fs::read(&key_path).unwrap();

    let pool = common::setup_test_db().await;
    let config = server::Config {
        opaque_oprf_key_path: key_path.to_str().unwrap().to_string(),
        ..server::Config::test_default()
    };

    let _outcome = server::oprf::rotation::rotate_oprf_key(&pool, &config)
        .await
        .unwrap();

    let new_bytes = std::fs::read(&key_path).unwrap();
    assert_ne!(original_bytes, new_bytes);
    assert_eq!(new_bytes.len(), 128);
}

#[tokio::test]
async fn test_oprf_rotation_missing_key_file_returns_error() {
    let pool = common::setup_test_db().await;
    let config = server::Config {
        opaque_oprf_key_path: "/nonexistent/path/oprf.key".to_string(),
        ..server::Config::test_default()
    };

    let res = server::oprf::rotation::rotate_oprf_key(&pool, &config).await;
    assert!(res.is_err());
    let err = res.unwrap_err();
    assert!(matches!(
        err,
        server::oprf::RotationError::KeyFileNotFound(_)
    ));
}

#[tokio::test]
async fn test_new_oprf_key_produces_different_tokens() {
    let (app, pool) = setup_test_app().await;

    let username = "alice_token_test";
    let token1 = common::obtain_username_token(&app, username).await;

    let temp_dir = std::env::temp_dir().join(format!("test_oprf_diff_tok_{}", ulid::Ulid::new()));
    std::fs::create_dir_all(&temp_dir).unwrap();
    let key_path = temp_dir.join("oprf.key");

    let opaque_server = server::OpaqueServer::load_or_generate(&key_path).unwrap();
    let config = server::Config {
        opaque_oprf_key_path: key_path.to_str().unwrap().to_string(),
        ..server::Config::test_default()
    };

    let _outcome = server::oprf::rotation::rotate_oprf_key(&pool, &config)
        .await
        .unwrap();

    // Load rotated key
    let rotated_opaque_server = server::OpaqueServer::load_or_generate(&key_path).unwrap();
    assert_ne!(
        rotated_opaque_server.setup.serialize(),
        opaque_server.setup.serialize()
    );

    let oprf_keys2 = server::oprf::OprfKeys::load(&rotated_opaque_server.setup).unwrap();

    // Compute token under oprf_keys2
    let mut rng = rand::rngs::OsRng;
    let blind_client =
        voprf::OprfClient::<voprf::Ristretto255>::blind(username.as_bytes(), &mut rng).unwrap();

    let eval_element = oprf_keys2
        .username_server
        .blind_evaluate(&blind_client.message);

    let finalize_bytes = blind_client
        .state
        .finalize(username.as_bytes(), &eval_element)
        .unwrap();

    let token2 = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(finalize_bytes);

    assert_ne!(token1, token2);
}
