use std::env;

#[derive(Debug, Clone)]
pub struct RateLimitConfig {
    pub invite_create_hourly: u32,
    pub invite_create_daily: u32,
    pub invite_redeem_per_min: u32,
    pub kp_claim_per_min: u32,
    pub kp_claim_hourly: u32,
    pub login_per_min: u32,
    pub login_lockout_min: u32,
    pub export_rate_limit_hours: u64,
}

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
    pub server_max_devices_per_user: u32,
    pub invite_default_uses: i64,
    pub invite_expiry_days: i64,
    pub invite_code_length: usize,
    pub invite_limited_max_uses: i64,
    pub invite_limited_max_open: i64,
    pub room_invite_default_uses: i64,
    pub room_invite_code_length: usize,
    pub rate_limits: RateLimitConfig,
    pub cleanup_enabled: bool,
    pub cleanup_interval_minutes: u64,
    pub cleanup_startup_delay_secs: u64,
    pub audit_retention_days: u64,
    pub data_retention_days: u64,
    pub export_rate_limit_hours: u64,
    pub trust_proxy: bool,
    pub hsts_max_age: u64,
    pub hsts_include_subdomains: bool,
    pub client_static_dir: Option<String>,
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        let app_env = env::var("APP_ENV").unwrap_or_else(|_| "production".to_string());

        let app_url = env::var("APP_URL").ok();
        if app_env == "production" {
            match &app_url {
                Some(url) => {
                    if !url.starts_with("https://") {
                        anyhow::bail!(
                            "FATAL: APP_URL must use https:// in production (got \"{}\")",
                            url
                        );
                    }
                }
                None => anyhow::bail!("APP_URL must be set in production mode"),
            }
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

        let server_max_devices_per_user = env::var("SERVER_MAX_DEVICES_PER_USER")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(20);

        let invite_default_uses = env::var("INVITE_DEFAULT_USES")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(1);

        let invite_expiry_days = env::var("INVITE_EXPIRY_DAYS")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(0);

        let invite_code_length = env::var("INVITE_CODE_LENGTH")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(8);

        let invite_limited_max_uses = env::var("INVITE_LIMITED_MAX_USES")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(10);

        let invite_limited_max_open = env::var("INVITE_LIMITED_MAX_OPEN")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(50);

        let room_invite_default_uses = env::var("ROOM_INVITE_DEFAULT_USES")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(1);

        let room_invite_code_length = env::var("ROOM_INVITE_CODE_LENGTH")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(8);

        let rate_invite_create_hourly = env::var("RATE_INVITE_CREATE_HOURLY")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(50);

        let rate_invite_create_daily = env::var("RATE_INVITE_CREATE_DAILY")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(200);

        let rate_invite_redeem_per_min = env::var("RATE_INVITE_REDEEM_PER_MIN")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(10);

        let rate_kp_claim_per_min = env::var("RATE_KP_CLAIM_PER_MIN")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(30);

        let rate_kp_claim_hourly = env::var("RATE_KP_CLAIM_HOURLY")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(200);

        let rate_login_per_min = env::var("RATE_LOGIN_PER_MIN")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(10);

        let rate_login_lockout_min = env::var("RATE_LOGIN_LOCKOUT_MIN")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(15);

        let export_rate_limit_hours = env::var("EXPORT_RATE_LIMIT_HOURS")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(24);

        let rate_limits = RateLimitConfig {
            invite_create_hourly: rate_invite_create_hourly,
            invite_create_daily: rate_invite_create_daily,
            invite_redeem_per_min: rate_invite_redeem_per_min,
            kp_claim_per_min: rate_kp_claim_per_min,
            kp_claim_hourly: rate_kp_claim_hourly,
            login_per_min: rate_login_per_min,
            login_lockout_min: rate_login_lockout_min,
            export_rate_limit_hours,
        };

        let cleanup_enabled = env::var("CLEANUP_ENABLED")
            .map(|v| v.trim().eq_ignore_ascii_case("true") || v.trim() == "1")
            .unwrap_or(true);

        let cleanup_interval_minutes = env::var("CLEANUP_INTERVAL_MINUTES")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(60);

        let cleanup_startup_delay_secs = env::var("CLEANUP_STARTUP_DELAY_SECS")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(30);

        let audit_retention_days = env::var("AUDIT_RETENTION_DAYS")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(90);

        let data_retention_days = env::var("DATA_RETENTION_DAYS")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(0);

        let trust_proxy = env::var("TRUST_PROXY")
            .map(|v| v.trim().eq_ignore_ascii_case("true") || v.trim() == "1")
            .unwrap_or(false);

        let hsts_max_age = env::var("HSTS_MAX_AGE")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(31_536_000);

        let hsts_include_subdomains = env::var("HSTS_INCLUDE_SUBDOMAINS")
            .map(|v| v.trim().eq_ignore_ascii_case("true") || v.trim() == "1")
            .unwrap_or(true);

        let client_static_dir = env::var("CLIENT_STATIC_DIR")
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());

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
            server_max_devices_per_user,
            invite_default_uses,
            invite_expiry_days,
            invite_code_length,
            invite_limited_max_uses,
            invite_limited_max_open,
            room_invite_default_uses,
            room_invite_code_length,
            rate_limits,
            cleanup_enabled,
            cleanup_interval_minutes,
            cleanup_startup_delay_secs,
            audit_retention_days,
            data_retention_days,
            export_rate_limit_hours,
            trust_proxy,
            hsts_max_age,
            hsts_include_subdomains,
            client_static_dir,
        })
    }
}
