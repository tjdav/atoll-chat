use async_trait::async_trait;
use s3::creds::Credentials;
use s3::region::Region;
use s3::Bucket;
use std::sync::Arc;
use std::time::Duration;

use super::{validate_key, Storage, StorageError};
use crate::config::Config;

pub struct S3Storage {
    bucket: Arc<Bucket>,
    #[allow(dead_code)]
    presign_ttl: u64,
}

impl S3Storage {
    pub fn new(config: &Config) -> Result<Self, StorageError> {
        let bucket_name = config
            .s3_bucket
            .as_ref()
            .ok_or_else(|| StorageError::Config("S3_BUCKET is required".to_string()))?;

        let access_key = config
            .s3_access_key_id
            .as_ref()
            .ok_or_else(|| StorageError::Config("S3_ACCESS_KEY_ID is required".to_string()))?;

        let secret_key = config
            .s3_secret_access_key
            .as_ref()
            .ok_or_else(|| StorageError::Config("S3_SECRET_ACCESS_KEY is required".to_string()))?;

        let creds = Credentials::new(Some(access_key), Some(secret_key), None, None, None)
            .map_err(|e| StorageError::Config(format!("Invalid credentials: {}", e)))?;

        let region = if let Some(ref endpoint) = config.s3_endpoint {
            Region::Custom {
                region: config.s3_region.clone(),
                endpoint: endpoint.clone(),
            }
        } else {
            config
                .s3_region
                .parse::<Region>()
                .map_err(|e| StorageError::Config(format!("Invalid S3_REGION: {}", e)))?
        };

        let mut bucket = Bucket::new(bucket_name, region, creds)
            .map_err(|e| StorageError::Config(format!("Failed to create S3 bucket: {}", e)))?;

        if config.s3_path_style {
            bucket = bucket.with_path_style();
        }

        bucket.set_request_timeout(Some(Duration::from_secs(30)));

        Ok(Self {
            bucket: Arc::new(*bucket),
            presign_ttl: config.s3_presign_ttl_seconds,
        })
    }
}

#[async_trait]
impl Storage for S3Storage {
    async fn write(&self, key: &str, data: &[u8]) -> Result<(), StorageError> {
        validate_key(key)?;
        let resp = self
            .bucket
            .put_object(key, data)
            .await
            .map_err(|e| StorageError::S3(e.to_string()))?;

        if (200..300).contains(&resp.status_code()) {
            Ok(())
        } else {
            Err(StorageError::S3(format!(
                "PUT failed with status {}",
                resp.status_code()
            )))
        }
    }

    async fn read(&self, key: &str) -> Result<Vec<u8>, StorageError> {
        validate_key(key)?;
        let resp = self
            .bucket
            .get_object(key)
            .await
            .map_err(|e| StorageError::S3(e.to_string()))?;

        let status = resp.status_code();
        if status == 404 {
            Err(StorageError::NotFound(key.to_string()))
        } else if (200..300).contains(&status) {
            Ok(resp.bytes().to_vec())
        } else {
            Err(StorageError::S3(format!(
                "GET failed with status {}",
                status
            )))
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

        let resp = self
            .bucket
            .get_object_range(key, start, Some(end))
            .await
            .map_err(|e| StorageError::S3(e.to_string()))?;

        let status = resp.status_code();
        if status == 404 {
            Err(StorageError::NotFound(key.to_string()))
        } else if (200..300).contains(&status) {
            Ok(resp.bytes().to_vec())
        } else {
            Err(StorageError::S3(format!(
                "GET range failed with status {}",
                status
            )))
        }
    }

    async fn delete(&self, key: &str) -> Result<(), StorageError> {
        validate_key(key)?;
        let resp = self
            .bucket
            .delete_object(key)
            .await
            .map_err(|e| StorageError::S3(e.to_string()))?;

        let status = resp.status_code();
        if status == 404 || (200..300).contains(&status) {
            Ok(())
        } else {
            Err(StorageError::S3(format!(
                "DELETE failed with status {}",
                status
            )))
        }
    }

    async fn exists(&self, key: &str) -> Result<bool, StorageError> {
        validate_key(key)?;
        let (_head_res, status) = self
            .bucket
            .head_object(key)
            .await
            .map_err(|e| StorageError::S3(e.to_string()))?;

        if (200..300).contains(&status) {
            Ok(true)
        } else if status == 404 {
            Ok(false)
        } else {
            Err(StorageError::S3(format!(
                "HEAD failed with status {}",
                status
            )))
        }
    }

    fn backend_name(&self) -> &'static str {
        "s3"
    }

    async fn presign_get(
        &self,
        key: &str,
        ttl_seconds: u64,
    ) -> Result<Option<String>, StorageError> {
        validate_key(key)?;
        let result = self
            .bucket
            .presign_get(key, ttl_seconds as u32, None)
            .await
            .map_err(|e| StorageError::S3(e.to_string()))?;
        Ok(Some(result))
    }
}
