use chrono::{DateTime, Utc};
use opaque_ke::ServerSetup;
use rand::rngs::OsRng;
use sqlx::SqlitePool;
use std::fs;
use std::path::PathBuf;
use tracing::{error, info};

use crate::config::Config;
use crate::opaque::DefaultCipherSuite;

#[derive(Debug)]
pub struct RotationOutcome {
    pub backup_path: PathBuf,
    pub users_flagged: u64,
    pub rotated_at: DateTime<Utc>,
}

#[derive(Debug, thiserror::Error)]
pub enum RotationError {
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("key file not found at {0}")]
    KeyFileNotFound(PathBuf),
    #[error("backup failed: {0}")]
    BackupFailed(String),
    #[error("serialization error: {0}")]
    Serialization(String),
}

pub async fn rotate_oprf_key(
    pool: &SqlitePool,
    config: &Config,
) -> Result<RotationOutcome, RotationError> {
    let key_path = PathBuf::from(&config.opaque_oprf_key_path);

    // 1. Verify key file exists
    if !key_path.exists() {
        return Err(RotationError::KeyFileNotFound(key_path));
    }

    // 2. Back up current ServerSetup file
    let current_bytes = fs::read(&key_path)?;
    let timestamp_str = Utc::now().format("%Y%m%dT%H%M%SZ").to_string();
    let backup_path = PathBuf::from(format!("{}.bak.{}", key_path.display(), timestamp_str));

    fs::write(&backup_path, &current_bytes)
        .map_err(|e| RotationError::BackupFailed(e.to_string()))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let permissions = fs::Permissions::from_mode(0o600);
        let _ = fs::set_permissions(&backup_path, permissions);
    }

    info!("oprf: backed up ServerSetup to {}", backup_path.display());

    // 3. Flag every user for re-registration
    let res = sqlx::query(
        "UPDATE users SET requires_reregistration = 1 WHERE deleted_at IS NULL AND requires_reregistration = 0",
    )
    .execute(pool)
    .await?;

    let users_flagged = res.rows_affected();

    // 4. Generate new ServerSetup
    let setup = ServerSetup::<DefaultCipherSuite>::new(&mut OsRng);
    let new_bytes = setup.serialize();

    if new_bytes.len() != 128 {
        error!(
            "oprf: generated ServerSetup size mismatch (expected 128, got {})",
            new_bytes.len()
        );
        error!("oprf: rotation partially applied — flags set but key unchanged. Clear with: UPDATE users SET requires_reregistration = 0");
        return Err(RotationError::Serialization(
            "ServerSetup serialized byte length mismatch".to_string(),
        ));
    }

    // 5. Write new ServerSetup atomically
    let tmp_path = PathBuf::from(format!("{}.tmp", key_path.display()));
    if let Err(e) = fs::write(&tmp_path, new_bytes) {
        error!("oprf: rotation partially applied — flags set but key unchanged. Clear with: UPDATE users SET requires_reregistration = 0");
        return Err(RotationError::Io(e));
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let permissions = fs::Permissions::from_mode(0o600);
        let _ = fs::set_permissions(&tmp_path, permissions);
    }

    if let Err(e) = fs::rename(&tmp_path, &key_path) {
        error!("oprf: rotation partially applied — flags set but key unchanged. Clear with: UPDATE users SET requires_reregistration = 0");
        return Err(RotationError::Io(e));
    }

    info!(
        "oprf: rotated ServerSetup, new file at {}",
        key_path.display()
    );

    Ok(RotationOutcome {
        backup_path,
        users_flagged,
        rotated_at: Utc::now(),
    })
}
