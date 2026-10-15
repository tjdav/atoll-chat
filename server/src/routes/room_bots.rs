use crate::auth::AuthUser;
use crate::bots::CallerIdentity;
use crate::bots::{derive_mode, validate_dependencies, Mode};
use crate::error::ApiError;
use crate::rate_limit::{self, RateLimitKey};
use crate::rooms::{
    queue_pending_mls_add_batch, queue_pending_mls_remove_batch, select_bot_key_packages, MlsTarget,
};
use crate::sockudo::Publisher;
use crate::AppState;
use axum::{
    extract::{Path, State},
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::{Row, SqlitePool};
use ulid::Ulid;
use utoipa::ToSchema;

use crate::error::ErrorResponse;

async fn check_room_grant_auth(
    pool: &SqlitePool,
    room_id: &str,
    user_id: &str,
) -> Result<(), ApiError> {
    // Check room exists
    let room_row = sqlx::query("SELECT owner_id, moderation_override FROM rooms WHERE id = ?")
        .bind(room_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| ApiError::Internal(e.into()))?;

    let room_row = match room_row {
        Some(r) => r,
        None => return Err(ApiError::NotFound("room_not_found".into())),
    };

    let owner_id: String = room_row.get("owner_id");
    let moderation_override: Option<String> = room_row.get("moderation_override");
    let effective_mode = moderation_override.as_deref().unwrap_or("messenger");

    // Check caller member role
    let member_role: Option<String> =
        sqlx::query_scalar("SELECT role FROM room_members WHERE room_id = ? AND user_id = ?")
            .bind(room_id)
            .bind(user_id)
            .fetch_optional(pool)
            .await
            .map_err(|e| ApiError::Internal(e.into()))?;

    let role = match member_role {
        Some(r) => r,
        None => return Err(ApiError::NotFound("room_not_found".into())),
    };

    if user_id == owner_id || role == "owner" {
        return Ok(());
    }

    if role == "moderator" && effective_mode == "discord" {
        return Ok(());
    }

    Err(ApiError::Forbidden("forbidden".into()))
}

#[derive(Serialize, ToSchema)]
pub struct RoomBotView {
    pub bot_id: String,
    pub display_name: String,
    pub avatar_file_id: Option<String>,
    pub mode: String,
    pub scopes: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub connected: Option<bool>,
    pub granted_at: String,
    pub granted_by: String,
}

#[derive(Serialize, ToSchema)]
pub struct ListRoomBotsResp {
    pub bots: Vec<RoomBotView>,
}

/// GET /rooms/:id/bots
#[utoipa::path(
    get,
    path = "/api/v1/rooms/{id}/bots",
    tag = "Bots",
    summary = "List room bots",
    description = "List bots granted to a room per §8.8.6. Auth: Room members. Note: connected status is included ONLY if caller is the bot's owner.",
    params(
        ("id" = String, Path, description = "Room ID")
    ),
    responses(
        (status = 200, description = "List of room bots", body = ListRoomBotsResp),
        (status = 401, description = "Unauthorized", body = ErrorResponse),
        (status = 404, description = "Room not found", body = ErrorResponse),
    ),
    security(
        ("bearer_auth" = [])
    )
)]
pub async fn list_room_bots(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(room_id): Path<String>,
) -> Result<Response, ApiError> {
    // Verify room member
    let is_member: Option<i64> =
        sqlx::query_scalar("SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?")
            .bind(&room_id)
            .bind(&auth_user.user_id)
            .fetch_optional(&state.pool)
            .await
            .map_err(|e| ApiError::Internal(e.into()))?;

    if is_member.is_none() {
        return Err(ApiError::NotFound("room_not_found".into()));
    }

    let rows = sqlx::query(
        r#"
        SELECT rb.bot_id, ba.display_name, ba.avatar_file_id, rb.mode, rb.granted_by, CAST(rb.granted_at AS TEXT) AS granted_at, ba.owner_user_id
        FROM room_bots rb
        JOIN bot_accounts ba ON ba.id = rb.bot_id
        WHERE rb.room_id = ? AND rb.revoked_at IS NULL AND ba.deleted_at IS NULL AND ba.disabled_at IS NULL
        ORDER BY rb.granted_at ASC, rb.bot_id ASC
        "#,
    )
    .bind(&room_id)
    .fetch_all(&state.pool)
    .await
    .map_err(|e| ApiError::Internal(e.into()))?;

    let mut bot_views = Vec::with_capacity(rows.len());

    for row in rows {
        let bot_id: String = row.get("bot_id");
        let display_name: String = row.get("display_name");
        let avatar_file_id: Option<String> = row.get("avatar_file_id");
        let mode: String = row.get("mode");
        let granted_by: String = row.get("granted_by");
        let granted_at: String = row.get("granted_at");
        let owner_user_id: String = row.get("owner_user_id");

        let scopes: Vec<String> = sqlx::query_scalar(
            "SELECT scope FROM room_bot_scopes WHERE room_id = ? AND bot_id = ? ORDER BY scope ASC",
        )
        .bind(&room_id)
        .bind(&bot_id)
        .fetch_all(&state.pool)
        .await
        .map_err(|e| ApiError::Internal(e.into()))?;

        let connected = if auth_user.user_id == owner_user_id {
            Some(state.bot_connection_state.is_connected(&bot_id).await)
        } else {
            None
        };

        bot_views.push(RoomBotView {
            bot_id,
            display_name,
            avatar_file_id,
            mode,
            scopes,
            connected,
            granted_at,
            granted_by,
        });
    }

    let resp = ListRoomBotsResp { bots: bot_views };
    let mut response = (StatusCode::OK, Json(resp)).into_response();
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        header::HeaderValue::from_static("no-store"),
    );
    Ok(response)
}

#[derive(Deserialize, ToSchema)]
pub struct GrantBotReq {
    pub bot_id: String,
    pub scopes: Vec<String>,
    pub operators: Option<Vec<String>>,
}

/// POST /rooms/:id/bots
#[utoipa::path(
    post,
    path = "/api/v1/rooms/{id}/bots",
    tag = "Bots",
    summary = "Grant bot to room",
    description = "Grant a bot to a room per §8.8.7. Auth: Room owner / moderator. The room bot mode (write_only, observer, member) is derived automatically from the granted scope set per §7.10.",
    params(
        ("id" = String, Path, description = "Room ID")
    ),
    request_body = GrantBotReq,
    responses(
        (status = 201, description = "Bot granted to room", body = RoomBotView),
        (status = 400, description = "Invalid scope or missing scope dependency", body = ErrorResponse),
        (status = 401, description = "Unauthorized", body = ErrorResponse),
        (status = 403, description = "Forbidden", body = ErrorResponse),
        (status = 409, description = "Bot already granted or room bot limit reached", body = ErrorResponse),
        (status = 429, description = "Too many requests", body = ErrorResponse),
    ),
    security(
        ("bearer_auth" = [])
    )
)]
pub async fn grant_bot(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(room_id): Path<String>,
    Json(req): Json<GrantBotReq>,
) -> Result<Response, ApiError> {
    check_room_grant_auth(&state.pool, &room_id, &auth_user.user_id).await?;

    let decision = rate_limit::check(
        &state.pool,
        &state.config.rate_limits,
        RateLimitKey::BotGrant {
            user_id: auth_user.user_id.clone(),
        },
    )
    .await?;

    if !decision.allowed {
        return Err(ApiError::TooManyRequests {
            message: "rate_limited".into(),
            reset_at: decision.reset_at,
        });
    }

    if req.scopes.is_empty() {
        return Err(ApiError::BadRequest("scopes_empty".into()));
    }

    if validate_dependencies(&req.scopes).is_err() {
        return Err(ApiError::BadRequest("scope_dependency_missing".into()));
    }

    // Verify bot exists and is active
    let bot_row = sqlx::query("SELECT display_name, avatar_file_id FROM bot_accounts WHERE id = ? AND deleted_at IS NULL AND disabled_at IS NULL")
        .bind(&req.bot_id)
        .fetch_optional(&state.pool)
        .await
        .map_err(|e| ApiError::Internal(e.into()))?;

    let bot_row = match bot_row {
        Some(r) => r,
        None => return Err(ApiError::NotFound("bot_not_found".into())),
    };

    let display_name: String = bot_row.get("display_name");
    let avatar_file_id: Option<String> = bot_row.get("avatar_file_id");

    // Check existing grant
    let existing: Option<i64> = sqlx::query_scalar(
        "SELECT 1 FROM room_bots WHERE room_id = ? AND bot_id = ? AND revoked_at IS NULL",
    )
    .bind(&room_id)
    .bind(&req.bot_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| ApiError::Internal(e.into()))?;

    if existing.is_some() {
        return Err(ApiError::Conflict("bot_already_granted".into()));
    }

    // Check declared scopes
    let declared_scopes: Vec<String> =
        sqlx::query_scalar("SELECT scope FROM bot_declared_scopes WHERE bot_id = ?")
            .bind(&req.bot_id)
            .fetch_all(&state.pool)
            .await
            .map_err(|e| ApiError::Internal(e.into()))?;

    for s in &req.scopes {
        if !declared_scopes.contains(s) {
            return Err(ApiError::BadRequest("scope_not_declared".into()));
        }
    }

    // Check bots_per_room limit (default 10)
    let active_bot_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM room_bots WHERE room_id = ? AND revoked_at IS NULL",
    )
    .bind(&room_id)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| ApiError::Internal(e.into()))?;

    if active_bot_count >= 10 {
        return Err(ApiError::Conflict("bot_limit_reached".into()));
    }

    // Validate operator room membership if operators provided
    if let Some(ref ops) = req.operators {
        for op_user_id in ops {
            let is_member: Option<i64> =
                sqlx::query_scalar("SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?")
                    .bind(&room_id)
                    .bind(op_user_id)
                    .fetch_optional(&state.pool)
                    .await
                    .map_err(|e| ApiError::Internal(e.into()))?;

            if is_member.is_none() {
                return Err(ApiError::BadRequest("invalid_operator".into()));
            }
        }
    }

    let derived_mode = derive_mode(&req.scopes);

    let mut tx = state
        .pool
        .begin()
        .await
        .map_err(|e| ApiError::Internal(e.into()))?;

    let granted_at: String = sqlx::query_scalar(
        r#"
        INSERT INTO room_bots (room_id, bot_id, mode, granted_by)
        VALUES (?, ?, ?, ?)
        RETURNING CAST(granted_at AS TEXT)
        "#,
    )
    .bind(&room_id)
    .bind(&req.bot_id)
    .bind(derived_mode.as_str())
    .bind(&auth_user.user_id)
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| ApiError::Internal(e.into()))?;

    for s in &req.scopes {
        sqlx::query("INSERT INTO room_bot_scopes (room_id, bot_id, scope) VALUES (?, ?, ?)")
            .bind(&room_id)
            .bind(&req.bot_id)
            .bind(s)
            .execute(&mut *tx)
            .await
            .map_err(|e| ApiError::Internal(e.into()))?;
    }

    let mut added_operators = Vec::new();
    if let Some(ref ops) = req.operators {
        for op_user_id in ops {
            let res = sqlx::query(
                "INSERT INTO bot_operators (bot_id, user_id, bound_at, bound_by, binding) VALUES (?, ?, CURRENT_TIMESTAMP, ?, 'room-member') ON CONFLICT(bot_id, user_id) DO NOTHING",
            )
            .bind(&req.bot_id)
            .bind(op_user_id)
            .bind(&auth_user.user_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| ApiError::Internal(e.into()))?;

            if res.rows_affected() > 0 {
                added_operators.push(op_user_id.clone());
            }
        }
    }

    let queued_client_ids = if derived_mode == Mode::Member {
        let key_pkg_selections = select_bot_key_packages(&mut tx, &req.bot_id)
            .await
            .map_err(|e| ApiError::Internal(e.into()))?;

        let queued_adds = queue_pending_mls_add_batch(
            &mut tx,
            &room_id,
            MlsTarget::Bot(&req.bot_id),
            &key_pkg_selections,
        )
        .await
        .map_err(|e| ApiError::Internal(e.into()))?;

        queued_adds
            .into_iter()
            .map(|a| a.target_client_id)
            .collect()
    } else {
        Vec::new()
    };

    tx.commit()
        .await
        .map_err(|e| ApiError::Internal(e.into()))?;

    for op_user_id in added_operators {
        let _ = crate::audit::log(
            &state.pool,
            Some(&auth_user.user_id),
            crate::audit::action::BOT_OPERATOR_BOUND,
            Some("bot"),
            Some(&req.bot_id),
            Some(json!({
                "bot_id": req.bot_id,
                "user_id": op_user_id,
                "binding": "room-member",
                "room_id": room_id
            })),
        )
        .await;
    }

    // Event publishing
    let bot_added_event = json!({
        "room_id": room_id,
        "bot_id": req.bot_id,
        "mode": derived_mode.as_str(),
        "scopes": req.scopes,
        "granted_by": auth_user.user_id
    });
    let _ = Publisher::publish(
        &state.publisher,
        &format!("private-room-{}", room_id),
        "bot.added",
        bot_added_event,
    )
    .await;

    if derived_mode == Mode::Member {
        let mls_add_event = json!({
            "room_id": room_id,
            "target_user_id": serde_json::Value::Null,
            "target_bot_id": req.bot_id,
            "client_ids": queued_client_ids
        });
        let _ = Publisher::publish(
            &state.publisher,
            &format!("private-room-{}", room_id),
            "mls.add_pending",
            mls_add_event,
        )
        .await;
    }

    let view = RoomBotView {
        bot_id: req.bot_id,
        display_name,
        avatar_file_id,
        mode: derived_mode.as_str().to_string(),
        scopes: req.scopes,
        connected: None,
        granted_at,
        granted_by: auth_user.user_id,
    };

    let mut response = (StatusCode::CREATED, Json(view)).into_response();
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        header::HeaderValue::from_static("no-store"),
    );
    Ok(response)
}

#[derive(Deserialize, ToSchema)]
pub struct PatchRoomBotReq {
    pub scopes: Vec<String>,
}

/// PATCH /rooms/:id/bots/:bot_id
#[utoipa::path(
    patch,
    path = "/api/v1/rooms/{id}/bots/{bot_id}",
    tag = "Bots",
    summary = "Update room bot scopes",
    description = "Update granted scopes for a bot in a room per §8.8.8. Auth: Room owner / moderator. Mode is re-derived automatically from the new scope set per §7.10.",
    params(
        ("id" = String, Path, description = "Room ID"),
        ("bot_id" = String, Path, description = "Bot ID")
    ),
    request_body = PatchRoomBotReq,
    responses(
        (status = 200, description = "Room bot scopes updated", body = RoomBotView),
        (status = 400, description = "Invalid scopes or dependency missing", body = ErrorResponse),
        (status = 401, description = "Unauthorized", body = ErrorResponse),
        (status = 403, description = "Forbidden", body = ErrorResponse),
        (status = 404, description = "Bot grant not found", body = ErrorResponse),
    ),
    security(
        ("bearer_auth" = [])
    )
)]
pub async fn patch_room_bot(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path((room_id, bot_id)): Path<(String, String)>,
    Json(req): Json<PatchRoomBotReq>,
) -> Result<Response, ApiError> {
    check_room_grant_auth(&state.pool, &room_id, &auth_user.user_id).await?;

    if req.scopes.is_empty() {
        return Err(ApiError::BadRequest("scopes_empty".into()));
    }

    if validate_dependencies(&req.scopes).is_err() {
        return Err(ApiError::BadRequest("scope_dependency_missing".into()));
    }

    let grant_row = sqlx::query(
        "SELECT rb.mode, rb.granted_by, CAST(rb.granted_at AS TEXT) AS granted_at, ba.display_name, ba.avatar_file_id FROM room_bots rb JOIN bot_accounts ba ON ba.id = rb.bot_id WHERE rb.room_id = ? AND rb.bot_id = ? AND rb.revoked_at IS NULL AND ba.deleted_at IS NULL AND ba.disabled_at IS NULL",
    )
    .bind(&room_id)
    .bind(&bot_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| ApiError::Internal(e.into()))?;

    let grant_row = match grant_row {
        Some(r) => r,
        None => return Err(ApiError::NotFound("bot_grant_not_found".into())),
    };

    let old_mode_str: String = grant_row.get("mode");
    let granted_by: String = grant_row.get("granted_by");
    let granted_at: String = grant_row.get("granted_at");
    let display_name: String = grant_row.get("display_name");
    let avatar_file_id: Option<String> = grant_row.get("avatar_file_id");

    // Check declared scopes
    let declared_scopes: Vec<String> =
        sqlx::query_scalar("SELECT scope FROM bot_declared_scopes WHERE bot_id = ?")
            .bind(&bot_id)
            .fetch_all(&state.pool)
            .await
            .map_err(|e| ApiError::Internal(e.into()))?;

    for s in &req.scopes {
        if !declared_scopes.contains(s) {
            return Err(ApiError::BadRequest("scope_not_declared".into()));
        }
    }

    let new_mode = derive_mode(&req.scopes);
    let is_trans_to_member = old_mode_str != "member" && new_mode == Mode::Member;
    let is_trans_away_member = old_mode_str == "member" && new_mode != Mode::Member;

    let mut tx = state
        .pool
        .begin()
        .await
        .map_err(|e| ApiError::Internal(e.into()))?;

    sqlx::query(
        "UPDATE room_bots SET mode = ? WHERE room_id = ? AND bot_id = ? AND revoked_at IS NULL",
    )
    .bind(new_mode.as_str())
    .bind(&room_id)
    .bind(&bot_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| ApiError::Internal(e.into()))?;

    sqlx::query("DELETE FROM room_bot_scopes WHERE room_id = ? AND bot_id = ?")
        .bind(&room_id)
        .bind(&bot_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| ApiError::Internal(e.into()))?;

    for s in &req.scopes {
        sqlx::query("INSERT INTO room_bot_scopes (room_id, bot_id, scope) VALUES (?, ?, ?)")
            .bind(&room_id)
            .bind(&bot_id)
            .bind(s)
            .execute(&mut *tx)
            .await
            .map_err(|e| ApiError::Internal(e.into()))?;
    }

    let queued_client_ids = if is_trans_to_member {
        let key_pkg_selections = select_bot_key_packages(&mut tx, &bot_id)
            .await
            .map_err(|e| ApiError::Internal(e.into()))?;

        let queued_adds = queue_pending_mls_add_batch(
            &mut tx,
            &room_id,
            MlsTarget::Bot(&bot_id),
            &key_pkg_selections,
        )
        .await
        .map_err(|e| ApiError::Internal(e.into()))?;

        queued_adds
            .into_iter()
            .map(|a| a.target_client_id)
            .collect()
    } else {
        Vec::new()
    };

    if is_trans_away_member {
        queue_pending_mls_remove_batch(&mut tx, &room_id, MlsTarget::Bot(&bot_id))
            .await
            .map_err(|e| ApiError::Internal(e.into()))?;
    }

    tx.commit()
        .await
        .map_err(|e| ApiError::Internal(e.into()))?;

    // Event publishing
    let bot_grant_updated_event = json!({
        "bot_id": bot_id,
        "room_id": room_id,
        "old_mode": old_mode_str,
        "new_mode": new_mode.as_str(),
        "scopes": req.scopes,
        "changed": ["scopes", "mode"]
    });
    let _ = Publisher::publish(
        &state.publisher,
        &format!("private-bot-{}", bot_id),
        "bot.grant_updated",
        bot_grant_updated_event,
    )
    .await;

    let room_bot_updated_event = json!({
        "room_id": room_id,
        "bot_id": bot_id,
        "scopes": req.scopes,
        "avatar_file_id": avatar_file_id,
        "changed": ["scopes", "mode"]
    });
    let _ = Publisher::publish(
        &state.publisher,
        &format!("private-room-{}", room_id),
        "bot.updated",
        room_bot_updated_event,
    )
    .await;

    if is_trans_to_member {
        let mls_add_event = json!({
            "room_id": room_id,
            "target_user_id": serde_json::Value::Null,
            "target_bot_id": bot_id,
            "client_ids": queued_client_ids
        });
        let _ = Publisher::publish(
            &state.publisher,
            &format!("private-room-{}", room_id),
            "mls.add_pending",
            mls_add_event,
        )
        .await;
    }

    let view = RoomBotView {
        bot_id,
        display_name,
        avatar_file_id,
        mode: new_mode.as_str().to_string(),
        scopes: req.scopes,
        connected: None,
        granted_at,
        granted_by,
    };

    let mut response = (StatusCode::OK, Json(view)).into_response();
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        header::HeaderValue::from_static("no-store"),
    );
    Ok(response)
}

/// DELETE /rooms/:id/bots/:bot_id
#[utoipa::path(
    delete,
    path = "/api/v1/rooms/{id}/bots/{bot_id}",
    tag = "Bots",
    summary = "Revoke room bot grant",
    description = "Revoke a bot grant from a room per §8.8.9. Auth: Room owner / moderator.",
    params(
        ("id" = String, Path, description = "Room ID"),
        ("bot_id" = String, Path, description = "Bot ID")
    ),
    responses(
        (status = 204, description = "Bot grant revoked"),
        (status = 401, description = "Unauthorized", body = ErrorResponse),
        (status = 403, description = "Forbidden", body = ErrorResponse),
        (status = 404, description = "Bot grant not found", body = ErrorResponse),
    ),
    security(
        ("bearer_auth" = [])
    )
)]
pub async fn delete_room_bot(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path((room_id, bot_id)): Path<(String, String)>,
) -> Result<Response, ApiError> {
    check_room_grant_auth(&state.pool, &room_id, &auth_user.user_id).await?;

    let grant_row = sqlx::query(
        "SELECT mode, granted_by FROM room_bots WHERE room_id = ? AND bot_id = ? AND revoked_at IS NULL",
    )
    .bind(&room_id)
    .bind(&bot_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| ApiError::Internal(e.into()))?;

    let grant_row = match grant_row {
        Some(r) => r,
        None => return Err(ApiError::NotFound("bot_grant_not_found".into())),
    };

    let mode_str: String = grant_row.get("mode");
    let granter_user_id: String = grant_row.get("granted_by");

    let mut tx = state
        .pool
        .begin()
        .await
        .map_err(|e| ApiError::Internal(e.into()))?;

    sqlx::query("UPDATE room_bots SET revoked_at = CURRENT_TIMESTAMP WHERE room_id = ? AND bot_id = ? AND revoked_at IS NULL")
        .bind(&room_id)
        .bind(&bot_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| ApiError::Internal(e.into()))?;

    let removed_operators: Vec<String> = sqlx::query_scalar(
        "SELECT user_id FROM bot_operators WHERE bot_id = ? AND binding = 'room-member' AND bound_by = ?",
    )
    .bind(&bot_id)
    .bind(&granter_user_id)
    .fetch_all(&mut *tx)
    .await
    .map_err(|e| ApiError::Internal(e.into()))?;

    sqlx::query(
        "DELETE FROM bot_operators WHERE bot_id = ? AND binding = 'room-member' AND bound_by = ?",
    )
    .bind(&bot_id)
    .bind(&granter_user_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| ApiError::Internal(e.into()))?;

    if mode_str == "member" {
        queue_pending_mls_remove_batch(&mut tx, &room_id, MlsTarget::Bot(&bot_id))
            .await
            .map_err(|e| ApiError::Internal(e.into()))?;
    }

    tx.commit()
        .await
        .map_err(|e| ApiError::Internal(e.into()))?;

    for op_user_id in removed_operators {
        let _ = crate::audit::log(
            &state.pool,
            Some(&auth_user.user_id),
            crate::audit::action::BOT_OPERATOR_UNBOUND,
            Some("bot"),
            Some(&bot_id),
            Some(json!({
                "bot_id": bot_id,
                "user_id": op_user_id,
                "binding": "room-member",
                "room_id": room_id
            })),
        )
        .await;
    }

    let event_payload = json!({
        "room_id": room_id,
        "bot_id": bot_id
    });

    let _ = Publisher::publish(
        &state.publisher,
        &format!("private-room-{}", room_id),
        "bot.revoked",
        event_payload,
    )
    .await;

    Ok(StatusCode::NO_CONTENT.into_response())
}

#[derive(Deserialize, ToSchema)]
pub struct PostBotCommandReq {
    pub bot_id: String,
    /// Command plaintext encrypted via X25519 ECDH to bot_command_pubkey, base64url encoded. Reference: §6.31.
    #[schema(value_type = String, format = Binary)]
    pub ciphertext: String,
    /// Client's ephemeral X25519 public key for command result decryption, base64url encoded. Reference: §6.31.
    #[schema(value_type = Option<String>, format = Binary)]
    pub ephemeral_result_pubkey: Option<String>,
    pub request_id: Option<String>,
}

#[derive(Serialize, ToSchema)]
pub struct PostBotCommandResp {
    pub command_id: String,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub idempotent: Option<bool>,
}

/// POST /rooms/:id/bot-commands
#[utoipa::path(
    post,
    path = "/api/v1/rooms/{id}/bot-commands",
    tag = "Bots",
    summary = "Send command to bot",
    description = "User sends an encrypted command to a bot in a room per §8.8.11. Auth: Room member session token. Supports request_id idempotency.",
    params(
        ("id" = String, Path, description = "Room ID")
    ),
    request_body = PostBotCommandReq,
    responses(
        (status = 202, description = "Command accepted for delivery", body = PostBotCommandResp),
        (status = 400, description = "Invalid ciphertext, pubkey, or request_id", body = ErrorResponse),
        (status = 401, description = "Unauthorized", body = ErrorResponse),
        (status = 403, description = "Forbidden or bot not granted read_commands scope", body = ErrorResponse),
        (status = 404, description = "Room not found", body = ErrorResponse),
        (status = 409, description = "Request ID conflict across endpoints", body = ErrorResponse),
        (status = 429, description = "Too many requests", body = ErrorResponse),
    ),
    security(
        ("bearer_auth" = [])
    )
)]
pub async fn post_bot_command(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(room_id): Path<String>,
    Json(req): Json<PostBotCommandReq>,
) -> Result<Response, ApiError> {
    let caller = crate::routes::bots::resolve_caller(&state.pool, &headers, &state).await?;
    let auth_user = match caller {
        CallerIdentity::User(u) => u,
        CallerIdentity::Bot(_) => return Err(ApiError::Forbidden("forbidden".into())),
    };

    // 1. Verify caller is a member of room_id
    let is_member: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?)",
    )
    .bind(&room_id)
    .bind(&auth_user.user_id)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| ApiError::Internal(e.into()))?;

    if !is_member {
        return Err(ApiError::NotFound("room_not_found".into()));
    }

    // 2. Verify bot_id is non-empty and has an active grant in room_id with read_commands scope
    let bot_id = req.bot_id.trim();
    if bot_id.is_empty() {
        return Err(ApiError::BadRequest("invalid_bot_id".into()));
    }

    let has_grant: bool = sqlx::query_scalar(
        r#"
        SELECT EXISTS(
            SELECT 1 FROM room_bots rb
            JOIN room_bot_scopes rbs ON rbs.room_id = rb.room_id AND rbs.bot_id = rb.bot_id
            WHERE rb.room_id = ? AND rb.bot_id = ? AND rb.revoked_at IS NULL AND rbs.scope = 'read_commands'
        )
        "#,
    )
    .bind(&room_id)
    .bind(bot_id)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| ApiError::Internal(e.into()))?;

    if !has_grant {
        return Err(ApiError::Forbidden("bot_not_granted".into()));
    }

    // 3. Validate ephemeral_result_pubkey (unpadded base64url, exactly 32 bytes)
    let erpk_trimmed = match req.ephemeral_result_pubkey.as_deref() {
        Some(s) if !s.trim().is_empty() => s.trim(),
        _ => {
            return Err(ApiError::BadRequest(
                "invalid_ephemeral_result_pubkey".into(),
            ))
        }
    };

    let decoded_erpk = match URL_SAFE_NO_PAD.decode(erpk_trimmed) {
        Ok(bytes) => bytes,
        Err(_) => {
            return Err(ApiError::BadRequest(
                "invalid_ephemeral_result_pubkey".into(),
            ))
        }
    };

    if decoded_erpk.len() != 32 {
        return Err(ApiError::BadRequest(
            "invalid_ephemeral_result_pubkey".into(),
        ));
    }

    // 4. Validate ciphertext
    let ciphertext_trimmed = req.ciphertext.trim();
    if ciphertext_trimmed.is_empty() {
        return Err(ApiError::BadRequest("invalid_ciphertext".into()));
    }

    let decoded_ciphertext = match URL_SAFE_NO_PAD.decode(ciphertext_trimmed) {
        Ok(bytes) => bytes,
        Err(_) => return Err(ApiError::BadRequest("invalid_ciphertext".into())),
    };

    if decoded_ciphertext.is_empty() {
        return Err(ApiError::BadRequest("invalid_ciphertext".into()));
    }

    if decoded_ciphertext.len() > 65536 {
        return Err(ApiError::InternalCustom(
            StatusCode::PAYLOAD_TOO_LARGE,
            "ciphertext_too_large".into(),
        ));
    }

    // 5. Validate request_id if present
    let request_id_trimmed = match req.request_id.as_deref() {
        Some(s) => {
            let trimmed = s.trim();
            if !crate::bots::validate_request_id(trimmed) {
                return Err(ApiError::BadRequest("invalid_request_id".into()));
            }
            Some(trimmed)
        }
        None => None,
    };

    // 5. Check rate limit per (bot_id, sender_user_id)
    let decision = rate_limit::check(
        &state.pool,
        &state.config.rate_limits,
        RateLimitKey::BotCommand {
            bot_id: bot_id.to_string(),
            user_id: auth_user.user_id.clone(),
        },
    )
    .await?;

    if !decision.allowed {
        return Err(ApiError::TooManyRequests {
            message: "rate_limited".into(),
            reset_at: decision.reset_at,
        });
    }

    // 6. Resolve sender_client_id
    let sender_client_id = match auth_user.device_id.as_deref() {
        Some(dev_id) => {
            let cid: Option<String> =
                sqlx::query_scalar("SELECT client_id FROM devices WHERE id = ?")
                    .bind(dev_id)
                    .fetch_optional(&state.pool)
                    .await
                    .map_err(|e| ApiError::Internal(e.into()))?;
            cid
        }
        None => None,
    };

    let sender_client_id = match sender_client_id {
        Some(cid) => cid,
        None => {
            let cid: Option<String> = sqlx::query_scalar(
                "SELECT client_id FROM devices WHERE user_id = ? ORDER BY created_at DESC LIMIT 1",
            )
            .bind(&auth_user.user_id)
            .fetch_optional(&state.pool)
            .await
            .map_err(|e| ApiError::Internal(e.into()))?;
            cid.unwrap_or_else(|| "unknown".to_string())
        }
    };

    // Begin transaction for idempotency check and command insertion
    let mut tx = state
        .pool
        .begin()
        .await
        .map_err(|e| ApiError::Internal(e.into()))?;

    if let Some(req_id) = request_id_trimmed {
        let outcome = crate::bots::check_or_reserve_request_id(
            &mut tx,
            bot_id,
            req_id,
            crate::bots::ENDPOINT_BOT_COMMANDS,
        )
        .await
        .map_err(|e| ApiError::Internal(e.into()))?;

        match outcome {
            crate::bots::IdempotencyOutcome::Duplicate { response_code } => {
                let _ = tx.rollback().await;
                let resp = json!({
                    "command_id": "idempotent",
                    "created_at": chrono::Utc::now().to_rfc3339(),
                    "request_id": req_id,
                    "idempotent": true,
                });
                let status = StatusCode::from_u16(response_code).unwrap_or(StatusCode::ACCEPTED);
                let mut response = (status, Json(resp)).into_response();
                response.headers_mut().insert(
                    header::CACHE_CONTROL,
                    header::HeaderValue::from_static("no-store"),
                );
                return Ok(response);
            }
            crate::bots::IdempotencyOutcome::Conflict => {
                let _ = tx.rollback().await;
                return Err(ApiError::Conflict("request_id_conflict".into()));
            }
            crate::bots::IdempotencyOutcome::Reserved => {}
        }
    }

    // 7. Store in bot_commands
    let command_id = format!("cmd_{}", Ulid::new());
    let created_at: String = sqlx::query_scalar(
        r#"
        INSERT INTO bot_commands (id, bot_id, room_id, sender_user_id, sender_client_id, ciphertext, ephemeral_result_pubkey)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        RETURNING CAST(created_at AS TEXT)
        "#,
    )
    .bind(&command_id)
    .bind(bot_id)
    .bind(&room_id)
    .bind(&auth_user.user_id)
    .bind(&sender_client_id)
    .bind(&decoded_ciphertext)
    .bind(&decoded_erpk)
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| ApiError::Internal(e.into()))?;

    if let Some(req_id) = request_id_trimmed {
        crate::bots::record_response_code(&mut tx, bot_id, req_id, 202)
            .await
            .map_err(|e| ApiError::Internal(e.into()))?;
    }

    let raw_event_payload = json!({
        "command_id": command_id,
        "room_id": room_id,
        "sender_user_id": auth_user.user_id,
        "sender_client_id": sender_client_id,
        "ciphertext": ciphertext_trimmed,
        "ephemeral_result_pubkey": erpk_trimmed,
    });

    let (_bot_seq, event_payload) = crate::bots::prepare_durable_bot_event(
        &mut tx,
        bot_id,
        "bot.command_invoked",
        raw_event_payload,
    )
    .await
    .map_err(|e| ApiError::Internal(e.into()))?;

    tx.commit()
        .await
        .map_err(|e| ApiError::Internal(e.into()))?;

    // 8. Publish bot.command_invoked on private-bot-{bot_id}
    let publish_res = Publisher::publish(
        &state.publisher,
        &format!("private-bot-{}", bot_id),
        "bot.command_invoked",
        event_payload,
    )
    .await;

    if publish_res.is_ok() {
        let _ =
            sqlx::query("UPDATE bot_commands SET delivered_at = CURRENT_TIMESTAMP WHERE id = ?")
                .bind(&command_id)
                .execute(&state.pool)
                .await;
    }

    let resp = PostBotCommandResp {
        command_id,
        created_at,
        request_id: request_id_trimmed.map(|s| s.to_string()),
        idempotent: None,
    };

    let mut response = (StatusCode::ACCEPTED, Json(resp)).into_response();
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        header::HeaderValue::from_static("no-store"),
    );
    Ok(response)
}

#[derive(Deserialize, ToSchema)]
pub struct PostBotMessageReq {
    pub epoch: i64,
    /// Bot message ciphertext encrypted under current epoch publisher key, base64url encoded. Wire shape: ephemeral_pubkey (32) || nonce (12) || ciphertext || tag (16). Reference: §6.33, §8.8.10.
    #[schema(value_type = String, format = Binary)]
    pub ciphertext: String,
    pub content_type: String,
    /// Ed25519 signature over room_id || epoch || content_type || ciphertext. Reference: §8.10.
    #[schema(value_type = String, format = Binary)]
    pub signature: String,
    pub request_id: Option<String>,
}

#[derive(Serialize, ToSchema)]
pub struct PostBotMessageResp {
    pub message_id: String,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub idempotent: Option<bool>,
}

/// POST /rooms/:id/bot-messages
#[utoipa::path(
    post,
    path = "/api/v1/rooms/{id}/bot-messages",
    tag = "Bots",
    summary = "Bot posts a message",
    description = "Bot posts an encrypted message to a room per §8.8.10. Auth: Bot token matching granted bot_id with post_message scope. Ed25519 signature verified per §8.10. Supports request_id idempotency.",
    params(
        ("id" = String, Path, description = "Room ID")
    ),
    request_body = PostBotMessageReq,
    responses(
        (status = 202, description = "Message accepted", body = PostBotMessageResp),
        (status = 400, description = "Invalid content_type, ciphertext, signature, or epoch out of window", body = ErrorResponse),
        (status = 401, description = "Unauthorized (requires bot token)", body = ErrorResponse),
        (status = 403, description = "Forbidden (bot not granted post_message scope)", body = ErrorResponse),
        (status = 409, description = "Request ID conflict", body = ErrorResponse),
        (status = 429, description = "Too many requests", body = ErrorResponse),
    ),
    security(
        ("bearer_auth" = [])
    )
)]
pub async fn post_bot_message(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(room_id): Path<String>,
    Json(req): Json<PostBotMessageReq>,
) -> Result<Response, ApiError> {
    let caller = crate::routes::bots::resolve_caller(&state.pool, &headers, &state).await?;
    let bot_ctx = match caller {
        CallerIdentity::Bot(b) => b,
        CallerIdentity::User(_) => return Err(ApiError::Forbidden("forbidden".into())),
    };

    let bot_id = &bot_ctx.bot_id;

    // 1. Verify active grant in room with post_message scope
    let has_grant: bool = sqlx::query_scalar(
        r#"
        SELECT EXISTS(
            SELECT 1 FROM room_bots rb
            JOIN room_bot_scopes rbs ON rbs.room_id = rb.room_id AND rbs.bot_id = rb.bot_id
            WHERE rb.room_id = ? AND rb.bot_id = ? AND rb.revoked_at IS NULL AND rbs.scope = 'post_message'
        )
        "#,
    )
    .bind(&room_id)
    .bind(bot_id)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| ApiError::Internal(e.into()))?;

    if !has_grant {
        return Err(ApiError::Forbidden("bot_not_granted".into()));
    }

    // 2. Validate content_type
    if req.content_type.trim() != "bot" {
        return Err(ApiError::BadRequest("invalid_content_type".into()));
    }

    // 3. Validate ciphertext
    let ciphertext_trimmed = req.ciphertext.trim();
    if ciphertext_trimmed.is_empty() {
        return Err(ApiError::BadRequest("invalid_ciphertext".into()));
    }

    let decoded_ciphertext = match URL_SAFE_NO_PAD.decode(ciphertext_trimmed) {
        Ok(bytes) => bytes,
        Err(_) => return Err(ApiError::BadRequest("invalid_ciphertext".into())),
    };

    if decoded_ciphertext.is_empty() {
        return Err(ApiError::BadRequest("invalid_ciphertext".into()));
    }

    if decoded_ciphertext.len() > 65536 {
        return Err(ApiError::InternalCustom(
            StatusCode::PAYLOAD_TOO_LARGE,
            "ciphertext_too_large".into(),
        ));
    }

    // 4. Check request_id format if present
    let request_id_trimmed = match req.request_id.as_deref() {
        Some(s) => {
            let trimmed = s.trim();
            if !crate::bots::validate_request_id(trimmed) {
                return Err(ApiError::BadRequest("invalid_request_id".into()));
            }
            Some(trimmed)
        }
        None => None,
    };

    // 5. Check epoch window
    let current_epoch: i64 = sqlx::query_scalar("SELECT epoch FROM room_epochs WHERE room_id = ?")
        .bind(&room_id)
        .fetch_optional(&state.pool)
        .await
        .map_err(|e| ApiError::Internal(e.into()))?
        .unwrap_or(0);

    let min_epoch = if current_epoch >= 3 {
        current_epoch - 3
    } else {
        0
    };
    if req.epoch < min_epoch || req.epoch > current_epoch {
        return Err(ApiError::BadRequest("epoch_out_of_window".into()));
    }

    // 6. Verify Ed25519 signature
    let bot_row: Option<(String, String)> = sqlx::query_as(
        "SELECT bot_identity_pubkey, owner_user_id FROM bot_accounts WHERE id = ? AND deleted_at IS NULL AND disabled_at IS NULL"
    )
    .bind(bot_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| ApiError::Internal(e.into()))?;

    let (bot_pubkey, _owner_user_id) = match bot_row {
        Some(row) => row,
        None => return Err(ApiError::Forbidden("bot_not_granted".into())),
    };

    let signing_input = crate::signing::encode_bot_message_signing_input(
        &room_id,
        req.epoch as u64,
        &req.content_type,
        &decoded_ciphertext,
    );

    if crate::signing::verify_publisher_key_signature(&bot_pubkey, &signing_input, &req.signature)
        .is_err()
    {
        return Err(ApiError::BadRequest("signature_invalid".into()));
    }

    // 7. Check rate limit
    let decision = rate_limit::check(
        &state.pool,
        &state.config.rate_limits,
        RateLimitKey::BotMessage {
            bot_id: bot_id.to_string(),
        },
    )
    .await?;

    if !decision.allowed {
        return Err(ApiError::TooManyRequests {
            message: "rate_limited".into(),
            reset_at: decision.reset_at,
        });
    }

    // 8. Begin transaction
    let mut tx = state
        .pool
        .begin()
        .await
        .map_err(|e| ApiError::Internal(e.into()))?;

    if let Some(req_id) = request_id_trimmed {
        let outcome = crate::bots::check_or_reserve_request_id(
            &mut tx,
            bot_id,
            req_id,
            crate::bots::ENDPOINT_BOT_MESSAGES,
        )
        .await
        .map_err(|e| ApiError::Internal(e.into()))?;

        match outcome {
            crate::bots::IdempotencyOutcome::Duplicate { response_code } => {
                let _ = tx.rollback().await;
                let resp = PostBotMessageResp {
                    message_id: "idempotent".to_string(),
                    created_at: chrono::Utc::now().to_rfc3339(),
                    request_id: Some(req_id.to_string()),
                    idempotent: Some(true),
                };
                let status = StatusCode::from_u16(response_code).unwrap_or(StatusCode::ACCEPTED);
                let mut response = (status, Json(resp)).into_response();
                response.headers_mut().insert(
                    header::CACHE_CONTROL,
                    header::HeaderValue::from_static("no-store"),
                );
                return Ok(response);
            }
            crate::bots::IdempotencyOutcome::Conflict => {
                let _ = tx.rollback().await;
                return Err(ApiError::Conflict("request_id_conflict".into()));
            }
            crate::bots::IdempotencyOutcome::Reserved => {}
        }
    }

    // 9. Lookup current active KT leaf index for bot and insert into room_messages table
    let leaf_index_opt =
        crate::key_transparency::current_bot_leaf_index_tx(&mut tx, bot_id).await?;
    if leaf_index_opt.is_none() {
        tracing::warn!(bot_id = %bot_id, "bot missing key transparency leaf entry on message insert");
    }

    let message_id = format!("msg_{}", Ulid::new());
    let seq: i64 =
        sqlx::query_scalar("SELECT COALESCE(MAX(seq), 0) + 1 FROM room_messages WHERE room_id = ?")
            .bind(&room_id)
            .fetch_one(&mut *tx)
            .await
            .map_err(|e| ApiError::Internal(e.into()))?;

    let created_at: String = sqlx::query_scalar(
        r#"
        INSERT INTO room_messages (id, room_id, sender_bot_id, sender_client_id, bot_key_leaf_index, epoch, seq, content_type, ciphertext)
        VALUES (?, ?, ?, 'bot', ?, ?, ?, ?, ?)
        RETURNING CAST(created_at AS TEXT)
        "#,
    )
    .bind(&message_id)
    .bind(&room_id)
    .bind(bot_id)
    .bind(leaf_index_opt)
    .bind(req.epoch)
    .bind(seq)
    .bind(&req.content_type)
    .bind(&decoded_ciphertext)
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| ApiError::Internal(e.into()))?;

    if let Some(req_id) = request_id_trimmed {
        crate::bots::record_response_code(&mut tx, bot_id, req_id, 202)
            .await
            .map_err(|e| ApiError::Internal(e.into()))?;
    }

    tx.commit()
        .await
        .map_err(|e| ApiError::Internal(e.into()))?;

    // 10. Publish message.new event on private-room-{room_id}
    let msg_payload = json!({
        "id": message_id,
        "room_id": room_id,
        "sender_type": "bot",
        "sender_id": bot_id,
        "sender_client_id": "bot",
        "epoch": req.epoch,
        "seq": seq,
        "content_type": req.content_type,
        "bot_key_leaf_index": leaf_index_opt,
        "created_at": created_at,
    });

    let _ = Publisher::publish(
        &state.publisher,
        &format!("private-room-{}", room_id),
        "message.new",
        msg_payload,
    )
    .await;

    let resp = PostBotMessageResp {
        message_id,
        created_at,
        request_id: request_id_trimmed.map(|s| s.to_string()),
        idempotent: None,
    };

    let mut response = (StatusCode::ACCEPTED, Json(resp)).into_response();
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        header::HeaderValue::from_static("no-store"),
    );
    Ok(response)
}
