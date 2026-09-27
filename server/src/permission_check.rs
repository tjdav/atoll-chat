use crate::auth::AuthUser;
use crate::error::ApiError;
use crate::permissions::perm;
use crate::roles;
use crate::AppState;
use axum::{
    extract::{FromRef, FromRequestParts},
    http::{request::Parts, StatusCode},
};
use std::marker::PhantomData;
use tracing::warn;

pub trait Permission {
    const NAME: &'static str;
}

pub struct ConfigEdit;
impl Permission for ConfigEdit {
    const NAME: &'static str = perm::CONFIG_EDIT;
}

pub struct UserManage;
impl Permission for UserManage {
    const NAME: &'static str = perm::USER_MANAGE;
}

pub struct InviteUnlimited;
impl Permission for InviteUnlimited {
    const NAME: &'static str = perm::INVITE_UNLIMITED;
}

pub struct InviteLimited;
impl Permission for InviteLimited {
    const NAME: &'static str = perm::INVITE_LIMITED;
}

pub struct RequirePermission<P: Permission>(pub PhantomData<P>);

impl<P: Permission, S> FromRequestParts<S> for RequirePermission<P>
where
    S: Send + Sync,
    AppState: FromRef<S>,
{
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let app_state = AppState::from_ref(state);

        let auth = match AuthUser::from_request_parts(parts, state).await {
            Ok(auth) => auth,
            Err(res) => {
                let status = res.status();
                if status == StatusCode::UNAUTHORIZED {
                    let bytes = axum::body::to_bytes(res.into_body(), usize::MAX)
                        .await
                        .unwrap_or_default();
                    if String::from_utf8_lossy(&bytes).contains("account_disabled") {
                        return Err(ApiError::Unauthorized("account_disabled".to_string()));
                    }
                    return Err(ApiError::Unauthorized("unauthorized".to_string()));
                }
                return Err(ApiError::Internal(anyhow::anyhow!("Auth failed")));
            }
        };

        let has_perm = roles::user_has_permission(&app_state.pool, &auth.user_id, P::NAME)
            .await
            .map_err(|e| ApiError::Internal(e.into()))?;

        if !has_perm {
            warn!(
                user_id = %auth.user_id,
                required_permission = %P::NAME,
                "Permission denied"
            );
            return Err(ApiError::Forbidden("forbidden".to_string()));
        }

        Ok(RequirePermission(PhantomData))
    }
}

pub struct AuthedWith<P: Permission> {
    pub user: AuthUser,
    _marker: PhantomData<P>,
}

impl<P: Permission, S> FromRequestParts<S> for AuthedWith<P>
where
    S: Send + Sync,
    AppState: FromRef<S>,
{
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let app_state = AppState::from_ref(state);

        let auth = match AuthUser::from_request_parts(parts, state).await {
            Ok(auth) => auth,
            Err(res) => {
                let status = res.status();
                if status == StatusCode::UNAUTHORIZED {
                    let bytes = axum::body::to_bytes(res.into_body(), usize::MAX)
                        .await
                        .unwrap_or_default();
                    if String::from_utf8_lossy(&bytes).contains("account_disabled") {
                        return Err(ApiError::Unauthorized("account_disabled".to_string()));
                    }
                    return Err(ApiError::Unauthorized("unauthorized".to_string()));
                }
                return Err(ApiError::Internal(anyhow::anyhow!("Auth failed")));
            }
        };

        let has_perm = roles::user_has_permission(&app_state.pool, &auth.user_id, P::NAME)
            .await
            .map_err(|e| ApiError::Internal(e.into()))?;

        if !has_perm {
            warn!(
                user_id = %auth.user_id,
                required_permission = %P::NAME,
                "Permission denied"
            );
            return Err(ApiError::Forbidden("forbidden".to_string()));
        }

        Ok(AuthedWith {
            user: auth,
            _marker: PhantomData,
        })
    }
}

pub async fn require_permission(
    pool: &sqlx::SqlitePool,
    user_id: &str,
    perm_name: &str,
) -> Result<(), ApiError> {
    let has_perm = roles::user_has_permission(pool, user_id, perm_name)
        .await
        .map_err(|e| ApiError::Internal(e.into()))?;

    if !has_perm {
        warn!(
            user_id = %user_id,
            required_permission = %perm_name,
            "Permission denied"
        );
        return Err(ApiError::Forbidden("forbidden".to_string()));
    }

    Ok(())
}

pub async fn require_role(
    pool: &sqlx::SqlitePool,
    user_id: &str,
    role_name: &str,
) -> Result<(), ApiError> {
    let user_roles = roles::get_user_roles(pool, user_id)
        .await
        .map_err(|e| ApiError::Internal(e.into()))?;

    if user_roles.iter().any(|r| r.name == role_name) {
        Ok(())
    } else {
        Err(ApiError::Forbidden("forbidden".to_string()))
    }
}
