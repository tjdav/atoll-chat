use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use chrono::{DateTime, Utc};
use rand::RngCore;
use sha2::{Digest, Sha256};
use sqlx::{Row, SqlitePool};
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
    pub created_at: String,
}

#[derive(Debug, Clone)]
pub struct SessionInfo {
    pub id: String,
    pub device_id: Option<String>,
    pub created_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
    pub last_seen_at: Option<DateTime<Utc>>,
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

    let row: Option<(String, String, Option<String>, String, String)> = sqlx::query_as(
        r#"
        SELECT id, user_id, device_id, expires_at, created_at
        FROM sessions
        WHERE token_hash = ?
          AND revoked_at IS NULL
          AND expires_at > CURRENT_TIMESTAMP
        "#,
    )
    .bind(&token_hash)
    .fetch_optional(pool)
    .await?;

    let (session_id, user_id, device_id, expires_at, created_at) = match row {
        Some(r) => r,
        None => return Ok(None),
    };

    // Update last_seen_at best-effort on successful validation
    let update_last_seen = sqlx::query(
        r#"
        UPDATE sessions
        SET last_seen_at = CURRENT_TIMESTAMP
        WHERE id = ?
        "#,
    )
    .bind(&session_id)
    .execute(pool)
    .await;

    if let Err(e) = update_last_seen {
        warn!(
            "best-effort last_seen_at update failed for session {}: {}",
            session_id, e
        );
    }

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
        created_at,
    }))
}

pub async fn list_sessions(
    pool: &SqlitePool,
    user_id: &str,
) -> Result<Vec<SessionInfo>, SessionError> {
    let rows = sqlx::query(
        r#"
        SELECT id, device_id, created_at, expires_at, last_seen_at
        FROM sessions
        WHERE user_id = ?
          AND revoked_at IS NULL
          AND expires_at > CURRENT_TIMESTAMP
        ORDER BY created_at DESC
        "#,
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?;

    let mut sessions = Vec::with_capacity(rows.len());
    for row in rows {
        let id: String = row.get("id");
        let device_id: Option<String> = row.get("device_id");
        let created_at: DateTime<Utc> = row.get("created_at");
        let expires_at: DateTime<Utc> = row.get("expires_at");
        let last_seen_at: Option<DateTime<Utc>> = row.get("last_seen_at");

        sessions.push(SessionInfo {
            id,
            device_id,
            created_at,
            expires_at,
            last_seen_at,
        });
    }

    Ok(sessions)
}

pub async fn revoke_session(
    pool: &SqlitePool,
    user_id: &str,
    session_id: &str,
) -> Result<bool, SessionError> {
    let res = sqlx::query(
        r#"
        UPDATE sessions
        SET revoked_at = CURRENT_TIMESTAMP
        WHERE id = ? AND user_id = ? AND revoked_at IS NULL
        "#,
    )
    .bind(session_id)
    .bind(user_id)
    .execute(pool)
    .await?;

    Ok(res.rows_affected() > 0)
}

pub async fn revoke_all_sessions(
    pool: &SqlitePool,
    user_id: &str,
    except_session_id: Option<&str>,
) -> Result<u64, SessionError> {
    let res = if let Some(except_id) = except_session_id {
        sqlx::query(
            r#"
            UPDATE sessions
            SET revoked_at = CURRENT_TIMESTAMP
            WHERE user_id = ? AND id != ? AND revoked_at IS NULL
            "#,
        )
        .bind(user_id)
        .bind(except_id)
        .execute(pool)
        .await?
    } else {
        sqlx::query(
            r#"
            UPDATE sessions
            SET revoked_at = CURRENT_TIMESTAMP
            WHERE user_id = ? AND revoked_at IS NULL
            "#,
        )
        .bind(user_id)
        .execute(pool)
        .await?
    };

    Ok(res.rows_affected())
}
