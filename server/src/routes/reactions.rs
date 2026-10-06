use axum::{
    extract::{Path, State},
    http::{header, StatusCode},
    response::IntoResponse,
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::{
    audit,
    auth::AuthUser,
    error::ApiError,
    limits,
    rate_limit::{self, RateLimitKey},
    reactions::{
        self,
        list::ReactionSummary,
        write::{AddRequest, RemoveRequest},
        ReactionError,
    },
    AppState,
};

#[derive(Debug, Deserialize)]
pub struct AddReactionInput {
    pub reaction: Option<String>,
    pub sender_client_id: Option<String>,
    pub client_id: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct AddReactionResponse {
    pub id: String,
    pub room_id: String,
    pub message_id: String,
    pub reaction: String,
    pub sender_user_id: String,
    pub created_at: String,
}

#[derive(Debug, Serialize)]
pub struct ListReactionsResponse {
    pub message_id: String,
    pub reactions: Vec<ReactionSummary>,
}

pub async fn add(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((room_id, msg_id)): Path<(String, String)>,
    Json(payload): Json<AddReactionInput>,
) -> Result<impl IntoResponse, ApiError> {
    // Rate limiting
    let decision = rate_limit::check(
        &state.pool,
        &state.config.rate_limits,
        RateLimitKey::Reaction {
            user_id: auth.user_id.clone(),
        },
    )
    .await?;

    if !decision.allowed {
        return Err(ApiError::TooManyRequests {
            message: "rate limit exceeded for reactions".to_string(),
            reset_at: decision.reset_at,
        });
    }

    let reaction_str = payload.reaction.ok_or_else(|| {
        ApiError::InternalWithDetails(
            StatusCode::BAD_REQUEST,
            "missing_field".to_string(),
            json!({ "field": "reaction" }),
        )
    })?;

    let client_id = payload
        .sender_client_id
        .or(payload.client_id)
        .ok_or_else(|| {
            ApiError::InternalWithDetails(
                StatusCode::BAD_REQUEST,
                "missing_field".to_string(),
                json!({ "field": "sender_client_id" }),
            )
        })?;

    let effective_limits = limits::get_limits(&state.pool, &state.server_hard_max).await?;
    let limit = effective_limits.reactions_per_message;

    let add_req = AddRequest {
        room_id: room_id.clone(),
        message_id: msg_id.clone(),
        user_id: auth.user_id.clone(),
        client_id: client_id.clone(),
        reaction: reaction_str.clone(),
    };

    let result = match reactions::write::add_reaction(&state.pool, add_req, limit).await {
        Ok(res) => res,
        Err(ReactionError::InvalidReaction(reason)) => {
            return Err(ApiError::InternalWithDetails(
                StatusCode::BAD_REQUEST,
                "invalid_reaction".to_string(),
                json!({ "reason": reason }),
            ));
        }
        Err(ReactionError::NotAMember) => {
            return Err(ApiError::NotFound("room_not_found".to_string()));
        }
        Err(ReactionError::MessageNotFound) => {
            return Err(ApiError::NotFound("message_not_found".to_string()));
        }
        Err(ReactionError::AlreadyExists) => unreachable!(),
        Err(ReactionError::Forbidden) => return Err(ApiError::Forbidden("forbidden".to_string())),
        Err(ReactionError::LimitReached) => {
            return Err(ApiError::InternalWithDetails(
                StatusCode::CONFLICT,
                "reaction_limit_reached".to_string(),
                json!({ "limit": limit }),
            ));
        }
        Err(ReactionError::Database(e)) => return Err(ApiError::Internal(e.into())),
        Err(ReactionError::NotFound) => unreachable!(),
    };

    // Audit log
    let _ = audit::log(
        &state.pool,
        Some(&auth.user_id),
        audit::action::REACTION_CREATE,
        Some("reaction"),
        Some(&result.id),
        Some(json!({
            "room_id": room_id,
            "message_id": msg_id,
            "reaction": reaction_str,
        })),
    )
    .await;

    // Publish event only if this is a new or reactivated reaction (result.is_new)
    if result.is_new {
        // Phase 10: For whisper messages (target_user_ids non-null on the parent message),
        // reaction events must route to each recipient's private-user-{user_id} channel and
        // to the sender's own channel. The room channel must receive nothing for a whisper.
        // See §8.9 notes.
        let channel = format!("private-room-{}", room_id);
        let event_payload = json!({
            "id": result.id,
            "room_id": room_id,
            "message_id": msg_id,
            "sender_user_id": auth.user_id,
            "reaction": reaction_str,
            "created_at": result.created_at.to_rfc3339(),
        });

        if let Err(e) = state
            .publisher
            .publish(&channel, "reaction.added", event_payload)
            .await
        {
            tracing::warn!(error = %e, channel = %channel, "sockudo publish failed");
        }
    }

    let status_code = if result.is_new {
        StatusCode::CREATED
    } else {
        StatusCode::OK
    };

    let resp = AddReactionResponse {
        id: result.id,
        room_id,
        message_id: msg_id,
        reaction: reaction_str,
        sender_user_id: auth.user_id,
        created_at: result.created_at.to_rfc3339(),
    };

    Ok((
        status_code,
        [(header::CACHE_CONTROL, "no-store")],
        Json(resp),
    ))
}

pub async fn remove(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((room_id, msg_id, reaction_id)): Path<(String, String, String)>,
) -> Result<impl IntoResponse, ApiError> {
    // Note: Per V3 spec, rate limit applies to ADD endpoint only. Delete is not rate-limited.

    let config = crate::config_ops::get_config(&state.pool).await?;

    let remove_req = RemoveRequest {
        room_id: room_id.clone(),
        message_id: msg_id.clone(),
        reaction_id: reaction_id.clone(),
        requester_user_id: auth.user_id.clone(),
    };

    let remove_res =
        match reactions::write::remove_reaction(&state.pool, remove_req, &config.moderation_mode)
            .await
        {
            Ok(res) => res,
            Err(ReactionError::InvalidReaction(reason)) => {
                return Err(ApiError::InternalWithDetails(
                    StatusCode::BAD_REQUEST,
                    "invalid_reaction".to_string(),
                    json!({ "reason": reason }),
                ));
            }
            Err(ReactionError::NotAMember) => {
                return Err(ApiError::NotFound("room_not_found".to_string()));
            }
            Err(ReactionError::NotFound) => {
                return Err(ApiError::NotFound("reaction_not_found".to_string()));
            }
            Err(ReactionError::Forbidden) => {
                return Err(ApiError::Forbidden("forbidden".to_string()));
            }
            Err(ReactionError::Database(e)) => return Err(ApiError::Internal(e.into())),
            Err(ReactionError::MessageNotFound)
            | Err(ReactionError::AlreadyExists)
            | Err(ReactionError::LimitReached) => unreachable!(),
        };

    // Audit log
    let _ = audit::log(
        &state.pool,
        Some(&auth.user_id),
        audit::action::REACTION_DELETE,
        Some("reaction"),
        Some(&remove_res.reaction_id),
        Some(json!({
            "room_id": room_id,
            "message_id": msg_id,
            "reaction": remove_res.reaction,
        })),
    )
    .await;

    // Phase 10: For whisper messages (target_user_ids non-null on the parent message),
    // reaction events must route to each recipient's private-user-{user_id} channel and
    // to the sender's own channel. The room channel must receive nothing for a whisper.
    // See §8.9 notes.
    let channel = format!("private-room-{}", room_id);
    let event_payload = json!({
        "id": remove_res.reaction_id,
        "room_id": room_id,
        "message_id": msg_id,
    });

    if let Err(e) = state
        .publisher
        .publish(&channel, "reaction.removed", event_payload)
        .await
    {
        tracing::warn!(error = %e, channel = %channel, "sockudo publish failed");
    }

    Ok((
        StatusCode::NO_CONTENT,
        [(header::CACHE_CONTROL, "no-store")],
    ))
}

pub async fn list(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((room_id, msg_id)): Path<(String, String)>,
) -> Result<Json<ListReactionsResponse>, ApiError> {
    let summaries = match reactions::list::list_reactions(
        &state.pool,
        &room_id,
        &msg_id,
        &auth.user_id,
    )
    .await
    {
        Ok(s) => s,
        Err(ReactionError::NotAMember) => {
            return Err(ApiError::NotFound("room_not_found".to_string()));
        }
        Err(ReactionError::MessageNotFound) => {
            return Err(ApiError::NotFound("message_not_found".to_string()));
        }
        Err(ReactionError::Database(e)) => return Err(ApiError::Internal(e.into())),
        Err(_) => unreachable!(),
    };

    Ok(Json(ListReactionsResponse {
        message_id: msg_id,
        reactions: summaries,
    }))
}
