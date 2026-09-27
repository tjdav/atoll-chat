use crate::config::Config;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use chrono::{DateTime, Duration, Utc};
use rand::distributions::Slice;
use rand::Rng;
use rand::RngCore;
use sqlx::{Row, SqlitePool};

const CROCKFORD_ALPHABET: &[u8] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";

#[derive(Debug, Clone)]
pub struct ServerInvite {
    pub id: String,
    pub code: String,
    pub created_by: Option<String>,
    pub max_uses: i64,
    pub current_uses: i64,
    pub expires_at: Option<DateTime<Utc>>,
    pub revoked_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Default)]
pub struct CreateInviteOptions {
    pub max_uses: Option<i64>,
    pub expires_in_days: Option<i64>,
}

#[derive(Debug, Clone)]
pub struct ConsumedInvite {
    pub invite: ServerInvite,
}

#[derive(thiserror::Error, Debug)]
pub enum InviteError {
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("invite not found")]
    NotFound,
    #[error("invite revoked")]
    Revoked,
    #[error("invite expired")]
    Expired,
    #[error("invite exhausted")]
    Exhausted,
    #[error("failed to generate unique invite code")]
    CodeGenerationFailed,
}

pub fn generate_code(length: usize) -> String {
    let mut rng = rand::rngs::OsRng;
    let dist = Slice::new(CROCKFORD_ALPHABET).expect("alphabet not empty");
    (0..length).map(|_| *rng.sample(dist) as char).collect()
}

pub fn generate_invite_id() -> String {
    let mut rand_bytes = [0u8; 16];
    rand::rngs::OsRng.fill_bytes(&mut rand_bytes);
    format!("inv_{}", URL_SAFE_NO_PAD.encode(rand_bytes))
}

pub async fn create_invite(
    pool: &SqlitePool,
    created_by: &str,
    options: CreateInviteOptions,
    config: &Config,
) -> Result<ServerInvite, InviteError> {
    let max_uses = match options.max_uses {
        Some(n) if n >= 0 => n,
        _ => config.invite_default_uses,
    };

    let now = Utc::now();
    let expires_at = match options.expires_in_days {
        Some(0) => None,
        Some(n) if n > 0 => Some(now + Duration::days(n)),
        _ => {
            if config.invite_expiry_days > 0 {
                Some(now + Duration::days(config.invite_expiry_days))
            } else {
                None
            }
        }
    };

    let invite_id = generate_invite_id();

    let mut attempts = 0;
    while attempts < 5 {
        attempts += 1;
        let code = generate_code(config.invite_code_length);

        let res = sqlx::query(
            r#"
            INSERT INTO server_invites (id, code, created_by, max_uses, current_uses, expires_at, created_at)
            VALUES (?, ?, ?, ?, 0, ?, ?)
            "#,
        )
        .bind(&invite_id)
        .bind(&code)
        .bind(created_by)
        .bind(max_uses)
        .bind(expires_at)
        .bind(now)
        .execute(pool)
        .await;

        match res {
            Ok(_) => {
                return Ok(ServerInvite {
                    id: invite_id,
                    code,
                    created_by: Some(created_by.to_string()),
                    max_uses,
                    current_uses: 0,
                    expires_at,
                    revoked_at: None,
                    created_at: now,
                });
            }
            Err(sqlx::Error::Database(db_err)) if db_err.is_unique_violation() => {
                continue;
            }
            Err(e) => return Err(InviteError::Database(e)),
        }
    }

    Err(InviteError::CodeGenerationFailed)
}

pub async fn list_invites(
    pool: &SqlitePool,
    include_revoked: bool,
) -> Result<Vec<ServerInvite>, InviteError> {
    let rows = if include_revoked {
        sqlx::query(
            r#"
            SELECT id, code, created_by, max_uses, current_uses, expires_at, revoked_at, created_at
            FROM server_invites
            ORDER BY created_at DESC
            "#,
        )
        .fetch_all(pool)
        .await?
    } else {
        sqlx::query(
            r#"
            SELECT id, code, created_by, max_uses, current_uses, expires_at, revoked_at, created_at
            FROM server_invites
            WHERE revoked_at IS NULL
            ORDER BY created_at DESC
            "#,
        )
        .fetch_all(pool)
        .await?
    };

    let invites = rows
        .into_iter()
        .map(|row| ServerInvite {
            id: row.get("id"),
            code: row.get("code"),
            created_by: row.get("created_by"),
            max_uses: row.get("max_uses"),
            current_uses: row.get("current_uses"),
            expires_at: row.get("expires_at"),
            revoked_at: row.get("revoked_at"),
            created_at: row.get("created_at"),
        })
        .collect();

    Ok(invites)
}

pub async fn get_invite_by_id(
    pool: &SqlitePool,
    id: &str,
) -> Result<Option<ServerInvite>, InviteError> {
    let row = sqlx::query(
        r#"
        SELECT id, code, created_by, max_uses, current_uses, expires_at, revoked_at, created_at
        FROM server_invites
        WHERE id = ?
        "#,
    )
    .bind(id)
    .fetch_optional(pool)
    .await?;

    Ok(row.map(|row| ServerInvite {
        id: row.get("id"),
        code: row.get("code"),
        created_by: row.get("created_by"),
        max_uses: row.get("max_uses"),
        current_uses: row.get("current_uses"),
        expires_at: row.get("expires_at"),
        revoked_at: row.get("revoked_at"),
        created_at: row.get("created_at"),
    }))
}

pub async fn revoke_invite(pool: &SqlitePool, id: &str) -> Result<bool, InviteError> {
    let res = sqlx::query(
        r#"
        UPDATE server_invites
        SET revoked_at = CURRENT_TIMESTAMP
        WHERE id = ? AND revoked_at IS NULL
        "#,
    )
    .bind(id)
    .execute(pool)
    .await?;

    Ok(res.rows_affected() > 0)
}

pub async fn validate_and_consume_invite(
    pool: &SqlitePool,
    code: &str,
) -> Result<ConsumedInvite, InviteError> {
    let mut tx = pool.begin().await?;

    let row = sqlx::query(
        r#"
        SELECT id, code, created_by, max_uses, current_uses, expires_at, revoked_at, created_at
        FROM server_invites
        WHERE code = ?
        "#,
    )
    .bind(code)
    .fetch_optional(&mut *tx)
    .await?;

    let row = match row {
        Some(r) => r,
        None => return Err(InviteError::NotFound),
    };

    let invite = ServerInvite {
        id: row.get("id"),
        code: row.get("code"),
        created_by: row.get("created_by"),
        max_uses: row.get("max_uses"),
        current_uses: row.get("current_uses"),
        expires_at: row.get("expires_at"),
        revoked_at: row.get("revoked_at"),
        created_at: row.get("created_at"),
    };

    if invite.revoked_at.is_some() {
        return Err(InviteError::Revoked);
    }

    let now = Utc::now();
    if let Some(exp) = invite.expires_at {
        if exp < now {
            return Err(InviteError::Expired);
        }
    }

    if invite.max_uses > 0 && invite.current_uses >= invite.max_uses {
        return Err(InviteError::Exhausted);
    }

    let updated_uses = invite.current_uses + 1;
    let res = sqlx::query(
        r#"
        UPDATE server_invites
        SET current_uses = ?
        WHERE id = ? AND current_uses = ?
        "#,
    )
    .bind(updated_uses)
    .bind(&invite.id)
    .bind(invite.current_uses)
    .execute(&mut *tx)
    .await?;

    if res.rows_affected() == 0 {
        return Err(InviteError::Exhausted);
    }

    tx.commit().await?;

    let mut consumed_invite = invite;
    consumed_invite.current_uses = updated_uses;

    Ok(ConsumedInvite {
        invite: consumed_invite,
    })
}
