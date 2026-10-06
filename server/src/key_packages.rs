use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use chrono::{DateTime, Utc};
use rand::RngCore;
use serde::Serialize;
use sqlx::{Row, SqlitePool};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize)]
pub struct KeyPackageSummary {
    pub id: String,
    pub client_id: String,
    pub cipher_suite: i64,
    pub is_last_resort: bool,
    pub consumed: bool,
    pub consumed_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone)]
pub struct UploadedKeyPackage {
    pub client_id: String,
    pub cipher_suite: i64,
    pub key_package_data: Vec<u8>,
    pub is_last_resort: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct ClaimedKeyPackage {
    pub id: String,
    pub user_id: String,
    pub client_id: String,
    pub cipher_suite: i64,
    pub key_package_data: Vec<u8>,
    pub is_last_resort: bool,
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct UnconsumedCount {
    pub total: u32,
    pub by_client: HashMap<String, u32>,
}

#[derive(Debug, thiserror::Error)]
pub enum KeyPackageError {
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("quota exceeded for client {client_id}: {current} existing + {new} new exceeds limit of {limit}")]
    QuotaExceeded {
        client_id: String,
        current: u32,
        new: u32,
        limit: i64,
    },
    #[error("no unconsumed key packages available")]
    NoPackagesAvailable,
    #[error("target user not found")]
    UserNotFound,
}

fn generate_key_package_id() -> String {
    let mut bytes = [0u8; 16];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

pub async fn upload_key_packages(
    pool: &SqlitePool,
    user_id: &str,
    packages: Vec<UploadedKeyPackage>,
    per_device_limit: i64,
) -> Result<Vec<KeyPackageSummary>, KeyPackageError> {
    let mut conn = pool.acquire().await?;
    sqlx::query("BEGIN IMMEDIATE").execute(&mut *conn).await?;

    let result = async {
        // 1. Verify user exists and is not deleted
        let user_exists: Option<(i32,)> =
            sqlx::query_as("SELECT 1 FROM users WHERE id = ? AND deleted_at IS NULL")
                .bind(user_id)
                .fetch_optional(&mut *conn)
                .await?;

        if user_exists.is_none() {
            return Err(KeyPackageError::UserNotFound);
        }

        if packages.is_empty() {
            return Ok(Vec::new());
        }

        // 2. Count new packages per client_id
        let mut new_counts: HashMap<String, u32> = HashMap::new();
        for pkg in &packages {
            *new_counts.entry(pkg.client_id.clone()).or_insert(0) += 1;
        }

        // 3. For each client_id, check existing + new <= per_device_limit
        for (client_id, new_cnt) in &new_counts {
            let existing: (i64,) = sqlx::query_as(
                "SELECT COUNT(*) FROM key_packages WHERE user_id = ? AND client_id = ? AND consumed = 0",
            )
            .bind(user_id)
            .bind(client_id)
            .fetch_one(&mut *conn)
            .await?;

            let current = existing.0 as u32;
            if (current + new_cnt) as i64 > per_device_limit {
                return Err(KeyPackageError::QuotaExceeded {
                    client_id: client_id.clone(),
                    current,
                    new: *new_cnt,
                    limit: per_device_limit,
                });
            }
        }

        // 4. Insert rows
        let now = Utc::now();
        let mut summaries = Vec::with_capacity(packages.len());

        for pkg in packages {
            let id = generate_key_package_id();
            sqlx::query(
                r#"
                INSERT INTO key_packages (
                    id, user_id, client_id, cipher_suite, key_package,
                    is_last_resort, consumed, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, 0, ?)
                "#,
            )
            .bind(&id)
            .bind(user_id)
            .bind(&pkg.client_id)
            .bind(pkg.cipher_suite)
            .bind(&pkg.key_package_data)
            .bind(if pkg.is_last_resort { 1 } else { 0 })
            .bind(now)
            .execute(&mut *conn)
            .await?;

            summaries.push(KeyPackageSummary {
                id,
                client_id: pkg.client_id,
                cipher_suite: pkg.cipher_suite,
                is_last_resort: pkg.is_last_resort,
                consumed: false,
                consumed_at: None,
                created_at: now,
            });
        }

        Ok(summaries)
    }
    .await;

    match result {
        Ok(summaries) => {
            sqlx::query("COMMIT").execute(&mut *conn).await?;
            Ok(summaries)
        }
        Err(err) => {
            sqlx::query("ROLLBACK").execute(&mut *conn).await.ok();
            Err(err)
        }
    }
}

pub async fn count_unconsumed(
    pool: &SqlitePool,
    user_id: &str,
) -> Result<UnconsumedCount, KeyPackageError> {
    let rows = sqlx::query(
        r#"
        SELECT client_id, COUNT(*) as cnt
        FROM key_packages
        WHERE user_id = ? AND consumed = 0
        GROUP BY client_id
        "#,
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?;

    let mut by_client = HashMap::new();
    let mut total = 0u32;

    for row in rows {
        let client_id: String = row.get("client_id");
        let cnt: i64 = row.get("cnt");
        let count_u32 = cnt as u32;
        total += count_u32;
        by_client.insert(client_id, count_u32);
    }

    Ok(UnconsumedCount { total, by_client })
}

pub async fn claim_key_package(
    pool: &SqlitePool,
    target_user_id: &str,
) -> Result<ClaimedKeyPackage, KeyPackageError> {
    let mut conn = pool.acquire().await?;
    sqlx::query("BEGIN IMMEDIATE").execute(&mut *conn).await?;

    let result = async {
        // 1. Verify target user exists and deleted_at IS NULL
        let user_exists: Option<(i32,)> =
            sqlx::query_as("SELECT 1 FROM users WHERE id = ? AND deleted_at IS NULL")
                .bind(target_user_id)
                .fetch_optional(&mut *conn)
                .await?;

        if user_exists.is_none() {
            return Err(KeyPackageError::UserNotFound);
        }

        // 2. Select oldest unconsumed non-last-resort package
        let normal_pkg = sqlx::query(
            r#"
            SELECT id, user_id, client_id, cipher_suite, key_package AS key_package_data, is_last_resort
            FROM key_packages
            WHERE user_id = ? AND consumed = 0 AND is_last_resort = 0
            ORDER BY created_at ASC, id ASC
            LIMIT 1
            "#,
        )
        .bind(target_user_id)
        .fetch_optional(&mut *conn)
        .await?;

        let row = match normal_pkg {
            Some(r) => r,
            None => {
                // 3. Fall back to oldest unconsumed last-resort package
                sqlx::query(
                    r#"
                    SELECT id, user_id, client_id, cipher_suite, key_package AS key_package_data, is_last_resort
                    FROM key_packages
                    WHERE user_id = ? AND consumed = 0 AND is_last_resort = 1
                    ORDER BY created_at ASC, id ASC
                    LIMIT 1
                    "#,
                )
                .bind(target_user_id)
                .fetch_optional(&mut *conn)
                .await?
                .ok_or(KeyPackageError::NoPackagesAvailable)?
            }
        };

        let id: String = row.get("id");
        let user_id: String = row.get("user_id");
        let client_id: String = row.get("client_id");
        let cipher_suite: i64 = row.get("cipher_suite");
        let key_package_data: Vec<u8> = row.get("key_package_data");
        let is_last_resort_i64: i64 = row.get("is_last_resort");
        let is_last_resort = is_last_resort_i64 != 0;

        // 4. If not last-resort, mark consumed
        if !is_last_resort {
            sqlx::query(
                "UPDATE key_packages SET consumed = 1, consumed_at = CURRENT_TIMESTAMP WHERE id = ?",
            )
            .bind(&id)
            .execute(&mut *conn)
            .await?;
        }

        Ok(ClaimedKeyPackage {
            id,
            user_id,
            client_id,
            cipher_suite,
            key_package_data,
            is_last_resort,
        })
    }
    .await;

    match result {
        Ok(pkg) => {
            sqlx::query("COMMIT").execute(&mut *conn).await?;
            Ok(pkg)
        }
        Err(err) => {
            sqlx::query("ROLLBACK").execute(&mut *conn).await.ok();
            Err(err)
        }
    }
}
