use axum::{
    extract::{Path, Query, State},
    http::{header, HeaderMap, StatusCode},
    response::IntoResponse,
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
    limits,
    rate_limit::{self, RateLimitKey},
    room_messages::{
        self, DeleteRequest, EditRequest, ListMessagesQuery, ListMessagesResult,
        MessageContentType, MessageCursor, RoomMessageError, SubmitOutcome, SubmitRequest,
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
    pub reply_to: Option<String>,
    pub target_user_ids: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
pub struct EditMessageRequest {
    pub ciphertext: Option<String>,
    pub content_type: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ListQuery {
    pub since_epoch: Option<i64>,
    pub since_seq: Option<i64>,
    pub limit: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct EpochResponse {
    pub epoch: i64,
    pub sequence: i64,
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

    // 5. Validate target_user_ids if present
    let target_user_ids = if let Some(ref targets) = payload.target_user_ids {
        if targets.is_empty() {
            return Err(ApiError::BadRequest("invalid_target_user_ids".to_string()));
        }

        let instance_limits = limits::get_limits(&state.pool, &state.server_hard_max).await?;
        let cap = instance_limits.room_size as usize;
        if targets.len() > cap {
            return Err(ApiError::BadRequest(
                "target_user_ids_too_large".to_string(),
            ));
        }

        let member_rows: Vec<(String,)> =
            sqlx::query_as("SELECT user_id FROM room_members WHERE room_id = ?")
                .bind(&id)
                .fetch_all(&state.pool)
                .await?;

        let member_set: std::collections::HashSet<String> =
            member_rows.into_iter().map(|(u,)| u).collect();

        let mut deduped: Vec<String> = Vec::new();
        for target_id in targets {
            if !member_set.contains(target_id) {
                return Err(ApiError::BadRequest("target_not_in_room".to_string()));
            }
            if !deduped.contains(target_id) {
                deduped.push(target_id.clone());
            }
        }
        Some(deduped)
    } else {
        None
    };

    // 6. Validate transcript_hash if commit
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
        reply_to: payload.reply_to.clone(),
        target_user_ids,
    };

    let outcome = room_messages::submit_message(&state.pool, req).await?;

    // Publish event after commit
    let room_channel = format!("private-room-{}", id);
    match &outcome {
        SubmitOutcome::Application {
            message_id,
            epoch,
            seq,
            reply_to,
            target_user_ids,
            created_at,
        } => {
            let is_whisper = target_user_ids.as_ref().is_some_and(|t| !t.is_empty());

            if is_whisper {
                let whisper_targets = target_user_ids.as_ref().unwrap();
                let mut recipients: Vec<String> = Vec::new();
                for target_id in whisper_targets {
                    if !recipients.contains(target_id) {
                        recipients.push(target_id.clone());
                    }
                }
                if !recipients.contains(&auth.user_id) {
                    recipients.push(auth.user_id.clone());
                }

                let msg_payload = json!({
                    "id": message_id,
                    "room_id": id,
                    "sender_type": "user",
                    "sender_id": auth.user_id,
                    "sender_client_id": payload.sender_client_id,
                    "epoch": epoch,
                    "seq": seq,
                    "content_type": content_type.as_str(),
                    "reply_to": reply_to,
                    "target_user_ids": whisper_targets,
                    "created_at": created_at.to_rfc3339(),
                });

                for recipient_id in recipients {
                    let user_channel = format!("private-user-{}", recipient_id);
                    if let Err(e) = state
                        .publisher
                        .publish(&user_channel, "message.new", msg_payload.clone())
                        .await
                    {
                        tracing::warn!(error = %e, channel = %user_channel, "sockudo whisper publish failed");
                    }
                }
            } else {
                let msg_payload = json!({
                    "id": message_id,
                    "room_id": id,
                    "sender_type": "user",
                    "sender_id": auth.user_id,
                    "sender_client_id": payload.sender_client_id,
                    "epoch": epoch,
                    "seq": seq,
                    "content_type": content_type.as_str(),
                    "reply_to": reply_to,
                    "created_at": created_at.to_rfc3339(),
                });
                if let Err(e) = state
                    .publisher
                    .publish(&room_channel, "message.new", msg_payload)
                    .await
                {
                    tracing::warn!(error = %e, channel = %room_channel, "sockudo publish failed");
                }
            }

            if state.config.push_delivery_enabled {
                if let Some(ref delivery) = state.push_delivery {
                    let delivery = delivery.clone();
                    let room_id = id.clone();
                    let sender_id = auth.user_id.clone();
                    tokio::spawn(async move {
                        delivery
                            .dispatch_message_notification(&room_id, &sender_id)
                            .await;
                    });
                }
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
                "sender_type": "user",
                "sender_id": auth.user_id,
                "sender_client_id": payload.sender_client_id,
                "epoch": new_epoch,
                "seq": 0,
                "content_type": "commit",
                "reply_to": serde_json::Value::Null,
                "created_at": created_at.to_rfc3339(),
            });
            if let Err(e) = state
                .publisher
                .publish(&room_channel, "message.new", msg_payload)
                .await
            {
                tracing::warn!(error = %e, channel = %room_channel, "sockudo publish failed");
            }

            let epoch_payload = json!({
                "room_id": id,
                "epoch": new_epoch,
                "sequence": 0,
            });
            if let Err(e) = state
                .publisher
                .publish(&room_channel, "epoch.updated", epoch_payload)
                .await
            {
                tracing::warn!(error = %e, channel = %room_channel, "sockudo publish failed");
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
    Query(query): Query<ListQuery>,
) -> Result<Json<ListMessagesResult>, ApiError> {
    let since = match (query.since_epoch, query.since_seq) {
        (Some(epoch), Some(seq)) => {
            if epoch < 0 || seq < 0 {
                return Err(ApiError::BadRequest("invalid_cursor".to_string()));
            }
            Some(MessageCursor { epoch, seq })
        }
        (None, None) => None,
        _ => return Err(ApiError::BadRequest("invalid_cursor".to_string())),
    };

    let limit = query.limit.unwrap_or(50);

    let list_query = ListMessagesQuery {
        room_id: id,
        requester_id: auth.user_id,
        since,
        limit,
    };

    let result = room_messages::list_messages(&state.pool, list_query).await?;

    Ok(Json(result))
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

    let delete_res = room_messages::delete_message(&state.pool, req).await?;

    let _ = audit::log(
        &state.pool,
        Some(&auth.user_id),
        audit::action::MESSAGE_DELETE,
        Some("room_message"),
        Some(&message_id),
        Some(json!({ "room_id": id })),
    )
    .await;

    let is_whisper = delete_res
        .target_user_ids
        .as_ref()
        .is_some_and(|t| !t.is_empty());

    if is_whisper {
        let whisper_targets = delete_res.target_user_ids.as_ref().unwrap();
        let mut recipients: Vec<String> = Vec::new();
        for target_id in whisper_targets {
            if !recipients.contains(target_id) {
                recipients.push(target_id.clone());
            }
        }
        if !recipients.contains(&delete_res.sender_user_id) {
            recipients.push(delete_res.sender_user_id.clone());
        }

        let payload = json!({
            "id": message_id,
            "room_id": id,
            "target_user_ids": whisper_targets,
        });

        for recipient_id in recipients {
            let user_channel = format!("private-user-{}", recipient_id);
            if let Err(e) = state
                .publisher
                .publish(&user_channel, "message.deleted", payload.clone())
                .await
            {
                tracing::warn!(error = %e, channel = %user_channel, "sockudo whisper delete publish failed");
            }
        }
    } else {
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
    }

    Ok(StatusCode::NO_CONTENT)
}

pub async fn edit(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((id, message_id)): Path<(String, String)>,
    headers: HeaderMap,
    Json(payload): Json<EditMessageRequest>,
) -> Result<impl IntoResponse, ApiError> {
    // 1. Rate limit check
    let decision = rate_limit::check(
        &state.pool,
        &state.config.rate_limits,
        RateLimitKey::Edit {
            user_id: auth.user_id.clone(),
        },
    )
    .await?;

    if !decision.allowed {
        return Err(ApiError::TooManyRequests {
            message: "rate limit exceeded for message edit".to_string(),
            reset_at: decision.reset_at,
        });
    }

    // 2. Validate ciphertext present
    let ciphertext_b64 = payload.ciphertext.ok_or_else(|| {
        ApiError::InternalWithDetails(
            StatusCode::BAD_REQUEST,
            "missing_field".to_string(),
            json!({ "field": "ciphertext" }),
        )
    })?;

    // 3. Base64 decode ciphertext
    let ciphertext_bytes = BASE64
        .decode(ciphertext_b64.trim())
        .map_err(|_| ApiError::BadRequest("invalid_ciphertext".to_string()))?;

    // 4. Validate ciphertext length against effective limit
    let instance_limits = limits::get_limits(&state.pool, &state.server_hard_max).await?;
    let max_message_size = instance_limits
        .message_size_bytes
        .min(state.server_hard_max.message_size_bytes) as usize;

    if ciphertext_bytes.len() > max_message_size {
        return Err(ApiError::InternalCustom(
            StatusCode::PAYLOAD_TOO_LARGE,
            "ciphertext_too_large".to_string(),
        ));
    }

    // 5. Determine client_id
    let user_devices = devices::list_devices(&state.pool, &auth.user_id).await?;
    let requester_client_id =
        if let Some(header_cid) = headers.get("x-client-id").and_then(|h| h.to_str().ok()) {
            header_cid.to_string()
        } else if let Some(dev) = user_devices.first() {
            dev.client_id.clone()
        } else {
            return Err(ApiError::BadRequest("unknown_client_id".to_string()));
        };

    // 6. Validate content_type if provided
    if let Some(ref ct) = payload.content_type {
        if ct != "application" && ct != "bot" {
            return Err(ApiError::BadRequest("invalid_content_type".to_string()));
        }
    }

    let edit_req = EditRequest {
        room_id: id.clone(),
        message_id: message_id.clone(),
        requester_user_id: auth.user_id.clone(),
        requester_client_id,
        new_ciphertext: ciphertext_bytes,
        content_type: payload.content_type,
    };

    let edit_window = instance_limits.edit_window_seconds;

    let result = match room_messages::edit_message(&state.pool, edit_req, edit_window).await {
        Ok(res) => res,
        Err(RoomMessageError::WindowExpired) => {
            return Err(ApiError::InternalWithDetails(
                StatusCode::FORBIDDEN,
                "edit_window_expired".to_string(),
                json!({ "window_seconds": edit_window }),
            ));
        }
        Err(err) => return Err(ApiError::from(err)),
    };

    // Audit log
    let _ = audit::log(
        &state.pool,
        Some(&auth.user_id),
        audit::action::EDIT_CREATE,
        Some("room_message"),
        Some(&result.id),
        Some(json!({
            "room_id": id,
            "original_id": result.edit_of,
            "edit_sequence": result.edit_sequence,
        })),
    )
    .await;

    // Sockudo publish message.edited
    let is_whisper = result
        .target_user_ids
        .as_ref()
        .is_some_and(|t| !t.is_empty());

    if is_whisper {
        let whisper_targets = result.target_user_ids.as_ref().unwrap();
        let mut recipients: Vec<String> = Vec::new();
        for target_id in whisper_targets {
            if !recipients.contains(target_id) {
                recipients.push(target_id.clone());
            }
        }
        if !recipients.contains(&auth.user_id) {
            recipients.push(auth.user_id.clone());
        }

        let event_payload = json!({
            "id": result.id,
            "edit_of": result.edit_of,
            "edit_sequence": result.edit_sequence,
            "room_id": id,
            "sender_type": "user",
            "sender_id": auth.user_id,
            "target_user_ids": whisper_targets,
            "created_at": result.created_at.to_rfc3339(),
        });

        for recipient_id in recipients {
            let user_channel = format!("private-user-{}", recipient_id);
            if let Err(e) = state
                .publisher
                .publish(&user_channel, "message.edited", event_payload.clone())
                .await
            {
                tracing::warn!(error = %e, channel = %user_channel, "sockudo whisper edit publish failed");
            }
        }
    } else {
        let channel = format!("private-room-{}", id);
        let event_payload = json!({
            "id": result.id,
            "edit_of": result.edit_of,
            "edit_sequence": result.edit_sequence,
            "room_id": id,
            "sender_type": "user",
            "sender_id": auth.user_id,
            "created_at": result.created_at.to_rfc3339(),
        });

        if let Err(e) = state
            .publisher
            .publish(&channel, "message.edited", event_payload)
            .await
        {
            tracing::warn!(error = %e, channel = %channel, "sockudo publish failed");
        }
    }

    let response_body = json!({
        "id": result.id,
        "room_id": result.room_id,
        "sender_type": "user",
        "sender_id": result.sender_user_id,
        "sender_client_id": result.sender_client_id,
        "epoch": result.epoch,
        "seq": result.seq,
        "content_type": result.content_type,
        "ciphertext": ciphertext_b64.trim(),
        "reply_to": result.reply_to,
        "target_user_ids": result.target_user_ids,
        "edit_of": result.edit_of,
        "edit_sequence": result.edit_sequence,
        "bot_key_leaf_index": serde_json::Value::Null,
        "read_by_count": 0,
        "created_at": result.created_at.to_rfc3339(),
        "deleted_at": result.deleted_at,
    });

    Ok((
        StatusCode::CREATED,
        [(header::CACHE_CONTROL, "no-store")],
        Json(response_body),
    ))
}
