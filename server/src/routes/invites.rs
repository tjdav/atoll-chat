use crate::auth::AuthUser;
use crate::error::ApiError;
use crate::invites::{self, CreateInviteOptions};
use crate::permissions::{perm, Permissions};
use crate::rate_limit::{self, RateLimitKey, Window};
use crate::AppState;
use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    Json,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
pub struct CreateInviteRequest {
    pub max_uses: Option<i64>,
    pub expires_in_days: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct CreateInviteResponse {
    pub id: String,
    pub code: String,
    pub max_uses: i64,
    pub current_uses: i64,
    pub expires_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct ListInvitesQuery {
    pub include_revoked: Option<bool>,
    pub created_by_me: Option<bool>,
}

#[derive(Debug, Serialize)]
pub struct InviteListItem {
    pub id: String,
    pub max_uses: i64,
    pub current_uses: i64,
    pub expires_at: Option<DateTime<Utc>>,
    pub revoked_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub created_by: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ListInvitesResponse {
    pub invites: Vec<InviteListItem>,
}

#[derive(Debug, Serialize)]
pub struct ValidateInviteResponse {
    pub valid: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<DateTime<Utc>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remaining_uses: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

async fn get_user_permissions(state: &AppState, user_id: &str) -> Result<Permissions, ApiError> {
    let raw_perms: Vec<String> = sqlx::query_scalar(
        r#"
        SELECT r.permissions
        FROM user_roles ur
        JOIN roles r ON ur.role_id = r.id
        WHERE ur.user_id = ?
        "#,
    )
    .bind(user_id)
    .fetch_all(&state.pool)
    .await?;

    let mut combined = Vec::new();
    for p_json in raw_perms {
        if let Ok(perms) = Permissions::from_json(&p_json) {
            combined.extend(perms.inner().clone());
        }
    }

    Ok(Permissions::from_json(
        &serde_json::to_string(&combined).unwrap_or_else(|_| "[]".to_string()),
    )
    .unwrap_or_else(|_| Permissions::from_json("[]").unwrap()))
}

pub async fn create_invite_handler(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(body): Json<CreateInviteRequest>,
) -> Result<Json<CreateInviteResponse>, ApiError> {
    // 1. Rate limiting
    let decision_hourly = rate_limit::check(
        &state.pool,
        &state.config.rate_limits,
        RateLimitKey::InviteCreate {
            user_id: auth.user_id.clone(),
            window: Window::Hour,
        },
    )
    .await?;

    if !decision_hourly.allowed {
        return Err(ApiError::TooManyRequests {
            message: "invite creation rate limit exceeded".into(),
            reset_at: decision_hourly.reset_at,
        });
    }

    let decision_daily = rate_limit::check(
        &state.pool,
        &state.config.rate_limits,
        RateLimitKey::InviteCreate {
            user_id: auth.user_id.clone(),
            window: Window::Day,
        },
    )
    .await?;

    if !decision_daily.allowed {
        return Err(ApiError::TooManyRequests {
            message: "invite creation rate limit exceeded".into(),
            reset_at: decision_daily.reset_at,
        });
    }

    // 2. Permission checks
    let permissions = get_user_permissions(&state, &auth.user_id).await?;
    let has_unlimited = permissions.has(perm::INVITE_UNLIMITED);
    let has_limited = permissions.has(perm::INVITE_LIMITED);

    if !has_unlimited && !has_limited {
        return Err(ApiError::Forbidden("forbidden".to_string()));
    }

    // 3. Validation
    if let Some(uses) = body.max_uses {
        if !(0..=10000).contains(&uses) {
            return Err(ApiError::BadRequest(
                "max_uses must be between 0 and 10000".to_string(),
            ));
        }
    }

    if let Some(days) = body.expires_in_days {
        if !(0..=365).contains(&days) {
            return Err(ApiError::BadRequest(
                "expires_in_days must be between 0 and 365".to_string(),
            ));
        }
    }

    if !has_unlimited && has_limited {
        // Limited inviter checks
        let requested_uses = body.max_uses.unwrap_or(state.config.invite_default_uses);
        if requested_uses == 0 || requested_uses > state.config.invite_limited_max_uses {
            return Err(ApiError::Forbidden("forbidden".to_string()));
        }

        let open_count: i64 = sqlx::query_scalar(
            r#"
            SELECT COUNT(*) FROM server_invites
            WHERE created_by = ?
              AND revoked_at IS NULL
              AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
              AND (max_uses = 0 OR current_uses < max_uses)
            "#,
        )
        .bind(&auth.user_id)
        .fetch_one(&state.pool)
        .await?;

        if open_count >= state.config.invite_limited_max_open {
            return Err(ApiError::Forbidden("invite_limit_reached".to_string()));
        }
    }

    let invite = invites::create_invite(
        &state.pool,
        &auth.user_id,
        CreateInviteOptions {
            max_uses: body.max_uses,
            expires_in_days: body.expires_in_days,
        },
        &state.config,
    )
    .await?;

    let _ = crate::audit::log(
        &state.pool,
        Some(&auth.user_id),
        crate::audit::action::INVITE_CREATE,
        Some("invite"),
        Some(&invite.id),
        None,
    )
    .await;

    Ok(Json(CreateInviteResponse {
        id: invite.id,
        code: invite.code,
        max_uses: invite.max_uses,
        current_uses: invite.current_uses,
        expires_at: invite.expires_at,
        created_at: invite.created_at,
    }))
}

pub async fn list_invites_handler(
    State(state): State<AppState>,
    auth: AuthUser,
    Query(query): Query<ListInvitesQuery>,
) -> Result<Json<ListInvitesResponse>, ApiError> {
    let permissions = get_user_permissions(&state, &auth.user_id).await?;
    let has_unlimited = permissions.has(perm::INVITE_UNLIMITED);
    let has_limited = permissions.has(perm::INVITE_LIMITED);

    if !has_unlimited && !has_limited {
        return Err(ApiError::Forbidden("forbidden".to_string()));
    }

    let include_revoked = query.include_revoked.unwrap_or(false);
    let created_by_me = query.created_by_me.unwrap_or(false);

    let all_invites = invites::list_invites(&state.pool, include_revoked).await?;

    let filtered: Vec<InviteListItem> = all_invites
        .into_iter()
        .filter(|inv| {
            if !has_unlimited || created_by_me {
                inv.created_by.as_deref() == Some(&auth.user_id)
            } else {
                true
            }
        })
        .map(|inv| InviteListItem {
            id: inv.id,
            max_uses: inv.max_uses,
            current_uses: inv.current_uses,
            expires_at: inv.expires_at,
            revoked_at: inv.revoked_at,
            created_at: inv.created_at,
            created_by: inv.created_by,
        })
        .collect();

    Ok(Json(ListInvitesResponse { invites: filtered }))
}

pub async fn revoke_invite_handler(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    let permissions = get_user_permissions(&state, &auth.user_id).await?;
    let has_unlimited = permissions.has(perm::INVITE_UNLIMITED);
    let has_limited = permissions.has(perm::INVITE_LIMITED);

    if !has_unlimited && !has_limited {
        return Err(ApiError::Forbidden("forbidden".to_string()));
    }

    let invite = invites::get_invite_by_id(&state.pool, &id).await?;
    let invite = match invite {
        Some(inv) => inv,
        None => return Err(ApiError::NotFound("invite_not_found".to_string())),
    };

    if !has_unlimited && invite.created_by.as_deref() != Some(&auth.user_id) {
        return Err(ApiError::NotFound("invite_not_found".to_string()));
    }

    let revoked = invites::revoke_invite(&state.pool, &id).await?;
    if revoked {
        let _ = crate::audit::log(
            &state.pool,
            Some(&auth.user_id),
            crate::audit::action::INVITE_REVOKE,
            Some("invite"),
            Some(&id),
            None,
        )
        .await;
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(ApiError::Conflict("invite_already_revoked".to_string()))
    }
}

pub async fn validate_invite_public_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(code): Path<String>,
) -> Result<Json<ValidateInviteResponse>, ApiError> {
    let ip = headers
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.split(',').next())
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|| "127.0.0.1".to_string());

    let decision = rate_limit::check(
        &state.pool,
        &state.config.rate_limits,
        RateLimitKey::InviteRedeem { ip },
    )
    .await?;

    if !decision.allowed {
        return Err(ApiError::TooManyRequests {
            message: "invite redemption rate limit exceeded".into(),
            reset_at: decision.reset_at,
        });
    }

    let row = sqlx::query(
        r#"
        SELECT max_uses, current_uses, expires_at, revoked_at
        FROM server_invites
        WHERE code = ?
        "#,
    )
    .bind(code.trim())
    .fetch_optional(&state.pool)
    .await?;

    let row = match row {
        Some(r) => r,
        None => {
            return Ok(Json(ValidateInviteResponse {
                valid: false,
                expires_at: None,
                remaining_uses: None,
                reason: Some("not_found".to_string()),
            }));
        }
    };

    use sqlx::Row;
    let max_uses: i64 = row.get("max_uses");
    let current_uses: i64 = row.get("current_uses");
    let expires_at: Option<DateTime<Utc>> = row.get("expires_at");
    let revoked_at: Option<DateTime<Utc>> = row.get("revoked_at");

    if revoked_at.is_some() {
        return Ok(Json(ValidateInviteResponse {
            valid: false,
            expires_at: None,
            remaining_uses: None,
            reason: Some("revoked".to_string()),
        }));
    }

    let now = Utc::now();
    if let Some(exp) = expires_at {
        if exp < now {
            return Ok(Json(ValidateInviteResponse {
                valid: false,
                expires_at: Some(exp),
                remaining_uses: None,
                reason: Some("expired".to_string()),
            }));
        }
    }

    if max_uses > 0 && current_uses >= max_uses {
        return Ok(Json(ValidateInviteResponse {
            valid: false,
            expires_at,
            remaining_uses: Some(0),
            reason: Some("exhausted".to_string()),
        }));
    }

    let remaining_uses = if max_uses > 0 {
        Some(max_uses - current_uses)
    } else {
        None
    };

    Ok(Json(ValidateInviteResponse {
        valid: true,
        expires_at,
        remaining_uses,
        reason: None,
    }))
}
