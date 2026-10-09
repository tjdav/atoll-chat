use crate::allocate_user_seq;
use crate::attachments;
use crate::auth::AuthUser;
use crate::bots::{validate_bot_token, validate_scopes, CallerIdentity};
use crate::error::ApiError;
use crate::rate_limit::{self, RateLimitKey};
use crate::rooms::{queue_pending_mls_remove_batch, MlsTarget};
use crate::routes::attachments::{
    get_effective_user_file_size_limit, parse_multipart_strict_single_file, AttachmentRouteError,
};
use crate::sockudo::Publisher;
use crate::AppState;
use axum::{
    extract::{FromRequest, Multipart, Path, State},
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use chrono::{DateTime, Utc};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use sqlx::{Row, SqlitePool};
use ulid::Ulid;

pub async fn resolve_caller(
    pool: &SqlitePool,
    headers: &HeaderMap,
    _state: &AppState,
) -> Result<CallerIdentity, ApiError> {
    let auth_header = match headers.get(header::AUTHORIZATION) {
        Some(val) => match val.to_str() {
            Ok(s) => s,
            Err(_) => return Err(ApiError::Unauthorized("unauthorized".into())),
        },
        None => return Err(ApiError::Unauthorized("unauthorized".into())),
    };

    let raw_token = if let Some(t) = auth_header.strip_prefix("Bearer ") {
        let trimmed = t.trim();
        if trimmed.is_empty() {
            return Err(ApiError::Unauthorized("unauthorized".into()));
        }
        trimmed
    } else {
        return Err(ApiError::Unauthorized("unauthorized".into()));
    };

    // 1. Try bot token
    if let Ok(Some(bot_ctx)) = validate_bot_token(pool, raw_token).await {
        return Ok(CallerIdentity::Bot(bot_ctx));
    }

    // 2. Fall back to user session token
    let session_ctx = match crate::session::validate_session(pool, raw_token).await {
        Ok(Some(ctx)) => ctx,
        Ok(None) => return Err(ApiError::Unauthorized("unauthorized".into())),
        Err(e) => return Err(ApiError::Internal(e.into())),
    };

    let user_row = sqlx::query(
        "SELECT username_token, encrypted_display, disabled_at FROM users WHERE id = ?",
    )
    .bind(&session_ctx.user_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| ApiError::Internal(e.into()))?;

    let user_row = match user_row {
        Some(r) => r,
        None => return Err(ApiError::Unauthorized("unauthorized".into())),
    };

    let disabled_at: Option<DateTime<Utc>> = user_row.get("disabled_at");
    if disabled_at.is_some() {
        return Err(ApiError::Unauthorized("account_disabled".into()));
    }

    let username_token: String = user_row.get("username_token");
    let encrypted_display: Option<String> = user_row.get("encrypted_display");

    Ok(CallerIdentity::User(AuthUser {
        user_id: session_ctx.user_id,
        session_id: session_ctx.session_id,
        device_id: session_ctx.device_id,
        username_token,
        encrypted_display,
        expires_at: Utc::now(),
        created_at: Utc::now(),
    }))
}

fn validate_pubkey_32(pk_str: &str) -> bool {
    match URL_SAFE_NO_PAD.decode(pk_str) {
        Ok(bytes) => bytes.len() == 32,
        Err(_) => false,
    }
}

pub fn generate_raw_token() -> (String, String) {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    let raw = URL_SAFE_NO_PAD.encode(bytes);

    let mut hasher = Sha256::new();
    hasher.update(raw.as_bytes());
    let hash = hex::encode(hasher.finalize());

    (raw, hash)
}

#[derive(Deserialize)]
pub struct CreateBotReq {
    pub display_name: String,
    pub bot_identity_pubkey: String,
    pub bot_command_pubkey: String,
    pub identity_pubkey: String,
    pub declared_scopes: Vec<String>,
}

#[derive(Serialize)]
pub struct BotView {
    pub bot_id: String,
    pub display_name: String,
    pub avatar_file_id: Option<String>,
    pub bot_identity_pubkey: String,
    pub bot_command_pubkey: String,
    pub identity_pubkey: String,
    pub declared_scopes: Vec<String>,
    pub owner_user_id: String,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bot_token: Option<String>,
}

pub async fn create_bot(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Json(req): Json<CreateBotReq>,
) -> Result<Response, ApiError> {
    // Rate limit check
    let decision = rate_limit::check(
        &state.pool,
        &state.config.rate_limits,
        RateLimitKey::BotCreate {
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

    let display_name = req.display_name.trim();
    if display_name.is_empty() || display_name.len() > 64 {
        return Err(ApiError::BadRequest("invalid_display_name".into()));
    }

    if !validate_pubkey_32(&req.bot_identity_pubkey)
        || !validate_pubkey_32(&req.bot_command_pubkey)
        || !validate_pubkey_32(&req.identity_pubkey)
    {
        return Err(ApiError::BadRequest("invalid_pubkey".into()));
    }

    if req.declared_scopes.is_empty() {
        return Err(ApiError::BadRequest("declared_scopes_empty".into()));
    }

    if let Err(e) = validate_scopes(&req.declared_scopes) {
        match e {
            crate::bots::ScopeError::OutOfVocabulary(s) => {
                return Err(ApiError::BadRequest(format!("invalid_scope: {}", s)))
            }
            crate::bots::ScopeError::DependencyMissing => {
                return Err(ApiError::BadRequest("scope_dependency_missing".into()))
            }
        }
    }

    let bot_id = format!("b_{}", Ulid::new());
    let token_id = format!("bt_{}", Ulid::new());
    let (raw_token, token_hash) = generate_raw_token();

    let mut tx = state
        .pool
        .begin()
        .await
        .map_err(|e| ApiError::Internal(e.into()))?;

    // Allocate user_seq for owner's user channel event
    let user_seq = allocate_user_seq(&mut tx, &auth_user.user_id)
        .await
        .map_err(|e| ApiError::Internal(e.into()))?;

    let created_at: String = sqlx::query_scalar(
        r#"
        INSERT INTO bot_accounts (id, display_name, bot_identity_pubkey, bot_command_pubkey, identity_pubkey, owner_user_id)
        VALUES (?, ?, ?, ?, ?, ?)
        RETURNING CAST(created_at AS TEXT)
        "#,
    )
    .bind(&bot_id)
    .bind(display_name)
    .bind(&req.bot_identity_pubkey)
    .bind(&req.bot_command_pubkey)
    .bind(&req.identity_pubkey)
    .bind(&auth_user.user_id)
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| ApiError::Internal(e.into()))?;

    for scope in &req.declared_scopes {
        sqlx::query("INSERT INTO bot_declared_scopes (bot_id, scope) VALUES (?, ?)")
            .bind(&bot_id)
            .bind(scope)
            .execute(&mut *tx)
            .await
            .map_err(|e| ApiError::Internal(e.into()))?;
    }

    sqlx::query("INSERT INTO bot_tokens (id, bot_id, token_hash) VALUES (?, ?, ?)")
        .bind(&token_id)
        .bind(&bot_id)
        .bind(&token_hash)
        .execute(&mut *tx)
        .await
        .map_err(|e| ApiError::Internal(e.into()))?;

    tx.commit()
        .await
        .map_err(|e| ApiError::Internal(e.into()))?;

    // Publish bot.created on owner user channel
    let event_payload = json!({
        "bot_id": bot_id,
        "display_name": display_name,
        "created_at": created_at,
        "user_seq": user_seq
    });
    let _ = Publisher::publish(
        &state.publisher,
        &format!("private-user-{}", auth_user.user_id),
        "bot.created",
        event_payload,
    )
    .await;

    let view = BotView {
        bot_id,
        display_name: display_name.to_string(),
        avatar_file_id: None,
        bot_identity_pubkey: req.bot_identity_pubkey,
        bot_command_pubkey: req.bot_command_pubkey,
        identity_pubkey: req.identity_pubkey,
        declared_scopes: req.declared_scopes,
        owner_user_id: auth_user.user_id,
        created_at,
        bot_token: Some(raw_token),
    };

    let mut response = (StatusCode::CREATED, Json(view)).into_response();
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        header::HeaderValue::from_static("no-store"),
    );
    Ok(response)
}

pub async fn get_bot(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(bot_id): Path<String>,
) -> Result<Response, ApiError> {
    let caller = resolve_caller(&state.pool, &headers, &state).await?;

    let row = sqlx::query(
        r#"
        SELECT id, display_name, avatar_file_id, bot_identity_pubkey, bot_command_pubkey, identity_pubkey, owner_user_id, CAST(created_at AS TEXT) AS created_at
        FROM bot_accounts
        WHERE id = ? AND deleted_at IS NULL
        "#,
    )
    .bind(&bot_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| ApiError::Internal(e.into()))?;

    let row = match row {
        Some(r) => r,
        None => return Err(ApiError::NotFound("bot_not_found".into())),
    };

    let owner_user_id: String = row.get("owner_user_id");
    if !caller.is_owner_or_bot(&bot_id, &owner_user_id) {
        return Err(ApiError::Forbidden("forbidden".into()));
    }

    let scope_rows: Vec<String> = sqlx::query_scalar(
        "SELECT scope FROM bot_declared_scopes WHERE bot_id = ? ORDER BY scope ASC",
    )
    .bind(&bot_id)
    .fetch_all(&state.pool)
    .await
    .map_err(|e| ApiError::Internal(e.into()))?;

    let view = BotView {
        bot_id,
        display_name: row.get("display_name"),
        avatar_file_id: row.get("avatar_file_id"),
        bot_identity_pubkey: row.get("bot_identity_pubkey"),
        bot_command_pubkey: row.get("bot_command_pubkey"),
        identity_pubkey: row.get("identity_pubkey"),
        declared_scopes: scope_rows,
        owner_user_id,
        created_at: row.get("created_at"),
        bot_token: None,
    };

    let mut response = (StatusCode::OK, Json(view)).into_response();
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        header::HeaderValue::from_static("no-store"),
    );
    Ok(response)
}

#[derive(Deserialize)]
pub struct PatchBotReq {
    pub display_name: Option<String>,
}

pub async fn patch_bot(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(bot_id): Path<String>,
    Json(req): Json<PatchBotReq>,
) -> Result<Response, ApiError> {
    let caller = resolve_caller(&state.pool, &headers, &state).await?;

    let row = sqlx::query(
        "SELECT owner_user_id, display_name FROM bot_accounts WHERE id = ? AND deleted_at IS NULL",
    )
    .bind(&bot_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| ApiError::Internal(e.into()))?;

    let row = match row {
        Some(r) => r,
        None => return Err(ApiError::NotFound("bot_not_found".into())),
    };

    let owner_user_id: String = row.get("owner_user_id");
    if !caller.is_owner_or_bot(&bot_id, &owner_user_id) {
        return Err(ApiError::Forbidden("forbidden".into()));
    }

    let mut changed = Vec::new();

    if let Some(ref new_name) = req.display_name {
        let trimmed = new_name.trim();
        if trimmed.is_empty() || trimmed.len() > 64 {
            return Err(ApiError::BadRequest("invalid_display_name".into()));
        }

        sqlx::query("UPDATE bot_accounts SET display_name = ? WHERE id = ?")
            .bind(trimmed)
            .bind(&bot_id)
            .execute(&state.pool)
            .await
            .map_err(|e| ApiError::Internal(e.into()))?;

        changed.push("display_name".to_string());
    }

    if !changed.is_empty() {
        let update_event = json!({
            "bot_id": bot_id,
            "changed": changed
        });

        // Publish to private-bot-{bot_id}
        let _ = Publisher::publish(
            &state.publisher,
            &format!("private-bot-{}", bot_id),
            "bot.updated",
            update_event.clone(),
        )
        .await;

        // Publish to each granted room channel
        let room_ids: Vec<String> = sqlx::query_scalar(
            "SELECT room_id FROM room_bots WHERE bot_id = ? AND revoked_at IS NULL",
        )
        .bind(&bot_id)
        .fetch_all(&state.pool)
        .await
        .map_err(|e| ApiError::Internal(e.into()))?;

        for room_id in room_ids {
            let _ = Publisher::publish(
                &state.publisher,
                &format!("private-room-{}", room_id),
                "bot.updated",
                update_event.clone(),
            )
            .await;
        }
    }

    // Return updated record
    get_bot(State(state), headers, Path(bot_id)).await
}

pub async fn delete_bot(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(bot_id): Path<String>,
) -> Result<Response, ApiError> {
    let caller = resolve_caller(&state.pool, &headers, &state).await?;

    let row =
        sqlx::query("SELECT owner_user_id FROM bot_accounts WHERE id = ? AND deleted_at IS NULL")
            .bind(&bot_id)
            .fetch_optional(&state.pool)
            .await
            .map_err(|e| ApiError::Internal(e.into()))?;

    let row = match row {
        Some(r) => r,
        None => return Err(ApiError::NotFound("bot_not_found".into())),
    };

    let owner_user_id: String = row.get("owner_user_id");
    if !caller.is_owner_or_bot(&bot_id, &owner_user_id) {
        return Err(ApiError::Forbidden("forbidden".into()));
    }

    let mut tx = state
        .pool
        .begin()
        .await
        .map_err(|e| ApiError::Internal(e.into()))?;

    let deleted_at: String = sqlx::query_scalar(
        "UPDATE bot_accounts SET deleted_at = CURRENT_TIMESTAMP WHERE id = ? RETURNING CAST(deleted_at AS TEXT)",
    )
    .bind(&bot_id)
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| ApiError::Internal(e.into()))?;

    // Revoke tokens
    sqlx::query("UPDATE bot_tokens SET revoked_at = CURRENT_TIMESTAMP WHERE bot_id = ? AND revoked_at IS NULL")
        .bind(&bot_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| ApiError::Internal(e.into()))?;

    // Find active room grants
    let grants: Vec<(String, String)> = sqlx::query_as(
        "SELECT room_id, mode FROM room_bots WHERE bot_id = ? AND revoked_at IS NULL",
    )
    .bind(&bot_id)
    .fetch_all(&mut *tx)
    .await
    .map_err(|e| ApiError::Internal(e.into()))?;

    for (room_id, mode) in &grants {
        sqlx::query(
            "UPDATE room_bots SET revoked_at = CURRENT_TIMESTAMP WHERE room_id = ? AND bot_id = ?",
        )
        .bind(room_id)
        .bind(&bot_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| ApiError::Internal(e.into()))?;

        if mode == "member" {
            queue_pending_mls_remove_batch(&mut tx, room_id, MlsTarget::Bot(&bot_id))
                .await
                .map_err(|e| ApiError::Internal(e.into()))?;
        }
    }

    // Allocate user_seq for durable bot.deleted event on owner's user channel
    let user_seq = allocate_user_seq(&mut tx, &owner_user_id)
        .await
        .map_err(|e| ApiError::Internal(e.into()))?;

    tx.commit()
        .await
        .map_err(|e| ApiError::Internal(e.into()))?;

    // Publish bot.deleted on owner's user channel
    let event_payload = json!({
        "bot_id": bot_id,
        "deleted_at": deleted_at,
        "user_seq": user_seq
    });
    let _ = Publisher::publish(
        &state.publisher,
        &format!("private-user-{}", owner_user_id),
        "bot.deleted",
        event_payload,
    )
    .await;

    // Publish bot.deleted on each granted room channel
    for (room_id, _) in grants {
        let room_event = json!({
            "room_id": room_id,
            "bot_id": bot_id
        });
        let _ = Publisher::publish(
            &state.publisher,
            &format!("private-room-{}", room_id),
            "bot.deleted",
            room_event,
        )
        .await;
    }

    Ok(StatusCode::NO_CONTENT.into_response())
}

pub async fn upload_bot_avatar(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(bot_id): Path<String>,
    body: axum::extract::Request,
) -> Result<Response, Response> {
    let pool = &state.pool;
    let storage = &state.storage;
    let config = &state.config;
    let hard_max = &state.server_hard_max;
    let caller = resolve_caller(pool, &headers, &state)
        .await
        .map_err(|e| e.into_response())?;

    let row =
        sqlx::query("SELECT owner_user_id FROM bot_accounts WHERE id = ? AND deleted_at IS NULL")
            .bind(&bot_id)
            .fetch_optional(pool)
            .await
            .map_err(|e| ApiError::Internal(e.into()).into_response())?;

    let row = match row {
        Some(r) => r,
        None => return Err(ApiError::NotFound("bot_not_found".into()).into_response()),
    };

    let owner_user_id: String = row.get("owner_user_id");
    if !caller.is_owner_or_bot(&bot_id, &owner_user_id) {
        return Err(ApiError::Forbidden("forbidden".into()).into_response());
    }

    let content_type = headers
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_lowercase();

    if !content_type.starts_with("multipart/form-data") {
        return Err(AttachmentRouteError::UnsupportedMediaType.into_response());
    }

    let effective_limit =
        get_effective_user_file_size_limit(pool, &owner_user_id, config, hard_max)
            .await
            .map_err(|e| e.into_response())?;

    let multipart = Multipart::from_request(body, &())
        .await
        .map_err(|_| AttachmentRouteError::MissingFile.into_response())?;

    let req = parse_multipart_strict_single_file(None, &owner_user_id, multipart)
        .await
        .map_err(|e| e.into_response())?;

    if req.data.len() as u64 > effective_limit {
        return Err(AttachmentRouteError::FileTooLarge {
            limit: effective_limit,
            received: req.data.len() as u64,
        }
        .into_response());
    }

    let view = attachments::upload_attachment(pool, storage.as_ref(), config, req)
        .await
        .map_err(|e| AttachmentRouteError::from(e).into_response())?;

    sqlx::query("UPDATE bot_accounts SET avatar_file_id = ? WHERE id = ?")
        .bind(&view.id)
        .bind(&bot_id)
        .execute(pool)
        .await
        .map_err(|e| ApiError::Internal(e.into()).into_response())?;

    let update_event = json!({
        "bot_id": bot_id,
        "changed": ["avatar"]
    });

    let _ = Publisher::publish(
        &state.publisher,
        &format!("private-bot-{}", bot_id),
        "bot.updated",
        update_event.clone(),
    )
    .await;

    let room_ids: Vec<String> =
        sqlx::query_scalar("SELECT room_id FROM room_bots WHERE bot_id = ? AND revoked_at IS NULL")
            .bind(&bot_id)
            .fetch_all(pool)
            .await
            .map_err(|e| ApiError::Internal(e.into()).into_response())?;

    for room_id in room_ids {
        let _ = Publisher::publish(
            &state.publisher,
            &format!("private-room-{}", room_id),
            "bot.updated",
            update_event.clone(),
        )
        .await;
    }

    let res_headers = [(header::CACHE_CONTROL, "no-store".to_string())];
    Ok((StatusCode::CREATED, res_headers, Json(view)).into_response())
}

pub async fn delete_bot_avatar(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(bot_id): Path<String>,
) -> Result<Response, ApiError> {
    let caller = resolve_caller(&state.pool, &headers, &state).await?;

    let row =
        sqlx::query("SELECT owner_user_id FROM bot_accounts WHERE id = ? AND deleted_at IS NULL")
            .bind(&bot_id)
            .fetch_optional(&state.pool)
            .await
            .map_err(|e| ApiError::Internal(e.into()))?;

    let row = match row {
        Some(r) => r,
        None => return Err(ApiError::NotFound("bot_not_found".into())),
    };

    let owner_user_id: String = row.get("owner_user_id");
    if !caller.is_owner_or_bot(&bot_id, &owner_user_id) {
        return Err(ApiError::Forbidden("forbidden".into()));
    }

    sqlx::query("UPDATE bot_accounts SET avatar_file_id = NULL WHERE id = ?")
        .bind(&bot_id)
        .execute(&state.pool)
        .await
        .map_err(|e| ApiError::Internal(e.into()))?;

    let update_event = json!({
        "bot_id": bot_id,
        "changed": ["avatar"]
    });

    let _ = Publisher::publish(
        &state.publisher,
        &format!("private-bot-{}", bot_id),
        "bot.updated",
        update_event.clone(),
    )
    .await;

    let room_ids: Vec<String> =
        sqlx::query_scalar("SELECT room_id FROM room_bots WHERE bot_id = ? AND revoked_at IS NULL")
            .bind(&bot_id)
            .fetch_all(&state.pool)
            .await
            .map_err(|e| ApiError::Internal(e.into()))?;

    for room_id in room_ids {
        let _ = Publisher::publish(
            &state.publisher,
            &format!("private-room-{}", room_id),
            "bot.updated",
            update_event.clone(),
        )
        .await;
    }

    Ok(StatusCode::NO_CONTENT.into_response())
}

#[derive(Serialize)]
pub struct CreateTokenResp {
    pub token_id: String,
    pub bot_token: String,
}

pub async fn create_token(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(bot_id): Path<String>,
) -> Result<Response, ApiError> {
    let caller = resolve_caller(&state.pool, &headers, &state).await?;

    let row =
        sqlx::query("SELECT owner_user_id FROM bot_accounts WHERE id = ? AND deleted_at IS NULL")
            .bind(&bot_id)
            .fetch_optional(&state.pool)
            .await
            .map_err(|e| ApiError::Internal(e.into()))?;

    let row = match row {
        Some(r) => r,
        None => return Err(ApiError::NotFound("bot_not_found".into())),
    };

    let owner_user_id: String = row.get("owner_user_id");
    if !caller.is_owner_or_bot(&bot_id, &owner_user_id) {
        return Err(ApiError::Forbidden("forbidden".into()));
    }

    // Rate limit check
    let decision = rate_limit::check(
        &state.pool,
        &state.config.rate_limits,
        RateLimitKey::BotTokenIssue {
            bot_id: bot_id.clone(),
        },
    )
    .await?;

    if !decision.allowed {
        return Err(ApiError::TooManyRequests {
            message: "rate_limited".into(),
            reset_at: decision.reset_at,
        });
    }

    let token_id = format!("bt_{}", Ulid::new());
    let (raw_token, token_hash) = generate_raw_token();

    sqlx::query("INSERT INTO bot_tokens (id, bot_id, token_hash) VALUES (?, ?, ?)")
        .bind(&token_id)
        .bind(&bot_id)
        .bind(&token_hash)
        .execute(&state.pool)
        .await
        .map_err(|e| ApiError::Internal(e.into()))?;

    let resp = CreateTokenResp {
        token_id,
        bot_token: raw_token,
    };

    let mut response = (StatusCode::CREATED, Json(resp)).into_response();
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        header::HeaderValue::from_static("no-store"),
    );
    Ok(response)
}

pub async fn delete_token(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((bot_id, token_id)): Path<(String, String)>,
) -> Result<Response, ApiError> {
    let caller = resolve_caller(&state.pool, &headers, &state).await?;

    let row =
        sqlx::query("SELECT owner_user_id FROM bot_accounts WHERE id = ? AND deleted_at IS NULL")
            .bind(&bot_id)
            .fetch_optional(&state.pool)
            .await
            .map_err(|e| ApiError::Internal(e.into()))?;

    let row = match row {
        Some(r) => r,
        None => return Err(ApiError::NotFound("bot_not_found".into())),
    };

    let owner_user_id: String = row.get("owner_user_id");
    if !caller.is_owner_or_bot(&bot_id, &owner_user_id) {
        return Err(ApiError::Forbidden("forbidden".into()));
    }

    let res = sqlx::query(
        "UPDATE bot_tokens SET revoked_at = CURRENT_TIMESTAMP WHERE id = ? AND bot_id = ? AND revoked_at IS NULL",
    )
    .bind(&token_id)
    .bind(&bot_id)
    .execute(&state.pool)
    .await
    .map_err(|e| ApiError::Internal(e.into()))?;

    if res.rows_affected() == 0 {
        return Err(ApiError::NotFound("token_not_found".into()));
    }

    Ok(StatusCode::NO_CONTENT.into_response())
}
