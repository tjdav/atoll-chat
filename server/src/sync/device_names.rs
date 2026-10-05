use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{Row, SqlitePool};

use crate::identity;
use crate::sockudo::Publisher;
use crate::sync::{self, publish_user_event, UserEventEnvelope};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DeviceStateRow {
    pub device_id: String,
    pub encrypted_device_name: String,
    pub user_seq: i64,
    pub updated_at: DateTime<Utc>,
    pub deleted_at: Option<DateTime<Utc>>,
}

pub struct WriteRequest {
    pub user_id: String,
    pub device_id: String,
    pub encrypted_device_name: String,
}

#[derive(Debug, thiserror::Error)]
pub enum DeviceNameSyncError {
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("device not owned by user")]
    DeviceNotOwned,
    #[error("invalid encrypted device name: {0}")]
    InvalidCiphertext(String),
}

pub async fn write_device_name(
    pool: &SqlitePool,
    publisher: &Publisher,
    req: WriteRequest,
) -> Result<DeviceStateRow, DeviceNameSyncError> {
    // 1. Verify device ownership
    let exists: Option<i64> =
        sqlx::query_scalar("SELECT 1 FROM devices WHERE id = ? AND user_id = ?")
            .bind(&req.device_id)
            .bind(&req.user_id)
            .fetch_optional(pool)
            .await?;

    if exists.is_none() {
        return Err(DeviceNameSyncError::DeviceNotOwned);
    }

    // 2. Validate ciphertext
    identity::device_name::validate_encrypted_device_name(&req.encrypted_device_name)
        .map_err(|e| DeviceNameSyncError::InvalidCiphertext(e.to_string()))?;

    // 3. Begin transaction & allocate user_seq
    let mut tx = pool.begin().await?;

    let seq = sync::seq::allocate_user_seq(&mut tx, &req.user_id)
        .await
        .map_err(|e| match e {
            sync::SyncError::Database(err) => DeviceNameSyncError::Database(err),
            other => DeviceNameSyncError::Database(sqlx::Error::Protocol(other.to_string())),
        })?;

    // 4. Upsert row
    let updated_at: DateTime<Utc> = sqlx::query_scalar(
        r#"
        INSERT INTO device_names (
            user_id, device_id, encrypted_device_name, user_seq, updated_at, deleted_at
        ) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, NULL)
        ON CONFLICT(user_id, device_id) DO UPDATE SET
            encrypted_device_name = excluded.encrypted_device_name,
            user_seq = excluded.user_seq,
            updated_at = CURRENT_TIMESTAMP,
            deleted_at = NULL
        RETURNING updated_at
        "#,
    )
    .bind(&req.user_id)
    .bind(&req.device_id)
    .bind(&req.encrypted_device_name)
    .bind(seq)
    .fetch_one(&mut *tx)
    .await?;

    tx.commit().await?;

    let row = DeviceStateRow {
        device_id: req.device_id.clone(),
        encrypted_device_name: req.encrypted_device_name,
        user_seq: seq,
        updated_at,
        deleted_at: None,
    };

    // 5. Publish device.name_updated event post-commit
    let payload = serde_json::json!({
        "device_id": row.device_id,
        "encrypted_device_name": row.encrypted_device_name,
        "user_seq": row.user_seq,
    });
    let envelope = UserEventEnvelope::new("device.name_updated", row.user_seq, payload);
    if let Err(e) = publish_user_event(publisher, &req.user_id, &envelope).await {
        tracing::warn!(error = %e, user_id = %req.user_id, "device.name_updated publish failed");
    }

    Ok(row)
}

pub async fn list_device_names_since(
    pool: &SqlitePool,
    user_id: &str,
    since_seq: i64,
) -> Result<Vec<DeviceStateRow>, DeviceNameSyncError> {
    let rows = sqlx::query(
        r#"
        SELECT device_id, encrypted_device_name, user_seq, updated_at, deleted_at
        FROM device_names
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
        result.push(DeviceStateRow {
            device_id: row.get("device_id"),
            encrypted_device_name: row.get("encrypted_device_name"),
            user_seq: row.get("user_seq"),
            updated_at: row.get("updated_at"),
            deleted_at: row.get("deleted_at"),
        });
    }

    Ok(result)
}

pub async fn list_device_names_all(
    pool: &SqlitePool,
    user_id: &str,
) -> Result<Vec<DeviceStateRow>, DeviceNameSyncError> {
    let rows = sqlx::query(
        r#"
        SELECT device_id, encrypted_device_name, user_seq, updated_at, deleted_at
        FROM device_names
        WHERE user_id = ? AND deleted_at IS NULL
        ORDER BY user_seq ASC
        "#,
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?;

    let mut result = Vec::with_capacity(rows.len());
    for row in rows {
        result.push(DeviceStateRow {
            device_id: row.get("device_id"),
            encrypted_device_name: row.get("encrypted_device_name"),
            user_seq: row.get("user_seq"),
            updated_at: row.get("updated_at"),
            deleted_at: row.get("deleted_at"),
        });
    }

    Ok(result)
}
