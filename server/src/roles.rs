use crate::permissions::{PermissionError, Permissions};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

#[derive(thiserror::Error, Debug)]
#[allow(dead_code)]
pub enum RoleError {
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("invalid json: {0}")]
    InvalidJson(String),
    #[error("unknown role: {0}")]
    UnknownRole(String),
}

impl From<PermissionError> for RoleError {
    fn from(err: PermissionError) -> Self {
        match err {
            PermissionError::InvalidJson(msg) => RoleError::InvalidJson(msg),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[allow(dead_code)]
pub struct Role {
    #[serde(skip_serializing)]
    pub id: String,
    pub name: String,
    pub level: i64,
    pub permissions: Permissions,
}

#[allow(dead_code)]
pub async fn list_roles(pool: &SqlitePool) -> Result<Vec<Role>, RoleError> {
    let rows = sqlx::query!("SELECT id as `id!`, name as `name!`, level as `level!`, permissions as `permissions!` FROM roles ORDER BY level DESC")
        .fetch_all(pool)
        .await?;

    let mut roles = Vec::with_capacity(rows.len());
    for row in rows {
        let permissions = Permissions::from_json(&row.permissions)?;
        roles.push(Role {
            id: row.id,
            name: row.name,
            level: row.level,
            permissions,
        });
    }

    Ok(roles)
}

#[allow(dead_code)]
pub async fn get_role_by_name(pool: &SqlitePool, name: &str) -> Result<Option<Role>, RoleError> {
    let row = sqlx::query!("SELECT id as `id!`, name as `name!`, level as `level!`, permissions as `permissions!` FROM roles WHERE name = ?", name)
        .fetch_optional(pool)
        .await?;

    if let Some(row) = row {
        let permissions = Permissions::from_json(&row.permissions)?;
        Ok(Some(Role {
            id: row.id,
            name: row.name,
            level: row.level,
            permissions,
        }))
    } else {
        Ok(None)
    }
}

#[allow(dead_code)]
pub async fn get_user_roles(pool: &SqlitePool, user_id: &str) -> Result<Vec<Role>, RoleError> {
    let rows = sqlx::query!(
        r#"
        SELECT r.id as `id!`, r.name as `name!`, r.level as `level!`, r.permissions as `permissions!`
        FROM roles r
        JOIN user_roles ur ON r.id = ur.role_id
        WHERE ur.user_id = ?
        ORDER BY r.level DESC
        "#,
        user_id
    )
    .fetch_all(pool)
    .await?;

    let mut roles = Vec::with_capacity(rows.len());
    for row in rows {
        let permissions = Permissions::from_json(&row.permissions)?;
        roles.push(Role {
            id: row.id,
            name: row.name,
            level: row.level,
            permissions,
        });
    }

    Ok(roles)
}

#[allow(dead_code)]
pub async fn user_has_permission(
    pool: &SqlitePool,
    user_id: &str,
    required: &str,
) -> Result<bool, RoleError> {
    let roles = get_user_roles(pool, user_id).await?;

    for role in roles {
        if role.permissions.has(required) {
            return Ok(true);
        }
    }

    Ok(false)
}

#[allow(dead_code)]
pub async fn grant_role(
    pool: &SqlitePool,
    user_id: &str,
    role_name: &str,
    granted_by: Option<&str>,
) -> Result<(), RoleError> {
    let role = get_role_by_name(pool, role_name)
        .await?
        .ok_or_else(|| RoleError::UnknownRole(role_name.to_string()))?;

    sqlx::query!(
        "INSERT OR IGNORE INTO user_roles (user_id, role_id, granted_by) VALUES (?, ?, ?)",
        user_id,
        role.id,
        granted_by
    )
    .execute(pool)
    .await?;

    Ok(())
}

#[allow(dead_code)]
pub async fn revoke_role(
    pool: &SqlitePool,
    user_id: &str,
    role_name: &str,
) -> Result<(), RoleError> {
    let role = get_role_by_name(pool, role_name)
        .await?
        .ok_or_else(|| RoleError::UnknownRole(role_name.to_string()))?;

    sqlx::query!(
        "DELETE FROM user_roles WHERE user_id = ? AND role_id = ?",
        user_id,
        role.id
    )
    .execute(pool)
    .await?;

    Ok(())
}

pub async fn has_any_users(pool: &SqlitePool) -> Result<bool, RoleError> {
    let count: i64 = sqlx::query_scalar!("SELECT COUNT(*) FROM users")
        .fetch_one(pool)
        .await?;

    Ok(count > 0)
}
