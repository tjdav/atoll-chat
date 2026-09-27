use crate::error::ApiError;
use crate::roles::list_roles;
use axum::{extract::State, Json};
use serde::Serialize;
use sqlx::SqlitePool;

#[derive(Serialize)]
pub struct RolesResponse {
    roles: Vec<crate::roles::Role>,
}

pub async fn handler(State(pool): State<SqlitePool>) -> Result<Json<RolesResponse>, ApiError> {
    let roles = list_roles(&pool)
        .await
        .map_err(|e| ApiError::Internal(anyhow::anyhow!("Failed to list roles: {}", e)))?;

    Ok(Json(RolesResponse { roles }))
}
