use chrono::{DateTime, Utc};
use regex::Regex;
use serde::{Deserialize, Serialize};
use sqlx::{Row, SqlitePool};
use std::sync::OnceLock;

use crate::sockudo::Publisher;
use crate::sync::{self, publish_user_event, UserEventEnvelope};

pub const RESERVED_KEYS: &[&str] = &["room_order"];
pub const KEY_PATTERN: &str = r"^[a-z][a-z0-9_-]*(:[a-z0-9_-]+)*$";
pub const MAX_KEY_LENGTH: usize = 128;
pub const MAX_VALUE_BYTES: usize = 65_536; // 64 KB

static KEY_REGEX: OnceLock<Regex> = OnceLock::new();

fn get_key_regex() -> &'static Regex {
    KEY_REGEX.get_or_init(|| Regex::new(KEY_PATTERN).expect("KEY_PATTERN regex should compile"))
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PreferenceRow {
    pub key: String,
    pub value_json: String,
    pub user_seq: i64,
    pub updated_at: DateTime<Utc>,
}

pub struct WriteRequest {
    pub user_id: String,
    pub key: String,
    pub value: serde_json::Value,
}

pub enum DeleteOutcome {
    Deleted { user_seq: i64 },
    NotPresent,
}

#[derive(Debug, thiserror::Error)]
pub enum PreferencesError {
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("invalid key: {0}")]
    InvalidKey(String),
    #[error("reserved key: {0}")]
    ReservedKey(String),
    #[error("value exceeds {0} bytes (got {1})")]
    ValueTooLarge(usize, usize),
    #[error("serialization error: {0}")]
    Serialization(String),
}

pub fn is_reserved_key(key: &str) -> bool {
    RESERVED_KEYS.contains(&key) || key.starts_with('_')
}

pub fn validate_key_syntax(key: &str) -> Result<(), PreferencesError> {
    if key.is_empty() || key.len() > MAX_KEY_LENGTH || !get_key_regex().is_match(key) {
        return Err(PreferencesError::InvalidKey(key.to_string()));
    }
    Ok(())
}

pub fn validate_key(key: &str) -> Result<(), PreferencesError> {
    if is_reserved_key(key) {
        return Err(PreferencesError::ReservedKey(key.to_string()));
    }
    validate_key_syntax(key)
}

pub async fn get_preference(
    pool: &SqlitePool,
    user_id: &str,
    key: &str,
) -> Result<Option<PreferenceRow>, PreferencesError> {
    let row = sqlx::query(
        r#"
        SELECT key, value_json, user_seq, updated_at
        FROM user_preferences
        WHERE user_id = ? AND key = ?
        "#,
    )
    .bind(user_id)
    .bind(key)
    .fetch_optional(pool)
    .await?;

    Ok(row.map(|r| PreferenceRow {
        key: r.get("key"),
        value_json: r.get("value_json"),
        user_seq: r.get("user_seq"),
        updated_at: r.get("updated_at"),
    }))
}

pub async fn write_preference(
    pool: &SqlitePool,
    publisher: &Publisher,
    req: WriteRequest,
) -> Result<PreferenceRow, PreferencesError> {
    validate_key(&req.key)?;

    let value_json = serde_json::to_string(&req.value)
        .map_err(|e| PreferencesError::Serialization(e.to_string()))?;

    if value_json.len() > MAX_VALUE_BYTES {
        return Err(PreferencesError::ValueTooLarge(
            MAX_VALUE_BYTES,
            value_json.len(),
        ));
    }

    let mut tx = pool.begin().await?;

    let seq = sync::seq::allocate_user_seq(&mut tx, &req.user_id)
        .await
        .map_err(|e| match e {
            sync::SyncError::Database(err) => PreferencesError::Database(err),
            other => PreferencesError::Database(sqlx::Error::Protocol(other.to_string())),
        })?;

    let updated_at: DateTime<Utc> = sqlx::query_scalar(
        r#"
        INSERT INTO user_preferences (user_id, key, value_json, user_seq, updated_at)
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(user_id, key) DO UPDATE SET
            value_json = excluded.value_json,
            user_seq = excluded.user_seq,
            updated_at = CURRENT_TIMESTAMP
        RETURNING updated_at
        "#,
    )
    .bind(&req.user_id)
    .bind(&req.key)
    .bind(&value_json)
    .bind(seq)
    .fetch_one(&mut *tx)
    .await?;

    tx.commit().await?;

    let row = PreferenceRow {
        key: req.key.clone(),
        value_json,
        user_seq: seq,
        updated_at,
    };

    let payload = serde_json::json!({
        "key": row.key,
        "user_seq": row.user_seq,
    });
    let envelope = UserEventEnvelope::new("preference.updated", row.user_seq, payload);
    if let Err(e) = publish_user_event(publisher, &req.user_id, &envelope).await {
        tracing::warn!(error = %e, user_id = %req.user_id, key = %row.key, "preference.updated publish failed");
    }

    Ok(row)
}

pub async fn delete_preference(
    pool: &SqlitePool,
    publisher: &Publisher,
    user_id: &str,
    key: &str,
) -> Result<DeleteOutcome, PreferencesError> {
    validate_key(key)?;

    let mut tx = pool.begin().await?;

    let res = sqlx::query("DELETE FROM user_preferences WHERE user_id = ? AND key = ?")
        .bind(user_id)
        .bind(key)
        .execute(&mut *tx)
        .await?;

    if res.rows_affected() == 0 {
        return Ok(DeleteOutcome::NotPresent);
    }

    let seq = sync::seq::allocate_user_seq(&mut tx, user_id)
        .await
        .map_err(|e| match e {
            sync::SyncError::Database(err) => PreferencesError::Database(err),
            other => PreferencesError::Database(sqlx::Error::Protocol(other.to_string())),
        })?;

    tx.commit().await?;

    let payload = serde_json::json!({
        "key": key,
        "user_seq": seq,
        "deleted": true,
    });
    let envelope = UserEventEnvelope::new("preference.updated", seq, payload);
    if let Err(e) = publish_user_event(publisher, user_id, &envelope).await {
        tracing::warn!(error = %e, user_id = %user_id, key = %key, "preference.updated publish failed");
    }

    Ok(DeleteOutcome::Deleted { user_seq: seq })
}

pub async fn list_preferences_since(
    pool: &SqlitePool,
    user_id: &str,
    since_seq: i64,
) -> Result<Vec<PreferenceRow>, PreferencesError> {
    let rows = sqlx::query(
        r#"
        SELECT key, value_json, user_seq, updated_at
        FROM user_preferences
        WHERE user_id = ? AND user_seq > ?
        ORDER BY user_seq ASC
        "#,
    )
    .bind(user_id)
    .bind(since_seq)
    .fetch_all(pool)
    .await?;

    let mut result = Vec::with_capacity(rows.len());
    for row in rows {
        result.push(PreferenceRow {
            key: row.get("key"),
            value_json: row.get("value_json"),
            user_seq: row.get("user_seq"),
            updated_at: row.get("updated_at"),
        });
    }

    Ok(result)
}

pub async fn list_preferences_all(
    pool: &SqlitePool,
    user_id: &str,
) -> Result<Vec<PreferenceRow>, PreferencesError> {
    let rows = sqlx::query(
        r#"
        SELECT key, value_json, user_seq, updated_at
        FROM user_preferences
        WHERE user_id = ?
        ORDER BY user_seq ASC
        "#,
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?;

    let mut result = Vec::with_capacity(rows.len());
    for row in rows {
        result.push(PreferenceRow {
            key: row.get("key"),
            value_json: row.get("value_json"),
            user_seq: row.get("user_seq"),
            updated_at: row.get("updated_at"),
        });
    }

    Ok(result)
}
