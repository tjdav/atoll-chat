use crate::audit;
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use chrono::{DateTime, Utc};
use serde_json::json;
use sqlx::{Row, SqlitePool};
use std::io::Write;
use tracing::info;
use ulid::Ulid;
use zip::write::SimpleFileOptions;
use zip::ZipWriter;

#[derive(Debug, Clone, serde::Serialize)]
pub struct DeletionSummary {
    pub sessions_deleted: u64,
    pub devices_deleted: u64,
    pub key_packages_deleted: u64,
    pub push_subscriptions_deleted: u64,
    pub mls_removes_queued: u64,
    pub recovery_vault_deleted: bool,
}

#[derive(Debug, thiserror::Error)]
pub enum GdprError {
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("user not found")]
    NotFound,
    #[error("export generation failed: {0}")]
    ExportFailed(String),
}

pub async fn anonymise_user(
    pool: &SqlitePool,
    user_id: &str,
) -> Result<DeletionSummary, GdprError> {
    let mut tx = pool.begin().await?;

    // 1. Verify user exists and deleted_at IS NULL
    let user_exists: Option<(String,)> =
        sqlx::query_as("SELECT id FROM users WHERE id = ? AND deleted_at IS NULL")
            .bind(user_id)
            .fetch_optional(&mut *tx)
            .await?;

    if user_exists.is_none() {
        return Err(GdprError::NotFound);
    }

    // 2. Delete all unconsumed KeyPackages
    let kp_res = match sqlx::query("DELETE FROM key_packages WHERE user_id = ? AND consumed = 0")
        .bind(user_id)
        .execute(&mut *tx)
        .await
    {
        Ok(res) => res.rows_affected(),
        Err(sqlx::Error::Database(e)) if e.message().contains("no such table") => 0,
        Err(e) => return Err(GdprError::Database(e)),
    };

    // 3. Delete all push subscriptions
    let push_subs_res = match sqlx::query("DELETE FROM push_subscriptions WHERE user_id = ?")
        .bind(user_id)
        .execute(&mut *tx)
        .await
    {
        Ok(res) => res.rows_affected(),
        Err(sqlx::Error::Database(e)) if e.message().contains("no such table") => 0,
        Err(e) => return Err(GdprError::Database(e)),
    };

    // 4. Queue MLS Removes for every room the user is a member of
    let rooms_and_clients: Vec<(String, String)> = match sqlx::query_as(
        r#"
        SELECT rm.room_id, d.client_id
        FROM room_members rm
        JOIN devices d ON d.user_id = rm.user_id
        WHERE rm.user_id = ?
        "#,
    )
    .bind(user_id)
    .fetch_all(&mut *tx)
    .await
    {
        Ok(rows) => rows,
        Err(sqlx::Error::Database(e)) if e.message().contains("no such table") => vec![],
        Err(e) => return Err(GdprError::Database(e)),
    };

    let mut mls_removes_queued: u64 = 0;
    for (room_id, client_id) in rooms_and_clients {
        let remove_id = Ulid::new().to_string();
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

    // 5. Delete recovery_vault record if table exists
    let recovery_vault_deleted = match sqlx::query("DELETE FROM recovery_vault WHERE user_id = ?")
        .bind(user_id)
        .execute(&mut *tx)
        .await
    {
        Ok(res) => res.rows_affected() > 0,
        Err(sqlx::Error::Database(e)) if e.message().contains("no such table") => {
            info!("gdpr: recovery_vault table not present, skipping");
            false
        }
        Err(e) => return Err(GdprError::Database(e)),
    };

    // 6. Delete all devices for the user (cascades to sessions via ON DELETE CASCADE)
    let devices_res = sqlx::query("DELETE FROM devices WHERE user_id = ?")
        .bind(user_id)
        .execute(&mut *tx)
        .await?;
    let devices_deleted = devices_res.rows_affected();

    // 7. Delete any remaining sessions that do not reference a device
    let sessions_res = sqlx::query("DELETE FROM sessions WHERE user_id = ?")
        .bind(user_id)
        .execute(&mut *tx)
        .await?;
    let sessions_deleted = sessions_res.rows_affected();

    // 8. Anonymise the user row
    sqlx::query(
        r#"
        UPDATE users
        SET username = 'deleted_' || lower(hex(randomblob(8))),
            username_hash = lower(hex(randomblob(32))),
            display_name = NULL,
            profile_blob = NULL,
            opaque_registration = randomblob(32),
            identity_pubkey = '',
            max_file_size_bytes = NULL,
            disabled_at = CURRENT_TIMESTAMP,
            deleted_at = CURRENT_TIMESTAMP
        WHERE id = ?
        "#,
    )
    .bind(user_id)
    .execute(&mut *tx)
    .await?;

    // 9. Remove user from all room memberships
    match sqlx::query("DELETE FROM room_members WHERE user_id = ?")
        .bind(user_id)
        .execute(&mut *tx)
        .await
    {
        Ok(_) => {}
        Err(sqlx::Error::Database(e)) if e.message().contains("no such table") => {}
        Err(e) => return Err(GdprError::Database(e)),
    };

    // 10. Delete all welcomes for the recipient user
    match sqlx::query("DELETE FROM welcomes WHERE recipient_user_id = ?")
        .bind(user_id)
        .execute(&mut *tx)
        .await
    {
        Ok(_) => {}
        Err(sqlx::Error::Database(e)) if e.message().contains("no such table") => {}
        Err(e) => return Err(GdprError::Database(e)),
    };

    // 10. Commit transaction
    tx.commit().await?;

    let summary = DeletionSummary {
        sessions_deleted,
        devices_deleted,
        key_packages_deleted: kp_res,
        push_subscriptions_deleted: push_subs_res,
        mls_removes_queued,
        recovery_vault_deleted,
    };

    // 11. Write audit entry
    let metadata = serde_json::to_value(&summary).ok();
    let _ = audit::log(
        pool,
        Some(user_id),
        audit::action::USER_DELETE,
        Some("user"),
        Some(user_id),
        metadata,
    )
    .await;

    Ok(summary)
}

pub async fn build_export(pool: &SqlitePool, user_id: &str) -> Result<Vec<u8>, GdprError> {
    // 1. Profile
    let user_row = sqlx::query(
        r#"
        SELECT id, username, display_name, identity_pubkey, profile_blob, profile_version, created_at
        FROM users
        WHERE id = ?
        "#,
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await?
    .ok_or(GdprError::NotFound)?;

    let roles_rows: Vec<(String,)> =
        sqlx::query_as("SELECT role_id FROM user_roles WHERE user_id = ? ORDER BY granted_at ASC")
            .bind(user_id)
            .fetch_all(pool)
            .await
            .unwrap_or_default();

    let mut roles: Vec<String> = roles_rows.into_iter().map(|(r,)| r).collect();
    if roles.is_empty() {
        roles.push("member".to_string());
    }

    let u_id: String = user_row.get("id");
    let u_username: String = user_row.get("username");
    let u_display_name: Option<String> = user_row.get("display_name");
    let u_identity_pubkey: String = user_row.get("identity_pubkey");
    let u_profile_blob: Option<String> = user_row.get("profile_blob");
    let u_profile_version: i64 = user_row.get("profile_version");
    let u_created_at: DateTime<Utc> = user_row.get("created_at");

    let profile_json = json!({
        "user_id": u_id,
        "username": u_username,
        "display_name": u_display_name,
        "identity_pubkey": u_identity_pubkey,
        "profile_blob": u_profile_blob,
        "profile_version": u_profile_version,
        "roles": roles,
        "created_at": u_created_at.to_rfc3339()
    });

    // 2. Devices
    let device_rows = sqlx::query(
        "SELECT id, client_id, name, created_at, last_seen FROM devices WHERE user_id = ? ORDER BY created_at ASC",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?;

    let mut devices_list = Vec::new();
    for row in device_rows {
        let d_id: String = row.get("id");
        let d_client_id: String = row.get("client_id");
        let d_name: Option<String> = row.get("name");
        let d_created_at: DateTime<Utc> = row.get("created_at");
        let d_last_seen: Option<DateTime<Utc>> = row.get("last_seen");

        devices_list.push(json!({
            "id": d_id,
            "client_id": d_client_id,
            "name": d_name,
            "created_at": d_created_at.to_rfc3339(),
            "last_seen": d_last_seen.map(|t| t.to_rfc3339())
        }));
    }
    let devices_json = json!({ "devices": devices_list });

    // 3. Sessions
    let session_rows = sqlx::query(
        "SELECT id, device_id, created_at, expires_at, revoked_at, last_seen_at FROM sessions WHERE user_id = ? ORDER BY created_at ASC",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?;

    let mut sessions_list = Vec::new();
    for row in session_rows {
        let s_id: String = row.get("id");
        let s_device_id: Option<String> = row.get("device_id");
        let s_created_at: DateTime<Utc> = row.get("created_at");
        let s_expires_at: DateTime<Utc> = row.get("expires_at");
        let s_revoked_at: Option<DateTime<Utc>> = row.get("revoked_at");
        let s_last_seen_at: Option<DateTime<Utc>> = row.get("last_seen_at");

        sessions_list.push(json!({
            "id": s_id,
            "device_id": s_device_id,
            "created_at": s_created_at.to_rfc3339(),
            "expires_at": s_expires_at.to_rfc3339(),
            "revoked_at": s_revoked_at.map(|t| t.to_rfc3339()),
            "last_seen_at": s_last_seen_at.map(|t| t.to_rfc3339())
        }));
    }
    let sessions_json = json!({ "sessions": sessions_list });

    // 4. Rooms
    let room_rows = match sqlx::query(
        "SELECT room_id, joined_at FROM room_members WHERE user_id = ? ORDER BY joined_at ASC",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await
    {
        Ok(rows) => rows,
        Err(sqlx::Error::Database(e)) if e.message().contains("no such table") => vec![],
        Err(e) => return Err(GdprError::Database(e)),
    };

    let mut rooms_list = Vec::new();
    for row in room_rows {
        let r_id: String = row.get("room_id");
        let r_joined_at: DateTime<Utc> = row.get("joined_at");

        rooms_list.push(json!({
            "room_id": r_id,
            "role": "member",
            "joined_at": r_joined_at.to_rfc3339()
        }));
    }
    let rooms_json = json!({ "rooms": rooms_list });

    // 5. Messages
    let messages_res = match sqlx::query(
        "SELECT id, room_id, epoch, seq, sender_client_id, content_type, mls_data, created_at FROM messages WHERE sender_id = ? ORDER BY created_at ASC",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await {
        Ok(rows) => {
            let mut list = Vec::new();
            for row in rows {
                let m_id: String = row.get("id");
                let m_room_id: String = row.get("room_id");
                let m_epoch: i64 = row.get("epoch");
                let m_seq: i64 = row.get("seq");
                let m_sender_client_id: String = row.get("sender_client_id");
                let m_content_type: String = row.get("content_type");
                let m_mls_data: Vec<u8> = row.get("mls_data");
                let m_created_at: DateTime<Utc> = row.get("created_at");

                list.push(json!({
                    "id": m_id,
                    "room_id": m_room_id,
                    "epoch": m_epoch,
                    "seq": m_seq,
                    "sender_client_id": m_sender_client_id,
                    "content_type": m_content_type,
                    "mls_data_base64": STANDARD.encode(m_mls_data),
                    "created_at": m_created_at.to_rfc3339()
                }));
            }
            json!({ "messages": list })
        }
        Err(sqlx::Error::Database(e)) if e.message().contains("no such table") => {
            json!({ "messages": [], "note": "message history not yet implemented" })
        }
        Err(e) => return Err(GdprError::Database(e)),
    };

    // 6. Audit
    let audit_rows = sqlx::query(
        "SELECT id, action, target_type, target_id, metadata, created_at FROM audit_log WHERE actor_id = ? ORDER BY created_at ASC",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?;

    let mut audit_list = Vec::new();
    for row in audit_rows {
        let a_id: String = row.get("id");
        let a_action: String = row.get("action");
        let a_target_type: Option<String> = row.get("target_type");
        let a_target_id: Option<String> = row.get("target_id");
        let a_metadata_str: Option<String> = row.get("metadata");
        let a_created_at: DateTime<Utc> = row.get("created_at");

        let a_metadata: serde_json::Value = a_metadata_str
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_else(|| json!({}));

        audit_list.push(json!({
            "id": a_id,
            "action": a_action,
            "target_type": a_target_type,
            "target_id": a_target_id,
            "metadata": a_metadata,
            "created_at": a_created_at.to_rfc3339()
        }));
    }
    let audit_json = json!({ "entries": audit_list });

    // 7. README.txt
    let readme_text = r#"This archive contains your personal data exported from Encrypted Chat.

Contents:
- profile.json     — your account metadata
- devices.json     — devices linked to your account
- sessions.json    — session history
- rooms.json       — rooms you are a member of
- messages.json    — encrypted message metadata
- audit.json       — audit entries where you are the actor

IMPORTANT: The message data in messages.json is encrypted end-to-end. The server does not have the keys to decrypt it. Only your clients can decrypt these messages.

Store this archive securely. It contains personal data.
"#;

    // Build ZIP archive using synchronous in-memory buffer
    let mut cursor = std::io::Cursor::new(Vec::new());
    {
        let mut zip = ZipWriter::new(&mut cursor);
        let options =
            SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);

        zip.start_file("profile.json", options)
            .map_err(|e| GdprError::ExportFailed(e.to_string()))?;
        zip.write_all(
            serde_json::to_string_pretty(&profile_json)
                .map_err(|e| GdprError::ExportFailed(e.to_string()))?
                .as_bytes(),
        )
        .map_err(|e| GdprError::ExportFailed(e.to_string()))?;

        zip.start_file("devices.json", options)
            .map_err(|e| GdprError::ExportFailed(e.to_string()))?;
        zip.write_all(
            serde_json::to_string_pretty(&devices_json)
                .map_err(|e| GdprError::ExportFailed(e.to_string()))?
                .as_bytes(),
        )
        .map_err(|e| GdprError::ExportFailed(e.to_string()))?;

        zip.start_file("sessions.json", options)
            .map_err(|e| GdprError::ExportFailed(e.to_string()))?;
        zip.write_all(
            serde_json::to_string_pretty(&sessions_json)
                .map_err(|e| GdprError::ExportFailed(e.to_string()))?
                .as_bytes(),
        )
        .map_err(|e| GdprError::ExportFailed(e.to_string()))?;

        zip.start_file("rooms.json", options)
            .map_err(|e| GdprError::ExportFailed(e.to_string()))?;
        zip.write_all(
            serde_json::to_string_pretty(&rooms_json)
                .map_err(|e| GdprError::ExportFailed(e.to_string()))?
                .as_bytes(),
        )
        .map_err(|e| GdprError::ExportFailed(e.to_string()))?;

        zip.start_file("messages.json", options)
            .map_err(|e| GdprError::ExportFailed(e.to_string()))?;
        zip.write_all(
            serde_json::to_string_pretty(&messages_res)
                .map_err(|e| GdprError::ExportFailed(e.to_string()))?
                .as_bytes(),
        )
        .map_err(|e| GdprError::ExportFailed(e.to_string()))?;

        zip.start_file("audit.json", options)
            .map_err(|e| GdprError::ExportFailed(e.to_string()))?;
        zip.write_all(
            serde_json::to_string_pretty(&audit_json)
                .map_err(|e| GdprError::ExportFailed(e.to_string()))?
                .as_bytes(),
        )
        .map_err(|e| GdprError::ExportFailed(e.to_string()))?;

        zip.start_file("README.txt", options)
            .map_err(|e| GdprError::ExportFailed(e.to_string()))?;
        zip.write_all(readme_text.as_bytes())
            .map_err(|e| GdprError::ExportFailed(e.to_string()))?;

        zip.finish()
            .map_err(|e| GdprError::ExportFailed(e.to_string()))?;
    }

    Ok(cursor.into_inner())
}
