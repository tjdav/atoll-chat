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

#[derive(Serialize)]
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

#[derive(Serialize)]
pub struct ListRoomBotsResp {
    pub bots: Vec<RoomBotView>,
}

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

#[derive(Deserialize)]
pub struct GrantBotReq {
    pub bot_id: String,
    pub scopes: Vec<String>,
}

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

#[derive(Deserialize)]
pub struct PatchRoomBotReq {
    pub scopes: Vec<String>,
}

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

pub async fn delete_room_bot(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path((room_id, bot_id)): Path<(String, String)>,
) -> Result<Response, ApiError> {
    check_room_grant_auth(&state.pool, &room_id, &auth_user.user_id).await?;

    let grant_row = sqlx::query(
        "SELECT mode FROM room_bots WHERE room_id = ? AND bot_id = ? AND revoked_at IS NULL",
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

    if mode_str == "member" {
        queue_pending_mls_remove_batch(&mut tx, &room_id, MlsTarget::Bot(&bot_id))
            .await
            .map_err(|e| ApiError::Internal(e.into()))?;
    }

    tx.commit()
        .await
        .map_err(|e| ApiError::Internal(e.into()))?;

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

#[derive(Deserialize)]
pub struct PostBotCommandReq {
    pub bot_id: String,
    pub ciphertext: String,
    pub request_id: String,
}

#[derive(Serialize)]
pub struct PostBotCommandResp {
    pub command_id: String,
    pub created_at: String,
    pub request_id: String,
}

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

    // 4. Validate request_id
    let request_id_trimmed = req.request_id.trim();
    if request_id_trimmed.is_empty()
        || request_id_trimmed.len() > 64
        || !request_id_trimmed.bytes().all(|b| (32..=126).contains(&b))
    {
        return Err(ApiError::BadRequest("invalid_request_id".into()));
    }

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

    // 7. Store in bot_commands
    let command_id = format!("cmd_{}", Ulid::new());
    let created_at: String = sqlx::query_scalar(
        r#"
        INSERT INTO bot_commands (id, bot_id, room_id, sender_user_id, sender_client_id, ciphertext)
        VALUES (?, ?, ?, ?, ?, ?)
        RETURNING CAST(created_at AS TEXT)
        "#,
    )
    .bind(&command_id)
    .bind(bot_id)
    .bind(&room_id)
    .bind(&auth_user.user_id)
    .bind(&sender_client_id)
    .bind(&decoded_ciphertext)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| ApiError::Internal(e.into()))?;

    // 8. Publish bot.command_invoked on private-bot-{bot_id}
    let event_payload = json!({
        "command_id": command_id,
        "room_id": room_id,
        "sender_user_id": auth_user.user_id,
        "sender_client_id": sender_client_id,
        "ciphertext": ciphertext_trimmed,
    });

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
        request_id: request_id_trimmed.to_string(),
    };

    let mut response = (StatusCode::ACCEPTED, Json(resp)).into_response();
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        header::HeaderValue::from_static("no-store"),
    );
    Ok(response)
}
