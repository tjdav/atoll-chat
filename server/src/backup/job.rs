use chrono::{DateTime, Utc};
use sqlx::SqlitePool;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tracing::{error, info, warn};

use crate::config::Config;

use super::encryption::{encrypt_backup, BackupKey};
use super::format::{build_backup_archive, BackupManifest};
use super::manager;
use super::BackupError;

pub struct BackupJob {
    pub config: Arc<Config>,
}

#[derive(Debug, Clone)]
pub struct BackupResult {
    pub path: PathBuf,
    pub size_bytes: u64,
    pub created_at: DateTime<Utc>,
}

impl BackupJob {
    pub fn new(config: Arc<Config>) -> Self {
        Self { config }
    }

    pub async fn run_once(&self, pool: &SqlitePool) -> Result<BackupResult, BackupError> {
        // 1. Checkpoint the WAL
        sqlx::query("PRAGMA wal_checkpoint(TRUNCATE);")
            .execute(pool)
            .await?;

        // 2. Read the database file
        let db_bytes = tokio::fs::read(&self.config.db_path).await?;

        // 3. Read the OPRF key file
        let oprf_key_bytes = tokio::fs::read(&self.config.opaque_oprf_key_path).await?;

        // 4. Optionally read attachments
        let mut attachments: Vec<(String, Vec<u8>)> = Vec::new();
        let include_attachments =
            self.config.backup_include_attachments && self.config.storage_backend == "fs";

        if include_attachments
            && tokio::fs::try_exists(&self.config.storage_fs_path)
                .await
                .unwrap_or(false)
        {
            let mut stack = vec![self.config.storage_fs_path.clone()];
            while let Some(dir) = stack.pop() {
                let mut read_dir = match tokio::fs::read_dir(&dir).await {
                    Ok(rd) => rd,
                    Err(e) => {
                        warn!(dir = %dir.display(), error = %e, "failed to read attachments dir");
                        continue;
                    }
                };

                while let Ok(Some(entry)) = read_dir.next_entry().await {
                    let path = entry.path();
                    let ft = match entry.file_type().await {
                        Ok(ft) => ft,
                        Err(_) => continue,
                    };

                    if ft.is_dir() {
                        stack.push(path);
                    } else if ft.is_file() {
                        if let Ok(rel) = path.strip_prefix(&self.config.storage_fs_path) {
                            if let Ok(bytes) = tokio::fs::read(&path).await {
                                attachments.push((rel.to_string_lossy().to_string(), bytes));
                            }
                        }
                    }
                }
            }
        }

        let now = Utc::now();
        let manifest = BackupManifest {
            created_at: now,
            server_version: env!("CARGO_PKG_VERSION").to_string(),
            database_path: self.config.db_path.clone(),
            oprf_key_path: self.config.opaque_oprf_key_path.clone(),
            include_attachments,
            storage_backend: self.config.storage_backend.clone(),
            attachment_count: attachments.len() as u64,
        };

        let attachments_option = if include_attachments {
            Some(attachments.as_slice())
        } else {
            None
        };

        // 6. Build the tar archive
        let tar_bytes =
            build_backup_archive(&manifest, &db_bytes, &oprf_key_bytes, attachments_option)?;

        // 7. Derive the backup key
        let key = BackupKey::derive(&oprf_key_bytes)?;

        // 8. Encrypt the archive
        let encrypted_bytes = encrypt_backup(&key, &tar_bytes)?;

        // 9. Ensure backup_path exists and write to file
        tokio::fs::create_dir_all(&self.config.backup_path).await?;

        let timestamp_str = now.format("%Y-%m-%dT%H-%M-%SZ").to_string();
        let filename = format!("backup-{}.cbak", timestamp_str);
        let final_path = self.config.backup_path.join(&filename);
        let tmp_path = self.config.backup_path.join(format!("{}.tmp", filename));

        tokio::fs::write(&tmp_path, &encrypted_bytes).await?;
        tokio::fs::rename(&tmp_path, &final_path).await?;

        // 10. Prune old backups
        if let Err(e) = manager::prune_old_backups(&self.config).await {
            warn!(error = %e, "failed to prune old backups");
        }

        let result = BackupResult {
            path: final_path,
            size_bytes: encrypted_bytes.len() as u64,
            created_at: now,
        };

        Ok(result)
    }

    pub async fn run_loop(
        self,
        pool: SqlitePool,
        mut shutdown: tokio::sync::watch::Receiver<bool>,
    ) {
        // Startup delay: 60 seconds
        tokio::select! {
            _ = tokio::time::sleep(Duration::from_secs(60)) => {},
            _ = shutdown.changed() => {
                info!("backup scheduler shutting down before first cycle");
                return;
            }
        }

        let interval_secs = self.config.backup_interval_hours * 3600;

        loop {
            info!("running scheduled backup");
            match self.run_once(&pool).await {
                Ok(res) => {
                    info!(
                        path = %res.path.display(),
                        size_bytes = res.size_bytes,
                        "backup created"
                    );
                }
                Err(e) => {
                    error!(error = %e, "backup failed");
                }
            }

            tokio::select! {
                _ = tokio::time::sleep(Duration::from_secs(interval_secs)) => {},
                _ = shutdown.changed() => {
                    info!("backup scheduler received shutdown signal, exiting loop");
                    break;
                }
            }
        }
    }
}
