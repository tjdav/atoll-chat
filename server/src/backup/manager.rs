use chrono::{DateTime, NaiveDateTime, Utc};
use std::path::PathBuf;
use tracing::warn;

use crate::config::Config;

use super::BackupError;

#[derive(Debug, Clone)]
pub struct BackupInfo {
    pub path: PathBuf,
    pub filename: String,
    pub size_bytes: u64,
    pub created_at: DateTime<Utc>,
}

fn parse_backup_filename(filename: &str) -> Option<DateTime<Utc>> {
    if !filename.starts_with("backup-") || !filename.ends_with(".cbak") {
        return None;
    }
    let timestamp_str = filename.strip_prefix("backup-")?.strip_suffix(".cbak")?;
    // Format: YYYY-MM-DDTHH-MM-SSZ
    let naive = NaiveDateTime::parse_from_str(timestamp_str, "%Y-%m-%dT%H-%M-%SZ").ok()?;
    Some(DateTime::<Utc>::from_naive_utc_and_offset(naive, Utc))
}

pub async fn list_backups(config: &Config) -> Result<Vec<BackupInfo>, BackupError> {
    if !tokio::fs::try_exists(&config.backup_path)
        .await
        .unwrap_or(false)
    {
        return Ok(Vec::new());
    }

    let mut read_dir = match tokio::fs::read_dir(&config.backup_path).await {
        Ok(rd) => rd,
        Err(e) => return Err(BackupError::Io(e)),
    };

    let mut list = Vec::new();
    while let Ok(Some(entry)) = read_dir.next_entry().await {
        let file_type = match entry.file_type().await {
            Ok(ft) => ft,
            Err(_) => continue,
        };

        if !file_type.is_file() {
            continue;
        }

        let filename = entry.file_name().to_string_lossy().to_string();
        if let Some(created_at) = parse_backup_filename(&filename) {
            let metadata = match entry.metadata().await {
                Ok(m) => m,
                Err(_) => continue,
            };

            list.push(BackupInfo {
                path: entry.path(),
                filename,
                size_bytes: metadata.len(),
                created_at,
            });
        }
    }

    // Sort descending by created_at (newest first)
    list.sort_by(|a, b| b.created_at.cmp(&a.created_at));

    Ok(list)
}

pub async fn prune_old_backups(config: &Config) -> Result<u64, BackupError> {
    if config.backup_retention_count == 0 {
        return Ok(0);
    }

    let list = list_backups(config).await?;
    let retention = config.backup_retention_count as usize;

    if list.len() <= retention {
        return Ok(0);
    }

    let to_remove = &list[retention..];
    let mut deleted = 0u64;

    for item in to_remove {
        if let Err(e) = tokio::fs::remove_file(&item.path).await {
            warn!(path = %item.path.display(), error = %e, "failed to delete old backup file");
        } else {
            deleted += 1;
        }
    }

    Ok(deleted)
}

pub async fn find_backup(config: &Config, filename: &str) -> Result<BackupInfo, BackupError> {
    let list = list_backups(config).await?;
    list.into_iter()
        .find(|b| b.filename == filename)
        .ok_or_else(|| BackupError::NotFound(format!("backup {} not found", filename)))
}
