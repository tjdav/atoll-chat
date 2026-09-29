use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use chrono::{DateTime, Utc};
use rand::RngCore;
use serde::Serialize;
use sqlx::SqlitePool;

use super::vapid::PushError;

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct PushSubscription {
    pub id: String,
    pub user_id: String,
    pub device_id: Option<String>,
    pub platform: String,
    pub browser_id: Option<String>,
    pub endpoint: Option<String>,
    pub p256dh: Option<String>,
    pub auth: Option<String>,
    pub push_token: Option<String>,
    pub user_agent: Option<String>,
    pub created_at: DateTime<Utc>,
    pub last_used_at: Option<DateTime<Utc>>,
    pub revoked_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct PushSubscriptionView {
    pub id: String,
    pub platform: String,
    pub browser_id: Option<String>,
    pub device_id: Option<String>,
    pub created_at: DateTime<Utc>,
    pub last_used_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone)]
pub struct RegisterRequest {
    pub user_id: String,
    pub platform: String,
    pub device_id: Option<String>,
    pub endpoint: Option<String>,
    pub p256dh: Option<String>,
    pub auth: Option<String>,
    pub push_token: Option<String>,
    pub browser_id: Option<String>,
    pub user_agent: Option<String>,
}

pub async fn register_subscription(
    pool: &SqlitePool,
    req: RegisterRequest,
) -> Result<PushSubscriptionView, PushError> {
    let platform = req.platform.to_lowercase();
    if !matches!(platform.as_str(), "web" | "ios" | "android" | "desktop") {
        return Err(PushError::InvalidPlatform(req.platform));
    }

    match platform.as_str() {
        "web" | "desktop" => {
            if req.endpoint.as_deref().unwrap_or("").trim().is_empty() {
                return Err(PushError::MissingField("endpoint".to_string()));
            }
            if req.p256dh.as_deref().unwrap_or("").trim().is_empty() {
                return Err(PushError::MissingField("p256dh".to_string()));
            }
            if req.auth.as_deref().unwrap_or("").trim().is_empty() {
                return Err(PushError::MissingField("auth".to_string()));
            }
            if req.browser_id.as_deref().unwrap_or("").trim().is_empty() {
                return Err(PushError::MissingField("browser_id".to_string()));
            }
        }
        "ios" | "android" => {
            if req.push_token.as_deref().unwrap_or("").trim().is_empty() {
                return Err(PushError::MissingField("push_token".to_string()));
            }
        }
        _ => {}
    }

    if platform == "web" {
        if let Some(ref browser_id) = req.browser_id {
            let existing: Option<PushSubscriptionView> = sqlx::query_as(
                r#"
                SELECT id, platform, browser_id, device_id, created_at, last_used_at
                FROM push_subscriptions
                WHERE user_id = ? AND browser_id = ? AND revoked_at IS NULL
                "#,
            )
            .bind(&req.user_id)
            .bind(browser_id)
            .fetch_optional(pool)
            .await?;

            if let Some(existing_sub) = existing {
                let updated: PushSubscriptionView = sqlx::query_as(
                    r#"
                    UPDATE push_subscriptions
                    SET endpoint = ?,
                        p256dh = ?,
                        auth = ?,
                        user_agent = ?,
                        device_id = COALESCE(?, device_id),
                        last_used_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                    RETURNING id, platform, browser_id, device_id, created_at, last_used_at
                    "#,
                )
                .bind(&req.endpoint)
                .bind(&req.p256dh)
                .bind(&req.auth)
                .bind(&req.user_agent)
                .bind(&req.device_id)
                .bind(&existing_sub.id)
                .fetch_one(pool)
                .await?;

                return Ok(updated);
            }
        }
    }

    let mut id_bytes = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut id_bytes);
    let id = URL_SAFE_NO_PAD.encode(id_bytes);

    let inserted: PushSubscriptionView = sqlx::query_as(
        r#"
        INSERT INTO push_subscriptions (
            id, user_id, device_id, platform, endpoint, p256dh, auth, push_token, browser_id, user_agent
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        RETURNING id, platform, browser_id, device_id, created_at, last_used_at
        "#,
    )
    .bind(&id)
    .bind(&req.user_id)
    .bind(&req.device_id)
    .bind(&platform)
    .bind(&req.endpoint)
    .bind(&req.p256dh)
    .bind(&req.auth)
    .bind(&req.push_token)
    .bind(&req.browser_id)
    .bind(&req.user_agent)
    .fetch_one(pool)
    .await?;

    Ok(inserted)
}

pub async fn list_subscriptions(
    pool: &SqlitePool,
    user_id: &str,
) -> Result<Vec<PushSubscriptionView>, PushError> {
    let rows: Vec<PushSubscriptionView> = sqlx::query_as(
        r#"
        SELECT id, platform, browser_id, device_id, created_at, last_used_at
        FROM push_subscriptions
        WHERE user_id = ? AND revoked_at IS NULL
        ORDER BY created_at DESC
        "#,
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?;

    Ok(rows)
}

pub async fn revoke_subscription(
    pool: &SqlitePool,
    user_id: &str,
    subscription_id: &str,
) -> Result<(), PushError> {
    let mut tx = pool.begin().await?;

    let row: Option<(String,)> = sqlx::query_as(
        "SELECT id FROM push_subscriptions WHERE id = ? AND user_id = ? AND revoked_at IS NULL",
    )
    .bind(subscription_id)
    .bind(user_id)
    .fetch_optional(&mut *tx)
    .await?;

    if row.is_none() {
        return Err(PushError::NotFound);
    }

    sqlx::query(
        "UPDATE push_subscriptions SET revoked_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?",
    )
    .bind(subscription_id)
    .bind(user_id)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;

    Ok(())
}

pub async fn delete_for_device(
    tx: &mut sqlx::SqliteConnection,
    device_id: &str,
) -> Result<u64, PushError> {
    let res = sqlx::query("DELETE FROM push_subscriptions WHERE device_id = ?")
        .bind(device_id)
        .execute(tx)
        .await?;

    Ok(res.rows_affected())
}
