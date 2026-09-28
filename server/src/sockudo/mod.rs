use crate::config::Config;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use rand::RngCore;
use sqlx::SqlitePool;
use std::time::Duration;
use tracing::{info, warn};

pub mod publisher;

pub use publisher::Publisher;

#[derive(Debug, Clone)]
pub struct SockudoConfig {
    pub http_base: String,
    pub app_id: String,
    pub app_key: String,
    pub app_secret: String,
    pub enable_client_events: bool,
}

#[derive(Debug, thiserror::Error)]
pub enum SockudoError {
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("invalid configuration: {0}")]
    InvalidConfig(String),
    #[error("publish failed: {0}")]
    PublishFailed(String),
}

impl SockudoConfig {
    pub async fn load_or_initialize(
        pool: &SqlitePool,
        config: &Config,
    ) -> Result<Self, SockudoError> {
        let is_key_auto = config.sockudo_app_key == "auto";
        let is_secret_auto = config.sockudo_app_secret == "auto";

        let (app_key, app_secret) = match (is_key_auto, is_secret_auto) {
            (false, false) => {
                info!("sockudo: using externally configured credentials");
                (
                    config.sockudo_app_key.clone(),
                    config.sockudo_app_secret.clone(),
                )
            }
            (true, false) | (false, true) => {
                return Err(SockudoError::InvalidConfig(
                    "mixed auto and explicit credential modes are not supported".to_string(),
                ));
            }
            (true, true) => {
                let mut tx = pool.begin().await?;

                let db_key: Option<(String,)> = sqlx::query_as(
                    "SELECT value FROM instance_config WHERE key = 'sockudo_app_key'",
                )
                .fetch_optional(&mut *tx)
                .await?;
                let db_secret: Option<(String,)> = sqlx::query_as(
                    "SELECT value FROM instance_config WHERE key = 'sockudo_app_secret'",
                )
                .fetch_optional(&mut *tx)
                .await?;

                if let (Some((key,)), Some((secret,))) = (db_key, db_secret) {
                    info!("sockudo: loaded app credentials from instance_config");
                    tx.commit().await?;
                    (key, secret)
                } else {
                    let mut key_bytes = [0u8; 24];
                    rand::rngs::OsRng.fill_bytes(&mut key_bytes);
                    let gen_key = URL_SAFE_NO_PAD.encode(key_bytes);

                    let mut secret_bytes = [0u8; 32];
                    rand::rngs::OsRng.fill_bytes(&mut secret_bytes);
                    let gen_secret = URL_SAFE_NO_PAD.encode(secret_bytes);

                    sqlx::query(
                        "INSERT INTO instance_config (key, value) VALUES ('sockudo_app_key', ?) \
                         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                    )
                    .bind(&gen_key)
                    .execute(&mut *tx)
                    .await?;

                    sqlx::query(
                        "INSERT INTO instance_config (key, value) VALUES ('sockudo_app_secret', ?) \
                         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                    )
                    .bind(&gen_secret)
                    .execute(&mut *tx)
                    .await?;

                    tx.commit().await?;

                    info!(
                        "sockudo: generated new app credentials (app_id={})",
                        config.sockudo_app_id
                    );
                    (gen_key, gen_secret)
                }
            }
        };

        let http_base = config.sockudo_url.trim_end_matches('/').to_string();

        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(2))
            .build();

        if let Ok(client) = client {
            let reachability_url = format!("{}/up/{}", http_base, config.sockudo_app_id);
            match client.get(&reachability_url).send().await {
                Ok(resp) if resp.status().is_success() => {
                    info!("sockudo: reachable at {}", http_base);
                }
                _ => {
                    warn!("sockudo: unreachable (publish will retry)");
                }
            }
        } else {
            warn!("sockudo: unreachable (publish will retry)");
        }

        Ok(Self {
            http_base,
            app_id: config.sockudo_app_id.clone(),
            app_key,
            app_secret,
            enable_client_events: config.sockudo_enable_client_events,
        })
    }
}
