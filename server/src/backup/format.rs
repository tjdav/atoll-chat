use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::io::Read;
use tar::{Archive, Builder, Header};

use super::BackupError;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupManifest {
    pub created_at: DateTime<Utc>,
    pub server_version: String,
    pub database_path: String,
    pub oprf_key_path: String,
    pub include_attachments: bool,
    pub storage_backend: String,
    pub attachment_count: u64,
}

pub fn build_backup_archive(
    manifest: &BackupManifest,
    db_bytes: &[u8],
    oprf_key_bytes: &[u8],
    attachments: Option<&[(String, Vec<u8>)]>,
) -> Result<Vec<u8>, BackupError> {
    let mut builder = Builder::new(Vec::new());

    // 1. Write manifest.json
    let manifest_bytes = serde_json::to_vec(manifest)
        .map_err(|e| BackupError::InvalidFormat(format!("failed to serialize manifest: {}", e)))?;
    let mut header = Header::new_gnu();
    header.set_size(manifest_bytes.len() as u64);
    header.set_mode(0o644);
    header.set_cksum();
    builder
        .append_data(&mut header, "manifest.json", &manifest_bytes[..])
        .map_err(BackupError::Io)?;

    // 2. Write app.db
    let mut header = Header::new_gnu();
    header.set_size(db_bytes.len() as u64);
    header.set_mode(0o600);
    header.set_cksum();
    builder
        .append_data(&mut header, "app.db", db_bytes)
        .map_err(BackupError::Io)?;

    // 3. Write oprf.key
    let mut header = Header::new_gnu();
    header.set_size(oprf_key_bytes.len() as u64);
    header.set_mode(0o600);
    header.set_cksum();
    builder
        .append_data(&mut header, "oprf.key", oprf_key_bytes)
        .map_err(BackupError::Io)?;

    // 4. Write attachments/ if present
    if let Some(files) = attachments {
        for (rel_path, content) in files {
            let tar_path = format!("attachments/{}", rel_path.trim_start_matches('/'));
            let mut header = Header::new_gnu();
            header.set_size(content.len() as u64);
            header.set_mode(0o600);
            header.set_cksum();
            builder
                .append_data(&mut header, &tar_path, &content[..])
                .map_err(BackupError::Io)?;
        }
    }

    builder.finish().map_err(BackupError::Io)?;
    let tar_bytes = builder.into_inner().map_err(BackupError::Io)?;
    Ok(tar_bytes)
}

#[allow(clippy::type_complexity)]
pub fn extract_backup_archive(
    archive_bytes: &[u8],
) -> Result<
    (
        BackupManifest,
        Vec<u8>,
        Vec<u8>,
        Option<Vec<(String, Vec<u8>)>>,
    ),
    BackupError,
> {
    let mut archive = Archive::new(archive_bytes);

    let mut manifest: Option<BackupManifest> = None;
    let mut db_bytes: Option<Vec<u8>> = None;
    let mut oprf_key_bytes: Option<Vec<u8>> = None;
    let mut attachments: Vec<(String, Vec<u8>)> = Vec::new();

    let entries = archive
        .entries()
        .map_err(|e| BackupError::InvalidFormat(format!("failed to read tar entries: {}", e)))?;

    for entry_res in entries {
        let mut entry = entry_res
            .map_err(|e| BackupError::InvalidFormat(format!("invalid tar entry: {}", e)))?;
        let path = entry
            .path()
            .map_err(|e| BackupError::InvalidFormat(format!("invalid path in tar: {}", e)))?
            .to_string_lossy()
            .to_string();

        let mut buf = Vec::new();
        entry.read_to_end(&mut buf).map_err(BackupError::Io)?;

        if path == "manifest.json" {
            let m: BackupManifest = serde_json::from_slice(&buf).map_err(|e| {
                BackupError::InvalidFormat(format!("failed to parse manifest.json: {}", e))
            })?;
            manifest = Some(m);
        } else if path == "app.db" {
            db_bytes = Some(buf);
        } else if path == "oprf.key" {
            oprf_key_bytes = Some(buf);
        } else if let Some(rel_path) = path.strip_prefix("attachments/") {
            if !rel_path.is_empty() {
                attachments.push((rel_path.to_string(), buf));
            }
        }
    }

    let manifest = manifest.ok_or_else(|| {
        BackupError::InvalidFormat("manifest.json missing from backup archive".to_string())
    })?;
    let db_bytes = db_bytes.ok_or_else(|| {
        BackupError::InvalidFormat("app.db missing from backup archive".to_string())
    })?;
    let oprf_key_bytes = oprf_key_bytes.ok_or_else(|| {
        BackupError::InvalidFormat("oprf.key missing from backup archive".to_string())
    })?;

    let attachments_out = if manifest.include_attachments {
        Some(attachments)
    } else {
        None
    };

    Ok((manifest, db_bytes, oprf_key_bytes, attachments_out))
}
