use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use chrono::{DateTime, Duration, Utc};
use rand::distributions::Slice;
use rand::Rng;
use rand::RngCore;
use serde::Serialize;
use sqlx::{Row, SqlitePool};

use crate::config::Config;
use crate::limits::{InstanceLimits, ServerHardMax};

const CROCKFORD_ALPHABET: &[u8] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";

#[derive(Debug, Clone, Serialize)]
pub struct RoomInvite {
    pub id: String,
    pub code: String,
    pub created_by: String,
    pub max_uses: i64,
    pub current_uses: i64,
    pub expires_at: Option<DateTime<Utc>>,
    pub revoked_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize)]
pub struct RoomInviteView {
    pub id: String,
    pub max_uses: i64,
    pub current_uses: i64,
    pub expires_at: Option<DateTime<Utc>>,
    pub revoked_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub created_by: String,
}

#[derive(Debug, Clone, Default)]
pub struct CreateRoomInviteOptions {
    pub max_uses: Option<i64>,
    pub expires_in_days: Option<i64>,
}

#[derive(Debug, Clone)]
pub enum RedeemOutcome {
    Joined {
        room_id: String,
        member_role: String,
    },
    AlreadyMember {
        room_id: String,
        member_role: String,
    },
}

#[derive(Debug, thiserror::Error)]
pub enum RoomInviteError {
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("room not found")]
    RoomNotFound,
    #[error("not a member")]
    NotAMember,
    #[error("invite not found")]
    InviteNotFound,
    #[error("invite revoked")]
    Revoked,
    #[error("invite expired")]
    Expired,
    #[error("invite exhausted")]
    Exhausted,
    #[error("room is full")]
    RoomFull,
    #[error("invalid max_uses value")]
    InvalidMaxUses,
    #[error("invalid expiry value")]
    InvalidExpiry,
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
    format!("rm_inv_{}", URL_SAFE_NO_PAD.encode(rand_bytes))
}

pub async fn create_room_invite(
    pool: &SqlitePool,
    room_id: &str,
    requester_id: &str,
    options: CreateRoomInviteOptions,
    config: &Config,
) -> Result<RoomInvite, RoomInviteError> {
    let mut tx = pool.begin().await?;

    // 1. Verify room exists
    let room_exists: Option<(i32,)> = sqlx::query_as("SELECT 1 FROM rooms WHERE id = ?")
        .bind(room_id)
        .fetch_optional(&mut *tx)
        .await?;

    if room_exists.is_none() {
        return Err(RoomInviteError::RoomNotFound);
    }

    // 2. Verify requester is a member of the room
    let member_role: Option<(String,)> =
        sqlx::query_as("SELECT role FROM room_members WHERE room_id = ? AND user_id = ?")
            .bind(room_id)
            .bind(requester_id)
            .fetch_optional(&mut *tx)
            .await?;

    if member_role.is_none() {
        return Err(RoomInviteError::NotAMember);
    }

    // 3. Determine max_uses
    let max_uses = match options.max_uses {
        Some(n) if (0..=10000).contains(&n) => n,
        Some(_) => return Err(RoomInviteError::InvalidMaxUses),
        None => config.room_invite_default_uses,
    };

    // 4. Determine expires_at
    let now = Utc::now();
    let expires_at = match options.expires_in_days {
        Some(0) => None,
        Some(n) if (1..=365).contains(&n) => Some(now + Duration::days(n)),
        Some(_) => return Err(RoomInviteError::InvalidExpiry),
        None => None,
    };

    // 5. Generate code and insert
    let invite_id = generate_invite_id();

    let mut attempts = 0;
    while attempts < 5 {
        attempts += 1;
        let code = generate_code(config.room_invite_code_length);

        let res = sqlx::query(
            r#"
            INSERT INTO room_invites (id, room_id, code, created_by, max_uses, current_uses, expires_at, created_at)
            VALUES (?, ?, ?, ?, ?, 0, ?, ?)
            "#,
        )
        .bind(&invite_id)
        .bind(room_id)
        .bind(&code)
        .bind(requester_id)
        .bind(max_uses)
        .bind(expires_at)
        .bind(now)
        .execute(&mut *tx)
        .await;

        match res {
            Ok(_) => {
                tx.commit().await?;
                return Ok(RoomInvite {
                    id: invite_id,
                    code,
                    created_by: requester_id.to_string(),
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
            Err(e) => return Err(RoomInviteError::Database(e)),
        }
    }

    Err(RoomInviteError::CodeGenerationFailed)
}

pub async fn list_room_invites(
    pool: &SqlitePool,
    room_id: &str,
    requester_id: &str,
    include_revoked: bool,
) -> Result<Vec<RoomInviteView>, RoomInviteError> {
    // 1. Verify room exists
    let room_exists: Option<(i32,)> = sqlx::query_as("SELECT 1 FROM rooms WHERE id = ?")
        .bind(room_id)
        .fetch_optional(pool)
        .await?;

    if room_exists.is_none() {
        return Err(RoomInviteError::RoomNotFound);
    }

    // 2. Verify requester is a member of the room
    let member_role: Option<(String,)> =
        sqlx::query_as("SELECT role FROM room_members WHERE room_id = ? AND user_id = ?")
            .bind(room_id)
            .bind(requester_id)
            .fetch_optional(pool)
            .await?;

    if member_role.is_none() {
        return Err(RoomInviteError::NotAMember);
    }

    // 3. Query invites
    let rows = if include_revoked {
        sqlx::query(
            r#"
            SELECT id, max_uses, current_uses, expires_at, revoked_at, created_at, created_by
            FROM room_invites
            WHERE room_id = ?
            ORDER BY created_at DESC
            "#,
        )
        .bind(room_id)
        .fetch_all(pool)
        .await?
    } else {
        sqlx::query(
            r#"
            SELECT id, max_uses, current_uses, expires_at, revoked_at, created_at, created_by
            FROM room_invites
            WHERE room_id = ? AND revoked_at IS NULL
            ORDER BY created_at DESC
            "#,
        )
        .bind(room_id)
        .fetch_all(pool)
        .await?
    };

    let views = rows
        .into_iter()
        .map(|row| RoomInviteView {
            id: row.get("id"),
            max_uses: row.get("max_uses"),
            current_uses: row.get("current_uses"),
            expires_at: row.get("expires_at"),
            revoked_at: row.get("revoked_at"),
            created_at: row.get("created_at"),
            created_by: row.get("created_by"),
        })
        .collect();

    Ok(views)
}

pub async fn revoke_room_invite(
    pool: &SqlitePool,
    room_id: &str,
    invite_id: &str,
    requester_id: &str,
) -> Result<(), RoomInviteError> {
    let mut tx = pool.begin().await?;

    // 1. Verify room exists
    let room_exists: Option<(i32,)> = sqlx::query_as("SELECT 1 FROM rooms WHERE id = ?")
        .bind(room_id)
        .fetch_optional(&mut *tx)
        .await?;

    if room_exists.is_none() {
        return Err(RoomInviteError::RoomNotFound);
    }

    // 2. Verify requester is a member of the room
    let member_role: Option<(String,)> =
        sqlx::query_as("SELECT role FROM room_members WHERE room_id = ? AND user_id = ?")
            .bind(room_id)
            .bind(requester_id)
            .fetch_optional(&mut *tx)
            .await?;

    if member_role.is_none() {
        return Err(RoomInviteError::NotAMember);
    }

    // 3. Look up invite by (room_id, invite_id)
    let invite_row: Option<(Option<DateTime<Utc>>,)> =
        sqlx::query_as("SELECT revoked_at FROM room_invites WHERE room_id = ? AND id = ?")
            .bind(room_id)
            .bind(invite_id)
            .fetch_optional(&mut *tx)
            .await?;

    let revoked_at = match invite_row {
        Some((rev,)) => rev,
        None => return Err(RoomInviteError::InviteNotFound),
    };

    if revoked_at.is_some() {
        return Err(RoomInviteError::InviteNotFound);
    }

    // 4. Update revoked_at
    sqlx::query(
        "UPDATE room_invites SET revoked_at = CURRENT_TIMESTAMP WHERE room_id = ? AND id = ? AND revoked_at IS NULL",
    )
    .bind(room_id)
    .bind(invite_id)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;

    Ok(())
}

pub async fn redeem_room_invite(
    pool: &SqlitePool,
    code: &str,
    user_id: &str,
    limits: &InstanceLimits,
    server_max: &ServerHardMax,
) -> Result<RedeemOutcome, RoomInviteError> {
    let mut conn = pool.acquire().await?;
    sqlx::query("BEGIN IMMEDIATE").execute(&mut *conn).await?;

    // Helper macro / function or closure for cleanup on error if needed
    let result = async {
        // 1. Look up invite by code
        let invite_row = sqlx::query(
            r#"
            SELECT id, room_id, max_uses, current_uses, expires_at, revoked_at
            FROM room_invites
            WHERE code = ?
            "#,
        )
        .bind(code)
        .fetch_optional(&mut *conn)
        .await?;

        let row = match invite_row {
            Some(r) => r,
            None => return Err(RoomInviteError::InviteNotFound),
        };

        let invite_id: String = row.get("id");
        let room_id: String = row.get("room_id");
        let max_uses: i64 = row.get("max_uses");
        let current_uses: i64 = row.get("current_uses");
        let expires_at: Option<DateTime<Utc>> = row.get("expires_at");
        let revoked_at: Option<DateTime<Utc>> = row.get("revoked_at");

        // 2. Check revoked_at
        if revoked_at.is_some() {
            return Err(RoomInviteError::Revoked);
        }

        // 3. Check expires_at
        let now = Utc::now();
        if let Some(exp) = expires_at {
            if exp < now {
                return Err(RoomInviteError::Expired);
            }
        }

        // 4. Check max_uses
        if max_uses > 0 && current_uses >= max_uses {
            return Err(RoomInviteError::Exhausted);
        }

        // 5. Check whether user is already a member
        let member_role: Option<(String,)> =
            sqlx::query_as("SELECT role FROM room_members WHERE room_id = ? AND user_id = ?")
                .bind(&room_id)
                .bind(user_id)
                .fetch_optional(&mut *conn)
                .await?;

        if let Some((role,)) = member_role {
            return Ok(RedeemOutcome::AlreadyMember {
                room_id,
                member_role: role,
            });
        }

        // 6. Count current members
        let current_count: (i64,) =
            sqlx::query_as("SELECT COUNT(*) FROM room_members WHERE room_id = ?")
                .bind(&room_id)
                .fetch_one(&mut *conn)
                .await?;

        let effective_max_size = limits.room_size.min(server_max.room_size);
        if current_count.0 >= effective_max_size {
            return Err(RoomInviteError::RoomFull);
        }

        // 7. Insert new member
        sqlx::query(
            r#"
            INSERT INTO room_members (room_id, user_id, role, joined_via)
            VALUES (?, ?, 'member', ?)
            "#,
        )
        .bind(&room_id)
        .bind(user_id)
        .bind(code)
        .execute(&mut *conn)
        .await?;

        // 8. Increment use count
        sqlx::query("UPDATE room_invites SET current_uses = current_uses + 1 WHERE id = ?")
            .bind(&invite_id)
            .execute(&mut *conn)
            .await?;

        Ok(RedeemOutcome::Joined {
            room_id,
            member_role: "member".to_string(),
        })
    }
    .await;

    match result {
        Ok(outcome) => {
            sqlx::query("COMMIT").execute(&mut *conn).await?;
            Ok(outcome)
        }
        Err(err) => {
            sqlx::query("ROLLBACK").execute(&mut *conn).await.ok();
            Err(err)
        }
    }
}
