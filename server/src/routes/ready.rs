use crate::AppState;
use axum::{
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde::Serialize;
use std::collections::BTreeMap;
use std::time::Duration;

#[derive(Serialize)]
pub struct ReadinessResponse {
    pub status: String,
    pub checks: BTreeMap<String, String>,
}

pub async fn handler(State(state): State<AppState>) -> Response {
    let mut checks = BTreeMap::new();
    let mut is_ready = true;

    // 1. Database check
    match sqlx::query("SELECT 1").execute(&state.pool).await {
        Ok(_) => {
            checks.insert("database".to_string(), "ok".to_string());
        }
        Err(e) => {
            is_ready = false;
            checks.insert("database".to_string(), format!("failed: {}", e));
        }
    }

    // 2. OPRF key check (static check)
    checks.insert("oprf_key".to_string(), "ok".to_string());

    // 3. Sockudo check
    if let Ok(sockudo_url) = std::env::var("SOCKUDO_URL") {
        let trimmed = sockudo_url.trim();
        if trimmed.is_empty() {
            checks.insert("sockudo".to_string(), "skipped".to_string());
        } else {
            let app_id = std::env::var("SOCKUDO_APP_ID").unwrap_or_else(|_| "app".to_string());
            let target_url = format!("{}/up/{}", trimmed.trim_end_matches('/'), app_id);

            match check_sockudo(&target_url).await {
                Ok(_) => {
                    checks.insert("sockudo".to_string(), "ok".to_string());
                }
                Err(e) => {
                    is_ready = false;
                    checks.insert("sockudo".to_string(), format!("failed: {}", e));
                }
            }
        }
    } else {
        checks.insert("sockudo".to_string(), "skipped".to_string());
    }

    let status_str = if is_ready { "ready" } else { "not_ready" };
    let http_status = if is_ready {
        StatusCode::OK
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    };

    let body = Json(ReadinessResponse {
        status: status_str.to_string(),
        checks,
    });

    (http_status, body).into_response()
}

async fn check_sockudo(url_str: &str) -> Result<(), String> {
    let url = url_str
        .parse::<axum::http::Uri>()
        .map_err(|e| format!("invalid url: {}", e))?;

    let host = url.host().ok_or_else(|| "missing host".to_string())?;
    let port = url.port_u16().unwrap_or(80);
    let addr = format!("{}:{}", host, port);

    let connect_fut = tokio::net::TcpStream::connect(&addr);
    match tokio::time::timeout(Duration::from_secs(2), connect_fut).await {
        Ok(Ok(_stream)) => Ok(()),
        Ok(Err(e)) => Err(format!("connection refused: {}", e)),
        Err(_) => Err("connection timeout".to_string()),
    }
}
