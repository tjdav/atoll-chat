use axum::{response::IntoResponse, Json};
use serde::Serialize;

#[derive(Serialize)]
pub struct HealthResponse {
    status: String,
}

pub async fn handler() -> impl IntoResponse {
    Json(HealthResponse {
        status: "ok".to_string(),
    })
}
