use std::env;

#[derive(Debug, Clone)]
pub struct Config {
    pub app_env: String,
    pub app_url: Option<String>,
    pub app_name: String,
    #[allow(dead_code)]
    pub log_level: String,
    pub server_bind: String,
    pub db_path: String,
    pub db_busy_timeout_ms: u64,
    pub opaque_oprf_key_path: String,
    pub altcha_enabled: bool,
    pub altcha_hmac_secret: String,
    pub altcha_algorithm: String,
    pub altcha_cost: u32,
    pub session_expiry_days: u32,
    pub session_sliding: bool,
    pub max_file_size_bytes: u64,
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        let app_env = env::var("APP_ENV").unwrap_or_else(|_| "production".to_string());

        let app_url = env::var("APP_URL").ok();
        if app_env == "production" && app_url.is_none() {
            anyhow::bail!("APP_URL must be set in production mode");
        }

        let app_name = env::var("APP_NAME").unwrap_or_else(|_| "Encrypted Chat".to_string());
        let log_level = env::var("LOG_LEVEL").unwrap_or_else(|_| "info".to_string());
        let server_bind = env::var("SERVER_BIND").unwrap_or_else(|_| "0.0.0.0:8080".to_string());
        let db_path = env::var("DB_PATH").unwrap_or_else(|_| "/data/app.db".to_string());

        let db_busy_timeout_ms = env::var("DB_BUSY_TIMEOUT_MS")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(5000);

        let opaque_oprf_key_path =
            env::var("OPAQUE_OPRF_KEY_PATH").unwrap_or_else(|_| "./data/oprf.key".to_string());

        let altcha_enabled = env::var("ALTCHA_ENABLED")
            .map(|v| v.trim().eq_ignore_ascii_case("true") || v.trim() == "1")
            .unwrap_or(true);

        let altcha_hmac_secret =
            env::var("ALTCHA_HMAC_SECRET").unwrap_or_else(|_| "auto".to_string());

        let altcha_algorithm =
            env::var("ALTCHA_ALGORITHM").unwrap_or_else(|_| "PBKDF2/SHA-256".to_string());

        let altcha_cost = env::var("ALTCHA_COST")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(5000);

        let session_expiry_days = env::var("SESSION_EXPIRY_DAYS")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(30);

        let session_sliding = env::var("SESSION_SLIDING")
            .map(|v| v.trim().eq_ignore_ascii_case("true") || v.trim() == "1")
            .unwrap_or(true);

        let max_file_size_bytes = env::var("MAX_FILE_SIZE_BYTES")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(104_857_600);

        Ok(Self {
            app_env,
            app_url,
            app_name,
            log_level,
            server_bind,
            db_path,
            db_busy_timeout_ms,
            opaque_oprf_key_path,
            altcha_enabled,
            altcha_hmac_secret,
            altcha_algorithm,
            altcha_cost,
            session_expiry_days,
            session_sliding,
            max_file_size_bytes,
        })
    }
}
