use async_trait::async_trait;
use std::io::SeekFrom;
use std::path::PathBuf;
use tokio::fs;
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};

use super::{validate_key, Storage, StorageError};

pub struct FsStorage {
    root: PathBuf,
}

impl FsStorage {
    pub fn new(root: PathBuf) -> Result<Self, StorageError> {
        std::fs::create_dir_all(&root)?;
        Ok(Self { root })
    }

    fn full_path(&self, key: &str) -> PathBuf {
        self.root.join(key)
    }
}

#[async_trait]
impl Storage for FsStorage {
    async fn write(&self, key: &str, data: &[u8]) -> Result<(), StorageError> {
        validate_key(key)?;
        let path = self.full_path(key);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).await?;
        }

        let tmp_path = PathBuf::from(format!("{}.tmp", path.display()));
        {
            let mut file = fs::File::create(&tmp_path).await?;
            file.write_all(data).await?;
            file.flush().await?;
        }

        fs::rename(tmp_path, path).await?;
        Ok(())
    }

    async fn read(&self, key: &str) -> Result<Vec<u8>, StorageError> {
        validate_key(key)?;
        let path = self.full_path(key);
        match fs::read(&path).await {
            Ok(bytes) => Ok(bytes),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                Err(StorageError::NotFound(key.to_string()))
            }
            Err(e) => Err(StorageError::Io(e)),
        }
    }

    async fn read_range(&self, key: &str, start: u64, end: u64) -> Result<Vec<u8>, StorageError> {
        validate_key(key)?;
        if start > end {
            return Err(StorageError::Io(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "start > end",
            )));
        }

        let path = self.full_path(key);
        let meta = match fs::metadata(&path).await {
            Ok(m) => m,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                return Err(StorageError::NotFound(key.to_string()));
            }
            Err(e) => return Err(StorageError::Io(e)),
        };

        let file_size = meta.len();
        if end >= file_size {
            return Err(StorageError::Io(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                format!("end range {} out of bounds for size {}", end, file_size),
            )));
        }

        let len = (end - start + 1) as usize;
        let mut file = fs::File::open(&path).await?;
        file.seek(SeekFrom::Start(start)).await?;

        let mut buf = vec![0u8; len];
        file.read_exact(&mut buf).await?;

        Ok(buf)
    }

    async fn delete(&self, key: &str) -> Result<(), StorageError> {
        validate_key(key)?;
        let path = self.full_path(key);
        match fs::remove_file(&path).await {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(StorageError::Io(e)),
        }
    }

    async fn exists(&self, key: &str) -> Result<bool, StorageError> {
        validate_key(key)?;
        let path = self.full_path(key);
        match fs::metadata(&path).await {
            Ok(_) => Ok(true),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(false),
            Err(e) => Err(StorageError::Io(e)),
        }
    }

    fn backend_name(&self) -> &'static str {
        "fs"
    }
}
