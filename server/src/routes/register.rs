use crate::altcha::{verify_altcha_payload, AltchaConfig};
use crate::error::ApiError;
use crate::opaque::DefaultCipherSuite;
use crate::registration::PendingRegistration;
use crate::AppState;
use axum::{extract::State, Json};
use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use base64::Engine;
use opaque_ke::{RegistrationRequest, RegistrationUpload, ServerRegistration};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::time::Instant;
use tracing::info;

#[derive(Debug, Deserialize)]
pub struct RegisterStartRequest {
    pub username: String,
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
    pub altcha: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct RegisterFinishResponse {
    pub user_id: String,
    pub username: String,
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
    Json(body): Json<RegisterStartRequest>,
) -> Result<Json<RegisterStartResponse>, ApiError> {
    // 0. Validate ALTCHA
    validate_altcha(&state.altcha_config, body.altcha.as_deref())?;

    // 1. Validate username
    let username = body.username.trim();
    if username.len() < 3
        || username.len() > 32
        || !username
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        return Err(ApiError::BadRequest(
            "username must be 3-32 characters (alphanumeric, underscore, dash)".to_string(),
        ));
    }

    // 2. Validate registration_request
    let req_bytes = decode_base64(&body.registration_request)?;
    if req_bytes.is_empty() {
        return Err(ApiError::BadRequest(
            "registration_request cannot be empty".to_string(),
        ));
    }

    // 3. Compute username_hash
    let normalized = username.to_lowercase();
    let mut hasher = Sha256::new();
    hasher.update(b"username-v1:");
    hasher.update(normalized.as_bytes());
    let username_hash = hex::encode(hasher.finalize());

    // 4. Check if user with username_hash already exists
    let existing_user: Option<(String,)> =
        sqlx::query_as("SELECT id FROM users WHERE username_hash = ?")
            .bind(&username_hash)
            .fetch_optional(&state.pool)
            .await?;

    if existing_user.is_some() {
        return Err(ApiError::Conflict("username taken".to_string()));
    }

    // 5. OPAQUE start
    let opaque_req = RegistrationRequest::<DefaultCipherSuite>::deserialize(&req_bytes)
        .map_err(|e| ApiError::BadRequest(format!("invalid registration request: {e}")))?;

    let result = ServerRegistration::<DefaultCipherSuite>::start(
        &state.opaque_server.setup,
        opaque_req,
        username_hash.as_bytes(),
    )
    .map_err(|e| ApiError::BadRequest(format!("OPAQUE registration start failed: {e}")))?;

    // 6. Correlation state
    let mut rand_bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut rand_bytes);
    let registration_id = URL_SAFE_NO_PAD.encode(rand_bytes);

    let pending = PendingRegistration {
        username: username.to_string(),
        username_hash,
        created_at: Instant::now(),
    };

    state
        .registration_store
        .insert(registration_id.clone(), pending);

    // 7. Base64 encode registration_response
    let registration_response_bytes = result.message.serialize();
    let registration_response = STANDARD.encode(registration_response_bytes);

    Ok(Json(RegisterStartResponse {
        registration_id,
        registration_response,
    }))
}

pub async fn register_finish(
    State(state): State<AppState>,
    Json(body): Json<RegisterFinishRequest>,
) -> Result<Json<RegisterFinishResponse>, ApiError> {
    // 0. Validate ALTCHA
    validate_altcha(&state.altcha_config, body.altcha.as_deref())?;

    // 1. Take pending registration from store
    let pending = state
        .registration_store
        .take(&body.registration_id)
        .ok_or_else(|| ApiError::BadRequest("unknown or expired registration_id".to_string()))?;

    // 2. Decode registration upload bytes
    let upload_bytes = decode_base64(&body.registration_upload)?;

    // 3. Deserialize RegistrationUpload
    let upload = RegistrationUpload::<DefaultCipherSuite>::deserialize(&upload_bytes)
        .map_err(|e| ApiError::BadRequest(format!("invalid registration upload: {e}")))?;

    // 4. OPAQUE finish
    let server_registration = ServerRegistration::<DefaultCipherSuite>::finish(upload);
    let opaque_registration_bytes = server_registration.serialize().to_vec();

    // 5. Begin DB Transaction
    let mut tx = state.pool.begin().await?;

    // Check if any users exist inside transaction
    let user_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users")
        .fetch_one(&mut *tx)
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

        // Validate and increment invite atomically
        let updated = sqlx::query(
            r#"
            UPDATE server_invites
            SET current_uses = current_uses + 1
            WHERE code = ?
              AND revoked_at IS NULL
              AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
              AND (max_uses = 0 OR current_uses < max_uses)
            "#,
        )
        .bind(invite_code)
        .execute(&mut *tx)
        .await?;

        if updated.rows_affected() == 0 {
            return Err(ApiError::Forbidden("invalid or expired invite".to_string()));
        }
    }

    // Generate user_id (16 random bytes -> 22 char base64url string)
    let mut id_bytes = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut id_bytes);
    let user_id = URL_SAFE_NO_PAD.encode(id_bytes);

    // Insert user into DB
    sqlx::query(
        r#"
        INSERT INTO users (id, username, username_hash, opaque_registration, identity_pubkey, profile_version)
        VALUES (?, ?, ?, ?, '', 1)
        "#,
    )
    .bind(&user_id)
    .bind(&pending.username)
    .bind(&pending.username_hash)
    .bind(&opaque_registration_bytes)
    .execute(&mut *tx)
    .await?;

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

    Ok(Json(RegisterFinishResponse {
        user_id,
        username: pending.username,
        is_owner,
    }))
}
