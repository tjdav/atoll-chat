use crate::audit;
use serde::{Deserialize, Serialize};
use sqlx::{Row, SqlitePool};
use std::collections::HashMap;

pub const EXPOSED_KEYS: &[&str] = &[
    "moderation_mode",
    "altcha_enabled",
    "safety_number_mode",
    "push_enabled",
];

pub const SECRET_KEYS: &[&str] = &[
    "altcha_hmac_secret",
    "vapid_public_key",
    "vapid_private_key",
    "sockudo_app_key",
    "sockudo_app_secret",
];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct InstanceConfig {
    pub moderation_mode: String,
    pub altcha_enabled: bool,
    pub safety_number_mode: String,
    pub push_enabled: bool,
}

#[derive(thiserror::Error, Debug)]
pub enum ConfigOpsError {
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("unknown key: {0}")]
    UnknownKey(String),
    #[error("invalid value for key {key}: {value}")]
    InvalidValue { key: String, value: String },
}

pub async fn get_config(pool: &SqlitePool) -> Result<InstanceConfig, ConfigOpsError> {
    let rows = sqlx::query("SELECT key, value FROM instance_config")
        .fetch_all(pool)
        .await?;

    let mut map: HashMap<String, String> = HashMap::new();
    for row in rows {
        let k: String = row.get("key");
        let v: String = row.get("value");
        map.insert(k, v);
    }

    let moderation_mode = map
        .get("moderation_mode")
        .cloned()
        .or_else(|| std::env::var("MODERATION_MODE").ok())
        .unwrap_or_else(|| "messenger".to_string());

    let altcha_enabled = map
        .get("altcha_enabled")
        .map(|v| v.trim().eq_ignore_ascii_case("true") || v.trim() == "1")
        .unwrap_or_else(|| {
            std::env::var("ALTCHA_ENABLED")
                .map(|v| v.trim().eq_ignore_ascii_case("true") || v.trim() == "1")
                .unwrap_or(true)
        });

    let safety_number_mode = map
        .get("safety_number_mode")
        .cloned()
        .unwrap_or_else(|| "warn".to_string());

    let push_enabled = map
        .get("push_enabled")
        .map(|v| v.trim().eq_ignore_ascii_case("true") || v.trim() == "1")
        .unwrap_or(false);

    Ok(InstanceConfig {
        moderation_mode,
        altcha_enabled,
        safety_number_mode,
        push_enabled,
    })
}

pub async fn set_config(
    pool: &SqlitePool,
    key: &str,
    value: &str,
    actor_id: Option<&str>,
) -> Result<(), ConfigOpsError> {
    if !EXPOSED_KEYS.contains(&key) {
        return Err(ConfigOpsError::UnknownKey(key.to_string()));
    }

    match key {
        "moderation_mode" => {
            if value != "messenger" && value != "discord" {
                return Err(ConfigOpsError::InvalidValue {
                    key: key.to_string(),
                    value: value.to_string(),
                });
            }
        }
        "altcha_enabled" | "push_enabled" => {
            if value != "true" && value != "false" {
                return Err(ConfigOpsError::InvalidValue {
                    key: key.to_string(),
                    value: value.to_string(),
                });
            }
        }
        "safety_number_mode" => {
            if value != "warn" && value != "block" && value != "off" {
                return Err(ConfigOpsError::InvalidValue {
                    key: key.to_string(),
                    value: value.to_string(),
                });
            }
        }
        _ => unreachable!(),
    }

    sqlx::query(
        r#"
        INSERT INTO instance_config (key, value, updated_at, updated_by)
        VALUES (?, ?, CURRENT_TIMESTAMP, ?)
        ON CONFLICT(key) DO UPDATE SET
            value = excluded.value,
            updated_at = CURRENT_TIMESTAMP,
            updated_by = excluded.updated_by
        "#,
    )
    .bind(key)
    .bind(value)
    .bind(actor_id)
    .execute(pool)
    .await?;

    let _ = audit::log(
        pool,
        actor_id,
        audit::action::CONFIG_UPDATE,
        Some("instance_config"),
        Some(key),
        Some(serde_json::json!({ "key": key, "value": value })),
    )
    .await;

    Ok(())
}

pub async fn get_secret(pool: &SqlitePool, key: &str) -> Result<Option<String>, ConfigOpsError> {
    if !SECRET_KEYS.contains(&key) {
        return Err(ConfigOpsError::UnknownKey(key.to_string()));
    }

    let row = sqlx::query("SELECT value FROM instance_config WHERE key = ?")
        .bind(key)
        .fetch_optional(pool)
        .await?;

    Ok(row.map(|r| r.get("value")))
}

pub async fn set_secret(
    pool: &SqlitePool,
    key: &str,
    value: &str,
    actor_id: Option<&str>,
) -> Result<(), ConfigOpsError> {
    if !SECRET_KEYS.contains(&key) {
        return Err(ConfigOpsError::UnknownKey(key.to_string()));
    }

    sqlx::query(
        r#"
        INSERT INTO instance_config (key, value, updated_at, updated_by)
        VALUES (?, ?, CURRENT_TIMESTAMP, ?)
        ON CONFLICT(key) DO UPDATE SET
            value = excluded.value,
            updated_at = CURRENT_TIMESTAMP,
            updated_by = excluded.updated_by
        "#,
    )
    .bind(key)
    .bind(value)
    .bind(actor_id)
    .execute(pool)
    .await?;

    let _ = audit::log(
        pool,
        actor_id,
        audit::action::SECRET_UPDATE,
        Some("instance_config"),
        Some(key),
        Some(serde_json::json!({ "key": key })),
    )
    .await;

    Ok(())
}
