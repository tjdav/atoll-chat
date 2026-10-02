use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use chrono::{DateTime, Utc};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sqlx::{Row, SqlitePool};
use ulid::Ulid;

use crate::limits::{InstanceLimits, ServerHardMax};
use crate::sockudo::Publisher;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Room {
    pub id: String,
    pub owner_id: String,
    pub metadata: Option<String>,
    pub metadata_version: i64,
    pub retention_days: Option<i64>,
    pub max_file_size_bytes: Option<i64>,
    pub moderation_override: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize)]
pub struct RoomWithRole {
    #[serde(flatten)]
    pub room: Room,
    pub current_user_role: String,
    pub member_count: u32,
    pub effective_max_file_size_bytes: i64,
    pub effective_message_retention_days: i64,
}

/// Computes the effective file-size limit for a room.
/// Effective = MIN(room_override, instance_limit, server_max).
/// `room_override` is nullable; when None, the instance limit is used.
pub fn effective_file_size_limit(
    room_override: Option<i64>,
    instance_limit: i64,
    server_max: i64,
) -> i64 {
    let candidate = match room_override {
        Some(r) => r.min(instance_limit),
        None => instance_limit,
    };
    candidate.min(server_max)
}

/// Computes the effective message retention for a room, in days.
/// Returns 0 when retention is "forever" (no pruning).
/// Effective = MIN(room_override, instance_limit, server_max).
/// `room_override` is nullable; when None, the instance limit is used.
/// A value of 0 means "forever" and short-circuits the MIN — 0 is the
/// least restrictive value, so it wins over any larger limit.
pub fn effective_message_retention_days(
    room_override: Option<i64>,
    instance_limit: i64,
    server_max: i64,
) -> i64 {
    let candidate = match room_override {
        Some(r) if r > 0 => r.min(instance_limit),
        _ if room_override == Some(0) => 0,
        _ => instance_limit,
    };
    if candidate == 0 || instance_limit == 0 || server_max == 0 {
        0
    } else {
        candidate.min(server_max)
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct PendingRemove {
    pub id: String,
    pub room_id: String,
    pub target_user_id: String,
    pub target_client_id: String,
    pub queued_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize)]
pub struct RoomMember {
    pub user_id: String,
    pub username_token: String,
    pub encrypted_display: Option<String>,
    pub role: String,
    pub joined_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AddMemberOutcome {
    pub member: RoomMember,
    pub added_client_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PendingAddView {
    pub id: String,
    pub target_user_id: String,
    pub target_client_id: String,
    pub key_package_id: String,
    pub queued_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemberCursor {
    pub room_id: String,
    pub last_user_id: String,
}

impl MemberCursor {
    pub fn encode(&self) -> String {
        let json = serde_json::to_string(self).unwrap_or_default();
        URL_SAFE_NO_PAD.encode(json.as_bytes())
    }

    pub fn decode(encoded: &str) -> Option<Self> {
        let bytes = URL_SAFE_NO_PAD.decode(encoded.trim()).ok()?;
        serde_json::from_slice(&bytes).ok()
    }
}

#[derive(Debug, Clone)]
pub struct ListMembersQuery {
    pub room_id: String,
    pub requester_id: String,
    pub limit: usize,
    pub cursor: Option<MemberCursor>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ListMembersResult {
    pub members: Vec<RoomMember>,
    pub next_cursor: Option<String>,
    pub has_more: bool,
}

#[derive(Debug, Default)]
pub struct CreateRoomOptions {
    pub retention_days: Option<i64>,
    pub max_file_size_bytes: Option<i64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum LeaveOutcome {
    Left,
    TransferredOwnership { new_owner_id: String },
    RoomDeleted,
}

#[derive(Debug, thiserror::Error)]
pub enum RoomError {
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("room not found")]
    RoomNotFound,
    #[error("user not a member of this room")]
    NotAMember,
    #[error("insufficient privileges")]
    Forbidden,
    #[error("room is full")]
    RoomFull,
    #[error("user not found")]
    UserNotFound,
    #[error("user already a member")]
    AlreadyMember,
    #[error("rooms per user limit reached")]
    RoomLimitReached,
    #[error("invalid retention value")]
    InvalidRetention,
    #[error("invalid file size value")]
    InvalidFileSize,
    #[error("target is not a member of this room")]
    TargetNotAMember,
    #[error("cannot kick the room owner")]
    CannotKickOwner,
    #[error("cannot kick yourself")]
    CannotKickSelf,
    #[error("moderation requires Discord mode")]
    ModerationDisabled,
    #[error("target is already a moderator")]
    AlreadyModerator,
    #[error("target is not a moderator")]
    NotAModerator,
    #[error("cannot promote or demote the room owner")]
    CannotModifyOwner,
    #[error("target is already the room owner")]
    AlreadyOwner,
    #[error("cannot transfer ownership to yourself")]
    CannotTransferToSelf,
    #[error("target user has no registered devices")]
    TargetHasNoDevice,
    #[error("pending remove not found")]
    RemoveNotFound,
    #[error("pending add not found")]
    PendingAddNotFound,
    #[error("pending add already consumed")]
    AlreadyConsumed,
}

#[derive(Debug, thiserror::Error)]
pub enum RoomMetadataError {
    #[error("metadata exceeds {0} bytes (got {1})")]
    TooLarge(usize, usize),
    #[error("metadata must be valid base64url")]
    InvalidEncoding,
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("room not found")]
    RoomNotFound,
    #[error("not a member")]
    NotAMember,
    #[error("insufficient privileges")]
    Forbidden,
}

/// Validates that the metadata blob is a well-formed base64url string
/// that decodes to at most `max_bytes` bytes.
pub fn validate_metadata_blob(value: &str, max_bytes: usize) -> Result<(), RoomMetadataError> {
    use base64::engine::general_purpose::{URL_SAFE, URL_SAFE_NO_PAD};

    let bytes = URL_SAFE_NO_PAD
        .decode(value)
        .or_else(|_| URL_SAFE.decode(value))
        .map_err(|_| RoomMetadataError::InvalidEncoding)?;

    if bytes.len() > max_bytes {
        return Err(RoomMetadataError::TooLarge(max_bytes, bytes.len()));
    }

    Ok(())
}

#[derive(Debug, Serialize)]
pub struct RoomMetadataResult {
    pub room_id: String,
    pub metadata: Option<String>,
    pub metadata_version: i64,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize)]
pub struct RetentionPreviewResult {
    pub current_retention_days: i64,
    pub proposed_retention_days: i64,
    pub messages_affected: i64,
    pub attachments_affected: i64,
    pub oldest_affected_at: Option<DateTime<Utc>>,
    pub newest_affected_at: Option<DateTime<Utc>>,
}

pub async fn preview_retention_change(
    pool: &SqlitePool,
    room_id: &str,
    proposed_retention_days: i64,
    limits: &InstanceLimits,
    server_max: &ServerHardMax,
) -> Result<RetentionPreviewResult, RoomError> {
    let room_row: Option<(Option<i64>,)> =
        sqlx::query_as("SELECT retention_days FROM rooms WHERE id = ?")
            .bind(room_id)
            .fetch_optional(pool)
            .await?;

    let room_retention = match room_row {
        Some((r,)) => r,
        None => return Err(RoomError::RoomNotFound),
    };

    let current_retention_days = effective_message_retention_days(
        room_retention,
        limits.attachment_retention_days,
        server_max.attachment_retention_days,
    );

    if proposed_retention_days == 0 {
        return Ok(RetentionPreviewResult {
            current_retention_days,
            proposed_retention_days: 0,
            messages_affected: 0,
            attachments_affected: 0,
            oldest_affected_at: None,
            newest_affected_at: None,
        });
    }

    let msg_stats: (i64, Option<DateTime<Utc>>, Option<DateTime<Utc>>) = sqlx::query_as(
        r#"
        SELECT
            COUNT(*),
            MIN(created_at),
            MAX(created_at)
        FROM room_messages
        WHERE room_id = ?
          AND created_at < datetime('now', '-' || ? || ' days')
          AND deleted_at IS NULL
          AND content_type NOT IN ('commit', 'proposal')
        "#,
    )
    .bind(room_id)
    .bind(proposed_retention_days)
    .fetch_one(pool)
    .await?;

    let messages_affected = msg_stats.0;
    let oldest_affected_at = if messages_affected > 0 {
        msg_stats.1
    } else {
        None
    };
    let newest_affected_at = if messages_affected > 0 {
        msg_stats.2
    } else {
        None
    };

    let att_count: (i64,) = sqlx::query_as(
        r#"
        SELECT COUNT(*)
        FROM attachments
        WHERE room_id = ?
          AND created_at < datetime('now', '-' || ? || ' days')
        "#,
    )
    .bind(room_id)
    .bind(proposed_retention_days)
    .fetch_one(pool)
    .await?;

    Ok(RetentionPreviewResult {
        current_retention_days,
        proposed_retention_days,
        messages_affected,
        attachments_affected: att_count.0,
        oldest_affected_at,
        newest_affected_at,
    })
}

pub async fn update_room_metadata(
    pool: &SqlitePool,
    publisher: &Publisher,
    room_id: &str,
    requester_id: &str,
    metadata: Option<&str>,
    max_metadata_bytes: usize,
) -> Result<RoomMetadataResult, RoomMetadataError> {
    let mut tx = pool.begin().await?;

    // 1. Verify requester membership
    let member_role: Option<(String,)> =
        sqlx::query_as("SELECT role FROM room_members WHERE room_id = ? AND user_id = ?")
            .bind(room_id)
            .bind(requester_id)
            .fetch_optional(&mut *tx)
            .await?;

    let role = match member_role {
        Some((r,)) => r,
        None => return Err(RoomMetadataError::RoomNotFound),
    };

    // 2. Verify requester is room owner
    if role != "owner" {
        return Err(RoomMetadataError::Forbidden);
    }

    // 3. Validate metadata blob if present
    let clean_metadata = if let Some(m) = metadata {
        validate_metadata_blob(m, max_metadata_bytes)?;
        // Store canonical unpadded string or verbatim input if valid
        use base64::engine::general_purpose::{URL_SAFE, URL_SAFE_NO_PAD};
        let decoded = URL_SAFE_NO_PAD
            .decode(m)
            .or_else(|_| URL_SAFE.decode(m))
            .map_err(|_| RoomMetadataError::InvalidEncoding)?;
        Some(URL_SAFE_NO_PAD.encode(decoded))
    } else {
        None
    };

    // 4. Update row
    sqlx::query(
        r#"
        UPDATE rooms
        SET metadata = ?,
            metadata_version = metadata_version + 1
        WHERE id = ?
        "#,
    )
    .bind(&clean_metadata)
    .bind(room_id)
    .execute(&mut *tx)
    .await?;

    // 5. Read back updated row
    let row: (Option<String>, i64, DateTime<Utc>) = sqlx::query_as(
        r#"
        SELECT metadata, metadata_version, created_at
        FROM rooms
        WHERE id = ?
        "#,
    )
    .bind(room_id)
    .fetch_one(&mut *tx)
    .await?;

    tx.commit().await?;

    let result = RoomMetadataResult {
        room_id: room_id.to_string(),
        metadata: row.0,
        metadata_version: row.1,
        updated_at: Utc::now(),
    };

    // 6. Post-commit: publish room.updated
    let payload = serde_json::json!({
        "room_id": result.room_id,
        "metadata_version": result.metadata_version,
    });
    let channel = format!("private-room-{}", room_id);
    if let Err(e) = publisher.publish(&channel, "room.updated", payload).await {
        tracing::warn!(error = %e, room_id = %room_id, "room.updated publish failed");
    }

    Ok(result)
}

pub async fn create_room(
    pool: &SqlitePool,
    owner_id: &str,
    options: CreateRoomOptions,
    limits: &InstanceLimits,
    server_max: &ServerHardMax,
) -> Result<Room, RoomError> {
    let mut tx = pool.begin().await?;

    // 1. Check room count for owner
    let count_row: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM room_members WHERE user_id = ?")
        .bind(owner_id)
        .fetch_one(&mut *tx)
        .await?;

    let effective_limit = limits.rooms_per_user.min(server_max.rooms_per_user);
    if count_row.0 >= effective_limit {
        return Err(RoomError::RoomLimitReached);
    }

    // 2. Validate retention_days
    let clamped_retention = if let Some(r) = options.retention_days {
        if !(0..=365).contains(&r) {
            return Err(RoomError::InvalidRetention);
        }

        let mut clamped = r;
        if limits.attachment_retention_days > 0 {
            clamped = clamped.min(limits.attachment_retention_days);
        }
        if server_max.attachment_retention_days > 0 {
            clamped = clamped.min(server_max.attachment_retention_days);
        }
        Some(clamped)
    } else {
        None
    };

    // 3. Validate max_file_size_bytes
    let clamped_file_size = if let Some(f) = options.max_file_size_bytes {
        if f < 1 || f > server_max.file_size_bytes {
            return Err(RoomError::InvalidFileSize);
        }

        Some(
            f.min(limits.file_size_bytes)
                .min(server_max.file_size_bytes),
        )
    } else {
        None
    };

    // 4. Generate room ID (16 random bytes base64url unpadded = 22 chars)
    let mut bytes = [0u8; 16];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    let room_id = URL_SAFE_NO_PAD.encode(bytes);

    // 5. Insert into rooms
    sqlx::query(
        r#"
        INSERT INTO rooms (id, owner_id, retention_days, max_file_size_bytes)
        VALUES (?, ?, ?, ?)
        "#,
    )
    .bind(&room_id)
    .bind(owner_id)
    .bind(clamped_retention)
    .bind(clamped_file_size)
    .execute(&mut *tx)
    .await?;

    // 6. Insert into room_members
    sqlx::query(
        r#"
        INSERT INTO room_members (room_id, user_id, role, joined_via)
        VALUES (?, ?, 'owner', 'create')
        "#,
    )
    .bind(&room_id)
    .bind(owner_id)
    .execute(&mut *tx)
    .await?;

    // 7. Insert into room_epochs
    sqlx::query(
        r#"
        INSERT INTO room_epochs (room_id, epoch, sequence)
        VALUES (?, 0, 0)
        "#,
    )
    .bind(&room_id)
    .execute(&mut *tx)
    .await?;

    // 8. Fetch the created room to get created_at
    let room = sqlx::query_as::<_, Room>(
        r#"
        SELECT id, owner_id, metadata, metadata_version, retention_days, max_file_size_bytes, moderation_override, created_at
        FROM rooms
        WHERE id = ?
        "#,
    )
    .bind(&room_id)
    .fetch_one(&mut *tx)
    .await?;

    tx.commit().await?;

    Ok(room)
}

pub async fn list_rooms_for_user(
    pool: &SqlitePool,
    user_id: &str,
) -> Result<Vec<RoomWithRole>, RoomError> {
    let rows = sqlx::query(
        r#"
        SELECT r.id, r.owner_id, r.metadata, r.metadata_version, r.retention_days, r.max_file_size_bytes, r.moderation_override, r.created_at,
               rm.role AS current_user_role,
               (SELECT COUNT(*) FROM room_members WHERE room_id = r.id) AS member_count
        FROM rooms r
        JOIN room_members rm ON rm.room_id = r.id
        WHERE rm.user_id = ?
        ORDER BY rm.joined_at DESC
        "#,
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?;

    let mut result = Vec::new();
    for row in rows {
        let room = Room {
            id: row.get("id"),
            owner_id: row.get("owner_id"),
            metadata: row.get("metadata"),
            metadata_version: row.get("metadata_version"),
            retention_days: row.get("retention_days"),
            max_file_size_bytes: row.get("max_file_size_bytes"),
            moderation_override: row.get("moderation_override"),
            created_at: row.get("created_at"),
        };
        let current_user_role: String = row.get("current_user_role");
        let member_count: i64 = row.get("member_count");

        result.push(RoomWithRole {
            room,
            current_user_role,
            member_count: member_count as u32,
            effective_max_file_size_bytes: 0,
            effective_message_retention_days: 0,
        });
    }

    Ok(result)
}

pub async fn get_room_for_user(
    pool: &SqlitePool,
    room_id: &str,
    user_id: &str,
) -> Result<Option<RoomWithRole>, RoomError> {
    let row_opt = sqlx::query(
        r#"
        SELECT r.id, r.owner_id, r.metadata, r.metadata_version, r.retention_days, r.max_file_size_bytes, r.moderation_override, r.created_at,
               rm.role AS current_user_role,
               (SELECT COUNT(*) FROM room_members WHERE room_id = r.id) AS member_count
        FROM rooms r
        JOIN room_members rm ON rm.room_id = r.id
        WHERE r.id = ? AND rm.user_id = ?
        "#,
    )
    .bind(room_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await?;

    if let Some(row) = row_opt {
        let room = Room {
            id: row.get("id"),
            owner_id: row.get("owner_id"),
            metadata: row.get("metadata"),
            metadata_version: row.get("metadata_version"),
            retention_days: row.get("retention_days"),
            max_file_size_bytes: row.get("max_file_size_bytes"),
            moderation_override: row.get("moderation_override"),
            created_at: row.get("created_at"),
        };
        let current_user_role: String = row.get("current_user_role");
        let member_count: i64 = row.get("member_count");

        Ok(Some(RoomWithRole {
            room,
            current_user_role,
            member_count: member_count as u32,
            effective_max_file_size_bytes: 0,
            effective_message_retention_days: 0,
        }))
    } else {
        Ok(None)
    }
}

pub async fn delete_room(pool: &SqlitePool, room_id: &str, user_id: &str) -> Result<(), RoomError> {
    let mut tx = pool.begin().await?;

    // 1. Fetch room
    let room_exists: Option<(String,)> = sqlx::query_as("SELECT owner_id FROM rooms WHERE id = ?")
        .bind(room_id)
        .fetch_optional(&mut *tx)
        .await?;

    if room_exists.is_none() {
        return Err(RoomError::RoomNotFound);
    }

    // 2. Fetch membership
    let member_role: Option<(String,)> =
        sqlx::query_as("SELECT role FROM room_members WHERE room_id = ? AND user_id = ?")
            .bind(room_id)
            .bind(user_id)
            .fetch_optional(&mut *tx)
            .await?;

    let role = match member_role {
        Some((r,)) => r,
        None => return Err(RoomError::NotAMember),
    };

    // 3. Check ownership
    if role != "owner" {
        return Err(RoomError::Forbidden);
    }

    // 4. Delete room (ON DELETE CASCADE handles relations)
    sqlx::query("DELETE FROM rooms WHERE id = ?")
        .bind(room_id)
        .execute(&mut *tx)
        .await?;

    tx.commit().await?;

    Ok(())
}

pub async fn list_pending_removes(
    pool: &SqlitePool,
    room_id: &str,
    requester_id: &str,
) -> Result<Vec<PendingRemove>, RoomError> {
    let is_member: Option<(i32,)> =
        sqlx::query_as("SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?")
            .bind(room_id)
            .bind(requester_id)
            .fetch_optional(pool)
            .await?;

    if is_member.is_none() {
        return Err(RoomError::NotAMember);
    }

    let rows = sqlx::query(
        r#"
        SELECT id, room_id, target_user_id, target_client_id, queued_at
        FROM pending_mls_removes
        WHERE room_id = ? AND consumed_at IS NULL
        ORDER BY queued_at ASC
        "#,
    )
    .bind(room_id)
    .fetch_all(pool)
    .await?;

    let mut removes = Vec::new();
    for row in rows {
        removes.push(PendingRemove {
            id: row.get("id"),
            room_id: row.get("room_id"),
            target_user_id: row.get("target_user_id"),
            target_client_id: row.get("target_client_id"),
            queued_at: row.get("queued_at"),
        });
    }

    Ok(removes)
}

pub async fn consume_pending_remove(
    pool: &SqlitePool,
    room_id: &str,
    remove_id: &str,
    requester_id: &str,
) -> Result<(), RoomError> {
    let mut tx = pool.begin().await?;

    let is_member: Option<(i32,)> =
        sqlx::query_as("SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?")
            .bind(room_id)
            .bind(requester_id)
            .fetch_optional(&mut *tx)
            .await?;

    if is_member.is_none() {
        return Err(RoomError::NotAMember);
    }

    let row: Option<(Option<DateTime<Utc>>,)> =
        sqlx::query_as("SELECT consumed_at FROM pending_mls_removes WHERE id = ? AND room_id = ?")
            .bind(remove_id)
            .bind(room_id)
            .fetch_optional(&mut *tx)
            .await?;

    match row {
        Some((None,)) => {
            sqlx::query(
                "UPDATE pending_mls_removes SET consumed_at = CURRENT_TIMESTAMP WHERE id = ? AND room_id = ?",
            )
            .bind(remove_id)
            .bind(room_id)
            .execute(&mut *tx)
            .await?;

            tx.commit().await?;
            Ok(())
        }
        _ => Err(RoomError::RemoveNotFound),
    }
}

pub async fn leave_room(
    pool: &SqlitePool,
    room_id: &str,
    user_id: &str,
) -> Result<LeaveOutcome, RoomError> {
    let mut tx = pool.begin().await?;

    // 1. Fetch requester membership
    let member_role: Option<(String,)> =
        sqlx::query_as("SELECT role FROM room_members WHERE room_id = ? AND user_id = ?")
            .bind(room_id)
            .bind(user_id)
            .fetch_optional(&mut *tx)
            .await?;

    if member_role.is_none() {
        return Err(RoomError::NotAMember);
    }

    // 2. Fetch room
    let room_opt: Option<(String,)> = sqlx::query_as("SELECT owner_id FROM rooms WHERE id = ?")
        .bind(room_id)
        .fetch_optional(&mut *tx)
        .await?;

    let owner_id = match room_opt {
        Some((o,)) => o,
        None => return Err(RoomError::RoomNotFound),
    };

    // 3. Count other members
    let other_count: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM room_members WHERE room_id = ? AND user_id != ?")
            .bind(room_id)
            .bind(user_id)
            .fetch_one(&mut *tx)
            .await?;

    if other_count.0 == 0 {
        // Delete room
        sqlx::query("DELETE FROM rooms WHERE id = ?")
            .bind(room_id)
            .execute(&mut *tx)
            .await?;

        tx.commit().await?;
        return Ok(LeaveOutcome::RoomDeleted);
    }

    if user_id != owner_id {
        // Regular member leave
        sqlx::query("DELETE FROM room_members WHERE room_id = ? AND user_id = ?")
            .bind(room_id)
            .bind(user_id)
            .execute(&mut *tx)
            .await?;

        tx.commit().await?;
        return Ok(LeaveOutcome::Left);
    }

    // Owner leave with other members -> find successor
    let successor: Option<(String,)> = sqlx::query_as(
        r#"
        SELECT user_id FROM room_members
        WHERE room_id = ? AND user_id != ?
        ORDER BY CASE role
            WHEN 'moderator' THEN 0
            WHEN 'member' THEN 1
            ELSE 2
        END, joined_at ASC
        LIMIT 1
        "#,
    )
    .bind(room_id)
    .bind(user_id)
    .fetch_optional(&mut *tx)
    .await?;

    let new_owner_id = match successor {
        Some((id,)) => id,
        None => {
            // Fallback: delete room if no successor found
            sqlx::query("DELETE FROM rooms WHERE id = ?")
                .bind(room_id)
                .execute(&mut *tx)
                .await?;

            tx.commit().await?;
            return Ok(LeaveOutcome::RoomDeleted);
        }
    };

    // Promote successor to owner
    sqlx::query("UPDATE room_members SET role = 'owner' WHERE room_id = ? AND user_id = ?")
        .bind(room_id)
        .bind(&new_owner_id)
        .execute(&mut *tx)
        .await?;

    // Update room owner_id
    sqlx::query("UPDATE rooms SET owner_id = ? WHERE id = ?")
        .bind(&new_owner_id)
        .bind(room_id)
        .execute(&mut *tx)
        .await?;

    // Delete requester's membership
    sqlx::query("DELETE FROM room_members WHERE room_id = ? AND user_id = ?")
        .bind(room_id)
        .bind(user_id)
        .execute(&mut *tx)
        .await?;

    tx.commit().await?;

    Ok(LeaveOutcome::TransferredOwnership { new_owner_id })
}

/// Pagination is best-effort under concurrent membership changes.
pub async fn list_members(
    pool: &SqlitePool,
    query: ListMembersQuery,
) -> Result<ListMembersResult, RoomError> {
    // 1. Verify requester is a member
    let is_member: Option<(i32,)> =
        sqlx::query_as("SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?")
            .bind(&query.room_id)
            .bind(&query.requester_id)
            .fetch_optional(pool)
            .await?;

    if is_member.is_none() {
        return Err(RoomError::NotAMember);
    }

    let fetch_limit = query.limit + 1;

    let rows = if let Some(ref cursor) = query.cursor {
        sqlx::query(
            r#"
            SELECT rm.user_id, u.username_token, u.encrypted_display, rm.role, rm.joined_at
            FROM room_members rm
            JOIN users u ON u.id = rm.user_id
            WHERE rm.room_id = ? AND rm.user_id > ?
            ORDER BY rm.user_id ASC
            LIMIT ?
            "#,
        )
        .bind(&query.room_id)
        .bind(&cursor.last_user_id)
        .bind(fetch_limit as i64)
        .fetch_all(pool)
        .await?
    } else {
        sqlx::query(
            r#"
            SELECT rm.user_id, u.username_token, u.encrypted_display, rm.role, rm.joined_at
            FROM room_members rm
            JOIN users u ON u.id = rm.user_id
            WHERE rm.room_id = ?
            ORDER BY rm.user_id ASC
            LIMIT ?
            "#,
        )
        .bind(&query.room_id)
        .bind(fetch_limit as i64)
        .fetch_all(pool)
        .await?
    };

    let mut members = Vec::new();
    for row in rows {
        members.push(RoomMember {
            user_id: row.get("user_id"),
            username_token: row.get("username_token"),
            encrypted_display: row.get("encrypted_display"),
            role: row.get("role"),
            joined_at: row.get("joined_at"),
        });
    }

    let has_more = members.len() > query.limit;
    if has_more {
        members.truncate(query.limit);
    }

    let next_cursor = if has_more {
        members.last().map(|m| {
            MemberCursor {
                room_id: query.room_id.clone(),
                last_user_id: m.user_id.clone(),
            }
            .encode()
        })
    } else {
        None
    };

    Ok(ListMembersResult {
        members,
        next_cursor,
        has_more,
    })
}

pub async fn list_pending_adds(
    pool: &SqlitePool,
    room_id: &str,
    requester_id: &str,
) -> Result<Vec<PendingAddView>, RoomError> {
    let is_member: Option<(i32,)> =
        sqlx::query_as("SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?")
            .bind(room_id)
            .bind(requester_id)
            .fetch_optional(pool)
            .await?;

    if is_member.is_none() {
        return Err(RoomError::NotAMember);
    }

    let rows = sqlx::query(
        r#"
        SELECT id, target_user_id, target_client_id, key_package_id, queued_at
        FROM pending_mls_adds
        WHERE room_id = ? AND consumed_at IS NULL
        ORDER BY queued_at ASC, id ASC
        "#,
    )
    .bind(room_id)
    .fetch_all(pool)
    .await?;

    let mut pending_adds = Vec::new();
    for row in rows {
        pending_adds.push(PendingAddView {
            id: row.get("id"),
            target_user_id: row.get("target_user_id"),
            target_client_id: row.get("target_client_id"),
            key_package_id: row.get("key_package_id"),
            queued_at: row.get("queued_at"),
        });
    }

    Ok(pending_adds)
}

pub async fn consume_pending_add(
    pool: &SqlitePool,
    room_id: &str,
    add_id: &str,
    requester_id: &str,
) -> Result<DateTime<Utc>, RoomError> {
    let mut tx = pool.begin().await?;

    let is_member: Option<(i32,)> =
        sqlx::query_as("SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?")
            .bind(room_id)
            .bind(requester_id)
            .fetch_optional(&mut *tx)
            .await?;

    if is_member.is_none() {
        return Err(RoomError::NotAMember);
    }

    let row_opt: Option<(Option<DateTime<Utc>>,)> =
        sqlx::query_as("SELECT consumed_at FROM pending_mls_adds WHERE id = ? AND room_id = ?")
            .bind(add_id)
            .bind(room_id)
            .fetch_optional(&mut *tx)
            .await?;

    let consumed_at_opt = match row_opt {
        Some((c,)) => c,
        None => return Err(RoomError::PendingAddNotFound),
    };

    if consumed_at_opt.is_some() {
        return Err(RoomError::AlreadyConsumed);
    }

    let now = Utc::now();

    sqlx::query("UPDATE pending_mls_adds SET consumed_at = ? WHERE id = ? AND room_id = ?")
        .bind(now)
        .bind(add_id)
        .bind(room_id)
        .execute(&mut *tx)
        .await?;

    tx.commit().await?;

    Ok(now)
}

pub async fn add_member(
    pool: &SqlitePool,
    room_id: &str,
    requester_id: &str,
    target_user_id: &str,
    welcome_data: Option<Vec<u8>>,
    limits: &InstanceLimits,
    server_max: &ServerHardMax,
) -> Result<AddMemberOutcome, RoomError> {
    let mut tx = pool.begin().await?;

    // 1. Verify requester is member
    let requester_role: Option<(String,)> =
        sqlx::query_as("SELECT role FROM room_members WHERE room_id = ? AND user_id = ?")
            .bind(room_id)
            .bind(requester_id)
            .fetch_optional(&mut *tx)
            .await?;

    let role = match requester_role {
        Some((r,)) => r,
        None => return Err(RoomError::NotAMember),
    };

    // 2. Fetch room
    let room_opt: Option<(String,)> = sqlx::query_as("SELECT owner_id FROM rooms WHERE id = ?")
        .bind(room_id)
        .fetch_optional(&mut *tx)
        .await?;

    let owner_id = match room_opt {
        Some((o,)) => o,
        None => return Err(RoomError::RoomNotFound),
    };

    // 3. Verify requester is owner
    if role != "owner" && requester_id != owner_id {
        return Err(RoomError::Forbidden);
    }

    // 4. Verify target user exists and deleted_at IS NULL
    let target_user: Option<(String, String, Option<String>)> = sqlx::query_as(
        "SELECT id, username_token, encrypted_display FROM users WHERE id = ? AND deleted_at IS NULL",
    )
    .bind(target_user_id)
    .fetch_optional(&mut *tx)
    .await?;

    if target_user.is_none() {
        return Err(RoomError::UserNotFound);
    }

    // 5. Check whether target is already a member
    let already: Option<(i32,)> =
        sqlx::query_as("SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?")
            .bind(room_id)
            .bind(target_user_id)
            .fetch_optional(&mut *tx)
            .await?;

    if already.is_some() {
        return Err(RoomError::AlreadyMember);
    }

    // 6. Count current members
    let current_count: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM room_members WHERE room_id = ?")
            .bind(room_id)
            .fetch_one(&mut *tx)
            .await?;

    let effective_max_size = limits.room_size.min(server_max.room_size);
    if current_count.0 >= effective_max_size {
        return Err(RoomError::RoomFull);
    }

    // 7. Handle welcome if provided
    if let Some(blob) = welcome_data {
        let client_row: Option<(String,)> = sqlx::query_as(
            "SELECT client_id FROM devices WHERE user_id = ? ORDER BY created_at DESC LIMIT 1",
        )
        .bind(target_user_id)
        .fetch_optional(&mut *tx)
        .await?;

        let client_id = match client_row {
            Some((c,)) => c,
            None => return Err(RoomError::TargetHasNoDevice),
        };

        crate::welcomes::create_welcome(&mut tx, room_id, target_user_id, &client_id, &blob)
            .await
            .map_err(|e| match e {
                crate::welcomes::WelcomeError::Database(err) => RoomError::Database(err),
                _ => RoomError::Database(sqlx::Error::RowNotFound),
            })?;
    }

    // 8. Insert into room_members
    sqlx::query(
        r#"
        INSERT INTO room_members (room_id, user_id, role, joined_via)
        VALUES (?, ?, 'member', 'add')
        "#,
    )
    .bind(room_id)
    .bind(target_user_id)
    .execute(&mut *tx)
    .await?;

    // 9. Look up target user's devices and insert pending_mls_adds
    let devices: Vec<(String,)> =
        sqlx::query_as("SELECT client_id FROM devices WHERE user_id = ? ORDER BY created_at ASC")
            .bind(target_user_id)
            .fetch_all(&mut *tx)
            .await?;

    let mut added_client_ids = Vec::new();

    for (client_id,) in devices {
        // Select unconsumed non-last-resort key package
        let normal_pkg: Option<(String, i64)> = sqlx::query_as(
            r#"
            SELECT id, is_last_resort
            FROM key_packages
            WHERE user_id = ? AND client_id = ? AND consumed = 0 AND is_last_resort = 0
            ORDER BY created_at ASC, id ASC
            LIMIT 1
            "#,
        )
        .bind(target_user_id)
        .bind(&client_id)
        .fetch_optional(&mut *tx)
        .await?;

        let pkg = match normal_pkg {
            Some(p) => Some(p),
            None => {
                // Fallback to unconsumed last-resort key package
                sqlx::query_as(
                    r#"
                    SELECT id, is_last_resort
                    FROM key_packages
                    WHERE user_id = ? AND client_id = ? AND consumed = 0 AND is_last_resort = 1
                    ORDER BY created_at ASC, id ASC
                    LIMIT 1
                    "#,
                )
                .bind(target_user_id)
                .bind(&client_id)
                .fetch_optional(&mut *tx)
                .await?
            }
        };

        if let Some((kp_id, is_last_resort_i64)) = pkg {
            if is_last_resort_i64 == 0 {
                sqlx::query(
                    "UPDATE key_packages SET consumed = 1, consumed_at = CURRENT_TIMESTAMP WHERE id = ?",
                )
                .bind(&kp_id)
                .execute(&mut *tx)
                .await?;
            }

            let add_id = Ulid::new().to_string();
            sqlx::query(
                r#"
                INSERT INTO pending_mls_adds (id, room_id, target_user_id, target_client_id, key_package_id)
                VALUES (?, ?, ?, ?, ?)
                "#,
            )
            .bind(&add_id)
            .bind(room_id)
            .bind(target_user_id)
            .bind(&client_id)
            .bind(&kp_id)
            .execute(&mut *tx)
            .await?;

            added_client_ids.push(client_id);
        } else {
            tracing::warn!(
                user_id = %target_user_id,
                client_id = %client_id,
                "No unconsumed key package available for target device"
            );
        }
    }

    // 10. Fetch the new member record
    let row = sqlx::query(
        r#"
        SELECT rm.user_id, u.username_token, u.encrypted_display, rm.role, rm.joined_at
        FROM room_members rm
        JOIN users u ON u.id = rm.user_id
        WHERE rm.room_id = ? AND rm.user_id = ?
        "#,
    )
    .bind(room_id)
    .bind(target_user_id)
    .fetch_one(&mut *tx)
    .await?;

    let member = RoomMember {
        user_id: row.get("user_id"),
        username_token: row.get("username_token"),
        encrypted_display: row.get("encrypted_display"),
        role: row.get("role"),
        joined_at: row.get("joined_at"),
    };

    tx.commit().await?;

    Ok(AddMemberOutcome {
        member,
        added_client_ids,
    })
}

pub async fn kick_member(
    pool: &SqlitePool,
    room_id: &str,
    requester_id: &str,
    target_user_id: &str,
    moderation_mode: &str,
) -> Result<(), RoomError> {
    let mut tx = pool.begin().await?;

    // 1. Fetch requester's membership
    let requester_role: Option<(String,)> =
        sqlx::query_as("SELECT role FROM room_members WHERE room_id = ? AND user_id = ?")
            .bind(room_id)
            .bind(requester_id)
            .fetch_optional(&mut *tx)
            .await?;

    let req_role = match requester_role {
        Some((r,)) => r,
        None => return Err(RoomError::NotAMember),
    };

    // 2. Fetch target's membership
    let target_role: Option<(String,)> =
        sqlx::query_as("SELECT role FROM room_members WHERE room_id = ? AND user_id = ?")
            .bind(room_id)
            .bind(target_user_id)
            .fetch_optional(&mut *tx)
            .await?;

    let targ_role = match target_role {
        Some((r,)) => r,
        None => return Err(RoomError::TargetNotAMember),
    };

    // 3. Authorization check
    if !(req_role == "owner" || (req_role == "moderator" && moderation_mode == "discord")) {
        return Err(RoomError::Forbidden);
    }

    // 4. Target checks
    if target_user_id == requester_id {
        return Err(RoomError::CannotKickSelf);
    }
    if targ_role == "owner" {
        return Err(RoomError::CannotKickOwner);
    }

    // 5. Delete target's room_members row
    sqlx::query("DELETE FROM room_members WHERE room_id = ? AND user_id = ?")
        .bind(room_id)
        .bind(target_user_id)
        .execute(&mut *tx)
        .await?;

    // 6. Queue MLS Removes for every device target has
    let devices: Vec<(String,)> = sqlx::query_as("SELECT client_id FROM devices WHERE user_id = ?")
        .bind(target_user_id)
        .fetch_all(&mut *tx)
        .await?;

    for (client_id,) in devices {
        let remove_id = Ulid::new().to_string();
        sqlx::query(
            r#"
            INSERT INTO pending_mls_removes (id, room_id, target_user_id, target_client_id)
            VALUES (?, ?, ?, ?)
            "#,
        )
        .bind(&remove_id)
        .bind(room_id)
        .bind(target_user_id)
        .bind(&client_id)
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;

    Ok(())
}

pub async fn promote_member(
    pool: &SqlitePool,
    room_id: &str,
    requester_id: &str,
    target_user_id: &str,
    moderation_mode: &str,
) -> Result<(), RoomError> {
    if moderation_mode != "discord" {
        return Err(RoomError::ModerationDisabled);
    }

    let mut tx = pool.begin().await?;

    // 1. Fetch requester's membership
    let requester_role: Option<(String,)> =
        sqlx::query_as("SELECT role FROM room_members WHERE room_id = ? AND user_id = ?")
            .bind(room_id)
            .bind(requester_id)
            .fetch_optional(&mut *tx)
            .await?;

    let req_role = match requester_role {
        Some((r,)) => r,
        None => return Err(RoomError::NotAMember),
    };

    if req_role != "owner" {
        return Err(RoomError::Forbidden);
    }

    // 2. Fetch target's membership
    let target_role: Option<(String,)> =
        sqlx::query_as("SELECT role FROM room_members WHERE room_id = ? AND user_id = ?")
            .bind(room_id)
            .bind(target_user_id)
            .fetch_optional(&mut *tx)
            .await?;

    let targ_role = match target_role {
        Some((r,)) => r,
        None => return Err(RoomError::TargetNotAMember),
    };

    if targ_role == "owner" {
        return Err(RoomError::CannotModifyOwner);
    }
    if targ_role == "moderator" {
        return Err(RoomError::AlreadyModerator);
    }

    // 3. Update target role
    sqlx::query("UPDATE room_members SET role = 'moderator' WHERE room_id = ? AND user_id = ?")
        .bind(room_id)
        .bind(target_user_id)
        .execute(&mut *tx)
        .await?;

    tx.commit().await?;

    Ok(())
}

pub async fn demote_member(
    pool: &SqlitePool,
    room_id: &str,
    requester_id: &str,
    target_user_id: &str,
    moderation_mode: &str,
) -> Result<(), RoomError> {
    if moderation_mode != "discord" {
        return Err(RoomError::ModerationDisabled);
    }

    let mut tx = pool.begin().await?;

    // 1. Fetch requester's membership
    let requester_role: Option<(String,)> =
        sqlx::query_as("SELECT role FROM room_members WHERE room_id = ? AND user_id = ?")
            .bind(room_id)
            .bind(requester_id)
            .fetch_optional(&mut *tx)
            .await?;

    let req_role = match requester_role {
        Some((r,)) => r,
        None => return Err(RoomError::NotAMember),
    };

    if req_role != "owner" {
        return Err(RoomError::Forbidden);
    }

    // 2. Fetch target's membership
    let target_role: Option<(String,)> =
        sqlx::query_as("SELECT role FROM room_members WHERE room_id = ? AND user_id = ?")
            .bind(room_id)
            .bind(target_user_id)
            .fetch_optional(&mut *tx)
            .await?;

    let targ_role = match target_role {
        Some((r,)) => r,
        None => return Err(RoomError::TargetNotAMember),
    };

    if targ_role == "owner" {
        return Err(RoomError::CannotModifyOwner);
    }
    if targ_role != "moderator" {
        return Err(RoomError::NotAModerator);
    }

    // 3. Update target role
    sqlx::query("UPDATE room_members SET role = 'member' WHERE room_id = ? AND user_id = ?")
        .bind(room_id)
        .bind(target_user_id)
        .execute(&mut *tx)
        .await?;

    tx.commit().await?;

    Ok(())
}

pub async fn transfer_ownership(
    pool: &SqlitePool,
    room_id: &str,
    requester_id: &str,
    target_user_id: &str,
) -> Result<(), RoomError> {
    let mut tx = pool.begin().await?;

    // 1. Fetch requester's membership
    let requester_role: Option<(String,)> =
        sqlx::query_as("SELECT role FROM room_members WHERE room_id = ? AND user_id = ?")
            .bind(room_id)
            .bind(requester_id)
            .fetch_optional(&mut *tx)
            .await?;

    let req_role = match requester_role {
        Some((r,)) => r,
        None => return Err(RoomError::NotAMember),
    };

    if req_role != "owner" {
        return Err(RoomError::Forbidden);
    }

    // 2. Target checks
    if target_user_id == requester_id {
        return Err(RoomError::CannotTransferToSelf);
    }

    let target_role: Option<(String,)> =
        sqlx::query_as("SELECT role FROM room_members WHERE room_id = ? AND user_id = ?")
            .bind(room_id)
            .bind(target_user_id)
            .fetch_optional(&mut *tx)
            .await?;

    if target_role.is_none() {
        return Err(RoomError::TargetNotAMember);
    }

    // 3. Updates
    sqlx::query("UPDATE room_members SET role = 'owner' WHERE room_id = ? AND user_id = ?")
        .bind(room_id)
        .bind(target_user_id)
        .execute(&mut *tx)
        .await?;

    sqlx::query("UPDATE room_members SET role = 'member' WHERE room_id = ? AND user_id = ?")
        .bind(room_id)
        .bind(requester_id)
        .execute(&mut *tx)
        .await?;

    sqlx::query("UPDATE rooms SET owner_id = ? WHERE id = ?")
        .bind(target_user_id)
        .bind(room_id)
        .execute(&mut *tx)
        .await?;

    tx.commit().await?;

    Ok(())
}
