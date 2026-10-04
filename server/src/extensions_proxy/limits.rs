use chrono::{DateTime, Duration, Timelike, Utc};
use sqlx::SqlitePool;

use crate::config::Config;

#[derive(Debug)]
pub enum ProxyLimitError {
    RateLimited { retry_after: u64 },
    BandwidthLimited { retry_after: u64 },
    Database(sqlx::Error),
}

impl From<sqlx::Error> for ProxyLimitError {
    fn from(err: sqlx::Error) -> Self {
        ProxyLimitError::Database(err)
    }
}

struct WindowInfo {
    key: String,
    window_start: DateTime<Utc>,
    reset_at: DateTime<Utc>,
    limit: u64,
}

fn get_min_window(now: DateTime<Utc>) -> (DateTime<Utc>, DateTime<Utc>, String) {
    let start = now
        .with_second(0)
        .and_then(|t| t.with_nanosecond(0))
        .unwrap_or(now);
    let reset = start + Duration::minutes(1);
    let boundary = start.format("%Y-%m-%d-%H-%M").to_string();
    (start, reset, boundary)
}

fn get_hour_window(now: DateTime<Utc>) -> (DateTime<Utc>, DateTime<Utc>, String) {
    let start = now
        .with_minute(0)
        .and_then(|t| t.with_second(0))
        .and_then(|t| t.with_nanosecond(0))
        .unwrap_or(now);
    let reset = start + Duration::hours(1);
    let boundary = start.format("%Y-%m-%d-%H").to_string();
    (start, reset, boundary)
}

fn get_day_window(now: DateTime<Utc>) -> (DateTime<Utc>, DateTime<Utc>, String) {
    let start = now
        .with_hour(0)
        .and_then(|t| t.with_minute(0))
        .and_then(|t| t.with_second(0))
        .and_then(|t| t.with_nanosecond(0))
        .unwrap_or(now);
    let reset = start + Duration::days(1);
    let boundary = start.format("%Y-%m-%d").to_string();
    (start, reset, boundary)
}

pub async fn check_rate_limits(
    pool: &SqlitePool,
    config: &Config,
    user_id: &str,
    extension_id: &str,
) -> Result<(), ProxyLimitError> {
    let now = Utc::now();
    let (min_start, min_reset, min_bound) = get_min_window(now);
    let (hour_start, hour_reset, hour_bound) = get_hour_window(now);

    let windows = [
        WindowInfo {
            key: format!("extension_proxy:{user_id}:{extension_id}:min:{min_bound}"),
            window_start: min_start,
            reset_at: min_reset,
            limit: config.extension_proxy_max_requests_per_min as u64,
        },
        WindowInfo {
            key: format!("extension_proxy:{user_id}:{extension_id}:hour:{hour_bound}"),
            window_start: hour_start,
            reset_at: hour_reset,
            limit: config.extension_proxy_max_requests_per_hour as u64,
        },
        WindowInfo {
            key: format!("extension_proxy_total:{user_id}:min:{min_bound}"),
            window_start: min_start,
            reset_at: min_reset,
            limit: config.extension_proxy_max_requests_per_min_total as u64,
        },
        WindowInfo {
            key: format!("extension_proxy_total:{user_id}:hour:{hour_bound}"),
            window_start: hour_start,
            reset_at: hour_reset,
            limit: config.extension_proxy_max_requests_per_hour_total as u64,
        },
    ];

    let mut tx = pool.begin().await?;
    let mut max_retry_after: Option<u64> = None;

    for win in &windows {
        let count: i64 = sqlx::query_scalar(
            r#"
            INSERT INTO rate_limits (key, window_start, count)
            VALUES (?, ?, 1)
            ON CONFLICT (key, window_start) DO UPDATE SET count = count + 1
            RETURNING count;
            "#,
        )
        .bind(&win.key)
        .bind(win.window_start)
        .fetch_one(&mut *tx)
        .await?;

        if count as u64 > win.limit {
            let retry = (win.reset_at - now).num_seconds().max(1) as u64;
            max_retry_after = Some(max_retry_after.map_or(retry, |m| m.max(retry)));
        }
    }

    if let Some(retry_after) = max_retry_after {
        tx.rollback().await?;
        Err(ProxyLimitError::RateLimited { retry_after })
    } else {
        tx.commit().await?;
        Ok(())
    }
}

pub async fn check_and_record_bandwidth(
    pool: &SqlitePool,
    config: &Config,
    user_id: &str,
    extension_id: &str,
    bytes_consumed: u64,
) -> Result<(), ProxyLimitError> {
    let now = Utc::now();
    let (hour_start, hour_reset, hour_bound) = get_hour_window(now);
    let (day_start, day_reset, day_bound) = get_day_window(now);

    let windows = [
        WindowInfo {
            key: format!("extension_proxy_bw:{user_id}:{extension_id}:hour:{hour_bound}"),
            window_start: hour_start,
            reset_at: hour_reset,
            limit: config.extension_proxy_max_bandwidth_per_hour_bytes,
        },
        WindowInfo {
            key: format!("extension_proxy_bw:{user_id}:{extension_id}:day:{day_bound}"),
            window_start: day_start,
            reset_at: day_reset,
            limit: config.extension_proxy_max_bandwidth_per_day_bytes,
        },
        WindowInfo {
            key: format!("extension_proxy_bw_total:{user_id}:hour:{hour_bound}"),
            window_start: hour_start,
            reset_at: hour_reset,
            limit: config.extension_proxy_max_bandwidth_per_hour_bytes_total,
        },
        WindowInfo {
            key: format!("extension_proxy_bw_total:{user_id}:day:{day_bound}"),
            window_start: day_start,
            reset_at: day_reset,
            limit: config.extension_proxy_max_bandwidth_per_day_bytes_total,
        },
    ];

    let mut tx = pool.begin().await?;
    let mut max_retry_after: Option<u64> = None;

    for win in &windows {
        let count: i64 = sqlx::query_scalar(
            r#"
            INSERT INTO rate_limits (key, window_start, count)
            VALUES (?, ?, ?)
            ON CONFLICT (key, window_start) DO UPDATE SET count = count + ?
            RETURNING count;
            "#,
        )
        .bind(&win.key)
        .bind(win.window_start)
        .bind(bytes_consumed as i64)
        .bind(bytes_consumed as i64)
        .fetch_one(&mut *tx)
        .await?;

        if count as u64 > win.limit {
            let retry = (win.reset_at - now).num_seconds().max(1) as u64;
            max_retry_after = Some(max_retry_after.map_or(retry, |m| m.max(retry)));
        }
    }

    if let Some(retry_after) = max_retry_after {
        tx.rollback().await?;
        Err(ProxyLimitError::BandwidthLimited { retry_after })
    } else {
        tx.commit().await?;
        Ok(())
    }
}
