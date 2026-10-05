use crate::error::ApiError;
use crate::identity::{token_bytes, validate_encrypted_device_name, validate_token};
use crate::login::PendingLogin;
use crate::opaque::DefaultCipherSuite;
use crate::roles;
use crate::session;
use crate::sync::device_names::{self, WriteRequest};
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
use serde_json::Value;
use std::time::Instant;

#[derive(Debug, Deserialize)]
pub struct LoginStartRequest {
    pub lookup_token: Option<String>,
    pub username_token: Option<String>,
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
    pub encrypted_device_name: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct LoginFinishResponse {
    pub session_token: String,
    pub user_id: String,
    pub username_token: String,
    pub encrypted_display: Option<String>,
    pub device_id: String,
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
    body_val: Json<serde_json::Value>,
) -> Result<Json<LoginStartResponse>, ApiError> {
    let obj = body_val
        .as_object()
        .ok_or_else(|| ApiError::BadRequest("invalid request body".to_string()))?;

    // Token split: raw token field must not be sent to server
    if obj.contains_key("token") {
        return Err(ApiError::BadRequest("token_not_accepted".to_string()));
    }

    let body: LoginStartRequest = serde_json::from_value(body_val.0)
        .map_err(|e| ApiError::BadRequest(format!("invalid json body: {e}")))?;

    // 1. Validate lookup_token format
    let lookup_token = match body.lookup_token.or(body.username_token) {
        Some(ref tok) if !tok.trim().is_empty() => tok.trim().to_string(),
        _ => return Err(ApiError::Unauthorized("invalid_credentials".to_string())),
    };

    if validate_token(&lookup_token).is_err() {
        return Err(ApiError::Unauthorized("invalid_credentials".to_string()));
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

    // 4. Extract credential_id
    let credential_id = match token_bytes(&lookup_token) {
        Ok(bytes) => bytes,
        Err(_) => return Err(ApiError::Unauthorized("invalid_credentials".to_string())),
    };

    // 5. Query user by username_token (lookup_token)
    #[derive(sqlx::FromRow)]
    struct LoginUserRow {
        id: String,
        opaque_registration: Vec<u8>,
        disabled_at: Option<String>,
        deleted_at: Option<String>,
        requires_reregistration: Option<i64>,
        encrypted_display: Option<String>,
    }

    let user_row: Option<LoginUserRow> = sqlx::query_as(
        "SELECT id, opaque_registration, disabled_at, deleted_at, requires_reregistration, encrypted_display FROM users WHERE username_token = ?",
    )
    .bind(&lookup_token)
    .fetch_optional(&state.pool)
    .await?;

    let (user_id, password_file, encrypted_display) = match user_row {
        Some(user) => {
            if user.disabled_at.is_some() {
                return Err(ApiError::Unauthorized("account_disabled".to_string()));
            }
            if user.deleted_at.is_some() {
                let mut rand_bytes = [0u8; 16];
                rand::thread_rng().fill_bytes(&mut rand_bytes);
                (
                    format!("dummy_{}", URL_SAFE_NO_PAD.encode(rand_bytes)),
                    None,
                    None,
                )
            } else if user.requires_reregistration.unwrap_or(0) == 1 {
                return Err(ApiError::InternalWithDetails(
                    StatusCode::CONFLICT,
                    "reregistration_required".to_string(),
                    serde_json::json!({
                        "message": "This account must re-register. The server's OPRF key was rotated."
                    }),
                ));
            } else {
                let pwd_file = ServerRegistration::<DefaultCipherSuite>::deserialize(
                    &user.opaque_registration,
                )
                .map_err(|e| {
                    tracing::error!(
                        "Failed to deserialize opaque_registration for user {}: {}",
                        user.id,
                        e
                    );
                    ApiError::InternalCustom(
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "registration_corrupted".to_string(),
                    )
                })?;
                (user.id, Some(pwd_file), user.encrypted_display)
            }
        }
        None => {
            let mut rand_bytes = [0u8; 16];
            rand::thread_rng().fill_bytes(&mut rand_bytes);
            (
                format!("dummy_{}", URL_SAFE_NO_PAD.encode(rand_bytes)),
                None,
                None,
            )
        }
    };

    // 7. Deserialize credential_request and run ServerLogin::start using credential_id bytes
    let credential_request = CredentialRequest::<DefaultCipherSuite>::deserialize(&req_bytes)
        .map_err(|_| ApiError::Unauthorized("invalid_credentials".to_string()))?;

    let mut rng = OsRng;
    let start_result = ServerLogin::<DefaultCipherSuite>::start(
        &mut rng,
        &state.opaque_server.setup,
        password_file,
        credential_request,
        &credential_id[..],
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
        username_token: lookup_token,
        encrypted_display,
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
    body_val: Json<Value>,
) -> Result<Json<LoginFinishResponse>, ApiError> {
    let obj = body_val
        .as_object()
        .ok_or_else(|| ApiError::BadRequest("invalid request body".to_string()))?;

    // Token split: raw token field must not be sent to server
    if obj.contains_key("token") {
        return Err(ApiError::BadRequest("token_not_accepted".to_string()));
    }

    // Check if legacy field device_name is present
    if obj.contains_key("device_name") {
        return Err(ApiError::InternalWithDetails(
            StatusCode::BAD_REQUEST,
            "field_renamed".to_string(),
            serde_json::json!({
                "old": "device_name",
                "new": "encrypted_device_name"
            }),
        ));
    }

    let body: LoginFinishRequest = serde_json::from_value(body_val.0)
        .map_err(|e| ApiError::BadRequest(format!("invalid json body: {e}")))?;

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

    if pending.user_id.starts_with("dummy_") {
        return Err(ApiError::Unauthorized("invalid_credentials".to_string()));
    }

    // 5. Query user info
    let stored_identity_pubkey: String =
        sqlx::query_scalar("SELECT identity_pubkey FROM users WHERE id = ?")
            .bind(&pending.user_id)
            .fetch_one(&state.pool)
            .await?;

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

    // 7. Validate encrypted_device_name if provided
    let clean_encrypted_device_name = match body.encrypted_device_name {
        Some(ref name) => {
            let trimmed = name.trim();
            if trimmed.is_empty() {
                None
            } else {
                if validate_encrypted_device_name(trimmed).is_err() {
                    return Err(ApiError::BadRequest(
                        "invalid_encrypted_device_name".to_string(),
                    ));
                }
                Some(trimmed.to_string())
            }
        }
        None => None,
    };

    // 8. Look up or create device
    let existing_device =
        crate::devices::find_by_client_id(&state.pool, &pending.user_id, &pending.client_id)
            .await?;

    let device_id = match existing_device {
        Some(dev) => {
            let _ = crate::devices::touch_last_seen(&state.pool, &dev.id).await;
            dev.id
        }
        None => {
            let count = crate::devices::count_devices(&state.pool, &pending.user_id).await?;
            if count >= state.config.server_max_devices_per_user {
                return Err(ApiError::BadRequest("device_limit_exceeded".to_string()));
            }
            let new_dev =
                crate::devices::create_device(&state.pool, &pending.user_id, &pending.client_id)
                    .await?;
            new_dev.id
        }
    };

    // 9. Write encrypted_device_name if provided and changed
    if let Some(enc_name) = clean_encrypted_device_name {
        let existing_name: Option<String> = sqlx::query_scalar(
            "SELECT encrypted_device_name FROM device_names WHERE user_id = ? AND device_id = ?",
        )
        .bind(&pending.user_id)
        .bind(&device_id)
        .fetch_optional(&state.pool)
        .await
        .unwrap_or(None);

        if existing_name.as_deref() != Some(&enc_name) {
            let res = device_names::write_device_name(
                &state.pool,
                &state.publisher,
                WriteRequest {
                    user_id: pending.user_id.clone(),
                    device_id: device_id.clone(),
                    encrypted_device_name: enc_name,
                },
            )
            .await;

            if let Err(e) = res {
                tracing::warn!(
                    "Failed to write encrypted device name for user {} device {}: {}",
                    pending.user_id,
                    device_id,
                    e
                );
            }
        }
    }

    // 10. Create session
    let token = session::create_session(
        &state.pool,
        &pending.user_id,
        Some(&device_id),
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
        username_token: pending.username_token,
        encrypted_display: pending.encrypted_display,
        device_id,
        is_owner,
        expires_at,
    }))
}
