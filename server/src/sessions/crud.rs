use crate::audit;
use crate::config::Config;
use crate::config_ops;
use crate::error::ApiError;
use crate::sessions::SessionTypesStore;
use crate::sockudo::Publisher;
use base64::engine::general_purpose::{URL_SAFE, URL_SAFE_NO_PAD};
use base64::Engine;
use chrono::{DateTime, Utc};
use regex::Regex;
use serde::{Deserialize, Serialize};
use sqlx::{Row, SqlitePool};
use std::sync::OnceLock;
use ulid::Ulid;

static TYPE_REGEX: OnceLock<Regex> = OnceLock::new();

fn get_type_regex() -> &'static Regex {
    TYPE_REGEX.get_or_init(|| Regex::new(r"^[a-z][a-z0-9_-]*$").expect("valid static regex"))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoomSessionView {
    pub id: String,
    pub extension_id: String,
    pub session_type: String,
    pub metadata: Option<String>,
    pub metadata_version: u32,
    pub position: i32,
    pub participant_count: u32,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateRoomSessionRequest {
    pub extension_id: String,
    pub session_type: String,
    #[serde(default)]
    pub metadata: Option<String>,
    #[serde(default)]
    pub position: Option<i32>,
    #[serde(default)]
    pub max_participants: Option<u32>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PatchRoomSessionRequest {
    #[serde(default)]
    pub metadata: Option<String>,
    #[serde(default)]
    pub position: Option<i32>,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct ListRoomSessionsQuery {
    pub extension_id: Option<String>,
    pub session_type: Option<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum RoomSessionError {
    #[error("sessions disabled")]
    SessionsDisabled,

    #[error("room not found")]
    RoomNotFound,

    #[error("forbidden")]
    Forbidden,

    #[error("session not found")]
    SessionNotFound,

    #[error("invalid session type")]
    InvalidSessionType,

    #[error("unknown session type")]
    UnknownSessionType,

    #[error("invalid extension id")]
    InvalidExtensionId,

    #[error("participant cap exceeded")]
    ParticipantCapExceeded,

    #[error("session limit reached")]
    SessionLimitReached,

    #[error("invalid metadata")]
    InvalidMetadata,

    #[error("no changes")]
    NoChanges,

    #[error("config ops error: {0}")]
    ConfigOps(#[from] config_ops::ConfigOpsError),

    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
}

impl From<RoomSessionError> for ApiError {
    fn from(err: RoomSessionError) -> Self {
        match err {
            RoomSessionError::SessionsDisabled => {
                ApiError::NotImplemented("sessions_disabled".to_string())
            }
            RoomSessionError::RoomNotFound => ApiError::NotFound("room_not_found".to_string()),
            RoomSessionError::Forbidden => ApiError::Forbidden("forbidden".to_string()),
            RoomSessionError::SessionNotFound => {
                ApiError::NotFound("session_not_found".to_string())
            }
            RoomSessionError::InvalidSessionType => {
                ApiError::BadRequest("invalid_session_type".to_string())
            }
            RoomSessionError::UnknownSessionType => {
                ApiError::BadRequest("unknown_session_type".to_string())
            }
            RoomSessionError::InvalidExtensionId => {
                ApiError::BadRequest("invalid_extension_id".to_string())
            }
            RoomSessionError::ParticipantCapExceeded => {
                ApiError::BadRequest("participant_cap_exceeded".to_string())
            }
            RoomSessionError::SessionLimitReached => {
                ApiError::Conflict("session_limit_reached".to_string())
            }
            RoomSessionError::InvalidMetadata => {
                ApiError::BadRequest("invalid_metadata".to_string())
            }
            RoomSessionError::NoChanges => ApiError::BadRequest("no_changes".to_string()),
            RoomSessionError::ConfigOps(e) => ApiError::Internal(e.into()),
            RoomSessionError::Database(e) => ApiError::Internal(e.into()),
        }
    }
}

pub fn validate_metadata(meta: &str) -> Result<(), RoomSessionError> {
    let bytes = URL_SAFE_NO_PAD
        .decode(meta)
        .or_else(|_| URL_SAFE.decode(meta))
        .map_err(|_| RoomSessionError::InvalidMetadata)?;
    if bytes.len() > 65536 {
        return Err(RoomSessionError::InvalidMetadata);
    }
    Ok(())
}

async fn check_room_membership(
    pool: &SqlitePool,
    room_id: &str,
    user_id: &str,
) -> Result<String, RoomSessionError> {
    let row: Option<(String,)> =
        sqlx::query_as("SELECT role FROM room_members WHERE room_id = ? AND user_id = ?")
            .bind(room_id)
            .bind(user_id)
            .fetch_optional(pool)
            .await?;

    match row {
        Some((role,)) => Ok(role),
        None => Err(RoomSessionError::RoomNotFound),
    }
}

async fn resequence_positions(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    room_id: &str,
) -> Result<(), RoomSessionError> {
    let rows: Vec<(String, i32)> = sqlx::query_as(
        "SELECT id, position FROM room_sessions WHERE room_id = ? ORDER BY position ASC, id ASC",
    )
    .bind(room_id)
    .fetch_all(&mut **tx)
    .await?;

    for (idx, (id, current_pos)) in rows.into_iter().enumerate() {
        let expected_pos = idx as i32;
        if current_pos != expected_pos {
            sqlx::query("UPDATE room_sessions SET position = ? WHERE id = ?")
                .bind(expected_pos)
                .bind(&id)
                .execute(&mut **tx)
                .await?;
        }
    }

    Ok(())
}

pub async fn list_room_sessions(
    pool: &SqlitePool,
    room_id: &str,
    user_id: &str,
    query: ListRoomSessionsQuery,
) -> Result<Vec<RoomSessionView>, RoomSessionError> {
    check_room_membership(pool, room_id, user_id).await?;

    let mut sql = String::from(
        "SELECT id, extension_id, session_type, metadata, metadata_version, position, created_at FROM room_sessions WHERE room_id = ?",
    );

    if query.extension_id.is_some() {
        sql.push_str(" AND extension_id = ?");
    }

    if let Some(ref st) = query.session_type {
        if !get_type_regex().is_match(st) {
            return Err(RoomSessionError::InvalidSessionType);
        }
        sql.push_str(" AND session_type = ?");
    }

    sql.push_str(" ORDER BY position ASC, id ASC");

    let mut q = sqlx::query(&sql).bind(room_id);

    if let Some(ref ext_id) = query.extension_id {
        q = q.bind(ext_id);
    }
    if let Some(ref st) = query.session_type {
        q = q.bind(st);
    }

    let rows = q.fetch_all(pool).await?;

    let mut sessions = Vec::with_capacity(rows.len());
    for row in rows {
        let id: String = row.get("id");
        let extension_id: String = row.get("extension_id");
        let session_type: String = row.get("session_type");
        let metadata: Option<String> = row.get("metadata");
        let metadata_version: i32 = row.get("metadata_version");
        let position: i32 = row.get("position");
        let created_at: DateTime<Utc> = row.get("created_at");

        sessions.push(RoomSessionView {
            id,
            extension_id,
            session_type,
            metadata,
            metadata_version: metadata_version as u32,
            position,
            participant_count: 0,
            created_at,
        });
    }

    Ok(sessions)
}

pub async fn create_room_session(
    pool: &SqlitePool,
    publisher: &Publisher,
    session_types_store: &SessionTypesStore,
    config: &Config,
    room_id: &str,
    creator_id: &str,
    req: CreateRoomSessionRequest,
) -> Result<RoomSessionView, RoomSessionError> {
    if !session_types_store.is_effective_enabled() {
        return Err(RoomSessionError::SessionsDisabled);
    }

    let role = check_room_membership(pool, room_id, creator_id).await?;

    let instance_config = config_ops::get_config(pool).await?;
    if instance_config.moderation_mode == "discord" && role == "member" {
        return Err(RoomSessionError::Forbidden);
    }

    if !get_type_regex().is_match(&req.session_type) {
        return Err(RoomSessionError::InvalidSessionType);
    }

    let allowlist_type = session_types_store
        .get(&req.session_type)
        .ok_or(RoomSessionError::UnknownSessionType)?;

    if req.extension_id.trim().is_empty() {
        return Err(RoomSessionError::InvalidExtensionId);
    }

    if let Some(max_p) = req.max_participants {
        if max_p < 1
            || max_p > allowlist_type.max_participants
            || max_p > config.server_max_session_participants
        {
            return Err(RoomSessionError::ParticipantCapExceeded);
        }
    }

    if let Some(ref meta) = req.metadata {
        validate_metadata(meta)?;
    }

    let mut tx = pool.begin().await?;

    let type_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM room_sessions WHERE room_id = ? AND session_type = ?",
    )
    .bind(room_id)
    .bind(&req.session_type)
    .fetch_one(&mut *tx)
    .await?;

    if type_count >= allowlist_type.max_per_room as i64 {
        return Err(RoomSessionError::SessionLimitReached);
    }

    let total_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM room_sessions WHERE room_id = ?")
            .bind(room_id)
            .fetch_one(&mut *tx)
            .await?;

    if total_count >= config.server_max_sessions_per_room as i64 {
        return Err(RoomSessionError::SessionLimitReached);
    }

    let session_id = format!("s_{}", Ulid::new().to_string().to_lowercase());

    let target_position = match req.position {
        None => total_count as i32,
        Some(p) if p >= total_count as i32 => total_count as i32,
        Some(p) if p < 0 => 0,
        Some(p) => p,
    };

    if target_position < total_count as i32 {
        sqlx::query(
            "UPDATE room_sessions SET position = position + 1 WHERE room_id = ? AND position >= ?",
        )
        .bind(room_id)
        .bind(target_position)
        .execute(&mut *tx)
        .await?;
    }

    sqlx::query(
        r#"
        INSERT INTO room_sessions (id, room_id, extension_id, session_type, metadata, metadata_version, position, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 1, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        "#,
    )
    .bind(&session_id)
    .bind(room_id)
    .bind(&req.extension_id)
    .bind(&req.session_type)
    .bind(&req.metadata)
    .bind(target_position)
    .bind(creator_id)
    .execute(&mut *tx)
    .await?;

    resequence_positions(&mut tx, room_id).await?;

    let created_at: DateTime<Utc> =
        sqlx::query_scalar("SELECT created_at FROM room_sessions WHERE id = ?")
            .bind(&session_id)
            .fetch_one(&mut *tx)
            .await?;

    tx.commit().await?;

    let channel = format!("private-room-{}", room_id);
    let event_payload = serde_json::json!({
        "room_id": room_id,
        "session_id": session_id,
        "extension_id": req.extension_id,
        "session_type": req.session_type,
        "created_by": creator_id,
        "created_at": created_at,
    });

    if let Err(e) = publisher
        .publish(&channel, "session.created", event_payload)
        .await
    {
        tracing::warn!(error = %e, room_id = %room_id, session_id = %session_id, "session.created publish failed");
    }

    let audit_meta = serde_json::json!({
        "session_id": session_id,
        "room_id": room_id,
    });
    let _ = audit::log(
        pool,
        Some(creator_id),
        audit::action::SESSION_CREATE,
        Some("room_session"),
        Some(&session_id),
        Some(audit_meta),
    )
    .await;

    Ok(RoomSessionView {
        id: session_id,
        extension_id: req.extension_id,
        session_type: req.session_type,
        metadata: req.metadata,
        metadata_version: 1,
        position: target_position,
        participant_count: 0,
        created_at,
    })
}

pub async fn patch_room_session(
    pool: &SqlitePool,
    publisher: &Publisher,
    _config: &Config,
    room_id: &str,
    session_id: &str,
    user_id: &str,
    req: PatchRoomSessionRequest,
) -> Result<RoomSessionView, RoomSessionError> {
    let role = check_room_membership(pool, room_id, user_id).await?;
    let instance_config = config_ops::get_config(pool).await?;

    if req.metadata.is_none() && req.position.is_none() {
        return Err(RoomSessionError::NoChanges);
    }

    #[derive(sqlx::FromRow)]
    struct ExistingSession {
        extension_id: String,
        session_type: String,
        metadata: Option<String>,
        metadata_version: i32,
        position: i32,
        created_by: String,
        created_at: DateTime<Utc>,
    }

    let session_row: Option<ExistingSession> = sqlx::query_as(
        "SELECT extension_id, session_type, metadata, metadata_version, position, created_by, created_at FROM room_sessions WHERE id = ? AND room_id = ?",
    )
    .bind(session_id)
    .bind(room_id)
    .fetch_optional(pool)
    .await?;

    let ExistingSession {
        extension_id,
        session_type,
        metadata: cur_metadata,
        metadata_version: cur_version,
        position: cur_position,
        created_by,
        created_at,
    } = match session_row {
        Some(row) => row,
        None => return Err(RoomSessionError::SessionNotFound),
    };

    let is_authorized = user_id == created_by
        || role == "owner"
        || (role == "moderator" && instance_config.moderation_mode == "discord");

    if !is_authorized {
        return Err(RoomSessionError::Forbidden);
    }

    let metadata_changed = match &req.metadata {
        Some(new_meta) => {
            validate_metadata(new_meta)?;
            cur_metadata.as_ref() != Some(new_meta)
        }
        None => false,
    };

    let target_pos = req.position.unwrap_or(cur_position);
    let position_changed = req.position.is_some() && target_pos != cur_position;

    if !metadata_changed && !position_changed {
        return Ok(RoomSessionView {
            id: session_id.to_string(),
            extension_id,
            session_type,
            metadata: cur_metadata,
            metadata_version: cur_version as u32,
            position: cur_position,
            participant_count: 0,
            created_at,
        });
    }

    let mut tx = pool.begin().await?;

    let new_metadata = if metadata_changed {
        req.metadata.clone()
    } else {
        cur_metadata
    };

    let new_version = if metadata_changed {
        cur_version + 1
    } else {
        cur_version
    };

    if position_changed {
        let all_rows: Vec<String> = sqlx::query_scalar(
            "SELECT id FROM room_sessions WHERE room_id = ? ORDER BY position ASC, id ASC",
        )
        .bind(room_id)
        .fetch_all(&mut *tx)
        .await?;

        let mut list: Vec<String> = all_rows.into_iter().filter(|id| id != session_id).collect();
        let clamped_pos = (target_pos as usize).min(list.len());
        list.insert(clamped_pos, session_id.to_string());

        for (idx, id) in list.into_iter().enumerate() {
            sqlx::query("UPDATE room_sessions SET position = ? WHERE id = ?")
                .bind(idx as i32)
                .bind(&id)
                .execute(&mut *tx)
                .await?;
        }
    }

    if metadata_changed {
        sqlx::query(
            "UPDATE room_sessions SET metadata = ?, metadata_version = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        )
        .bind(&new_metadata)
        .bind(new_version)
        .bind(session_id)
        .execute(&mut *tx)
        .await?;
    } else {
        sqlx::query("UPDATE room_sessions SET updated_at = CURRENT_TIMESTAMP WHERE id = ?")
            .bind(session_id)
            .execute(&mut *tx)
            .await?;
    }

    resequence_positions(&mut tx, room_id).await?;

    let final_position: i32 = sqlx::query_scalar("SELECT position FROM room_sessions WHERE id = ?")
        .bind(session_id)
        .fetch_one(&mut *tx)
        .await?;

    tx.commit().await?;

    let mut changed_fields = Vec::new();
    let mut event_payload = serde_json::json!({
        "room_id": room_id,
        "session_id": session_id,
    });

    if metadata_changed {
        changed_fields.push("metadata");
        event_payload["metadata"] = serde_json::to_value(&new_metadata).unwrap_or_default();
        event_payload["metadata_version"] = serde_json::json!(new_version);
    }

    if position_changed {
        changed_fields.push("position");
        event_payload["position"] = serde_json::json!(final_position);
    }

    event_payload["changed"] = serde_json::json!(changed_fields);

    let channel = format!("private-room-{}", room_id);
    if let Err(e) = publisher
        .publish(&channel, "session.updated", event_payload)
        .await
    {
        tracing::warn!(error = %e, room_id = %room_id, session_id = %session_id, "session.updated publish failed");
    }

    Ok(RoomSessionView {
        id: session_id.to_string(),
        extension_id,
        session_type,
        metadata: new_metadata,
        metadata_version: new_version as u32,
        position: final_position,
        participant_count: 0,
        created_at,
    })
}

pub async fn delete_room_session(
    pool: &SqlitePool,
    publisher: &Publisher,
    _config: &Config,
    room_id: &str,
    session_id: &str,
    user_id: &str,
) -> Result<(), RoomSessionError> {
    let role = check_room_membership(pool, room_id, user_id).await?;
    let instance_config = config_ops::get_config(pool).await?;

    let session_row: Option<(String, String)> = sqlx::query_as(
        "SELECT extension_id, created_by FROM room_sessions WHERE id = ? AND room_id = ?",
    )
    .bind(session_id)
    .bind(room_id)
    .fetch_optional(pool)
    .await?;

    let (extension_id, created_by) = match session_row {
        Some(row) => row,
        None => return Err(RoomSessionError::SessionNotFound),
    };

    let is_authorized = user_id == created_by
        || role == "owner"
        || (role == "moderator" && instance_config.moderation_mode == "discord");

    if !is_authorized {
        return Err(RoomSessionError::Forbidden);
    }

    let mut tx = pool.begin().await?;

    sqlx::query("DELETE FROM room_sessions WHERE id = ?")
        .bind(session_id)
        .execute(&mut *tx)
        .await?;

    resequence_positions(&mut tx, room_id).await?;

    tx.commit().await?;

    let channel = format!("private-room-{}", room_id);
    let event_payload = serde_json::json!({
        "room_id": room_id,
        "session_id": session_id,
        "extension_id": extension_id,
    });

    if let Err(e) = publisher
        .publish(&channel, "session.deleted", event_payload)
        .await
    {
        tracing::warn!(error = %e, room_id = %room_id, session_id = %session_id, "session.deleted publish failed");
    }

    let audit_meta = serde_json::json!({
        "session_id": session_id,
        "room_id": room_id,
    });
    let _ = audit::log(
        pool,
        Some(user_id),
        audit::action::SESSION_DELETE,
        Some("room_session"),
        Some(session_id),
        Some(audit_meta),
    )
    .await;

    Ok(())
}
