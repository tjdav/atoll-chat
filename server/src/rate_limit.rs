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
    DataExport { user_id: String },
    Presign { user_id: String },
    OprfBlind { ip: String, window: Window },
    Lookup { user_id: String },
    ReadState { user_id: String },
    Preference { user_id: String },
    DeviceName { user_id: String },
    AdminOprfRotate { user_id: String },
    RoomMetadata { user_id: String },
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

fn compute_window(now: DateTime<Utc>, window: Window) -> (DateTime<Utc>, DateTime<Utc>) {
    match window {
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
    }
}

pub async fn check(
    pool: &SqlitePool,
    config: &RateLimitConfig,
    key: RateLimitKey,
) -> Result<RateLimitDecision, RateLimitError> {
    let now = Utc::now();

    let (key_str, window_start, reset_at, limit) = match key {
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
            let (start, reset) = compute_window(now, window);
            (
                format!("invite_create:{user_id}:{win_tag}"),
                start,
                reset,
                limit,
            )
        }
        RateLimitKey::InviteRedeem { ip } => {
            let (start, reset) = compute_window(now, Window::Minute);
            (
                format!("invite_redeem:{ip}:min"),
                start,
                reset,
                config.invite_redeem_per_min,
            )
        }
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
            let (start, reset) = compute_window(now, window);
            (format!("kp_claim:{user_id}:{win_tag}"), start, reset, limit)
        }
        RateLimitKey::Login { ip } => {
            let (start, reset) = compute_window(now, Window::Minute);
            (
                format!("login:{ip}:min"),
                start,
                reset,
                config.login_per_min,
            )
        }
        RateLimitKey::DataExport { user_id } => {
            let start = now
                .with_minute(0)
                .and_then(|t| t.with_second(0))
                .and_then(|t| t.with_nanosecond(0))
                .unwrap_or(now);
            let reset = start + Duration::hours(config.export_rate_limit_hours as i64);
            let window_boundary = start.format("%Y-%m-%d-%H").to_string();
            (
                format!("data_export:{user_id}:{window_boundary}"),
                start,
                reset,
                1,
            )
        }
        RateLimitKey::Presign { user_id } => {
            let (start, reset) = compute_window(now, Window::Minute);
            (
                format!("presign:{user_id}:min"),
                start,
                reset,
                config.presign_per_min,
            )
        }
        RateLimitKey::OprfBlind { ip, window } => {
            let limit = match window {
                Window::Minute => config.oprf_blind_per_min,
                Window::Hour => config.oprf_blind_per_hour,
                Window::Day => {
                    return Err(RateLimitError::InvalidKey(
                        "unsupported window for OprfBlind".into(),
                    ))
                }
            };
            let win_tag = match window {
                Window::Minute => "min",
                Window::Hour => "hour",
                _ => "day",
            };
            let (start, reset) = compute_window(now, window);
            (format!("oprf_blind:{ip}:{win_tag}"), start, reset, limit)
        }
        RateLimitKey::Lookup { user_id } => {
            let (start, reset) = compute_window(now, Window::Minute);
            (
                format!("lookup:{user_id}:min"),
                start,
                reset,
                60, // Default 60 lookup requests per user per minute
            )
        }
        RateLimitKey::ReadState { user_id } => {
            let (start, reset) = compute_window(now, Window::Minute);
            (
                format!("read_state:{user_id}:min"),
                start,
                reset,
                config.read_state_per_min,
            )
        }
        RateLimitKey::Preference { user_id } => {
            let (start, reset) = compute_window(now, Window::Minute);
            (
                format!("preference:{user_id}:min"),
                start,
                reset,
                config.preference_per_min,
            )
        }
        RateLimitKey::DeviceName { user_id } => {
            let (start, reset) = compute_window(now, Window::Minute);
            (
                format!("device_name:{user_id}:min"),
                start,
                reset,
                config.rate_device_name_per_min,
            )
        }
        RateLimitKey::AdminOprfRotate { user_id } => {
            let (start, reset) = compute_window(now, Window::Hour);
            let boundary = start.format("%Y-%m-%d-%H").to_string();
            (
                format!("admin_oprf_rotate:{user_id}:hour:{boundary}"),
                start,
                reset,
                config.rate_admin_oprf_rotate_per_hour,
            )
        }
        RateLimitKey::RoomMetadata { user_id } => {
            let (start, reset) = compute_window(now, Window::Minute);
            (
                format!("room_metadata:{user_id}:min"),
                start,
                reset,
                config.rate_room_metadata_per_min,
            )
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

pub fn extract_client_ip(
    headers: &axum::http::HeaderMap,
    config: &crate::config::Config,
) -> String {
    if config.trust_proxy {
        if let Some(forwarded) = headers.get("x-forwarded-for").and_then(|h| h.to_str().ok()) {
            if let Some(ip) = forwarded.split(',').next() {
                let trimmed = ip.trim();
                if !trimmed.is_empty() {
                    return trimmed.to_string();
                }
            }
        }
    }
    "127.0.0.1".to_string()
}
