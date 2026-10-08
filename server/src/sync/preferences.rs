use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use regex::Regex;
use serde::{Deserialize, Serialize};
use sqlx::{Row, SqlitePool};
use std::sync::OnceLock;

use crate::sockudo::Publisher;
use crate::sync::{self, publish_user_event, UserEventEnvelope};

pub const RESERVED_KEYS: &[&str] = &["room_order"];
pub const KEY_PATTERN: &str = r"^[a-z][a-z0-9_-]*(:[a-z0-9_-]+)*$";
pub const MAX_KEY_LENGTH: usize = 128;

static KEY_REGEX: OnceLock<Regex> = OnceLock::new();

fn get_key_regex() -> &'static Regex {
    KEY_REGEX.get_or_init(|| Regex::new(KEY_PATTERN).expect("KEY_PATTERN regex should compile"))
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PreferenceRow {
    pub key: String,
    pub value: String,
    pub user_seq: i64,
}

pub struct WriteRequest {
    pub user_id: String,
    pub key: String,
    pub value: String,
    pub max_bytes: usize,
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
    #[error("invalid value base64url")]
    InvalidValue,
    #[error("value exceeds {0} bytes (got {1})")]
    ValueTooLarge(usize, usize),
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
        SELECT key, value_encrypted, user_seq
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
        value: r.get("value_encrypted"),
        user_seq: r.get("user_seq"),
    }))
}

pub async fn write_preference(
    pool: &SqlitePool,
    publisher: &Publisher,
    req: WriteRequest,
) -> Result<PreferenceRow, PreferencesError> {
    validate_key(&req.key)?;

    if req.value.is_empty() {
        return Err(PreferencesError::InvalidValue);
    }

    let decoded = URL_SAFE_NO_PAD
        .decode(&req.value)
        .map_err(|_| PreferencesError::InvalidValue)?;

    if decoded.len() > req.max_bytes {
        return Err(PreferencesError::ValueTooLarge(
            req.max_bytes,
            decoded.len(),
        ));
    }

    let mut tx = pool.begin().await?;

    let existing: Option<(String, i64)> = sqlx::query_as(
        r#"
        SELECT value_encrypted, user_seq
        FROM user_preferences
        WHERE user_id = ? AND key = ?
        "#,
    )
    .bind(&req.user_id)
    .bind(&req.key)
    .fetch_optional(&mut *tx)
    .await?;

    if let Some((existing_val, existing_seq)) = existing {
        if existing_val == req.value {
            tx.commit().await?;
            return Ok(PreferenceRow {
                key: req.key,
                value: req.value,
                user_seq: existing_seq,
            });
        }
    }

    let seq = sync::seq::allocate_user_seq(&mut tx, &req.user_id)
        .await
        .map_err(|e| match e {
            sync::SyncError::Database(err) => PreferencesError::Database(err),
            other => PreferencesError::Database(sqlx::Error::Protocol(other.to_string())),
        })?;

    sqlx::query(
        r#"
        INSERT INTO user_preferences (user_id, key, value_encrypted, user_seq, updated_at)
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(user_id, key) DO UPDATE SET
            value_encrypted = excluded.value_encrypted,
            user_seq = excluded.user_seq,
            updated_at = CURRENT_TIMESTAMP
        "#,
    )
    .bind(&req.user_id)
    .bind(&req.key)
    .bind(&req.value)
    .bind(seq)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;

    let row = PreferenceRow {
        key: req.key.clone(),
        value: req.value,
        user_seq: seq,
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
        SELECT key, value_encrypted, user_seq
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
            value: row.get("value_encrypted"),
            user_seq: row.get("user_seq"),
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
        SELECT key, value_encrypted, user_seq
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
            value: row.get("value_encrypted"),
            user_seq: row.get("user_seq"),
        });
    }

    Ok(result)
}
