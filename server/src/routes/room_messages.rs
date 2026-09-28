use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
};
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use serde::{Deserialize, Serialize};

use crate::{
    auth::AuthUser,
    devices,
    error::ApiError,
    room_messages::{
        self, MessageContentType, RoomMessageError, RoomMessageView, SubmitOutcome, SubmitRequest,
    },
    AppState,
};

const MAX_CIPHERTEXT_BYTES: usize = 1024 * 1024; // 1 MB

#[derive(Debug, Deserialize)]
pub struct SubmitMessageRequest {
    pub sender_client_id: String,
    pub epoch: i64,
    pub content_type: String,
    pub ciphertext: String,
    pub transcript_hash: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ListMessagesQuery {
    pub since_epoch: Option<i64>,
    pub limit: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct EpochResponse {
    pub epoch: i64,
    pub sequence: i64,
}

#[derive(Debug, Serialize)]
pub struct ListMessagesResponse {
    pub messages: Vec<RoomMessageView>,
}

#[derive(Debug, Serialize)]
pub struct MessageCiphertextResponse {
    pub id: String,
    pub ciphertext: String,
}

pub async fn submit(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
    Json(payload): Json<SubmitMessageRequest>,
) -> Result<(StatusCode, Json<SubmitOutcome>), ApiError> {
    // 1. Validate sender_client_id belongs to auth user
    let user_devices = devices::list_devices(&state.pool, &auth.user_id).await?;
    if !user_devices
        .iter()
        .any(|d| d.client_id == payload.sender_client_id)
    {
        return Err(ApiError::BadRequest("unknown_client_id".to_string()));
    }

    // 2. Validate epoch
    if payload.epoch < 0 {
        return Err(ApiError::BadRequest("invalid_epoch".to_string()));
    }

    // 3. Validate content_type
    let content_type = match payload.content_type.as_str() {
        "application" => MessageContentType::Application,
        "commit" => MessageContentType::Commit,
        "proposal" => MessageContentType::Proposal,
        _ => return Err(ApiError::BadRequest("invalid_content_type".to_string())),
    };

    // 4. Validate ciphertext base64 & size (1 byte to 1MB)
    let ciphertext_bytes = BASE64
        .decode(payload.ciphertext.trim())
        .map_err(|_| ApiError::BadRequest("invalid_ciphertext_base64".to_string()))?;

    if ciphertext_bytes.is_empty() || ciphertext_bytes.len() > MAX_CIPHERTEXT_BYTES {
        return Err(ApiError::BadRequest(
            "invalid_ciphertext_length".to_string(),
        ));
    }

    // 5. Validate transcript_hash if commit
    let transcript_hash_bytes = match content_type {
        MessageContentType::Commit => {
            let th_str = payload
                .transcript_hash
                .as_deref()
                .ok_or_else(|| ApiError::BadRequest("missing_transcript_hash".to_string()))?;

            let bytes = BASE64
                .decode(th_str.trim())
                .map_err(|_| ApiError::BadRequest("invalid_transcript_hash_base64".to_string()))?;

            if bytes.len() != 32 {
                return Err(ApiError::BadRequest(
                    "invalid_transcript_hash_length".to_string(),
                ));
            }
            Some(bytes)
        }
        _ => None,
    };

    let room_id = id;
    let sender_user_id = auth.user_id.clone();
    let sender_client_id = payload.sender_client_id.clone();

    let req = SubmitRequest {
        room_id: room_id.clone(),
        sender_user_id: sender_user_id.clone(),
        sender_client_id: sender_client_id.clone(),
        epoch: payload.epoch,
        content_type,
        ciphertext: ciphertext_bytes,
        transcript_hash: transcript_hash_bytes,
    };

    let outcome = room_messages::submit_message(&state.pool, req)
        .await
        .map_err(|e| match e {
            RoomMessageError::EpochMismatch { expected, received } => {
                ApiError::ConflictWithDetails(
                    "epoch_mismatch".to_string(),
                    serde_json::json!({
                        "expected": expected,
                        "received": received,
                    }),
                )
            }
            RoomMessageError::MissingTranscriptHash => {
                ApiError::BadRequest("missing_transcript_hash".to_string())
            }
            RoomMessageError::RoomNotFound | RoomMessageError::NotAMember => {
                ApiError::NotFound("room_not_found".to_string())
            }
            RoomMessageError::Database(err) => ApiError::Internal(err.into()),
            _ => ApiError::BadRequest("invalid_request".to_string()),
        })?;

    // Publish event to Sockudo after transaction commits
    let (message_id, event_data) = match &outcome {
        SubmitOutcome::Commit {
            message_id,
            new_epoch,
            ..
        } => (
            message_id.clone(),
            serde_json::json!({
                "type": "commit",
                "message_id": message_id,
                "sender_user_id": sender_user_id,
                "sender_client_id": sender_client_id,
                "new_epoch": new_epoch,
            }),
        ),
        SubmitOutcome::Application {
            message_id,
            epoch,
            seq,
        } => (
            message_id.clone(),
            serde_json::json!({
                "type": content_type.as_str(),
                "message_id": message_id,
                "sender_user_id": sender_user_id,
                "sender_client_id": sender_client_id,
                "epoch": epoch,
                "seq": seq,
            }),
        ),
    };

    let created_at: Option<chrono::DateTime<chrono::Utc>> =
        sqlx::query_scalar("SELECT created_at FROM room_messages WHERE id = ?")
            .bind(&message_id)
            .fetch_optional(&state.pool)
            .await
            .unwrap_or(None);

    let created_at_str = created_at.unwrap_or_else(chrono::Utc::now).to_rfc3339();

    let mut final_event_data = event_data;
    if let Some(obj) = final_event_data.as_object_mut() {
        obj.insert(
            "created_at".to_string(),
            serde_json::Value::String(created_at_str),
        );
    }

    let channel = format!("private-room-{}", room_id);
    let _ = state
        .sockudo_publisher
        .publish(&channel, "message", final_event_data)
        .await;

    Ok((StatusCode::CREATED, Json(outcome)))
}

pub async fn get_epoch(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
) -> Result<Json<EpochResponse>, ApiError> {
    let (epoch, sequence) = room_messages::get_current_epoch(&state.pool, &id, &auth.user_id)
        .await
        .map_err(|e| match e {
            RoomMessageError::RoomNotFound | RoomMessageError::NotAMember => {
                ApiError::NotFound("room_not_found".to_string())
            }
            RoomMessageError::Database(err) => ApiError::Internal(err.into()),
            _ => ApiError::BadRequest("invalid_request".to_string()),
        })?;

    Ok(Json(EpochResponse { epoch, sequence }))
}

pub async fn list(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
    Query(query): Query<ListMessagesQuery>,
) -> Result<Json<ListMessagesResponse>, ApiError> {
    let limit = query.limit.unwrap_or(100).clamp(1, 500);

    let messages =
        room_messages::list_messages(&state.pool, &id, &auth.user_id, query.since_epoch, limit)
            .await
            .map_err(|e| match e {
                RoomMessageError::RoomNotFound | RoomMessageError::NotAMember => {
                    ApiError::NotFound("room_not_found".to_string())
                }
                RoomMessageError::Database(err) => ApiError::Internal(err.into()),
                _ => ApiError::BadRequest("invalid_request".to_string()),
            })?;

    Ok(Json(ListMessagesResponse { messages }))
}

pub async fn get_ciphertext(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((id, message_id)): Path<(String, String)>,
) -> Result<Json<MessageCiphertextResponse>, ApiError> {
    let ciphertext_bytes =
        room_messages::get_message_ciphertext(&state.pool, &id, &auth.user_id, &message_id)
            .await
            .map_err(|e| match e {
                RoomMessageError::RoomNotFound | RoomMessageError::NotAMember => {
                    ApiError::NotFound("room_not_found".to_string())
                }
                RoomMessageError::MessageNotFound => {
                    ApiError::NotFound("message_not_found".to_string())
                }
                RoomMessageError::Database(err) => ApiError::Internal(err.into()),
                _ => ApiError::BadRequest("invalid_request".to_string()),
            })?;

    let ciphertext_b64 = BASE64.encode(ciphertext_bytes);

    Ok(Json(MessageCiphertextResponse {
        id: message_id,
        ciphertext: ciphertext_b64,
    }))
}
