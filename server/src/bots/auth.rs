use crate::auth::AuthUser;
use sha2::{Digest, Sha256};
use sqlx::{Row, SqlitePool};

#[derive(Clone, Debug)]
pub struct BotAuthCtx {
    pub token_id: String,
    pub bot_id: String,
    pub owner_user_id: String,
    pub display_name: String,
    pub avatar_file_id: Option<String>,
}

pub async fn validate_bot_token(
    pool: &SqlitePool,
    raw_token: &str,
) -> Result<Option<BotAuthCtx>, sqlx::Error> {
    let mut hasher = Sha256::new();
    hasher.update(raw_token.as_bytes());
    let token_hash = hex::encode(hasher.finalize());

    let row = sqlx::query(
        r#"
        SELECT bt.id AS token_id, bt.bot_id, ba.owner_user_id, ba.display_name, ba.avatar_file_id
        FROM bot_tokens bt
        JOIN bot_accounts ba ON ba.id = bt.bot_id
        WHERE bt.token_hash = ?
          AND bt.revoked_at IS NULL
          AND (bt.expires_at IS NULL OR bt.expires_at > CURRENT_TIMESTAMP)
          AND ba.deleted_at IS NULL
          AND ba.disabled_at IS NULL
        "#,
    )
    .bind(&token_hash)
    .fetch_optional(pool)
    .await?;

    let row = match row {
        Some(r) => r,
        None => return Ok(None),
    };

    let token_id: String = row.get("token_id");
    let bot_id: String = row.get("bot_id");
    let owner_user_id: String = row.get("owner_user_id");
    let display_name: String = row.get("display_name");
    let avatar_file_id: Option<String> = row.get("avatar_file_id");

    // Update last_used_at best-effort
    let pool_clone = pool.clone();
    let token_id_clone = token_id.clone();
    tokio::spawn(async move {
        let _ = sqlx::query("UPDATE bot_tokens SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?")
            .bind(&token_id_clone)
            .execute(&pool_clone)
            .await;
    });

    Ok(Some(BotAuthCtx {
        token_id,
        bot_id,
        owner_user_id,
        display_name,
        avatar_file_id,
    }))
}

#[derive(Clone, Debug)]
pub enum CallerIdentity {
    User(AuthUser),
    Bot(BotAuthCtx),
}

impl CallerIdentity {
    pub fn user_id(&self) -> Option<&str> {
        match self {
            CallerIdentity::User(u) => Some(&u.user_id),
            CallerIdentity::Bot(_) => None,
        }
    }

    pub fn is_owner_or_bot(&self, target_bot_id: &str, target_owner_id: &str) -> bool {
        match self {
            CallerIdentity::User(u) => u.user_id == target_owner_id,
            CallerIdentity::Bot(b) => b.bot_id == target_bot_id,
        }
    }
}
