pub mod encryption;
pub mod format;
pub mod job;
pub mod manager;
pub mod restore;

pub use encryption::{decrypt_backup, encrypt_backup, BackupKey};
pub use format::{build_backup_archive, extract_backup_archive, BackupManifest};
pub use job::{BackupJob, BackupResult};
pub use manager::{find_backup, list_backups, prune_old_backups, BackupInfo};
pub use restore::{restore_backup, RestoreOptions};

#[derive(Debug, thiserror::Error)]
pub enum BackupError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("encryption failed: {0}")]
    Encryption(String),
    #[error("decryption failed: {0}")]
    Decryption(String),
    #[error("invalid backup format: {0}")]
    InvalidFormat(String),
    #[error("key derivation failed: {0}")]
    KeyDerivation(String),
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("backup not found: {0}")]
    NotFound(String),
    #[error("restore failed: {0}")]
    RestoreFailed(String),
}
