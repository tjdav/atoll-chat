use axum::{extract::State, http::StatusCode, Json};
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

use crate::{
    auth::AuthUser,
    error::ApiError,
    key_packages::{self, UploadedKeyPackage},
    limits,
    rate_limit::{self, RateLimitKey, Window},
    AppState,
};

const SERVER_MAX_KEYPACKAGES_PER_DEVICE: i64 = 50;

#[derive(Debug, Deserialize)]
pub struct UploadPackageItem {
    pub client_id: String,
    pub cipher_suite: i64,
    pub key_package_data: String,
    #[serde(default)]
    pub is_last_resort: bool,
}

#[derive(Debug, Deserialize)]
pub struct UploadKeyPackagesRequest {
    pub packages: Vec<UploadPackageItem>,
}

#[derive(Debug, Serialize)]
pub struct UploadKeyPackagesResponse {
    pub uploaded: usize,
    pub unconsumed_count: u32,
}

#[derive(Debug, Deserialize)]
pub struct ClaimKeyPackageRequest {
    pub user_id: String,
}

#[derive(Debug, Serialize)]
pub struct ClaimKeyPackageResponse {
    pub id: String,
    pub user_id: String,
    pub client_id: String,
    pub cipher_suite: i64,
    pub key_package_data: String,
    pub is_last_resort: bool,
}

pub async fn upload(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(payload): Json<UploadKeyPackagesRequest>,
) -> Result<(StatusCode, Json<UploadKeyPackagesResponse>), ApiError> {
    if payload.packages.is_empty() {
        return Err(ApiError::BadRequest("empty_batch".into()));
    }

    if payload.packages.len() > 50 {
        return Err(ApiError::BadRequest("batch_size_exceeded".into()));
    }

    // Collect distinct client_ids to validate ownership
    let mut client_ids = HashSet::new();

    for item in &payload.packages {
        // client_id validation: 16-64 chars, alphanumeric + _ + -
        let cid = item.client_id.trim();
        if cid.len() < 16 || cid.len() > 64 {
            return Err(ApiError::BadRequest("invalid_client_id".into()));
        }
        if !cid
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
        {
            return Err(ApiError::BadRequest("invalid_client_id".into()));
        }

        // cipher_suite validation: 1..=255
        if !(1..=255).contains(&item.cipher_suite) {
            return Err(ApiError::BadRequest("invalid_cipher_suite".into()));
        }

        // key_package_data validation: valid base64 decoding to 1B..=64KB
        let decoded = STANDARD
            .decode(&item.key_package_data)
            .map_err(|_| ApiError::BadRequest("invalid_key_package_data".into()))?;

        if decoded.is_empty() || decoded.len() > 65536 {
            return Err(ApiError::BadRequest("invalid_key_package_data".into()));
        }

        client_ids.insert(cid.to_string());
    }

    // Verify each client_id is owned by the authenticated user
    for cid in &client_ids {
        let device_exists: Option<(i32,)> =
            sqlx::query_as("SELECT 1 FROM devices WHERE user_id = ? AND client_id = ?")
                .bind(&auth.user_id)
                .bind(cid)
                .fetch_optional(&state.pool)
                .await?;

        if device_exists.is_none() {
            return Err(ApiError::BadRequest("unknown_client_id".into()));
        }
    }

    // Get instance limit for keypackages_per_device, clamped to SERVER_MAX_KEYPACKAGES_PER_DEVICE
    let effective_limits = limits::get_limits(&state.pool, &state.server_hard_max).await?;
    let per_device_limit = effective_limits
        .keypackages_per_device
        .min(SERVER_MAX_KEYPACKAGES_PER_DEVICE);

    let domain_packages: Vec<UploadedKeyPackage> = payload
        .packages
        .into_iter()
        .map(|item| UploadedKeyPackage {
            client_id: item.client_id,
            cipher_suite: item.cipher_suite,
            key_package_data: STANDARD
                .decode(&item.key_package_data)
                .expect("already decoded"),
            is_last_resort: item.is_last_resort,
        })
        .collect();

    let uploaded_summaries = key_packages::upload_key_packages(
        &state.pool,
        &auth.user_id,
        domain_packages,
        per_device_limit,
    )
    .await?;

    let count_res = key_packages::count_unconsumed(&state.pool, &auth.user_id).await?;

    Ok((
        StatusCode::CREATED,
        Json(UploadKeyPackagesResponse {
            uploaded: uploaded_summaries.len(),
            unconsumed_count: count_res.total,
        }),
    ))
}

pub async fn count(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<key_packages::UnconsumedCount>, ApiError> {
    let unconsumed = key_packages::count_unconsumed(&state.pool, &auth.user_id).await?;
    Ok(Json(unconsumed))
}

pub async fn claim(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(payload): Json<ClaimKeyPackageRequest>,
) -> Result<Json<ClaimKeyPackageResponse>, ApiError> {
    if payload.user_id.trim().is_empty() {
        return Err(ApiError::BadRequest("user_id required".into()));
    }

    // Rate limiting: minute window
    let decision_min = rate_limit::check(
        &state.pool,
        &state.config.rate_limits,
        RateLimitKey::KpClaim {
            user_id: auth.user_id.clone(),
            window: Window::Minute,
        },
    )
    .await?;

    if !decision_min.allowed {
        return Err(ApiError::TooManyRequests {
            message: "keypackage claim rate limit (minute) exceeded".into(),
            reset_at: decision_min.reset_at,
        });
    }

    // Rate limiting: hour window
    let decision_hour = rate_limit::check(
        &state.pool,
        &state.config.rate_limits,
        RateLimitKey::KpClaim {
            user_id: auth.user_id.clone(),
            window: Window::Hour,
        },
    )
    .await?;

    if !decision_hour.allowed {
        return Err(ApiError::TooManyRequests {
            message: "keypackage claim rate limit (hourly) exceeded".into(),
            reset_at: decision_hour.reset_at,
        });
    }

    let claimed = key_packages::claim_key_package(&state.pool, &payload.user_id).await?;

    let response = ClaimKeyPackageResponse {
        id: claimed.id,
        user_id: claimed.user_id,
        client_id: claimed.client_id,
        cipher_suite: claimed.cipher_suite,
        key_package_data: STANDARD.encode(&claimed.key_package_data),
        is_last_resort: claimed.is_last_resort,
    };

    Ok(Json(response))
}
