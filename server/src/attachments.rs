use chrono::{DateTime, Utc};
use serde::Serialize;
use sha2::{Digest, Sha256};
use sqlx::SqlitePool;

use crate::config::Config;
use crate::limits::{InstanceLimits, ServerHardMax};
use crate::storage::{Storage, StorageError};

#[derive(Debug, Clone, Serialize)]
pub struct AttachmentView {
    pub id: String,
    pub room_id: String,
    pub uploader_id: String,
    pub uploader_client_id: Option<String>,
    pub storage_backend: String,
    pub padded_size: i64,
    pub plaintext_size: i64,
    pub encrypted_size: i64,
    pub chunk_size: i64,
    pub chunk_count: i64,
    pub nonce_prefix: String,
    pub base_counter: i64,
    pub content_type: String,
    pub created_at: DateTime<Utc>,
}

impl AttachmentView {
    pub fn storage_key(&self) -> String {
        format!(
            "attachments/{}/{}/{}",
            &self.id[0..2],
            &self.id[2..4],
            &self.id
        )
    }
}

pub struct UploadRequest {
    pub room_id: String,
    pub uploader_id: String,
    pub uploader_client_id: Option<String>,
    pub content_type: String,
    pub data: Vec<u8>,
    pub claimed_id: String,
    pub plaintext_size: i64,
    pub encrypted_size: i64,
    pub chunk_size: i64,
    pub chunk_count: i64,
    pub nonce_prefix: String,
    pub base_counter: i64,
}

pub struct PresignResult {
    pub url: String,
    pub expires_at: DateTime<Utc>,
}

#[derive(Debug, thiserror::Error)]
pub enum AttachmentError {
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("storage error: {0}")]
    Storage(#[from] StorageError),
    #[error("room not found")]
    RoomNotFound,
    #[error("not a member")]
    NotAMember,
    #[error("hash mismatch: expected {expected}, computed {computed}")]
    HashMismatch { expected: String, computed: String },
    #[error("invalid bucket size: {0} bytes")]
    InvalidBucketSize(u64),
    #[error("attachment not found")]
    NotFound,
    #[error("only the uploader can delete this attachment")]
    Forbidden,
    #[error("attachment already exists")]
    AlreadyExists,
    #[error("invalid manifest field: {0}")]
    InvalidManifest(String),
    #[error("range out of bounds: file size {size}")]
    RangeOutOfBounds { size: i64 },
    #[error("invalid range: start {start} > end {end}")]
    InvalidRange { start: u64, end: u64 },
    #[error("presign not supported")]
    PresignNotSupported,
}

fn storage_key_for_id(id: &str) -> String {
    format!("attachments/{}/{}/{}", &id[0..2], &id[2..4], id)
}

fn is_valid_claimed_id(id: &str) -> bool {
    id.len() == 64
        && id
            .chars()
            .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase())
}

pub async fn upload_attachment(
    pool: &SqlitePool,
    storage: &dyn Storage,
    config: &Config,
    req: UploadRequest,
) -> Result<AttachmentView, AttachmentError> {
    // Step 1 — Validate manifest before I/O
    if !is_valid_claimed_id(&req.claimed_id) {
        return Err(AttachmentError::InvalidManifest(
            "invalid claimed_id format".to_string(),
        ));
    }

    let data_len = req.data.len() as u64;
    if !config.attachment_bucket_sizes.contains(&data_len) {
        return Err(AttachmentError::InvalidBucketSize(data_len));
    }

    if req.chunk_size != config.attachment_chunk_size as i64 {
        return Err(AttachmentError::InvalidManifest(format!(
            "chunk_size must be {}",
            config.attachment_chunk_size
        )));
    }

    if req.chunk_count <= 0 {
        return Err(AttachmentError::InvalidManifest(
            "chunk_count must be > 0".to_string(),
        ));
    }

    if req.plaintext_size <= 0 || req.plaintext_size > req.encrypted_size {
        return Err(AttachmentError::InvalidManifest(
            "plaintext_size must be > 0 and <= encrypted_size".to_string(),
        ));
    }

    let nonce_bytes = base64::Engine::decode(
        &base64::engine::general_purpose::STANDARD,
        &req.nonce_prefix,
    )
    .or_else(|_| {
        base64::Engine::decode(
            &base64::engine::general_purpose::URL_SAFE_NO_PAD,
            &req.nonce_prefix,
        )
    })
    .map_err(|_| AttachmentError::InvalidManifest("nonce_prefix is invalid base64".to_string()))?;

    if nonce_bytes.len() != 7 {
        return Err(AttachmentError::InvalidManifest(
            "nonce_prefix must decode to 7 bytes".to_string(),
        ));
    }

    if req.base_counter < 0 || req.base_counter > u32::MAX as i64 {
        return Err(AttachmentError::InvalidManifest(
            "base_counter must be between 0 and 2^32-1".to_string(),
        ));
    }

    if req.content_type.is_empty()
        || req.content_type.len() > 128
        || !req
            .content_type
            .chars()
            .all(|c| c.is_ascii() && !c.is_ascii_control())
    {
        return Err(AttachmentError::InvalidManifest(
            "invalid content_type".to_string(),
        ));
    }

    // Step 2 — Hash verification
    let mut hasher = Sha256::new();
    hasher.update(&req.data);
    let computed_hash = hex::encode(hasher.finalize());

    if computed_hash != req.claimed_id {
        return Err(AttachmentError::HashMismatch {
            expected: req.claimed_id,
            computed: computed_hash,
        });
    }

    // Step 3 — Membership check
    let member_exists: Option<i32> =
        sqlx::query_scalar("SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?")
            .bind(&req.room_id)
            .bind(&req.uploader_id)
            .fetch_optional(pool)
            .await?;

    if member_exists.is_none() {
        return Err(AttachmentError::NotAMember);
    }

    let storage_key = storage_key_for_id(&req.claimed_id);

    // Step 4 — Existing row check
    let existing_row: Option<(String, String, String)> =
        sqlx::query_as("SELECT id, room_id, uploader_id FROM attachments WHERE id = ?")
            .bind(&req.claimed_id)
            .fetch_optional(pool)
            .await?;

    if let Some((_id, existing_room_id, existing_uploader_id)) = existing_row {
        if existing_room_id == req.room_id && existing_uploader_id == req.uploader_id {
            let blob_exists = storage.exists(&storage_key).await?;
            if !blob_exists {
                storage.write(&storage_key, &req.data).await?;
            }
            return get_attachment(pool, &req.claimed_id, &req.uploader_id).await;
        } else {
            return Err(AttachmentError::AlreadyExists);
        }
    }

    // Step 5 — Write blob
    storage.write(&storage_key, &req.data).await?;

    // Step 6 — Insert DB row
    let backend_name = storage.backend_name().to_string();
    let padded_size = req.data.len() as i64;

    sqlx::query(
        r#"
        INSERT INTO attachments (
            id, room_id, uploader_id, uploader_client_id,
            storage_backend, storage_key,
            padded_size, plaintext_size, encrypted_size,
            chunk_size, chunk_count, nonce_prefix, base_counter,
            content_type
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        "#,
    )
    .bind(&req.claimed_id)
    .bind(&req.room_id)
    .bind(&req.uploader_id)
    .bind(&req.uploader_client_id)
    .bind(&backend_name)
    .bind(&storage_key)
    .bind(padded_size)
    .bind(req.plaintext_size)
    .bind(req.encrypted_size)
    .bind(req.chunk_size)
    .bind(req.chunk_count)
    .bind(&req.nonce_prefix)
    .bind(req.base_counter)
    .bind(&req.content_type)
    .execute(pool)
    .await?;

    get_attachment(pool, &req.claimed_id, &req.uploader_id).await
}

pub async fn get_attachment(
    pool: &SqlitePool,
    attachment_id: &str,
    requester_id: &str,
) -> Result<AttachmentView, AttachmentError> {
    let row: Option<AttachmentRow> = sqlx::query_as(
        r#"
        SELECT
            a.id, a.room_id, a.uploader_id, a.uploader_client_id,
            a.storage_backend, a.padded_size, a.plaintext_size, a.encrypted_size,
            a.chunk_size, a.chunk_count, a.nonce_prefix, a.base_counter,
            a.content_type, a.created_at
        FROM attachments a
        JOIN room_members rm ON rm.room_id = a.room_id
        WHERE a.id = ? AND rm.user_id = ?
        "#,
    )
    .bind(attachment_id)
    .bind(requester_id)
    .fetch_optional(pool)
    .await?;

    match row {
        Some(r) => Ok(r.into()),
        None => Err(AttachmentError::NotFound),
    }
}

pub async fn read_attachment_bytes(
    pool: &SqlitePool,
    storage: &dyn Storage,
    attachment_id: &str,
    requester_id: &str,
) -> Result<(AttachmentView, Vec<u8>), AttachmentError> {
    let view = get_attachment(pool, attachment_id, requester_id).await?;
    let storage_key = storage_key_for_id(&view.id);

    match storage.read(&storage_key).await {
        Ok(bytes) => Ok((view, bytes)),
        Err(StorageError::NotFound(_)) => {
            tracing::error!(attachment_id = %attachment_id, storage_key = %storage_key, "Attachment missing in storage but present in database");
            Err(AttachmentError::NotFound)
        }
        Err(e) => Err(AttachmentError::Storage(e)),
    }
}

pub async fn read_attachment_range(
    pool: &SqlitePool,
    storage: &dyn Storage,
    attachment_id: &str,
    requester_id: &str,
    start: u64,
    end: u64,
) -> Result<(AttachmentView, Vec<u8>), AttachmentError> {
    let view = get_attachment(pool, attachment_id, requester_id).await?;
    let padded_size = view.padded_size as u64;

    if end >= padded_size {
        return Err(AttachmentError::RangeOutOfBounds {
            size: view.padded_size,
        });
    }

    if start > end {
        return Err(AttachmentError::InvalidRange { start, end });
    }

    let storage_key = storage_key_for_id(&view.id);
    let bytes = storage
        .read_range(&storage_key, start, end)
        .await
        .map_err(|e| match e {
            StorageError::NotFound(_) => {
                tracing::error!(attachment_id = %attachment_id, storage_key = %storage_key, "Attachment missing in storage but present in database");
                AttachmentError::NotFound
            }
            other => AttachmentError::Storage(other),
        })?;

    Ok((view, bytes))
}

pub async fn presign_attachment(
    pool: &SqlitePool,
    storage: &dyn Storage,
    attachment_id: &str,
    requester_id: &str,
    ttl_seconds: u64,
) -> Result<PresignResult, AttachmentError> {
    let view = get_attachment(pool, attachment_id, requester_id).await?;
    let storage_key = storage_key_for_id(&view.id);

    let opt_url = storage
        .presign_get(&storage_key, ttl_seconds)
        .await
        .map_err(AttachmentError::Storage)?;

    let url = match opt_url {
        Some(u) => u,
        None => return Err(AttachmentError::PresignNotSupported),
    };

    let expires_at = Utc::now() + chrono::Duration::seconds(ttl_seconds as i64);

    Ok(PresignResult { url, expires_at })
}

pub async fn delete_attachment(
    pool: &SqlitePool,
    storage: &dyn Storage,
    attachment_id: &str,
    requester_id: &str,
) -> Result<(), AttachmentError> {
    let row: Option<(String, String)> =
        sqlx::query_as("SELECT id, uploader_id FROM attachments WHERE id = ?")
            .bind(attachment_id)
            .fetch_optional(pool)
            .await?;

    let (_id, uploader_id) = match row {
        Some(r) => r,
        None => return Err(AttachmentError::NotFound),
    };

    if uploader_id != requester_id {
        return Err(AttachmentError::Forbidden);
    }

    let mut tx = pool.begin().await?;

    sqlx::query("DELETE FROM attachments WHERE id = ?")
        .bind(attachment_id)
        .execute(&mut *tx)
        .await?;

    tx.commit().await?;

    let storage_key = storage_key_for_id(attachment_id);
    if let Err(e) = storage.delete(&storage_key).await {
        tracing::warn!(attachment_id = %attachment_id, storage_key = %storage_key, error = %e, "Failed to delete storage blob after DB commit");
    }

    Ok(())
}

#[derive(Debug, Default)]
pub struct PruneReport {
    pub rooms_scanned: u64,
    pub attachments_deleted: u64,
    pub blobs_deleted: u64,
    pub blob_errors: u64,
}

pub async fn prune_expired(
    pool: &SqlitePool,
    storage: &dyn Storage,
    limits: &InstanceLimits,
    server_max: &ServerHardMax,
) -> Result<PruneReport, AttachmentError> {
    let mut report = PruneReport::default();

    let rooms: Vec<(String, Option<i64>)> = sqlx::query_as(
        r#"
        SELECT DISTINCT r.id, r.retention_days
        FROM rooms r
        JOIN attachments a ON a.room_id = r.id
        "#,
    )
    .fetch_all(pool)
    .await?;

    for (room_id, room_retention_days) in rooms {
        report.rooms_scanned += 1;

        let effective = crate::rooms::effective_message_retention_days(
            room_retention_days,
            limits.attachment_retention_days,
            server_max.attachment_retention_days,
        );

        if effective == 0 {
            continue;
        }

        let expired_rows: Vec<(String, String)> = sqlx::query_as(
            r#"
            SELECT id, storage_key FROM attachments
            WHERE room_id = ?
              AND created_at < datetime('now', '-' || ? || ' days')
            "#,
        )
        .bind(&room_id)
        .bind(effective)
        .fetch_all(pool)
        .await?;

        for chunk in expired_rows.chunks(500) {
            let mut tx = pool.begin().await?;

            let mut query_str = String::from("DELETE FROM attachments WHERE id IN (");
            for i in 0..chunk.len() {
                if i > 0 {
                    query_str.push_str(", ");
                }
                query_str.push('?');
            }
            query_str.push(')');

            let mut query = sqlx::query(&query_str);
            for (id, _) in chunk {
                query = query.bind(id);
            }

            let res = query.execute(&mut *tx).await?;
            tx.commit().await?;

            report.attachments_deleted += res.rows_affected();

            for (_id, storage_key) in chunk {
                match storage.delete(storage_key).await {
                    Ok(()) => report.blobs_deleted += 1,
                    Err(e) => {
                        tracing::warn!(
                            error = %e,
                            key = %storage_key,
                            "failed to delete orphaned blob"
                        );
                        report.blob_errors += 1;
                    }
                }
            }
        }
    }

    Ok(report)
}

#[derive(Debug, sqlx::FromRow)]
struct AttachmentRow {
    id: String,
    room_id: String,
    uploader_id: String,
    uploader_client_id: Option<String>,
    storage_backend: String,
    padded_size: i64,
    plaintext_size: i64,
    encrypted_size: i64,
    chunk_size: i64,
    chunk_count: i64,
    nonce_prefix: String,
    base_counter: i64,
    content_type: String,
    created_at: DateTime<Utc>,
}

impl From<AttachmentRow> for AttachmentView {
    fn from(r: AttachmentRow) -> Self {
        Self {
            id: r.id,
            room_id: r.room_id,
            uploader_id: r.uploader_id,
            uploader_client_id: r.uploader_client_id,
            storage_backend: r.storage_backend,
            padded_size: r.padded_size,
            plaintext_size: r.plaintext_size,
            encrypted_size: r.encrypted_size,
            chunk_size: r.chunk_size,
            chunk_count: r.chunk_count,
            nonce_prefix: r.nonce_prefix,
            base_counter: r.base_counter,
            content_type: r.content_type,
            created_at: r.created_at,
        }
    }
}
