use crate::error::{ApiError, ErrorResponse};
use crate::roles::list_roles;
use axum::{extract::State, Json};
use serde::Serialize;
use sqlx::SqlitePool;
use utoipa::ToSchema;

#[derive(Serialize, ToSchema)]
pub struct RolesResponse {
    pub roles: Vec<crate::roles::Role>,
}

/// GET /api/v1/roles
#[utoipa::path(
    get,
    path = "/api/v1/roles",
    tag = "Public",
    summary = "List system roles",
    description = "Lists available system roles and permission sets (Server Spec v3.0.4 §3.1; implementation-defined endpoint).",
    security(
        ("bearer_auth" = [])
    ),
    responses(
        (status = 200, description = "System roles list retrieved successfully", body = RolesResponse),
        (status = 401, description = "Unauthorized", body = ErrorResponse)
    )
)]
pub async fn handler(State(pool): State<SqlitePool>) -> Result<Json<RolesResponse>, ApiError> {
    let roles = list_roles(&pool)
        .await
        .map_err(|e| ApiError::Internal(anyhow::anyhow!("Failed to list roles: {}", e)))?;

    Ok(Json(RolesResponse { roles }))
}
