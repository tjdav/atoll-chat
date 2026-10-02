use crate::audit;
use serde::{Deserialize, Serialize};
use sqlx::{Row, SqlitePool};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct InstanceLimits {
    pub file_size_bytes: i64,
    pub room_size: i64,
    pub rooms_per_user: i64,
    pub devices_per_user: i64,
    pub keypackages_per_device: i64,
    pub message_size_bytes: i64,
    pub attachment_retention_days: i64,
    pub call_max_participants: i64,
    pub reactions_per_message: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ServerHardMax {
    pub file_size_bytes: i64,
    pub room_size: i64,
    pub rooms_per_user: i64,
    pub devices_per_user: i64,
    pub keypackages_per_device: i64,
    pub message_size_bytes: i64,
    pub attachment_retention_days: i64,
    pub call_max_participants: i64,
    pub reactions_per_message: i64,
}

impl Default for ServerHardMax {
    fn default() -> Self {
        Self {
            file_size_bytes: 104_857_600,
            room_size: 1000,
            rooms_per_user: 500,
            devices_per_user: 20,
            keypackages_per_device: 50,
            message_size_bytes: 65536,
            attachment_retention_days: 365,
            call_max_participants: 50,
            reactions_per_message: 50,
        }
    }
}

pub struct LimitMin;
impl LimitMin {
    pub const FILE_SIZE_BYTES: i64 = 1_048_576; // 1MB
    pub const ROOM_SIZE: i64 = 2;
    pub const ROOMS_PER_USER: i64 = 1;
    pub const DEVICES_PER_USER: i64 = 1;
    pub const KEYPACKAGES_PER_DEVICE: i64 = 1;
    pub const MESSAGE_SIZE_BYTES: i64 = 1024; // 1KB
    pub const ATTACHMENT_RETENTION_DAYS: i64 = 0;
    pub const CALL_MAX_PARTICIPANTS: i64 = 2;
    pub const REACTIONS_PER_MESSAGE: i64 = 1;
}

pub struct LimitDefault;
impl LimitDefault {
    pub const FILE_SIZE_BYTES: i64 = 104_857_600;
    pub const ROOM_SIZE: i64 = 100;
    pub const ROOMS_PER_USER: i64 = 50;
    pub const DEVICES_PER_USER: i64 = 10;
    pub const KEYPACKAGES_PER_DEVICE: i64 = 20;
    pub const MESSAGE_SIZE_BYTES: i64 = 16384;
    pub const ATTACHMENT_RETENTION_DAYS: i64 = 0;
    pub const CALL_MAX_PARTICIPANTS: i64 = 8;
    pub const REACTIONS_PER_MESSAGE: i64 = 50;
}

#[derive(thiserror::Error, Debug)]
pub enum LimitsError {
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("value for {key} ({value}) exceeds server hard max ({max})")]
    ExceedsServerMax { key: String, value: i64, max: i64 },
    #[error("value for {key} ({value}) is below minimum ({min})")]
    BelowMinimum { key: String, value: i64, min: i64 },
}

pub async fn get_limits(
    pool: &SqlitePool,
    server_max: &ServerHardMax,
) -> Result<InstanceLimits, LimitsError> {
    let rows = sqlx::query("SELECT key, value FROM instance_limits")
        .fetch_all(pool)
        .await?;

    let mut map: HashMap<String, i64> = HashMap::new();
    for row in rows {
        let k: String = row.get("key");
        let v_str: String = row.get("value");
        if let Ok(v) = v_str.parse::<i64>() {
            map.insert(k, v);
        }
    }

    let file_size_bytes = map
        .get("file_size_bytes")
        .copied()
        .unwrap_or(LimitDefault::FILE_SIZE_BYTES)
        .min(server_max.file_size_bytes);

    let room_size = map
        .get("room_size")
        .copied()
        .unwrap_or(LimitDefault::ROOM_SIZE)
        .min(server_max.room_size);

    let rooms_per_user = map
        .get("rooms_per_user")
        .copied()
        .unwrap_or(LimitDefault::ROOMS_PER_USER)
        .min(server_max.rooms_per_user);

    let devices_per_user = map
        .get("devices_per_user")
        .copied()
        .unwrap_or(LimitDefault::DEVICES_PER_USER)
        .min(server_max.devices_per_user);

    let keypackages_per_device = map
        .get("keypackages_per_device")
        .copied()
        .unwrap_or(LimitDefault::KEYPACKAGES_PER_DEVICE)
        .min(server_max.keypackages_per_device);

    let message_size_bytes = map
        .get("message_size_bytes")
        .copied()
        .unwrap_or(LimitDefault::MESSAGE_SIZE_BYTES)
        .min(server_max.message_size_bytes);

    let attachment_retention_days = map
        .get("attachment_retention_days")
        .copied()
        .unwrap_or(LimitDefault::ATTACHMENT_RETENTION_DAYS)
        .min(server_max.attachment_retention_days);

    let call_max_participants = map
        .get("call_max_participants")
        .copied()
        .unwrap_or(LimitDefault::CALL_MAX_PARTICIPANTS)
        .min(server_max.call_max_participants);

    let reactions_per_message = map
        .get("reactions_per_message")
        .copied()
        .unwrap_or(LimitDefault::REACTIONS_PER_MESSAGE)
        .min(server_max.reactions_per_message);

    Ok(InstanceLimits {
        file_size_bytes,
        room_size,
        rooms_per_user,
        devices_per_user,
        keypackages_per_device,
        message_size_bytes,
        attachment_retention_days,
        call_max_participants,
        reactions_per_message,
    })
}

pub async fn set_limits(
    pool: &SqlitePool,
    actor_id: &str,
    new_limits: &InstanceLimits,
    server_max: &ServerHardMax,
) -> Result<(), LimitsError> {
    validate_field(
        "file_size_bytes",
        new_limits.file_size_bytes,
        LimitMin::FILE_SIZE_BYTES,
        server_max.file_size_bytes,
    )?;
    validate_field(
        "room_size",
        new_limits.room_size,
        LimitMin::ROOM_SIZE,
        server_max.room_size,
    )?;
    validate_field(
        "rooms_per_user",
        new_limits.rooms_per_user,
        LimitMin::ROOMS_PER_USER,
        server_max.rooms_per_user,
    )?;
    validate_field(
        "devices_per_user",
        new_limits.devices_per_user,
        LimitMin::DEVICES_PER_USER,
        server_max.devices_per_user,
    )?;
    validate_field(
        "keypackages_per_device",
        new_limits.keypackages_per_device,
        LimitMin::KEYPACKAGES_PER_DEVICE,
        server_max.keypackages_per_device,
    )?;
    validate_field(
        "message_size_bytes",
        new_limits.message_size_bytes,
        LimitMin::MESSAGE_SIZE_BYTES,
        server_max.message_size_bytes,
    )?;
    validate_field(
        "attachment_retention_days",
        new_limits.attachment_retention_days,
        LimitMin::ATTACHMENT_RETENTION_DAYS,
        server_max.attachment_retention_days,
    )?;
    validate_field(
        "call_max_participants",
        new_limits.call_max_participants,
        LimitMin::CALL_MAX_PARTICIPANTS,
        server_max.call_max_participants,
    )?;
    validate_field(
        "reactions_per_message",
        new_limits.reactions_per_message,
        LimitMin::REACTIONS_PER_MESSAGE,
        server_max.reactions_per_message,
    )?;

    let mut tx = pool.begin().await?;

    let pairs = [
        ("file_size_bytes", new_limits.file_size_bytes),
        ("room_size", new_limits.room_size),
        ("rooms_per_user", new_limits.rooms_per_user),
        ("devices_per_user", new_limits.devices_per_user),
        ("keypackages_per_device", new_limits.keypackages_per_device),
        ("message_size_bytes", new_limits.message_size_bytes),
        (
            "attachment_retention_days",
            new_limits.attachment_retention_days,
        ),
        ("call_max_participants", new_limits.call_max_participants),
        ("reactions_per_message", new_limits.reactions_per_message),
    ];

    for (k, v) in pairs {
        let v_str = v.to_string();
        sqlx::query(
            r#"
            INSERT INTO instance_limits (key, value, updated_at, updated_by)
            VALUES (?, ?, CURRENT_TIMESTAMP, ?)
            ON CONFLICT(key) DO UPDATE SET
                value = excluded.value,
                updated_at = CURRENT_TIMESTAMP,
                updated_by = excluded.updated_by
            "#,
        )
        .bind(k)
        .bind(&v_str)
        .bind(actor_id)
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;

    let metadata = serde_json::to_value(new_limits).ok();
    let _ = audit::log(
        pool,
        Some(actor_id),
        audit::action::LIMITS_UPDATE,
        Some("instance_limits"),
        None,
        metadata,
    )
    .await;

    Ok(())
}

fn validate_field(key: &str, val: i64, min: i64, max: i64) -> Result<(), LimitsError> {
    if val < min {
        return Err(LimitsError::BelowMinimum {
            key: key.to_string(),
            value: val,
            min,
        });
    }
    if val > max {
        return Err(LimitsError::ExceedsServerMax {
            key: key.to_string(),
            value: val,
            max,
        });
    }
    Ok(())
}

pub fn effective_file_size_limit(
    user_override: Option<i64>,
    instance_limit: i64,
    server_max: i64,
) -> i64 {
    let candidate = match user_override {
        Some(v) if v > 0 => v,
        _ => instance_limit,
    };
    candidate.min(server_max)
}
