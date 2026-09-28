use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use rand::RngCore;
use sqlx::SqlitePool;
use std::time::Duration;
use tracing::{info, warn};

use crate::config::Config;

#[derive(Debug, Clone)]
pub struct SockudoConfig {
    pub http_base: String,
    pub app_id: String,
    pub app_key: String,
    pub app_secret: String,
}

#[derive(Debug, thiserror::Error)]
pub enum SockudoError {
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("publish failed: {0}")]
    PublishFailed(String),
    #[error("invalid configuration: {0}")]
    InvalidConfig(String),
}

impl SockudoConfig {
    pub async fn load_or_initialize(
        pool: &SqlitePool,
        config: &Config,
    ) -> Result<Self, SockudoError> {
        let http_base = config.sockudo_url.trim_end_matches('/').to_string();
        let app_id = config.sockudo_app_id.clone();

        let app_key_is_auto = config.sockudo_app_key == "auto";
        let app_secret_is_auto = config.sockudo_app_secret == "auto";

        if app_key_is_auto != app_secret_is_auto {
            return Err(SockudoError::InvalidConfig(
                "SOCKUDO_APP_KEY and SOCKUDO_APP_SECRET must either both be 'auto' or both be set explicitly".to_string(),
            ));
        }

        let (app_key, app_secret) = if !app_key_is_auto && !app_secret_is_auto {
            info!("sockudo: using externally configured credentials");
            (
                config.sockudo_app_key.clone(),
                config.sockudo_app_secret.clone(),
            )
        } else {
            // Check instance_config
            let db_key: Option<(String,)> =
                sqlx::query_as("SELECT value FROM instance_config WHERE key = 'sockudo_app_key'")
                    .fetch_optional(pool)
                    .await?;

            let db_secret: Option<(String,)> = sqlx::query_as(
                "SELECT value FROM instance_config WHERE key = 'sockudo_app_secret'",
            )
            .fetch_optional(pool)
            .await?;

            if let (Some((k,)), Some((s,))) = (db_key, db_secret) {
                info!("sockudo: loaded app credentials from instance_config");
                (k, s)
            } else {
                // Generate fresh credentials
                let mut key_bytes = [0u8; 24];
                let mut secret_bytes = [0u8; 32];
                rand::rngs::OsRng.fill_bytes(&mut key_bytes);
                rand::rngs::OsRng.fill_bytes(&mut secret_bytes);

                let new_key = URL_SAFE_NO_PAD.encode(key_bytes);
                let new_secret = URL_SAFE_NO_PAD.encode(secret_bytes);

                let mut tx = pool.begin().await?;
                sqlx::query(
                    "INSERT INTO instance_config (key, value) VALUES ('sockudo_app_key', ?)
                     ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                )
                .bind(&new_key)
                .execute(&mut *tx)
                .await?;

                sqlx::query(
                    "INSERT INTO instance_config (key, value) VALUES ('sockudo_app_secret', ?)
                     ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                )
                .bind(&new_secret)
                .execute(&mut *tx)
                .await?;

                tx.commit().await?;

                info!("sockudo: generated new app credentials (app_id={})", app_id);
                (new_key, new_secret)
            }
        };

        let sock_cfg = SockudoConfig {
            http_base,
            app_id,
            app_key,
            app_secret,
        };

        // Reachability check
        sock_cfg.check_reachability().await;

        Ok(sock_cfg)
    }

    pub async fn check_reachability(&self) {
        let client = match reqwest::Client::builder()
            .timeout(Duration::from_secs(2))
            .build()
        {
            Ok(c) => c,
            Err(_) => {
                warn!("sockudo: unreachable (publish will retry)");
                return;
            }
        };

        let url = format!("{}/up/{}", self.http_base, self.app_id);
        match client.get(&url).send().await {
            Ok(resp) if resp.status().is_success() => {
                info!("sockudo: reachable at {}", self.http_base);
            }
            _ => {
                warn!("sockudo: unreachable (publish will retry)");
            }
        }
    }
}

pub mod auth;
pub mod publisher;

pub use auth::compute_channel_auth;
pub use publisher::Publisher;
