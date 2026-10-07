use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use chrono::{DateTime, Utc};
use rand::RngCore;
use sqlx::{Row, SqlitePool};
use tracing::warn;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Device {
    pub id: String,
    pub user_id: String,
    pub client_id: String,
    pub platform: String,
    pub encrypted_device_name: Option<String>,
    pub last_seen: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

#[derive(thiserror::Error, Debug)]
pub enum DeviceError {
    #[error("Database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("Push error: {0}")]
    Push(#[from] crate::push::PushError),
    #[error("Device limit exceeded: current {current}, max {max}")]
    DeviceLimitExceeded { current: u32, max: u32 },
    #[error("Device not found")]
    NotFound,
}

#[derive(Debug, Clone)]
pub struct RevocationSummary {
    pub sessions_removed: u64,
    pub key_packages_removed: u64,
    pub mls_removes_queued: u64,
}

pub async fn find_by_client_id(
    pool: &SqlitePool,
    user_id: &str,
    client_id: &str,
) -> Result<Option<Device>, DeviceError> {
    let row = sqlx::query(
        r#"
        SELECT d.id, d.user_id, d.client_id, d.platform, dn.encrypted_device_name, d.last_seen, d.created_at
        FROM devices d
        LEFT JOIN device_names dn
            ON d.id = dn.device_id AND d.user_id = dn.user_id AND dn.deleted_at IS NULL
        WHERE d.user_id = ? AND d.client_id = ?
        "#,
    )
    .bind(user_id)
    .bind(client_id)
    .fetch_optional(pool)
    .await?;

    let row = match row {
        Some(r) => r,
        None => return Ok(None),
    };

    Ok(Some(Device {
        id: row.get("id"),
        user_id: row.get("user_id"),
        client_id: row.get("client_id"),
        platform: row.get("platform"),
        encrypted_device_name: row.get("encrypted_device_name"),
        last_seen: row.get("last_seen"),
        created_at: row.get("created_at"),
    }))
}

pub async fn create_device(
    pool: &SqlitePool,
    user_id: &str,
    client_id: &str,
    platform: &str,
) -> Result<Device, DeviceError> {
    let mut id_bytes = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut id_bytes);
    let device_id = URL_SAFE_NO_PAD.encode(id_bytes);

    sqlx::query(
        r#"
        INSERT INTO devices (id, user_id, client_id, platform)
        VALUES (?, ?, ?, ?)
        "#,
    )
    .bind(&device_id)
    .bind(user_id)
    .bind(client_id)
    .bind(platform)
    .execute(pool)
    .await?;

    let row = sqlx::query(
        r#"
        SELECT d.id, d.user_id, d.client_id, d.platform, dn.encrypted_device_name, d.last_seen, d.created_at
        FROM devices d
        LEFT JOIN device_names dn
            ON d.id = dn.device_id AND d.user_id = dn.user_id AND dn.deleted_at IS NULL
        WHERE d.id = ?
        "#,
    )
    .bind(&device_id)
    .fetch_one(pool)
    .await?;

    Ok(Device {
        id: row.get("id"),
        user_id: row.get("user_id"),
        client_id: row.get("client_id"),
        platform: row.get("platform"),
        encrypted_device_name: row.get("encrypted_device_name"),
        last_seen: row.get("last_seen"),
        created_at: row.get("created_at"),
    })
}

pub async fn touch_last_seen(pool: &SqlitePool, device_id: &str) -> Result<(), DeviceError> {
    let res = sqlx::query(
        r#"
        UPDATE devices
        SET last_seen = CURRENT_TIMESTAMP
        WHERE id = ?
        "#,
    )
    .bind(device_id)
    .execute(pool)
    .await;

    if let Err(e) = res {
        warn!("Failed to touch last_seen for device {}: {}", device_id, e);
    }

    Ok(())
}

pub async fn list_devices(pool: &SqlitePool, user_id: &str) -> Result<Vec<Device>, DeviceError> {
    let rows = sqlx::query(
        r#"
        SELECT d.id, d.user_id, d.client_id, d.platform, dn.encrypted_device_name, d.last_seen, d.created_at
        FROM devices d
        LEFT JOIN device_names dn
            ON d.id = dn.device_id AND d.user_id = dn.user_id AND dn.deleted_at IS NULL
        WHERE d.user_id = ?
        ORDER BY d.created_at DESC
        "#,
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?;

    let mut devices = Vec::with_capacity(rows.len());
    for row in rows {
        devices.push(Device {
            id: row.get("id"),
            user_id: row.get("user_id"),
            client_id: row.get("client_id"),
            platform: row.get("platform"),
            encrypted_device_name: row.get("encrypted_device_name"),
            last_seen: row.get("last_seen"),
            created_at: row.get("created_at"),
        });
    }

    Ok(devices)
}

pub async fn count_devices(pool: &SqlitePool, user_id: &str) -> Result<u32, DeviceError> {
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM devices WHERE user_id = ?")
        .bind(user_id)
        .fetch_one(pool)
        .await?;

    Ok(count as u32)
}

pub async fn revoke_device(
    pool: &SqlitePool,
    publisher: &crate::sockudo::Publisher,
    user_id: &str,
    device_id: &str,
) -> Result<RevocationSummary, DeviceError> {
    let mut tx = pool.begin().await?;

    // 1. Look up the device. If it does not exist or does not belong to user_id, return NotFound.
    let row: Option<(String,)> =
        sqlx::query_as("SELECT client_id FROM devices WHERE id = ? AND user_id = ?")
            .bind(device_id)
            .bind(user_id)
            .fetch_optional(&mut *tx)
            .await?;

    let client_id = match row {
        Some((cid,)) => cid,
        None => return Err(DeviceError::NotFound),
    };

    // Count sessions linked to this device before deletion
    let sessions_removed_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM sessions WHERE device_id = ?")
            .bind(device_id)
            .fetch_one(&mut *tx)
            .await?;

    // 2. Delete unconsumed KeyPackages:
    let kp_res = sqlx::query(
        "DELETE FROM key_packages WHERE user_id = ? AND client_id = ? AND consumed = 0",
    )
    .bind(user_id)
    .bind(&client_id)
    .execute(&mut *tx)
    .await?;
    let key_packages_removed = kp_res.rows_affected();

    // 3. Queue MLS Removes for every room the user is a member of:
    let rooms: Vec<(String,)> =
        sqlx::query_as("SELECT room_id FROM room_members WHERE user_id = ?")
            .bind(user_id)
            .fetch_all(&mut *tx)
            .await?;

    let mut mls_removes_queued: u64 = 0;
    for (room_id,) in rooms {
        crate::rooms::queue_pending_mls_remove_batch(
            &mut tx,
            &room_id,
            crate::rooms::MlsTarget::User(user_id),
        )
        .await
        .map_err(|e| match e {
            crate::rooms::RoomError::Database(err) => DeviceError::Database(err),
            _ => DeviceError::Database(sqlx::Error::Protocol(e.to_string())),
        })?;

        mls_removes_queued += 1;
    }

    // 4. Delete push subscriptions tied to this device
    crate::push::subscriptions::delete_for_device(&mut tx, device_id).await?;

    // 5. Allocate user_seq for device.revoked event
    let user_seq = crate::sync::allocate_user_seq(&mut tx, user_id)
        .await
        .map_err(|e| DeviceError::Database(sqlx::Error::Protocol(e.to_string())))?;

    // 6. Delete the device row (cascades to sessions and device_names)
    sqlx::query("DELETE FROM devices WHERE id = ? AND user_id = ?")
        .bind(device_id)
        .bind(user_id)
        .execute(&mut *tx)
        .await?;

    tx.commit().await?;

    // 7. Post-commit: publish durable device.revoked event
    let payload = serde_json::json!({
        "device_id": device_id,
        "reason": "revoked_by_user",
        "user_seq": user_seq,
    });
    let envelope = crate::sync::UserEventEnvelope::new("device.revoked", user_seq, payload);
    if let Err(e) = crate::sync::publish_user_event(publisher, user_id, &envelope).await {
        tracing::warn!(error = %e, user_id = %user_id, "device.revoked publish failed");
    }

    Ok(RevocationSummary {
        sessions_removed: sessions_removed_count as u64,
        key_packages_removed,
        mls_removes_queued,
    })
}
