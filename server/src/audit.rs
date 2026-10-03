use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{Row, SqlitePool};
use tracing::error;
use ulid::Ulid;

pub mod action {
    pub const CONFIG_UPDATE: &str = "config.update";
    pub const SECRET_UPDATE: &str = "secret.update";
    pub const LIMITS_UPDATE: &str = "limits.update";
    pub const ROLE_GRANT: &str = "role.grant";
    pub const ROLE_REVOKE: &str = "role.revoke";
    pub const INVITE_CREATE: &str = "invite.create";
    pub const INVITE_REVOKE: &str = "invite.revoke";
    pub const USER_DISABLE: &str = "user.disable";
    pub const USER_ENABLE: &str = "user.enable";
    pub const DEVICE_REVOKE: &str = "device.revoke";
    pub const BOOTSTRAP_OWNER: &str = "bootstrap.owner";
    pub const VAPID_ROTATE: &str = "vapid.rotate";
    pub const ALTCHA_ROTATE: &str = "altcha.rotate";
    pub const OPRF_ROTATE: &str = "oprf.rotate";
    pub const USER_DELETE: &str = "user.delete";
    pub const USER_EXPORT: &str = "user.export";
    pub const MESSAGE_DELETE: &str = "message.delete";
    pub const EDIT_CREATE: &str = "edit.create";
    pub const REACTION_CREATE: &str = "reaction.create";
    pub const REACTION_DELETE: &str = "reaction.delete";
    pub const RECOVER_START: &str = "recover.start";
    pub const RECOVER_FINISH: &str = "recover.finish";
    pub const KT_SNAPSHOT: &str = "kt.snapshot";
    pub const SESSION_TYPES_RELOAD: &str = "session_types.reload";
    pub const MODEL_MANIFEST_RELOAD: &str = "model.manifest_reload";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditEntry {
    pub id: String,
    pub actor_id: Option<String>,
    pub action: String,
    pub target_type: Option<String>,
    pub target_id: Option<String>,
    pub metadata: Option<serde_json::Value>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct AuditFilter {
    pub actor_id: Option<String>,
    pub action: Option<String>,
    pub target_type: Option<String>,
    pub target_id: Option<String>,
    pub before: Option<DateTime<Utc>>,
    pub after: Option<DateTime<Utc>>,
}

#[derive(thiserror::Error, Debug)]
pub enum AuditError {
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("serialization error: {0}")]
    Serialization(#[from] serde_json::Error),
}

pub async fn log(
    pool: &SqlitePool,
    actor_id: Option<&str>,
    action: &str,
    target_type: Option<&str>,
    target_id: Option<&str>,
    metadata: Option<serde_json::Value>,
) -> Result<(), AuditError> {
    if let Err(err) = log_internal(pool, actor_id, action, target_type, target_id, metadata).await {
        error!("Audit log write failed: {:#}", err);
    }
    Ok(())
}

async fn log_internal(
    pool: &SqlitePool,
    actor_id: Option<&str>,
    action: &str,
    target_type: Option<&str>,
    target_id: Option<&str>,
    metadata: Option<serde_json::Value>,
) -> Result<(), AuditError> {
    let id = Ulid::new().to_string();
    let metadata_str = match metadata {
        Some(val) => Some(serde_json::to_string(&val)?),
        None => None,
    };

    sqlx::query(
        r#"
        INSERT INTO audit_log (id, actor_id, action, target_type, target_id, metadata, created_at)
        VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        "#,
    )
    .bind(id)
    .bind(actor_id)
    .bind(action)
    .bind(target_type)
    .bind(target_id)
    .bind(metadata_str)
    .execute(pool)
    .await?;

    Ok(())
}

pub async fn list(
    pool: &SqlitePool,
    filter: AuditFilter,
    _page: u32,
    per_page: u32,
) -> Result<Vec<AuditEntry>, AuditError> {
    let limit = per_page.clamp(1, 100) as i64;

    let mut query = String::from(
        "SELECT id, actor_id, action, target_type, target_id, metadata, created_at FROM audit_log WHERE 1=1",
    );

    if filter.actor_id.is_some() {
        query.push_str(" AND actor_id = ?");
    }
    if filter.action.is_some() {
        query.push_str(" AND action = ?");
    }
    if filter.target_type.is_some() {
        query.push_str(" AND target_type = ?");
    }
    if filter.target_id.is_some() {
        query.push_str(" AND target_id = ?");
    }
    if filter.before.is_some() {
        query.push_str(" AND created_at < ?");
    }
    if filter.after.is_some() {
        query.push_str(" AND created_at > ?");
    }

    query.push_str(" ORDER BY created_at DESC, id DESC LIMIT ?");

    let mut q = sqlx::query(&query);

    if let Some(ref actor_id) = filter.actor_id {
        q = q.bind(actor_id);
    }
    if let Some(ref action) = filter.action {
        q = q.bind(action);
    }
    if let Some(ref target_type) = filter.target_type {
        q = q.bind(target_type);
    }
    if let Some(ref target_id) = filter.target_id {
        q = q.bind(target_id);
    }
    if let Some(before) = filter.before {
        q = q.bind(before);
    }
    if let Some(after) = filter.after {
        q = q.bind(after);
    }

    q = q.bind(limit);

    let rows = q.fetch_all(pool).await?;

    let mut entries = Vec::with_capacity(rows.len());
    for row in rows {
        let id: String = row.get("id");
        let actor_id: Option<String> = row.get("actor_id");
        let action: String = row.get("action");
        let target_type: Option<String> = row.get("target_type");
        let target_id: Option<String> = row.get("target_id");
        let metadata_str: Option<String> = row.get("metadata");
        let created_at: DateTime<Utc> = row.get("created_at");

        let metadata = match metadata_str {
            Some(s) => serde_json::from_str(&s).ok(),
            None => None,
        };

        entries.push(AuditEntry {
            id,
            actor_id,
            action,
            target_type,
            target_id,
            metadata,
            created_at,
        });
    }

    Ok(entries)
}
