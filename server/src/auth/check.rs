use crate::auth::{permission::Permission, role::Role};
use tracing::info;

pub async fn seed_roles(pool: &sqlx::SqlitePool) -> anyhow::Result<()> {
    for role in Role::all() {
        let permissions_json = serde_json::to_string(&role.permissions())?;

        let result = sqlx::query(
            "INSERT OR IGNORE INTO roles (id, name, level, permissions) VALUES (?, ?, ?, ?)",
        )
        .bind(role.as_str())
        .bind(role.as_str())
        .bind(role.level())
        .bind(permissions_json)
        .execute(pool)
        .await?;

        if result.rows_affected() > 0 {
            info!("seeded role={} level={}", role.as_str(), role.level());
        } else {
            info!("role already exists role={}", role.as_str());
        }
    }

    Ok(())
}

#[allow(dead_code)]
pub async fn has_permission(
    pool: &sqlx::SqlitePool,
    user_id: &str,
    permission: Permission,
) -> anyhow::Result<bool> {
    use sqlx::Row;

    // Join user_roles and roles to get permissions array for this user
    let rows = sqlx::query(
        "SELECT roles.permissions FROM user_roles JOIN roles ON roles.id = user_roles.role_id WHERE user_roles.user_id = ?",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?;

    for row in rows {
        let permissions_json: String = row.try_get("permissions")?;
        let perms: Vec<Permission> = serde_json::from_str(&permissions_json)?;
        for p in perms {
            if p == Permission::Wildcard || p == permission {
                return Ok(true);
            }
        }
    }

    Ok(false)
}
