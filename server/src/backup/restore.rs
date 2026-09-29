use std::path::PathBuf;
use tracing::info;

use crate::config::Config;

use super::encryption::{decrypt_backup, BackupKey};
use super::format::extract_backup_archive;
use super::BackupError;

pub struct RestoreOptions {
    pub from: PathBuf,
    pub confirm: bool,
}

pub async fn restore_backup(config: &Config, options: RestoreOptions) -> Result<(), BackupError> {
    if !options.confirm {
        return Err(BackupError::RestoreFailed(
            "Restore aborted. Pass --confirm to proceed.".to_string(),
        ));
    }

    if !tokio::fs::try_exists(&options.from).await.unwrap_or(false) {
        return Err(BackupError::NotFound(format!(
            "Backup file not found at {}",
            options.from.display()
        )));
    }

    let oprf_key_path = PathBuf::from(&config.opaque_oprf_key_path);
    if !tokio::fs::try_exists(&oprf_key_path).await.unwrap_or(false) {
        return Err(BackupError::RestoreFailed(format!(
            "Restore requires the OPRF key file at {}. This file is needed to derive the backup decryption key. If restoring onto a fresh install, copy the OPRF key file from the original deployment first.",
            config.opaque_oprf_key_path
        )));
    }

    let oprf_key_bytes = tokio::fs::read(&oprf_key_path).await?;
    let key = BackupKey::derive(&oprf_key_bytes)?;

    let encrypted_bytes = tokio::fs::read(&options.from).await?;
    let tar_bytes = decrypt_backup(&key, &encrypted_bytes)?;

    let (manifest, db_bytes, archive_oprf_bytes, attachments) = extract_backup_archive(&tar_bytes)?;

    let db_path = PathBuf::from(&config.db_path);
    if let Some(parent) = db_path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }

    let db_tmp = format!("{}.restore.tmp", config.db_path);
    tokio::fs::write(&db_tmp, &db_bytes).await?;
    tokio::fs::rename(&db_tmp, &db_path).await?;

    if let Some(parent) = oprf_key_path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    let oprf_tmp = format!("{}.restore.tmp", config.opaque_oprf_key_path);
    tokio::fs::write(&oprf_tmp, &archive_oprf_bytes).await?;
    tokio::fs::rename(&oprf_tmp, &oprf_key_path).await?;

    if let Some(files) = attachments {
        if config.storage_backend == "s3" {
            return Err(BackupError::RestoreFailed(
                "Backup contains attachments, but the current storage backend is S3. Set STORAGE_BACKEND=fs and retry, or discard the attachment data.".to_string(),
            ));
        }

        tokio::fs::create_dir_all(&config.storage_fs_path).await?;
        for (rel_path, content) in files {
            let target_path = config.storage_fs_path.join(&rel_path);
            if let Some(parent) = target_path.parent() {
                tokio::fs::create_dir_all(parent).await?;
            }
            tokio::fs::write(&target_path, &content).await?;
        }
    }

    info!(
        created_at = %manifest.created_at,
        server_version = %manifest.server_version,
        "Restore completed successfully."
    );

    Ok(())
}
