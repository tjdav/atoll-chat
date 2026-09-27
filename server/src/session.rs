use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use rand::RngCore;
use sha2::{Digest, Sha256};
use sqlx::SqlitePool;
use tracing::warn;

#[derive(Debug, Clone)]
pub struct SessionToken {
    pub raw: String,
    pub hash: String,
}

#[derive(Debug, Clone)]
pub struct SessionContext {
    pub session_id: String,
    pub user_id: String,
    pub device_id: Option<String>,
    pub expires_at: String,
}

#[derive(thiserror::Error, Debug)]
pub enum SessionError {
    #[error("Database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("Token generation error: {0}")]
    TokenGeneration(String),
}

pub fn generate_session_token() -> SessionToken {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    let raw = URL_SAFE_NO_PAD.encode(bytes);

    let mut hasher = Sha256::new();
    hasher.update(raw.as_bytes());
    let hash = hex::encode(hasher.finalize());

    SessionToken { raw, hash }
}

pub async fn create_session(
    pool: &SqlitePool,
    user_id: &str,
    device_id: Option<&str>,
    expiry_days: u32,
) -> Result<SessionToken, SessionError> {
    let token = generate_session_token();

    let mut id_bytes = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut id_bytes);
    let session_id = URL_SAFE_NO_PAD.encode(id_bytes);

    let expiry_modifier = format!("+{} days", expiry_days);

    sqlx::query(
        r#"
        INSERT INTO sessions (id, user_id, device_id, token_hash, expires_at)
        VALUES (?, ?, ?, ?, datetime('now', ?))
        "#,
    )
    .bind(&session_id)
    .bind(user_id)
    .bind(device_id)
    .bind(&token.hash)
    .bind(&expiry_modifier)
    .execute(pool)
    .await?;

    Ok(token)
}

pub async fn validate_session(
    pool: &SqlitePool,
    raw_token: &str,
) -> Result<Option<SessionContext>, SessionError> {
    let mut hasher = Sha256::new();
    hasher.update(raw_token.as_bytes());
    let token_hash = hex::encode(hasher.finalize());

    let row: Option<(String, String, Option<String>, String)> = sqlx::query_as(
        r#"
        SELECT id, user_id, device_id, expires_at
        FROM sessions
        WHERE token_hash = ?
          AND revoked_at IS NULL
          AND expires_at > CURRENT_TIMESTAMP
        "#,
    )
    .bind(&token_hash)
    .fetch_optional(pool)
    .await?;

    let (session_id, user_id, device_id, expires_at) = match row {
        Some(r) => r,
        None => return Ok(None),
    };

    // Sliding expiry check
    let sliding = std::env::var("SESSION_SLIDING")
        .map(|v| v.trim().eq_ignore_ascii_case("true") || v.trim() == "1")
        .unwrap_or(true);

    if sliding {
        let expiry_days: u32 = std::env::var("SESSION_EXPIRY_DAYS")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(30);

        let expiry_modifier = format!("+{} days", expiry_days);

        let update_res = sqlx::query(
            r#"
            UPDATE sessions
            SET expires_at = datetime('now', ?)
            WHERE id = ?
            "#,
        )
        .bind(&expiry_modifier)
        .bind(&session_id)
        .execute(pool)
        .await;

        if let Err(e) = update_res {
            warn!(
                "best-effort sliding expiry update failed for session {}: {}",
                session_id, e
            );
        }
    }

    Ok(Some(SessionContext {
        session_id,
        user_id,
        device_id,
        expires_at,
    }))
}
