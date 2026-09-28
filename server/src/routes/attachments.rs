use axum::{
    extract::{FromRequest, Multipart, Path, State},
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;
use std::sync::Arc;

use crate::attachments::{self, AttachmentError, UploadRequest};
use crate::auth::AuthUser;
use crate::config::Config;
use crate::limits::{self, ServerHardMax};
use crate::storage::Storage;
use sqlx::SqlitePool;

#[allow(clippy::too_many_arguments)]
pub async fn upload(
    State(pool): State<SqlitePool>,
    State(storage): State<Arc<dyn Storage>>,
    State(config): State<Arc<Config>>,
    State(hard_max): State<Arc<ServerHardMax>>,
    AuthUser { user_id, .. }: AuthUser,
    Path(room_id): Path<String>,
    headers: HeaderMap,
    body: axum::extract::Request,
) -> Result<impl IntoResponse, AttachmentRouteError> {
    // 1. Calculate effective limit
    let effective_limit =
        get_effective_file_size_limit(&pool, &room_id, &config, &hard_max).await?;

    let content_type = headers
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_lowercase();

    let req = if content_type.starts_with("multipart/form-data") {
        let multipart = Multipart::from_request(body, &())
            .await
            .map_err(|_| AttachmentRouteError::MissingFile)?;

        parse_multipart(&room_id, &user_id, multipart).await?
    } else if content_type.starts_with("application/octet-stream") || content_type.is_empty() {
        let bytes = axum::body::to_bytes(body.into_body(), usize::MAX)
            .await
            .map_err(|e| AttachmentRouteError::BadRequest(e.to_string()))?;

        parse_octet_stream(&room_id, &user_id, &headers, bytes.to_vec())?
    } else {
        return Err(AttachmentRouteError::UnsupportedMediaType);
    };

    if req.data.len() as u64 > effective_limit {
        return Err(AttachmentRouteError::FileTooLarge {
            limit: effective_limit,
            received: req.data.len() as u64,
        });
    }

    let view = attachments::upload_attachment(&pool, storage.as_ref(), &config, req).await?;
    Ok((StatusCode::CREATED, Json(view)))
}

pub async fn download(
    State(pool): State<SqlitePool>,
    State(storage): State<Arc<dyn Storage>>,
    AuthUser { user_id, .. }: AuthUser,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Result<Response, AttachmentRouteError> {
    if headers.contains_key(header::RANGE) {
        // Range requests are not supported in Phase 12a
        let view_opt = attachments::get_attachment(&pool, &id, &user_id).await;
        let content_range = match view_opt {
            Ok(v) => format!("bytes */{}", v.padded_size),
            Err(_) => "bytes */*".to_string(),
        };

        return Ok((
            StatusCode::RANGE_NOT_SATISFIABLE,
            [
                (header::CONTENT_RANGE, content_range),
                (header::CONTENT_TYPE, "application/json".to_string()),
            ],
            Json(json!({
                "error": "range_not_satisfiable",
                "message": "Range requests are not supported in Phase 12a"
            })),
        )
            .into_response());
    }

    let etag_val = format!("\"{}\"", id);
    if let Some(if_none_match) = headers
        .get(header::IF_NONE_MATCH)
        .and_then(|v| v.to_str().ok())
    {
        if if_none_match.trim() == etag_val || if_none_match.trim() == id {
            return Ok((StatusCode::NOT_MODIFIED, [(header::ETAG, etag_val)]).into_response());
        }
    }

    let (view, bytes) =
        attachments::read_attachment_bytes(&pool, storage.as_ref(), &id, &user_id).await?;

    let res_headers = [
        (header::CONTENT_TYPE, "application/octet-stream".to_string()),
        (header::CONTENT_LENGTH, view.padded_size.to_string()),
        (header::CONTENT_DISPOSITION, "inline".to_string()),
        (
            header::CACHE_CONTROL,
            "private, max-age=86400, immutable".to_string(),
        ),
        (header::ETAG, etag_val),
        (header::X_CONTENT_TYPE_OPTIONS, "nosniff".to_string()),
        (
            "X-Attachment-Content-Type".parse().unwrap(),
            view.content_type,
        ),
        (
            "X-Attachment-Chunk-Size".parse().unwrap(),
            view.chunk_size.to_string(),
        ),
        (
            "X-Attachment-Chunk-Count".parse().unwrap(),
            view.chunk_count.to_string(),
        ),
        (
            "X-Attachment-Plaintext-Size".parse().unwrap(),
            view.plaintext_size.to_string(),
        ),
        (
            "X-Attachment-Encrypted-Size".parse().unwrap(),
            view.encrypted_size.to_string(),
        ),
        (
            "X-Attachment-Nonce-Prefix".parse().unwrap(),
            view.nonce_prefix,
        ),
        (
            "X-Attachment-Base-Counter".parse().unwrap(),
            view.base_counter.to_string(),
        ),
    ];

    Ok((StatusCode::OK, res_headers, bytes).into_response())
}

pub async fn delete_attachment(
    State(pool): State<SqlitePool>,
    State(storage): State<Arc<dyn Storage>>,
    AuthUser { user_id, .. }: AuthUser,
    Path(id): Path<String>,
) -> Result<StatusCode, AttachmentRouteError> {
    attachments::delete_attachment(&pool, storage.as_ref(), &id, &user_id).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn get_effective_file_size_limit(
    pool: &SqlitePool,
    room_id: &str,
    config: &Config,
    hard_max: &ServerHardMax,
) -> Result<u64, AttachmentRouteError> {
    let room_limit: Option<Option<i64>> =
        sqlx::query_scalar("SELECT max_file_size_bytes FROM rooms WHERE id = ?")
            .bind(room_id)
            .fetch_optional(pool)
            .await
            .map_err(AttachmentError::from)?;

    let room_override = match room_limit {
        Some(opt) => opt,
        None => return Err(AttachmentRouteError::RoomNotFound),
    };

    let effective = limits::effective_file_size_limit(
        room_override,
        config.max_file_size_bytes as i64,
        hard_max.file_size_bytes,
    );

    Ok(effective as u64)
}

async fn parse_multipart(
    room_id: &str,
    uploader_id: &str,
    mut multipart: Multipart,
) -> Result<UploadRequest, AttachmentRouteError> {
    let mut file_data: Option<Vec<u8>> = None;
    let mut claimed_id: Option<String> = None;
    let mut plaintext_size: Option<i64> = None;
    let mut encrypted_size: Option<i64> = None;
    let mut chunk_size: Option<i64> = None;
    let mut chunk_count: Option<i64> = None;
    let mut nonce_prefix: Option<String> = None;
    let mut base_counter: Option<i64> = None;
    let mut content_type: Option<String> = None;
    let mut uploader_client_id: Option<String> = None;

    while let Ok(Some(field)) = multipart.next_field().await {
        let name = field.name().unwrap_or("").to_string();
        match name.as_str() {
            "file" => {
                let bytes = field
                    .bytes()
                    .await
                    .map_err(|e| AttachmentRouteError::BadRequest(e.to_string()))?;
                file_data = Some(bytes.to_vec());
            }
            "claimed_id" => {
                let text = field
                    .text()
                    .await
                    .map_err(|e| AttachmentRouteError::BadRequest(e.to_string()))?;
                claimed_id = Some(text);
            }
            "plaintext_size" => {
                let text = field
                    .text()
                    .await
                    .map_err(|e| AttachmentRouteError::BadRequest(e.to_string()))?;
                plaintext_size = text.parse().ok();
            }
            "encrypted_size" => {
                let text = field
                    .text()
                    .await
                    .map_err(|e| AttachmentRouteError::BadRequest(e.to_string()))?;
                encrypted_size = text.parse().ok();
            }
            "chunk_size" => {
                let text = field
                    .text()
                    .await
                    .map_err(|e| AttachmentRouteError::BadRequest(e.to_string()))?;
                chunk_size = text.parse().ok();
            }
            "chunk_count" => {
                let text = field
                    .text()
                    .await
                    .map_err(|e| AttachmentRouteError::BadRequest(e.to_string()))?;
                chunk_count = text.parse().ok();
            }
            "nonce_prefix" => {
                let text = field
                    .text()
                    .await
                    .map_err(|e| AttachmentRouteError::BadRequest(e.to_string()))?;
                nonce_prefix = Some(text);
            }
            "base_counter" => {
                let text = field
                    .text()
                    .await
                    .map_err(|e| AttachmentRouteError::BadRequest(e.to_string()))?;
                base_counter = text.parse().ok();
            }
            "content_type" => {
                let text = field
                    .text()
                    .await
                    .map_err(|e| AttachmentRouteError::BadRequest(e.to_string()))?;
                content_type = Some(text);
            }
            "uploader_client_id" => {
                let text = field
                    .text()
                    .await
                    .map_err(|e| AttachmentRouteError::BadRequest(e.to_string()))?;
                uploader_client_id = Some(text);
            }
            _ => {}
        }
    }

    let data = file_data.ok_or(AttachmentRouteError::MissingFile)?;
    let claimed_id = claimed_id.ok_or(AttachmentRouteError::InvalidClaimedId)?;
    let plaintext_size = plaintext_size.ok_or_else(|| {
        AttachmentRouteError::InvalidManifest("missing plaintext_size".to_string())
    })?;
    let encrypted_size = encrypted_size.ok_or_else(|| {
        AttachmentRouteError::InvalidManifest("missing encrypted_size".to_string())
    })?;
    let chunk_size = chunk_size
        .ok_or_else(|| AttachmentRouteError::InvalidManifest("missing chunk_size".to_string()))?;
    let chunk_count = chunk_count
        .ok_or_else(|| AttachmentRouteError::InvalidManifest("missing chunk_count".to_string()))?;
    let nonce_prefix = nonce_prefix
        .ok_or_else(|| AttachmentRouteError::InvalidManifest("missing nonce_prefix".to_string()))?;
    let base_counter = base_counter
        .ok_or_else(|| AttachmentRouteError::InvalidManifest("missing base_counter".to_string()))?;

    Ok(UploadRequest {
        room_id: room_id.to_string(),
        uploader_id: uploader_id.to_string(),
        uploader_client_id,
        content_type: content_type.unwrap_or_else(|| "application/octet-stream".to_string()),
        data,
        claimed_id,
        plaintext_size,
        encrypted_size,
        chunk_size,
        chunk_count,
        nonce_prefix,
        base_counter,
    })
}

fn parse_octet_stream(
    room_id: &str,
    uploader_id: &str,
    headers: &HeaderMap,
    data: Vec<u8>,
) -> Result<UploadRequest, AttachmentRouteError> {
    let get_header = |name: &str| -> Option<String> {
        headers
            .get(name)
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string())
    };

    let get_header_i64 =
        |name: &str| -> Option<i64> { get_header(name).and_then(|s| s.parse().ok()) };

    let claimed_id = get_header("X-Claimed-Id").ok_or(AttachmentRouteError::InvalidClaimedId)?;
    let plaintext_size = get_header_i64("X-Plaintext-Size").ok_or_else(|| {
        AttachmentRouteError::InvalidManifest("missing X-Plaintext-Size".to_string())
    })?;
    let encrypted_size = get_header_i64("X-Encrypted-Size").ok_or_else(|| {
        AttachmentRouteError::InvalidManifest("missing X-Encrypted-Size".to_string())
    })?;
    let chunk_size = get_header_i64("X-Chunk-Size")
        .ok_or_else(|| AttachmentRouteError::InvalidManifest("missing X-Chunk-Size".to_string()))?;
    let chunk_count = get_header_i64("X-Chunk-Count").ok_or_else(|| {
        AttachmentRouteError::InvalidManifest("missing X-Chunk-Count".to_string())
    })?;
    let nonce_prefix = get_header("X-Nonce-Prefix").ok_or_else(|| {
        AttachmentRouteError::InvalidManifest("missing X-Nonce-Prefix".to_string())
    })?;
    let base_counter = get_header_i64("X-Base-Counter").ok_or_else(|| {
        AttachmentRouteError::InvalidManifest("missing X-Base-Counter".to_string())
    })?;

    let content_type = get_header("X-Content-Type")
        .or_else(|| get_header("Content-Type"))
        .unwrap_or_else(|| "application/octet-stream".to_string());

    let uploader_client_id = get_header("X-Uploader-Client-Id");

    Ok(UploadRequest {
        room_id: room_id.to_string(),
        uploader_id: uploader_id.to_string(),
        uploader_client_id,
        content_type,
        data,
        claimed_id,
        plaintext_size,
        encrypted_size,
        chunk_size,
        chunk_count,
        nonce_prefix,
        base_counter,
    })
}

#[derive(Debug, thiserror::Error)]
pub enum AttachmentRouteError {
    #[error("missing file")]
    MissingFile,
    #[error("invalid claimed_id")]
    InvalidClaimedId,
    #[error("invalid manifest: {0}")]
    InvalidManifest(String),
    #[error("bad request: {0}")]
    BadRequest(String),
    #[error("unsupported media type")]
    UnsupportedMediaType,
    #[error("room not found")]
    RoomNotFound,
    #[error("file too large: limit {limit}, received {received}")]
    FileTooLarge { limit: u64, received: u64 },
    #[error("attachment error: {0}")]
    Attachment(#[from] AttachmentError),
}

impl IntoResponse for AttachmentRouteError {
    fn into_response(self) -> Response {
        match self {
            AttachmentRouteError::MissingFile => (
                StatusCode::BAD_REQUEST,
                Json(json!({"error": "missing_file", "message": "Field 'file' is required"})),
            )
                .into_response(),
            AttachmentRouteError::InvalidClaimedId => (
                StatusCode::BAD_REQUEST,
                Json(json!({"error": "invalid_claimed_id", "message": "Claimed ID must be a 64-character hex string"})),
            )
                .into_response(),
            AttachmentRouteError::InvalidManifest(reason) => (
                StatusCode::BAD_REQUEST,
                Json(json!({
                    "error": "invalid_manifest",
                    "message": format!("Invalid manifest: {}", reason),
                    "details": { "reason": reason }
                })),
            )
                .into_response(),
            AttachmentRouteError::BadRequest(msg) => (
                StatusCode::BAD_REQUEST,
                Json(json!({"error": "bad_request", "message": msg})),
            )
                .into_response(),
            AttachmentRouteError::UnsupportedMediaType => (
                StatusCode::UNSUPPORTED_MEDIA_TYPE,
                Json(json!({"error": "unsupported_media_type", "message": "Content-Type must be multipart/form-data or application/octet-stream"})),
            )
                .into_response(),
            AttachmentRouteError::RoomNotFound => (
                StatusCode::NOT_FOUND,
                Json(json!({"error": "room_not_found", "message": "Room not found"})),
            )
                .into_response(),
            AttachmentRouteError::FileTooLarge { limit, received } => (
                StatusCode::PAYLOAD_TOO_LARGE,
                Json(json!({
                    "error": "file_too_large",
                    "message": "File exceeds effective size limit",
                    "details": { "limit": limit, "received": received }
                })),
            )
                .into_response(),
            AttachmentRouteError::Attachment(err) => match err {
                AttachmentError::NotAMember | AttachmentError::RoomNotFound => (
                    StatusCode::NOT_FOUND,
                    Json(json!({"error": "room_not_found", "message": "Room not found"})),
                )
                    .into_response(),
                AttachmentError::HashMismatch { expected, computed } => (
                    StatusCode::BAD_REQUEST,
                    Json(json!({
                        "error": "hash_mismatch",
                        "message": "Computed hash does not match claimed_id",
                        "details": { "expected": expected, "computed": computed }
                    })),
                )
                    .into_response(),
                AttachmentError::InvalidBucketSize(received) => (
                    StatusCode::PAYLOAD_TOO_LARGE,
                    Json(json!({
                        "error": "invalid_bucket_size",
                        "message": "File size does not match any allowed bucket size",
                        "details": { "received": received }
                    })),
                )
                    .into_response(),
                AttachmentError::NotFound => (
                    StatusCode::NOT_FOUND,
                    Json(json!({"error": "attachment_not_found", "message": "Attachment not found"})),
                )
                    .into_response(),
                AttachmentError::Forbidden => (
                    StatusCode::FORBIDDEN,
                    Json(json!({"error": "forbidden", "message": "Only the uploader can perform this action"})),
                )
                    .into_response(),
                AttachmentError::AlreadyExists => (
                    StatusCode::CONFLICT,
                    Json(json!({"error": "id_conflict", "message": "Attachment ID conflict"})),
                )
                    .into_response(),
                AttachmentError::InvalidManifest(reason) => (
                    StatusCode::BAD_REQUEST,
                    Json(json!({
                        "error": "invalid_manifest",
                        "message": format!("Invalid manifest: {}", reason),
                        "details": { "reason": reason }
                    })),
                )
                    .into_response(),
                AttachmentError::Database(e) => {
                    tracing::error!("Database error in attachment route: {}", e);
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        Json(json!({"error": "internal", "message": "Internal server error"})),
                    )
                        .into_response()
                }
                AttachmentError::Storage(e) => {
                    tracing::error!("Storage error in attachment route: {}", e);
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        Json(json!({"error": "internal", "message": "Internal server error"})),
                    )
                        .into_response()
                }
            },
        }
    }
}
