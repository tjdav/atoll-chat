#[path = "../src/error.rs"]
mod error;
#[path = "../src/permissions.rs"]
mod permissions;
#[path = "../src/roles.rs"]
mod roles;

mod common;

use common::setup_test_db;
use permissions::{perm, satisfies, Permissions};

#[tokio::test]
async fn wildcard_grants_everything() {
    let perms = Permissions::from_json("[\"*\"]").unwrap();
    assert!(perms.has(perm::USER_MANAGE));
    assert!(perms.has(perm::ROOM_CREATE));
    assert!(perms.has("arbitrary.string"));

    let granted = vec![perm::WILDCARD];
    assert!(satisfies(&granted, perm::USER_MANAGE));
    assert!(satisfies(&granted, "arbitrary.string"));
}

#[tokio::test]
async fn explicit_permission_grants_only_itself() {
    let perms = Permissions::from_json("[\"room.create\"]").unwrap();
    assert!(perms.has(perm::ROOM_CREATE));
    assert!(!perms.has(perm::ROOM_JOIN));

    let granted = vec![perm::ROOM_CREATE];
    assert!(satisfies(&granted, perm::ROOM_CREATE));
    assert!(!satisfies(&granted, perm::ROOM_JOIN));
}

#[tokio::test]
async fn union_across_roles() {
    let pool = setup_test_db().await;

    // Insert a test user
    sqlx::query!("INSERT INTO users (id, username, username_hash, opaque_registration, identity_pubkey) VALUES ('user1', 'User 1', 'hash1', X'00', 'pubkey1')")
        .execute(&pool)
        .await
        .unwrap();

    roles::grant_role(&pool, "user1", "inviter", None)
        .await
        .unwrap();
    roles::grant_role(&pool, "user1", "member", None)
        .await
        .unwrap();

    assert!(
        roles::user_has_permission(&pool, "user1", perm::INVITE_LIMITED)
            .await
            .unwrap()
    );
    assert!(
        roles::user_has_permission(&pool, "user1", perm::ROOM_CREATE)
            .await
            .unwrap()
    );
    assert!(
        !roles::user_has_permission(&pool, "user1", perm::USER_MANAGE)
            .await
            .unwrap()
    );
}

#[tokio::test]
async fn no_roles_means_no_permissions() {
    let pool = setup_test_db().await;

    // Insert a test user
    sqlx::query!("INSERT INTO users (id, username, username_hash, opaque_registration, identity_pubkey) VALUES ('user_no_roles', 'User No Roles', 'hash_norole', X'00', 'pubkey_norole')")
        .execute(&pool)
        .await
        .unwrap();

    assert!(
        !roles::user_has_permission(&pool, "user_no_roles", perm::ROOM_CREATE)
            .await
            .unwrap()
    );
    assert!(
        !roles::user_has_permission(&pool, "user_no_roles", "arbitrary")
            .await
            .unwrap()
    );

    let user_roles = roles::get_user_roles(&pool, "user_no_roles").await.unwrap();
    assert!(user_roles.is_empty());
}

#[tokio::test]
async fn seed_idempotency() {
    let pool = setup_test_db().await;

    // Test helper automatically ran migrations
    let count: i64 = sqlx::query_scalar!("SELECT COUNT(*) FROM roles")
        .fetch_one(&pool)
        .await
        .unwrap();

    assert_eq!(count, 4);

    // Run seed migration manually again
    sqlx::query!(
        r#"
        INSERT OR IGNORE INTO roles (id, name, level, permissions) VALUES
        ('role_owner',   'owner',   100, '["*"]'),
        ('role_admin',   'admin',    80, '["user.manage","invite.unlimited","config.edit","room.force_delete","backup.manage"]'),
        ('role_inviter', 'inviter',  50, '["invite.limited"]'),
        ('role_member',  'member',   10, '["room.create","room.join","message.send"]');
        "#
    ).execute(&pool).await.unwrap();

    let count2: i64 = sqlx::query_scalar!("SELECT COUNT(*) FROM roles")
        .fetch_one(&pool)
        .await
        .unwrap();

    assert_eq!(count2, 4);
}

#[tokio::test]
async fn bootstrap_detection() {
    let pool = setup_test_db().await;

    // Initially false
    assert!(!roles::has_any_users(&pool).await.unwrap());

    // Insert user
    sqlx::query!("INSERT INTO users (id, username, username_hash, opaque_registration, identity_pubkey) VALUES ('firstuser', 'First User', 'hashfirst', X'00', 'pubkeyfirst')")
        .execute(&pool)
        .await
        .unwrap();

    // Now true
    assert!(roles::has_any_users(&pool).await.unwrap());
}
