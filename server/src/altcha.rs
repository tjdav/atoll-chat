use crate::config::Config;
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use rand::RngCore;
use sqlx::SqlitePool;
use tracing::info;

#[derive(Debug, thiserror::Error)]
pub enum AltchaError {
    #[error("ALTCHA HMAC secret is missing or empty")]
    MissingSecret,
    #[error("Invalid ALTCHA cost: {0}")]
    InvalidCost(String),
    #[error("Database error: {0}")]
    DbError(#[from] sqlx::Error),
    #[error("ALTCHA error: {0}")]
    Altcha(String),
}

#[derive(Debug, Clone)]
pub struct AltchaConfig {
    pub enabled: bool,
    pub hmac_secret: String,
    pub algorithm: String,
    pub cost: u32,
}

impl AltchaConfig {
    pub async fn from_env(config: &Config, pool: &SqlitePool) -> Result<Self, AltchaError> {
        if !config.altcha_enabled {
            info!("ALTCHA is disabled");
            return Ok(Self {
                enabled: false,
                hmac_secret: String::new(),
                algorithm: config.altcha_algorithm.clone(),
                cost: config.altcha_cost,
            });
        }

        if config.altcha_cost == 0 {
            return Err(AltchaError::InvalidCost(
                "cost must be greater than 0".to_string(),
            ));
        }

        let hmac_secret = if config.altcha_hmac_secret == "auto" {
            let existing: Option<(String,)> =
                sqlx::query_as("SELECT value FROM server_config WHERE key = 'altcha_hmac_secret'")
                    .fetch_optional(pool)
                    .await?;

            if let Some((secret,)) = existing {
                info!("ALTCHA HMAC secret loaded from server_config");
                secret
            } else {
                let mut bytes = [0u8; 32];
                rand::thread_rng().fill_bytes(&mut bytes);
                let secret = hex::encode(bytes);

                sqlx::query(
                    "INSERT INTO server_config (key, value, is_secret) VALUES ('altcha_hmac_secret', ?, 1)",
                )
                .bind(&secret)
                .execute(pool)
                .await?;

                info!("Generated and saved new ALTCHA HMAC secret to server_config");
                secret
            }
        } else {
            if config.altcha_hmac_secret.trim().is_empty() {
                return Err(AltchaError::MissingSecret);
            }
            info!("ALTCHA HMAC secret loaded from configuration");
            config.altcha_hmac_secret.clone()
        };

        Ok(Self {
            enabled: true,
            hmac_secret,
            algorithm: config.altcha_algorithm.clone(),
            cost: config.altcha_cost,
        })
    }
}

pub fn verify_altcha_payload(
    config: &AltchaConfig,
    payload_b64: &str,
) -> Result<bool, AltchaError> {
    if !config.enabled {
        return Ok(true);
    }

    let decoded_bytes = STANDARD
        .decode(payload_b64)
        .map_err(|e| AltchaError::Altcha(format!("base64 decode failed: {e}")))?;

    let json_str = std::str::from_utf8(&decoded_bytes)
        .map_err(|e| AltchaError::Altcha(format!("invalid utf-8: {e}")))?;

    let payload: altcha::Payload = serde_json::from_str(json_str)
        .map_err(|e| AltchaError::Altcha(format!("json deserialize failed: {e}")))?;

    let mut options = altcha::VerifySolutionOptions::new(
        &payload.challenge,
        &payload.solution,
        &config.hmac_secret,
    );
    options.hmac_key_signature_secret = Some(config.hmac_secret.clone());

    let result = altcha::verify_solution(options)
        .map_err(|e| AltchaError::Altcha(format!("verification error: {e}")))?;

    Ok(result.verified)
}

pub async fn rotate_hmac_secret(
    pool: &SqlitePool,
    actor_id: Option<&str>,
) -> Result<(), AltchaError> {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    let secret = hex::encode(bytes);

    sqlx::query(
        r#"
        INSERT INTO server_config (key, value, is_secret)
        VALUES ('altcha_hmac_secret', ?, 1)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
        "#,
    )
    .bind(&secret)
    .execute(pool)
    .await?;

    let _ = crate::audit::log(
        pool,
        actor_id,
        crate::audit::action::ALTCHA_ROTATE,
        None,
        None,
        None,
    )
    .await;

    Ok(())
}
