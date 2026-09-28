use crate::config::Config;
use async_trait::async_trait;
use std::sync::Arc;

pub mod fs;
pub mod s3;

pub use fs::FsStorage;
pub use s3::S3Storage;

#[async_trait]
pub trait Storage: Send + Sync {
    async fn write(&self, key: &str, data: &[u8]) -> Result<(), StorageError>;
    async fn read(&self, key: &str) -> Result<Vec<u8>, StorageError>;
    async fn read_range(&self, key: &str, start: u64, end: u64) -> Result<Vec<u8>, StorageError>;
    async fn delete(&self, key: &str) -> Result<(), StorageError>;
    async fn exists(&self, key: &str) -> Result<bool, StorageError>;
    fn backend_name(&self) -> &'static str;
}

#[derive(Debug, thiserror::Error)]
pub enum StorageError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("invalid key: {0}")]
    InvalidKey(String),
    #[error("not found: {0}")]
    NotFound(String),
    #[error("s3 error: {0}")]
    S3(String),
    #[error("configuration error: {0}")]
    Config(String),
}

pub fn validate_key(key: &str) -> Result<(), StorageError> {
    let parts: Vec<&str> = key.split('/').collect();
    if parts.len() != 4 || parts[0] != "attachments" {
        return Err(StorageError::InvalidKey(key.to_string()));
    }
    let p1 = parts[1];
    let p2 = parts[2];
    let p3 = parts[3];

    if p1.len() != 2
        || !p1
            .chars()
            .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase())
    {
        return Err(StorageError::InvalidKey(key.to_string()));
    }
    if p2.len() != 2
        || !p2
            .chars()
            .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase())
    {
        return Err(StorageError::InvalidKey(key.to_string()));
    }
    if p3.len() != 64
        || !p3
            .chars()
            .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase())
    {
        return Err(StorageError::InvalidKey(key.to_string()));
    }

    if p1 != &p3[0..2] || p2 != &p3[2..4] {
        return Err(StorageError::InvalidKey(key.to_string()));
    }

    Ok(())
}

pub fn build_storage(config: &Config) -> Result<Arc<dyn Storage>, StorageError> {
    match config.storage_backend.as_str() {
        "fs" => {
            let storage = FsStorage::new(config.storage_fs_path.clone())?;
            Ok(Arc::new(storage))
        }
        "s3" => {
            let storage = S3Storage::new(config)?;
            Ok(Arc::new(storage))
        }
        other => Err(StorageError::Config(format!(
            "Unsupported storage backend: {}",
            other
        ))),
    }
}
