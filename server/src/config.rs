use std::env;
use std::path::PathBuf;

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
    pub presign_per_min: u32,
    pub oprf_blind_per_min: u32,
    pub oprf_blind_per_hour: u32,
    pub read_state_per_min: u32,
    pub preference_per_min: u32,
    pub rate_device_name_per_min: u32,
    pub rate_admin_oprf_rotate_per_hour: u32,
    pub rate_room_metadata_per_min: u32,
    pub rate_edit_per_min: u32,
    pub rate_reaction_per_min: u32,
    pub rate_member_list_per_min: u32,
    pub rate_recover_start_per_min: u32,
    pub rate_recover_start_per_hour: u32,
    pub rate_link_preview_per_min: u32,
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
    pub oprf_blind_enabled: bool,
    pub username_oprf_enabled: bool,
    pub key_transparency_enabled: bool,
    // used by Task 34b
    pub key_transparency_log_path: String,
    // used by Task 34b
    pub key_transparency_auditor_keys: Option<String>,
    pub link_preview_proxy_enabled: bool,
    pub link_preview_proxy_timeout_seconds: u64,
    pub link_preview_proxy_max_bytes: u64,
    pub link_preview_proxy_key_path: String,
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
    pub max_room_metadata_bytes: usize,
    pub edit_window_seconds: i64,
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
    pub sockudo_url: String,
    pub sockudo_app_id: String,
    pub sockudo_app_key: String,
    pub sockudo_app_secret: String,
    pub sockudo_enable_client_events: bool,
    pub sockudo_public_url: Option<String>,

    pub storage_backend: String,
    pub storage_fs_path: PathBuf,
    pub s3_endpoint: Option<String>,
    pub s3_region: String,
    pub s3_bucket: Option<String>,
    pub s3_access_key_id: Option<String>,
    pub s3_secret_access_key: Option<String>,
    pub s3_path_style: bool,
    pub s3_presign_ttl_seconds: u64,
    pub attachment_chunk_size: u64,
    pub attachment_bucket_sizes: Vec<u64>,

    pub backup_enabled: bool,
    pub backup_path: PathBuf,
    pub backup_interval_hours: u64,
    pub backup_retention_count: u64,
    pub backup_include_attachments: bool,

    pub push_enabled: bool,
    pub push_vapid_public_key: String,
    pub push_vapid_private_key: String,
    pub push_vapid_subject: Option<String>,
    pub push_gateway_url: Option<String>,
    pub push_delivery_enabled: bool,
    pub push_suppression_window_secs: u64,
    pub push_delivery_timeout_secs: u64,
    pub push_max_concurrent_deliveries: usize,

    pub push_apns_key: Option<String>,
    pub push_apns_key_id: Option<String>,
    pub push_apns_team_id: Option<String>,
    pub push_apns_bundle_id: Option<String>,
    pub push_apns_use_sandbox: bool,

    pub push_fcm_service_account_json: Option<String>,
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

        let oprf_blind_enabled = env::var("OPRF_BLIND_ENABLED")
            .map(|v| v.trim().eq_ignore_ascii_case("true") || v.trim() == "1")
            .unwrap_or(true);

        let username_oprf_enabled = env::var("USERNAME_OPRF_ENABLED")
            .map(|v| v.trim().eq_ignore_ascii_case("true") || v.trim() == "1")
            .unwrap_or(true);

        let key_transparency_enabled = env::var("KEY_TRANSPARENCY_ENABLED")
            .map(|v| v.trim().eq_ignore_ascii_case("true") || v.trim() == "1")
            .unwrap_or(true);

        let key_transparency_log_path =
            env::var("KEY_TRANSPARENCY_LOG_PATH").unwrap_or_else(|_| "/data/kt-log".to_string());

        let key_transparency_auditor_keys = env::var("KEY_TRANSPARENCY_AUDITOR_KEYS")
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());

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

        let rate_presign_per_min = env::var("RATE_PRESIGN_PER_MIN")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(60);

        let rate_oprf_blind_per_min = env::var("RATE_OPRF_BLIND_PER_MIN")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(30);

        let rate_oprf_blind_per_hour = env::var("RATE_OPRF_BLIND_PER_HOUR")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(300);

        let rate_read_state_per_min = env::var("RATE_READ_STATE_PER_MIN")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(120);

        let rate_preference_per_min = env::var("RATE_PREFERENCE_PER_MIN")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(120);

        let rate_device_name_per_min = env::var("RATE_DEVICE_NAME_PER_MIN")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(30);

        let rate_admin_oprf_rotate_per_hour = env::var("RATE_ADMIN_OPRF_ROTATE_PER_HOUR")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(1);

        let rate_room_metadata_per_min = env::var("RATE_ROOM_METADATA_PER_MIN")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(30);

        let max_room_metadata_bytes = env::var("MAX_ROOM_METADATA_BYTES")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(4096);

        let edit_window_seconds = env::var("EDIT_WINDOW_SECONDS")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(900);

        let rate_edit_per_min = env::var("RATE_EDIT_PER_MIN")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(30);

        let rate_reaction_per_min = env::var("RATE_REACTION_PER_MIN")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(60);

        let rate_member_list_per_min = env::var("RATE_MEMBER_LIST_PER_MIN")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(60);

        let rate_recover_start_per_min = env::var("RATE_RECOVER_START_PER_MIN")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(5);

        let rate_recover_start_per_hour = env::var("RATE_RECOVER_START_PER_HOUR")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(20);

        let rate_link_preview_per_min = env::var("RATE_LINK_PREVIEW_PER_MIN")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(10);

        let rate_limits = RateLimitConfig {
            invite_create_hourly: rate_invite_create_hourly,
            invite_create_daily: rate_invite_create_daily,
            invite_redeem_per_min: rate_invite_redeem_per_min,
            kp_claim_per_min: rate_kp_claim_per_min,
            kp_claim_hourly: rate_kp_claim_hourly,
            login_per_min: rate_login_per_min,
            login_lockout_min: rate_login_lockout_min,
            export_rate_limit_hours,
            presign_per_min: rate_presign_per_min,
            oprf_blind_per_min: rate_oprf_blind_per_min,
            oprf_blind_per_hour: rate_oprf_blind_per_hour,
            read_state_per_min: rate_read_state_per_min,
            preference_per_min: rate_preference_per_min,
            rate_device_name_per_min,
            rate_admin_oprf_rotate_per_hour,
            rate_room_metadata_per_min,
            rate_edit_per_min,
            rate_reaction_per_min,
            rate_member_list_per_min,
            rate_recover_start_per_min,
            rate_recover_start_per_hour,
            rate_link_preview_per_min,
        };

        let link_preview_proxy_enabled = env::var("LINK_PREVIEW_PROXY_ENABLED")
            .map(|v| v.trim().eq_ignore_ascii_case("true") || v.trim() == "1")
            .unwrap_or(false);

        let link_preview_proxy_timeout_seconds = env::var("LINK_PREVIEW_PROXY_TIMEOUT_SECONDS")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(5);

        let link_preview_proxy_max_bytes = env::var("LINK_PREVIEW_PROXY_MAX_BYTES")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(1_048_576);

        let link_preview_proxy_key_path = env::var("LINK_PREVIEW_PROXY_KEY_PATH")
            .unwrap_or_else(|_| "./data/link-preview.key".to_string());

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

        let sockudo_url = match env::var("SOCKUDO_URL") {
            Ok(val) if !val.trim().is_empty() => val.trim().to_string(),
            _ => {
                if app_env == "production" {
                    anyhow::bail!("SOCKUDO_URL must be set in production mode");
                } else {
                    "http://localhost:6001".to_string()
                }
            }
        };

        let sockudo_app_id = env::var("SOCKUDO_APP_ID")
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "chat".to_string());

        let sockudo_app_key = env::var("SOCKUDO_APP_KEY")
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "auto".to_string());

        let sockudo_app_secret = env::var("SOCKUDO_APP_SECRET")
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "auto".to_string());

        let sockudo_enable_client_events = env::var("SOCKUDO_ENABLE_CLIENT_EVENTS")
            .map(|v| v.trim().eq_ignore_ascii_case("true") || v.trim() == "1")
            .unwrap_or(true);

        let sockudo_public_url = env::var("SOCKUDO_PUBLIC_URL")
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());

        let storage_backend = env::var("STORAGE_BACKEND")
            .unwrap_or_else(|_| "fs".to_string())
            .trim()
            .to_lowercase();

        if storage_backend != "fs" && storage_backend != "s3" {
            anyhow::bail!(
                "STORAGE_BACKEND must be 'fs' or 's3' (got \"{}\")",
                storage_backend
            );
        }

        let storage_fs_path = PathBuf::from(
            env::var("STORAGE_FS_PATH").unwrap_or_else(|_| "./data/attachments".to_string()),
        );

        let s3_endpoint = env::var("S3_ENDPOINT")
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());

        let s3_region = env::var("S3_REGION")
            .unwrap_or_else(|_| "us-east-1".to_string())
            .trim()
            .to_string();

        let s3_bucket = env::var("S3_BUCKET")
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());

        let s3_access_key_id = env::var("S3_ACCESS_KEY_ID")
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());

        let s3_secret_access_key = env::var("S3_SECRET_ACCESS_KEY")
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());

        let s3_path_style = env::var("S3_PATH_STYLE")
            .map(|v| v.trim().eq_ignore_ascii_case("true") || v.trim() == "1")
            .unwrap_or(false);

        let s3_presign_ttl_seconds = env::var("S3_PRESIGN_TTL_SECONDS")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(600);

        if storage_backend == "s3"
            && (s3_bucket.is_none() || s3_access_key_id.is_none() || s3_secret_access_key.is_none())
        {
            anyhow::bail!(
                "When STORAGE_BACKEND is 's3', S3_BUCKET, S3_ACCESS_KEY_ID, and S3_SECRET_ACCESS_KEY must all be set"
            );
        }

        let attachment_chunk_size = env::var("ATTACHMENT_CHUNK_SIZE")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(16384);

        if attachment_chunk_size == 0 || attachment_chunk_size % 4096 != 0 {
            anyhow::bail!(
                "ATTACHMENT_CHUNK_SIZE must be greater than 0 and a multiple of 4096 (got {})",
                attachment_chunk_size
            );
        }

        let bucket_sizes_raw = env::var("ATTACHMENT_BUCKET_SIZES")
            .unwrap_or_else(|_| "65536,524288,4194304,33554432,268435456".to_string());

        let mut attachment_bucket_sizes = Vec::new();
        for item in bucket_sizes_raw.split(',') {
            let item_trimmed = item.trim();
            if item_trimmed.is_empty() {
                continue;
            }
            let val: u64 = item_trimmed.parse().map_err(|_| {
                anyhow::anyhow!(
                    "Invalid number in ATTACHMENT_BUCKET_SIZES: \"{}\"",
                    item_trimmed
                )
            })?;
            if val == 0 || val % 4096 != 0 {
                anyhow::bail!(
                    "Each size in ATTACHMENT_BUCKET_SIZES must be greater than 0 and a multiple of 4096 (got {})",
                    val
                );
            }
            attachment_bucket_sizes.push(val);
        }

        if attachment_bucket_sizes.is_empty() {
            anyhow::bail!("ATTACHMENT_BUCKET_SIZES must not be empty");
        }

        for windows in attachment_bucket_sizes.windows(2) {
            if windows[0] >= windows[1] {
                anyhow::bail!(
                    "ATTACHMENT_BUCKET_SIZES must be strictly increasing (got {} >= {})",
                    windows[0],
                    windows[1]
                );
            }
        }

        let backup_enabled = env::var("BACKUP_ENABLED")
            .map(|v| v.trim().eq_ignore_ascii_case("true") || v.trim() == "1")
            .unwrap_or(true);

        let backup_path =
            PathBuf::from(env::var("BACKUP_PATH").unwrap_or_else(|_| "./data/backups".to_string()));

        let backup_interval_hours = env::var("BACKUP_INTERVAL_HOURS")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(24);

        let backup_retention_count = env::var("BACKUP_RETENTION_COUNT")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(30);

        let backup_include_attachments = env::var("BACKUP_INCLUDE_ATTACHMENTS")
            .map(|v| v.trim().eq_ignore_ascii_case("true") || v.trim() == "1")
            .unwrap_or(false);

        if backup_enabled && storage_backend == "s3" && backup_include_attachments {
            anyhow::bail!(
                "FATAL: BACKUP_INCLUDE_ATTACHMENTS=true is not supported with STORAGE_BACKEND=s3.\nS3 attachment blobs are not backed up by the server. Use S3 versioning\nand lifecycle policies, or set BACKUP_INCLUDE_ATTACHMENTS=false."
            );
        }

        let push_enabled = env::var("PUSH_ENABLED")
            .map(|v| v.trim().eq_ignore_ascii_case("true") || v.trim() == "1")
            .unwrap_or(true);

        let push_vapid_public_key = env::var("PUSH_VAPID_PUBLIC_KEY")
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "auto".to_string());

        let push_vapid_private_key = env::var("PUSH_VAPID_PRIVATE_KEY")
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "auto".to_string());

        let push_vapid_subject = env::var("PUSH_VAPID_SUBJECT")
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());

        let push_gateway_url = env::var("PUSH_GATEWAY_URL")
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());

        let push_delivery_enabled = env::var("PUSH_DELIVERY_ENABLED")
            .map(|v| v.trim().eq_ignore_ascii_case("true") || v.trim() == "1")
            .unwrap_or(true);

        let push_suppression_window_secs = env::var("PUSH_SUPPRESSION_WINDOW_SECS")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(30);

        let push_delivery_timeout_secs = env::var("PUSH_DELIVERY_TIMEOUT_SECS")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(10);

        let push_max_concurrent_deliveries = env::var("PUSH_MAX_CONCURRENT_DELIVERIES")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(32);

        if push_delivery_enabled && !push_enabled {
            anyhow::bail!("FATAL: PUSH_DELIVERY_ENABLED=true requires PUSH_ENABLED=true.");
        }

        let push_apns_key = env::var("PUSH_APNS_KEY")
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());

        let push_apns_key_id = env::var("PUSH_APNS_KEY_ID")
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());

        let push_apns_team_id = env::var("PUSH_APNS_TEAM_ID")
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());

        let push_apns_bundle_id = env::var("PUSH_APNS_BUNDLE_ID")
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());

        let push_apns_use_sandbox = env::var("PUSH_APNS_USE_SANDBOX")
            .map(|v| v.trim().eq_ignore_ascii_case("true") || v.trim() == "1")
            .unwrap_or(false);

        let push_fcm_service_account_json = env::var("PUSH_FCM_SERVICE_ACCOUNT_JSON")
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());

        if push_enabled {
            let pub_auto = push_vapid_public_key == "auto";
            let priv_auto = push_vapid_private_key == "auto";

            if pub_auto != priv_auto {
                anyhow::bail!(
                    "FATAL: PUSH_VAPID_PUBLIC_KEY and PUSH_VAPID_PRIVATE_KEY must both be \"auto\" or both be explicit values."
                );
            }

            if !pub_auto && !priv_auto {
                use base64::engine::general_purpose::URL_SAFE_NO_PAD;
                use base64::Engine;

                let pub_bytes = URL_SAFE_NO_PAD
                    .decode(&push_vapid_public_key)
                    .map_err(|e| anyhow::anyhow!("Invalid PUSH_VAPID_PUBLIC_KEY base64url: {e}"))?;
                if pub_bytes.len() != 65 || pub_bytes[0] != 0x04 {
                    anyhow::bail!(
                        "Invalid PUSH_VAPID_PUBLIC_KEY: must decode to 65 bytes starting with 0x04"
                    );
                }

                let priv_bytes = URL_SAFE_NO_PAD
                    .decode(&push_vapid_private_key)
                    .map_err(|e| {
                        anyhow::anyhow!("Invalid PUSH_VAPID_PRIVATE_KEY base64url: {e}")
                    })?;
                if priv_bytes.len() != 32 {
                    anyhow::bail!("Invalid PUSH_VAPID_PRIVATE_KEY: must decode to 32 bytes");
                }
            }
        }

        Ok(Self {
            app_env,
            app_url,
            app_name,
            log_level,
            server_bind,
            db_path,
            db_busy_timeout_ms,
            opaque_oprf_key_path,
            oprf_blind_enabled,
            username_oprf_enabled,
            key_transparency_enabled,
            key_transparency_log_path,
            key_transparency_auditor_keys,
            link_preview_proxy_enabled,
            link_preview_proxy_timeout_seconds,
            link_preview_proxy_max_bytes,
            link_preview_proxy_key_path,
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
            max_room_metadata_bytes,
            edit_window_seconds,
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
            sockudo_url,
            sockudo_app_id,
            sockudo_app_key,
            sockudo_app_secret,
            sockudo_enable_client_events,
            sockudo_public_url,
            storage_backend,
            storage_fs_path,
            s3_endpoint,
            s3_region,
            s3_bucket,
            s3_access_key_id,
            s3_secret_access_key,
            s3_path_style,
            s3_presign_ttl_seconds,
            attachment_chunk_size,
            attachment_bucket_sizes,
            backup_enabled,
            backup_path,
            backup_interval_hours,
            backup_retention_count,
            backup_include_attachments,
            push_enabled,
            push_vapid_public_key,
            push_vapid_private_key,
            push_vapid_subject,
            push_gateway_url,
            push_delivery_enabled,
            push_suppression_window_secs,
            push_delivery_timeout_secs,
            push_max_concurrent_deliveries,
            push_apns_key,
            push_apns_key_id,
            push_apns_team_id,
            push_apns_bundle_id,
            push_apns_use_sandbox,
            push_fcm_service_account_json,
        })
    }

    pub fn test_default() -> Self {
        Self {
            app_env: "development".to_string(),
            app_url: Some("http://localhost:8080".to_string()),
            app_name: "Test".to_string(),
            log_level: "error".to_string(),
            server_bind: "127.0.0.1:0".to_string(),
            db_path: ":memory:".to_string(),
            db_busy_timeout_ms: 5000,
            opaque_oprf_key_path: "/tmp/test-oprf.key".to_string(),
            oprf_blind_enabled: true,
            username_oprf_enabled: true,
            key_transparency_enabled: true,
            key_transparency_log_path: "/tmp/test-kt-log".to_string(),
            key_transparency_auditor_keys: None,
            altcha_enabled: false,
            altcha_hmac_secret: "auto".to_string(),
            altcha_algorithm: "PBKDF2/SHA-256".to_string(),
            altcha_cost: 100,
            session_expiry_days: 30,
            session_sliding: true,
            max_file_size_bytes: 104_857_600,
            server_max_devices_per_user: 20,
            invite_default_uses: 1,
            invite_expiry_days: 0,
            invite_code_length: 8,
            invite_limited_max_uses: 10,
            invite_limited_max_open: 50,
            room_invite_default_uses: 1,
            room_invite_code_length: 8,
            max_room_metadata_bytes: 4096,
            rate_limits: RateLimitConfig {
                invite_create_hourly: 50,
                invite_create_daily: 200,
                invite_redeem_per_min: 10,
                kp_claim_per_min: 30,
                kp_claim_hourly: 200,
                login_per_min: 10,
                login_lockout_min: 15,
                export_rate_limit_hours: 24,
                presign_per_min: 60,
                oprf_blind_per_min: 30,
                oprf_blind_per_hour: 300,
                read_state_per_min: 120,
                preference_per_min: 120,
                rate_device_name_per_min: 30,
                rate_admin_oprf_rotate_per_hour: 1,
                rate_room_metadata_per_min: 30,
                rate_edit_per_min: 30,
                rate_reaction_per_min: 60,
                rate_member_list_per_min: 60,
                rate_recover_start_per_min: 5,
                rate_recover_start_per_hour: 20,
                rate_link_preview_per_min: 10,
            },
            link_preview_proxy_enabled: false,
            link_preview_proxy_timeout_seconds: 5,
            link_preview_proxy_max_bytes: 1_048_576,
            link_preview_proxy_key_path: "./data/link-preview.key".to_string(),
            edit_window_seconds: 900,
            cleanup_enabled: false,
            cleanup_interval_minutes: 60,
            cleanup_startup_delay_secs: 0,
            audit_retention_days: 90,
            data_retention_days: 0,
            export_rate_limit_hours: 24,
            trust_proxy: false,
            hsts_max_age: 0,
            hsts_include_subdomains: false,
            client_static_dir: None,
            sockudo_url: "http://localhost:6001".to_string(),
            sockudo_app_id: "chat".to_string(),
            sockudo_app_key: "test-key".to_string(),
            sockudo_app_secret: "test-secret".to_string(),
            sockudo_enable_client_events: true,
            sockudo_public_url: None,
            storage_backend: "fs".to_string(),
            storage_fs_path: PathBuf::from("/tmp/test-attachments"),
            s3_endpoint: None,
            s3_region: "us-east-1".to_string(),
            s3_bucket: None,
            s3_access_key_id: None,
            s3_secret_access_key: None,
            s3_path_style: false,
            s3_presign_ttl_seconds: 600,
            attachment_chunk_size: 16384,
            attachment_bucket_sizes: vec![65536, 524288, 4194304, 33554432, 268435456],
            backup_enabled: true,
            backup_path: PathBuf::from("/tmp/test-backups"),
            backup_interval_hours: 24,
            backup_retention_count: 30,
            backup_include_attachments: false,
            push_enabled: true,
            push_vapid_public_key: "auto".to_string(),
            push_vapid_private_key: "auto".to_string(),
            push_vapid_subject: None,
            push_gateway_url: None,
            push_delivery_enabled: true,
            push_suppression_window_secs: 30,
            push_delivery_timeout_secs: 10,
            push_max_concurrent_deliveries: 32,
            push_apns_key: None,
            push_apns_key_id: None,
            push_apns_team_id: None,
            push_apns_bundle_id: None,
            push_apns_use_sandbox: false,
            push_fcm_service_account_json: None,
        }
    }
}
