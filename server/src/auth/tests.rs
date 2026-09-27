use super::check::{has_permission, seed_roles};
use super::permission::Permission;
use super::role::Role;
use sqlx::sqlite::SqlitePoolOptions;
use sqlx::Row;

async fn setup_db() -> sqlx::SqlitePool {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .unwrap();

    sqlx::migrate!().run(&pool).await.unwrap();
    pool
}

async fn insert_fake_user(pool: &sqlx::SqlitePool, id: &str) {
    sqlx::query(
        "INSERT INTO users (id, username, username_hash, opaque_registration, identity_pubkey) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(id)
    .bind(format!("user_{}", id))
    .bind(format!("hash_{}", id))
    .bind(vec![0u8; 32])
    .bind(format!("pubkey_{}", id))
    .execute(pool)
    .await
    .unwrap();
}

async fn grant_role(pool: &sqlx::SqlitePool, user_id: &str, role: Role) {
    sqlx::query("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)")
        .bind(user_id)
        .bind(role.as_str())
        .execute(pool)
        .await
        .unwrap();
}

#[tokio::test]
async fn test_role_definitions() {
    assert_eq!(Role::Owner.level(), 100);
    assert_eq!(Role::Admin.level(), 80);
    assert_eq!(Role::Inviter.level(), 50);
    assert_eq!(Role::Member.level(), 10);

    assert_eq!(Role::Owner.permissions(), &[Permission::Wildcard]);

    let admin_perms = Role::Admin.permissions();
    assert!(admin_perms.contains(&Permission::UserManage));
    assert!(admin_perms.contains(&Permission::InviteUnlimited));
    assert!(admin_perms.contains(&Permission::ConfigEdit));
    assert!(admin_perms.contains(&Permission::RoomForceDelete));
    assert!(admin_perms.contains(&Permission::BackupManage));
    assert_eq!(admin_perms.len(), 5);

    assert_eq!(Role::Inviter.permissions(), &[Permission::InviteLimited]);

    assert_eq!(
        Role::Member.permissions(),
        &[
            Permission::RoomCreate,
            Permission::RoomJoin,
            Permission::MessageSend
        ]
    );
}

#[tokio::test]
async fn test_permission_string_round_trip() {
    let perms = vec![
        Permission::Wildcard,
        Permission::UserManage,
        Permission::InviteUnlimited,
        Permission::InviteLimited,
        Permission::ConfigEdit,
        Permission::RoomForceDelete,
        Permission::BackupManage,
        Permission::RoomCreate,
        Permission::RoomJoin,
        Permission::MessageSend,
    ];

    for perm in perms {
        assert_eq!(Permission::from_str(perm.as_str()), Some(perm));
    }
}

#[tokio::test]
async fn test_role_string_round_trip() {
    for role in Role::all() {
        assert_eq!(Role::from_str(role.as_str()), Some(*role));
    }
}

#[tokio::test]
async fn test_seed_idempotency() {
    let pool = setup_db().await;

    // Call twice
    seed_roles(&pool).await.unwrap();
    seed_roles(&pool).await.unwrap();

    let count: i64 = sqlx::query("SELECT COUNT(*) as count FROM roles")
        .fetch_one(&pool)
        .await
        .unwrap()
        .get("count");

    assert_eq!(count, 4);
}

#[tokio::test]
async fn test_permission_check_with_wildcard() {
    let pool = setup_db().await;
    seed_roles(&pool).await.unwrap();

    insert_fake_user(&pool, "u1").await;
    grant_role(&pool, "u1", Role::Owner).await;

    assert!(has_permission(&pool, "u1", Permission::MessageSend)
        .await
        .unwrap());
    assert!(has_permission(&pool, "u1", Permission::ConfigEdit)
        .await
        .unwrap());
    assert!(has_permission(&pool, "u1", Permission::UserManage)
        .await
        .unwrap());
}

#[tokio::test]
async fn test_permission_check_without_wildcard() {
    let pool = setup_db().await;
    seed_roles(&pool).await.unwrap();

    insert_fake_user(&pool, "u1").await;
    grant_role(&pool, "u1", Role::Member).await;

    assert!(has_permission(&pool, "u1", Permission::RoomCreate)
        .await
        .unwrap());
    assert!(has_permission(&pool, "u1", Permission::RoomJoin)
        .await
        .unwrap());
    assert!(has_permission(&pool, "u1", Permission::MessageSend)
        .await
        .unwrap());

    assert!(!has_permission(&pool, "u1", Permission::UserManage)
        .await
        .unwrap());
    assert!(!has_permission(&pool, "u1", Permission::ConfigEdit)
        .await
        .unwrap());
}

#[tokio::test]
async fn test_permission_check_for_unknown_user() {
    let pool = setup_db().await;
    seed_roles(&pool).await.unwrap();

    assert!(!has_permission(&pool, "nobody", Permission::MessageSend)
        .await
        .unwrap());
}

#[tokio::test]
async fn test_multiple_roles_union() {
    let pool = setup_db().await;
    seed_roles(&pool).await.unwrap();

    insert_fake_user(&pool, "u1").await;
    grant_role(&pool, "u1", Role::Inviter).await;
    grant_role(&pool, "u1", Role::Member).await;

    assert!(has_permission(&pool, "u1", Permission::InviteLimited)
        .await
        .unwrap());
    assert!(has_permission(&pool, "u1", Permission::RoomCreate)
        .await
        .unwrap());
    assert!(!has_permission(&pool, "u1", Permission::UserManage)
        .await
        .unwrap());
}
