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
    tag = "Admin",
    summary = "List server roles",
    description = "Fetches list of server roles and permissions. Implementation-defined endpoint. See §3.1.",
    security(
        ("bearer_auth" = [])
    ),
    responses(
        (status = 200, description = "Server roles retrieved successfully", body = RolesResponse),
        (status = 401, description = "Unauthorized", body = ErrorResponse)
    )
)]
pub async fn handler(State(pool): State<SqlitePool>) -> Result<Json<RolesResponse>, ApiError> {
    let roles = list_roles(&pool)
        .await
        .map_err(|e| ApiError::Internal(anyhow::anyhow!("Failed to list roles: {}", e)))?;

    Ok(Json(RolesResponse { roles }))
}
