use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
};
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::{
    audit,
    auth::AuthUser,
    config_ops, devices,
    error::ApiError,
    room_messages::{
        self, DeleteRequest, MessageContentType, RoomMessageView, SubmitOutcome, SubmitRequest,
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

    let req = SubmitRequest {
        room_id: id.clone(),
        sender_user_id: auth.user_id.clone(),
        sender_client_id: payload.sender_client_id.clone(),
        epoch: payload.epoch,
        content_type,
        ciphertext: ciphertext_bytes,
        transcript_hash: transcript_hash_bytes,
    };

    let outcome = room_messages::submit_message(&state.pool, req).await?;

    // Publish event after commit
    let channel = format!("private-room-{}", id);
    match &outcome {
        SubmitOutcome::Application {
            message_id,
            epoch,
            seq,
            created_at,
        } => {
            let msg_payload = json!({
                "id": message_id,
                "room_id": id,
                "sender_user_id": auth.user_id,
                "sender_client_id": payload.sender_client_id,
                "epoch": epoch,
                "seq": seq,
                "content_type": content_type.as_str(),
                "created_at": created_at.to_rfc3339(),
            });
            if let Err(e) = state
                .publisher
                .publish(&channel, "message.new", msg_payload)
                .await
            {
                tracing::warn!(error = %e, channel = %channel, "sockudo publish failed");
            }
        }
        SubmitOutcome::Commit {
            message_id,
            new_epoch,
            created_at,
            ..
        } => {
            let msg_payload = json!({
                "id": message_id,
                "room_id": id,
                "sender_user_id": auth.user_id,
                "sender_client_id": payload.sender_client_id,
                "epoch": new_epoch,
                "seq": 0,
                "content_type": "commit",
                "created_at": created_at.to_rfc3339(),
            });
            if let Err(e) = state
                .publisher
                .publish(&channel, "message.new", msg_payload)
                .await
            {
                tracing::warn!(error = %e, channel = %channel, "sockudo publish failed");
            }

            let epoch_payload = json!({
                "room_id": id,
                "epoch": new_epoch,
                "sequence": 0,
            });
            if let Err(e) = state
                .publisher
                .publish(&channel, "epoch.updated", epoch_payload)
                .await
            {
                tracing::warn!(error = %e, channel = %channel, "sockudo publish failed");
            }
        }
    }

    Ok((StatusCode::CREATED, Json(outcome)))
}

pub async fn get_epoch(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
) -> Result<Json<EpochResponse>, ApiError> {
    let (epoch, sequence) =
        room_messages::get_current_epoch(&state.pool, &id, &auth.user_id).await?;

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
            .await?;

    Ok(Json(ListMessagesResponse { messages }))
}

pub async fn get_ciphertext(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((id, message_id)): Path<(String, String)>,
) -> Result<Json<MessageCiphertextResponse>, ApiError> {
    let ciphertext_bytes =
        room_messages::get_message_ciphertext(&state.pool, &id, &auth.user_id, &message_id).await?;

    let ciphertext_b64 = BASE64.encode(ciphertext_bytes);

    Ok(Json(MessageCiphertextResponse {
        id: message_id,
        ciphertext: ciphertext_b64,
    }))
}

pub async fn delete_message(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((id, message_id)): Path<(String, String)>,
) -> Result<StatusCode, ApiError> {
    let config = config_ops::get_config(&state.pool).await?;

    let req = DeleteRequest {
        room_id: id.clone(),
        message_id: message_id.clone(),
        requester_id: auth.user_id.clone(),
        moderation_mode: config.moderation_mode,
    };

    room_messages::delete_message(&state.pool, req).await?;

    let _ = audit::log(
        &state.pool,
        Some(&auth.user_id),
        audit::action::MESSAGE_DELETE,
        Some("room_message"),
        Some(&message_id),
        Some(json!({ "room_id": id })),
    )
    .await;

    let channel = format!("private-room-{}", id);
    let payload = json!({
        "id": message_id,
        "room_id": id,
    });

    if let Err(e) = state
        .publisher
        .publish(&channel, "message.deleted", payload)
        .await
    {
        tracing::warn!(error = %e, channel = %channel, "sockudo publish failed");
    }

    Ok(StatusCode::NO_CONTENT)
}
