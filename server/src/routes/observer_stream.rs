use crate::bots::CallerIdentity;
use crate::error::ApiError;
use crate::error::ErrorResponse;
use crate::events::{ObserverKey, RoomEventEnvelope};
use crate::rate_limit::{self, RateLimitKey};
use crate::routes::bots::resolve_caller;
use crate::AppState;
use axum::{
    extract::{Path, State},
    http::{header, HeaderMap},
    response::{
        sse::{Event, KeepAlive, Sse},
        IntoResponse, Response,
    },
};
use serde_json::json;
use std::convert::Infallible;
use std::time::Duration;
use tokio::sync::broadcast;

/// GET /rooms/:id/observer-stream
#[utoipa::path(
    get,
    path = "/api/v1/rooms/{id}/observer-stream",
    tag = "Bots",
    summary = "Observer metadata SSE stream",
    description = "Server-Sent Events (SSE) stream for observer bots per §8.8.13. Auth: Bot token with read_metadata scope. Emits event types: message.new (with size_bytes), message.edited, message.deleted, room.member_added, room.member_removed, room.updated. Ciphertext and non-metadata events are omitted. Reconnection via Last-Event-ID header; buffer overflow emits 'dropped' event with count.",
    params(
        ("id" = String, Path, description = "Room ID"),
        ("Last-Event-ID" = Option<String>, Header, description = "Last received event ID for stream resumption")
    ),
    responses(
        (status = 200, description = "SSE stream established", content_type = "text/event-stream", body = String),
        (status = 401, description = "Unauthorized (requires bot token)", body = ErrorResponse),
        (status = 403, description = "Forbidden (missing read_metadata scope grant)", body = ErrorResponse),
        (status = 429, description = "Too many requests", body = ErrorResponse),
    ),
    security(
        ("bearer_auth" = [])
    )
)]
pub async fn observer_stream_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(room_id): Path<String>,
) -> Result<Response, ApiError> {
    // 1. Auth check: bot token only
    let caller = resolve_caller(&state.pool, &headers, &state).await?;
    let bot_ctx = match caller {
        CallerIdentity::Bot(b) => b,
        CallerIdentity::User(_) => return Err(ApiError::Unauthorized("unauthorized".into())),
    };

    // 2. Authorization check: active grant in room with read_metadata scope
    let has_grant: bool = sqlx::query_scalar(
        r#"
        SELECT EXISTS(
            SELECT 1 FROM room_bots rb
            JOIN room_bot_scopes rbs ON rbs.room_id = rb.room_id AND rbs.bot_id = rb.bot_id
            WHERE rb.room_id = ? AND rb.bot_id = ? AND rb.revoked_at IS NULL AND rbs.scope = 'read_metadata'
        )
        "#,
    )
    .bind(&room_id)
    .bind(&bot_ctx.bot_id)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| ApiError::Internal(e.into()))?;

    if !has_grant {
        return Err(ApiError::Forbidden("forbidden".into()));
    }

    // 3. Rate limit check
    let decision = rate_limit::check(
        &state.pool,
        &state.config.rate_limits,
        RateLimitKey::BotObserverStream {
            bot_id: bot_ctx.bot_id.clone(),
        },
    )
    .await?;

    if !decision.allowed {
        return Err(ApiError::TooManyRequests {
            message: "rate_limited".into(),
            reset_at: decision.reset_at,
        });
    }

    // 4. Cursor & Last-Event-ID handling
    let last_event_id_hdr = headers
        .get("last-event-id")
        .and_then(|h| h.to_str().ok())
        .and_then(|s| s.parse::<u64>().ok());

    let obs_key = ObserverKey {
        bot_id: bot_ctx.bot_id.clone(),
        room_id: room_id.clone(),
    };

    let ttl_5min = Duration::from_secs(300);

    let mut current_id = match last_event_id_hdr {
        Some(last_id) => last_id + 1,
        None => 1,
    };

    state
        .observer_cursors
        .update(obs_key.clone(), current_id.saturating_sub(1), ttl_5min)
        .await;

    let pool = state.pool.clone();
    let mut rx = state.room_events.subscribe();
    let room_id_filter = room_id.clone();
    let cursors = state.observer_cursors.clone();

    let stream = async_stream::stream! {
        loop {
            match rx.recv().await {
                Ok(envelope) => {
                    if envelope.room_id != room_id_filter {
                        continue;
                    }

                    let projected = project_event(&pool, &envelope).await;
                    if let Some((event_name, payload_val)) = projected {
                        let payload_str = serde_json::to_string(&payload_val).unwrap_or_default();
                        let event = Event::default()
                            .id(current_id.to_string())
                            .event(event_name)
                            .data(payload_str);

                        cursors.update(obs_key.clone(), current_id, ttl_5min).await;
                        current_id += 1;

                        yield Ok::<Event, Infallible>(event);
                    }
                }
                Err(broadcast::error::RecvError::Lagged(count)) => {
                    let payload_val = json!({ "count": count });
                    let payload_str = serde_json::to_string(&payload_val).unwrap_or_default();
                    let event = Event::default()
                        .id(current_id.to_string())
                        .event("dropped")
                        .data(payload_str);

                    cursors.update(obs_key.clone(), current_id, ttl_5min).await;
                    current_id += 1;

                    yield Ok::<Event, Infallible>(event);
                }
                Err(broadcast::error::RecvError::Closed) => {
                    break;
                }
            }
        }
    };

    let sse = Sse::new(stream).keep_alive(
        KeepAlive::new()
            .interval(Duration::from_secs(30))
            .text(":keepalive"),
    );

    let mut response = sse.into_response();
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        header::HeaderValue::from_static("no-store"),
    );
    response.headers_mut().insert(
        header::HeaderName::from_static("x-accel-buffering"),
        header::HeaderValue::from_static("no"),
    );

    Ok(response)
}

async fn project_event(
    pool: &sqlx::SqlitePool,
    envelope: &RoomEventEnvelope,
) -> Option<(&'static str, serde_json::Value)> {
    match envelope.event.as_str() {
        "message.new" => {
            let msg_id = envelope.data.get("id")?.as_str()?;
            let size_bytes: i64 =
                sqlx::query_scalar("SELECT LENGTH(ciphertext) FROM room_messages WHERE id = ?")
                    .bind(msg_id)
                    .fetch_optional(pool)
                    .await
                    .ok()
                    .flatten()
                    .unwrap_or(0);

            let sender_user_id = envelope
                .data
                .get("sender_id")
                .or_else(|| envelope.data.get("sender_user_id"))
                .and_then(|v| v.as_str())
                .unwrap_or_default();

            let sender_client_id = envelope
                .data
                .get("sender_client_id")
                .and_then(|v| v.as_str())
                .unwrap_or_default();

            let created_at = envelope
                .data
                .get("created_at")
                .and_then(|v| v.as_str())
                .unwrap_or_default();

            Some((
                "message.new",
                json!({
                    "id": msg_id,
                    "sender_user_id": sender_user_id,
                    "sender_client_id": sender_client_id,
                    "created_at": created_at,
                    "size_bytes": size_bytes
                }),
            ))
        }
        "message.edited" => {
            let msg_id = envelope.data.get("id")?.as_str()?;
            let edit_of = envelope.data.get("edit_of")?.as_str()?;
            let editor_user_id = envelope
                .data
                .get("sender_id")
                .or_else(|| envelope.data.get("editor_user_id"))
                .and_then(|v| v.as_str())
                .unwrap_or_default();

            let edited_at = envelope
                .data
                .get("created_at")
                .or_else(|| envelope.data.get("edited_at"))
                .and_then(|v| v.as_str())
                .unwrap_or_default();

            Some((
                "message.edited",
                json!({
                    "id": msg_id,
                    "edit_of": edit_of,
                    "editor_user_id": editor_user_id,
                    "edited_at": edited_at
                }),
            ))
        }
        "message.deleted" => {
            let msg_id = envelope.data.get("id")?.as_str()?;
            Some((
                "message.deleted",
                json!({
                    "id": msg_id
                }),
            ))
        }
        "room.member_added" => Some(("room.member_added", envelope.data.clone())),
        "room.member_removed" => Some(("room.member_removed", envelope.data.clone())),
        "room.updated" => {
            let room_id = envelope.data.get("room_id")?.as_str()?;
            let mut obj = serde_json::Map::new();
            obj.insert("room_id".to_string(), json!(room_id));

            if let Some(v) = envelope.data.get("retention_days") {
                if !v.is_null() {
                    obj.insert("retention_days".to_string(), v.clone());
                }
            }
            if let Some(v) = envelope.data.get("max_file_size_bytes") {
                if !v.is_null() {
                    obj.insert("max_file_size_bytes".to_string(), v.clone());
                }
            }
            if let Some(v) = envelope.data.get("metadata_version") {
                if !v.is_null() {
                    obj.insert("metadata_version".to_string(), v.clone());
                }
            }

            Some(("room.updated", serde_json::Value::Object(obj)))
        }
        _ => None,
    }
}
