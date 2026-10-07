use crate::audit;
use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use base64::Engine;
use chrono::{DateTime, Utc};
use rand::RngCore;
use serde_json::json;
use sqlx::{Row, SqlitePool};
use std::io::Write;
use tracing::info;
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
    let rooms: Vec<(String,)> = match sqlx::query_as(
        r#"
        SELECT room_id
        FROM room_members
        WHERE user_id = ?
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
    for (room_id,) in rooms {
        crate::rooms::queue_pending_mls_remove_batch(
            &mut tx,
            &room_id,
            crate::rooms::MlsTarget::User(user_id),
        )
        .await
        .map_err(|e| match e {
            crate::rooms::RoomError::Database(err) => GdprError::Database(err),
            _ => GdprError::Database(sqlx::Error::Protocol(e.to_string())),
        })?;

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

    // 8. Anonymise Key Transparency log entries for the user (§14.2)
    let mut anon_rand_bytes = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut anon_rand_bytes);
    let anon_placeholder = format!("anon_{}", hex::encode(anon_rand_bytes));

    let mut anon_token_bytes = [0u8; 64];
    rand::thread_rng().fill_bytes(&mut anon_token_bytes);
    let anon_placeholder_token = URL_SAFE_NO_PAD.encode(anon_token_bytes);

    // Enable defer_foreign_keys so key_transparency_log.user_id update and users insert resolve in transaction
    sqlx::query("PRAGMA defer_foreign_keys = ON;")
        .execute(&mut *tx)
        .await?;

    match sqlx::query("UPDATE key_transparency_log SET user_id = ? WHERE user_id = ?")
        .bind(&anon_placeholder)
        .bind(user_id)
        .execute(&mut *tx)
        .await
    {
        Ok(res) if res.rows_affected() > 0 => {
            // Insert anonymized tombstone user row to satisfy FOREIGN KEY (user_id REFERENCES users(id))
            sqlx::query(
                r#"
                INSERT INTO users (id, username_token, opaque_registration, identity_pubkey, disabled_at, deleted_at)
                VALUES (?, ?, randomblob(32), '', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                "#,
            )
            .bind(&anon_placeholder)
            .bind(&anon_placeholder_token)
            .execute(&mut *tx)
            .await?;
        }
        Ok(_) => {}
        Err(sqlx::Error::Database(e)) if e.message().contains("no such table") => {}
        Err(e) => {
            tracing::error!("gdpr: failed to anonymise key_transparency_log: {:?}", e);
            return Err(GdprError::Database(e));
        }
    };

    // 9. Anonymise the user row: overwrite username_token with random 86-char base64url string
    let mut rand_bytes = [0u8; 64];
    rand::thread_rng().fill_bytes(&mut rand_bytes);
    let random_token = URL_SAFE_NO_PAD.encode(rand_bytes);

    sqlx::query(
        r#"
        UPDATE users
        SET username_token = ?,
            encrypted_display = NULL,
            profile = NULL,
            opaque_registration = randomblob(32),
            identity_pubkey = '',
            max_file_size_bytes = NULL,
            disabled_at = CURRENT_TIMESTAMP,
            deleted_at = CURRENT_TIMESTAMP
        WHERE id = ?
        "#,
    )
    .bind(&random_token)
    .bind(user_id)
    .execute(&mut *tx)
    .await?;

    // 10. Remove user roles for the anonymised user
    sqlx::query("DELETE FROM user_roles WHERE user_id = ?")
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

    // 11. Delete all starred items for the user
    match sqlx::query("DELETE FROM starred_items WHERE user_id = ?")
        .bind(user_id)
        .execute(&mut *tx)
        .await
    {
        Ok(_) => {}
        Err(sqlx::Error::Database(e)) if e.message().contains("no such table") => {}
        Err(e) => return Err(GdprError::Database(e)),
    };

    // Commit transaction
    tx.commit().await?;

    let summary = DeletionSummary {
        sessions_deleted,
        devices_deleted,
        key_packages_deleted: kp_res,
        push_subscriptions_deleted: push_subs_res,
        mls_removes_queued,
        recovery_vault_deleted,
    };

    // Write audit entry
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
        SELECT id, username_token, encrypted_display, identity_pubkey, profile, profile_version, created_at
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
    let u_username_token: String = user_row.get("username_token");
    let u_encrypted_display: Option<String> = user_row.get("encrypted_display");
    let u_identity_pubkey: String = user_row.get("identity_pubkey");
    let u_profile: Option<String> = user_row.get("profile");
    let u_profile_version: i64 = user_row.get("profile_version");
    let u_created_at: DateTime<Utc> = user_row.get("created_at");

    let profile_json = json!({
        "user_id": u_id,
        "username_token": u_username_token,
        "encrypted_display": u_encrypted_display,
        "identity_pubkey": u_identity_pubkey,
        "profile": u_profile,
        "profile_version": u_profile_version,
        "roles": roles,
        "created_at": u_created_at.to_rfc3339()
    });

    // 2. Devices
    let device_rows = match sqlx::query(
        r#"
        SELECT d.id, d.client_id, dn.encrypted_device_name, d.created_at, d.last_seen
        FROM devices d
        LEFT JOIN device_names dn ON dn.user_id = d.user_id AND dn.device_id = d.id AND dn.deleted_at IS NULL
        WHERE d.user_id = ?
        ORDER BY d.created_at ASC
        "#,
    )
    .bind(user_id)
    .fetch_all(pool)
    .await
    {
        Ok(rows) => rows,
        Err(sqlx::Error::Database(e)) if e.message().contains("no such table") || e.message().contains("no such column") => {
            sqlx::query(
                "SELECT id, client_id, NULL as encrypted_device_name, created_at, last_seen FROM devices WHERE user_id = ? ORDER BY created_at ASC",
            )
            .bind(user_id)
            .fetch_all(pool)
            .await?
        }
        Err(e) => return Err(GdprError::Database(e)),
    };

    let mut devices_list = Vec::new();
    for row in device_rows {
        let d_id: String = row.get("id");
        let d_client_id: String = row.get("client_id");
        let d_encrypted_device_name: Option<String> = row.get("encrypted_device_name");
        let d_created_at: DateTime<Utc> = row.get("created_at");
        let d_last_seen: Option<DateTime<Utc>> = row.get("last_seen");

        devices_list.push(json!({
            "id": d_id,
            "client_id": d_client_id,
            "encrypted_device_name": d_encrypted_device_name,
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
        "SELECT id, room_id, epoch, seq, sender_client_id, content_type, ciphertext, created_at FROM room_messages WHERE sender_user_id = ? ORDER BY created_at ASC",
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
                let m_ciphertext: Vec<u8> = row.get("ciphertext");
                let m_created_at: DateTime<Utc> = row.get("created_at");

                list.push(json!({
                    "id": m_id,
                    "room_id": m_room_id,
                    "epoch": m_epoch,
                    "seq": m_seq,
                    "sender_client_id": m_sender_client_id,
                    "content_type": m_content_type,
                    "ciphertext_base64": STANDARD.encode(m_ciphertext),
                    "created_at": m_created_at.to_rfc3339()
                }));
            }
            json!({ "messages": list })
        }
        Err(sqlx::Error::Database(e)) if e.message().contains("no such table") => {
            json!({ "messages": [], "note": "message history not present" })
        }
        Err(e) => return Err(GdprError::Database(e)),
    };

    // 6. Starred items
    let starred_rows = match sqlx::query(
        "SELECT user_id, item_id, item_type, room_id, user_seq, starred_at, deleted_at FROM starred_items WHERE user_id = ? ORDER BY starred_at ASC",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await {
        Ok(rows) => rows,
        Err(sqlx::Error::Database(e)) if e.message().contains("no such table") => vec![],
        Err(e) => return Err(GdprError::Database(e)),
    };

    let mut starred_list = Vec::new();
    for row in starred_rows {
        let st_item_id: String = row.get("item_id");
        let st_item_type: String = row.get("item_type");
        let st_room_id: String = row.get("room_id");
        let st_user_seq: i64 = row.get("user_seq");
        let st_starred_at: DateTime<Utc> = row.get("starred_at");
        let st_deleted_at: Option<DateTime<Utc>> = row.get("deleted_at");

        starred_list.push(json!({
            "item_id": st_item_id,
            "item_type": st_item_type,
            "room_id": st_room_id,
            "user_seq": st_user_seq,
            "starred_at": st_starred_at.to_rfc3339(),
            "deleted_at": st_deleted_at.map(|t| t.to_rfc3339())
        }));
    }
    let starred_json = json!({ "starred_items": starred_list });

    // 7. Audit
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

Your username_token is an opaque identifier. It is only interpretable by you,
using your master password and the OPRF protocol. The server cannot reverse it.

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

        zip.start_file("starred_items.json", options)
            .map_err(|e| GdprError::ExportFailed(e.to_string()))?;
        zip.write_all(
            serde_json::to_string_pretty(&starred_json)
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
