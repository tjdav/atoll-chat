use crate::error::ApiError;
use crate::login::PendingLogin;
use crate::opaque::DefaultCipherSuite;
use crate::roles;
use crate::session;
use crate::AppState;
use axum::{extract::State, http::StatusCode, Json};
use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use base64::Engine;
use opaque_ke::{
    CredentialFinalization, CredentialRequest, ServerLogin, ServerLoginParameters,
    ServerRegistration,
};
use rand::rngs::OsRng;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::time::Instant;

#[derive(Debug, Deserialize)]
pub struct LoginStartRequest {
    pub username: String,
    pub credential_request: String,
    pub client_id: String,
}

#[derive(Debug, Serialize)]
pub struct LoginStartResponse {
    pub login_id: String,
    pub credential_response: String,
}

#[derive(Debug, Deserialize)]
pub struct LoginFinishRequest {
    pub login_id: String,
    pub credential_finalization: String,
    pub identity_pubkey: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct LoginFinishResponse {
    pub session_token: String,
    pub user_id: String,
    pub username: String,
    pub display_name: Option<String>,
    pub is_owner: bool,
    pub expires_at: String,
}

fn decode_base64(s: &str) -> Result<Vec<u8>, ApiError> {
    STANDARD
        .decode(s)
        .or_else(|_| URL_SAFE_NO_PAD.decode(s))
        .map_err(|_| ApiError::BadRequest("invalid base64 payload".to_string()))
}

pub async fn login_start(
    State(state): State<AppState>,
    Json(body): Json<LoginStartRequest>,
) -> Result<Json<LoginStartResponse>, ApiError> {
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

    // 2. Validate client_id
    let client_id = body.client_id.trim();
    if client_id.len() < 16
        || client_id.len() > 64
        || !client_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        return Err(ApiError::BadRequest(
            "client_id must be 16-64 characters (alphanumeric, underscore, dash)".to_string(),
        ));
    }

    // 3. Decode credential_request
    let req_bytes = decode_base64(&body.credential_request)?;
    if req_bytes.is_empty() {
        return Err(ApiError::BadRequest(
            "credential_request cannot be empty".to_string(),
        ));
    }

    // 4. Compute username_hash
    let normalized = username.to_lowercase();
    let mut hasher = Sha256::new();
    hasher.update(b"username-v1:");
    hasher.update(normalized.as_bytes());
    let username_hash = hex::encode(hasher.finalize());

    // 5. Query user by username_hash
    let user_row: Option<(String, Vec<u8>, Option<String>)> = sqlx::query_as(
        "SELECT id, opaque_registration, disabled_at FROM users WHERE username_hash = ?",
    )
    .bind(&username_hash)
    .fetch_optional(&state.pool)
    .await?;

    let (user_id, opaque_registration_bytes, disabled_at) = match user_row {
        Some(row) => row,
        None => return Err(ApiError::Unauthorized("invalid_credentials".to_string())),
    };

    if disabled_at.is_some() {
        return Err(ApiError::Unauthorized("account_disabled".to_string()));
    }

    // 6. Deserialize stored password file
    let password_file = ServerRegistration::<DefaultCipherSuite>::deserialize(
        &opaque_registration_bytes,
    )
    .map_err(|e| {
        tracing::error!(
            "Failed to deserialize opaque_registration for user {}: {}",
            user_id,
            e
        );
        ApiError::InternalCustom(
            StatusCode::INTERNAL_SERVER_ERROR,
            "registration_corrupted".to_string(),
        )
    })?;

    // 7. Deserialize credential_request and run ServerLogin::start
    let credential_request = CredentialRequest::<DefaultCipherSuite>::deserialize(&req_bytes)
        .map_err(|_| ApiError::Unauthorized("invalid_credentials".to_string()))?;

    let mut rng = OsRng;
    let start_result = ServerLogin::<DefaultCipherSuite>::start(
        &mut rng,
        &state.opaque_server.setup,
        Some(password_file),
        credential_request,
        username_hash.as_bytes(),
        ServerLoginParameters::default(),
    )
    .map_err(|e| {
        tracing::warn!("ServerLogin::start failed for user {}: {}", user_id, e);
        ApiError::Unauthorized("invalid_credentials".to_string())
    })?;

    // 8. Generate login_id and insert PendingLogin
    let mut rand_bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut rand_bytes);
    let login_id = URL_SAFE_NO_PAD.encode(rand_bytes);

    let pending = PendingLogin {
        user_id,
        username_hash,
        client_id: client_id.to_string(),
        server_login_state: start_result.state,
        created_at: Instant::now(),
    };

    state.login_store.insert(login_id.clone(), pending);

    // 9. Base64 encode credential_response
    let credential_response_bytes = start_result.message.serialize();
    let credential_response = STANDARD.encode(credential_response_bytes);

    Ok(Json(LoginStartResponse {
        login_id,
        credential_response,
    }))
}

pub async fn login_finish(
    State(state): State<AppState>,
    Json(body): Json<LoginFinishRequest>,
) -> Result<Json<LoginFinishResponse>, ApiError> {
    // 1. Take pending login
    let pending = state
        .login_store
        .take(&body.login_id)
        .ok_or_else(|| ApiError::BadRequest("unknown or expired login_id".to_string()))?;

    // 2. Decode credential_finalization bytes
    let finalization_bytes = decode_base64(&body.credential_finalization)?;

    // 3. Deserialize CredentialFinalization
    let finalization =
        CredentialFinalization::<DefaultCipherSuite>::deserialize(&finalization_bytes)
            .map_err(|_| ApiError::Unauthorized("invalid_credentials".to_string()))?;

    // 4. Finish server login
    let _server_login_result = pending
        .server_login_state
        .finish(finalization, ServerLoginParameters::default())
        .map_err(|_| ApiError::Unauthorized("invalid_credentials".to_string()))?;

    // 5. Query user info
    let stored_user: (String, String) =
        sqlx::query_as("SELECT username, identity_pubkey FROM users WHERE id = ?")
            .bind(&pending.user_id)
            .fetch_one(&state.pool)
            .await?;

    let (username, stored_identity_pubkey) = stored_user;

    // 6. Handle identity_pubkey
    if let Some(ref pubkey_input) = body.identity_pubkey {
        let pubkey_trimmed = pubkey_input.trim();
        if !pubkey_trimmed.is_empty() {
            let pubkey_bytes = decode_base64(pubkey_trimmed)?;
            if pubkey_bytes.len() != 32 {
                return Err(ApiError::BadRequest("invalid identity_pubkey".to_string()));
            }

            if stored_identity_pubkey.is_empty() {
                sqlx::query("UPDATE users SET identity_pubkey = ? WHERE id = ?")
                    .bind(pubkey_trimmed)
                    .bind(&pending.user_id)
                    .execute(&state.pool)
                    .await?;
            } else if stored_identity_pubkey != pubkey_trimmed {
                tracing::warn!(
                    "identity key mismatch for user {}: stored '{}', provided '{}'",
                    pending.user_id,
                    stored_identity_pubkey,
                    pubkey_trimmed
                );
                return Err(ApiError::BadRequest("identity_key_mismatch".to_string()));
            }
        }
    }

    // 7. Create session
    let token = session::create_session(
        &state.pool,
        &pending.user_id,
        None,
        state.config.session_expiry_days,
    )
    .await?;

    let expires_at: String =
        sqlx::query_scalar("SELECT expires_at FROM sessions WHERE token_hash = ?")
            .bind(&token.hash)
            .fetch_one(&state.pool)
            .await?;

    let is_owner = roles::user_has_permission(&state.pool, &pending.user_id, "*")
        .await
        .unwrap_or(false);

    Ok(Json(LoginFinishResponse {
        session_token: token.raw,
        user_id: pending.user_id,
        username,
        display_name: None,
        is_owner,
        expires_at,
    }))
}
