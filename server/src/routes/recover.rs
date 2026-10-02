use crate::audit;
use crate::error::ApiError;
use crate::identity::{token_bytes, validate_token};
use crate::opaque::DefaultCipherSuite;
use crate::rate_limit::{self, RateLimitKey, Window};
use crate::recovery::PendingRecovery;
use crate::recovery_code;
use crate::session;
use crate::sync::envelope::{publish_user_event, UserEventEnvelope};
use crate::AppState;
use axum::{extract::State, http::HeaderMap, Json};
use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use base64::Engine;
use chrono::{Duration, Utc};
use opaque_ke::{ClientRegistration, RegistrationUpload, ServerRegistration};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use std::time::Instant;

#[derive(Debug, Deserialize)]
pub struct RecoverStartRequest {
    pub recovery_code: String,
    pub username_token: String,
}

#[derive(Debug, Serialize)]
pub struct RecoverStartResponse {
    pub recovery_session: String,
    pub registration_challenge: String,
    pub expires_at: String,
}

#[derive(Debug, Deserialize)]
pub struct RecoverFinishRequest {
    pub recovery_session: String,
    pub registration_record: String,
}

#[derive(Debug, Serialize)]
pub struct RecoverFinishResponse {
    pub session_token: String,
    pub user_id: String,
}

fn decode_base64(s: &str) -> Result<Vec<u8>, ApiError> {
    STANDARD
        .decode(s)
        .or_else(|_| URL_SAFE_NO_PAD.decode(s))
        .map_err(|_| ApiError::BadRequest("invalid base64 payload".to_string()))
}

fn normalize_recovery_code(code: &str) -> String {
    code.chars()
        .filter(|c| !c.is_whitespace())
        .collect::<String>()
        .to_uppercase()
}

pub async fn recover_start(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<RecoverStartRequest>,
) -> Result<Json<RecoverStartResponse>, ApiError> {
    // 1. Rate limiting per IP
    let client_ip = rate_limit::extract_client_ip(&headers, &state.config);
    let rl_min = rate_limit::check(
        &state.pool,
        &state.config.rate_limits,
        RateLimitKey::RecoverStart {
            ip: client_ip.clone(),
            window: Window::Minute,
        },
    )
    .await?;
    if !rl_min.allowed {
        return Err(ApiError::TooManyRequests {
            message: "rate limit exceeded".to_string(),
            reset_at: rl_min.reset_at,
        });
    }

    let rl_hour = rate_limit::check(
        &state.pool,
        &state.config.rate_limits,
        RateLimitKey::RecoverStart {
            ip: client_ip,
            window: Window::Hour,
        },
    )
    .await?;
    if !rl_hour.allowed {
        return Err(ApiError::TooManyRequests {
            message: "rate limit exceeded".to_string(),
            reset_at: rl_hour.reset_at,
        });
    }

    // 2. Validate inputs
    let username_token = body.username_token.trim().to_string();
    if validate_token(&username_token).is_err() {
        return Err(ApiError::NotFound("recovery_failed".to_string()));
    }

    let credential_id = match token_bytes(&username_token) {
        Ok(bytes) => bytes,
        Err(_) => return Err(ApiError::NotFound("recovery_failed".to_string())),
    };

    let normalized_code = normalize_recovery_code(&body.recovery_code);

    // 3. Look up user by username_token
    let user_row: Option<(String,)> =
        sqlx::query_as("SELECT id FROM users WHERE username_token = ? AND deleted_at IS NULL")
            .bind(&username_token)
            .fetch_optional(&state.pool)
            .await?;

    let (user_id,) = match user_row {
        Some(r) => r,
        None => return Err(ApiError::NotFound("recovery_failed".to_string())),
    };

    // 4. Verify recovery code
    let matched_code_id = recovery_code::verify_for_user(&state.pool, &user_id, &normalized_code)
        .await
        .map_err(|e| ApiError::Internal(e.into()))?;

    let recovery_code_id = match matched_code_id {
        Some(id) => id,
        None => return Err(ApiError::NotFound("recovery_failed".to_string())),
    };

    // Write audit log for successful recover.start
    let _ = audit::log(
        &state.pool,
        Some(&user_id),
        audit::action::RECOVER_START,
        Some("user"),
        Some(&user_id),
        None,
    )
    .await;

    // 5. Generate recovery session token (32 random bytes -> unpadded base64url)
    let mut session_bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut session_bytes);
    let recovery_session_token = URL_SAFE_NO_PAD.encode(session_bytes);

    // 6. Generate OPAQUE registration challenge
    let mut rng = rand::rngs::OsRng;
    let dummy_client_start =
        ClientRegistration::<DefaultCipherSuite>::start(&mut rng, b"dummy_password_for_challenge")
            .map_err(|e| {
                ApiError::Internal(anyhow::anyhow!(
                    "failed to create dummy client registration: {e}"
                ))
            })?;
    let opaque_req = dummy_client_start.message;

    let result = ServerRegistration::<DefaultCipherSuite>::start(
        &state.opaque_server.setup,
        opaque_req,
        &credential_id[..],
    )
    .map_err(|e| {
        ApiError::Internal(anyhow::anyhow!("OPAQUE registration challenge failed: {e}"))
    })?;

    let registration_challenge_bytes = result.message.serialize();
    let registration_challenge = STANDARD.encode(registration_challenge_bytes);

    // Expiry: 10 minutes from now
    let expires_at_dt = Utc::now() + Duration::minutes(10);
    let expires_at = expires_at_dt.to_rfc3339();

    // Store recovery session
    let pending = PendingRecovery {
        user_id,
        recovery_code_id,
        credential_id,
        created_at: Instant::now(),
    };
    state
        .recovery_store
        .insert(recovery_session_token.clone(), pending);

    Ok(Json(RecoverStartResponse {
        recovery_session: recovery_session_token,
        registration_challenge,
        expires_at,
    }))
}

pub async fn recover_finish(
    State(state): State<AppState>,
    Json(body): Json<RecoverFinishRequest>,
) -> Result<Json<RecoverFinishResponse>, ApiError> {
    // 1. Look up and consume recovery session token atomically
    let pending = state
        .recovery_store
        .take(&body.recovery_session)
        .ok_or_else(|| ApiError::BadRequest("recovery_session_invalid".to_string()))?;

    // 2. Decode registration_record bytes
    let upload_bytes = match decode_base64(&body.registration_record) {
        Ok(bytes) => bytes,
        Err(_) => return Err(ApiError::BadRequest("registration_invalid".to_string())),
    };

    // 3. Deserialize RegistrationUpload
    let upload = match RegistrationUpload::<DefaultCipherSuite>::deserialize(&upload_bytes) {
        Ok(u) => u,
        Err(_) => return Err(ApiError::BadRequest("registration_invalid".to_string())),
    };

    // 4. Finish OPAQUE registration
    let server_registration = ServerRegistration::<DefaultCipherSuite>::finish(upload);
    let opaque_registration_bytes = server_registration.serialize().to_vec();

    // 5. Transaction: mark recovery code consumed, update opaque_registration, revoke existing sessions
    let mut tx = state.pool.begin().await?;

    // Mark recovery code consumed
    sqlx::query("UPDATE recovery_codes SET consumed_at = CURRENT_TIMESTAMP WHERE id = ?")
        .bind(&pending.recovery_code_id)
        .execute(&mut *tx)
        .await?;

    // Update opaque_registration
    sqlx::query("UPDATE users SET opaque_registration = ? WHERE id = ?")
        .bind(&opaque_registration_bytes)
        .bind(&pending.user_id)
        .execute(&mut *tx)
        .await?;

    // Query unrevoked sessions for user prior to revocation so we can publish session.revoked events
    let session_rows: Vec<(String,)> =
        sqlx::query_as("SELECT id FROM sessions WHERE user_id = ? AND revoked_at IS NULL")
            .bind(&pending.user_id)
            .fetch_all(&mut *tx)
            .await?;

    // Revoke all existing sessions
    sqlx::query(
        "UPDATE sessions SET revoked_at = CURRENT_TIMESTAMP WHERE user_id = ? AND revoked_at IS NULL",
    )
    .bind(&pending.user_id)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;

    // 6. Issue new session for user
    let token = session::create_session(
        &state.pool,
        &pending.user_id,
        None,
        state.config.session_expiry_days,
    )
    .await?;

    // 7. Write audit log recover.finish
    let _ = audit::log(
        &state.pool,
        Some(&pending.user_id),
        audit::action::RECOVER_FINISH,
        Some("user"),
        Some(&pending.user_id),
        None,
    )
    .await;

    // 8. Publish session.revoked events post-commit
    for (sess_id,) in session_rows {
        let envelope = UserEventEnvelope::new(
            "session.revoked",
            0,
            serde_json::json!({
                "session_id": sess_id,
                "reason": "recovery"
            }),
        );
        let _ = publish_user_event(&state.publisher, &pending.user_id, &envelope).await;
    }

    Ok(Json(RecoverFinishResponse {
        session_token: token.raw,
        user_id: pending.user_id,
    }))
}
