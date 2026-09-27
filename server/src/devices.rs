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
    pub name: Option<String>,
    pub last_seen: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

#[derive(thiserror::Error, Debug)]
pub enum DeviceError {
    #[error("Database error: {0}")]
    Database(#[from] sqlx::Error),
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
        SELECT id, user_id, client_id, name, last_seen, created_at
        FROM devices
        WHERE user_id = ? AND client_id = ?
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
        name: row.get("name"),
        last_seen: row.get("last_seen"),
        created_at: row.get("created_at"),
    }))
}

pub async fn create_device(
    pool: &SqlitePool,
    user_id: &str,
    client_id: &str,
    name: Option<&str>,
) -> Result<Device, DeviceError> {
    let mut id_bytes = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut id_bytes);
    let device_id = URL_SAFE_NO_PAD.encode(id_bytes);

    let clean_name = name.map(|s| s.trim()).filter(|s| !s.is_empty());

    sqlx::query(
        r#"
        INSERT INTO devices (id, user_id, client_id, name)
        VALUES (?, ?, ?, ?)
        "#,
    )
    .bind(&device_id)
    .bind(user_id)
    .bind(client_id)
    .bind(clean_name)
    .execute(pool)
    .await?;

    let row = sqlx::query(
        r#"
        SELECT id, user_id, client_id, name, last_seen, created_at
        FROM devices
        WHERE id = ?
        "#,
    )
    .bind(&device_id)
    .fetch_one(pool)
    .await?;

    Ok(Device {
        id: row.get("id"),
        user_id: row.get("user_id"),
        client_id: row.get("client_id"),
        name: row.get("name"),
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
        SELECT id, user_id, client_id, name, last_seen, created_at
        FROM devices
        WHERE user_id = ?
        ORDER BY created_at DESC
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
            name: row.get("name"),
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
        let mut remove_id_bytes = [0u8; 16];
        rand::thread_rng().fill_bytes(&mut remove_id_bytes);
        let remove_id = URL_SAFE_NO_PAD.encode(remove_id_bytes);

        sqlx::query(
            r#"
            INSERT INTO pending_mls_removes (id, room_id, target_user_id, target_client_id)
            VALUES (?, ?, ?, ?)
            "#,
        )
        .bind(&remove_id)
        .bind(&room_id)
        .bind(user_id)
        .bind(&client_id)
        .execute(&mut *tx)
        .await?;

        mls_removes_queued += 1;
    }

    // 4. Delete the device row (cascades to sessions)
    sqlx::query("DELETE FROM devices WHERE id = ? AND user_id = ?")
        .bind(device_id)
        .bind(user_id)
        .execute(&mut *tx)
        .await?;

    tx.commit().await?;

    Ok(RevocationSummary {
        sessions_removed: sessions_removed_count as u64,
        key_packages_removed,
        mls_removes_queued,
    })
}
