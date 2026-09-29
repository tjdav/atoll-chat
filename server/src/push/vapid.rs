use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use p256::elliptic_curve::sec1::ToEncodedPoint;
use p256::SecretKey;
use rand::rngs::OsRng;
use sqlx::SqlitePool;
use tracing::info;

use crate::config::Config;

#[derive(Debug, thiserror::Error)]
pub enum PushError {
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("invalid key: {0}")]
    InvalidKey(String),
    #[error("invalid configuration: {0}")]
    InvalidConfig(String),
    #[error("not found")]
    NotFound,
    #[error("invalid input: {0}")]
    InvalidInput(String),
    #[error("invalid platform: {0}")]
    InvalidPlatform(String),
    #[error("missing required field: {0}")]
    MissingField(String),
    #[error("web push error: {0}")]
    WebPush(String),
}

#[derive(Clone)]
pub struct VapidKeys {
    pub public_key: String,  // base64url, no padding
    pub private_key: String, // base64url, no padding
}

impl std::fmt::Debug for VapidKeys {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("VapidKeys")
            .field("public_key", &self.public_key)
            .field("private_key", &"<redacted>")
            .finish()
    }
}

impl VapidKeys {
    pub async fn load_or_generate(
        pool: &SqlitePool,
        config: &Config,
    ) -> Result<Option<Self>, PushError> {
        if !config.push_enabled {
            return Ok(None);
        }

        let pub_auto = config.push_vapid_public_key == "auto";
        let priv_auto = config.push_vapid_private_key == "auto";

        if pub_auto != priv_auto {
            return Err(PushError::InvalidConfig(
                "PUSH_VAPID_PUBLIC_KEY and PUSH_VAPID_PRIVATE_KEY must both be \"auto\" or both be explicit values.".to_string(),
            ));
        }

        if !pub_auto && !priv_auto {
            let pub_clean = config.push_vapid_public_key.trim_end_matches('=');
            let priv_clean = config.push_vapid_private_key.trim_end_matches('=');

            let pub_bytes = URL_SAFE_NO_PAD.decode(pub_clean).map_err(|e| {
                PushError::InvalidKey(format!("invalid public key base64url: {}", e))
            })?;
            let priv_bytes = URL_SAFE_NO_PAD.decode(priv_clean).map_err(|e| {
                PushError::InvalidKey(format!("invalid private key base64url: {}", e))
            })?;

            if pub_bytes.len() != 65 || pub_bytes[0] != 0x04 {
                return Err(PushError::InvalidKey(
                    "public key must be 65 bytes starting with 0x04".to_string(),
                ));
            }
            if priv_bytes.len() != 32 {
                return Err(PushError::InvalidKey(
                    "private key must be 32 bytes".to_string(),
                ));
            }

            info!("push: using externally configured VAPID keys");
            return Ok(Some(VapidKeys {
                public_key: pub_clean.to_string(),
                private_key: priv_clean.to_string(),
            }));
        }

        let existing_pub: Option<String> = sqlx::query_scalar(
            "SELECT value FROM instance_config WHERE key = 'push_vapid_public_key'",
        )
        .fetch_optional(pool)
        .await?;

        let existing_priv: Option<String> = sqlx::query_scalar(
            "SELECT value FROM instance_config WHERE key = 'push_vapid_private_key'",
        )
        .fetch_optional(pool)
        .await?;

        if let (Some(pub_k), Some(priv_k)) = (existing_pub, existing_priv) {
            info!("push: loaded VAPID keys from instance_config");
            return Ok(Some(VapidKeys {
                public_key: pub_k,
                private_key: priv_k,
            }));
        }

        let secret = SecretKey::random(&mut OsRng);
        let public = secret.public_key().to_encoded_point(false);
        let public_bytes = public.as_bytes(); // 65 bytes, 0x04 prefix
        let private_bytes = secret.to_bytes(); // 32 bytes

        let public_b64 = URL_SAFE_NO_PAD.encode(public_bytes);
        let private_b64 = URL_SAFE_NO_PAD.encode(private_bytes);

        let mut tx = pool.begin().await?;

        sqlx::query(
            r#"
            INSERT INTO instance_config (key, value, updated_at)
            VALUES ('push_vapid_public_key', ?, CURRENT_TIMESTAMP)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
            "#,
        )
        .bind(&public_b64)
        .execute(&mut *tx)
        .await?;

        sqlx::query(
            r#"
            INSERT INTO instance_config (key, value, updated_at)
            VALUES ('push_vapid_private_key', ?, CURRENT_TIMESTAMP)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
            "#,
        )
        .bind(&private_b64)
        .execute(&mut *tx)
        .await?;

        tx.commit().await?;

        info!("push: generated new VAPID keys");

        Ok(Some(VapidKeys {
            public_key: public_b64,
            private_key: private_b64,
        }))
    }
}
