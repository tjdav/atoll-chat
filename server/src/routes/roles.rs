use crate::error::{ApiError, ErrorResponse};
use crate::roles::list_roles;
use axum::{extract::State, Json};
use serde::Serialize;
use sqlx::SqlitePool;
use utoipa::ToSchema;

#[derive(Serialize, ToSchema)]
pub struct RolesResponse {
    roles: Vec<crate::roles::Role>,
}

/// GET /api/v1/roles
#[utoipa::path(
    get,
    path = "/api/v1/roles",
    tag = "Public",
    summary = "List roles",
    description = "Fetches list of available roles and permissions (Server Spec v3.0.4 §3.1, implementation-defined endpoint).",
    responses(
        (status = 200, description = "Roles list retrieved successfully", body = RolesResponse),
        (status = 500, description = "Failed to list roles", body = ErrorResponse)
    )
)]
pub async fn handler(State(pool): State<SqlitePool>) -> Result<Json<RolesResponse>, ApiError> {
    let roles = list_roles(&pool)
        .await
        .map_err(|e| ApiError::Internal(anyhow::anyhow!("Failed to list roles: {}", e)))?;

    Ok(Json(RolesResponse { roles }))
}
