use chrono::{DateTime, Duration, Timelike, Utc};
use serde_json::json;
use sqlx::SqlitePool;
use tracing::{info, warn};

use crate::audit;

pub fn get_closed_hour_boundary(now: DateTime<Utc>) -> (DateTime<Utc>, String) {
    let closed_time = now - Duration::hours(1);
    let start = closed_time
        .with_minute(0)
        .and_then(|t| t.with_second(0))
        .and_then(|t| t.with_nanosecond(0))
        .unwrap_or(closed_time);
    let boundary = start.format("%Y-%m-%d-%H").to_string();
    (start, boundary)
}

pub async fn aggregate_extension_proxy_audit_for_boundary(
    pool: &SqlitePool,
    boundary: &str,
) -> Result<usize, sqlx::Error> {
    let pattern = format!("extension_proxy:%:hour:{}", boundary);
    let rows: Vec<(String, i64)> =
        sqlx::query_as("SELECT key, count FROM rate_limits WHERE key LIKE ?")
            .bind(&pattern)
            .fetch_all(pool)
            .await?;

    let mut written = 0;
    for (key, count) in rows {
        if count <= 0 {
            continue;
        }

        let parts: Vec<&str> = key.split(':').collect();
        if parts.len() == 5
            && parts[0] == "extension_proxy"
            && parts[3] == "hour"
            && parts[4] == boundary
        {
            let user_id = parts[1];
            let extension_id = parts[2];

            let metadata = json!({
                "extension_id": extension_id,
                "request_count": count as u64,
            });

            if let Err(err) = audit::log(
                pool,
                Some(user_id),
                audit::action::EXTENSION_PROXY_REQUEST,
                None,
                None,
                Some(metadata),
            )
            .await
            {
                warn!(
                    target: "extension_proxy",
                    "Failed to write aggregated extension proxy audit log for user '{}' extension '{}': {}",
                    user_id, extension_id, err
                );
            } else {
                written += 1;
            }
        }
    }

    Ok(written)
}

pub async fn run_hourly_audit_aggregation_job(pool: SqlitePool) {
    let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(3600));
    // First tick fires immediately, but we can compute the previous hour's boundary
    loop {
        interval.tick().await;
        let now = Utc::now();
        let (_start, boundary) = get_closed_hour_boundary(now);
        match aggregate_extension_proxy_audit_for_boundary(&pool, &boundary).await {
            Ok(count) => {
                info!(
                    target: "extension_proxy",
                    "Hourly extension proxy audit aggregation completed for boundary {}: {} audit entries written",
                    boundary, count
                );
            }
            Err(err) => {
                warn!(
                    target: "extension_proxy",
                    "Hourly extension proxy audit aggregation failed for boundary {}: {}",
                    boundary, err
                );
            }
        }
    }
}
