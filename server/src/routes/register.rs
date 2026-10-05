use crate::altcha::{verify_altcha_payload, AltchaConfig};
use crate::error::ApiError;
use crate::identity::{token_bytes, validate_encrypted_display, validate_token};
use crate::invites::{self, InviteError};
use crate::opaque::DefaultCipherSuite;
use crate::registration::PendingRegistration;
use crate::AppState;
use axum::{extract::State, Json};
use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use base64::Engine;
use opaque_ke::{RegistrationRequest, RegistrationUpload, ServerRegistration};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use std::time::Instant;
use tracing::info;

#[derive(Debug, Deserialize)]
pub struct RegisterStartRequest {
    pub lookup_token: Option<String>,
    pub username_token: Option<String>,
    pub registration_request: String,
    pub altcha: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct RegisterStartResponse {
    pub registration_id: String,
    pub registration_response: String,
}

#[derive(Debug, Deserialize)]
pub struct RegisterFinishRequest {
    pub registration_id: String,
    pub registration_upload: String,
    pub invite_code: Option<String>,
    pub encrypted_display: Option<String>,
    pub altcha: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct RegisterFinishResponse {
    pub user_id: String,
    pub username_token: String,
    pub is_owner: bool,
}

fn validate_altcha(
    altcha_config: &AltchaConfig,
    altcha_payload: Option<&str>,
) -> Result<(), ApiError> {
    if !altcha_config.enabled {
        return Ok(());
    }

    let payload = match altcha_payload {
        Some(p) if !p.trim().is_empty() => p,
        _ => return Err(ApiError::BadRequest("altcha_required".to_string())),
    };

    match verify_altcha_payload(altcha_config, payload) {
        Ok(true) => Ok(()),
        _ => Err(ApiError::BadRequest("invalid_altcha".to_string())),
    }
}

pub async fn register_challenge(
    State(state): State<AppState>,
) -> Result<Json<altcha::Challenge>, ApiError> {
    if !state.altcha_config.enabled {
        return Err(ApiError::NotFound("altcha_disabled".to_string()));
    }

    let options = altcha::CreateChallengeOptions {
        algorithm: state.altcha_config.algorithm.clone(),
        cost: state.altcha_config.cost,
        hmac_signature_secret: Some(state.altcha_config.hmac_secret.clone()),
        hmac_key_signature_secret: Some(state.altcha_config.hmac_secret.clone()),
        ..Default::default()
    };

    let challenge = altcha::create_challenge(options)
        .map_err(|e| ApiError::Internal(anyhow::anyhow!("failed to create challenge: {e}")))?;

    Ok(Json(challenge))
}

fn decode_base64(s: &str) -> Result<Vec<u8>, ApiError> {
    STANDARD
        .decode(s)
        .or_else(|_| URL_SAFE_NO_PAD.decode(s))
        .map_err(|_| ApiError::BadRequest("invalid base64 payload".to_string()))
}

pub async fn register_start(
    State(state): State<AppState>,
    body_val: Json<serde_json::Value>,
) -> Result<Json<RegisterStartResponse>, ApiError> {
    let obj = body_val
        .as_object()
        .ok_or_else(|| ApiError::BadRequest("invalid request body".to_string()))?;

    // Token split: raw token field must not be sent to server
    if obj.contains_key("token") {
        return Err(ApiError::BadRequest("token_not_accepted".to_string()));
    }

    let body: RegisterStartRequest = serde_json::from_value(body_val.0)
        .map_err(|e| ApiError::BadRequest(format!("invalid json body: {e}")))?;

    // 1. Validate lookup_token format
    let lookup_token = match body.lookup_token.or(body.username_token) {
        Some(ref tok) if !tok.trim().is_empty() => tok.trim().to_string(),
        _ => return Err(ApiError::BadRequest("missing_field".to_string())),
    };

    if validate_token(&lookup_token).is_err() {
        return Err(ApiError::BadRequest("invalid_username_token".to_string()));
    }

    // 2. Validate ALTCHA
    validate_altcha(&state.altcha_config, body.altcha.as_deref())?;

    // 3. Extract credential_id bytes from lookup_token
    let credential_id = token_bytes(&lookup_token)
        .map_err(|_| ApiError::BadRequest("invalid_username_token".to_string()))?;

    // 4. Validate registration_request
    let req_bytes = decode_base64(&body.registration_request)?;
    if req_bytes.is_empty() {
        return Err(ApiError::BadRequest(
            "registration_request cannot be empty".to_string(),
        ));
    }

    // 5. Check if user with username_token (lookup_token) already exists and deleted_at IS NULL
    let existing_user: Option<(String,)> =
        sqlx::query_as("SELECT id FROM users WHERE username_token = ? AND deleted_at IS NULL")
            .bind(&lookup_token)
            .fetch_optional(&state.pool)
            .await?;

    if existing_user.is_some() {
        return Err(ApiError::Conflict("username_taken".to_string()));
    }

    // 6. OPAQUE start using credential_id bytes
    let opaque_req = RegistrationRequest::<DefaultCipherSuite>::deserialize(&req_bytes)
        .map_err(|e| ApiError::BadRequest(format!("invalid registration request: {e}")))?;

    let result = ServerRegistration::<DefaultCipherSuite>::start(
        &state.opaque_server.setup,
        opaque_req,
        &credential_id[..],
    )
    .map_err(|e| ApiError::BadRequest(format!("OPAQUE registration start failed: {e}")))?;

    // 7. Store correlation state
    let mut rand_bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut rand_bytes);
    let registration_id = URL_SAFE_NO_PAD.encode(rand_bytes);

    let pending = PendingRegistration {
        username_token: lookup_token.clone(),
        credential_id,
        created_at: Instant::now(),
    };

    state
        .registration_store
        .insert(registration_id.clone(), pending);

    // 8. Base64 encode registration_response
    let registration_response_bytes = result.message.serialize();
    let registration_response = STANDARD.encode(registration_response_bytes);

    Ok(Json(RegisterStartResponse {
        registration_id,
        registration_response,
    }))
}

pub async fn register_finish(
    State(state): State<AppState>,
    body_val: Json<serde_json::Value>,
) -> Result<Json<RegisterFinishResponse>, ApiError> {
    let obj = body_val
        .as_object()
        .ok_or_else(|| ApiError::BadRequest("invalid request body".to_string()))?;

    // Token split: raw token field must not be sent to server
    if obj.contains_key("token") {
        return Err(ApiError::BadRequest("token_not_accepted".to_string()));
    }

    let body: RegisterFinishRequest = serde_json::from_value(body_val.0)
        .map_err(|e| ApiError::BadRequest(format!("invalid json body: {e}")))?;
    // 1. Take pending registration from store
    let pending = state
        .registration_store
        .take(&body.registration_id)
        .ok_or_else(|| ApiError::BadRequest("unknown_registration_id".to_string()))?;

    // 2. Validate ALTCHA
    validate_altcha(&state.altcha_config, body.altcha.as_deref())?;

    // 3. Validate encrypted_display if present
    let encrypted_display = if let Some(ref disp) = body.encrypted_display {
        let trimmed = disp.trim();
        if trimmed.is_empty() {
            None
        } else {
            if validate_encrypted_display(trimmed).is_err() {
                return Err(ApiError::BadRequest(
                    "invalid_encrypted_display".to_string(),
                ));
            }
            Some(trimmed.to_string())
        }
    } else {
        None
    };

    // 4. Decode registration upload bytes
    let upload_bytes = decode_base64(&body.registration_upload)?;

    // 5. Deserialize RegistrationUpload
    let upload = RegistrationUpload::<DefaultCipherSuite>::deserialize(&upload_bytes)
        .map_err(|e| ApiError::BadRequest(format!("invalid registration upload: {e}")))?;

    // 6. OPAQUE finish
    let server_registration = ServerRegistration::<DefaultCipherSuite>::finish(upload);
    let opaque_registration_bytes = server_registration.serialize().to_vec();

    // Check user count to determine bootstrap/owner state
    let user_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users")
        .fetch_one(&state.pool)
        .await?;

    let is_owner = user_count == 0;

    if !is_owner {
        // Invite required
        let invite_code = body
            .invite_code
            .as_deref()
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .ok_or_else(|| ApiError::Forbidden("invalid or expired invite".to_string()))?;

        // Validate and consume invite using the invite module
        invites::validate_and_consume_invite(&state.pool, invite_code)
            .await
            .map_err(|e| match e {
                InviteError::NotFound
                | InviteError::Revoked
                | InviteError::Expired
                | InviteError::Exhausted => {
                    ApiError::Forbidden("invalid or expired invite".to_string())
                }
                InviteError::Database(err) => ApiError::Internal(err.into()),
                InviteError::CodeGenerationFailed => {
                    ApiError::Internal(anyhow::anyhow!("code generation failed"))
                }
            })?;
    }

    // 7. Begin DB Transaction for user creation
    let mut tx = state.pool.begin().await?;

    // Generate user_id (16 random bytes -> 22 char base64url string)
    let mut id_bytes = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut id_bytes);
    let user_id = URL_SAFE_NO_PAD.encode(id_bytes);

    let initial_identity_pubkey = "";

    // Insert user into DB
    sqlx::query(
        r#"
        INSERT INTO users (id, username_token, encrypted_display, opaque_registration, identity_pubkey, profile_version)
        VALUES (?, ?, ?, ?, ?, 1)
        "#,
    )
    .bind(&user_id)
    .bind(&pending.username_token)
    .bind(&encrypted_display)
    .bind(&opaque_registration_bytes)
    .bind(initial_identity_pubkey)
    .execute(&mut *tx)
    .await?;

    // Append leaf to Key Transparency log if enabled
    if state.config.key_transparency_enabled {
        sqlx::query(
            r#"
            INSERT INTO key_transparency_log (user_id, username_token, identity_pubkey)
            VALUES (?, ?, ?)
            "#,
        )
        .bind(&user_id)
        .bind(&pending.username_token)
        .bind(initial_identity_pubkey)
        .execute(&mut *tx)
        .await?;
    }

    if is_owner {
        let owner_role: Option<(String,)> =
            sqlx::query_as("SELECT id FROM roles WHERE name = 'owner'")
                .fetch_optional(&mut *tx)
                .await?;

        if let Some((role_id,)) = owner_role {
            sqlx::query("INSERT OR IGNORE INTO user_roles (user_id, role_id, granted_by) VALUES (?, ?, NULL)")
                .bind(&user_id)
                .bind(&role_id)
                .execute(&mut *tx)
                .await?;
            info!("bootstrap: user {} assigned owner role", user_id);
        }
    }

    tx.commit().await?;

    if is_owner {
        let _ = crate::audit::log(
            &state.pool,
            None,
            crate::audit::action::BOOTSTRAP_OWNER,
            Some("user"),
            Some(&user_id),
            None,
        )
        .await;
    }

    Ok(Json(RegisterFinishResponse {
        user_id,
        username_token: pending.username_token,
        is_owner,
    }))
}
