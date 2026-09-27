pub use crate::config::RateLimitConfig;
use chrono::{DateTime, Duration, Timelike, Utc};
use sqlx::SqlitePool;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Window {
    Minute,
    Hour,
    Day,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RateLimitKey {
    InviteCreate { user_id: String, window: Window },
    InviteRedeem { ip: String },
    KpClaim { user_id: String, window: Window },
    Login { ip: String },
}

#[derive(Debug, Clone)]
pub struct RateLimitDecision {
    pub allowed: bool,
    pub remaining: u32,
    pub reset_at: DateTime<Utc>,
}

#[derive(thiserror::Error, Debug)]
pub enum RateLimitError {
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("invalid key: {0}")]
    InvalidKey(String),
}

pub async fn check(
    pool: &SqlitePool,
    config: &RateLimitConfig,
    key: RateLimitKey,
) -> Result<RateLimitDecision, RateLimitError> {
    let now = Utc::now();

    let (key_str, window, limit) = match key {
        RateLimitKey::InviteCreate { user_id, window } => {
            let limit = match window {
                Window::Hour => config.invite_create_hourly,
                Window::Day => config.invite_create_daily,
                Window::Minute => {
                    return Err(RateLimitError::InvalidKey(
                        "unsupported window for InviteCreate".into(),
                    ))
                }
            };
            let win_tag = match window {
                Window::Hour => "hour",
                Window::Day => "day",
                _ => "min",
            };
            (format!("invite_create:{user_id}:{win_tag}"), window, limit)
        }
        RateLimitKey::InviteRedeem { ip } => (
            format!("invite_redeem:{ip}:min"),
            Window::Minute,
            config.invite_redeem_per_min,
        ),
        RateLimitKey::KpClaim { user_id, window } => {
            let limit = match window {
                Window::Minute => config.kp_claim_per_min,
                Window::Hour => config.kp_claim_hourly,
                Window::Day => {
                    return Err(RateLimitError::InvalidKey(
                        "unsupported window for KpClaim".into(),
                    ))
                }
            };
            let win_tag = match window {
                Window::Minute => "min",
                Window::Hour => "hour",
                _ => "day",
            };
            (format!("kp_claim:{user_id}:{win_tag}"), window, limit)
        }
        RateLimitKey::Login { ip } => (
            format!("login:{ip}:min"),
            Window::Minute,
            config.login_per_min,
        ),
    };

    let (window_start, reset_at) = match window {
        Window::Minute => {
            let start = now
                .with_second(0)
                .and_then(|t| t.with_nanosecond(0))
                .unwrap_or(now);
            let reset = start + Duration::minutes(1);
            (start, reset)
        }
        Window::Hour => {
            let start = now
                .with_minute(0)
                .and_then(|t| t.with_second(0))
                .and_then(|t| t.with_nanosecond(0))
                .unwrap_or(now);
            let reset = start + Duration::hours(1);
            (start, reset)
        }
        Window::Day => {
            let start = now
                .with_hour(0)
                .and_then(|t| t.with_minute(0))
                .and_then(|t| t.with_second(0))
                .and_then(|t| t.with_nanosecond(0))
                .unwrap_or(now);
            let reset = start + Duration::days(1);
            (start, reset)
        }
    };

    let count: i64 = sqlx::query_scalar(
        r#"
        INSERT INTO rate_limits (key, window_start, count)
        VALUES (?, ?, 1)
        ON CONFLICT (key, window_start) DO UPDATE SET count = count + 1
        RETURNING count;
        "#,
    )
    .bind(&key_str)
    .bind(window_start)
    .fetch_one(pool)
    .await?;

    let allowed = count <= limit as i64;
    let remaining = if allowed {
        limit.saturating_sub(count as u32)
    } else {
        0
    };

    Ok(RateLimitDecision {
        allowed,
        remaining,
        reset_at,
    })
}
