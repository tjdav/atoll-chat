use axum::{response::IntoResponse, Json};
use serde::Serialize;
use utoipa::ToSchema;

#[derive(Serialize, ToSchema)]
pub struct HealthResponse {
    status: String,
}

#[utoipa::path(
    get,
    path = "/api/v1/health",
    tag = "Public",
    summary = "Health check",
    description = "Server liveness check endpoint (Server Spec v3.0.4 §8.1).",
    responses(
        (status = 200, description = "Server is live", body = HealthResponse)
    )
)]
pub async fn handler() -> impl IntoResponse {
    Json(HealthResponse {
        status: "ok".to_string(),
    })
}
